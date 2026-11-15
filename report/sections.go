package report

import "strings"

// ReportSections contains the original Markdown under headings used by the
// reporter agent and the corresponding headings in imported finding reports.
type ReportSections struct {
	Address, Scope, Reproduction, Evidence, PoC, Remediation string
}

func reportSections(markdown string) ReportSections {
	var sections ReportSections
	var field *string
	var start, offset, level int
	var fence string
	for line := range strings.SplitAfterSeq(markdown, "\n") {
		end := offset + len(line)
		s := strings.TrimRight(line, "\r\n")
		indent := len(s) - len(strings.TrimLeft(s, " "))
		if indent <= 3 {
			s = s[indent:]
		}
		if strings.HasPrefix(s, "```") || strings.HasPrefix(s, "~~~") {
			marker := s[:len(s)-len(strings.TrimLeft(s, s[:1]))]
			if fence == "" {
				fence = marker
			} else if strings.HasPrefix(marker, fence) && strings.TrimSpace(s[len(marker):]) == "" {
				fence = ""
			}
		} else if fence == "" && strings.HasPrefix(s, "#") {
			title := strings.TrimLeft(s, "#")
			depth := len(s) - len(title)
			if depth <= 6 && (strings.HasPrefix(title, " ") || strings.HasPrefix(title, "\t")) && (field == nil || depth <= level) {
				if field != nil {
					*field = strings.TrimSpace(markdown[start:offset])
				}
				field = nil
				switch strings.Trim(strings.TrimSpace(title), "*：: ") {
				case "漏洞地址":
					field = &sections.Address
				case "受影响范围":
					field = &sections.Scope
				case "复现步骤", "漏洞复现":
					field = &sections.Reproduction
				case "证据":
					field = &sections.Evidence
				case "PoC", "POC":
					field = &sections.PoC
				case "修复建议":
					field = &sections.Remediation
				}
				start, level = end, depth
			}
		}
		offset = end
	}
	if field != nil {
		*field = strings.TrimSpace(markdown[start:])
	}
	return sections
}
