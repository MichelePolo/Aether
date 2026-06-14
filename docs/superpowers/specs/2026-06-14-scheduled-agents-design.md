# Scheduled / Background Agents — design

> Cron- and interval-driven **autonomous agent runs** inside the long-lived server
> (dev or slice-24 daemon). A user schedules a task — a prompt (+ optional
> `@subagent`) or an existing swarm — to run on a recurring schedule, unattended,
> with results persisted to a fresh session in history. Reuses the dispatch loop
> (`DispatchService.handle`), the swarm orchestrator (`runSwarm`), sessions/history,
> providers, and workspaces — **without modifying any of them**.
>
> Builds on: slice 24 (headless daemon + aether-cli), the dispatch loop, slice 25
> (swarms), sub-agents, sessions/history, breakpoints (slice 22). All Git tiers +
> the Changes pane + the agentic-depth track are shipped on `main`.

## 1. Brainstorming decisions (locked)

- **Cadence = cron + intervals**, via the zero-dependency **`croner`** micro-lib
  (used only to compute the next cron fire time). A single in-process **poller tick**
  drives both (Approach 1).
- **What a schedule runs = a prompt (+ optional `@subagent`) OR an existing swarm.**
- **Autonomy is per-schedule:** `safe` (default) auto-approves safe tools and
  **immediately rejects** gated/dangerous tool calls (no 60s stall); `trusted`
  (explicit opt-in) auto-approves **all** tool calls. The unattended run can't do
  destructive things unless the user marked the schedule trusted.
- **Each run = a new session** (clean per-run history), linked to the schedule.
- **Scheduler = a single poller** computing a persisted `nextRunAt` per schedule
  (survives restarts; cron and intervals both reduce to a `nextRunAt`).

## 2. What we reuse vs. build

**Reused untouched:** `DispatchService.handle` (headless via a no-op `SseEmitter`),
`runSwarm`, `HistoryStore.createEmpty`/`append` (history persists for free),
`createCollectingSse`/no-op SSE, the `BreakpointService` (for `safe` mode),
`McpRegistry`, providers, workspaces, the sidebar-section + Zustand-store pattern.

**Built:** a new `schedules` domain (types/schema/store/runner/scheduler + pure
`next-run`), a migration, HTTP routes, the `croner` dep, the bootstrap wiring +
`scheduler.start()`, and the frontend (api/store/`SchedulesSection`/`ScheduleEditModal`).

## 3. Architecture & components

### 3.1 Pure next-run — `server/domain/schedules/next-run.ts`
```ts
export type Cadence =
  | { kind: 'cron'; expr: string }
  | { kind: 'interval'; everyMs: number };

/** Next fire time (ms epoch) strictly after `fromMs`. Throws on an invalid cron expr. */
export function computeNextRunAt(cadence: Cadence, fromMs: number): number;
export function isValidCron(expr: string): boolean;
```
- cron: `new Cron(expr).nextRun(new Date(fromMs))!.getTime()` (croner).
- interval: `fromMs + everyMs`.
Pure + unit-tested with a fixed `fromMs`.

### 3.2 Types/schema — `schedules.types.ts` + `schedules.schema.ts`
```ts
type Target =
  | { kind: 'prompt'; prompt: string; subAgent?: string }
  | { kind: 'swarm'; swarmId: string; input?: string };  // input seeds the swarm's first step
type Autonomy = 'safe' | 'trusted';
type RunStatus = 'running' | 'success' | 'error' | 'rejected';

interface Schedule {
  id: string; name: string;
  cadence: Cadence; target: Target; autonomy: Autonomy;
  providerName?: string; workspaceId?: string;
  enabled: boolean;
  nextRunAt: number | null;   // null when disabled
  lastRunAt?: number;
  createdAt: number; updatedAt: number;
}
interface ScheduleRun {
  id: string; scheduleId: string; sessionId: string;
  startedAt: number; finishedAt?: number;
  status: RunStatus; error?: string;
}
```
Zod schemas validate create/update; the cron variant is refined with `isValidCron`.

### 3.3 Store — `schedules.store.ts`
SQLite-backed (mirrors `swarm.store.ts`). Columns: `id, name, cadence_json,
target_json, autonomy, provider_name, workspace_id, enabled, next_run_at,
last_run_at, created_at, updated_at`. (`cadence`/`target` are JSON TEXT —
polymorphic and only read at fire time; the poller filters on top-level columns.)
Methods: `list()`, `get(id)`, `create(input)`, `update(id, patch)`, `delete(id)`,
`setEnabled(id, enabled)`, `setNextRunAt(id, nextRunAt)`, `listDue(now)` (enabled
AND `next_run_at <= now`), and run records: `createRun(scheduleId, sessionId)`,
`finishRun(runId, status, error?)`, `listRuns(scheduleId, limit)`. `schedule_runs`
is a relational table with `FK scheduleId ON DELETE CASCADE`.

### 3.4 Runner — `schedule-runner.ts` (the gating override)
`ScheduleRunner.run(schedule)`:
1. `createRun` + `historyStore.createEmpty({ providerName, workspaceId })` →
   sessionId; title set from the first message via the normal `append` path.
2. Build a **per-run `DispatchService`** that reuses the real deps but swaps the gate
   per the autonomy level — **no change to `DispatchService`**:
   ```ts
   const gate = schedule.autonomy === 'trusted'
     ? { resolveDecision: async () => 'auto' as const }     // approve everything
     : realBreakpointService;                                // safe: real classification
   const registry = schedule.autonomy === 'trusted'
     ? realMcpRegistry
     : autoRejectGatedRegistry(realMcpRegistry);             // safe: gated → immediate reject
   const dispatcher = new DispatchService({ providers, historyStore, contextStore,
     subAgentsStore, mcpRegistry: registry, breakpointService: gate });
   ```
   `autoRejectGatedRegistry` is a thin `Proxy` over the real registry that overrides
   **only** `awaitDecision` to resolve `'reject'` immediately (delegating everything
   else — `policy`, `listLiveTools`, `callTool` — to the real registry). This makes a
   `safe` run reject gated/dangerous tools instantly instead of stalling 60s.
3. Execute:
   - `target.kind === 'prompt'` → `dispatcher.handle({ sessionId, message:
     target.subAgent ? '@'+subAgent+' '+prompt : prompt, providerName }, noopSse, signal)`.
   - `target.kind === 'swarm'` → `runSwarm({ ...swarmDeps, dispatcher }, { swarmId, input: target.input ?? '' }, noopSse, signal)`.
4. Map the outcome via the SSE events captured by a small recording emitter that wraps
   `noopSse`: the dispatch/swarm emits a terminal `done` (or `swarm_done`/`error`) event.
   **`error`** = an `error`/`*_done` with status `error` (or a thrown exception);
   **`rejected`** = a `swarm_done` with status `rejected` (swarm path only — a plain
   prompt run is never "rejected" at the run level: individual gated-tool rejections
   don't fail the run, the model still produces a final answer → `success`);
   otherwise **`success`**. Then `finishRun(status, error?)`. A per-run `AbortController`
   enforces a max duration (configurable; generous default) → abort → `error`.

`noopSse` is an `SseEmitter` whose methods are no-ops (events discarded; history still
persists inside `handle`).

### 3.5 Scheduler — `scheduler.service.ts`
`SchedulerService({ store, runner, now }, opts?)` with an injectable `now()` (for
tests). `start()` sets a `setInterval(tick, TICK_MS=30_000)` and runs one tick
immediately (boot catch-up). `stop()` clears it.
```ts
async tick() {
  const t = this.now();
  for (const s of this.store.listDue(t)) {
    if (this.running.has(s.id)) continue;           // no overlap
    const next = computeNextRunAt(s.cadence, t);
    this.store.setNextRunAt(s.id, next);            // advance BEFORE firing
    this.store.update(s.id, { lastRunAt: t });
    this.running.add(s.id);
    void this.runner.run(s).catch(() => {}).finally(() => this.running.delete(s.id));
  }
}
```
Every fire is isolated; the tick never throws (the runner records its own errors).
Catch-up: a past `nextRunAt` makes the schedule due → fires once, then advances.

### 3.6 Routes — `server/routes/schedules.routes.ts`
`createScheduleRoutes(store, runner)`: `GET /`, `POST /`, `GET /:id`, `PUT /:id`,
`DELETE /:id`, `POST /:id/run` (manual run-now → `runner.run` fire-and-record),
`GET /:id/runs`. Zod-validated; on `create`/`update`, compute `nextRunAt` if enabled.
Wired in `app.ts` (`AppDeps.scheduleStore`/`scheduleRunner`) + `index.ts` (construct
store/runner/scheduler, `scheduler.start()` after listen; `scheduler.stop()` in the
SIGTERM/SIGINT handlers).

### 3.7 Frontend
- `src/lib/api/schedules.api.ts` + `src/stores/schedules.store.ts` (mirror swarms).
- `src/components/sidebar/SchedulesSection.tsx` — list (name + cadence summary +
  enabled toggle + last-run status), edit/delete/run-now. `ScheduleEditModal` —
  name, cadence (cron expr or interval), target (prompt+subagent or swarm picker),
  autonomy (safe/trusted, with a warning on trusted), provider/workspace, enabled.
  A compact runs list (status + a link that opens the run's session). `App.tsx`
  calls the store's `init()`.

## 4. Data flow (a cron schedule fires)

1. The poller tick finds the schedule due (`enabled`, `next_run_at <= now`, not running).
2. It advances `next_run_at` (croner) and marks the schedule running (in-memory).
3. `ScheduleRunner.run`: creates a `ScheduleRun(running)` + a fresh session; builds the
   per-run dispatcher with the autonomy gate override.
4. Executes the prompt dispatch or the swarm headlessly (no-op SSE); history persists.
5. On completion: `finishRun(success|error|rejected)`. The UI shows it via `GET /:id/runs`.

## 5. Error handling & edge cases

- **Tick never throws** — each fire is isolated; a failed run records `error` and the
  loop continues.
- **Invalid cron** → rejected at create/update (Zod + `isValidCron`) → 400.
- **Missing provider / deleted workspace** → the run fails gracefully → `error` recorded.
- **Overlap** → a schedule already running is skipped; `next_run_at` still advances.
- **Boot catch-up** → a past `next_run_at` fires **once**, then advances (no backfill storm).
- **Two servers (dev + daemon)** → both would schedule → possible double-fire; documented,
  with an `AETHER_SCHEDULER=0` env flag to disable the scheduler in one. (Rare; not
  hard-fenced in v1.)
- **Shutdown** → `scheduler.stop()` on SIGTERM/SIGINT alongside the existing daemon-file cleanup.
- **Runaway run** → per-run `AbortController` + max-duration timeout → abort → `error`.
- **Disable** → `enabled=false` sets `next_run_at=null`; the tick ignores it; re-enabling recomputes.

## 6. Testing

- **`next-run.ts`** (pure): cron → next time with a fixed `fromMs` (daily/weekly exprs);
  interval = `fromMs + everyMs`; `isValidCron` true/false.
- **`schedules.store`**: CRUD; `listDue(now)` (enabled + due, excludes disabled/future);
  `setNextRunAt`/`setEnabled`; run records (create/finish/list).
- **`ScheduleRunner`**: with a fake dispatcher, assert it creates a session + run record
  and applies the right gate — `trusted`: injected `breakpointService.resolveDecision`
  returns `auto`; `safe`: the `autoRejectGatedRegistry` Proxy intercepts `awaitDecision`
  → `reject` and delegates the rest. Test the swarm path with a fake `runSwarm`.
- **`SchedulerService`**: tick with an **injected clock** + fake store/runner — fires due
  schedules, advances `nextRunAt`, skips running ones, boot catch-up. Deterministic.
- **Routes**: CRUD (200 / 400 / 404), run-now, list runs.
- **Frontend**: `schedules.store` (mock api) + `SchedulesSection`/`ScheduleEditModal` smoke.
- **E2e**: deferred (time-based scheduling is hard to e2e deterministically); covered by
  injected-clock unit tests + a manual run-now smoke.

## 7. Out of scope (v1, future)

Webhook/event ("watch-and-react" reactive, non-temporal) triggers, automatic retry of
failed runs, result notifications (email/push), per-schedule timezone (v1 uses the
server's local time), cross-process scheduling coordination beyond a single server.

## 8. Delivery checklist

- [ ] `croner` dependency added
- [ ] `next-run.ts` pure helper + tests
- [ ] migration `014_schedules.sql` (schedules + schedule_runs)
- [ ] `schedules.types/schema/store` + tests
- [ ] `schedule-runner.ts` (autonomy gate override, prompt + swarm) + tests
- [ ] `scheduler.service.ts` (injectable clock, catch-up, no-overlap) + tests
- [ ] `schedules.routes.ts` + tests; `AppDeps` + `app.ts`/`index.ts` wiring + `scheduler.start/stop`
- [ ] `schedules.api` + `schedules.store` (frontend) + `SchedulesSection`/`ScheduleEditModal` + `App.tsx` init
- [ ] i18n strings; a11y
- [ ] `npm run lint` + `npm run test:run` green; `npm run build` OK
- [ ] roadmap: mark Scheduled/background agents shipped
