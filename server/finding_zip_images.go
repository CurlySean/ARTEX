package server

import (
	"archive/zip"
	"fmt"
	"image/png"
	"io"
	"io/fs"
	"net/url"
	"os"
	"path"
	"regexp"
	"strconv"
	"strings"

	"github.com/Autumn-27/artex/db"
)

// Match root-relative workspace URLs in inline Markdown destinations, link
// definitions and HTML attributes. External hosts are never resolved or fetched.
var findingImageLink = regexp.MustCompile(`(?m)(?:\]\([ \t]*<?|^ {0,3}\[[^\]\n]+\]:[ \t]*<?|(?i:\b(?:src|href)[ \t]*=[ \t]*["']))(/api/workspace/download\?path=([^\s)>"']+))`)

func zipFindingImages(zw *zip.Writer, workspace string, f *db.DBFinding, md string) (string, error) {
	var result strings.Builder
	names := make(map[string]string)
	last := 0
	for _, match := range findingImageLink.FindAllStringSubmatchIndex(md, -1) {
		raw := md[match[4]:match[5]]
		query, err := url.ParseQuery("path=" + raw)
		if err != nil {
			return "", fmt.Errorf("无效工作区链接 %q: %w", raw, err)
		}
		rel := query.Get("path")
		if !strings.EqualFold(path.Ext(rel), ".png") {
			continue
		}
		if len(query["path"]) != 1 || !validFindingImage(f, rel) {
			return "", fmt.Errorf("截图路径不属于此漏洞或任务: %q", rel)
		}
		name, ok := names[rel]
		if !ok {
			name = fmt.Sprintf("evidence/%d/images/%d.png", f.ID, len(names)+1)
			if err := copyFindingImage(zw, workspace, rel, name); err != nil {
				return "", fmt.Errorf("%s: %w", rel, err)
			}
			names[rel] = name
		}
		result.WriteString(md[last:match[2]])
		result.WriteString(name)
		last = match[3]
	}
	if last == 0 {
		return md, nil
	}
	result.WriteString(md[last:])
	return result.String(), nil
}

func validFindingImage(f *db.DBFinding, rel string) bool {
	if f.TaskID == nil || !fs.ValidPath(rel) || strings.ContainsAny(rel, "\\:\x00") {
		return false
	}
	p := strings.Split(rel, "/")
	if len(p) < 4 || p[1] != strconv.FormatInt(*f.TaskID, 10) {
		return false
	}
	return (p[0] == "browser-evidence" && len(p) == 4) ||
		(p[0] == "tasks" && len(p) >= 5 && p[2] == "report-evidence" && p[3] == strconv.FormatInt(f.ID, 10))
}

func copyFindingImage(zw *zip.Writer, workspace, rel, name string) error {
	root, err := os.OpenRoot(workspace)
	if err != nil {
		return err
	}
	defer func() { root.Close() }()
	// Pin each real directory before resolving its child. Checking identity
	// closes the race where a task directory is replaced by a sibling symlink.
	for _, component := range strings.Split(path.Dir(rel), "/") {
		info, err := root.Lstat(component)
		if err != nil {
			return err
		}
		if !info.IsDir() {
			return fmt.Errorf("截图目录不可用: %s", component)
		}
		child, err := root.OpenRoot(component)
		if err != nil {
			return err
		}
		root.Close()
		root = child
		opened, err := root.Stat(".")
		if err != nil || !os.SameFile(info, opened) {
			return fmt.Errorf("截图目录已变更: %s", component)
		}
	}
	base := path.Base(rel)
	info, err := root.Lstat(base)
	if err != nil {
		return err
	}
	if !info.Mode().IsRegular() {
		return fmt.Errorf("截图必须是普通文件")
	}
	file, err := root.Open(base)
	if err != nil {
		return err
	}
	defer file.Close()
	opened, err := file.Stat()
	if err != nil || !os.SameFile(info, opened) {
		return fmt.Errorf("截图文件已变更")
	}
	if _, err := png.DecodeConfig(file); err != nil {
		return fmt.Errorf("无效 PNG: %w", err)
	}
	if _, err := file.Seek(0, io.SeekStart); err != nil {
		return err
	}
	w, err := zw.Create(name)
	if err != nil {
		return err
	}
	_, err = io.Copy(w, file)
	return err
}
