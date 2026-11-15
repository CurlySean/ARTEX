package report

import (
	"github.com/Autumn-27/artex/db"
	"strings"
	"testing"
	"time"
)

func TestTemplateFallback(t *testing.T) {
	r, e := CompileTemplate("")
	if e != nil {
		t.Fatal(e)
	}
	in := Input{Title: "原报告", GeneratedAt: time.Now()}
	s, e := r.Task(in)
	if e != nil || s != Markdown(in) {
		t.Fatal(e)
	}
	f := &db.DBFinding{Name: "测试"}
	now := time.Now()
	s, e = r.Findings([]*db.DBFinding{f}, now)
	if e != nil || s != FindingsMarkdown([]*db.DBFinding{f}, now) {
		t.Fatal(e)
	}
	s, e = r.Single(f, now)
	if e != nil || s != SingleFindingMarkdown(f, now) {
		t.Fatal(e)
	}
}
func TestTemplateValidation(t *testing.T) {
	for _, b := range []string{`{{.Missing}}`, `{{if false}}{{.Missing}}{{end}}`, `{{range .Findings}}{{.Missing}}{{end}}`, `{{template "x" .}}`} {
		if _, e := CompileTemplate(b); e == nil {
			t.Errorf("accepted %s", b)
		}
	}
}
func TestTemplateStarter(t *testing.T) {
	r, e := CompileTemplate(StarterTemplate)
	if e != nil {
		t.Fatal(e)
	}
	p, e := r.Preview()
	if e != nil || !strings.Contains(p, "证据") {
		t.Fatal(p, e)
	}
	f := &db.DBFinding{ID: 12, Name: "测试", Report: "报告", Evidence: "原始证据", EvidenceVersion: 2, ReportEvidenceVersion: 1, TrafficBindings: []db.FindingTrafficBinding{{ID: 34}}}
	s, e := r.Single(f, time.Now())
	if e != nil {
		t.Fatal(e)
	}
	for _, v := range []string{"原始证据", "证据已变更", "evidence/12/34/request.http", "evidence/12/34/response.http"} {
		if !strings.Contains(s, v) {
			t.Error("missing", v)
		}
	}
}
func TestTemplateOutputLimit(t *testing.T) {
	r, e := CompileTemplate(`{{.Goal}}`)
	if e != nil {
		t.Fatal(e)
	}
	if _, e = r.Task(Input{Goal: strings.Repeat("x", maxTemplateOutput+1)}); e == nil {
		t.Fatal("unbounded")
	}
}

func TestTemplateHiddenFieldAndResources(t *testing.T) {
	for _, body := range []string{
		`{{if false}}{{(.Findings).Missing}}{{end}}`,
		`{{if false}}{{range .Findings}}{{.Title}}{{end}}{{end}}`,
		`{{printf "%1000000000s" .Title}}`,
		`{{range .Findings}}{{range $.Findings}}{{end}}{{end}}`,
		`{{range .Assets}}{{range $.Assets}}{{end}}{{end}}`,
		strings.Repeat("x", maxTemplateBody+1),
	} {
		if _, err := CompileTemplate(body); err == nil {
			t.Errorf("accepted unsafe template %.100s", body)
		}
	}
}
func TestTemplateViewFields(t *testing.T) {
	r, err := CompileTemplate(`{{.Title}}|{{.Goal}}|{{.GeneratedAt}}|{{range .Assets}}{{.Type}}={{.Count}}{{end}}|{{range .Findings}}{{.Name}}:{{.Evidence}}{{end}}`)
	if err != nil {
		t.Fatal(err)
	}
	in := Input{TaskName: "名称", Title: "描述", Goal: "目标", GeneratedAt: time.Date(2026, 1, 2, 3, 4, 5, 0, time.UTC), AssetCounts: map[string]int{"url": 2}, Findings: []*db.Node{{Payload: []byte(`{"name":"漏洞","evidence":{"poc":"证据"}}`)}}}
	s, err := r.Task(in)
	if err != nil {
		t.Fatal(err)
	}
	if s != "名称|目标|2026-01-02 03:04:05|url=2|漏洞:证据" {
		t.Fatal(s)
	}
}
func TestTemplateEvidenceFields(t *testing.T) {
	r, err := CompileTemplate(`{{range $i,$f := .Findings}}{{$f.Name}}:{{range $f.TrafficBindings}}{{.RequestPath}}|{{.ResponsePath}}{{end}}{{end}}`)
	if err != nil {
		t.Fatal(err)
	}
	s, err := r.Single(&db.DBFinding{ID: 2, Name: "漏洞", TrafficBindings: []db.FindingTrafficBinding{{ID: 3}}}, time.Now())
	if err != nil || s != "漏洞:evidence/2/3/request.http|evidence/2/3/response.http" {
		t.Fatal(s, err)
	}
}

func TestTemplateRejectCachedBindingLoops(t *testing.T) {
	for _, body := range []string{
		`{{$bindings := .Findings}}{{range .Findings}}{{end}}`, // collection aliases alone remain harmless
	} {
		if _, err := CompileTemplate(body); err != nil {
			t.Fatal(err)
		}
	}
	for _, body := range []string{
		`{{$saved := .Findings}}{{range $saved}}{{ $bindings := .TrafficBindings}}{{range $.Findings}}{{end}}{{end}}`,
		`{{$bindings := .Findings}}{{range .Findings}}{{$bindings = .TrafficBindings}}{{end}}{{range .Findings}}{{range $bindings}}{{end}}{{end}}`,
		`{{range .Findings}}{{$cached := .TrafficBindings}}{{range $cached}}{{end}}{{end}}`,
		`{{range $f := .Findings}}{{with $f.TrafficBindings}}{{range .}}{{end}}{{end}}{{end}}`,
	} {
		if _, err := CompileTemplate(body); err == nil {
			t.Errorf("accepted %s", body)
		}
	}
	for _, body := range []string{
		`{{range .Findings}}{{range .TrafficBindings}}{{.ID}}{{end}}{{end}}`,
		`{{range $f := .Findings}}{{with $f}}{{range .TrafficBindings}}{{.ID}}{{end}}{{end}}{{end}}`,
		`{{range $f := .Findings}}{{range $f.TrafficBindings}}{{.ID}}{{end}}{{end}}`,
	} {
		if _, err := CompileTemplate(body); err != nil {
			t.Errorf("rejected %s: %v", body, err)
		}
	}
}
func TestTaskNodeMetadata(t *testing.T) {
	r, err := CompileTemplate(`{{range .Findings}}{{.ID}}/{{.FindingID}}/{{.NodeID}}|{{.CreatedAt}}|{{.TaskDescription}}|{{.Status}}{{end}}`)
	if err != nil {
		t.Fatal(err)
	}
	in := Input{Title: "任务描述", Findings: []*db.Node{{ID: 42, FindingID: 7, CreatedAt: time.Date(2026, 1, 2, 3, 4, 5, 0, time.UTC)}}}
	s, err := r.Task(in)
	if err != nil || s != "7/7/42|2026-01-02 03:04:05|任务描述|" {
		t.Fatal(s, err)
	}
}
func TestPreviewKinds(t *testing.T) {
	r, err := CompileTemplate(`{{.Kind}}|{{if eq .Kind "single"}}{{range .Findings}}{{range .TrafficBindings}}{{.RequestPath}}{{end}}{{end}}{{end}}`)
	if err != nil {
		t.Fatal(err)
	}
	for _, kind := range []string{"task", "findings", "single"} {
		s, err := r.PreviewKind(kind)
		if err != nil || !strings.HasPrefix(s, kind+"|") {
			t.Fatal(s, err)
		}
		if kind == "single" && !strings.Contains(s, "request.http") {
			t.Fatal(s)
		}
	}
	s, err := r.Preview()
	if err != nil || s != "findings|" {
		t.Fatal(s, err)
	}
	if _, err = r.PreviewKind("invalid"); err == nil {
		t.Fatal("invalid kind accepted")
	}
}
