package server

import (
	"database/sql"
	"errors"
	"net/http"
	"strconv"
	"strings"

	"github.com/Autumn-27/artex/db"
	"github.com/Autumn-27/artex/report"
)

func (s *Server) registerReportTemplates(mux *http.ServeMux) {
	mux.HandleFunc("GET /api/report-templates", s.listReportTemplates)
	mux.HandleFunc("POST /api/report-templates", s.saveReportTemplate)
	mux.HandleFunc("PUT /api/report-templates/{id}", s.saveReportTemplate)
	mux.HandleFunc("POST /api/report-templates/preview", s.previewReportTemplate)
	mux.HandleFunc("PUT /api/report-templates/{id}/default", s.setDefaultReportTemplate)
	mux.HandleFunc("DELETE /api/report-templates/{id}", s.deleteReportTemplate)
}

func writeReportTemplateError(w http.ResponseWriter, err error) {
	if errors.Is(err, db.ErrReportTemplateNotFound) {
		writeErr(w, 404, "报告模板不存在")
		return
	}
	writeErr(w, 500, err.Error())
}

func (s *Server) listReportTemplates(w http.ResponseWriter, r *http.Request) {
	pg := s.pg(w)
	if pg == nil {
		return
	}
	items, err := pg.ListReportTemplates()
	if err != nil {
		writeReportTemplateError(w, err)
		return
	}
	writeJSON(w, 200, map[string]any{"templates": items, "starter": report.StarterTemplate})
}

type reportTemplateRequest struct {
	Name string `json:"name"`
	Body string `json:"body"`
	Kind string `json:"kind"`
}

func readReportTemplate(w http.ResponseWriter, r *http.Request) (reportTemplateRequest, *report.Renderer, bool) {
	var req reportTemplateRequest
	r.Body = http.MaxBytesReader(w, r.Body, 512<<10)
	if err := decode(r, &req); err != nil {
		writeErr(w, 400, err.Error())
		return req, nil, false
	}
	if strings.TrimSpace(req.Body) == "" {
		writeErr(w, 400, "模板正文不能为空")
		return req, nil, false
	}
	renderer, err := report.CompileTemplate(req.Body)
	if err != nil {
		writeErr(w, 400, err.Error())
		return req, nil, false
	}
	return req, renderer, true
}

func (s *Server) previewReportTemplate(w http.ResponseWriter, r *http.Request) {
	req, renderer, ok := readReportTemplate(w, r)
	if !ok {
		return
	}
	if req.Kind == "" {
		req.Kind = "findings"
	}
	md, err := renderer.PreviewKind(req.Kind)
	if err != nil {
		writeErr(w, 400, err.Error())
		return
	}
	writeJSON(w, 200, map[string]string{"markdown": md})
}

func (s *Server) saveReportTemplate(w http.ResponseWriter, r *http.Request) {
	pg := s.pg(w)
	if pg == nil {
		return
	}
	var id int64
	if r.Method == http.MethodPut {
		n, ok := pathInt(r, "id")
		if !ok || n <= 0 {
			writeErr(w, 400, "模板 ID 无效")
			return
		}
		id = n
	}
	req, renderer, ok := readReportTemplate(w, r)
	if !ok {
		return
	}
	name := strings.TrimSpace(req.Name)
	if name == "" || len([]rune(name)) > 128 {
		writeErr(w, 400, "模板名称应为 1 至 128 个字符")
		return
	}
	for _, kind := range []string{"task", "findings", "single"} {
		if _, err := renderer.PreviewKind(kind); err != nil {
			writeErr(w, 400, err.Error())
			return
		}
	}
	saved, err := pg.SaveReportTemplate(id, name, req.Body)
	if err != nil {
		writeReportTemplateError(w, err)
		return
	}
	status := http.StatusOK
	if id == 0 {
		status = http.StatusCreated
	}
	writeJSON(w, status, map[string]int64{"id": saved})
}

func (s *Server) setDefaultReportTemplate(w http.ResponseWriter, r *http.Request) {
	pg := s.pg(w)
	if pg == nil {
		return
	}
	id, ok := pathInt(r, "id")
	if !ok || id < 0 {
		writeErr(w, 400, "模板 ID 无效")
		return
	}
	if err := pg.DefaultReportTemplate(id); err != nil {
		writeReportTemplateError(w, err)
		return
	}
	writeJSON(w, 200, map[string]bool{"ok": true})
}

func (s *Server) deleteReportTemplate(w http.ResponseWriter, r *http.Request) {
	pg := s.pg(w)
	if pg == nil {
		return
	}
	id, ok := pathInt(r, "id")
	if !ok || id <= 0 {
		writeErr(w, 400, "模板 ID 无效")
		return
	}
	if err := pg.DeleteReportTemplate(id); err != nil {
		writeReportTemplateError(w, err)
		return
	}
	writeJSON(w, 200, map[string]bool{"ok": true})
}

// Auto selection follows the task snapshot only when the export belongs to
// one task. Detached or mixed findings use the current global default.
func exportTaskID(fs []*db.DBFinding, filter db.FindingFilter) int64 {
	if len(fs) == 0 {
		id, _ := strconv.ParseInt(filter.TaskID, 10, 64)
		return id
	}
	if fs[0].TaskID == nil {
		return 0
	}
	id := *fs[0].TaskID
	for _, f := range fs[1:] {
		if f.TaskID == nil || *f.TaskID != id {
			return 0
		}
	}
	return id
}

func (s *Server) exportReportRenderer(w http.ResponseWriter, r *http.Request, fs []*db.DBFinding, filter db.FindingFilter) (*report.Renderer, bool) {
	var body string
	var err error
	if q := r.URL.Query(); q.Has("report_template_id") {
		id, e := strconv.ParseInt(q.Get("report_template_id"), 10, 64)
		if e != nil || id < 0 {
			writeErr(w, 400, "模板 ID 无效")
			return nil, false
		}
		body, err = s.m.pg.ResolveReportTemplate(&id)
	} else if id := exportTaskID(fs, filter); id > 0 {
		body, err = s.m.pg.TaskReportTemplate(id)
		// An empty filter result can refer to a task that has since been removed.
		if errors.Is(err, sql.ErrNoRows) {
			body, err = s.m.pg.ResolveReportTemplate(nil)
		}
	} else {
		body, err = s.m.pg.ResolveReportTemplate(nil)
	}
	if err != nil {
		writeReportTemplateError(w, err)
		return nil, false
	}
	renderer, err := report.CompileTemplate(body)
	if err != nil {
		writeReportTemplateError(w, err)
		return nil, false
	}
	return renderer, true
}
