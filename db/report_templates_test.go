package db

import (
	"encoding/json"
	"errors"
	"sync"
	"testing"
)

// Uses the suite fixture; test execution must point ARTEX_PG_DSN at a disposable database.
func reportTemplateTestDB(t *testing.T) *DB {
	t.Helper()
	d, err := Open(testDSN(t))
	if err != nil {
		t.Skipf("postgres unavailable: %v", err)
	}
	t.Cleanup(func() { d.Close() })
	templates, err := d.ListReportTemplates()
	if err != nil {
		t.Fatal(err)
	}
	var previous int64
	for _, v := range templates {
		if v.IsDefault {
			previous = v.ID
		}
	}
	t.Cleanup(func() {
		if err := d.DefaultReportTemplate(previous); err != nil {
			t.Error(err)
		}
	})
	return d
}

func cleanupReportTemplate(t *testing.T, d *DB, id int64) {
	t.Helper()
	t.Cleanup(func() {
		err := d.DeleteReportTemplate(id)
		if err != nil && !errors.Is(err, ErrReportTemplateNotFound) {
			t.Error(err)
		}
	})
}

func cleanupReportTask(t *testing.T, d *DB, id int64) {
	t.Helper()
	t.Cleanup(func() {
		if err := d.DeleteTask(id); err != nil {
			t.Error(err)
		}
	})
}

func TestReportTemplatesSnapshotAndDefault(t *testing.T) {
	d := reportTemplateTestDB(t)
	id, err := d.SaveReportTemplate(0, "report", "original")
	if err != nil {
		t.Fatal(err)
	}
	cleanupReportTemplate(t, d, id)
	if err = d.DefaultReportTemplate(id); err != nil {
		t.Fatal(err)
	}
	if body, err := d.ResolveReportTemplate(nil); err != nil || body != "original" {
		t.Fatalf("default %q %v", body, err)
	}
	zero := int64(0)
	if body, err := d.ResolveReportTemplate(&zero); err != nil || body != "" {
		t.Fatalf("builtin %q %v", body, err)
	}
	task, err := d.CreateTaskWithOptions("report test", "goal", TaskCreateOptions{})
	if err != nil {
		t.Fatal(err)
	}
	cleanupReportTask(t, d, task.ID)
	if _, err = d.SaveReportTemplate(id, "renamed", "edited"); err != nil {
		t.Fatal(err)
	}
	if err = d.DeleteReportTemplate(id); err != nil {
		t.Fatal(err)
	}
	if body, err := d.TaskReportTemplate(task.ID); err != nil || body != "original" {
		t.Fatalf("snapshot %q %v", body, err)
	}
	if body, err := d.ResolveReportTemplate(nil); err != nil || body != "" {
		t.Fatalf("deleted default %q %v", body, err)
	}
	if _, err = d.ResolveReportTemplate(&id); !errors.Is(err, ErrReportTemplateNotFound) {
		t.Fatalf("missing %v", err)
	}
	if _, err = d.SaveReportTemplate(id, "missing", "body"); !errors.Is(err, ErrReportTemplateNotFound) {
		t.Fatalf("update missing %v", err)
	}
	if err = d.DefaultReportTemplate(id); !errors.Is(err, ErrReportTemplateNotFound) {
		t.Fatalf("default missing %v", err)
	}
	if _, err = d.CreateTaskWithOptions("invalid report", "goal", TaskCreateOptions{ReportTemplateID: &id}); !errors.Is(err, ErrReportTemplateNotFound) {
		t.Fatalf("create missing %v", err)
	}
	historical, err := d.CreateTaskWithOptions("builtin", "goal", TaskCreateOptions{ReportTemplateID: &zero})
	if err != nil {
		t.Fatal(err)
	}
	cleanupReportTask(t, d, historical.ID)
	if body, err := d.TaskReportTemplate(historical.ID); err != nil || body != "" {
		t.Fatalf("builtin task %q %v", body, err)
	}
}

func TestReportTemplatesConcurrentDefault(t *testing.T) {
	d := reportTemplateTestDB(t)
	a, err := d.SaveReportTemplate(0, "a", "a")
	if err != nil {
		t.Fatal(err)
	}
	b, err := d.SaveReportTemplate(0, "b", "b")
	if err != nil {
		t.Fatal(err)
	}
	cleanupReportTemplate(t, d, a)
	cleanupReportTemplate(t, d, b)
	var wg sync.WaitGroup
	for i := 0; i < 20; i++ {
		wg.Add(1)
		go func(id int64) {
			defer wg.Done()
			if err := d.DefaultReportTemplate(id); err != nil {
				t.Error(err)
			}
		}([]int64{a, b}[i%2])
	}
	wg.Wait()
	templates, err := d.ListReportTemplates()
	if err != nil {
		t.Fatal(err)
	}
	count := 0
	for _, v := range templates {
		if v.IsDefault {
			count++
		}
	}
	if count != 1 {
		t.Fatalf("default count %d", count)
	}
	if err := d.DefaultReportTemplate(0); err != nil {
		t.Fatal(err)
	}
}

func TestReportTemplateArchiveRestore(t *testing.T) {
	d := reportTemplateTestDB(t)
	id, err := d.SaveReportTemplate(0, "archive", "archived body")
	if err != nil {
		t.Fatal(err)
	}
	task, err := d.CreateTaskWithOptions("archive", "goal", TaskCreateOptions{ReportTemplateID: &id})
	if err != nil {
		t.Fatal(err)
	}
	cleanupReportTemplate(t, d, id)
	cleanupReportTask(t, d, task.ID)
	raw, _, err := queryArchiveRows(d, `SELECT * FROM tasks WHERE id=$1`, task.ID)
	if err != nil {
		t.Fatal(err)
	}
	var rows []map[string]any
	if err := json.Unmarshal(raw, &rows); err != nil {
		t.Fatal(err)
	}
	if rows[0]["report_template_body"] != "archived body" {
		t.Fatalf("missing snapshot: %v", rows[0])
	}
	tx, err := d.Begin()
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback()
	if _, err := tx.Exec(`UPDATE tasks SET report_template_body='' WHERE id=$1`, task.ID); err != nil {
		t.Fatal(err)
	}
	if err := restoreTaskStub(tx, rows[0], task.ID, 0); err != nil {
		t.Fatal(err)
	}
	var body string
	if err := tx.QueryRow(`SELECT report_template_body FROM tasks WHERE id=$1`, task.ID).Scan(&body); err != nil || body != "archived body" {
		t.Fatalf("restore %q %v", body, err)
	}
	delete(rows[0], "report_template_body")
	if err := restoreTaskStub(tx, rows[0], task.ID, 0); err != nil {
		t.Fatal(err)
	}
	if err := tx.QueryRow(`SELECT report_template_body FROM tasks WHERE id=$1`, task.ID).Scan(&body); err != nil || body != "" {
		t.Fatalf("old restore %q %v", body, err)
	}
}
