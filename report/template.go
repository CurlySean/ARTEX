package report

import (
	_ "embed"
	"encoding/json"
	"errors"
	"fmt"
	"reflect"
	"sort"
	"strings"
	"text/template"
	"text/template/parse"
	"time"

	"github.com/Autumn-27/artex/db"
)

const maxTemplateOutput = 8 << 20
const maxTemplateBody = 64 << 10

//go:embed builtin.md.tmpl
var BuiltinTemplate string

// StarterTemplate uses the same view for task, findings and single-finding exports.
const StarterTemplate = `# {{.Title}}

{{if .Goal}}任务目标：{{.Goal}}
{{end}}生成时间：{{.GeneratedAt}}
发现总数：{{.Total}}
{{if .Assets}}
全局资产：{{end}}{{range .Assets}}
- {{.Type}}：{{.Count}}{{end}}
{{range .Findings}}
## [{{.Severity}}] {{.Name}}

- 类别：{{.VulnClass}}
{{if .Status}}- 状态：{{.Status}}{{end}}
{{if .TaskDescription}}- 所属任务：{{.TaskDescription}}
{{end}}
{{.Summary}}

{{if .Evidence}}### 证据

{{.Evidence}}
{{end}}
{{if .Report}}### 详细报告

{{.Report}}
{{end}}
{{.TrafficMarkdown}}
{{end}}`

type TemplateAsset struct {
	Type  string
	Count int
}
type TemplateTraffic struct {
	ID                        int64
	Role, Note, Method, URL   string
	Status                    int
	RequestPath, ResponsePath string
}
type TemplateFinding struct {
	Sections ReportSections
	// ID and FindingID always identify a persisted finding, never a graph node.
	ID, FindingID, NodeID                                                                    int64
	Name, VulnClass, Severity, Status, Summary, Evidence, Report, TaskDescription, CreatedAt string
	EvidenceVersion, ReportEvidenceVersion                                                   int64
	Stale                                                                                    bool
	TrafficMarkdown                                                                          string
	TrafficBindings                                                                          []TemplateTraffic
}
type TemplateView struct {
	Kind, Title, TaskDescription, Goal, GeneratedAt string
	SeverityCounts                                  struct{ Critical, High, Medium, Low int }
	Total                                           int
	Assets                                          []TemplateAsset
	Findings                                        []TemplateFinding
}

// Renderer holds an immutable, concurrently executable template. Empty bodies
// delegate to the existing renderers without changing their output.
type Renderer struct{ tmpl *template.Template }

// CompileTemplate validates fields even in unexecuted branches.
func CompileTemplate(body string) (*Renderer, error) {
	if strings.TrimSpace(body) == "" {
		return &Renderer{}, nil
	}
	if len(body) > maxTemplateBody {
		return nil, errors.New("template exceeds 64 KiB")
	}
	t, err := template.New("report").Funcs(template.FuncMap{
		"upper": strings.ToUpper, "trim": strings.TrimSpace, "defaultText": nz,
		"inc": func(i int) int { return i + 1 },
	}).Option("missingkey=error").Parse(body)
	if err != nil {
		return nil, err
	}
	if len(t.Templates()) != 1 {
		return nil, errors.New("template definitions are not supported")
	}
	if err = validateNodes(t.Tree.Root, reflect.TypeOf(TemplateView{}), map[string]reflect.Type{"$": reflect.TypeOf(TemplateView{})}, 0); err != nil {
		return nil, err
	}
	return &Renderer{tmpl: t}, nil
}

// validateNodes restricts loops to two levels (findings and their bindings), and
// rejects template calls, preventing recursive or unbounded template evaluation.
func validateNodes(n parse.Node, dot reflect.Type, vars map[string]reflect.Type, depth int) error {
	if n == nil {
		return nil
	}
	switch v := n.(type) {
	case *parse.ListNode:
		if v == nil {
			return nil
		}
		for _, c := range v.Nodes {
			if e := validateNodes(c, dot, vars, depth); e != nil {
				return e
			}
		}
	case *parse.FieldNode:
		_, e := fieldType(dot, v.Ident)
		return e
	case *parse.VariableNode:
		_, e := fieldType(vars[v.Ident[0]], v.Ident[1:])
		return e
	case *parse.ChainNode:
		if e := validateNodes(v.Node, dot, vars, depth); e != nil {
			return e
		}
		var base reflect.Type
		switch x := v.Node.(type) {
		case *parse.PipeNode:
			base = pipeType(x, dot, vars)
		case *parse.FieldNode:
			base, _ = fieldType(dot, x.Ident)
		case *parse.VariableNode:
			base, _ = fieldType(vars[x.Ident[0]], x.Ident[1:])
		}
		_, err := fieldType(base, v.Field)
		return err
	case *parse.IdentifierNode:
		switch v.Ident {
		case "upper", "trim", "defaultText", "inc", "len", "eq", "ne", "lt", "le", "gt", "ge", "and", "or", "not":
		default:
			return fmt.Errorf("template function %q is not supported", v.Ident)
		}
	case *parse.PipeNode:
		for _, c := range v.Cmds {
			if e := validateNodes(c, dot, vars, depth); e != nil {
				return e
			}
		}
	case *parse.CommandNode:
		for _, c := range v.Args {
			if e := validateNodes(c, dot, vars, depth); e != nil {
				return e
			}
		}
	case *parse.ActionNode:
		if err := validateNodes(v.Pipe, dot, vars, depth); err != nil {
			return err
		}
		if v.Pipe.IsAssign {
			return errors.New("template variable reassignment is not supported")
		}
		for _, d := range v.Pipe.Decl {
			delete(vars, "#finding:"+d.Ident[0])
			vars[d.Ident[0]] = pipeType(v.Pipe, dot, vars)
		}
	case *parse.IfNode:
		return validateBranch(v.Pipe, v.List, v.ElseList, dot, vars, depth, false, false)
	case *parse.WithNode:
		return validateBranch(v.Pipe, v.List, v.ElseList, dot, vars, depth, true, false)
	case *parse.RangeNode:
		return validateBranch(v.Pipe, v.List, v.ElseList, dot, vars, depth, true, true)
	case *parse.TemplateNode:
		return errors.New("template calls are not supported")
	}
	return nil
}
func fieldType(t reflect.Type, fields []string) (reflect.Type, error) {
	for _, f := range fields {
		if t == nil {
			return nil, fmt.Errorf("cannot validate template field %q", f)
		}
		if t.Kind() == reflect.Pointer {
			t = t.Elem()
		}
		if t.Kind() != reflect.Struct {
			return nil, fmt.Errorf("unknown template field %q", f)
		}
		sf, ok := t.FieldByName(f)
		if !ok || !sf.IsExported() {
			return nil, fmt.Errorf("unknown template field %q", f)
		}
		t = sf.Type
	}
	return t, nil
}
func pipeType(p *parse.PipeNode, dot reflect.Type, vars map[string]reflect.Type) reflect.Type {
	if len(p.Cmds) != 1 || len(p.Cmds[0].Args) != 1 {
		return nil
	}
	switch a := p.Cmds[0].Args[0].(type) {
	case *parse.FieldNode:
		t, _ := fieldType(dot, a.Ident)
		return t
	case *parse.DotNode:
		return dot
	case *parse.VariableNode:
		t, _ := fieldType(vars[a.Ident[0]], a.Ident[1:])
		return t
	}
	return nil
}
func validateBranch(p *parse.PipeNode, l, e *parse.ListNode, dot reflect.Type, vars map[string]reflect.Type, depth int, change, loop bool) error {
	if err := validateNodes(p, dot, vars, depth); err != nil {
		return err
	}
	child := dot
	t := pipeType(p, dot, vars)
	nv := make(map[string]reflect.Type, len(vars))
	for k, v := range vars {
		nv[k] = v
	}
	if loop {
		depth++
		if depth > 2 {
			return errors.New("template range nesting exceeds two levels")
		}
		if t == nil || t.Kind() != reflect.Slice {
			return errors.New("range must use a view collection")
		}
		t = t.Elem()
		if depth == 2 && !currentFindingBindings(p, dot, vars) {
			return errors.New("nested range must directly use the current finding TrafficBindings")
		}
		if depth == 2 && t != reflect.TypeOf(TemplateTraffic{}) {
			return errors.New("nested range must use finding TrafficBindings")
		}
	}
	if p.IsAssign {
		return errors.New("template variable reassignment is not supported")
	}
	if change {
		child = t
		delete(nv, "#dotFinding")
		if (loop && depth == 1 && t == reflect.TypeOf(TemplateFinding{})) || (!loop && currentFinding(p, dot, vars)) {
			nv["#dotFinding"] = reflect.TypeOf(TemplateFinding{})
		}
	}
	for _, v := range p.Decl {
		delete(nv, "#finding:"+v.Ident[0])
		nv[v.Ident[0]] = t
	}
	if loop && depth == 1 && t == reflect.TypeOf(TemplateFinding{}) && len(p.Decl) > 0 {
		nv["#finding:"+p.Decl[len(p.Decl)-1].Ident[0]] = t
	}
	if loop && len(p.Decl) == 2 {
		nv[p.Decl[0].Ident[0]] = reflect.TypeOf(0)
	}
	if err := validateNodes(l, child, nv, depth); err != nil {
		return err
	}
	return validateNodes(e, dot, vars, depth)
}

// Track only the current outer finding and its range alias. Cached collections
// cannot be iterated at the inner level, even when their element type matches.
func currentFinding(p *parse.PipeNode, dot reflect.Type, vars map[string]reflect.Type) bool {
	if len(p.Cmds) != 1 || len(p.Cmds[0].Args) != 1 {
		return false
	}
	switch a := p.Cmds[0].Args[0].(type) {
	case *parse.DotNode:
		return vars["#dotFinding"] != nil
	case *parse.VariableNode:
		return len(a.Ident) == 1 && vars["#finding:"+a.Ident[0]] != nil
	}
	return false
}
func currentFindingBindings(p *parse.PipeNode, dot reflect.Type, vars map[string]reflect.Type) bool {
	if len(p.Cmds) != 1 || len(p.Cmds[0].Args) != 1 {
		return false
	}
	switch a := p.Cmds[0].Args[0].(type) {
	case *parse.FieldNode:
		return len(a.Ident) == 1 && a.Ident[0] == "TrafficBindings" && vars["#dotFinding"] != nil
	case *parse.VariableNode:
		return len(a.Ident) == 2 && a.Ident[1] == "TrafficBindings" && vars["#finding:"+a.Ident[0]] != nil
	}
	return false
}

type limitedOutput struct{ strings.Builder }

func (b *limitedOutput) Write(p []byte) (int, error) {
	if b.Len()+len(p) > maxTemplateOutput {
		return 0, errors.New("template output exceeds 8 MiB")
	}
	return b.Builder.Write(p)
}
func (r *Renderer) render(v TemplateView) (string, error) {
	if len(v.Assets) > 10000 {
		return "", errors.New("template asset limit exceeded")
	}
	if len(v.Findings) > 10000 {
		return "", errors.New("template finding limit exceeded")
	}
	n := 0
	for _, f := range v.Findings {
		n += len(f.TrafficBindings)
	}
	if n > 10000 {
		return "", errors.New("template evidence limit exceeded")
	}
	var out limitedOutput
	err := r.tmpl.Execute(&out, v)
	if err != nil {
		return "", err
	}
	return out.String(), nil
}
func templateTime(t time.Time) string { return t.Format("2006-01-02 15:04:05") }
func templateFinding(f *db.DBFinding, attachments bool) TemplateFinding {
	v := TemplateFinding{Sections: reportSections(f.Report), ID: f.ID, FindingID: f.ID, Name: findingTitle(f), VulnClass: f.VulnClass, Severity: nz(f.Severity, "info"), Status: nz(f.Status, "pending"), Summary: f.Summary, Evidence: f.Evidence, Report: f.Report, TaskDescription: f.TaskDescription, CreatedAt: templateTime(f.CreatedAt), EvidenceVersion: f.EvidenceVersion, ReportEvidenceVersion: f.ReportEvidenceVersion, Stale: f.Report != "" && f.EvidenceVersion != f.ReportEvidenceVersion, TrafficMarkdown: findingTrafficMarkdown(f, attachments)}
	if f.NodeID != nil {
		v.NodeID = *f.NodeID
	}
	for _, b := range f.TrafficBindings {
		t := TemplateTraffic{ID: b.ID, Role: b.Role, Note: b.Note, Method: b.Snapshot.Method, URL: b.Snapshot.URL, Status: b.Snapshot.Status}
		if attachments {
			t.RequestPath = fmt.Sprintf("evidence/%d/%d/request.http", f.ID, b.ID)
			t.ResponsePath = fmt.Sprintf("evidence/%d/%d/response.http", f.ID, b.ID)
		}
		v.TrafficBindings = append(v.TrafficBindings, t)
	}
	return v
}
func (r *Renderer) Task(in Input) (string, error) {
	if r == nil || r.tmpl == nil {
		return Markdown(in), nil
	}
	v := TemplateView{Kind: "task", TaskDescription: in.Title, Title: nz(in.TaskName, nz(in.Title, "未命名任务")), Goal: in.Goal, GeneratedAt: templateTime(in.GeneratedAt), Total: len(in.Findings)}
	for k, n := range in.AssetCounts {
		v.Assets = append(v.Assets, TemplateAsset{k, n})
	}
	sort.Slice(v.Assets, func(i, j int) bool { return v.Assets[i].Type < v.Assets[j].Type })
	for _, n := range in.Findings {
		if n == nil {
			continue
		}
		f := parseFinding(n)
		detail := in.ReportsByNode[n.ID]
		v.Findings = append(v.Findings, TemplateFinding{Report: detail, Sections: reportSections(detail), ID: n.FindingID, FindingID: n.FindingID, NodeID: n.ID, CreatedAt: templateTime(n.CreatedAt), TaskDescription: in.Title, Name: nz(f.Name, nz(f.VulnClass, "未分类")), VulnClass: f.VulnClass, Severity: f.Severity, Summary: f.Summary, Evidence: f.PoC})
	}
	sort.SliceStable(v.Findings, func(i, j int) bool { return sevRank[v.Findings[i].Severity] < sevRank[v.Findings[j].Severity] })
	for i := range v.Findings {
		v.Findings[i].Severity = nz(v.Findings[i].Severity, "info")
	}
	return r.render(v)
}
func (r *Renderer) Findings(fs []*db.DBFinding, now time.Time) (string, error) {
	if r == nil || r.tmpl == nil {
		return FindingsMarkdown(fs, now), nil
	}
	items := append([]*db.DBFinding(nil), fs...)
	for _, f := range items {
		if f == nil {
			return "", errors.New("nil finding")
		}
	}
	sortFindingsForExport(items)
	v := TemplateView{Kind: "findings", Title: "漏洞发现汇总报告", GeneratedAt: templateTime(now), Total: len(items)}
	for _, f := range items {
		switch f.Severity {
		case "critical":
			v.SeverityCounts.Critical++
		case "high":
			v.SeverityCounts.High++
		case "medium":
			v.SeverityCounts.Medium++
		case "low":
			v.SeverityCounts.Low++
		}
		v.Findings = append(v.Findings, templateFinding(f, false))
	}
	return r.render(v)
}
func (r *Renderer) Single(f *db.DBFinding, now time.Time) (string, error) {
	if f == nil {
		return "", errors.New("nil finding")
	}
	if r == nil || r.tmpl == nil {
		return SingleFindingMarkdown(f, now), nil
	}
	return r.render(TemplateView{Kind: "single", Title: findingTitle(f), GeneratedAt: templateTime(now), Total: 1, Findings: []TemplateFinding{templateFinding(f, true)}})
}

// Preview uses the actual findings-summary path; PreviewKind selects another export.
func (r *Renderer) Preview() (string, error) { return r.PreviewKind("findings") }
func (r *Renderer) PreviewKind(kind string) (string, error) {
	now := time.Date(2026, 1, 2, 15, 4, 5, 0, time.UTC)
	nodeID := int64(42)
	f := &db.DBFinding{ID: 1, NodeID: &nodeID, Name: "示例漏洞", VulnClass: "示例类别", Severity: "high", Status: "confirmed", Summary: "示例概述", Evidence: "示例证据", Report: "## 受影响范围\n\nhttps://example.test/admin\n\n## 复现步骤\n\n以访客身份请求管理接口，响应包含管理数据。\n\n## 修复建议\n\n在管理接口校验用户角色。", TaskDescription: "示例任务描述", CreatedAt: now, EvidenceVersion: 2, ReportEvidenceVersion: 1, TrafficBindings: []db.FindingTrafficBinding{{ID: 1, Role: "proof", Note: "示例流量"}}}
	switch kind {
	case "task":
		payload, _ := json.Marshal(map[string]any{"name": f.Name, "vulnclass": f.VulnClass, "severity": f.Severity, "summary": f.Summary, "evidence": map[string]string{"poc": f.Evidence}})
		return r.Task(Input{TaskName: "示例任务", Title: f.TaskDescription, ReportsByNode: map[int64]string{nodeID: f.Report}, Goal: "验证报告模板", GeneratedAt: now, AssetCounts: map[string]int{"url": 1}, Findings: []*db.Node{{ID: nodeID, FindingID: f.ID, CreatedAt: now, Payload: payload}}})
	case "findings":
		return r.Findings([]*db.DBFinding{f}, now)
	case "single":
		return r.Single(f, now)
	default:
		return "", fmt.Errorf("unknown preview kind %q", kind)
	}
}
