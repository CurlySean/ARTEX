package server

import (
	"archive/zip"
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"

	"github.com/Autumn-27/artex/db"
)

func TestReportTemplateWorkflow(t *testing.T) {
	s, first, request := trafficEvidenceServer(t)
	call := func(method, path, body string, status int) *httptest.ResponseRecorder {
		t.Helper()
		w := request(method, path, body)
		if w.Code != status {
			t.Fatalf("%s %s: status %d: %s", method, path, w.Code, w.Body)
		}
		return w
	}
	const base = "/api/report-templates"
	call("POST", base, `{"name":"bad","body":"{{.UnknownField}}"}`, 400)
	const draft = `{"name":"客户报告","body":"客户版 {{.Kind}} {{.Title}} {{range .Findings}}{{.Name}}{{end}}"}`
	preview := call("POST", base+"/preview", draft, 200)
	if !strings.Contains(preview.Body.String(), "客户版") {
		t.Fatal(preview.Body)
	}
	var created struct{ ID int64 }
	if err := json.Unmarshal(call("POST", base, draft, 201).Body.Bytes(), &created); err != nil {
		t.Fatal(err)
	}
	path := fmt.Sprintf("%s/%d", base, created.ID)
	t.Cleanup(func() { s.m.pg.DeleteReportTemplate(created.ID) })
	var previous int64
	templates, err := s.m.pg.ListReportTemplates()
	if err != nil {
		t.Fatal(err)
	}
	for _, item := range templates {
		if item.IsDefault {
			previous = item.ID
		}
	}
	t.Cleanup(func() {
		if err := s.m.pg.DefaultReportTemplate(previous); err != nil {
			t.Error(err)
		}
	})
	checkList := func(defaultID int64) db.ReportTemplate {
		t.Helper()
		var list struct{ Templates []db.ReportTemplate }
		if err := json.Unmarshal(call("GET", base, "", 200).Body.Bytes(), &list); err != nil {
			t.Fatal(err)
		}
		defaults, originals := 0, 0
		var original db.ReportTemplate
		for _, item := range list.Templates {
			if item.ID == 0 {
				originals++
				original = item
			}
			if item.IsDefault {
				defaults++
				if item.ID != defaultID {
					t.Fatalf("unexpected default %d", item.ID)
				}
			}
		}
		if originals != 1 || defaults != 1 || original.Body == "" {
			t.Fatalf("originals=%d defaults=%d", originals, defaults)
		}
		return original
	}
	call("PUT", base+"/0/default", "", 200)
	original := checkList(0)
	restore, _ := json.Marshal(original)
	defer call("PUT", base+"/0", string(restore), 200)
	call("PUT", base+"/0", `{"name":"原版编辑","body":"edited {{.Kind}}"}`, 200)
	if got := checkList(0); got.Body != "edited {{.Kind}}" || got.Name != "原版编辑" {
		t.Fatal(got)
	}
	if got, err := s.m.pg.ResolveReportTemplate(nil); err != nil || got != "edited {{.Kind}}" {
		t.Fatal(got, err)
	}
	call("PUT", base+"/0", string(restore), 200)
	var task TaskDTO
	if err := json.Unmarshal(call("POST", "/api/tasks", fmt.Sprintf(`{"name":"模板验收","description":"测试描述","goal":"验证快照","report_template_id":%d}`, created.ID), 201).Body.Bytes(), &task); err != nil {
		t.Fatal(err)
	}
	id, err := strconv.ParseInt(task.ID, 10, 64)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { s.m.pg.DeleteTask(id) })
	pt, err := s.m.pg.GetTask(id)
	if err != nil {
		t.Fatal(err)
	}
	finding, err := s.evidenceStore().Record(t.Context(), db.RecordFindingInput{TaskID: id, ExplorationID: pt.ExplorationID, Name: "漏洞A", Summary: "测试", Severity: "high"}, nil)
	if err != nil {
		t.Fatal(err)
	}
	call("PUT", path+"/default", "", 200)
	checkList(created.ID)
	call("PUT", path, `{"name":"新报告","body":"新版 {{.Kind}}"}`, 200)
	const export = "/api/exploration/findings/export?scope=selected&ids="
	single := fmt.Sprintf("%s%d", export, finding.FindingID)
	mixed := fmt.Sprintf("%s,%d", single, first.FindingID)
	for _, c := range []struct{ path, want string }{
		{mixed + "&format=md-single", "新版 findings"},
		{single + "&format=md-single&report_template_id=" + strconv.FormatInt(created.ID, 10), "新版 findings"},
		{single + "&format=md-single&report_template_id=0", "# 漏洞发现汇总报告"},
	} {
		if got := call("GET", c.path, "", 200).Body.String(); !strings.Contains(got, c.want) {
			t.Fatalf("%s: %s", c.path, got)
		}
	}
	call("DELETE", path, "", 200)
	checkList(0)
	for _, c := range []struct{ path, want string }{
		{"/api/report?task=" + task.ID, "客户版 task 模板验收 漏洞A"},
		{single + "&format=md-single", "客户版 findings 漏洞发现汇总报告 漏洞A"},
	} {
		if got := call("GET", c.path, "", 200).Body.String(); !strings.Contains(got, c.want) {
			t.Fatalf("%s: %s", c.path, got)
		}
	}
	w := call("GET", single+"&format=md-zip", "", 200)
	z, err := zip.NewReader(bytes.NewReader(w.Body.Bytes()), int64(w.Body.Len()))
	if err != nil {
		t.Fatal(err)
	}
	if len(z.File) != 1 {
		t.Fatalf("unexpected ZIP entries: %d", len(z.File))
	}
	file, err := z.File[0].Open()
	if err != nil {
		t.Fatal(err)
	}
	defer file.Close()
	md, err := io.ReadAll(file)
	if err != nil || !strings.Contains(string(md), "客户版 single 漏洞A 漏洞A") {
		t.Fatalf("ZIP report %q, %v", md, err)
	}
}
