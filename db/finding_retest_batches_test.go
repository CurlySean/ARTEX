package db

import (
	"context"
	"fmt"
	"sync"
	"testing"
	"time"
)

func batchFixture(t *testing.T, count int) (*DB, []int64) {
	t.Helper()
	d, err := Open(testDSN(t))
	if err != nil {
		t.Fatal(err)
	}
	ids := make([]int64, count)
	for i := range ids {
		ids[i], err = d.AddFinding(0, 0, "bulk-retest-test", fmt.Sprintf("batch %d", i), "high", "summary", "proof", "worker", nil)
		if err != nil {
			t.Fatal(err)
		}
	}
	t.Cleanup(func() {
		for _, id := range ids {
			_, _ = d.Exec(`DELETE FROM finding_retest_batches WHERE id IN (SELECT batch_id FROM finding_retest_batch_items WHERE finding_id=$1)`, id)
			_, _ = d.Exec(`DELETE FROM conversations WHERE id IN (SELECT conversation_id FROM finding_retests WHERE finding_id=$1)`, id)
			_, _ = d.DeleteFinding(id)
		}
		d.Close()
	})
	return d, ids
}
func TestRetestBatchDedupStopAndHistory(t *testing.T) {
	d, ids := batchFixture(t, 3)
	ctx := context.Background()
	existing, _, _, err := d.CreateFindingRetest(ctx, ids[0], "")
	if err != nil {
		t.Fatal(err)
	}
	key := fmt.Sprintf("batch-%d", time.Now().UnixNano())
	b, created, err := d.CreateFindingRetestBatch(ctx, key, ids, "v2", "")
	if err != nil || !created {
		t.Fatalf("create %v %v", created, err)
	}
	if b.Total != 3 || b.Pending != 2 || b.Skipped != 1 {
		t.Fatalf("counts %+v", b)
	}
	replay, created, err := d.CreateFindingRetestBatch(ctx, key, ids, "v2", "")
	if err != nil || created || replay.ID != b.ID {
		t.Fatalf("idempotency %v %v", created, err)
	}
	if _, _, err = d.CreateFindingRetestBatch(ctx, key, ids, "changed", ""); err == nil {
		t.Fatal("reused key accepted different request")
	}
	if _, err = d.StopFindingRetestBatch(ctx, b.ID); err != nil {
		t.Fatal(err)
	}
	b, err = d.GetFindingRetestBatch(ctx, b.ID)
	if err != nil || b.Stopped != 2 || b.Skipped != 1 {
		t.Fatalf("stop %+v %v", b, err)
	}
	live, err := d.FindingRetestForConversation(ctx, *existing.ConversationID)
	if err != nil || live.Status != "pending" {
		t.Fatal("stopped unrelated existing retest", err)
	}
	if _, err = d.DeleteFinding(ids[1]); err != nil {
		t.Fatal(err)
	}
	b, err = d.GetFindingRetestBatch(ctx, b.ID)
	if err != nil || b.Total != 3 || b.Stopped != 2 {
		t.Fatalf("deletion lost history %+v %v", b, err)
	}
}
func TestRetestQueueCapAndRecovery(t *testing.T) {
	d, ids := batchFixture(t, 5)
	ctx := context.Background()
	// Ensure no stale active fixture from another test influences this global queue.
	if err := d.RecoverFindingRetests(); err != nil {
		t.Fatal(err)
	}
	b, _, err := d.CreateFindingRetestBatch(ctx, fmt.Sprintf("queue-%d", time.Now().UnixNano()), ids, "", "")
	if err != nil {
		t.Fatal(err)
	}
	var wg sync.WaitGroup
	var mu sync.Mutex
	claims := []*FindingRetest{}
	for range 8 {
		wg.Go(func() {
			r, err := d.ClaimFindingRetest(ctx, 2)
			if err != nil {
				t.Error(err)
			}
			if r != nil {
				mu.Lock()
				claims = append(claims, r)
				mu.Unlock()
			}
		})
	}
	wg.Wait()
	if len(claims) != 2 {
		t.Fatalf("claimed %d, want 2", len(claims))
	}
	if err = d.RecoverFindingRetests(); err != nil {
		t.Fatal(err)
	}
	b, err = d.GetFindingRetestBatch(ctx, b.ID)
	if err != nil || b.Pending != 3 || b.Stopped != 2 {
		t.Fatalf("recovery %+v %v", b, err)
	}
	if r, err := d.ClaimFindingRetest(ctx, 2); err != nil || r == nil {
		t.Fatal("queue did not resume", err)
	}
}

func TestRetestRetryFreezesMembershipAcrossReplay(t *testing.T) {
	d, ids := batchFixture(t, 2)
	ctx := t.Context()
	b, _, err := d.CreateFindingRetestBatch(ctx, fmt.Sprintf("source-%d", time.Now().UnixNano()), ids, "v2", "")
	if err != nil {
		t.Fatal(err)
	}
	if err = d.FinishFindingRetest(*b.Items[0].RetestID, "failed", "fixture failure"); err != nil {
		t.Fatal(err)
	}
	key := fmt.Sprintf("retry-%d", time.Now().UnixNano())
	retried, created, err := d.RetryFindingRetestBatch(ctx, b.ID, key, "failed")
	if err != nil || !created || retried.Total != 1 {
		t.Fatalf("retry %+v %v %v", retried, created, err)
	}
	if err = d.FinishFindingRetest(*b.Items[1].RetestID, "failed", "later failure"); err != nil {
		t.Fatal(err)
	}
	replay, created, err := d.RetryFindingRetestBatch(ctx, b.ID, key, "failed")
	if err != nil || created || replay.ID != retried.ID || replay.Total != 1 {
		t.Fatalf("replay %+v %v %v", replay, created, err)
	}
}

func TestRetestBatchTaskScopeAndCandidateFilter(t *testing.T) {
	d, ids := batchFixture(t, 2)
	b, _, err := d.CreateFindingRetestBatch(t.Context(), fmt.Sprintf("scope-%d", time.Now().UnixNano()), ids, "", "99999999")
	if err != nil || b.Skipped != 2 || b.Pending != 0 {
		t.Fatalf("cross-task submission %+v %v", b, err)
	}
	filtered, err := d.FindingRetestCandidates(t.Context(), FindingFilter{TaskID: "99999999"})
	if err != nil || len(filtered) != 0 {
		t.Fatalf("task filter widened %v %v", filtered, err)
	}
	for _, id := range ids {
		rows, err := d.ListFindingRetests(id)
		if err != nil || len(rows) != 0 {
			t.Fatal("read-only finding created retest", err)
		}
	}
}
