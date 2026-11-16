package db

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"slices"
	"strconv"
	"strings"
	"time"
)

const MaxRetestBatchSize = 500

var ErrRetestBatchKeyConflict = errors.New("提交标识已用于不同的复测请求，请重新打开弹窗")

type FindingRetestBatch struct {
	ID           int64                    `json:"id"`
	Notes        string                   `json:"notes"`
	TaskID       string                   `json:"task_id"`
	CreatedAt    time.Time                `json:"created_at"`
	StoppedAt    *time.Time               `json:"stopped_at"`
	Total        int                      `json:"total"`
	Pending      int                      `json:"pending"`
	Running      int                      `json:"running"`
	Completed    int                      `json:"completed"`
	Failed       int                      `json:"failed"`
	Stopped      int                      `json:"stopped"`
	Skipped      int                      `json:"skipped"`
	Reproduced   int                      `json:"reproduced"`
	Fixed        int                      `json:"fixed"`
	Inconclusive int                      `json:"inconclusive"`
	Items        []FindingRetestBatchItem `json:"items,omitempty"`
}
type FindingRetestBatchItem struct {
	FindingID      int64  `json:"finding_id,string"`
	Title          string `json:"title"`
	RetestID       *int64 `json:"retest_id"`
	ConversationID *int64 `json:"conversation_id"`
	Status         string `json:"status"`
	Verdict        string `json:"verdict"`
	Summary        string `json:"summary"`
	Error          string `json:"error"`
}

// All IDs are frozen before the transaction; sorted finding locks avoid deadlocks
// between overlapping batches, individual creates and terminal-state writes.
func (d *DB) CreateFindingRetestBatch(ctx context.Context, key string, ids []int64, notes, taskID string) (*FindingRetestBatch, bool, error) {
	return d.createFindingRetestBatch(ctx, key, ids, notes, taskID, "")
}
func (d *DB) createFindingRetestBatch(ctx context.Context, key string, ids []int64, notes, taskID, identity string) (*FindingRetestBatch, bool, error) {
	key, notes = strings.TrimSpace(key), strings.TrimSpace(notes)
	ids = slices.Clone(ids)
	slices.Sort(ids)
	ids = slices.Compact(ids)
	if key == "" || len(key) > 100 || len(ids) > MaxRetestBatchSize {
		return nil, false, errors.New("提交标识不能为空，批量复测需选择 1–500 个漏洞")
	}
	for _, id := range ids {
		if id <= 0 {
			return nil, false, errors.New("invalid finding id")
		}
	}
	payload, _ := json.Marshal([]any{ids, notes, taskID})
	if identity != "" {
		payload = []byte(identity)
	}
	hash := fmt.Sprintf("%x", sha256.Sum256(payload))
	tx, err := d.BeginTx(ctx, nil)
	if err != nil {
		return nil, false, err
	}
	defer tx.Rollback()
	var bid int64
	err = tx.QueryRowContext(ctx, `INSERT INTO finding_retest_batches(request_key,request_hash,notes,task_id) VALUES($1,$2,$3,$4) ON CONFLICT(request_key) DO NOTHING RETURNING id`, key, hash, notes, taskID).Scan(&bid)
	if errors.Is(err, sql.ErrNoRows) {
		var previous string
		if err = tx.QueryRowContext(ctx, `SELECT id,request_hash FROM finding_retest_batches WHERE request_key=$1`, key).Scan(&bid, &previous); err != nil {
			return nil, false, err
		}
		if hash != previous {
			return nil, false, ErrRetestBatchKeyConflict
		}
		if err = tx.Commit(); err != nil {
			return nil, false, err
		}
		b, err := d.GetFindingRetestBatch(ctx, bid)
		return b, false, err
	}
	if err != nil {
		return nil, false, err
	}
	if len(ids) == 0 {
		return nil, false, ErrNoRetestCandidates
	}
	for _, fid := range ids {
		var title, owner string
		var rid *int64
		skip := ""
		err = tx.QueryRowContext(ctx, `SELECT COALESCE(NULLIF(name,''),NULLIF(vulnclass,''),'未分类'),COALESCE(task_id::text,'') FROM findings WHERE id=$1 FOR UPDATE`, fid).Scan(&title, &owner)
		if errors.Is(err, sql.ErrNoRows) {
			skip = "漏洞已删除或不存在"
		} else if err != nil {
			return nil, false, err
		} else if taskID != "" && owner != taskID {
			skip = "不属于当前任务，继承漏洞请从来源任务发起"
		} else {
			r, _, created, e := createFindingRetestTx(ctx, tx, fid, notes)
			if e != nil {
				return nil, false, e
			}
			rid = &r.ID
			if !created {
				skip = "该漏洞已排队或正在复测"
			}
		}
		if _, err = tx.ExecContext(ctx, `INSERT INTO finding_retest_batch_items(batch_id,finding_id,title,retest_id,skip_reason) VALUES($1,$2,$3,$4,$5)`, bid, fid, title, rid, skip); err != nil {
			return nil, false, err
		}
	}
	if err = tx.Commit(); err != nil {
		return nil, false, err
	}
	b, err := d.GetFindingRetestBatch(ctx, bid)
	return b, true, err
}

const batchCounts = `SELECT b.id,b.notes,b.task_id,b.created_at,b.stopped_at,
 count(i.finding_id),
 count(*) FILTER(WHERE i.skip_reason='' AND r.status='pending'),
 count(*) FILTER(WHERE i.skip_reason='' AND r.status='running'),
 count(*) FILTER(WHERE i.skip_reason='' AND r.status='completed'),
 count(*) FILTER(WHERE i.skip_reason='' AND r.status='failed'),
 count(*) FILTER(WHERE i.skip_reason='' AND (r.status='stopped' OR r.id IS NULL)),
 count(*) FILTER(WHERE i.skip_reason<>''),
 count(*) FILTER(WHERE i.skip_reason='' AND r.status='completed' AND r.verdict='reproduced'),
 count(*) FILTER(WHERE i.skip_reason='' AND r.status='completed' AND r.verdict='fixed'),
 count(*) FILTER(WHERE i.skip_reason='' AND r.status='completed' AND r.verdict='inconclusive')
 FROM finding_retest_batches b JOIN finding_retest_batch_items i ON i.batch_id=b.id
 LEFT JOIN finding_retests r ON r.id=i.retest_id `

func scanBatch(row interface{ Scan(...any) error }) (*FindingRetestBatch, error) {
	b := &FindingRetestBatch{}
	err := row.Scan(&b.ID, &b.Notes, &b.TaskID, &b.CreatedAt, &b.StoppedAt, &b.Total, &b.Pending, &b.Running, &b.Completed, &b.Failed, &b.Stopped, &b.Skipped, &b.Reproduced, &b.Fixed, &b.Inconclusive)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	return b, err
}
func (d *DB) ListFindingRetestBatches(ctx context.Context, taskID string, before int64) ([]*FindingRetestBatch, error) {
	rows, err := d.QueryContext(ctx, batchCounts+` WHERE ($1='' OR b.task_id=$1 OR EXISTS(SELECT 1 FROM finding_retest_batch_items bi JOIN findings f ON f.id=bi.finding_id WHERE bi.batch_id=b.id AND f.task_id::text=$1)) AND ($2::bigint=0 OR b.id<$2) GROUP BY b.id ORDER BY b.id DESC LIMIT 30`, taskID, before)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []*FindingRetestBatch{}
	for rows.Next() {
		b, e := scanBatch(rows)
		if e != nil {
			return nil, e
		}
		out = append(out, b)
	}
	return out, rows.Err()
}
func (d *DB) GetFindingRetestBatch(ctx context.Context, id int64) (*FindingRetestBatch, error) {
	b, err := scanBatch(d.QueryRowContext(ctx, batchCounts+` WHERE b.id=$1 GROUP BY b.id`, id))
	if err != nil || b == nil {
		return b, err
	}
	rows, err := d.QueryContext(ctx, `SELECT i.finding_id,i.title,i.retest_id,r.conversation_id,
 CASE WHEN i.skip_reason<>'' THEN 'skipped' ELSE COALESCE(r.status,'stopped') END,
 CASE WHEN i.skip_reason='' AND r.status='completed' THEN r.verdict ELSE '' END,
 COALESCE(r.summary,''),CASE WHEN i.skip_reason<>'' THEN i.skip_reason WHEN r.id IS NULL THEN '漏洞或复测记录已删除' ELSE r.error END
 FROM finding_retest_batch_items i LEFT JOIN finding_retests r ON r.id=i.retest_id WHERE i.batch_id=$1 ORDER BY i.finding_id`, id)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	b.Items = []FindingRetestBatchItem{}
	for rows.Next() {
		var i FindingRetestBatchItem
		if err = rows.Scan(&i.FindingID, &i.Title, &i.RetestID, &i.ConversationID, &i.Status, &i.Verdict, &i.Summary, &i.Error); err != nil {
			return nil, err
		}
		b.Items = append(b.Items, i)
	}
	return b, rows.Err()
}

// The transaction lock serializes capacity decisions, including across callers.
// A claim is durable before cancellation registration / goroutine startup.
func (d *DB) ClaimFindingRetest(ctx context.Context, limit int) (*FindingRetest, error) {
	if limit < 1 || limit > 5 {
		return nil, errors.New("复测并发需为 1–5")
	}
	tx, err := d.BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	if _, err = tx.ExecContext(ctx, `SELECT pg_advisory_xact_lock(89415126)`); err != nil {
		return nil, err
	}
	var n int
	if err = tx.QueryRowContext(ctx, `SELECT count(*) FROM finding_retests WHERE status='running' OR (status='pending' AND claimed_at IS NOT NULL)`).Scan(&n); err != nil {
		return nil, err
	}
	if n >= limit {
		return nil, nil
	}
	r, err := scanRetest(tx.QueryRowContext(ctx, `UPDATE finding_retests SET claimed_at=now() WHERE id=(SELECT id FROM finding_retests WHERE status='pending' AND claimed_at IS NULL AND conversation_id IS NOT NULL ORDER BY id FOR UPDATE SKIP LOCKED LIMIT 1) RETURNING `+retestCols))
	if err != nil || r == nil {
		return r, err
	}
	if err = tx.Commit(); err != nil {
		return nil, err
	}
	return r, nil
}

// Seal atomically before cancelling goroutines so a concurrent completion cannot
// turn a stopped finding into fixed. Skipped items never own their linked run.
func (d *DB) StopFindingRetestBatch(ctx context.Context, id int64) ([]int64, error) {
	tx, err := d.BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	res, err := tx.ExecContext(ctx, `UPDATE finding_retest_batches SET stopped_at=COALESCE(stopped_at,now()) WHERE id=$1`, id)
	if err != nil {
		return nil, err
	}
	n, err := res.RowsAffected()
	if err != nil {
		return nil, err
	}
	if n == 0 {
		return nil, sql.ErrNoRows
	}
	// Match the finding -> retest lock ordering used by completion and deletion.
	locked, err := tx.QueryContext(ctx, `SELECT f.id FROM findings f JOIN finding_retest_batch_items i ON i.finding_id=f.id WHERE i.batch_id=$1 AND i.skip_reason='' ORDER BY f.id FOR UPDATE OF f`, id)
	if err != nil {
		return nil, err
	}
	for locked.Next() {
	}
	err = locked.Err()
	locked.Close()
	if err != nil {
		return nil, err
	}
	rows, err := tx.QueryContext(ctx, `UPDATE finding_retests r SET status='stopped',error='批次已停止',finished_at=now() FROM finding_retest_batch_items i WHERE i.batch_id=$1 AND i.skip_reason='' AND i.retest_id=r.id AND r.status IN ('pending','running') RETURNING r.conversation_id`, id)
	if err != nil {
		return nil, err
	}
	convIDs := []int64{}
	for rows.Next() {
		var cid *int64
		if err = rows.Scan(&cid); err != nil {
			rows.Close()
			return nil, err
		}
		if cid != nil {
			convIDs = append(convIDs, *cid)
		}
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return nil, err
	}
	if err = tx.Commit(); err != nil {
		return nil, err
	}
	return convIDs, nil
}

func (d *DB) RetestConcurrency() int {
	v, ok, err := d.GetSetting("finding_retest_concurrency")
	if err == nil && ok {
		n, e := strconv.Atoi(v)
		if e == nil && n >= 1 && n <= 5 {
			return n
		}
	}
	return 2
}

func (d *DB) FindingRetestCandidates(ctx context.Context, f FindingFilter) ([]string, error) {
	scoped, err := d.applyAssetScope(f)
	if err != nil {
		return nil, err
	}
	where, args := scoped.where()
	rows, err := d.QueryContext(ctx, `SELECT f.id::text FROM findings f LEFT JOIN tasks t ON t.id=f.task_id`+where+` ORDER BY f.id LIMIT 501`, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	ids := []string{}
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		ids = append(ids, id)
	}
	return ids, rows.Err()
}

var ErrNoRetestCandidates = errors.New("没有符合条件的复测条目")

func (d *DB) RetryFindingRetestBatch(ctx context.Context, sourceID int64, key, scope string) (*FindingRetestBatch, bool, error) {
	if scope != "failed" && scope != "inconclusive" {
		return nil, false, errors.New("invalid retry scope")
	}
	b, err := d.GetFindingRetestBatch(ctx, sourceID)
	if err != nil {
		return nil, false, err
	}
	if b == nil {
		return nil, false, sql.ErrNoRows
	}
	ids := []int64{}
	for _, i := range b.Items {
		if (scope == "failed" && (i.Status == "failed" || i.Status == "stopped")) || (scope == "inconclusive" && i.Status == "completed" && i.Verdict == "inconclusive") {
			ids = append(ids, i.FindingID)
		}
	}
	return d.createFindingRetestBatch(ctx, key, ids, b.Notes, b.TaskID, fmt.Sprintf("retest-retry:%d:%s", sourceID, scope))
}
