# Slice 26 — Test-Driven Auto-Resolution Loop Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An autonomous loop that runs a configurable test command and, while it fails (non-zero exit), dispatches a chosen fixer sub-agent with the failing output, then re-runs — until green or `maxRetries`.

**Architecture:** A server-side `runTddLoop` reuses `executeCommand` (slice 21) to run the command, decides pass/fail by exit code, and reuses `DispatchService.handle()` through a shared collecting-SSE adapter to run each fixer turn (per-tool breakpoint gates fire inside, unchanged). Runs are ephemeral on an SSE connection; the transcript is a per-run chat session. A palette command "Auto-fix tests…" opens a modal and a streaming panel.

**Tech Stack:** Express, SSE, Zod, React 19 + Zustand, Vitest.

---

## Conventions

- `@/` aliases the repo root. Backend tests colocated `*.test.ts` (node project), FE `*.test.ts(x)` (jsdom).
- Focused test: `npx vitest run <path>`. Type-check: `npm run lint`. Test-DB helper: `makeTestDb()` from `@/server/test/test-db`.
- `SseEmitter` = `{ event(name,data), error(message,retryable?), end() }` from `@/server/lib/sse`.
- Commit after each task with the message in its final step.

## File structure (locked)

```
server/lib/collecting-sse.ts          # MOVED from server/domain/swarms/ (shared by swarms + tdd)
server/lib/collecting-sse.test.ts     # MOVED alongside
server/domain/swarms/swarm.orchestrator.ts   # MODIFY import path
server/domain/tdd/
  tdd.types.ts        # TddRunOpts, TddRunStatus, TddDispatcher, TddRunnerDeps, CommandResult
  tdd.schema.ts       # zod TddRunInputSchema
  tdd.run-command.ts  # parseExitCode + createRunCommand(executeCommand)
  tdd.runner.ts       # runTddLoop + tail()
server/routes/tdd.routes.ts           # POST /api/tdd/run (SSE)
server/app.ts, server/index.ts        # wiring

src/lib/api/tdd.api.ts                 # run() → SSE
src/hooks/useTddRun.ts                 # consume SSE (reduceTdd exported for test)
src/stores/tdd-ui.store.ts             # modal open/close
src/components/tdd/TddRunModal.tsx     # command + sub-agent select + maxRetries
src/components/tdd/TddRunPanel.tsx     # live iterations + final status
src/hooks/useCommands.ts               # add "Auto-fix tests…" command
src/App.tsx                            # render TddRunModal when open
docs/superpowers/roadmap.md            # mark shipped
```

---

## Task 1: Move `collecting-sse` to `server/lib` (shared)

**Files:**
- Move: `server/domain/swarms/collecting-sse.ts` → `server/lib/collecting-sse.ts`
- Move: `server/domain/swarms/collecting-sse.test.ts` → `server/lib/collecting-sse.test.ts`
- Modify: `server/domain/swarms/swarm.orchestrator.ts:2` (import path)

- [ ] **Step 1: Move the two files with git**

```bash
git mv server/domain/swarms/collecting-sse.ts server/lib/collecting-sse.ts
git mv server/domain/swarms/collecting-sse.test.ts server/lib/collecting-sse.test.ts
```

- [ ] **Step 2: Update the swarm import**

In `server/domain/swarms/swarm.orchestrator.ts`, change:
```ts
import { createCollectingSse } from './collecting-sse';
```
to:
```ts
import { createCollectingSse } from '@/server/lib/collecting-sse';
```

The moved test imports `./collecting-sse` (now in `server/lib/`) — that relative import still resolves; leave it. Its `SseEmitter` import is already `@/server/lib/sse`.

- [ ] **Step 3: Run the moved test + swarm tests**

Run: `npx vitest run server/lib/collecting-sse.test.ts server/domain/swarms/`
Expected: all pass (collecting-sse 5, swarm suites unchanged). Then `npm run lint` clean.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "refactor(slice-26): move collecting-sse to server/lib for swarm+tdd reuse"
```

---

## Task 2: TDD types + zod schema

**Files:**
- Create: `server/domain/tdd/tdd.types.ts`
- Create: `server/domain/tdd/tdd.schema.ts`

- [ ] **Step 1: Write the types**

`server/domain/tdd/tdd.types.ts`:

```ts
import type { SseEmitter } from '@/server/lib/sse';

export type TddRunStatus =
  | 'success'
  | 'already_green'
  | 'max_retries_exceeded'
  | 'error'
  | 'interrupted';

export interface CommandResult {
  exitCode: number;
  output: string;
}

export interface TddRunOpts {
  command: string;
  subAgentName: string;
  maxRetries?: number;
  cwd?: string;
}

export interface TddDispatcher {
  handle(
    body: { sessionId: string; message: string },
    sse: SseEmitter,
    signal: AbortSignal,
  ): Promise<void>;
}

export interface TddRunnerDeps {
  runCommand: (command: string, cwd?: string) => Promise<CommandResult>;
  subAgentsStore: { list(): Promise<{ name: string }[]> };
  dispatcher: TddDispatcher;
  createSession: () => Promise<string>;
}
```

- [ ] **Step 2: Write the schema**

`server/domain/tdd/tdd.schema.ts`:

```ts
import { z } from 'zod';

export const TddRunInputSchema = z.object({
  command: z.string().min(1).max(2000),
  subAgentName: z.string().min(1).max(80),
  maxRetries: z.number().int().min(1).max(20).optional(),
  cwd: z.string().max(4000).optional(),
});
```

- [ ] **Step 3: Type-check**

Run: `npm run lint`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add server/domain/tdd/tdd.types.ts server/domain/tdd/tdd.schema.ts
git commit -m "feat(slice-26): TDD loop types + run-input schema"
```

---

## Task 3: `runCommand` (exit-code extraction)

**Files:**
- Create: `server/domain/tdd/tdd.run-command.ts`
- Test: `server/domain/tdd/tdd.run-command.test.ts`

Wraps `executeCommand` from `server/mcp/builtin/aether-shell.handler.ts`, which returns
`{ isError, content: [{ type:'text', text }] }` where `text` ends with `exit code: N`
(or `timeout after Xms`). `parseExitCode` extracts the number; a missing/garbled code
falls back to `isError ? 1 : 0`.

- [ ] **Step 1: Write the failing test**

`server/domain/tdd/tdd.run-command.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { parseExitCode, createRunCommand } from './tdd.run-command';

describe('parseExitCode', () => {
  it('extracts a numeric exit code', () => {
    expect(parseExitCode('out\n---\nerr\n---\nexit code: 0', false)).toBe(0);
    expect(parseExitCode('out\n---\nerr\n---\nexit code: 2', true)).toBe(2);
  });
  it('falls back to isError when no exit code is present (e.g. timeout)', () => {
    expect(parseExitCode('partial\n---\n\n---\ntimeout after 120000ms', true)).toBe(1);
    expect(parseExitCode('whatever', false)).toBe(0);
  });
});

describe('createRunCommand', () => {
  it('runs the command and returns exitCode + full output', async () => {
    const exec = vi.fn(async () => ({
      isError: false,
      content: [{ type: 'text' as const, text: 'all good\n---\n\n---\nexit code: 0' }],
    }));
    const runCommand = createRunCommand(exec);
    const res = await runCommand('npx vitest run', '/repo');
    expect(res).toEqual({ exitCode: 0, output: 'all good\n---\n\n---\nexit code: 0' });
    expect(exec).toHaveBeenCalledWith({ cmd: 'npx vitest run', cwd: '/repo', timeout: 120000 });
  });

  it('reports a failing exit code', async () => {
    const exec = vi.fn(async () => ({
      isError: true,
      content: [{ type: 'text' as const, text: 'FAIL\n---\nboom\n---\nexit code: 1' }],
    }));
    const res = await createRunCommand(exec)('cmd');
    expect(res.exitCode).toBe(1);
    expect(res.output).toContain('FAIL');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run server/domain/tdd/tdd.run-command.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

`server/domain/tdd/tdd.run-command.ts`:

```ts
import type { CommandResult } from './tdd.types';

interface ShellResult {
  isError: boolean;
  content: Array<{ type: 'text'; text: string }>;
}
type ShellExec = (input: { cmd: string; cwd?: string; timeout?: number }) => Promise<ShellResult>;

const MAX_TIMEOUT_MS = 120_000;

export function parseExitCode(text: string, isError: boolean): number {
  const m = text.match(/exit code:\s*(\d+)/);
  if (m) return parseInt(m[1], 10);
  return isError ? 1 : 0;
}

/** Build a runCommand that executes via the shell handler and returns {exitCode, output}. */
export function createRunCommand(exec: ShellExec) {
  return async (command: string, cwd?: string): Promise<CommandResult> => {
    const result = await exec({ cmd: command, cwd, timeout: MAX_TIMEOUT_MS });
    const output = result.content.map((c) => c.text).join('\n');
    return { exitCode: parseExitCode(output, result.isError), output };
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run server/domain/tdd/tdd.run-command.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add server/domain/tdd/tdd.run-command.ts server/domain/tdd/tdd.run-command.test.ts
git commit -m "feat(slice-26): runCommand wrapper with exit-code extraction"
```

---

## Task 4: The loop (`runTddLoop`)

**Files:**
- Create: `server/domain/tdd/tdd.runner.ts`
- Test: `server/domain/tdd/tdd.runner.test.ts`

- [ ] **Step 1: Write the failing test**

`server/domain/tdd/tdd.runner.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import type { SseEmitter } from '@/server/lib/sse';
import { runTddLoop } from './tdd.runner';
import type { TddRunnerDeps, CommandResult } from './tdd.types';

function recordingSse() {
  const events: { name: string; data: any }[] = [];
  const sse: SseEmitter = {
    event: (name, data) => events.push({ name, data: data as any }),
    error: (message) => events.push({ name: 'error', data: { message } }),
    end: () => {},
  };
  return { sse, events };
}

// dispatcher that emits a text chunk then done (a successful fixer turn)
function okDispatcher(spy?: (msg: string) => void) {
  return {
    handle: async (body: { sessionId: string; message: string }, sse: SseEmitter) => {
      spy?.(body.message);
      sse.event('text', { chunk: 'edited a file' });
      sse.event('done', {});
    },
  };
}

function deps(over: Partial<TddRunnerDeps>): TddRunnerDeps {
  return {
    runCommand: vi.fn(async (): Promise<CommandResult> => ({ exitCode: 1, output: 'FAIL' })),
    subAgentsStore: { list: vi.fn(async () => [{ name: 'coder' }]) },
    dispatcher: okDispatcher(),
    createSession: vi.fn(async () => 'sess-1'),
    ...over,
  };
}

describe('runTddLoop', () => {
  it('reports already_green when the command passes first', async () => {
    const d = deps({ runCommand: vi.fn(async () => ({ exitCode: 0, output: 'ok' })) });
    const { sse, events } = recordingSse();
    await runTddLoop(d, { command: 'cmd', subAgentName: 'coder' }, sse, new AbortController().signal);
    expect(events.find((e) => e.name === 'tdd_done')?.data.status).toBe('already_green');
    expect(d.createSession).not.toHaveBeenCalled(); // no fixer turn ran
  });

  it('runs a fixer turn then succeeds (red → green)', async () => {
    const results = [{ exitCode: 1, output: 'FAIL: expected 1' }, { exitCode: 0, output: 'pass' }];
    const seen: string[] = [];
    const d = deps({
      runCommand: vi.fn(async () => results.shift()!),
      dispatcher: okDispatcher((m) => seen.push(m)),
    });
    const { sse, events } = recordingSse();
    await runTddLoop(d, { command: 'npx vitest run', subAgentName: 'coder' }, sse, new AbortController().signal);
    expect(seen[0]).toContain('@coder');
    expect(seen[0]).toContain('FAIL: expected 1');
    const done = events.find((e) => e.name === 'tdd_done');
    expect(done?.data.status).toBe('success');
    expect(done?.data.iterations).toBe(1);
  });

  it('stops at max_retries_exceeded after exactly maxRetries fixer turns', async () => {
    const d = deps({ runCommand: vi.fn(async () => ({ exitCode: 1, output: 'still failing' })) });
    const { sse, events } = recordingSse();
    await runTddLoop(d, { command: 'cmd', subAgentName: 'coder', maxRetries: 3 }, sse, new AbortController().signal);
    expect((d.dispatcher.handle as any).mock.calls.length).toBe(3);
    expect(events.find((e) => e.name === 'tdd_done')?.data.status).toBe('max_retries_exceeded');
  });

  it('fails fast on unknown sub-agent', async () => {
    const d = deps({ subAgentsStore: { list: vi.fn(async () => [{ name: 'other' }]) } });
    const { sse, events } = recordingSse();
    await runTddLoop(d, { command: 'cmd', subAgentName: 'ghost' }, sse, new AbortController().signal);
    expect(events.find((e) => e.name === 'tdd_error')?.data.message).toMatch(/ghost/);
    expect(events.find((e) => e.name === 'tdd_done')?.data.status).toBe('error');
    expect(d.runCommand).not.toHaveBeenCalled();
  });

  it('reports error when a fixer turn emits an error event', async () => {
    const d = deps({
      dispatcher: {
        handle: async (_b: any, sse: SseEmitter) => {
          sse.event('error', { message: 'provider down', retryable: false });
        },
      },
    });
    const { sse, events } = recordingSse();
    await runTddLoop(d, { command: 'cmd', subAgentName: 'coder' }, sse, new AbortController().signal);
    expect(events.find((e) => e.name === 'tdd_error')?.data.message).toMatch(/provider down/);
    expect(events.find((e) => e.name === 'tdd_done')?.data.status).toBe('error');
  });

  it('stops with interrupted when the signal is already aborted', async () => {
    const d = deps({}); // runCommand returns exit 1, so it would enter the loop
    const { sse, events } = recordingSse();
    const controller = new AbortController();
    controller.abort();
    await runTddLoop(d, { command: 'cmd', subAgentName: 'coder' }, sse, controller.signal);
    expect(events.find((e) => e.name === 'tdd_done')?.data.status).toBe('interrupted');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run server/domain/tdd/tdd.runner.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

`server/domain/tdd/tdd.runner.ts`:

```ts
import type { SseEmitter } from '@/server/lib/sse';
import { createCollectingSse } from '@/server/lib/collecting-sse';
import type { TddRunnerDeps, TddRunOpts } from './tdd.types';

const TAIL_CHARS = 8000;

export function tail(output: string): string {
  if (output.length <= TAIL_CHARS) return output;
  return `…(truncated)\n${output.slice(-TAIL_CHARS)}`;
}

function framing(command: string, output: string): string {
  return [
    `The test command \`${command}\` is failing. Its output:`,
    '',
    '```',
    tail(output),
    '```',
    '',
    'Fix the code so the tests pass. Use your tools to read and edit the relevant files.',
    'Do not edit the tests unless they are clearly wrong.',
  ].join('\n');
}

export async function runTddLoop(
  deps: TddRunnerDeps,
  opts: TddRunOpts,
  sse: SseEmitter,
  signal: AbortSignal,
): Promise<void> {
  const maxRetries = opts.maxRetries ?? 5;

  const known = new Set((await deps.subAgentsStore.list()).map((s) => s.name));
  if (!known.has(opts.subAgentName)) {
    sse.event('tdd_error', { message: `unknown sub-agent: ${opts.subAgentName}` });
    sse.event('tdd_done', { status: 'error' });
    sse.end();
    return;
  }

  sse.event('tdd_started', { command: opts.command, subAgentName: opts.subAgentName, maxRetries });

  let res = await deps.runCommand(opts.command, opts.cwd);
  sse.event('tdd_test_result', {
    iteration: 0,
    exitCode: res.exitCode,
    passed: res.exitCode === 0,
    output: tail(res.output),
  });
  if (res.exitCode === 0) {
    sse.event('tdd_done', { status: 'already_green', iterations: 0 });
    sse.end();
    return;
  }

  const sessionId = await deps.createSession();

  for (let iteration = 1; iteration <= maxRetries; iteration++) {
    if (signal.aborted) {
      sse.event('tdd_done', { status: 'interrupted' });
      sse.end();
      return;
    }
    sse.event('tdd_iteration_started', { iteration });

    const collector = createCollectingSse(sse);
    await deps.dispatcher.handle(
      { sessionId, message: `@${opts.subAgentName} ${framing(opts.command, res.output)}` },
      collector,
      signal,
    );
    const turnError = collector.capturedError();
    if (turnError) {
      sse.event('tdd_error', { iteration, message: turnError.message });
      sse.event('tdd_done', { status: 'error' });
      sse.end();
      return;
    }

    res = await deps.runCommand(opts.command, opts.cwd);
    sse.event('tdd_test_result', {
      iteration,
      exitCode: res.exitCode,
      passed: res.exitCode === 0,
      output: tail(res.output),
    });
    if (res.exitCode === 0) {
      sse.event('tdd_done', { status: 'success', iterations: iteration });
      sse.end();
      return;
    }
  }

  sse.event('tdd_done', { status: 'max_retries_exceeded', iterations: maxRetries });
  sse.end();
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run server/domain/tdd/tdd.runner.test.ts`
Expected: PASS (6 tests). Then `npm run lint` clean.

- [ ] **Step 5: Commit**

```bash
git add server/domain/tdd/tdd.runner.ts server/domain/tdd/tdd.runner.test.ts
git commit -m "feat(slice-26): TDD loop (run → fix → re-run until green/max-retries)"
```

---

## Task 5: Route + wiring

**Files:**
- Create: `server/routes/tdd.routes.ts`
- Test: `server/routes/tdd.routes.test.ts`
- Modify: `server/app.ts`, `server/index.ts`

- [ ] **Step 1: Implement the route**

`server/routes/tdd.routes.ts`:

```ts
import { Router, type Request, type Response } from 'express';
import { createSseEmitter } from '@/server/lib/sse';
import { TddRunInputSchema } from '@/server/domain/tdd/tdd.schema';
import { runTddLoop } from '@/server/domain/tdd/tdd.runner';
import type { TddRunnerDeps } from '@/server/domain/tdd/tdd.types';

export function createTddRoutes(deps: TddRunnerDeps): Router {
  const router = Router();

  router.post('/run', async (req: Request, res: Response) => {
    const sse = createSseEmitter(res);
    const parsed = TddRunInputSchema.safeParse(req.body);
    if (!parsed.success) {
      sse.event('tdd_error', { message: 'Invalid run input' });
      sse.event('tdd_done', { status: 'error' });
      sse.end();
      return;
    }
    const controller = new AbortController();
    res.on('close', () => {
      if (!res.writableEnded) controller.abort();
    });
    try {
      await runTddLoop(deps, parsed.data, sse, controller.signal);
    } catch (e) {
      sse.event('tdd_error', { message: e instanceof Error ? e.message : 'Internal error' });
      sse.event('tdd_done', { status: 'error' });
      sse.end();
    }
  });

  return router;
}
```

Note: `createApp` registers a global `express.json()` before feature routes (confirmed in
`server/app.ts`), so the body is parsed without a per-router `express.json()`.

- [ ] **Step 2: Wire into `server/app.ts`**

Add to `AppDeps`:
```ts
  tddRunnerDeps?: import('./domain/tdd/tdd.types').TddRunnerDeps;
```
Import near the other route imports: `import { createTddRoutes } from './routes/tdd.routes';`
Mount near the other `app.use('/api/...')` blocks (before the error middleware):
```ts
if (deps.tddRunnerDeps) {
  app.use('/api/tdd', createTddRoutes(deps.tddRunnerDeps));
}
```

- [ ] **Step 3: Wire into `server/index.ts`**

Add imports and construct the deps after `dispatcher`, `subAgentsStore`, `historyStore` exist:
```ts
import { createRunCommand } from './domain/tdd/tdd.run-command';
import { executeCommand } from './mcp/builtin/aether-shell.handler';
// ...
const tddRunnerDeps = {
  runCommand: createRunCommand(executeCommand),
  subAgentsStore,
  dispatcher,
  createSession: async () => (await historyStore.createEmpty()).id,
};
```
and add `tddRunnerDeps` to the `createApp({ ... })` call.

- [ ] **Step 4: Write the route test**

`server/routes/tdd.routes.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createApp } from '@/server/app';

function makeApp(over: Partial<import('@/server/domain/tdd/tdd.types').TddRunnerDeps> = {}) {
  const tddRunnerDeps = {
    runCommand: async () => ({ exitCode: 0, output: 'ok' }),
    subAgentsStore: { list: async () => [{ name: 'coder' }] },
    dispatcher: { handle: async () => {} },
    createSession: async () => 'sess-1',
    ...over,
  };
  return createApp({ tddRunnerDeps } as any);
}

describe('tdd routes', () => {
  it('streams already_green when the command passes', async () => {
    const res = await request(makeApp())
      .post('/api/tdd/run')
      .send({ command: 'cmd', subAgentName: 'coder' });
    expect(res.status).toBe(200);
    expect(res.text).toContain('tdd_started');
    expect(res.text).toContain('already_green');
  });

  it('emits a terminal error pair on invalid input', async () => {
    const res = await request(makeApp()).post('/api/tdd/run').send({ command: '' });
    expect(res.text).toContain('tdd_error');
    expect(res.text).toContain('"status":"error"');
  });
});
```

- [ ] **Step 5: Verify**

Run: `npx vitest run server/routes/tdd.routes.test.ts && npm run lint && npm run test:run`
Expected: route tests pass (2), lint clean, full suite green.

- [ ] **Step 6: Commit**

```bash
git add server/routes/tdd.routes.ts server/routes/tdd.routes.test.ts server/app.ts server/index.ts
git commit -m "feat(slice-26): /api/tdd/run SSE route wired into app"
```

---

## Task 6: Frontend API + run hook

**Files:**
- Create: `src/lib/api/tdd.api.ts`
- Create: `src/hooks/useTddRun.ts`
- Test: `src/hooks/useTddRun.test.ts`

- [ ] **Step 1: Write the API client**

`src/lib/api/tdd.api.ts`:

```ts
export interface TddRunRequest {
  command: string;
  subAgentName: string;
  maxRetries?: number;
}

export const tddApi = {
  run: (req: TddRunRequest, signal: AbortSignal): Promise<Response> =>
    fetch('/api/tdd/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req),
      signal,
    }),
};
```

- [ ] **Step 2: Write the failing hook reducer test**

`src/hooks/useTddRun.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { reduceTdd, type TddViewState, INITIAL_TDD } from './useTddRun';

function run(events: [string, any][]): TddViewState {
  return events.reduce((s, [name, data]) => reduceTdd(s, name, data), { ...INITIAL_TDD, running: true });
}

describe('reduceTdd', () => {
  it('tracks iterations and test results', () => {
    const s = run([
      ['tdd_started', { command: 'cmd', maxRetries: 5 }],
      ['tdd_test_result', { iteration: 0, passed: false, exitCode: 1, output: 'FAIL' }],
      ['tdd_iteration_started', { iteration: 1 }],
      ['tdd_test_result', { iteration: 1, passed: true, exitCode: 0, output: 'ok' }],
      ['tdd_done', { status: 'success', iterations: 1 }],
    ]);
    expect(s.results).toHaveLength(2);
    expect(s.results[1].passed).toBe(true);
    expect(s.status).toBe('success');
    expect(s.running).toBe(false);
  });

  it('captures errors', () => {
    const s = run([['tdd_error', { message: 'boom' }], ['tdd_done', { status: 'error' }]]);
    expect(s.error).toBe('boom');
    expect(s.status).toBe('error');
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run src/hooks/useTddRun.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 4: Implement the hook**

`src/hooks/useTddRun.ts`:

```ts
import { useCallback, useRef, useState } from 'react';
import { parseSseStream } from '@/src/lib/sse-parser';
import { tddApi, type TddRunRequest } from '@/src/lib/api/tdd.api';

export interface TddResultView {
  iteration: number;
  passed: boolean;
  exitCode: number;
  output: string;
}
export interface TddViewState {
  running: boolean;
  results: TddResultView[];
  currentIteration: number;
  status: string | null;
  error: string | null;
}

export const INITIAL_TDD: TddViewState = {
  running: false,
  results: [],
  currentIteration: 0,
  status: null,
  error: null,
};

export function reduceTdd(s: TddViewState, name: string, data: any): TddViewState {
  switch (name) {
    case 'tdd_iteration_started':
      return { ...s, currentIteration: data.iteration };
    case 'tdd_test_result':
      return {
        ...s,
        results: [
          ...s.results,
          { iteration: data.iteration, passed: data.passed, exitCode: data.exitCode, output: data.output },
        ],
      };
    case 'tdd_error':
      return { ...s, error: data.message };
    case 'tdd_done':
      return { ...s, running: false, status: data.status };
    default:
      return s;
  }
}

export function useTddRun() {
  const [state, setState] = useState<TddViewState>(INITIAL_TDD);
  const abortRef = useRef<AbortController | null>(null);

  const run = useCallback(async (req: TddRunRequest) => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setState({ ...INITIAL_TDD, running: true });

    const res = await tddApi.run(req, controller.signal);
    if (!res.body) {
      setState((s) => ({ ...s, running: false, error: 'no stream' }));
      return;
    }
    for await (const ev of parseSseStream(res.body)) {
      setState((s) => reduceTdd(s, ev.event, ev.data as any));
    }
  }, []);

  const cancel = useCallback(() => abortRef.current?.abort(), []);

  return { state, run, cancel };
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run src/hooks/useTddRun.test.ts`
Expected: PASS (2 tests). Then `npm run lint` clean.

- [ ] **Step 6: Commit**

```bash
git add src/lib/api/tdd.api.ts src/hooks/useTddRun.ts src/hooks/useTddRun.test.ts
git commit -m "feat(slice-26): TDD run API client + useTddRun hook"
```

---

## Task 7: UI — modal, panel, palette command, app wiring

**Files:**
- Create: `src/stores/tdd-ui.store.ts`
- Create: `src/components/tdd/TddRunModal.tsx`
- Create: `src/components/tdd/TddRunPanel.tsx`
- Modify: `src/hooks/useCommands.ts`, `src/App.tsx`

- [ ] **Step 1: Create the UI store**

`src/stores/tdd-ui.store.ts`:

```ts
import { create } from 'zustand';

interface TddUiState {
  open: boolean;
  openModal: () => void;
  closeModal: () => void;
}

export const useTddUiStore = create<TddUiState>((set) => ({
  open: false,
  openModal: () => set({ open: true }),
  closeModal: () => set({ open: false }),
}));
```

- [ ] **Step 2: Create the run panel**

`src/components/tdd/TddRunPanel.tsx`:

```tsx
import { useTddRun } from '@/src/hooks/useTddRun';

export function TddRunPanel({
  command,
  subAgentName,
  maxRetries,
}: {
  command: string;
  subAgentName: string;
  maxRetries: number;
}) {
  const { state, run, cancel } = useTddRun();

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <button
          className="px-3 py-1.5 rounded bg-manipulation text-black hover:bg-manipulation/90 disabled:opacity-40"
          disabled={state.running}
          onClick={() => run({ command, subAgentName, maxRetries })}
        >
          Run
        </button>
        {state.running && (
          <button className="px-2 py-1 rounded bg-status-error/20 text-status-error text-xs" onClick={cancel}>
            Cancel
          </button>
        )}
        <span className="text-[11px] text-zinc-500 font-mono truncate">{command}</span>
      </div>

      <ol className="flex flex-col gap-2">
        {state.results.map((r) => (
          <li key={r.iteration} className="rounded border border-border-subtle bg-surface-1 p-2">
            <div className={`text-[10px] uppercase tracking-widest ${r.passed ? 'text-status-online' : 'text-status-error'}`}>
              {r.iteration === 0 ? 'initial' : `iteration ${r.iteration}`} — {r.passed ? 'pass' : `fail (exit ${r.exitCode})`}
            </div>
            <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap text-[11px] text-zinc-400">{r.output}</pre>
          </li>
        ))}
      </ol>

      {state.error && <div className="text-xs text-status-error">{state.error}</div>}
      {state.status && <div className="text-xs text-zinc-400">Status: {state.status}</div>}
    </div>
  );
}
```

- [ ] **Step 3: Create the modal**

`src/components/tdd/TddRunModal.tsx`:

```tsx
import { useState } from 'react';
import { Modal } from '@/src/components/ui/Modal';
import { useSubAgentsStore } from '@/src/stores/subagents.store';
import { useTddUiStore } from '@/src/stores/tdd-ui.store';
import { TddRunPanel } from './TddRunPanel';

export function TddRunModal() {
  const open = useTddUiStore((s) => s.open);
  const close = useTddUiStore((s) => s.closeModal);
  const subAgents = useSubAgentsStore((s) => s.list);

  const [command, setCommand] = useState('npx vitest run');
  const [subAgentName, setSubAgentName] = useState('');
  const [maxRetries, setMaxRetries] = useState(5);
  const [started, setStarted] = useState(false);

  if (!open) return null;
  const fixer = subAgentName || subAgents[0]?.name || '';

  return (
    <Modal open onClose={close} title="Auto-fix tests">
      {subAgents.length === 0 ? (
        <div className="text-sm text-zinc-400">Create a sub-agent first to use as the fixer.</div>
      ) : !started ? (
        <div className="flex flex-col gap-3">
          <label className="text-[11px] text-zinc-400">Test command</label>
          <input
            className="w-full bg-surface-2 border border-border-subtle rounded px-2 py-1.5 text-sm text-white font-mono"
            value={command}
            onChange={(e) => setCommand(e.target.value)}
          />
          <label className="text-[11px] text-zinc-400">Fixer sub-agent</label>
          <select
            className="bg-surface-2 border border-border-subtle rounded px-2 py-1 text-sm text-zinc-100"
            value={fixer}
            onChange={(e) => setSubAgentName(e.target.value)}
          >
            {subAgents.map((sa) => (
              <option key={sa.id} value={sa.name}>{sa.name}</option>
            ))}
          </select>
          <label className="text-[11px] text-zinc-400">Max retries</label>
          <input
            type="number"
            min={1}
            max={20}
            className="w-24 bg-surface-2 border border-border-subtle rounded px-2 py-1 text-sm text-zinc-100"
            value={maxRetries}
            onChange={(e) => setMaxRetries(Math.max(1, Math.min(20, Number(e.target.value) || 1)))}
          />
          <button
            className="self-end px-3 py-1.5 rounded bg-manipulation text-black hover:bg-manipulation/90 disabled:opacity-40"
            disabled={command.trim().length === 0 || !fixer}
            onClick={() => setStarted(true)}
          >
            Start
          </button>
        </div>
      ) : (
        <TddRunPanel command={command} subAgentName={fixer} maxRetries={maxRetries} />
      )}
    </Modal>
  );
}
```

> Confirm the `Modal` props (`open`/`onClose`/`title`) against `src/components/ui/Modal.tsx`
> (slice 25 used the same component). Status-color tokens (`status-online`, `status-error`)
> are used elsewhere in the app; confirm they exist in `src/styles/theme.css`.

- [ ] **Step 4: Add the palette command**

In `src/hooks/useCommands.ts`, import the store and a suitable icon (check existing imports;
`Wrench` from `lucide-react` is appropriate — add it to the lucide import if absent), then add
to the `out` array:

```ts
out.push({
  id: 'tdd.auto-fix',
  group: 'ui',
  label: 'Auto-fix tests…',
  icon: Wrench,
  run: () => useTddUiStore.getState().openModal(),
});
```
Add `import { useTddUiStore } from '@/src/stores/tdd-ui.store';` at the top.

- [ ] **Step 5: Render the modal at the app root**

In `src/App.tsx`, render `<TddRunModal />` alongside the other root-level modals/overlays
(it self-hides when the store is closed), and add
`import { TddRunModal } from '@/src/components/tdd/TddRunModal';`.

- [ ] **Step 6: Verify**

Run: `npm run lint`
Expected: clean (fix Modal/icon/token references against real code until clean).

- [ ] **Step 7: Commit**

```bash
git add src/stores/tdd-ui.store.ts src/components/tdd src/hooks/useCommands.ts src/App.tsx
git commit -m "feat(slice-26): Auto-fix tests palette command, modal, and run panel"
```

---

## Task 8: Roadmap

**Files:**
- Modify: `docs/superpowers/roadmap.md`

- [ ] **Step 1: Mark the slice shipped**

In the `## Shipped` table, add after the slice 25 row:
```markdown
| 26 | Test-Driven Auto-Resolution (configurable command, fixer sub-agent, SSE loop) | `feat/slice-26-tdd-loop` | ✅ |
```
Remove the `### Slice 26 — Test-Driven Auto-Resolution (Red-Green-Refactor Loop)` stub block
(including its `---` divider) from the `## Killer Features` section. (The agentic-depth track
is now fully shipped; leave the "Candidate Killer Features" section intact.)

- [ ] **Step 2: Commit**

```bash
git add docs/superpowers/roadmap.md
git commit -m "docs(slice-26): mark TDD auto-resolution slice shipped"
```

---

## Final verification

- [ ] `npm run lint` clean.
- [ ] `npm run test:run` green (collecting-sse moved, run-command, runner, route, hook + existing suite).
- [ ] `npm run test:coverage` — `server/domain/tdd/**` and `server/lib/**` meet the 80% thresholds.
- [ ] Manual (user): create a `@coder` sub-agent, point "Auto-fix tests…" at a deliberately failing test with the Fake provider, confirm the loop streams iterations and terminates.

## Final code review (required)

Per the spec's "Final code review" section, after all tasks pass, dispatch a final adversarial
review of the whole branch diff (`main..HEAD`) before opening/merging the PR — focusing on loop
abort propagation, exit-code robustness, `tail()` bounding, SSE termination, and the
collecting-sse move leaving no stale imports. Fix and re-review any findings.

## Self-review notes (author)

- **Spec coverage:** shared refactor (T1), types+schema (T2), runCommand/exit-code (T3), loop with
  already-green/red→green/max-retries/unknown-agent/turn-error/interrupted (T4), route+wiring (T5),
  FE api+hook (T6), modal+panel+palette+app (T7), roadmap (T8), final review (closing section). All
  spec sections mapped.
- **Deviation:** `createSession()` takes no title (HistoryStore.createEmpty has none) — same as
  slice 25; sessions auto-title from messages.
- **Type consistency:** `CommandResult`/`TddRunnerDeps`/`TddDispatcher` defined in `tdd.types.ts`
  and reused in runner/route; `reduceTdd`/`TddViewState`/`INITIAL_TDD` consistent T6↔test; SSE event
  names (`tdd_started`, `tdd_iteration_started`, `tdd_test_result`, `tdd_error`, `tdd_done`) identical
  between runner (T4) and hook reducer (T6).
- **Flagged for implementer:** `Modal` props + theme tokens (T7), the awkward `not.toBeDefined` line
  in T4's already-green test (provided a robust alternative). `executeCommand`'s `BLOCKED_PATTERNS`
  safety filter still applies to the user's command — intended behavior, not a bug.
```
