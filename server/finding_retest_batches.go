package server

import (
	"database/sql"
	"errors"
	"net/http"
	"strconv"
	"strings"
	"unicode/utf8"

	"github.com/Autumn-27/artex/agent"
	"github.com/Autumn-27/artex/db"
)

func (s *Server) registerFindingRetestBatches(mux *http.ServeMux) {
	mux.HandleFunc("GET /api/exploration/findings/retest-candidates", s.findingRetestCandidates)
	mux.HandleFunc("GET /api/exploration/finding-retest-batches", s.listFindingRetestBatches)
	mux.HandleFunc("POST /api/exploration/finding-retest-batches", s.createFindingRetestBatch)
	mux.HandleFunc("GET /api/exploration/finding-retest-batches/{id}", s.getFindingRetestBatch)
	mux.HandleFunc("POST /api/exploration/finding-retest-batches/{id}/stop", s.stopFindingRetestBatch)
	mux.HandleFunc("POST /api/exploration/finding-retest-batches/{id}/retry", s.retryFindingRetestBatch)
	mux.HandleFunc("GET /api/exploration/findings/retests/settings", s.findingRetestSettings)
	mux.HandleFunc("PUT /api/exploration/findings/retests/settings", s.findingRetestSettings)
}
func (s *Server) findingRetestCandidates(w http.ResponseWriter, r *http.Request) {
	pg := s.pg(w)
	if pg == nil {
		return
	}
	f := findingFilterFromQuery(r.URL.Query())
	if f.TaskID != "" && f.TaskID != db.FindingUnassignedTask {
		if n, e := strconv.ParseInt(f.TaskID, 10, 64); e != nil || n <= 0 {
			writeErr(w, 400, "invalid task id")
			return
		}
	}
	ids, err := pg.FindingRetestCandidates(r.Context(), f)
	if err != nil {
		writeErr(w, 500, err.Error())
		return
	}
	if len(ids) > db.MaxRetestBatchSize {
		writeErr(w, 400, "单批最多 500 个漏洞，请缩小筛选范围或分批勾选")
		return
	}
	writeJSON(w, 200, map[string]any{"ids": ids, "total": len(ids)})
}
func (s *Server) createFindingRetestBatch(w http.ResponseWriter, r *http.Request) {
	if s.pg(w) == nil {
		return
	}
	var req struct {
		IDs    []string `json:"ids"`
		Notes  string   `json:"notes"`
		Key    string   `json:"request_key"`
		TaskID string   `json:"task_id"`
	}
	if !decodeConversationRequest(w, r, &req) {
		return
	}
	ids, ok := parseRetestIDs(w, req.IDs)
	if !ok {
		return
	}
	if req.TaskID != "" {
		if n, e := strconv.ParseInt(req.TaskID, 10, 64); e != nil || n <= 0 {
			writeErr(w, 400, "invalid task id")
			return
		}
	}
	s.submitFindingRetestBatch(w, r, req.Key, ids, req.Notes, req.TaskID)
}
func parseRetestIDs(w http.ResponseWriter, raw []string) ([]int64, bool) {
	if len(raw) == 0 || len(raw) > db.MaxRetestBatchSize {
		writeErr(w, 400, "请选择 1–500 个漏洞")
		return nil, false
	}
	ids := make([]int64, len(raw))
	for i, str := range raw {
		id, err := strconv.ParseInt(str, 10, 64)
		if err != nil || id <= 0 {
			writeErr(w, 400, "invalid finding id")
			return nil, false
		}
		ids[i] = id
	}
	return ids, true
}
func (s *Server) submitFindingRetestBatch(w http.ResponseWriter, r *http.Request, key string, ids []int64, notes, taskID string) {
	key, notes = strings.TrimSpace(key), strings.TrimSpace(notes)
	if key == "" || len(key) > 100 || utf8.RuneCountInString(notes) > 4000 {
		writeErr(w, 400, "提交标识不能为空且不超过 100 字节，补充说明最多 4000 字")
		return
	}
	if !s.findingRetesterReady(w) {
		return
	}
	b, created, err := s.m.pg.CreateFindingRetestBatch(r.Context(), key, ids, notes, taskID)
	if errors.Is(err, db.ErrRetestBatchKeyConflict) {
		writeErr(w, 409, err.Error())
		return
	}
	if err != nil {
		writeErr(w, 500, err.Error())
		return
	}
	s.wakeFindingRetests()
	code := 200
	if created {
		code = 202
	}
	writeJSON(w, code, map[string]any{"batch": b, "created": created})
}
func (s *Server) listFindingRetestBatches(w http.ResponseWriter, r *http.Request) {
	pg := s.pg(w)
	if pg == nil {
		return
	}
	before, _ := strconv.ParseInt(r.URL.Query().Get("before"), 10, 64)
	items, err := pg.ListFindingRetestBatches(r.Context(), r.URL.Query().Get("task_id"), before)
	if err != nil {
		writeErr(w, 500, err.Error())
		return
	}
	writeJSON(w, 200, map[string]any{"batches": items, "concurrency": pg.RetestConcurrency()})
}
func (s *Server) retestBatch(w http.ResponseWriter, r *http.Request) (*db.FindingRetestBatch, bool) {
	if s.pg(w) == nil {
		return nil, false
	}
	id, ok := pathInt(r, "id")
	if !ok || id <= 0 {
		writeErr(w, 400, "invalid batch id")
		return nil, false
	}
	b, err := s.m.pg.GetFindingRetestBatch(r.Context(), id)
	if err != nil {
		writeErr(w, 500, err.Error())
		return nil, false
	}
	if b == nil {
		writeErr(w, 404, "复测批次不存在")
		return nil, false
	}
	return b, true
}
func (s *Server) getFindingRetestBatch(w http.ResponseWriter, r *http.Request) {
	b, ok := s.retestBatch(w, r)
	if ok {
		writeJSON(w, 200, b)
	}
}
func (s *Server) stopFindingRetestBatch(w http.ResponseWriter, r *http.Request) {
	b, ok := s.retestBatch(w, r)
	if !ok {
		return
	}
	s.retestMu.Lock()
	ids, err := s.m.pg.StopFindingRetestBatch(r.Context(), b.ID)
	if err == nil {
		for _, id := range ids {
			if cancel := s.retestActive[id]; cancel != nil {
				cancel(agent.AbortChatStoppedByUser)
			}
		}
	}
	s.retestMu.Unlock()
	if errors.Is(err, sql.ErrNoRows) {
		writeErr(w, 404, "复测批次不存在")
		return
	}
	if err != nil {
		writeErr(w, 500, err.Error())
		return
	}
	s.wakeFindingRetests()
	s.getFindingRetestBatch(w, r)
}
func (s *Server) retryFindingRetestBatch(w http.ResponseWriter, r *http.Request) {
	b, ok := s.retestBatch(w, r)
	if !ok {
		return
	}
	var req struct {
		Key   string `json:"request_key"`
		Scope string `json:"scope"`
	}
	if !decodeConversationRequest(w, r, &req) {
		return
	}
	if req.Scope != "failed" && req.Scope != "inconclusive" {
		writeErr(w, 400, "重试范围需为 failed 或 inconclusive")
		return
	}

	req.Key = strings.TrimSpace(req.Key)
	if req.Key == "" || len(req.Key) > 100 {
		writeErr(w, 400, "invalid request key")
		return
	}
	if !s.findingRetesterReady(w) {
		return
	}
	retried, created, err := s.m.pg.RetryFindingRetestBatch(r.Context(), b.ID, req.Key, req.Scope)
	if errors.Is(err, db.ErrRetestBatchKeyConflict) {
		writeErr(w, 409, err.Error())
		return
	}
	if errors.Is(err, db.ErrNoRetestCandidates) {
		writeErr(w, 400, err.Error())
		return
	}
	if err != nil {
		writeErr(w, 500, err.Error())
		return
	}
	s.wakeFindingRetests()
	code := 200
	if created {
		code = 202
	}
	writeJSON(w, code, map[string]any{"batch": retried, "created": created})

}
func (s *Server) findingRetestSettings(w http.ResponseWriter, r *http.Request) {
	pg := s.pg(w)
	if pg == nil {
		return
	}
	if r.Method == http.MethodPut {
		var req struct {
			Concurrency int `json:"concurrency"`
		}
		if !decodeConversationRequest(w, r, &req) {
			return
		}
		if req.Concurrency < 1 || req.Concurrency > 5 {
			writeErr(w, 400, "复测并发需为 1–5")
			return
		}
		if err := pg.SetSetting("finding_retest_concurrency", strconv.Itoa(req.Concurrency)); err != nil {
			writeErr(w, 500, err.Error())
			return
		}
		s.wakeFindingRetests()
	}
	writeJSON(w, 200, map[string]any{"concurrency": pg.RetestConcurrency()})
}
