"use client";

import * as React from "react";

import Link from "next/link";

import { HistoryIcon, RotateCcwIcon } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { api } from "@/lib/api";
import type { FindingQuery, FindingRetestBatch } from "@/lib/types";

function requestKey() {
  return (
    globalThis.crypto?.randomUUID?.() ?? `retest-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
  );
}

type Filters = Omit<FindingQuery, "page" | "pageSize">;
type Draft = { ids: string[]; filters: Filters; taskId?: string };
const labels = {
  pending: "排队中",
  running: "复测中",
  completed: "已完成",
  failed: "执行失败",
  stopped: "已停止",
  skipped: "已跳过",
};
const verdicts = { reproduced: "仍可复现", fixed: "已修复", inconclusive: "无法确认" };

export function FindingRetestBatches({
  selectedIds = [],
  filters,
  taskId,
}: {
  selectedIds?: string[];
  filters: Filters;
  taskId?: string;
}) {
  const [draft, setDraft] = React.useState<Draft | null>(null);
  const [history, setHistory] = React.useState<{ id?: number } | null>(null);
  return (
    <>
      <Button
        size="sm"
        variant="outline"
        onClick={() => setDraft({ ids: [...selectedIds], filters: { ...filters }, taskId })}
      >
        <RotateCcwIcon /> 批量复测
      </Button>
      <Button size="sm" variant="outline" onClick={() => setHistory({})}>
        <HistoryIcon /> 复测批次
      </Button>
      {draft ? (
        <BatchStartDialog
          draft={draft}
          onClose={() => setDraft(null)}
          onCreated={(b) => {
            setDraft(null);
            setHistory({ id: b.id });
          }}
        />
      ) : null}
      {history ? <BatchHistoryDialog taskId={taskId} initialId={history.id} onClose={() => setHistory(null)} /> : null}
    </>
  );
}

function BatchStartDialog({
  draft,
  onClose,
  onCreated,
}: {
  draft: Draft;
  onClose: () => void;
  onCreated: (batch: FindingRetestBatch) => void;
}) {
  const [scope, setScope] = React.useState(draft.ids.length ? "selected" : "filtered");
  const [candidates, setCandidates] = React.useState<string[] | null>(null);
  const [notes, setNotes] = React.useState("");
  const [error, setError] = React.useState("");
  const [submitting, setSubmitting] = React.useState(false);
  const [concurrency, setConcurrency] = React.useState<number | null>(null);
  const locked = React.useRef(false);
  const key = React.useRef(requestKey());
  const labelId = React.useId();
  React.useEffect(() => {
    let live = true;
    api
      .findingRetestSettings()
      .then((r) => {
        if (live) setConcurrency(r.concurrency);
      })
      .catch(() => {
        /* Concurrency is informational here; submission still validates readiness. */
      });
    return () => {
      live = false;
    };
  }, []);
  React.useEffect(() => {
    if (scope !== "filtered") return;
    let live = true;
    setCandidates(null);
    setError("");
    api
      .findingRetestCandidates(draft.filters)
      .then((r) => {
        if (live) setCandidates(r.ids);
      })
      .catch((e) => {
        if (live) setError((e as Error).message);
      });
    return () => {
      live = false;
    };
  }, [scope, draft]);
  const ids = scope === "selected" ? draft.ids : candidates;
  async function start() {
    if (locked.current || !ids?.length) return;
    locked.current = true;
    setSubmitting(true);
    setError("");
    try {
      const r = await api.createFindingRetestBatch({ ids, notes, request_key: key.current, task_id: draft.taskId });
      toast.success(`批次 #${r.batch.id} 已提交，${r.batch.skipped} 条跳过`);
      onCreated(r.batch);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      locked.current = false;
      setSubmitting(false);
    }
  }
  return (
    <Dialog open onOpenChange={(open) => !open && !locked.current && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>批量复测漏洞</DialogTitle>
          <DialogDescription>
            每个漏洞使用独立会话，已排队或正在复测的漏洞会跳过。关闭页面后仍会继续执行。
          </DialogDescription>
        </DialogHeader>
        <RadioGroup
          value={scope}
          disabled={submitting}
          onValueChange={(value) => {
            setScope(value);
            setError("");
            key.current = requestKey();
          }}
        >
          <label htmlFor={`${labelId}-selected`} className="flex items-center gap-2 text-sm">
            <RadioGroupItem id={`${labelId}-selected`} value="selected" disabled={!draft.ids.length} /> 已勾选的{" "}
            {draft.ids.length} 个漏洞（含跨页勾选）
          </label>
          <label htmlFor={`${labelId}-filtered`} className="flex items-center gap-2 text-sm">
            <RadioGroupItem id={`${labelId}-filtered`} value="filtered" />{" "}
            {draft.taskId ? "当前任务的全部漏洞" : "当前全部筛选结果（包含其他分页）"}
          </label>
        </RadioGroup>
        <p className="text-sm text-muted-foreground">
          {ids === null ? "正在读取漏洞名单…" : `本次提交 ${ids.length} 个漏洞，名单已固定。`}
          {concurrency ? ` 全局并发 ${concurrency} 个。` : ""}
        </p>
        <div className="space-y-2">
          <label htmlFor={labelId} className="text-sm font-medium">
            统一补充说明（可选）
          </label>
          <Textarea
            id={labelId}
            rows={4}
            maxLength={4000}
            disabled={submitting}
            value={notes}
            onChange={(e) => {
              setNotes(e.target.value);
              key.current = requestKey();
            }}
            placeholder="例如：已部署修复版本 v2，使用原测试账号验证；仅复测原漏洞。"
          />
        </div>
        <p className="text-xs text-muted-foreground">仅成功完成且确认修复才自动标记「已修复」。单批最多 500 个漏洞。</p>
        {error ? (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        ) : null}
        <DialogFooter>
          <Button variant="outline" disabled={submitting} onClick={onClose}>
            取消
          </Button>
          <Button disabled={submitting || !ids?.length || ids.length > 500} onClick={() => void start()}>
            {submitting ? "正在提交…" : `开始复测${ids?.length ? `（${ids.length}）` : ""}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function BatchCounts({ batch: b }: { batch: FindingRetestBatch }) {
  const finished = b.completed + b.failed + b.stopped + b.skipped;
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm tabular-nums">
        <span>
          已处理 {finished}/{b.total}
        </span>
        <span>排队 {b.pending}</span>
        <span>执行 {b.running}</span>
        <span>完成 {b.completed}</span>
        <span>失败 {b.failed}</span>
        <span>停止 {b.stopped}</span>
        <span>跳过 {b.skipped}</span>
      </div>
      <progress
        className="h-2 w-full accent-primary"
        value={finished}
        max={b.total || 1}
        aria-label={`批次 ${b.id} 进度`}
      />
      <p className="text-xs text-muted-foreground">
        仍可复现 {b.reproduced} · 已修复 {b.fixed} · 无法确认 {b.inconclusive}
      </p>
    </div>
  );
}

function BatchHistoryDialog({
  taskId,
  initialId,
  onClose,
}: {
  taskId?: string;
  initialId?: number;
  onClose: () => void;
}) {
  const [selected, setSelected] = React.useState<number | undefined>(initialId);
  const [batch, setBatch] = React.useState<FindingRetestBatch | null>(null);
  const [batches, setBatches] = React.useState<FindingRetestBatch[]>([]);
  const [cursors, setCursors] = React.useState<number[]>([0]);
  const [concurrency, setConcurrency] = React.useState<number | null>(null);
  const [error, setError] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [refresh, setRefresh] = React.useState(0);
  const actionLock = React.useRef(false);
  const retryKey = React.useRef<{ action: string; key: string } | null>(null);
  const before = cursors[cursors.length - 1];
  React.useEffect(() => {
    let live = true;
    api
      .findingRetestSettings()
      .then((r) => {
        if (live) setConcurrency(r.concurrency);
      })
      .catch((e) => {
        if (live) setError((e as Error).message);
      });
    return () => {
      live = false;
    };
  }, []);
  React.useEffect(() => {
    let live = true;
    let timer: ReturnType<typeof setTimeout>;
    setBatch(null);
    setError("");
    async function load() {
      try {
        if (selected) {
          const r = await api.findingRetestBatch(selected);
          if (live) setBatch(r);
        } else {
          const r = await api.findingRetestBatches(taskId, before);
          if (live) {
            setBatches(r.batches);
            setConcurrency(r.concurrency);
          }
        }
        if (live) setError("");
      } catch (e) {
        if (live) setError((e as Error).message);
      } finally {
        if (live) timer = setTimeout(() => void load(), 3000);
      }
    }
    void refresh;
    void load();
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [selected, taskId, before, refresh]);
  async function action(kind: "stop" | "failed" | "inconclusive") {
    if (!batch || actionLock.current) return;
    actionLock.current = true;
    setBusy(true);
    try {
      if (kind === "stop") {
        setBatch(await api.stopFindingRetestBatch(batch.id));
        toast.success("批次已停止");
      } else {
        const name = `${batch.id}:${kind}`;
        if (retryKey.current?.action !== name) retryKey.current = { action: name, key: requestKey() };
        const r = await api.retryFindingRetestBatch(batch.id, kind, retryKey.current.key);
        setSelected(r.batch.id);
        setBatch(r.batch);
        retryKey.current = null;
        toast.success(`已创建重试批次 #${r.batch.id}`);
      }
      setError("");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      actionLock.current = false;
      setBusy(false);
    }
  }
  async function changeConcurrency(value: string) {
    if (actionLock.current) return;
    actionLock.current = true;
    setBusy(true);
    try {
      const r = await api.setFindingRetestConcurrency(Number(value));
      setConcurrency(r.concurrency);
      toast.success("并发设置已保存，后续调度生效");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      actionLock.current = false;
      setBusy(false);
    }
  }
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{selected ? `复测批次 #${selected}` : "复测批次"}</DialogTitle>
          <DialogDescription>查看排队进度、复测结论和每个漏洞的独立会话。失败与无法确认可分别重试。</DialogDescription>
        </DialogHeader>
        <div className="flex flex-wrap items-center gap-2">
          {selected ? (
            <Button size="sm" variant="outline" onClick={() => setSelected(undefined)}>
              返回批次列表
            </Button>
          ) : null}
          <span className="ml-auto text-sm">全局复测并发</span>
          <Select
            value={concurrency ? String(concurrency) : ""}
            disabled={busy}
            onValueChange={(v) => void changeConcurrency(v)}
          >
            <SelectTrigger className="w-20" aria-label="全局复测并发">
              <SelectValue placeholder="…" />
            </SelectTrigger>
            <SelectContent>
              {[1, 2, 3, 4, 5].map((n) => (
                <SelectItem key={n} value={String(n)}>
                  {n}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {error ? (
          <div role="alert" className="flex items-center gap-2 text-sm text-destructive">
            {error}
            <Button size="sm" variant="outline" onClick={() => setRefresh((n) => n + 1)}>
              刷新
            </Button>
          </div>
        ) : null}
        <div className="max-h-[60vh] space-y-4 overflow-y-auto pr-1">
          {selected ? (
            batch ? (
              <>
                <BatchCounts batch={batch} />
                {batch.notes ? (
                  <p className="whitespace-pre-wrap break-words rounded-md bg-muted p-3 text-sm">
                    补充说明：{batch.notes}
                  </p>
                ) : null}
                <div className="flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    variant="destructive"
                    disabled={busy || batch.pending + batch.running === 0}
                    onClick={() => void action("stop")}
                  >
                    停止批次
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busy || batch.failed + batch.stopped === 0}
                    onClick={() => void action("failed")}
                  >
                    重试失败 / 已停止项
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busy || batch.inconclusive === 0}
                    onClick={() => void action("inconclusive")}
                  >
                    重新复测无法确认项
                  </Button>
                </div>
                <div className="divide-y rounded-md border">
                  {batch.items?.map((item) => (
                    <div key={item.finding_id} className="space-y-2 p-3 text-sm">
                      <div className="flex flex-wrap items-center gap-2">
                        <Link
                          className="min-w-0 flex-1 break-words hover:underline"
                          href={`/function/findings/detail?id=${item.finding_id}`}
                        >
                          #{item.finding_id} {item.title}
                        </Link>
                        <span className="shrink-0">
                          {item.status === "completed" && item.verdict ? verdicts[item.verdict] : labels[item.status]}
                        </span>
                        {item.conversation_id ? (
                          <Link
                            className="shrink-0 text-primary hover:underline"
                            href={`/chat?c=${item.conversation_id}`}
                          >
                            查看会话
                          </Link>
                        ) : null}
                      </div>
                      {item.status === "completed" && item.summary ? (
                        <p className="whitespace-pre-wrap break-words text-muted-foreground">{item.summary}</p>
                      ) : null}
                      {item.error ? (
                        <p className="whitespace-pre-wrap break-words text-muted-foreground">{item.error}</p>
                      ) : null}
                    </div>
                  ))}
                </div>
              </>
            ) : (
              <p className="text-sm text-muted-foreground">正在加载批次…</p>
            )
          ) : (
            <>
              {!batches.length && !error ? (
                <p className="py-6 text-center text-sm text-muted-foreground">暂无复测批次</p>
              ) : null}
              {batches.map((b) => (
                <button
                  key={b.id}
                  type="button"
                  className="w-full space-y-3 rounded-md border p-4 text-left hover:bg-accent/40"
                  onClick={() => setSelected(b.id)}
                >
                  <div className="flex justify-between gap-2 text-sm">
                    <span className="font-medium">批次 #{b.id}</span>
                    <span className="text-muted-foreground">{new Date(b.created_at).toLocaleString("zh-CN")}</span>
                  </div>
                  <BatchCounts batch={b} />
                </button>
              ))}
              <div className="flex justify-end gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={cursors.length === 1}
                  onClick={() => setCursors((v) => v.slice(0, -1))}
                >
                  上一页
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={batches.length < 30}
                  onClick={() => setCursors((v) => [...v, batches[batches.length - 1].id])}
                >
                  下一页
                </Button>
              </div>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
