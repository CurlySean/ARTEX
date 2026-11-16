package report

import (
	"strings"
	"testing"
	"unicode/utf8"

	"github.com/Autumn-27/artex/db"
)

func TestFindingFilenameKeepsUTF8AtByteLimit(t *testing.T) {
	f := &db.DBFinding{ID: 42, Severity: "high", Name: strings.Repeat("中", 50)}
	name := FindingFilename(f)
	if !utf8.ValidString(name) {
		t.Fatalf("filename contains invalid UTF-8: %q", name)
	}
	if got := len(strings.TrimSuffix(name, ".md")); got > 120 {
		t.Fatalf("filename base is %d bytes, want at most 120", got)
	}
}
