package server

import (
	"archive/zip"
	"bytes"
	"crypto/sha256"
	"fmt"
	"image"
	"image/color"
	"image/png"
	"io"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/Autumn-27/artex/db"
	"github.com/Autumn-27/artex/report"
)

func TestFindingZipImages(t *testing.T) {
	work := t.TempDir()
	taskID := int64(7)
	f := &db.DBFinding{ID: 19, TaskID: &taskID}
	const download = "/api/workspace/download?path="
	browser := "browser-evidence/7/report-evidence/1790/网页 图.png"
	weburp := "tasks/7/report-evidence/19/flow one/screenshot.png"
	images := make(map[string][]byte)
	for i, path := range []string{browser, weburp} {
		var b bytes.Buffer
		img := image.NewRGBA(image.Rect(0, 0, 1, 1))
		img.Set(0, 0, color.RGBA{R: uint8(i + 1), A: 255})
		if err := png.Encode(&b, img); err != nil {
			t.Fatal(err)
		}
		images[path] = b.Bytes()
		fn := filepath.Join(work, path)
		if err := os.MkdirAll(filepath.Dir(fn), 0700); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(fn, b.Bytes(), 0600); err != nil {
			t.Fatal(err)
		}
	}
	const external = "https://example.test/api/workspace/download?path=browser-evidence/7/no/such.png"
	original := "![网页](" + download + url.QueryEscape(browser) + ")\n[重复](" + download + url.QueryEscape(browser) + ")\n![Weburp](" + download + url.QueryEscape(weburp) + ")\n[远端](" + external + ")"
	f.Report = original
	stage := t.TempDir()
	body := []byte("original traffic\x00")
	hash := fmt.Sprintf("%x", sha256.Sum256(body))
	blob := filepath.Join(stage, "blobs", hash[:2], hash+".bin")
	if err := os.MkdirAll(filepath.Dir(blob), 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(blob, body, 0600); err != nil {
		t.Fatal(err)
	}
	f.TrafficBindings = []db.FindingTrafficBinding{{
		ID: 3, Snapshot: db.TrafficEvidenceSnapshot{
			ReqHash: hash, RespHash: hash, ReqLen: int64(len(body)), RespLen: int64(len(body)),
		},
	}}
	renderer, err := report.CompileTemplate("客户版\n{{range .Findings}}{{.Report}}\n{{.TrafficMarkdown}}{{end}}")
	if err != nil {
		t.Fatal(err)
	}
	var out bytes.Buffer
	if err := writeFindingsEvidenceZip(&out, []*db.DBFinding{f}, stage, work, time.Now(), renderer); err != nil {
		t.Fatal(err)
	}
	z, err := zip.NewReader(bytes.NewReader(out.Bytes()), int64(out.Len()))
	if err != nil {
		t.Fatal(err)
	}
	got := make(map[string][]byte)
	var md string
	for _, file := range z.File {
		r, err := file.Open()
		if err != nil {
			t.Fatal(err)
		}
		body, err := io.ReadAll(r)
		r.Close()
		if err != nil {
			t.Fatal(err)
		}
		if strings.HasSuffix(file.Name, ".md") {
			md = string(body)
		} else {
			got[file.Name] = body
		}
	}
	if len(z.File) != 8 || !strings.HasPrefix(md, "客户版") || !strings.Contains(md, external) || f.Report != original {
		t.Fatalf("ZIP entries %d, Markdown %q", len(z.File), md)
	}
	if !bytes.Equal(got["evidence/19/3/request.bin"], body) || !bytes.Equal(got["evidence/19/3/response.bin"], body) || !strings.Contains(md, "evidence/19/3/") {
		t.Fatal("missing traffic attachments or Markdown links")
	}
	for _, path := range []string{browser, weburp} {
		wantCount := strings.Count(original, download+url.QueryEscape(path))
		matched := false
		for name, data := range got {
			if bytes.Equal(data, images[path]) && strings.Count(md, "]("+name+")") == wantCount {
				matched = true
			}
		}
		if !matched {
			t.Errorf("no local image for %s in %q", path, md)
		}
	}

	if err := os.MkdirAll(filepath.Join(work, "browser-evidence/7/step1"), 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(filepath.Join(work, weburp), filepath.Join(work, "browser-evidence/7/step1/private.png")); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(filepath.Join(work, "tasks/7/report-evidence/19/flow one"), filepath.Join(work, "browser-evidence/7/alias")); err != nil {
		t.Fatal(err)
	}
	for _, p := range []string{"browser-evidence/8/step1/screenshot.png", "tasks/7/report-evidence/20/proof.png", "secrets/private.png"} {
		fn := filepath.Join(work, p)
		if err := os.MkdirAll(filepath.Dir(fn), 0700); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(fn, images[weburp], 0600); err != nil {
			t.Fatal(err)
		}
	}
	for _, path := range []string{
		"browser-evidence/7/step1/missing.png", "browser-evidence/7/step1/private.png",
		"browser-evidence/7/alias/screenshot.png", "browser-evidence/7/step1/../step1/网页 图.png", "browser-evidence/8/step1/screenshot.png",
		"tasks/7/report-evidence/20/proof.png", "secrets/private.png",
	} {
		f.Report = "![证据](" + download + url.QueryEscape(path) + ")"
		out.Reset()
		if err := writeFindingsEvidenceZip(&out, []*db.DBFinding{f}, stage, work, time.Now(), renderer); err == nil || !strings.Contains(err.Error(), path) {
			t.Errorf("export allowed %q", path)
		}
	}
}
