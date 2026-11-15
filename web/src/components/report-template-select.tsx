"use client";

import * as React from "react";
import { api } from "@/lib/api";
import type { ReportTemplate } from "@/lib/types";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";

export function ReportTemplateSelect({
  value,
  onChange,
  exporting = false,
}: {
  value: string;
  onChange: (value: string) => void;
  exporting?: boolean;
}) {
  const [templates, setTemplates] = React.useState<ReportTemplate[]>([]);
  const [error, setError] = React.useState("");
  const [loading, setLoading] = React.useState(true);
  const load = React.useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const result = await api.reportTemplates();
      setTemplates(result.templates ?? []);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);
  React.useEffect(() => {
    void load();
  }, [load]);
  const defaultName = templates.find((template) => template.is_default)?.name ?? "内置模板";
  return (
    <div className="grid gap-2">
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger aria-label="报告模板" className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="auto">
            {exporting ? "自动选择" : loading || error ? "使用全局默认" : `使用全局默认（${defaultName}）`}
          </SelectItem>
          <SelectItem value="0">内置模板</SelectItem>
          {templates.map((t) => (
            <SelectItem key={t.id} value={String(t.id)}>
              {t.name}
              {t.is_default ? "（全局默认）" : ""}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {loading && <p className="text-xs text-muted-foreground">正在加载模板…</p>}
      {error && (
        <div role="alert" className="text-xs text-destructive">
          模板加载失败：{error}{" "}
          <Button type="button" size="sm" variant="link" onClick={() => void load()}>
            重试
          </Button>
        </div>
      )}
    </div>
  );
}
