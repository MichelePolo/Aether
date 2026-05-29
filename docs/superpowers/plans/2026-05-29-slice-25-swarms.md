# Slice 25 — Multi-Agent Swarms Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Define and run linear sub-agent swarms (architect → coder → qa), streaming progress over SSE, with optional per-step human approval; each step's text output feeds the next step's prompt.

**Architecture:** SQLite-stored swarm definitions (relational, like sub-agents). A server-side orchestrator reuses `DispatchService.handle()` via a collecting SSE adapter that captures each turn's text and forwards events to the swarm stream. Runs are ephemeral on the SSE connection; the transcript is a per-run chat session. Per-step approval via an in-memory registry mirroring the breakpoint gate.

**Tech Stack:** Express, better-sqlite3, Zod, SSE, React 19 + Zustand, Vitest.

---

## Conventions

- `@/` aliases the repo root. Backend tests are colocated `*.test.ts` (node project), FE `*.test.ts(x)` (jsdom).
- Run a focused test: `npx vitest run <path>`. Type-check: `npm run lint`.
- `SseEmitter` is `{ event(name: string, data: unknown): void; error(message: string, retryable?: boolean): void; end(): void }` from `@/server/lib/sse`.
- `DatabaseHandle` from `@/server/db/database`; `NotFoundError`/`ValidationError` from `@/server/lib/errors`.
- Commit after each task with the message in its final step.

## File structure (locked)

```
server/db/migrations/011_swarms.sql           # NEW schema
server/domain/swarms/
  swarm.types.ts        # SwarmStep, SwarmRecord, SwarmMeta, SwarmRunStatus
  swarm.schema.ts       # zod create/update input
  swarm.store.ts        # CRUD + ordered steps (relational)
  swarm.approval.ts     # SwarmApprovalRegistry
  collecting-sse.ts     # capture text + forward events
  swarm.orchestrator.ts # runSwarm(deps, opts, sse, signal)
server/routes/swarms.routes.ts                # CRUD + /:id/run + /decision
server/app.ts, server/index.ts                # wiring

src/lib/api/swarms.api.ts                      # CRUD + run SSE
src/stores/swarms.store.ts                     # optimistic CRUD
src/hooks/useSwarmRun.ts                       # consume run SSE
src/components/swarms/SwarmEditModal.tsx
src/components/swarms/StepsListEditor.tsx
src/components/swarms/SwarmRunPanel.tsx
src/components/sidebar/SwarmsSection.tsx
src/i18n/*, src/App.tsx                         # strings + init wiring
docs/superpowers/roadmap.md                     # mark shipped
```

---

## Task 1: Schema + types + validation

**Files:**
- Create: `server/db/migrations/011_swarms.sql`
- Create: `server/domain/swarms/swarm.types.ts`
- Create: `server/domain/swarms/swarm.schema.ts`

- [ ] **Step 1: Write the migration**

`server/db/migrations/011_swarms.sql`:

```sql
CREATE TABLE swarms (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE swarm_steps (
  id TEXT PRIMARY KEY,
  swarm_id TEXT NOT NULL REFERENCES swarms(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  subagent_name TEXT NOT NULL,
  prompt_template TEXT NOT NULL DEFAULT '',
  pause_after INTEGER NOT NULL DEFAULT 0,
  UNIQUE (swarm_id, position)
);

CREATE INDEX idx_swarm_steps_swarm ON swarm_steps(swarm_id, position);
```

- [ ] **Step 2: Write the types**

`server/domain/swarms/swarm.types.ts`:

```ts
export interface SwarmStep {
  subAgentName: string;
  promptTemplate: string;
  pauseAfter: boolean;
}

export interface SwarmRecord {
  id: string;
  name: string;
  steps: SwarmStep[];
  createdAt: number;
  updatedAt: number;
}

export interface SwarmMeta {
  id: string;
  name: string;
  stepCount: number;
  createdAt: number;
  updatedAt: number;
}

export type SwarmRunStatus = 'done' | 'rejected' | 'error' | 'interrupted';
```

- [ ] **Step 3: Write the schema**

`server/domain/swarms/swarm.schema.ts`:

```ts
import { z } from 'zod';

export const SwarmStepSchema = z.object({
  subAgentName: z.string().min(1).max(80),
  promptTemplate: z.string().max(8000).default(''),
  pauseAfter: z.boolean().default(false),
});

export const SwarmCreateInputSchema = z.object({
  name: z.string().min(1).max(64),
  steps: z.array(SwarmStepSchema).max(20).default([]),
});

export const SwarmUpdateInputSchema = SwarmCreateInputSchema.partial();

export const SwarmRunInputSchema = z.object({
  input: z.string().min(1).max(20000),
});

export const SwarmDecisionSchema = z.object({
  approvalId: z.string().min(1),
  action: z.enum(['approve', 'reject']),
});
```

- [ ] **Step 4: Type-check**

Run: `npm run lint`
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add server/db/migrations/011_swarms.sql server/domain/swarms/swarm.types.ts server/domain/swarms/swarm.schema.ts
git commit -m "feat(slice-25): swarm schema, types, and zod validation"
```

---

## Task 2: Swarm store (relational CRUD)

**Files:**
- Create: `server/domain/swarms/swarm.store.ts`
- Test: `server/domain/swarms/swarm.store.test.ts`

The store follows the sub-agents pattern (transactions, child rows in `position` order, `findUniqueName`).

- [ ] **Step 1: Write the failing test**

`server/domain/swarms/swarm.store.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { openDatabase } from '@/server/db/database';
import { applyMigrations } from '@/server/db/migrate';
import path from 'node:path';
import { SwarmStore } from './swarm.store';

function freshDb() {
  const db = openDatabase(':memory:');
  applyMigrations(db, path.join(process.cwd(), 'server', 'db', 'migrations'));
  return db;
}

describe('SwarmStore', () => {
  let store: SwarmStore;
  beforeEach(() => {
    store = new SwarmStore(freshDb());
  });

  const steps = [
    { subAgentName: 'architect', promptTemplate: 'Design:', pauseAfter: true },
    { subAgentName: 'coder', promptTemplate: '', pauseAfter: false },
  ];

  it('creates and reads a swarm with ordered steps', async () => {
    const meta = await store.create({ name: 'build', steps });
    expect(meta.stepCount).toBe(2);
    const rec = await store.read(meta.id);
    expect(rec?.name).toBe('build');
    expect(rec?.steps.map((s) => s.subAgentName)).toEqual(['architect', 'coder']);
    expect(rec?.steps[0].pauseAfter).toBe(true);
    expect(rec?.steps[0].promptTemplate).toBe('Design:');
    expect(rec?.steps[1].pauseAfter).toBe(false);
  });

  it('list returns stepCount', async () => {
    await store.create({ name: 'a', steps });
    const list = await store.list();
    expect(list[0].stepCount).toBe(2);
  });

  it('read returns null for unknown id', async () => {
    expect(await store.read('nope')).toBeNull();
  });

  it('update replaces name and steps atomically', async () => {
    const meta = await store.create({ name: 'a', steps });
    await store.update(meta.id, { name: 'b', steps: [{ subAgentName: 'qa', promptTemplate: '', pauseAfter: false }] });
    const rec = await store.read(meta.id);
    expect(rec?.name).toBe('b');
    expect(rec?.steps.map((s) => s.subAgentName)).toEqual(['qa']);
  });

  it('delete removes the swarm and cascades steps', async () => {
    const meta = await store.create({ name: 'a', steps });
    await store.delete(meta.id);
    expect(await store.read(meta.id)).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run server/domain/swarms/swarm.store.test.ts`
Expected: FAIL — `Cannot find module './swarm.store'`.

- [ ] **Step 3: Implement the store**

`server/domain/swarms/swarm.store.ts`:

```ts
import { randomUUID } from 'node:crypto';
import { NotFoundError } from '@/server/lib/errors';
import type { DatabaseHandle } from '@/server/db/database';
import type { SwarmMeta, SwarmRecord, SwarmStep } from './swarm.types';

interface SwarmInput {
  name: string;
  steps?: SwarmStep[];
}

type SwarmRow = { id: string; name: string; created_at: number; updated_at: number };
type StepRow = { position: number; subagent_name: string; prompt_template: string; pause_after: number };

export class SwarmStore {
  constructor(private readonly db: DatabaseHandle) {}

  async list(): Promise<SwarmMeta[]> {
    const rows = this.db
      .prepare('SELECT id, name, created_at, updated_at FROM swarms ORDER BY updated_at DESC')
      .all() as SwarmRow[];
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      stepCount: (
        this.db.prepare('SELECT COUNT(*) AS n FROM swarm_steps WHERE swarm_id = ?').get(r.id) as { n: number }
      ).n,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    }));
  }

  async read(id: string): Promise<SwarmRecord | null> {
    const row = this.db
      .prepare('SELECT id, name, created_at, updated_at FROM swarms WHERE id = ?')
      .get(id) as SwarmRow | undefined;
    if (!row) return null;
    const steps = (
      this.db
        .prepare(
          'SELECT position, subagent_name, prompt_template, pause_after FROM swarm_steps WHERE swarm_id = ? ORDER BY position',
        )
        .all(id) as StepRow[]
    ).map((s): SwarmStep => ({
      subAgentName: s.subagent_name,
      promptTemplate: s.prompt_template,
      pauseAfter: s.pause_after === 1,
    }));
    return { id: row.id, name: row.name, steps, createdAt: row.created_at, updatedAt: row.updated_at };
  }

  async create(input: SwarmInput): Promise<SwarmMeta> {
    const id = randomUUID();
    const now = Date.now();
    const tx = this.db.transaction(() => {
      this.db
        .prepare('INSERT INTO swarms (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)')
        .run(id, input.name, now, now);
      this.writeSteps(id, input.steps ?? []);
    });
    tx();
    return this.metaOf(id);
  }

  async update(id: string, patch: { name?: string; steps?: SwarmStep[] }): Promise<SwarmMeta> {
    const tx = this.db.transaction(() => {
      const cur = this.db.prepare('SELECT name FROM swarms WHERE id = ?').get(id) as { name: string } | undefined;
      if (!cur) throw new NotFoundError(`swarm ${id}`);
      const now = Date.now();
      this.db
        .prepare('UPDATE swarms SET name = ?, updated_at = ? WHERE id = ?')
        .run(patch.name ?? cur.name, now, id);
      if (patch.steps) this.writeSteps(id, patch.steps);
    });
    tx();
    return this.metaOf(id);
  }

  async delete(id: string): Promise<void> {
    const info = this.db.prepare('DELETE FROM swarms WHERE id = ?').run(id);
    if (info.changes === 0) throw new NotFoundError(`swarm ${id}`);
  }

  private metaOf(id: string): SwarmMeta {
    const row = this.db
      .prepare('SELECT id, name, created_at, updated_at FROM swarms WHERE id = ?')
      .get(id) as SwarmRow;
    const n = (
      this.db.prepare('SELECT COUNT(*) AS n FROM swarm_steps WHERE swarm_id = ?').get(id) as { n: number }
    ).n;
    return { id: row.id, name: row.name, stepCount: n, createdAt: row.created_at, updatedAt: row.updated_at };
  }

  private writeSteps(id: string, steps: SwarmStep[]): void {
    this.db.prepare('DELETE FROM swarm_steps WHERE swarm_id = ?').run(id);
    const insert = this.db.prepare(
      'INSERT INTO swarm_steps (id, swarm_id, position, subagent_name, prompt_template, pause_after) VALUES (?, ?, ?, ?, ?, ?)',
    );
    steps.forEach((s, i) =>
      insert.run(randomUUID(), id, i, s.subAgentName, s.promptTemplate ?? '', s.pauseAfter ? 1 : 0),
    );
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run server/domain/swarms/swarm.store.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add server/domain/swarms/swarm.store.ts server/domain/swarms/swarm.store.test.ts
git commit -m "feat(slice-25): SwarmStore relational CRUD with ordered steps"
```

---

## Task 3: Approval registry

**Files:**
- Create: `server/domain/swarms/swarm.approval.ts`
- Test: `server/domain/swarms/swarm.approval.test.ts`

- [ ] **Step 1: Write the failing test**

`server/domain/swarms/swarm.approval.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { SwarmApprovalRegistry } from './swarm.approval';

describe('SwarmApprovalRegistry', () => {
  it('resolves with the submitted action', async () => {
    const reg = new SwarmApprovalRegistry();
    const p = reg.awaitDecision('a', 1000);
    reg.resolveDecision('a', 'approve');
    expect(await p).toBe('approve');
  });

  it('resolves to reject on timeout', async () => {
    vi.useFakeTimers();
    const reg = new SwarmApprovalRegistry();
    const p = reg.awaitDecision('b', 500);
    vi.advanceTimersByTime(500);
    await expect(p).resolves.toBe('reject');
    vi.useRealTimers();
  });

  it('resolveDecision for an unknown id is a no-op', () => {
    const reg = new SwarmApprovalRegistry();
    expect(() => reg.resolveDecision('nope', 'approve')).not.toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run server/domain/swarms/swarm.approval.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

`server/domain/swarms/swarm.approval.ts`:

```ts
export type SwarmDecision = 'approve' | 'reject';

interface Pending {
  resolve: (d: SwarmDecision) => void;
  timer: ReturnType<typeof setTimeout>;
}

export class SwarmApprovalRegistry {
  private pending = new Map<string, Pending>();

  awaitDecision(id: string, timeoutMs: number): Promise<SwarmDecision> {
    return new Promise<SwarmDecision>((resolve) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        resolve('reject');
      }, timeoutMs);
      this.pending.set(id, { resolve, timer });
    });
  }

  resolveDecision(id: string, action: SwarmDecision): void {
    const p = this.pending.get(id);
    if (!p) return;
    clearTimeout(p.timer);
    this.pending.delete(id);
    p.resolve(action);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run server/domain/swarms/swarm.approval.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add server/domain/swarms/swarm.approval.ts server/domain/swarms/swarm.approval.test.ts
git commit -m "feat(slice-25): SwarmApprovalRegistry (await/resolve/timeout)"
```

---

## Task 4: Collecting SSE adapter

**Files:**
- Create: `server/domain/swarms/collecting-sse.ts`
- Test: `server/domain/swarms/collecting-sse.test.ts`

- [ ] **Step 1: Write the failing test**

`server/domain/swarms/collecting-sse.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import type { SseEmitter } from '@/server/lib/sse';
import { createCollectingSse } from './collecting-sse';

function fakeOuter() {
  const events: { name: string; data: unknown }[] = [];
  let ended = false;
  const outer: SseEmitter = {
    event: (name, data) => events.push({ name, data }),
    error: (message, retryable) => events.push({ name: 'error', data: { message, retryable } }),
    end: () => {
      ended = true;
    },
  };
  return { outer, events, isEnded: () => ended };
}

describe('createCollectingSse', () => {
  it('accumulates text chunks', () => {
    const { outer } = fakeOuter();
    const c = createCollectingSse(outer);
    c.event('text', { chunk: 'hello ' });
    c.event('text', { chunk: 'world' });
    expect(c.text()).toBe('hello world');
  });

  it('forwards non-done events and swallows done', () => {
    const { outer, events } = fakeOuter();
    const c = createCollectingSse(outer);
    c.event('thinking', { chunk: 't' });
    c.event('done', { interrupted: false });
    expect(events.map((e) => e.name)).toEqual(['thinking']);
  });

  it('records an error event and exposes it via capturedError', () => {
    const { outer, events } = fakeOuter();
    const c = createCollectingSse(outer);
    c.event('error', { message: 'boom', retryable: false });
    expect(c.capturedError()).toEqual({ message: 'boom', retryable: false });
    expect(events.map((e) => e.name)).toEqual(['error']);
  });

  it('error() method records and forwards but does not end outer', () => {
    const { outer, isEnded } = fakeOuter();
    const c = createCollectingSse(outer);
    c.error('nope', true);
    expect(c.capturedError()).toEqual({ message: 'nope', retryable: true });
    expect(isEnded()).toBe(false);
  });

  it('end() does not close the outer stream', () => {
    const { outer, isEnded } = fakeOuter();
    const c = createCollectingSse(outer);
    c.end();
    expect(isEnded()).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run server/domain/swarms/collecting-sse.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

`server/domain/swarms/collecting-sse.ts`:

```ts
import type { SseEmitter } from '@/server/lib/sse';

export interface CollectingSse extends SseEmitter {
  text(): string;
  capturedError(): { message: string; retryable: boolean } | null;
}

/** Wraps an outer SSE emitter for a single dispatch turn: accumulates `text`
 *  chunks, records any `error`, forwards every event EXCEPT `done` to the outer
 *  stream, and never ends/closes the outer stream. */
export function createCollectingSse(outer: SseEmitter): CollectingSse {
  let buffer = '';
  let err: { message: string; retryable: boolean } | null = null;

  return {
    event(name, data) {
      if (name === 'text') {
        const chunk = (data as { chunk?: unknown })?.chunk;
        if (typeof chunk === 'string') buffer += chunk;
      } else if (name === 'error') {
        const d = data as { message?: string; retryable?: boolean };
        err = { message: d?.message ?? 'error', retryable: Boolean(d?.retryable) };
      }
      if (name !== 'done') outer.event(name, data);
    },
    error(message, retryable = false) {
      err = { message, retryable };
      outer.event('error', { message, retryable });
    },
    end() {
      // no-op: the inner turn ending must not close the swarm stream
    },
    text() {
      return buffer;
    },
    capturedError() {
      return err;
    },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run server/domain/swarms/collecting-sse.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add server/domain/swarms/collecting-sse.ts server/domain/swarms/collecting-sse.test.ts
git commit -m "feat(slice-25): collecting SSE adapter (capture text, forward events)"
```

---

## Task 5: Orchestrator

**Files:**
- Create: `server/domain/swarms/swarm.orchestrator.ts`
- Test: `server/domain/swarms/swarm.orchestrator.test.ts`

- [ ] **Step 1: Write the failing test**

`server/domain/swarms/swarm.orchestrator.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import type { SseEmitter } from '@/server/lib/sse';
import { runSwarm, type SwarmOrchestratorDeps } from './swarm.orchestrator';
import { SwarmApprovalRegistry } from './swarm.approval';

function recordingSse() {
  const events: { name: string; data: any }[] = [];
  const sse: SseEmitter = {
    event: (name, data) => events.push({ name, data: data as any }),
    error: (message) => events.push({ name: 'error', data: { message } }),
    end: () => {},
  };
  return { sse, events };
}

// Fake dispatcher: emits a text event "[<name> on <message>]" then done.
function fakeDispatcher(spy?: (msg: string) => void) {
  return {
    handle: async (body: { sessionId: string; message: string }, sse: SseEmitter) => {
      spy?.(body.message);
      sse.event('text', { chunk: `out:${body.message}` });
      sse.event('done', {});
    },
  };
}

function deps(over: Partial<SwarmOrchestratorDeps>): SwarmOrchestratorDeps {
  return {
    store: { read: vi.fn() } as any,
    subAgentsStore: { list: vi.fn(async () => [{ name: 'architect' }, { name: 'coder' }]) } as any,
    dispatcher: fakeDispatcher(),
    createSession: vi.fn(async () => 'sess-1'),
    approvals: new SwarmApprovalRegistry(),
    approvalTimeoutMs: 1000,
    ...over,
  };
}

const swarm = {
  id: 's1',
  name: 'build',
  steps: [
    { subAgentName: 'architect', promptTemplate: 'Design:', pauseAfter: false },
    { subAgentName: 'coder', promptTemplate: '', pauseAfter: false },
  ],
  createdAt: 0,
  updatedAt: 0,
};

describe('runSwarm', () => {
  it('runs steps in order, feeding output→input with template prefix', async () => {
    const seen: string[] = [];
    const d = deps({
      store: { read: vi.fn(async () => swarm) } as any,
      dispatcher: fakeDispatcher((m) => seen.push(m)),
    });
    const { sse, events } = recordingSse();
    await runSwarm(d, { swarmId: 's1', input: 'make a todo app' }, sse, new AbortController().signal);

    expect(seen[0]).toBe('@architect Design:\n\nmake a todo app');
    expect(seen[1]).toBe('@coder out:@architect Design:\n\nmake a todo app');
    const done = events.find((e) => e.name === 'swarm_done');
    expect(done?.data.status).toBe('done');
  });

  it('fails fast on unknown sub-agent', async () => {
    const bad = { ...swarm, steps: [{ subAgentName: 'ghost', promptTemplate: '', pauseAfter: false }] };
    const d = deps({ store: { read: vi.fn(async () => bad) } as any });
    const { sse, events } = recordingSse();
    await runSwarm(d, { swarmId: 's1', input: 'x' }, sse, new AbortController().signal);
    expect(events.find((e) => e.name === 'swarm_error')?.data.message).toMatch(/ghost/);
    expect(events.find((e) => e.name === 'swarm_done')?.data.status).toBe('error');
  });

  it('pauses for approval and stops on reject', async () => {
    const paused = { ...swarm, steps: [{ subAgentName: 'architect', promptTemplate: '', pauseAfter: true }, ...swarm.steps.slice(1)] };
    const approvals = new SwarmApprovalRegistry();
    const d = deps({ store: { read: vi.fn(async () => paused) } as any, approvals });
    const { sse, events } = recordingSse();
    const run = runSwarm(d, { swarmId: 's1', input: 'x' }, sse, new AbortController().signal);
    // wait a tick for the approval request to be emitted
    await new Promise((r) => setTimeout(r, 0));
    const req = events.find((e) => e.name === 'swarm_approval_request');
    expect(req).toBeTruthy();
    approvals.resolveDecision(req!.data.approvalId, 'reject');
    await run;
    expect(events.find((e) => e.name === 'swarm_done')?.data.status).toBe('rejected');
  });

  it('errors when the swarm has no steps', async () => {
    const d = deps({ store: { read: vi.fn(async () => ({ ...swarm, steps: [] })) } as any });
    const { sse, events } = recordingSse();
    await runSwarm(d, { swarmId: 's1', input: 'x' }, sse, new AbortController().signal);
    expect(events.find((e) => e.name === 'swarm_done')?.data.status).toBe('error');
  });

  it('reports error when a step dispatch emits an error event', async () => {
    const d = deps({
      store: { read: vi.fn(async () => swarm) } as any,
      dispatcher: {
        handle: async (_b: any, sse: SseEmitter) => {
          sse.event('error', { message: 'provider down', retryable: false });
        },
      },
    });
    const { sse, events } = recordingSse();
    await runSwarm(d, { swarmId: 's1', input: 'x' }, sse, new AbortController().signal);
    expect(events.find((e) => e.name === 'swarm_error')?.data.message).toMatch(/provider down/);
    expect(events.find((e) => e.name === 'swarm_done')?.data.status).toBe('error');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run server/domain/swarms/swarm.orchestrator.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

`server/domain/swarms/swarm.orchestrator.ts`:

```ts
import type { SseEmitter } from '@/server/lib/sse';
import { createCollectingSse } from './collecting-sse';
import type { SwarmApprovalRegistry } from './swarm.approval';
import type { SwarmRecord } from './swarm.types';

export interface SwarmDispatcher {
  handle(
    body: { sessionId: string; message: string },
    sse: SseEmitter,
    signal: AbortSignal,
  ): Promise<void>;
}

export interface SwarmOrchestratorDeps {
  store: { read(id: string): Promise<SwarmRecord | null> };
  subAgentsStore: { list(): Promise<{ name: string }[]> };
  dispatcher: SwarmDispatcher;
  createSession: () => Promise<string>;
  approvals: SwarmApprovalRegistry;
  approvalTimeoutMs?: number;
}

export interface RunOpts {
  swarmId: string;
  input: string;
}

export async function runSwarm(
  deps: SwarmOrchestratorDeps,
  opts: RunOpts,
  sse: SseEmitter,
  signal: AbortSignal,
): Promise<void> {
  const timeout = deps.approvalTimeoutMs ?? 300_000;

  const swarm = await deps.store.read(opts.swarmId);
  if (!swarm) {
    sse.event('swarm_error', { message: `swarm ${opts.swarmId} not found` });
    sse.event('swarm_done', { status: 'error' });
    sse.end();
    return;
  }
  if (swarm.steps.length === 0) {
    sse.event('swarm_error', { message: 'swarm has no steps' });
    sse.event('swarm_done', { status: 'error' });
    sse.end();
    return;
  }

  const known = new Set((await deps.subAgentsStore.list()).map((s) => s.name));
  const missing = swarm.steps.find((s) => !known.has(s.subAgentName));
  if (missing) {
    sse.event('swarm_error', { message: `unknown sub-agent: ${missing.subAgentName}` });
    sse.event('swarm_done', { status: 'error' });
    sse.end();
    return;
  }

  const sessionId = await deps.createSession();
  sse.event('swarm_started', { sessionId, swarmName: swarm.name, stepCount: swarm.steps.length });

  let incoming = opts.input;
  for (let i = 0; i < swarm.steps.length; i++) {
    if (signal.aborted) {
      sse.event('swarm_done', { status: 'interrupted' });
      sse.end();
      return;
    }
    const step = swarm.steps[i];
    sse.event('swarm_step_started', { position: i, subAgent: step.subAgentName });

    const message = step.promptTemplate ? `${step.promptTemplate}\n\n${incoming}` : incoming;
    const collector = createCollectingSse(sse);
    await deps.dispatcher.handle(
      { sessionId, message: `@${step.subAgentName} ${message}` },
      collector,
      signal,
    );

    const stepError = collector.capturedError();
    if (stepError) {
      sse.event('swarm_error', { position: i, message: stepError.message });
      sse.event('swarm_done', { status: 'error' });
      sse.end();
      return;
    }

    incoming = collector.text();
    sse.event('swarm_step_completed', { position: i, output: incoming });

    if (step.pauseAfter) {
      const approvalId = `${opts.swarmId}:${i}`;
      sse.event('swarm_approval_request', { approvalId, position: i, output: incoming });
      const action = await deps.approvals.awaitDecision(approvalId, timeout);
      if (action === 'reject') {
        sse.event('swarm_done', { status: 'rejected', stoppedAt: i });
        sse.end();
        return;
      }
    }
  }

  sse.event('swarm_done', { status: 'done', finalOutput: incoming });
  sse.end();
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run server/domain/swarms/swarm.orchestrator.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add server/domain/swarms/swarm.orchestrator.ts server/domain/swarms/swarm.orchestrator.test.ts
git commit -m "feat(slice-25): swarm orchestrator (linear run, output→input, approval gates)"
```

---

## Task 6: Routes + wiring

**Files:**
- Create: `server/routes/swarms.routes.ts`
- Test: `server/routes/swarms.routes.test.ts`
- Modify: `server/app.ts`, `server/index.ts`

- [ ] **Step 1: Write the failing test**

`server/routes/swarms.routes.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import path from 'node:path';
import { openDatabase } from '@/server/db/database';
import { applyMigrations } from '@/server/db/migrate';
import { SwarmStore } from '@/server/domain/swarms/swarm.store';
import { SwarmApprovalRegistry } from '@/server/domain/swarms/swarm.approval';
import { createSwarmRoutes } from './swarms.routes';
import { errorMiddleware } from '@/server/lib/errors';

function makeApp() {
  const db = openDatabase(':memory:');
  applyMigrations(db, path.join(process.cwd(), 'server', 'db', 'migrations'));
  const store = new SwarmStore(db);
  const approvals = new SwarmApprovalRegistry();
  const orchestratorDeps = {
    store,
    subAgentsStore: { list: async () => [] },
    dispatcher: { handle: async () => {} },
    createSession: async () => 'sess-1',
    approvals,
  };
  const app = express();
  app.use('/api/swarms', createSwarmRoutes(store, orchestratorDeps as any, approvals));
  app.use(errorMiddleware);
  return { app, approvals };
}

describe('swarms routes', () => {
  let app: express.Express;
  let approvals: SwarmApprovalRegistry;
  beforeEach(() => {
    ({ app, approvals } = makeApp());
  });

  it('CRUD: create, list, get, update, delete', async () => {
    const created = await request(app)
      .post('/api/swarms')
      .send({ name: 'build', steps: [{ subAgentName: 'architect', promptTemplate: '', pauseAfter: false }] });
    expect(created.status).toBe(201);
    const id = created.body.id;

    const list = await request(app).get('/api/swarms');
    expect(list.body.swarms).toHaveLength(1);

    const got = await request(app).get(`/api/swarms/${id}`);
    expect(got.body.name).toBe('build');
    expect(got.body.steps).toHaveLength(1);

    const upd = await request(app).put(`/api/swarms/${id}`).send({ name: 'build2' });
    expect(upd.body.name).toBe('build2');

    const del = await request(app).delete(`/api/swarms/${id}`);
    expect(del.status).toBe(204);
  });

  it('rejects an invalid create payload', async () => {
    const res = await request(app).post('/api/swarms').send({ steps: [] });
    expect(res.status).toBe(400);
  });

  it('404 for unknown swarm', async () => {
    const res = await request(app).get('/api/swarms/nope');
    expect(res.status).toBe(404);
  });

  it('decision endpoint resolves a pending approval', async () => {
    const p = approvals.awaitDecision('x', 1000);
    const res = await request(app).post('/api/swarms/decision').send({ approvalId: 'x', action: 'approve' });
    expect(res.status).toBe(200);
    expect(await p).toBe('approve');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run server/routes/swarms.routes.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the routes**

`server/routes/swarms.routes.ts`:

```ts
import express, { Router, type Request, type Response, type NextFunction } from 'express';
import { createSseEmitter } from '@/server/lib/sse';
import { ValidationError } from '@/server/lib/errors';
import {
  SwarmCreateInputSchema,
  SwarmUpdateInputSchema,
  SwarmRunInputSchema,
  SwarmDecisionSchema,
} from '@/server/domain/swarms/swarm.schema';
import type { SwarmStore } from '@/server/domain/swarms/swarm.store';
import type { SwarmApprovalRegistry } from '@/server/domain/swarms/swarm.approval';
import { runSwarm, type SwarmOrchestratorDeps } from '@/server/domain/swarms/swarm.orchestrator';

function asyncHandler(fn: (req: Request, res: Response, next: NextFunction) => Promise<void>) {
  return (req: Request, res: Response, next: NextFunction) => {
    fn(req, res, next).catch(next);
  };
}

export function createSwarmRoutes(
  store: SwarmStore,
  orchestratorDeps: SwarmOrchestratorDeps,
  approvals: SwarmApprovalRegistry,
): Router {
  const router = Router();
  router.use(express.json({ limit: '1mb' }));

  router.get(
    '/',
    asyncHandler(async (_req, res) => {
      res.json({ swarms: await store.list() });
    }),
  );

  router.post(
    '/',
    asyncHandler(async (req, res) => {
      const parsed = SwarmCreateInputSchema.safeParse(req.body);
      if (!parsed.success) throw new ValidationError('Invalid swarm payload', parsed.error);
      res.status(201).json(await store.create(parsed.data));
    }),
  );

  router.post(
    '/decision',
    asyncHandler(async (req, res) => {
      const parsed = SwarmDecisionSchema.safeParse(req.body);
      if (!parsed.success) throw new ValidationError('Invalid decision', parsed.error);
      approvals.resolveDecision(parsed.data.approvalId, parsed.data.action);
      res.json({ ok: true });
    }),
  );

  router.get(
    '/:id',
    asyncHandler(async (req, res) => {
      const rec = await store.read(req.params.id);
      if (!rec) {
        res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Swarm not found' } });
        return;
      }
      res.json(rec);
    }),
  );

  router.put(
    '/:id',
    asyncHandler(async (req, res) => {
      const parsed = SwarmUpdateInputSchema.safeParse(req.body);
      if (!parsed.success) throw new ValidationError('Invalid swarm body', parsed.error);
      res.json(await store.update(req.params.id, parsed.data));
    }),
  );

  router.delete(
    '/:id',
    asyncHandler(async (req, res) => {
      await store.delete(req.params.id);
      res.status(204).end();
    }),
  );

  router.post('/:id/run', express.json({ limit: '1mb' }), async (req: Request, res: Response) => {
    const parsed = SwarmRunInputSchema.safeParse(req.body);
    const sse = createSseEmitter(res);
    if (!parsed.success) {
      sse.event('swarm_error', { message: 'Invalid run input' });
      sse.event('swarm_done', { status: 'error' });
      sse.end();
      return;
    }
    const controller = new AbortController();
    res.on('close', () => {
      if (!res.writableEnded) controller.abort();
    });
    try {
      await runSwarm(orchestratorDeps, { swarmId: req.params.id, input: parsed.data.input }, sse, controller.signal);
    } catch (e) {
      sse.event('swarm_error', { message: e instanceof Error ? e.message : 'Internal error' });
      sse.event('swarm_done', { status: 'error' });
      sse.end();
    }
  });

  return router;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run server/routes/swarms.routes.test.ts`
Expected: PASS (4 tests).

> Note: confirm `errorMiddleware` is the exported name in `server/lib/errors.ts`. If the
> export differs (e.g. `errorHandler`), use that name in the test import — check with
> `grep "export" server/lib/errors.ts`.

- [ ] **Step 5: Wire into the composition root**

In `server/index.ts`, after the `subAgentsStore` is constructed and after `dispatcher` and `historyStore` exist, add:

```ts
import { SwarmStore } from './domain/swarms/swarm.store';
import { SwarmApprovalRegistry } from './domain/swarms/swarm.approval';
// ...
const swarmStore = new SwarmStore(db);
const swarmApprovals = new SwarmApprovalRegistry();
const swarmOrchestratorDeps = {
  store: swarmStore,
  subAgentsStore,
  dispatcher,
  createSession: async () => (await historyStore.createEmpty()).id,
  approvals: swarmApprovals,
};
```

and pass them into `createApp({ ..., swarmStore, swarmApprovals, swarmOrchestratorDeps })`.

In `server/app.ts`: add to `AppDeps`:

```ts
  swarmStore?: import('./domain/swarms/swarm.store').SwarmStore;
  swarmApprovals?: import('./domain/swarms/swarm.approval').SwarmApprovalRegistry;
  swarmOrchestratorDeps?: import('./domain/swarms/swarm.orchestrator').SwarmOrchestratorDeps;
```

and mount (near the other `app.use('/api/...')` blocks):

```ts
import { createSwarmRoutes } from './routes/swarms.routes';
// ...
if (deps.swarmStore && deps.swarmApprovals && deps.swarmOrchestratorDeps) {
  app.use('/api/swarms', createSwarmRoutes(deps.swarmStore, deps.swarmOrchestratorDeps, deps.swarmApprovals));
}
```

- [ ] **Step 6: Verify wiring**

Run: `npm run lint && npx vitest run server/routes/swarms.routes.test.ts`
Expected: lint clean, tests pass.

- [ ] **Step 7: Commit**

```bash
git add server/routes/swarms.routes.ts server/routes/swarms.routes.test.ts server/app.ts server/index.ts
git commit -m "feat(slice-25): swarm routes (CRUD + run SSE + decision) wired into app"
```

---

## Task 7: Frontend API client + store

**Files:**
- Create: `src/lib/api/swarms.api.ts`
- Create: `src/stores/swarms.store.ts`
- Test: `src/stores/swarms.store.test.ts`

- [ ] **Step 1: Write the API client**

`src/lib/api/swarms.api.ts`:

```ts
export interface SwarmStep {
  subAgentName: string;
  promptTemplate: string;
  pauseAfter: boolean;
}
export interface SwarmMeta {
  id: string;
  name: string;
  stepCount: number;
  createdAt: number;
  updatedAt: number;
}
export interface SwarmRecord extends SwarmMeta {
  steps: SwarmStep[];
}
export interface SwarmInput {
  name: string;
  steps: SwarmStep[];
}

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json() as Promise<T>;
}

export const swarmsApi = {
  list: async (): Promise<SwarmMeta[]> =>
    (await json<{ swarms: SwarmMeta[] }>(await fetch('/api/swarms'))).swarms,
  get: async (id: string): Promise<SwarmRecord> => json(await fetch(`/api/swarms/${id}`)),
  create: async (input: SwarmInput): Promise<SwarmMeta> =>
    json(
      await fetch('/api/swarms', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      }),
    ),
  update: async (id: string, input: Partial<SwarmInput>): Promise<SwarmMeta> =>
    json(
      await fetch(`/api/swarms/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      }),
    ),
  delete: async (id: string): Promise<void> => {
    const res = await fetch(`/api/swarms/${id}`, { method: 'DELETE' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
  },
  decision: async (approvalId: string, action: 'approve' | 'reject'): Promise<void> => {
    await fetch('/api/swarms/decision', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ approvalId, action }),
    });
  },
};
```

- [ ] **Step 2: Write the failing store test**

`src/stores/swarms.store.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useSwarmsStore } from './swarms.store';
import { swarmsApi } from '@/src/lib/api/swarms.api';

vi.mock('@/src/lib/api/swarms.api', () => ({
  swarmsApi: { list: vi.fn(), create: vi.fn(), update: vi.fn(), delete: vi.fn() },
}));

describe('swarms store', () => {
  beforeEach(() => {
    useSwarmsStore.setState({ list: [], hydrated: false, error: null });
    vi.clearAllMocks();
  });

  it('init loads the list', async () => {
    (swarmsApi.list as any).mockResolvedValue([{ id: '1', name: 'a', stepCount: 2, createdAt: 0, updatedAt: 0 }]);
    await useSwarmsStore.getState().init();
    expect(useSwarmsStore.getState().list).toHaveLength(1);
    expect(useSwarmsStore.getState().hydrated).toBe(true);
  });

  it('remove is optimistic and rolls back on error', async () => {
    useSwarmsStore.setState({
      list: [{ id: '1', name: 'a', stepCount: 0, createdAt: 0, updatedAt: 0 }],
      hydrated: true,
      error: null,
    });
    (swarmsApi.delete as any).mockRejectedValue(new Error('boom'));
    await useSwarmsStore.getState().remove('1');
    expect(useSwarmsStore.getState().list).toHaveLength(1); // rolled back
    expect(useSwarmsStore.getState().error).toBeTruthy();
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run src/stores/swarms.store.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 4: Implement the store**

`src/stores/swarms.store.ts`:

```ts
import { create } from 'zustand';
import { swarmsApi, type SwarmMeta, type SwarmInput } from '@/src/lib/api/swarms.api';

interface SwarmsState {
  list: SwarmMeta[];
  hydrated: boolean;
  error: string | null;
  init: () => Promise<void>;
  create: (input: SwarmInput) => Promise<void>;
  update: (id: string, input: Partial<SwarmInput>) => Promise<void>;
  remove: (id: string) => Promise<void>;
  clearError: () => void;
}

export const useSwarmsStore = create<SwarmsState>((set, get) => ({
  list: [],
  hydrated: false,
  error: null,
  init: async () => {
    try {
      set({ list: await swarmsApi.list(), hydrated: true });
    } catch (e) {
      set({ hydrated: true, error: e instanceof Error ? e.message : 'load failed' });
    }
  },
  create: async (input) => {
    try {
      const meta = await swarmsApi.create(input);
      set({ list: [meta, ...get().list] });
    } catch (e) {
      set({ error: e instanceof Error ? e.message : 'create failed' });
    }
  },
  update: async (id, input) => {
    try {
      const meta = await swarmsApi.update(id, input);
      set({ list: get().list.map((s) => (s.id === id ? meta : s)) });
    } catch (e) {
      set({ error: e instanceof Error ? e.message : 'update failed' });
    }
  },
  remove: async (id) => {
    const prev = get().list;
    set({ list: prev.filter((s) => s.id !== id) }); // optimistic
    try {
      await swarmsApi.delete(id);
    } catch (e) {
      set({ list: prev, error: e instanceof Error ? e.message : 'delete failed' }); // rollback
    }
  },
  clearError: () => set({ error: null }),
}));
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run src/stores/swarms.store.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 6: Commit**

```bash
git add src/lib/api/swarms.api.ts src/stores/swarms.store.ts src/stores/swarms.store.test.ts
git commit -m "feat(slice-25): swarms API client + Zustand store (optimistic)"
```

---

## Task 8: Run hook + run panel

**Files:**
- Create: `src/hooks/useSwarmRun.ts`
- Create: `src/components/swarms/SwarmRunPanel.tsx`

This consumes the run SSE. Reuse the existing parser at `src/lib/sse-parser.ts` (it exposes a function that turns a `ReadableStream`/response body into typed events — inspect its exact export with `grep "export" src/lib/sse-parser.ts` and use the same call shape as `src/hooks/useStreamingDispatch.ts`).

- [ ] **Step 1: Implement the hook**

`src/hooks/useSwarmRun.ts`:

```ts
import { useCallback, useRef, useState } from 'react';
import { parseSseStream } from '@/src/lib/sse-parser';
import { swarmsApi } from '@/src/lib/api/swarms.api';

export interface SwarmStepView {
  position: number;
  subAgent: string;
  output: string;
  status: 'running' | 'completed';
}
export interface SwarmRunState {
  running: boolean;
  steps: SwarmStepView[];
  pending: { approvalId: string; position: number; output: string } | null;
  status: string | null;
  error: string | null;
}

const INITIAL: SwarmRunState = { running: false, steps: [], pending: null, status: null, error: null };

export function useSwarmRun() {
  const [state, setState] = useState<SwarmRunState>(INITIAL);
  const abortRef = useRef<AbortController | null>(null);

  const run = useCallback(async (swarmId: string, input: string) => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setState({ ...INITIAL, running: true });

    const res = await fetch(`/api/swarms/${swarmId}/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ input }),
      signal: controller.signal,
    });
    if (!res.body) {
      setState((s) => ({ ...s, running: false, error: 'no stream' }));
      return;
    }

    for await (const ev of parseSseStream(res.body)) {
      setState((s) => reduce(s, ev.event, ev.data));
    }
  }, []);

  const approve = useCallback(async (approvalId: string) => {
    await swarmsApi.decision(approvalId, 'approve');
    setState((s) => ({ ...s, pending: null }));
  }, []);
  const reject = useCallback(async (approvalId: string) => {
    await swarmsApi.decision(approvalId, 'reject');
    setState((s) => ({ ...s, pending: null }));
  }, []);

  return { state, run, approve, reject };
}

function reduce(s: SwarmRunState, name: string, data: any): SwarmRunState {
  switch (name) {
    case 'swarm_step_started':
      return {
        ...s,
        steps: [...s.steps, { position: data.position, subAgent: data.subAgent, output: '', status: 'running' }],
      };
    case 'swarm_step_completed':
      return {
        ...s,
        steps: s.steps.map((st) =>
          st.position === data.position ? { ...st, output: data.output, status: 'completed' } : st,
        ),
      };
    case 'swarm_approval_request':
      return { ...s, pending: { approvalId: data.approvalId, position: data.position, output: data.output } };
    case 'swarm_error':
      return { ...s, error: data.message };
    case 'swarm_done':
      return { ...s, running: false, status: data.status, pending: null };
    default:
      return s;
  }
}
```

> If `src/lib/sse-parser.ts` does not export an async-iterable `parseSseStream`, adapt
> the loop to its actual API (see `useStreamingDispatch.ts` for the existing call shape).
> The event names consumed here are fixed by Task 5/6.

- [ ] **Step 2: Implement the run panel**

`src/components/swarms/SwarmRunPanel.tsx`:

```tsx
import { useState } from 'react';
import { useSwarmRun } from '@/src/hooks/useSwarmRun';

export function SwarmRunPanel({ swarmId }: { swarmId: string }) {
  const { state, run, approve, reject } = useSwarmRun();
  const [input, setInput] = useState('');

  return (
    <div className="flex flex-col gap-3 p-3">
      <textarea
        className="w-full bg-surface-2 border border-border-subtle rounded p-2 text-sm text-zinc-100"
        rows={3}
        placeholder="Initial input for the swarm…"
        value={input}
        onChange={(e) => setInput(e.target.value)}
        disabled={state.running}
      />
      <button
        className="self-start px-3 py-1.5 rounded bg-manipulation text-black hover:bg-manipulation/90 disabled:opacity-40"
        disabled={state.running || input.trim().length === 0}
        onClick={() => run(swarmId, input)}
      >
        Run swarm
      </button>

      <ol className="flex flex-col gap-2">
        {state.steps.map((st) => (
          <li key={st.position} className="rounded border border-border-subtle bg-surface-1 p-2">
            <div className="text-[10px] uppercase tracking-widest text-manipulation">
              {st.position + 1}. {st.subAgent} — {st.status}
            </div>
            {st.output && <pre className="mt-1 whitespace-pre-wrap text-xs text-zinc-300">{st.output}</pre>}
          </li>
        ))}
      </ol>

      {state.pending && (
        <div className="rounded border border-manipulation/40 bg-surface-2 p-2">
          <div className="text-xs text-zinc-200">Approve step {state.pending.position + 1} output?</div>
          <div className="mt-2 flex gap-2">
            <button
              className="px-2 py-1 rounded bg-manipulation text-black text-xs"
              onClick={() => approve(state.pending!.approvalId)}
            >
              Approve
            </button>
            <button
              className="px-2 py-1 rounded bg-status-error/20 text-status-error text-xs"
              onClick={() => reject(state.pending!.approvalId)}
            >
              Reject
            </button>
          </div>
        </div>
      )}

      {state.error && <div className="text-xs text-status-error">{state.error}</div>}
      {state.status && <div className="text-xs text-zinc-400">Status: {state.status}</div>}
    </div>
  );
}
```

- [ ] **Step 3: Verify**

Run: `npm run lint`
Expected: clean. (If `parseSseStream` import is wrong, fix per the note above until lint passes.)

- [ ] **Step 4: Commit**

```bash
git add src/hooks/useSwarmRun.ts src/components/swarms/SwarmRunPanel.tsx
git commit -m "feat(slice-25): swarm run hook + streaming run panel with approval"
```

---

## Task 9: Editor modal + sidebar section

**Files:**
- Create: `src/components/swarms/StepsListEditor.tsx`
- Create: `src/components/swarms/SwarmEditModal.tsx`
- Create: `src/components/sidebar/SwarmsSection.tsx`

Inspect `src/components/subagents/SubAgentEditModal.tsx` and `src/components/sidebar/SubAgentsSection.tsx` first and mirror their structure (Dialog usage, store calls, styling). The subagent `<select>` options come from `useSubAgentsStore().list`.

- [ ] **Step 1: Implement the steps editor**

`src/components/swarms/StepsListEditor.tsx`:

```tsx
import type { SwarmStep } from '@/src/lib/api/swarms.api';
import { useSubAgentsStore } from '@/src/stores/subagents.store';

export function StepsListEditor({
  steps,
  onChange,
}: {
  steps: SwarmStep[];
  onChange: (steps: SwarmStep[]) => void;
}) {
  const subAgents = useSubAgentsStore((s) => s.list);

  const update = (i: number, patch: Partial<SwarmStep>) =>
    onChange(steps.map((s, idx) => (idx === i ? { ...s, ...patch } : s)));
  const remove = (i: number) => onChange(steps.filter((_, idx) => idx !== i));
  const move = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= steps.length) return;
    const next = [...steps];
    [next[i], next[j]] = [next[j], next[i]];
    onChange(next);
  };
  const add = () =>
    onChange([...steps, { subAgentName: subAgents[0]?.name ?? '', promptTemplate: '', pauseAfter: false }]);

  return (
    <div className="flex flex-col gap-2">
      {steps.map((step, i) => (
        <div key={i} className="rounded border border-border-subtle bg-surface-1 p-2 flex flex-col gap-1.5">
          <div className="flex items-center gap-2">
            <span className="text-[10px] text-zinc-500">{i + 1}</span>
            <select
              className="flex-1 bg-surface-2 border border-border-subtle rounded px-2 py-1 text-xs text-zinc-100"
              value={step.subAgentName}
              onChange={(e) => update(i, { subAgentName: e.target.value })}
            >
              {subAgents.map((sa) => (
                <option key={sa.id} value={sa.name}>
                  {sa.name}
                </option>
              ))}
            </select>
            <button className="text-zinc-500 hover:text-manipulation text-xs" onClick={() => move(i, -1)}>↑</button>
            <button className="text-zinc-500 hover:text-manipulation text-xs" onClick={() => move(i, 1)}>↓</button>
            <button className="text-zinc-500 hover:text-status-error text-xs" onClick={() => remove(i)}>✕</button>
          </div>
          <textarea
            className="w-full bg-surface-2 border border-border-subtle rounded px-2 py-1 text-xs text-zinc-100"
            rows={2}
            placeholder="Prompt template (optional, prefixed to the previous step's output)"
            value={step.promptTemplate}
            onChange={(e) => update(i, { promptTemplate: e.target.value })}
          />
          <label className="flex items-center gap-2 text-[11px] text-zinc-400">
            <input type="checkbox" checked={step.pauseAfter} onChange={(e) => update(i, { pauseAfter: e.target.checked })} />
            Pause for approval after this step
          </label>
        </div>
      ))}
      <button className="self-start text-xs text-manipulation hover:underline" onClick={add}>
        + Add step
      </button>
    </div>
  );
}
```

- [ ] **Step 2: Implement the edit modal**

`src/components/swarms/SwarmEditModal.tsx`:

```tsx
import { useState } from 'react';
import { Dialog } from '@/src/components/ui/Dialog';
import { useSwarmsStore } from '@/src/stores/swarms.store';
import { swarmsApi, type SwarmStep } from '@/src/lib/api/swarms.api';
import { StepsListEditor } from './StepsListEditor';

export function SwarmEditModal({ id, onClose }: { id: string | 'new'; onClose: () => void }) {
  const createSwarm = useSwarmsStore((s) => s.create);
  const updateSwarm = useSwarmsStore((s) => s.update);
  const [name, setName] = useState('');
  const [steps, setSteps] = useState<SwarmStep[]>([]);
  const [loaded, setLoaded] = useState(id === 'new');

  if (id !== 'new' && !loaded) {
    void swarmsApi.get(id).then((rec) => {
      setName(rec.name);
      setSteps(rec.steps);
      setLoaded(true);
    });
  }

  const save = async () => {
    if (id === 'new') await createSwarm({ name, steps });
    else await updateSwarm(id, { name, steps });
    onClose();
  };

  return (
    <Dialog open onClose={onClose} title={id === 'new' ? 'New swarm' : 'Edit swarm'}>
      <div className="flex flex-col gap-3">
        <input
          className="w-full bg-surface-2 border border-border-subtle rounded px-2 py-1.5 text-sm text-white"
          placeholder="Swarm name"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <StepsListEditor steps={steps} onChange={setSteps} />
        <button
          className="self-end px-3 py-1.5 rounded bg-manipulation text-black hover:bg-manipulation/90 disabled:opacity-40"
          disabled={name.trim().length === 0 || steps.length === 0}
          onClick={save}
        >
          Save
        </button>
      </div>
    </Dialog>
  );
}
```

> Confirm the `Dialog` import path and props by reading `src/components/ui/Dialog.tsx`
> (or whatever the project's dialog component is — `SubAgentEditModal.tsx` shows the
> exact usage). Match its `open`/`onClose`/`title` API.

- [ ] **Step 3: Implement the sidebar section**

`src/components/sidebar/SwarmsSection.tsx`:

```tsx
import { useState } from 'react';
import { useSwarmsStore } from '@/src/stores/swarms.store';
import { SwarmEditModal } from '@/src/components/swarms/SwarmEditModal';
import { SwarmRunPanel } from '@/src/components/swarms/SwarmRunPanel';

export function SwarmsSection() {
  const swarms = useSwarmsStore((s) => s.list);
  const remove = useSwarmsStore((s) => s.remove);
  const [editing, setEditing] = useState<string | 'new' | null>(null);
  const [running, setRunning] = useState<string | null>(null);

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between">
        <span className="text-[10px] uppercase tracking-widest text-zinc-500">Swarms</span>
        <button className="text-[10px] text-manipulation hover:underline" onClick={() => setEditing('new')}>
          + New
        </button>
      </div>
      {swarms.map((sw) => (
        <div key={sw.id} className="flex items-center justify-between rounded bg-surface-1 p-1.5 text-[11px]">
          <button className="text-zinc-200 hover:text-manipulation" onClick={() => setRunning(sw.id)}>
            {sw.name} <span className="text-zinc-500">({sw.stepCount})</span>
          </button>
          <div className="flex gap-1.5">
            <button className="text-zinc-500 hover:text-manipulation" onClick={() => setEditing(sw.id)}>edit</button>
            <button className="text-zinc-500 hover:text-status-error" onClick={() => void remove(sw.id)}>del</button>
          </div>
        </div>
      ))}
      {editing && <SwarmEditModal id={editing} onClose={() => setEditing(null)} />}
      {running && (
        <div className="mt-2 rounded border border-border-subtle">
          <SwarmRunPanel swarmId={running} />
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Verify**

Run: `npm run lint`
Expected: clean (fix Dialog/import paths per the notes until clean).

- [ ] **Step 5: Commit**

```bash
git add src/components/swarms/StepsListEditor.tsx src/components/swarms/SwarmEditModal.tsx src/components/sidebar/SwarmsSection.tsx
git commit -m "feat(slice-25): swarm editor modal, steps editor, and sidebar section"
```

---

## Task 10: App wiring + i18n + roadmap

**Files:**
- Modify: `src/App.tsx` (init the store), the sidebar component that renders sections, `src/i18n/*`, `docs/superpowers/roadmap.md`

- [ ] **Step 1: Init the store on mount**

In `src/App.tsx`, where other stores call `.init()` on mount, add:

```ts
import { useSwarmsStore } from '@/src/stores/swarms.store';
// inside the mount effect, alongside the other init() calls:
void useSwarmsStore.getState().init();
```

- [ ] **Step 2: Render the section in the sidebar**

Find where `SubAgentsSection` is rendered (grep `SubAgentsSection` under `src/components/`) and render `<SwarmsSection />` next to it:

```tsx
import { SwarmsSection } from '@/src/components/sidebar/SwarmsSection';
// ...
<SwarmsSection />
```

- [ ] **Step 3: Add i18n strings**

Add to each locale file under `src/i18n/` (match the existing structure — grep an existing key like `subagents` to find the file/shape) the strings used: `swarms.title`, `swarms.new`, `swarms.run`, `swarms.approve`, `swarms.reject`. If the components above use literal English strings (as written), this step is optional — add keys only if the project requires all UI strings to be in i18n (check `src/i18n/` conventions). If literals are acceptable in this codebase, skip and note it.

- [ ] **Step 4: Mark the slice shipped in the roadmap**

In `docs/superpowers/roadmap.md`, move the Slice 25 entry to the Shipped table:

```markdown
| 25 | Multi-Agent Swarms (linear DSL, per-step approval, SSE run) | `feat/slice-25-swarms` | ✅ |
```

and remove the `### Slice 25 — Multi-Agent Swarms (Workflow DSL)` stub from the Planned/Killer-Features section.

- [ ] **Step 5: Verify the whole slice**

Run:
```bash
npm run lint
npm run test:run
```
Expected: lint clean; all tests pass (new swarm tests + existing suite).

- [ ] **Step 6: Commit**

```bash
git add src/App.tsx src/components src/i18n docs/superpowers/roadmap.md
git commit -m "feat(slice-25): wire swarms into app (store init, sidebar, i18n) + roadmap"
```

---

## Final verification

- [ ] `npm run lint` clean.
- [ ] `npm run test:run` green (store, approval, collecting-sse, orchestrator, routes, FE store).
- [ ] `npm run test:coverage` — `server/domain/swarms/**` meets the `server/domain/**` 80% threshold; `src/stores/**` still meets its threshold.
- [ ] Manual (user): create a swarm of two sub-agents in the UI, run it with the Fake provider (`AETHER_FAKE_PROVIDER=1 npm run dev`), confirm streaming steps + an approval gate + a visible transcript session.

## Self-review notes (author)

- **Spec coverage:** schema/types (T1), store (T2), approval (T3), collecting-sse (T4), orchestrator with output→input + per-step gate + error/unknown-agent/empty handling (T5), routes CRUD+run+decision + wiring (T6), FE api+store (T7), run hook+panel (T8), editor+section (T9), app/i18n/roadmap (T10). All spec sections mapped.
- **Deviation from spec:** `createSession()` takes no title (HistoryStore.createEmpty has no title param) — sessions auto-title from messages; noted in T6.
- **Type consistency:** `SwarmStep`/`SwarmRecord`/`SwarmMeta` identical across backend (`swarm.types.ts`) and FE (`swarms.api.ts`); `SwarmOrchestratorDeps`/`createCollectingSse`/`capturedError()` names consistent T4↔T5↔T6; SSE event names identical between orchestrator (T5) and the hook reducer (T8).
- **Unverified import paths flagged inline:** `errorMiddleware` (T6), `parseSseStream` (T8), `Dialog` (T9) — each step tells the implementer to confirm the real export/path against a named existing file before relying on it.
```
