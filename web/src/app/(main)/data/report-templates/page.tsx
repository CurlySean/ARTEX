"use client";

import * as React from "react";
import Link from "next/link";
import { PlusIcon, RefreshCwIcon } from "lucide-react";
import { toast } from "sonner";
import { Markdown } from "@/components/markdown";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { api } from "@/lib/api";
import { MOCK } from "@/lib/mock/enabled";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { ReportTemplate } from "@/lib/types";

export default function ReportTemplatesPage() {
  const [templates, setTemplates] = React.useState<ReportTemplate[]>([]);
  const [builtin, setBuiltin] = React.useState("");
  const [starter, setStarter] = React.useState("");
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [editor, setEditor] = React.useState(false);
  const [id, setId] = React.useState<number | null>(null);
  const [name, setName] = React.useState("");
  const [body, setBody] = React.useState("");
  const [kind, setKind] = React.useState<"task" | "findings" | "single">("findings");
  const [preview, setPreview] = React.useState<string | null>(null);
  const [formError, setFormError] = React.useState("");
  const [deleting, setDeleting] = React.useState<ReportTemplate | null>(null);
  const load = React.useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const data = await api.reportTemplates();
      setTemplates(data.templates ?? []);
      setBuiltin(data.builtin);
      setStarter(data.starter ?? "");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);
  React.useEffect(() => {
    void load();
  }, [load]);
  function edit(t?: ReportTemplate) {
    setKind("findings");
    setId(t?.id ?? null);
    setName(t?.name ?? "");
    setBody(t?.body ?? starter);
    setPreview(null);
    setFormError("");
    setEditor(true);
  }
  async function save() {
    setBusy(true);
    setFormError("");
    try {
      const input = { name: name.trim(), body };
      if (id === null) await api.createReportTemplate(input);
      else await api.updateReportTemplate(id, input);
      setEditor(false);
      toast.success("报告模板已保存");
      await load();
    } catch (e) {
      setFormError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function showPreview() {
    setBusy(true);
    setFormError("");
    setPreview(null);
    try {
      setPreview((await api.previewReportTemplate(body, kind)).markdown);
    } catch (e) {
      setFormError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function makeDefault(templateId: number) {
    setBusy(true);
    setError("");
    try {
      await api.defaultReportTemplate(templateId);
      toast.success("全局默认模板已更新");
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function remove() {
    if (!deleting) return;
    setBusy(true);
    setError("");
    try {
      await api.deleteReportTemplate(deleting.id);
      setDeleting(null);
      toast.success("报告模板已删除");
      await load();
    } catch (e) {
      setError((e as Error).message);
      setDeleting(null);
    } finally {
      setBusy(false);
    }
  }
  if (MOCK)
    return (
      <div className="grid gap-3">
        <h1 className="text-2xl font-semibold">报告模板管理</h1>
        <p className="text-sm text-muted-foreground">
          演示模式不支持报告模板管理。请在本地部署中创建、预览和配置模板。
        </p>
      </div>
    );

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">报告模板管理</h1>
          <p className="text-sm text-muted-foreground">
            管理 Markdown 报告格式。任务创建时保存模板快照，后续修改不影响已有任务。
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" disabled={loading || busy} onClick={() => void load()}>
            <RefreshCwIcon />
            刷新
          </Button>
          <Button disabled={loading || busy || !!error} onClick={() => edit()}>
            <PlusIcon />
            新建模板
          </Button>
        </div>
      </div>
      {error && (
        <p role="alert" className="rounded-md border border-destructive/30 p-3 text-sm text-destructive">
          {error}
        </p>
      )}
      <Card>
        <CardHeader className="flex-row items-center justify-between gap-3">
          <CardTitle className="text-base">
            ARTEX 原版报告模板{!templates.some((t) => t.is_default) && !loading && !error ? " · 全局默认" : ""}
          </CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3">
          <p className="text-sm text-muted-foreground">包含任务报告、发现汇总 MD 和 ZIP 中每条发现的原始版式。</p>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" disabled={busy || loading || !builtin} onClick={() => {
              edit();
              setKind("task");
              setName("ARTEX 原版报告模板（副本）");
              setBody(builtin);
            }}>
              查看并复制原版
            </Button>
            <Button variant="outline" size="sm" disabled={busy || loading || !!error || !templates.some((t) => t.is_default)} onClick={() => void makeDefault(0)}>
              设为默认
            </Button>
          </div>
          <p className="text-sm text-muted-foreground">
            单条漏洞详细正文中的复现步骤、根因分析和修复建议由
            <Link className="underline" href="/system/agents/detail?key=reporter">「报告撰写」Agent</Link>
            的提示词定义。
          </p>
        </CardContent>
      </Card>
      {loading ? (
        <p className="text-sm text-muted-foreground">加载中…</p>
      ) : templates.length === 0 && !error ? (
        <div className="rounded-md border border-dashed p-10 text-center text-sm text-muted-foreground">
          暂无自定义模板，点击“新建模板”从示例开始。
        </div>
      ) : (
        templates.map((t) => (
          <Card key={t.id}>
            <CardHeader>
              <CardTitle className="text-base">
                {t.name}
                {t.is_default ? " · 全局默认" : ""}
              </CardTitle>
            </CardHeader>
            <CardContent className="flex flex-wrap gap-2">
              <Button variant="outline" size="sm" disabled={busy} onClick={() => edit(t)}>
                编辑与预览
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={busy || t.is_default}
                onClick={() => void makeDefault(t.id)}
              >
                设为默认
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={busy}
                onClick={() => {
                  edit(t);
                  setId(null);
                  setName(`${t.name} 副本`);
                }}
              >
                复制模板
              </Button>
              <Button variant="destructive" size="sm" disabled={busy} onClick={() => setDeleting(t)}>
                删除
              </Button>
            </CardContent>
          </Card>
        ))
      )}
      <Dialog
        open={editor}
        onOpenChange={(open) => {
          if (!busy) setEditor(open);
        }}
      >
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-4xl">
          <DialogHeader>
            <DialogTitle>{id === null ? "新建报告模板" : "编辑报告模板"}</DialogTitle>
            <DialogDescription>
              使用 Go text/template 语法。预览可切换真实导出场景；保存时服务端会验证全部三个场景。
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4">
            <div className="grid gap-2">
              <Label htmlFor="template-name">模板名称</Label>
              <Input id="template-name" value={name} onChange={(e) => setName(e.target.value)} disabled={busy} />
            </div>
            <div className="grid gap-2">
              <div className="flex items-center justify-between">
                <Label htmlFor="template-body">模板正文</Label>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={busy}
                  onClick={() => {
                    setBody(starter);
                    setPreview(null);
                  }}
                >
                  复制示例到编辑器
                </Button>
              </div>
              <Textarea
                id="template-body"
                value={body}
                onChange={(e) => {
                  setBody(e.target.value);
                  setPreview(null);
                }}
                className="min-h-72 font-mono text-xs"
                disabled={busy}
              />
              <p className="text-xs text-muted-foreground">
                根字段：Title、GeneratedAt、Findings、Kind、Total。Kind 实际值为小写 task / findings /
                single。任务场景提供 Goal 和全局资产统计 Assets；发现导出可用 Report、Status、TrafficMarkdown，ZIP
                附件链接位于 TrafficBindings 的 RequestPath / ResponsePath。
              </p>
            </div>
            <div className="grid gap-2">
              <Label>预览场景</Label>
              <Select
                value={kind}
                disabled={busy}
                onValueChange={(value) => {
                  setKind(value as typeof kind);
                  setPreview(null);
                  setFormError("");
                }}
              >
                <SelectTrigger aria-label="预览场景" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="task">任务报告（task）</SelectItem>
                  <SelectItem value="findings">发现汇总（findings）</SelectItem>
                  <SelectItem value="single">ZIP 单发现（single）</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {formError && (
              <p role="alert" className="text-sm text-destructive">
                {formError}
              </p>
            )}
            {preview !== null && (
              <div className="rounded-md border p-4">
                <h2 className="mb-3 text-sm font-medium">示例预览</h2>
                <Markdown text={preview} />
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" disabled={busy} onClick={() => setEditor(false)}>
              取消
            </Button>
            <Button variant="outline" disabled={busy || !body.trim()} onClick={() => void showPreview()}>
              预览
            </Button>
            <Button disabled={busy || !name.trim() || !body.trim()} onClick={() => void save()}>
              {busy ? "处理中…" : "保存"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog
        open={!!deleting}
        onOpenChange={(open) => {
          if (!open && !busy) setDeleting(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>删除模板“{deleting?.name}”？</DialogTitle>
            <DialogDescription>已有任务的模板快照会保留。删除默认模板后将使用内置模板。</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" disabled={busy} onClick={() => setDeleting(null)}>
              取消
            </Button>
            <Button variant="destructive" disabled={busy} onClick={() => void remove()}>
              确认删除
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
