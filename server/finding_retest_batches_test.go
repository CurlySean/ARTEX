package server

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/Autumn-27/artex/db"
	"github.com/Autumn-27/norma/llm"
)

func TestRetestBatchSharesCapacityWithSingleAndStops(t *testing.T) {
	s, fid := newRetestServer(t)
	var active, max atomic.Int32
	entered := make(chan struct{}, 10)
	setRetestProvider(s, retestProvider{complete: func(ctx context.Context, req llm.CompletionRequest) (llm.Message, string, llm.Usage, error) {
		n := active.Add(1)
		defer active.Add(-1)
		for {
			old := max.Load()
			if n <= old || max.CompareAndSwap(old, n) {
				break
			}
		}
		entered <- struct{}{}
		<-ctx.Done()
		return llm.Message{}, "", llm.Usage{}, ctx.Err()
	}})
	ids := []string{strconv.FormatInt(fid, 10)}
	for range 4 {
		id, err := s.m.pg.AddFinding(0, 0, "bulk-http-test", "batch", "high", "summary", "proof", "worker", nil)
		if err != nil {
			t.Fatal(err)
		}
		ids = append(ids, strconv.FormatInt(id, 10))
	}
	t.Cleanup(func() {
		s.retestMu.Lock()
		for _, cancel := range s.retestActive {
			cancel(nil)
		}
		s.retestMu.Unlock()
		waitRetestIdle(t, s)
		for _, str := range ids[1:] {
			id, _ := strconv.ParseInt(str, 10, 64)
			_, _ = s.m.pg.Exec(`DELETE FROM conversations WHERE id IN(SELECT conversation_id FROM finding_retests WHERE finding_id=$1)`, id)
			_, _ = s.m.pg.DeleteFinding(id)
		}
	})
	if w := retestRequest(s.startFindingRetest, "POST", fid, `{}`); w.Code != 202 {
		t.Fatal(w.Body)
	}
	payload, _ := json.Marshal(map[string]any{"ids": ids, "notes": "v2", "request_key": fmt.Sprintf("http-%d", time.Now().UnixNano())})
	w := retestRequest(s.createFindingRetestBatch, "POST", 0, string(payload))
	if w.Code != 202 {
		t.Fatal(w.Code, w.Body)
	}
	var response struct {
		Batch db.FindingRetestBatch `json:"batch"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &response); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _, _ = s.m.pg.Exec(`DELETE FROM finding_retest_batches WHERE id=$1`, response.Batch.ID) })
	for range 2 {
		select {
		case <-entered:
		case <-time.After(3 * time.Second):
			t.Fatal("two jobs did not start")
		}
	}
	select {
	case <-entered:
		t.Fatal("third job bypassed global cap")
	case <-time.After(150 * time.Millisecond):
	}
	b, err := s.m.pg.GetFindingRetestBatch(t.Context(), response.Batch.ID)
	if err != nil || b.Running != 1 || b.Pending != 3 || b.Skipped != 1 {
		t.Fatalf("batch %+v err %v", b, err)
	}
	dup := retestRequest(s.createFindingRetestBatch, "POST", 0, string(payload))
	if dup.Code != 200 {
		t.Fatal("replayed submit", dup.Body)
	}
	stopped := retestRequest(s.stopFindingRetestBatch, "POST", b.ID, `{}`)
	if stopped.Code != 200 {
		t.Fatal(stopped.Body)
	}
	b, err = s.m.pg.GetFindingRetestBatch(t.Context(), b.ID)
	if err != nil || b.Stopped != 4 || b.Skipped != 1 {
		t.Fatalf("stopped %+v %v", b, err)
	}
	single, _ := s.m.pg.ListFindingRetests(fid)
	if len(single) != 1 || single[0].Status != "running" {
		t.Fatal("stop touched skipped single", single)
	}
	if max.Load() != 2 {
		t.Fatalf("max=%d", max.Load())
	}
	// Stop the separately submitted run, including queued runs through chat controls.
	retestRequest(s.pgStopConversation, "POST", *single[0].ConversationID, `{}`)
	waitRetestIdle(t, s)
}

func TestRetestBatchInputValidation(t *testing.T) {
	s, _ := newRetestServer(t)
	for _, body := range []string{`{"ids":[],"request_key":"a"}`, `{"ids":["-1"],"request_key":"a"}`, `{"ids":["1"],"request_key":""}`, `{"ids":["1"],"request_key":"a","task_id":"invalid"}`} {
		w := retestRequest(s.createFindingRetestBatch, "POST", 0, body)
		if w.Code != 400 {
			t.Fatalf("%s: %d %s", body, w.Code, w.Body)
		}
	}
	for _, value := range []int{0, 6} {
		r := httptest.NewRequest(http.MethodPut, "/", strings.NewReader(fmt.Sprintf(`{"concurrency":%d}`, value)))
		w := httptest.NewRecorder()
		s.findingRetestSettings(w, r)
		if w.Code != 400 {
			t.Fatal(w.Code, w.Body)
		}
	}
}

func TestRetestBatchDrainsAfterFailureAndRetries(t *testing.T) {
	s, fid := newRetestServer(t)
	setRetestProvider(s, retestProvider{complete: func(context.Context, llm.CompletionRequest) (llm.Message, string, llm.Usage, error) {
		return llm.Message{Role: llm.RoleAssistant, Content: []llm.ContentBlock{llm.TextBlock("fixture deliberately omits a verdict")}}, "end_turn", llm.Usage{}, nil
	}})
	ids := []string{strconv.FormatInt(fid, 10)}
	for range 4 {
		id, err := s.m.pg.AddFinding(0, 0, "batch-drain-test", "drain", "high", "summary", "proof", "worker", nil)
		if err != nil {
			t.Fatal(err)
		}
		ids = append(ids, strconv.FormatInt(id, 10))
	}
	t.Cleanup(func() {
		for _, id := range ids {
			_, _ = s.m.pg.Exec(`DELETE FROM finding_retest_batches WHERE id IN(SELECT batch_id FROM finding_retest_batch_items WHERE finding_id=$1)`, id)
			_, _ = s.m.pg.Exec(`DELETE FROM conversations WHERE id IN(SELECT conversation_id FROM finding_retests WHERE finding_id=$1)`, id)
			fid, _ := strconv.ParseInt(id, 10, 64)
			_, _ = s.m.pg.DeleteFinding(fid)
		}
	})
	payload, _ := json.Marshal(map[string]any{"ids": ids, "request_key": fmt.Sprintf("drain-%d", time.Now().UnixNano())})
	w := retestRequest(s.createFindingRetestBatch, "POST", 0, string(payload))
	if w.Code != 202 {
		t.Fatal(w.Body)
	}
	var result struct {
		Batch db.FindingRetestBatch `json:"batch"`
	}
	_ = json.Unmarshal(w.Body.Bytes(), &result)
	waitRetestIdle(t, s)
	b, err := s.m.pg.GetFindingRetestBatch(t.Context(), result.Batch.ID)
	if err != nil || b.Failed != 5 || b.Pending+b.Running != 0 {
		t.Fatalf("failed batch did not drain %+v %v", b, err)
	}
	w = retestRequest(s.retryFindingRetestBatch, "POST", b.ID, fmt.Sprintf(`{"scope":"failed","request_key":"retry-drain-%d"}`, b.ID))
	if w.Code != 202 {
		t.Fatal(w.Body)
	}
	_ = json.Unmarshal(w.Body.Bytes(), &result)
	waitRetestIdle(t, s)
	b, err = s.m.pg.GetFindingRetestBatch(t.Context(), result.Batch.ID)
	if err != nil || b.Failed != 5 {
		t.Fatalf("retry did not drain %+v %v", b, err)
	}
}
