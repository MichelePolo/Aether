# Scheduled / Background Agents Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cron/interval-driven autonomous agent runs (a prompt or an existing swarm) inside the long-lived server, with per-schedule autonomy and results persisted to history.

**Architecture:** A new `schedules` domain: a pure `next-run` helper (croner), a SQLite store, a `ScheduleRunner` that executes one schedule headlessly by building a **per-run `DispatchService`** with a gating override (no change to `DispatchService`/`runSwarm`), and a `SchedulerService` poller (injectable clock) that fires due schedules and advances a persisted `nextRunAt`. New HTTP routes + a `SchedulesSection`/`ScheduleEditModal` frontend.

**Tech Stack:** Express/better-sqlite3 backend, React 19 + Zustand, Vitest, `croner` (new dep).

**Spec:** `docs/superpowers/specs/2026-06-14-scheduled-agents-design.md`

---

## Branch

```bash
git checkout main
git checkout -b feat/scheduled-agents
```
(The spec commit is on local `main`; this branch includes it.)

---

## Task 1: croner dep + pure next-run helper

**Files:**
- Modify: `package.json` (add `croner`)
- Create: `server/domain/schedules/next-run.ts`
- Test: `server/domain/schedules/next-run.test.ts`

- [ ] **Step 1: Add the dependency**

```bash
npm install croner@9.0.0
```
Verify it lands in `package.json` `dependencies`.

- [ ] **Step 2: Write the failing test** — `server/domain/schedules/next-run.test.ts`:

```ts
import { computeNextRunAt, isValidCron } from './next-run';

describe('next-run', () => {
  it('interval: from + everyMs', () => {
    expect(computeNextRunAt({ kind: 'interval', everyMs: 3600_000 }, 1000)).toBe(3601_000);
  });

  it('cron: next daily 03:00 is strictly after `from`', () => {
    // 2026-06-14T10:00:00Z
    const from = Date.UTC(2026, 5, 14, 10, 0, 0);
    const next = computeNextRunAt({ kind: 'cron', expr: '0 3 * * *' }, from);
    expect(next).toBeGreaterThan(from);
    // next 03:00 local is within ~24h
    expect(next - from).toBeLessThanOrEqual(24 * 3600_000 + 1000);
  });

  it('isValidCron', () => {
    expect(isValidCron('0 3 * * *')).toBe(true);
    expect(isValidCron('not a cron')).toBe(false);
    expect(isValidCron('')).toBe(false);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run --project backend server/domain/schedules/next-run.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 4: Implement** — `server/domain/schedules/next-run.ts`:

```ts
import { Cron } from 'croner';

export type Cadence =
  | { kind: 'cron'; expr: string }
  | { kind: 'interval'; everyMs: number };

/** Next fire time (ms epoch) strictly after `fromMs`. Throws on an invalid cron expr. */
export function computeNextRunAt(cadence: Cadence, fromMs: number): number {
  if (cadence.kind === 'interval') return fromMs + cadence.everyMs;
  const next = new Cron(cadence.expr).nextRun(new Date(fromMs));
  if (!next) throw new Error(`cron expression has no next run: ${cadence.expr}`);
  return next.getTime();
}

export function isValidCron(expr: string): boolean {
  try {
    return new Cron(expr).nextRun() !== null;
  } catch {
    return false;
  }
}
```

- [ ] **Step 5: Run test + lint**

Run: `npx vitest run --project backend server/domain/schedules/next-run.test.ts && npm run lint`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json server/domain/schedules/next-run.ts server/domain/schedules/next-run.test.ts
git commit -m "feat(schedules): croner dep + pure next-run helper"
```

---

## Task 2: migration + types/schema + store

**Files:**
- Create: `server/db/migrations/014_schedules.sql`
- Create: `server/domain/schedules/schedules.types.ts`
- Create: `server/domain/schedules/schedules.schema.ts`
- Create: `server/domain/schedules/schedules.store.ts`
- Test: `server/domain/schedules/schedules.store.test.ts`

- [ ] **Step 1: Migration** — `server/db/migrations/014_schedules.sql`:

```sql
CREATE TABLE schedules (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  cadence_json TEXT NOT NULL,
  target_json TEXT NOT NULL,
  autonomy TEXT NOT NULL DEFAULT 'safe' CHECK (autonomy IN ('safe','trusted')),
  provider_name TEXT,
  workspace_id TEXT,
  enabled INTEGER NOT NULL DEFAULT 1,
  next_run_at INTEGER,
  last_run_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE schedule_runs (
  id TEXT PRIMARY KEY,
  schedule_id TEXT NOT NULL REFERENCES schedules(id) ON DELETE CASCADE,
  session_id TEXT,
  started_at INTEGER NOT NULL,
  finished_at INTEGER,
  status TEXT NOT NULL CHECK (status IN ('running','success','error','rejected')),
  error TEXT
);

CREATE INDEX idx_schedule_runs_schedule ON schedule_runs(schedule_id, started_at DESC);
```

- [ ] **Step 2: Types** — `server/domain/schedules/schedules.types.ts`:

```ts
import type { Cadence } from './next-run';

export type { Cadence };

export type Target =
  | { kind: 'prompt'; prompt: string; subAgent?: string }
  | { kind: 'swarm'; swarmId: string; input?: string };

export type Autonomy = 'safe' | 'trusted';
export type RunStatus = 'running' | 'success' | 'error' | 'rejected';

export interface Schedule {
  id: string;
  name: string;
  cadence: Cadence;
  target: Target;
  autonomy: Autonomy;
  providerName?: string;
  workspaceId?: string;
  enabled: boolean;
  nextRunAt: number | null;
  lastRunAt?: number;
  createdAt: number;
  updatedAt: number;
}

export interface ScheduleRun {
  id: string;
  scheduleId: string;
  sessionId: string | null;
  startedAt: number;
  finishedAt?: number;
  status: RunStatus;
  error?: string;
}

export interface ScheduleInput {
  name: string;
  cadence: Cadence;
  target: Target;
  autonomy?: Autonomy;
  providerName?: string;
  workspaceId?: string;
  enabled?: boolean;
}
```

- [ ] **Step 3: Schema** — `server/domain/schedules/schedules.schema.ts`:

```ts
import { z } from 'zod';
import { isValidCron } from './next-run';

const CadenceSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('cron'), expr: z.string().min(1).refine(isValidCron, 'invalid cron expression') }),
  z.object({ kind: z.literal('interval'), everyMs: z.number().int().min(60_000) }),
]);

const TargetSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('prompt'), prompt: z.string().min(1), subAgent: z.string().min(1).optional() }),
  z.object({ kind: z.literal('swarm'), swarmId: z.string().min(1), input: z.string().optional() }),
]);

export const ScheduleCreateSchema = z.object({
  name: z.string().min(1),
  cadence: CadenceSchema,
  target: TargetSchema,
  autonomy: z.enum(['safe', 'trusted']).optional(),
  providerName: z.string().min(1).optional(),
  workspaceId: z.string().min(1).optional(),
  enabled: z.boolean().optional(),
});

export const ScheduleUpdateSchema = ScheduleCreateSchema.partial();
```

- [ ] **Step 4: Write the failing store test** — `server/domain/schedules/schedules.store.test.ts`:

```ts
import { makeTestDb } from '@/server/test/test-db';
import { ScheduleStore } from './schedules.store';
import type { DatabaseHandle } from '@/server/db/database';

let db: DatabaseHandle;
let store: ScheduleStore;

beforeEach(() => {
  db = makeTestDb();
  store = new ScheduleStore(db);
});
afterEach(() => db.close());

describe('ScheduleStore', () => {
  it('create round-trips cadence/target and defaults', () => {
    const s = store.create({
      name: 'nightly', cadence: { kind: 'cron', expr: '0 3 * * *' },
      target: { kind: 'prompt', prompt: 'check the repo' },
    });
    expect(s.autonomy).toBe('safe');
    expect(s.enabled).toBe(true);
    expect(s.cadence).toEqual({ kind: 'cron', expr: '0 3 * * *' });
    expect(s.target).toEqual({ kind: 'prompt', prompt: 'check the repo' });
    expect(store.get(s.id)?.name).toBe('nightly');
  });

  it('listDue returns enabled schedules whose next_run_at <= now', () => {
    const a = store.create({ name: 'a', cadence: { kind: 'interval', everyMs: 60_000 }, target: { kind: 'prompt', prompt: 'x' } });
    store.setNextRunAt(a.id, 1000);
    const b = store.create({ name: 'b', cadence: { kind: 'interval', everyMs: 60_000 }, target: { kind: 'prompt', prompt: 'y' } });
    store.setNextRunAt(b.id, 9_999_999_999_999);
    const c = store.create({ name: 'c', cadence: { kind: 'interval', everyMs: 60_000 }, target: { kind: 'prompt', prompt: 'z' }, enabled: false });
    store.setNextRunAt(c.id, 1000);
    const due = store.listDue(5000).map((s) => s.id);
    expect(due).toContain(a.id);
    expect(due).not.toContain(b.id);
    expect(due).not.toContain(c.id);
  });

  it('run records: create (session null), setRunSession, finish, list', () => {
    const s = store.create({ name: 'a', cadence: { kind: 'interval', everyMs: 60_000 }, target: { kind: 'prompt', prompt: 'x' } });
    const runId = store.createRun(s.id);
    store.setRunSession(runId, 'sess-1');
    store.finishRun(runId, 'success');
    const runs = store.listRuns(s.id, 10);
    expect(runs[0]).toMatchObject({ id: runId, sessionId: 'sess-1', status: 'success' });
  });
});
```

- [ ] **Step 5: Run test to verify it fails**

Run: `npx vitest run --project backend server/domain/schedules/schedules.store.test.ts`
Expected: FAIL — store/migration not found.

- [ ] **Step 6: Implement the store** — `server/domain/schedules/schedules.store.ts`:

```ts
import { randomUUID } from 'node:crypto';
import type { DatabaseHandle } from '@/server/db/database';
import type {
  Cadence, Schedule, ScheduleInput, ScheduleRun, RunStatus, Target,
} from './schedules.types';

interface Row {
  id: string; name: string; cadence_json: string; target_json: string;
  autonomy: string; provider_name: string | null; workspace_id: string | null;
  enabled: number; next_run_at: number | null; last_run_at: number | null;
  created_at: number; updated_at: number;
}
interface RunRow {
  id: string; schedule_id: string; session_id: string | null;
  started_at: number; finished_at: number | null; status: string; error: string | null;
}

function rowToSchedule(r: Row): Schedule {
  return {
    id: r.id, name: r.name,
    cadence: JSON.parse(r.cadence_json) as Cadence,
    target: JSON.parse(r.target_json) as Target,
    autonomy: r.autonomy === 'trusted' ? 'trusted' : 'safe',
    providerName: r.provider_name ?? undefined,
    workspaceId: r.workspace_id ?? undefined,
    enabled: r.enabled === 1,
    nextRunAt: r.next_run_at,
    lastRunAt: r.last_run_at ?? undefined,
    createdAt: r.created_at, updatedAt: r.updated_at,
  };
}
function rowToRun(r: RunRow): ScheduleRun {
  return {
    id: r.id, scheduleId: r.schedule_id, sessionId: r.session_id,
    startedAt: r.started_at, finishedAt: r.finished_at ?? undefined,
    status: r.status as RunStatus, error: r.error ?? undefined,
  };
}

export class ScheduleStore {
  constructor(private readonly db: DatabaseHandle) {}

  list(): Schedule[] {
    return (this.db.prepare('SELECT * FROM schedules ORDER BY updated_at DESC').all() as Row[]).map(rowToSchedule);
  }

  get(id: string): Schedule | undefined {
    const r = this.db.prepare('SELECT * FROM schedules WHERE id = ?').get(id) as Row | undefined;
    return r ? rowToSchedule(r) : undefined;
  }

  create(input: ScheduleInput): Schedule {
    const id = randomUUID();
    const now = Date.now();
    this.db.prepare(
      `INSERT INTO schedules (id, name, cadence_json, target_json, autonomy, provider_name, workspace_id, enabled, next_run_at, last_run_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)`,
    ).run(
      id, input.name, JSON.stringify(input.cadence), JSON.stringify(input.target),
      input.autonomy ?? 'safe', input.providerName ?? null, input.workspaceId ?? null,
      input.enabled === false ? 0 : 1, null, now, now,
    );
    return this.get(id)!;
  }

  update(id: string, patch: Partial<ScheduleInput> & { lastRunAt?: number }): Schedule {
    const cur = this.get(id);
    if (!cur) throw new Error(`schedule ${id} not found`);
    const next: Schedule = {
      ...cur,
      name: patch.name ?? cur.name,
      cadence: patch.cadence ?? cur.cadence,
      target: patch.target ?? cur.target,
      autonomy: patch.autonomy ?? cur.autonomy,
      providerName: patch.providerName ?? cur.providerName,
      workspaceId: patch.workspaceId ?? cur.workspaceId,
      enabled: patch.enabled ?? cur.enabled,
      lastRunAt: patch.lastRunAt ?? cur.lastRunAt,
      updatedAt: Date.now(),
    };
    this.db.prepare(
      `UPDATE schedules SET name=?, cadence_json=?, target_json=?, autonomy=?, provider_name=?, workspace_id=?, enabled=?, last_run_at=?, updated_at=? WHERE id=?`,
    ).run(
      next.name, JSON.stringify(next.cadence), JSON.stringify(next.target), next.autonomy,
      next.providerName ?? null, next.workspaceId ?? null, next.enabled ? 1 : 0,
      next.lastRunAt ?? null, next.updatedAt, id,
    );
    return this.get(id)!;
  }

  delete(id: string): void {
    this.db.prepare('DELETE FROM schedules WHERE id = ?').run(id);
  }

  setNextRunAt(id: string, nextRunAt: number | null): void {
    this.db.prepare('UPDATE schedules SET next_run_at = ? WHERE id = ?').run(nextRunAt, id);
  }

  listDue(now: number): Schedule[] {
    return (this.db
      .prepare('SELECT * FROM schedules WHERE enabled = 1 AND next_run_at IS NOT NULL AND next_run_at <= ? ORDER BY next_run_at ASC')
      .all(now) as Row[]).map(rowToSchedule);
  }

  createRun(scheduleId: string): string {
    const id = randomUUID();
    this.db.prepare(
      `INSERT INTO schedule_runs (id, schedule_id, session_id, started_at, finished_at, status, error) VALUES (?, ?, NULL, ?, NULL, 'running', NULL)`,
    ).run(id, scheduleId, Date.now());
    return id;
  }

  setRunSession(runId: string, sessionId: string): void {
    this.db.prepare('UPDATE schedule_runs SET session_id = ? WHERE id = ?').run(sessionId, runId);
  }

  finishRun(runId: string, status: RunStatus, error?: string): void {
    this.db.prepare('UPDATE schedule_runs SET status = ?, error = ?, finished_at = ? WHERE id = ?')
      .run(status, error ?? null, Date.now(), runId);
  }

  listRuns(scheduleId: string, limit: number): ScheduleRun[] {
    return (this.db
      .prepare('SELECT * FROM schedule_runs WHERE schedule_id = ? ORDER BY started_at DESC LIMIT ?')
      .all(scheduleId, limit) as RunRow[]).map(rowToRun);
  }
}
```

- [ ] **Step 7: Fix the migration version-list assertion** — adding `014` breaks `server/db/migrate.test.ts:107`, which lists every applied version. Update it:

```ts
      expect(versions).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13]);
```
→
```ts
      expect(versions).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14]);
```

- [ ] **Step 8: Run tests + lint**

Run: `npx vitest run --project backend server/domain/schedules/schedules.store.test.ts server/db/migrate.test.ts && npm run lint`
Expected: PASS (store + migrate version list both green).

- [ ] **Step 9: Commit**

```bash
git add server/db/migrations/014_schedules.sql server/domain/schedules/schedules.types.ts server/domain/schedules/schedules.schema.ts server/domain/schedules/schedules.store.ts server/domain/schedules/schedules.store.test.ts server/db/migrate.test.ts
git commit -m "feat(schedules): migration 014 + types/schema/store"
```

---

## Task 3: ScheduleRunner (gating override + prompt/swarm)

**Files:**
- Create: `server/domain/schedules/schedule-runner.ts`
- Test: `server/domain/schedules/schedule-runner.test.ts`

- [ ] **Step 1: Write the failing test** — `server/domain/schedules/schedule-runner.test.ts`:

```ts
import { ScheduleRunner } from './schedule-runner';
import { ScheduleStore } from './schedules.store';
import { makeTestDb } from '@/server/test/test-db';
import type { DatabaseHandle } from '@/server/db/database';

// Minimal fakes for the dispatch deps. The runner builds a per-run DispatchService
// internally; we assert the OUTCOME (run record) + that history.createEmpty was used.
function fakeDeps(db: DatabaseHandle) {
  const store = new ScheduleStore(db);
  const sessions: string[] = [];
  const historyStore = {
    createEmpty: async () => { const id = 'sess-' + sessions.length; sessions.push(id); return { id }; },
    append: async () => {},
    getMessages: async () => [],
  };
  // A provider registry / context / mcp / breakpoint that let DispatchService.handle
  // run a no-tool turn. The fake provider returns one text chunk then done.
  // (Use the repo's existing FakeProvider wiring pattern; see notes below.)
  return { store, historyStore, sessions };
}

describe('ScheduleRunner', () => {
  let db: DatabaseHandle;
  beforeEach(() => { db = makeTestDb(); });
  afterEach(() => db.close());

  it('prompt run creates a session + a success run record', async () => {
    const { store, historyStore, sessions } = fakeDeps(db);
    const dispatcher = { handle: vi.fn(async () => {}) };  // no-op dispatch (no error event)
    const runner = new ScheduleRunner({
      store, historyStore: historyStore as never,
      buildDispatcher: () => dispatcher as never,           // injected for the test
      runSwarm: vi.fn(),
      swarmDeps: {} as never,
    });
    const sch = store.create({ name: 'a', cadence: { kind: 'interval', everyMs: 60_000 }, target: { kind: 'prompt', prompt: 'hello' } });
    await runner.run(sch);
    expect(dispatcher.handle).toHaveBeenCalledTimes(1);
    expect(sessions.length).toBe(1);
    const runs = store.listRuns(sch.id, 10);
    expect(runs[0].status).toBe('success');
    expect(runs[0].sessionId).toBe('sess-0');
  });

  it('builds an auto-approve gate for trusted and an auto-reject registry for safe', () => {
    const { store, historyStore } = fakeDeps(db);
    const calls: Array<'safe' | 'trusted'> = [];
    const runner = new ScheduleRunner({
      store, historyStore: historyStore as never,
      buildDispatcher: (autonomy) => { calls.push(autonomy); return { handle: vi.fn(async () => {}) } as never; },
      runSwarm: vi.fn(), swarmDeps: {} as never,
    });
    void runner.run(store.create({ name: 's', cadence: { kind: 'interval', everyMs: 60_000 }, target: { kind: 'prompt', prompt: 'x' }, autonomy: 'safe' }));
    void runner.run(store.create({ name: 't', cadence: { kind: 'interval', everyMs: 60_000 }, target: { kind: 'prompt', prompt: 'x' }, autonomy: 'trusted' }));
    expect(calls).toEqual(['safe', 'trusted']);
  });
});
```

> The test injects `buildDispatcher`/`runSwarm` so it doesn't need the real provider/registry. The PRODUCTION runner builds those internally (Step 3). Keep both code paths: the constructor takes the real deps; `buildDispatcher` defaults to the real builder but is overridable for tests.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run --project backend server/domain/schedules/schedule-runner.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement** — `server/domain/schedules/schedule-runner.ts`:

```ts
import { DispatchService } from '@/server/domain/dispatch/dispatch.service';
import { runSwarm as realRunSwarm } from '@/server/domain/swarms/swarm.orchestrator';
import type { SseEmitter } from '@/server/lib/sse';
import type { ProviderRegistry } from '@/server/domain/providers/registry';
import type { HistoryStore } from '@/server/domain/history/history.store';
import type { ContextStore } from '@/server/domain/context/context.store';
import type { SubAgentsStore } from '@/server/domain/subagents/subagents.store';
import type { McpRegistry } from '@/server/domain/mcp/registry';
import type { BreakpointService } from '@/server/domain/mcp/breakpoints/breakpoints.service';
import type { SwarmStore } from '@/server/domain/swarms/swarm.store';
import type { SwarmApprovalRegistry } from '@/server/domain/swarms/swarm.approval';
import type { Schedule, Autonomy, RunStatus } from './schedules.types';

const MAX_RUN_MS = 30 * 60_000; // 30 min hard ceiling per run

/** A Proxy over the real registry that immediately rejects any gated tool call
 *  (so an unattended `safe` run never stalls 60s waiting for a human). */
function autoRejectGatedRegistry(registry: McpRegistry): McpRegistry {
  return new Proxy(registry, {
    get(target, prop, receiver) {
      if (prop === 'awaitDecision') return async () => 'reject' as const;
      const v = Reflect.get(target, prop, receiver);
      return typeof v === 'function' ? (v as (...a: unknown[]) => unknown).bind(target) : v;
    },
  }) as McpRegistry;
}

const AUTO_GATE = { resolveDecision: async () => 'auto' as const } as unknown as BreakpointService;

interface RecordedSse { sse: SseEmitter; events: Array<{ name: string; data: unknown }> }
function recordingSse(): RecordedSse {
  const events: Array<{ name: string; data: unknown }> = [];
  return {
    events,
    sse: {
      event: (name, data) => { events.push({ name, data }); },
      error: (message) => { events.push({ name: 'error', data: { message } }); },
      end: () => {},
    },
  };
}

function outcome(events: Array<{ name: string; data: unknown }>): { status: RunStatus; error?: string } {
  const err = events.find((e) => e.name === 'error');
  if (err) return { status: 'error', error: String((err.data as { message?: unknown })?.message ?? 'error') };
  const sd = events.find((e) => e.name === 'swarm_done') as { data?: { status?: string } } | undefined;
  if (sd?.data?.status === 'error') return { status: 'error' };
  if (sd?.data?.status === 'rejected') return { status: 'rejected' };
  return { status: 'success' };
}

export interface ScheduleRunnerDeps {
  store: { createRun(id: string): string; setRunSession(runId: string, s: string): void; finishRun(runId: string, st: RunStatus, e?: string): void };
  historyStore: HistoryStore;
  contextStore?: ContextStore;
  providers?: ProviderRegistry;
  subAgentsStore?: SubAgentsStore;
  mcpRegistry?: McpRegistry;
  breakpointService?: BreakpointService;
  swarmStore?: SwarmStore;
  swarmApprovals?: SwarmApprovalRegistry;
  /** Overridable for tests; defaults to building a real per-run DispatchService. */
  buildDispatcher?: (autonomy: Autonomy) => { handle: DispatchService['handle'] };
  /** Overridable for tests. */
  runSwarm?: typeof realRunSwarm;
}

export class ScheduleRunner {
  constructor(private readonly deps: ScheduleRunnerDeps) {}

  private buildDispatcher(autonomy: Autonomy): { handle: DispatchService['handle'] } {
    if (this.deps.buildDispatcher) return this.deps.buildDispatcher(autonomy);
    const registry = autonomy === 'trusted'
      ? this.deps.mcpRegistry
      : this.deps.mcpRegistry ? autoRejectGatedRegistry(this.deps.mcpRegistry) : undefined;
    const breakpointService = autonomy === 'trusted' ? AUTO_GATE : this.deps.breakpointService;
    return new DispatchService({
      providers: this.deps.providers!,
      historyStore: this.deps.historyStore,
      contextStore: this.deps.contextStore!,
      subAgentsStore: this.deps.subAgentsStore,
      mcpRegistry: registry,
      breakpointService,
    });
  }

  async run(schedule: Schedule): Promise<void> {
    const runId = this.deps.store.createRun(schedule.id);
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), MAX_RUN_MS);
    const rec = recordingSse();
    try {
      const dispatcher = this.buildDispatcher(schedule.autonomy);

      if (schedule.target.kind === 'prompt') {
        const session = await this.deps.historyStore.createEmpty({
          providerName: schedule.providerName, workspaceId: schedule.workspaceId,
        });
        this.deps.store.setRunSession(runId, session.id);
        const subAgent = schedule.target.subAgent;
        const message = subAgent ? `@${subAgent} ${schedule.target.prompt}` : schedule.target.prompt;
        await dispatcher.handle({ sessionId: session.id, message, providerName: schedule.providerName }, rec.sse, ctrl.signal);
      } else {
        let first: string | null = null;
        const createSession = async () => {
          const id = (await this.deps.historyStore.createEmpty({
            providerName: schedule.providerName, workspaceId: schedule.workspaceId,
          })).id;
          if (!first) { first = id; this.deps.store.setRunSession(runId, id); }
          return id;
        };
        const swarmId = schedule.target.swarmId;
        const input = schedule.target.input ?? '';
        await (this.deps.runSwarm ?? realRunSwarm)(
          {
            store: this.deps.swarmStore!,
            subAgentsStore: this.deps.subAgentsStore!,
            dispatcher,
            createSession,
            approvals: this.deps.swarmApprovals!,
          },
          { swarmId, input },
          rec.sse, ctrl.signal,
        );
      }

      const { status, error } = outcome(rec.events);
      this.deps.store.finishRun(runId, status, error);
    } catch (e) {
      this.deps.store.finishRun(runId, 'error', e instanceof Error ? e.message : 'run failed');
    } finally {
      clearTimeout(timer);
    }
  }
}
```

- [ ] **Step 4: Run test + lint**

Run: `npx vitest run --project backend server/domain/schedules && npm run lint`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/domain/schedules/schedule-runner.ts server/domain/schedules/schedule-runner.test.ts
git commit -m "feat(schedules): ScheduleRunner with per-run gating override (safe rejects gated; trusted auto-approves)"
```

---

## Task 4: SchedulerService (poller, injectable clock)

**Files:**
- Create: `server/domain/schedules/scheduler.service.ts`
- Test: `server/domain/schedules/scheduler.service.test.ts`

- [ ] **Step 1: Write the failing test** — `server/domain/schedules/scheduler.service.test.ts`:

```ts
import { SchedulerService } from './scheduler.service';
import type { Schedule } from './schedules.types';

function sched(id: string, nextRunAt: number | null, everyMs = 60_000): Schedule {
  return {
    id, name: id, cadence: { kind: 'interval', everyMs },
    target: { kind: 'prompt', prompt: 'x' }, autonomy: 'safe',
    enabled: true, nextRunAt, createdAt: 0, updatedAt: 0,
  };
}

describe('SchedulerService.tick', () => {
  it('fires due schedules, advances nextRunAt, skips not-due', async () => {
    const due = [sched('a', 1000), sched('b', 5000)];
    const advanced: Record<string, number> = {};
    const ran: string[] = [];
    const store = {
      listDue: (now: number) => due.filter((s) => s.nextRunAt! <= now),
      setNextRunAt: (id: string, n: number | null) => { advanced[id] = n ?? -1; },
      update: () => {},
    };
    const runner = { run: async (s: Schedule) => { ran.push(s.id); } };
    const svc = new SchedulerService({ store: store as never, runner, now: () => 3000 });
    await svc.tick();
    expect(ran).toEqual(['a']);          // only 'a' is due at now=3000
    expect(advanced['a']).toBe(3000 + 60_000);
    expect(advanced['b']).toBeUndefined();
  });

  it('does not re-fire an already-running schedule', async () => {
    const s = sched('a', 1000);
    const ran: string[] = [];
    let release!: () => void;
    const store = { listDue: () => [s], setNextRunAt: () => {}, update: () => {} };
    const runner = { run: (sc: Schedule) => new Promise<void>((r) => { ran.push(sc.id); release = r; }) };
    const svc = new SchedulerService({ store: store as never, runner, now: () => 3000 });
    await svc.tick();   // starts 'a' (still running)
    await svc.tick();   // 'a' running → skipped
    expect(ran).toEqual(['a']);
    release();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run --project backend server/domain/schedules/scheduler.service.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement** — `server/domain/schedules/scheduler.service.ts`:

```ts
import { computeNextRunAt } from './next-run';
import type { Schedule } from './schedules.types';

const TICK_MS = 30_000;

export interface SchedulerDeps {
  store: {
    listDue(now: number): Schedule[];
    setNextRunAt(id: string, nextRunAt: number | null): void;
    update(id: string, patch: { lastRunAt?: number }): unknown;
  };
  runner: { run(schedule: Schedule): Promise<void> };
  now: () => number;
}

export class SchedulerService {
  private timer: ReturnType<typeof setInterval> | null = null;
  private readonly running = new Set<string>();

  constructor(private readonly deps: SchedulerDeps) {}

  start(): void {
    if (this.timer) return;
    void this.tick(); // boot catch-up
    this.timer = setInterval(() => void this.tick(), TICK_MS);
  }

  stop(): void {
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
  }

  async tick(): Promise<void> {
    const t = this.deps.now();
    for (const s of this.deps.store.listDue(t)) {
      if (this.running.has(s.id)) continue;
      // Advance BEFORE firing so the next tick doesn't re-fire the same schedule.
      try {
        this.deps.store.setNextRunAt(s.id, computeNextRunAt(s.cadence, t));
        this.deps.store.update(s.id, { lastRunAt: t });
      } catch {
        // A broken cadence shouldn't wedge the loop; skip this schedule.
        continue;
      }
      this.running.add(s.id);
      void this.deps.runner.run(s).catch(() => {}).finally(() => this.running.delete(s.id));
    }
  }
}
```

- [ ] **Step 4: Run test + lint**

Run: `npx vitest run --project backend server/domain/schedules && npm run lint`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/domain/schedules/scheduler.service.ts server/domain/schedules/scheduler.service.test.ts
git commit -m "feat(schedules): SchedulerService poller (injectable clock, no-overlap, catch-up)"
```

---

## Task 5: Routes + bootstrap wiring

**Files:**
- Create: `server/routes/schedules.routes.ts`
- Modify: `server/app.ts` (AppDeps + mount)
- Modify: `server/index.ts` (construct store/runner/scheduler; start/stop)
- Test: `server/routes/schedules.routes.test.ts`

- [ ] **Step 1: Write the failing route test** — `server/routes/schedules.routes.test.ts`:

```ts
import request from 'supertest';
import express from 'express';
import { makeTestDb } from '@/server/test/test-db';
import { ScheduleStore } from '@/server/domain/schedules/schedules.store';
import { createScheduleRoutes } from './schedules.routes';
import { isAppError } from '@/server/lib/errors';
import type { DatabaseHandle } from '@/server/db/database';

let db: DatabaseHandle; let app: express.Express; let store: ScheduleStore;
const runner = { run: async () => {} };

beforeEach(() => {
  db = makeTestDb();
  store = new ScheduleStore(db);
  app = express();
  app.use(express.json());
  app.use('/api/schedules', createScheduleRoutes(store, runner));
  app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    if (isAppError(err)) { res.status(err.status).json({ error: { code: err.code, message: err.message } }); return; }
    res.status(500).json({ error: { code: 'INTERNAL', message: 'x' } });
  });
});
afterEach(() => db.close());

describe('schedule routes', () => {
  it('POST / creates; GET / lists; bad cron → 400', async () => {
    const create = await request(app).post('/api/schedules').send({
      name: 'n', cadence: { kind: 'cron', expr: '0 3 * * *' }, target: { kind: 'prompt', prompt: 'p' },
    });
    expect(create.status).toBe(201);
    const list = await request(app).get('/api/schedules');
    expect(list.body.schedules).toHaveLength(1);
    const bad = await request(app).post('/api/schedules').send({
      name: 'n', cadence: { kind: 'cron', expr: 'nope' }, target: { kind: 'prompt', prompt: 'p' },
    });
    expect(bad.status).toBe(400);
  });

  it('POST /:id/run fires the runner', async () => {
    const s = store.create({ name: 'n', cadence: { kind: 'interval', everyMs: 60_000 }, target: { kind: 'prompt', prompt: 'p' } });
    const res = await request(app).post(`/api/schedules/${s.id}/run`);
    expect(res.status).toBe(202);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run --project backend server/routes/schedules.routes.test.ts`
Expected: FAIL — route module not found.

- [ ] **Step 3: Implement the routes** — `server/routes/schedules.routes.ts`:

```ts
import { Router, type Request, type Response, type NextFunction } from 'express';
import { ValidationError, NotFoundError } from '@/server/lib/errors';
import { ScheduleCreateSchema, ScheduleUpdateSchema } from '@/server/domain/schedules/schedules.schema';
import { computeNextRunAt } from '@/server/domain/schedules/next-run';
import type { ScheduleStore } from '@/server/domain/schedules/schedules.store';
import type { Schedule } from '@/server/domain/schedules/schedules.types';

function asyncHandler(fn: (req: Request, res: Response, next: NextFunction) => Promise<void>) {
  return (req: Request, res: Response, next: NextFunction) => { fn(req, res, next).catch(next); };
}

/** Recompute next_run_at when a schedule is enabled (else null). */
function reschedule(store: ScheduleStore, s: Schedule): void {
  store.setNextRunAt(s.id, s.enabled ? computeNextRunAt(s.cadence, Date.now()) : null);
}

export function createScheduleRoutes(
  store: ScheduleStore,
  runner: { run(s: Schedule): Promise<void> },
): Router {
  const router = Router();

  router.get('/', asyncHandler(async (_req, res) => {
    res.json({ schedules: store.list() });
  }));

  router.post('/', asyncHandler(async (req, res) => {
    const parsed = ScheduleCreateSchema.safeParse(req.body);
    if (!parsed.success) throw new ValidationError('Invalid schedule', parsed.error);
    const s = store.create(parsed.data);
    reschedule(store, s);
    res.status(201).json(store.get(s.id));
  }));

  router.get('/:id', asyncHandler(async (req, res) => {
    const s = store.get(req.params.id);
    if (!s) throw new NotFoundError(`schedule ${req.params.id}`);
    res.json(s);
  }));

  router.put('/:id', asyncHandler(async (req, res) => {
    const parsed = ScheduleUpdateSchema.safeParse(req.body);
    if (!parsed.success) throw new ValidationError('Invalid schedule', parsed.error);
    if (!store.get(req.params.id)) throw new NotFoundError(`schedule ${req.params.id}`);
    const s = store.update(req.params.id, parsed.data);
    reschedule(store, s);
    res.json(store.get(s.id));
  }));

  router.delete('/:id', asyncHandler(async (req, res) => {
    store.delete(req.params.id);
    res.status(204).end();
  }));

  router.post('/:id/run', asyncHandler(async (req, res) => {
    const s = store.get(req.params.id);
    if (!s) throw new NotFoundError(`schedule ${req.params.id}`);
    void runner.run(s).catch(() => {}); // fire-and-record; don't block the response
    res.status(202).json({ ok: true });
  }));

  router.get('/:id/runs', asyncHandler(async (req, res) => {
    if (!store.get(req.params.id)) throw new NotFoundError(`schedule ${req.params.id}`);
    res.json({ runs: store.listRuns(req.params.id, 20) });
  }));

  return router;
}
```

- [ ] **Step 4: Wire AppDeps + mount** — in `server/app.ts`: import `createScheduleRoutes` + the types; add to `AppDeps`:
```ts
  scheduleStore?: import('./domain/schedules/schedules.store').ScheduleStore;
  scheduleRunner?: { run(s: import('./domain/schedules/schedules.types').Schedule): Promise<void> };
```
and add a mount block (near the swarms block):
```ts
  if (deps.scheduleStore && deps.scheduleRunner) {
    app.use('/api/schedules', createScheduleRoutes(deps.scheduleStore, deps.scheduleRunner));
  }
```

- [ ] **Step 5: Wire index.ts bootstrap** — in `server/index.ts`, after the `swarmOrchestratorDeps` block (around line 203), add:
```ts
  const scheduleStore = new ScheduleStore(db);
  const scheduleRunner = new ScheduleRunner({
    store: scheduleStore,
    historyStore, contextStore, providers, subAgentsStore,
    mcpRegistry, breakpointService,
    swarmStore, swarmApprovals,
  });
  const scheduler = new SchedulerService({ store: scheduleStore, runner: scheduleRunner, now: () => Date.now() });
```
add `scheduleStore, scheduleRunner` to the `createApp({...})` deps object, and after `app.listen(...)` (and its callback) add:
```ts
  if (process.env.AETHER_SCHEDULER !== '0') scheduler.start();
  process.on('SIGTERM', () => scheduler.stop());
  process.on('SIGINT', () => scheduler.stop());
```
(Place imports for `ScheduleStore`, `ScheduleRunner`, `SchedulerService` at the top with the other domain imports.)

- [ ] **Step 6: Run tests + lint + smoke the bootstrap**

Run: `npx vitest run --project backend server/routes/schedules.routes.test.ts server/domain/schedules && npm run lint`
Expected: PASS. Also `npx vitest run --project backend server/app` if an app-level test exists — green (wiring intact).

- [ ] **Step 7: Commit**

```bash
git add server/routes/schedules.routes.ts server/routes/schedules.routes.test.ts server/app.ts server/index.ts
git commit -m "feat(schedules): HTTP routes + bootstrap wiring (scheduler start/stop)"
```

---

## Task 6: Frontend api + store

**Files:**
- Create: `src/lib/api/schedules.api.ts`
- Create: `src/stores/schedules.store.ts`
- Test: `src/stores/schedules.store.test.ts`

- [ ] **Step 1: Implement the api** — `src/lib/api/schedules.api.ts`:

```ts
export type Cadence = { kind: 'cron'; expr: string } | { kind: 'interval'; everyMs: number };
export type Target =
  | { kind: 'prompt'; prompt: string; subAgent?: string }
  | { kind: 'swarm'; swarmId: string; input?: string };
export interface Schedule {
  id: string; name: string; cadence: Cadence; target: Target;
  autonomy: 'safe' | 'trusted'; providerName?: string; workspaceId?: string;
  enabled: boolean; nextRunAt: number | null; lastRunAt?: number; createdAt: number; updatedAt: number;
}
export interface ScheduleRun {
  id: string; scheduleId: string; sessionId: string | null;
  startedAt: number; finishedAt?: number; status: 'running' | 'success' | 'error' | 'rejected'; error?: string;
}
export interface ScheduleInput {
  name: string; cadence: Cadence; target: Target;
  autonomy?: 'safe' | 'trusted'; providerName?: string; workspaceId?: string; enabled?: boolean;
}

async function jsonOrThrow<T>(res: Response): Promise<T> {
  if (!res.ok) throw new Error(`Request failed: ${res.status}`);
  return (await res.json()) as T;
}
function post(url: string, body?: unknown): Promise<Response> {
  return fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
}

export const schedulesApi = {
  list: async (): Promise<Schedule[]> =>
    (await jsonOrThrow<{ schedules: Schedule[] }>(await fetch('/api/schedules'))).schedules,
  create: async (input: ScheduleInput): Promise<Schedule> => jsonOrThrow<Schedule>(await post('/api/schedules', input)),
  update: async (id: string, input: Partial<ScheduleInput>): Promise<Schedule> =>
    jsonOrThrow<Schedule>(await fetch(`/api/schedules/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) })),
  remove: async (id: string): Promise<void> => { const r = await fetch(`/api/schedules/${id}`, { method: 'DELETE' }); if (!r.ok) throw new Error(`Request failed: ${r.status}`); },
  runNow: async (id: string): Promise<void> => { const r = await post(`/api/schedules/${id}/run`); if (!r.ok) throw new Error(`Request failed: ${r.status}`); },
  runs: async (id: string): Promise<ScheduleRun[]> =>
    (await jsonOrThrow<{ runs: ScheduleRun[] }>(await fetch(`/api/schedules/${id}/runs`))).runs,
};
```

- [ ] **Step 2: Write the failing store test** — `src/stores/schedules.store.test.ts`:

```ts
import { useSchedulesStore } from './schedules.store';

vi.mock('@/src/lib/api/schedules.api', () => ({
  schedulesApi: { list: vi.fn(), create: vi.fn(), update: vi.fn(), remove: vi.fn(), runNow: vi.fn(), runs: vi.fn() },
}));
import { schedulesApi } from '@/src/lib/api/schedules.api';

beforeEach(() => { useSchedulesStore.setState({ list: [], hydrated: false, error: null }); vi.clearAllMocks(); });

describe('useSchedulesStore', () => {
  it('init loads the list', async () => {
    vi.mocked(schedulesApi.list).mockResolvedValue([{ id: 's1', name: 'n' } as never]);
    await useSchedulesStore.getState().init();
    expect(useSchedulesStore.getState().list).toHaveLength(1);
    expect(useSchedulesStore.getState().hydrated).toBe(true);
  });

  it('create prepends', async () => {
    vi.mocked(schedulesApi.create).mockResolvedValue({ id: 's2', name: 'm' } as never);
    await useSchedulesStore.getState().create({ name: 'm', cadence: { kind: 'interval', everyMs: 60_000 }, target: { kind: 'prompt', prompt: 'x' } });
    expect(useSchedulesStore.getState().list[0].id).toBe('s2');
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run --project frontend src/stores/schedules.store.test.ts`
Expected: FAIL — store not found.

- [ ] **Step 4: Implement the store** — `src/stores/schedules.store.ts` (mirror `swarms.store.ts`):

```ts
import { create } from 'zustand';
import { schedulesApi, type Schedule, type ScheduleInput } from '@/src/lib/api/schedules.api';

interface SchedulesState {
  list: Schedule[];
  hydrated: boolean;
  error: string | null;
  init: () => Promise<void>;
  create: (input: ScheduleInput) => Promise<void>;
  update: (id: string, input: Partial<ScheduleInput>) => Promise<void>;
  remove: (id: string) => Promise<void>;
  runNow: (id: string) => Promise<void>;
  clearError: () => void;
}

export const useSchedulesStore = create<SchedulesState>((set, get) => ({
  list: [], hydrated: false, error: null,
  init: async () => {
    try { set({ list: await schedulesApi.list(), hydrated: true }); }
    catch (e) { set({ hydrated: true, error: e instanceof Error ? e.message : 'load failed' }); }
  },
  create: async (input) => {
    try { set({ list: [await schedulesApi.create(input), ...get().list] }); }
    catch (e) { set({ error: e instanceof Error ? e.message : 'create failed' }); }
  },
  update: async (id, input) => {
    try { const s = await schedulesApi.update(id, input); set({ list: get().list.map((x) => (x.id === id ? s : x)) }); }
    catch (e) { set({ error: e instanceof Error ? e.message : 'update failed' }); }
  },
  remove: async (id) => {
    const prev = get().list;
    set({ list: prev.filter((x) => x.id !== id) });
    try { await schedulesApi.remove(id); }
    catch (e) { set({ list: prev, error: e instanceof Error ? e.message : 'delete failed' }); }
  },
  runNow: async (id) => {
    try { await schedulesApi.runNow(id); }
    catch (e) { set({ error: e instanceof Error ? e.message : 'run failed' }); }
  },
  clearError: () => set({ error: null }),
}));
```

- [ ] **Step 5: Run test + lint**

Run: `npx vitest run --project frontend src/stores/schedules.store.test.ts && npm run lint`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/api/schedules.api.ts src/stores/schedules.store.ts src/stores/schedules.store.test.ts
git commit -m "feat(schedules): frontend api + Zustand store"
```

---

## Task 7: SchedulesSection + ScheduleEditModal

**Files:**
- Create: `src/components/sidebar/SchedulesSection.tsx`
- Create: `src/components/schedules/ScheduleEditModal.tsx`
- Modify: `src/App.tsx` (init the store + render the section in the sidebar)
- Test: `src/components/sidebar/SchedulesSection.test.tsx`

- [ ] **Step 1: Write the failing smoke test** — `src/components/sidebar/SchedulesSection.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import { SchedulesSection } from './SchedulesSection';
import { useSchedulesStore } from '@/src/stores/schedules.store';

it('lists schedules with their cadence summary', () => {
  useSchedulesStore.setState({
    hydrated: true, error: null,
    list: [{ id: 's1', name: 'nightly', cadence: { kind: 'cron', expr: '0 3 * * *' }, target: { kind: 'prompt', prompt: 'x' }, autonomy: 'safe', enabled: true, nextRunAt: 1, createdAt: 0, updatedAt: 0 }] as never,
  });
  render(<SchedulesSection />);
  expect(screen.getByText('nightly')).toBeInTheDocument();
  expect(screen.getByText(/0 3 \* \* \*/)).toBeInTheDocument();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run --project frontend src/components/sidebar/SchedulesSection.test.tsx`
Expected: FAIL — component not found.

- [ ] **Step 3: Implement `SchedulesSection`** — `src/components/sidebar/SchedulesSection.tsx`:

```tsx
import { useState } from 'react';
import { Play, Pencil, Trash2 } from 'lucide-react';
import { useSchedulesStore } from '@/src/stores/schedules.store';
import { ScheduleEditModal } from '@/src/components/schedules/ScheduleEditModal';
import type { Cadence } from '@/src/lib/api/schedules.api';

function cadenceSummary(c: Cadence): string {
  return c.kind === 'cron' ? c.expr : `every ${Math.round(c.everyMs / 60_000)}m`;
}

export function SchedulesSection() {
  const list = useSchedulesStore((s) => s.list);
  const remove = useSchedulesStore((s) => s.remove);
  const runNow = useSchedulesStore((s) => s.runNow);
  const [editing, setEditing] = useState<string | 'new' | null>(null);

  return (
    <section>
      <div className="flex items-center justify-between mb-2">
        <div className="mono-label">Schedules</div>
        <button type="button" className="text-[10px] text-manipulation hover:underline" onClick={() => setEditing('new')}>
          + New
        </button>
      </div>
      <div className="space-y-1">
        {list.map((s) => (
          <div key={s.id} className="flex items-center gap-1.5 p-1.5 bg-zinc-900 border border-border-subtle rounded text-[10px] font-mono">
            <span className={`status-dot ${s.enabled ? 'bg-status-online' : 'bg-zinc-600'}`} aria-hidden="true" />
            <span className="min-w-0 flex-1 truncate text-zinc-300">
              {s.name} <span className="text-zinc-600">({cadenceSummary(s.cadence)})</span>
            </span>
            <button type="button" aria-label={`Run ${s.name} now`} onClick={() => void runNow(s.id)} className="icon-btn"><Play size={12} aria-hidden="true" /></button>
            <button type="button" aria-label={`Edit ${s.name}`} onClick={() => setEditing(s.id)} className="icon-btn"><Pencil size={12} aria-hidden="true" /></button>
            <button type="button" aria-label={`Delete ${s.name}`} onClick={() => void remove(s.id)} className="icon-btn hover:text-status-error"><Trash2 size={12} aria-hidden="true" /></button>
          </div>
        ))}
      </div>
      {editing && <ScheduleEditModal id={editing} onClose={() => setEditing(null)} />}
    </section>
  );
}
```

- [ ] **Step 4: Implement `ScheduleEditModal`** — `src/components/schedules/ScheduleEditModal.tsx`:

```tsx
import { useState } from 'react';
import { Modal } from '@/src/components/ui/Modal';
import { Button } from '@/src/components/ui/Button';
import { useSchedulesStore } from '@/src/stores/schedules.store';
import { useSwarmsStore } from '@/src/stores/swarms.store';
import type { Cadence, Target } from '@/src/lib/api/schedules.api';

export function ScheduleEditModal({ id, onClose }: { id: string | 'new'; onClose: () => void }) {
  const existing = useSchedulesStore((s) => (id === 'new' ? undefined : s.list.find((x) => x.id === id)));
  const create = useSchedulesStore((s) => s.create);
  const update = useSchedulesStore((s) => s.update);
  const swarms = useSwarmsStore((s) => s.list);

  const [name, setName] = useState(existing?.name ?? '');
  const [cronExpr, setCronExpr] = useState(existing?.cadence.kind === 'cron' ? existing.cadence.expr : '0 3 * * *');
  const [cadenceKind, setCadenceKind] = useState<Cadence['kind']>(existing?.cadence.kind ?? 'cron');
  const [everyMin, setEveryMin] = useState(existing?.cadence.kind === 'interval' ? Math.round(existing.cadence.everyMs / 60_000) : 60);
  const [targetKind, setTargetKind] = useState<Target['kind']>(existing?.target.kind ?? 'prompt');
  const [prompt, setPrompt] = useState(existing?.target.kind === 'prompt' ? existing.target.prompt : '');
  const [subAgent, setSubAgent] = useState(existing?.target.kind === 'prompt' ? (existing.target.subAgent ?? '') : '');
  const [swarmId, setSwarmId] = useState(existing?.target.kind === 'swarm' ? existing.target.swarmId : (swarms[0]?.id ?? ''));
  const [autonomy, setAutonomy] = useState<'safe' | 'trusted'>(existing?.autonomy ?? 'safe');
  const [enabled, setEnabled] = useState(existing?.enabled ?? true);

  const cadence: Cadence = cadenceKind === 'cron' ? { kind: 'cron', expr: cronExpr } : { kind: 'interval', everyMs: everyMin * 60_000 };
  const target: Target = targetKind === 'prompt'
    ? { kind: 'prompt', prompt, ...(subAgent ? { subAgent } : {}) }
    : { kind: 'swarm', swarmId };
  const valid = name.trim() && (targetKind === 'prompt' ? prompt.trim() : swarmId);

  const save = async () => {
    const input = { name, cadence, target, autonomy, enabled };
    if (id === 'new') await create(input); else await update(id, input);
    onClose();
  };

  return (
    <Modal open onClose={onClose} className="max-w-md">
      <h2 className="mono-label mb-3">{id === 'new' ? 'New schedule' : 'Edit schedule'}</h2>
      <div className="space-y-3 text-sm">
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name" aria-label="Name" className="w-full rounded border border-border-subtle bg-surface-0 p-2" />
        <div className="flex gap-2">
          <select value={cadenceKind} onChange={(e) => setCadenceKind(e.target.value as Cadence['kind'])} aria-label="Cadence kind" className="rounded border border-border-subtle bg-surface-0 p-2">
            <option value="cron">cron</option><option value="interval">interval</option>
          </select>
          {cadenceKind === 'cron'
            ? <input value={cronExpr} onChange={(e) => setCronExpr(e.target.value)} aria-label="Cron expression" placeholder="0 3 * * *" className="flex-1 rounded border border-border-subtle bg-surface-0 p-2 font-mono" />
            : <input type="number" min={1} value={everyMin} onChange={(e) => setEveryMin(Number(e.target.value))} aria-label="Every minutes" className="flex-1 rounded border border-border-subtle bg-surface-0 p-2" />}
        </div>
        <div className="flex gap-2">
          <select value={targetKind} onChange={(e) => setTargetKind(e.target.value as Target['kind'])} aria-label="Target kind" className="rounded border border-border-subtle bg-surface-0 p-2">
            <option value="prompt">prompt</option><option value="swarm">swarm</option>
          </select>
          {targetKind === 'prompt'
            ? <input value={prompt} onChange={(e) => setPrompt(e.target.value)} aria-label="Prompt" placeholder="Prompt" className="flex-1 rounded border border-border-subtle bg-surface-0 p-2" />
            : <select value={swarmId} onChange={(e) => setSwarmId(e.target.value)} aria-label="Swarm" className="flex-1 rounded border border-border-subtle bg-surface-0 p-2">
                {swarms.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>}
        </div>
        {targetKind === 'prompt' && (
          <input value={subAgent} onChange={(e) => setSubAgent(e.target.value)} aria-label="Sub-agent (optional)" placeholder="@subagent (optional)" className="w-full rounded border border-border-subtle bg-surface-0 p-2" />
        )}
        <label className="flex items-center gap-2 text-[12px]">
          <input type="checkbox" checked={autonomy === 'trusted'} onChange={(e) => setAutonomy(e.target.checked ? 'trusted' : 'safe')} aria-label="Trusted" />
          Trusted (auto-approve ALL tool calls — incl. dangerous). Default safe rejects gated tools.
        </label>
        <label className="flex items-center gap-2 text-[12px]">
          <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} aria-label="Enabled" /> Enabled
        </label>
      </div>
      <div className="flex justify-end gap-2 mt-4">
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button variant="primary" disabled={!valid} onClick={() => void save()}>Save</Button>
      </div>
    </Modal>
  );
}
```

- [ ] **Step 5: Wire into App.tsx** — add the import, init the store on mount (mirror the other `init*` hooks), and render `<SchedulesSection />` in the sidebar (after `<SwarmsSection />`):
```tsx
import { SchedulesSection } from '@/src/components/sidebar/SchedulesSection';
import { useSchedulesStore } from '@/src/stores/schedules.store';
// in App(): const initSchedules = useSchedulesStore((s) => s.init);
// in the useEffect body: initSchedules();
// add initSchedules to the effect deps array
// in the sidebar JSX after <SwarmsSection />: <SchedulesSection />
```

- [ ] **Step 6: Run test + lint + frontend suite**

Run: `npm run lint && npx vitest run --project frontend src/components/sidebar/SchedulesSection.test.tsx src/stores/schedules.store.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/components/sidebar/SchedulesSection.tsx src/components/schedules/ScheduleEditModal.tsx src/App.tsx src/components/sidebar/SchedulesSection.test.tsx
git commit -m "feat(schedules): SchedulesSection + ScheduleEditModal + App wiring"
```

---

## Task 8: i18n, a11y, full verification

- [ ] **Step 1: i18n** — extract the user-facing literals in `SchedulesSection`/`ScheduleEditModal` into a `schedules` section in `src/i18n/en.ts` and replace with `t('schedules.*')` (mirror the existing `git`/`gitChanges` sections). Keep English text identical so the smoke test passes.

- [ ] **Step 2: a11y** — confirm: every icon button + input/select has an `aria-label` (done above); the modal uses the shared `Modal` (already focus-trapped); no `dangerouslySetInnerHTML`.

- [ ] **Step 3: Full suite + build**

Run: `npm run lint && npm run test:run && npm run build`
Expected: lint clean; all tests green; build OK.

- [ ] **Step 4: Manual smoke**

```bash
AETHER_FAKE_PROVIDER=1 PORT=3943 AETHER_DATA_DIR=/tmp/aether-sched npm run dev
```
Create a schedule (interval: every 1m, prompt: "say hi"), enable it, click **Run now**, confirm a run record appears (`GET /api/schedules/:id/runs`) with `status: success` and a session in history. Kill the server + remove the scratch data dir.

- [ ] **Step 5: Commit**

```bash
git add src/i18n/en.ts src/components/sidebar/SchedulesSection.tsx src/components/schedules/ScheduleEditModal.tsx
git commit -m "feat(schedules): i18n strings + a11y polish"
```

---

## Task 9: Docs + PR

- [ ] **Step 1: Roadmap** — in `docs/superpowers/roadmap.md`, add a Shipped row for "Scheduled / background agents" and update the candidate one-liner (mark it shipped).

- [ ] **Step 2: Commit + PR**

```bash
git add docs/superpowers/roadmap.md
git commit -m "docs: mark scheduled/background agents shipped"
git push -u origin feat/scheduled-agents
gh pr create --base main --title "feat: scheduled / background agents" --body "<summary + test plan>"
```

---

## Notes on testing scope

- **No real time-passing in tests:** the `SchedulerService` takes an injected `now()` and the runner is faked, so ticks are deterministic. The pure `next-run` is tested with a fixed `fromMs`.
- **E2e (Playwright):** deferred (time-based; covered by injected-clock unit tests + the run-now manual smoke).
- **Coverage:** enforced globs (`server/domain/**`, `src/lib/**`, `src/stores/**`) are covered by the next-run/store/runner/scheduler/store-frontend tests.
