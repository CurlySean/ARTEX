# Bulk Finding Retests Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** 持久化批量漏洞复测并部署本机 8787，默认全局并发 2。
**Architecture:** 复用 finding_retests 的 pending 作为持久队列，新增 claimed_at 区分已调度和等待。批次及条目只保存归属/跳过原因，执行状态从原复测记录派生。统一调度器驱动原会话执行器。
**Tech Stack:** Go, PostgreSQL, Next.js/React, Docker.
**Spec:** docs/superpowers/specs/2026-11-16-bulk-retests.md

## Global Constraints
- 默认全局并发 2，可配置 1–5；单条/批量共享。
- 保留原数据库、任务、漏洞和复测历史；测试数据库独立。
- 运行中断不自动重放；仅 completed + fixed 回写漏洞状态。

## Review Focus
- 批次停止与领取/完成竞争：不得继续启动、误改已修复或取消跳过条目。
- 单条提交、聊天入口、不同批次竞争：不得绕过并发与重复保护。
- 重启与删除漏洞/会话：不得产生永久 pending 或丢失批次计数。
- 跨页筛选/继承漏洞：名单冻结、任务范围不能扩大。
- 浏览器会话/截图文件：不同复测证据不得交叉或覆盖。

### Task 1: Persistent batches and queue
**Files:** db/schema.sql, db/finding_retests.go, db/finding_retest_batches.go, db/finding_retest_batches_test.go.
**Interfaces:** CreateFindingRetestBatch(ctx,key,ids,notes,taskID); Get/ListFindingRetestBatches; ClaimFindingRetest(ctx,limit); StopFindingRetestBatch; queue recovery.
- [x] Write/run failing tests: deduplication, atomic batch idempotency, cap 2 across concurrent claims, recovery, stop excludes skipped, deleted rows retained.
- [x] Implement transaction helper for existing creation, batch tables, queue claim and stop.
- [x] Run db retest tests against temporary PostgreSQL; commit.

### Task 2: API and dispatcher
**Files:** server/finding_retests.go, server/finding_retest_batches.go, server/finding_retest_queue.go, server/conversations.go, server/server.go, server/finding_retest_batches_test.go.
**Interfaces:** POST/GET /exploration/finding-retest-batches; GET /{id}; POST /{id}/stop; POST /{id}/retry; GET/PUT /retests/settings.
- [x] Write/run failing handler tests: single+batch shared cap, partial failure, cancellation, retries, bad scopes/settings, task ownership.
- [x] Implement shared dispatcher with synchronous claims and cancellation registration; block chat bypass on active retests; resume queued records on startup.
- [x] Run server and db retest tests; commit.

### Task 3: UI
**Files:** web/src/components/finding-retest-batches.tsx, web/src/lib/api.ts, web/src/lib/types.ts, findings/page.tsx, findings-table.tsx, tasks/detail/_tabs/findings-tab.tsx, retests-tab.tsx.
**Interfaces:** reusable FindingRetestBatches controls accepts selected IDs, filters and optional task ID; persistent progress dialog.
- [x] Add submit scope/notes dialog, batch history/detail with progress/conclusions/stop/retry, concurrency setting, task and findings entries.
- [x] Distinguish queued vs running on existing row badges; keep individual dialog and history.
- [x] Typecheck/static build and browser interaction validation; commit.

### Task 4: Review, deploy, acceptance
**Files:** design/plan status, scoped deployment config outside repository.
- [x] Run meaningful regression suites and independent whole-change review; fix issues.
- [x] Backup PostgreSQL/config/task-data manifest; build image from current local runtime base plus new embedded binary.
- [x] Recreate app only using same data mounts and PostgreSQL; restart Yak renderer network attachment if needed.
- [x] Actual local LLM retests against controlled HTTP fixture; verify 2 active with queued remainder, results, dedup/stop/retry and retained data; remove only acceptance fixtures.
- [x] Record tests, backup paths and deployed image; final report.

## 验收记录
- 2026-11-16：独立新库 `go test ./db`、`go test ./server` 全部通过；批次/队列/重试 `-race` 通过。
- 前端 TypeScript、静态构建、相关 Biome 检查通过；浏览器发现页及任务发现/复测页通过。
- 浏览器取证安装测试 8 项通过；Playwright 与 Yak 实际 PNG 生成验证通过。
- 本机 8787、默认并发 2；5 个本地合成样例经真实 Baizhi LLM 执行，3 reproduced / 1 fixed / 1 inconclusive，无失败。验证 2 running + 3 pending、自动接续、重复跳过、停止、重试、刷新保留进度。测试样例已清理。
- 原 LLM 网关返回 EOF，用户指定使用 CC Switch 的 Baizhi；新增 Baizhi 复测配置，仅复测 Agent 绑定。配置和密钥不进仓库。
- 原 239 条漏洞与部署前数据库备份 COPY 数据逐行一致，4 个任务、2 个模板保留。
- 非本次改动的原有测试问题：`agent.TestGraphOverviewExpandsAssociatedCompanyScope` 缺少 task scope；`llmrec.TestSideUsageRecordedOnceOnConsumerCancellation` 新空库缺 llm_usage。均在修改前 de1c0ba 上复现。其余包通过。
- Ruling：批次详情路由使用 `/api/exploration/finding-retest-batches`，避免与现有 finding traffic 路由产生 ServeMux 歧义。
- Ruling：普通历史解释聊天保持原行为；并发限制覆盖所有持久化单条和批量复测。
- 原数据文件清单核对 142091 项，无丢失；仅流量索引 WAL 随验收流量正常增长，任务文件大小保持一致。
