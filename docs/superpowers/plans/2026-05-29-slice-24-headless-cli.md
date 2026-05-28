# Slice 24 — Headless Daemon + `aether-cli` Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a thin `aether` CLI that manages a detached Aether server daemon and streams one-shot prompts to it over the existing HTTP+SSE endpoints, with clean stdout for Unix piping.

**Architecture:** A pure SSE-client CLI (`cli/`) over existing endpoints (`POST /api/sessions`, `POST /api/ai/dispatch`, `GET /api/health`, `POST /api/mcp/decision`). The daemon is the standard server (`dist/server.cjs`) spawned detached; when launched with `AETHER_DAEMON=1` it binds `127.0.0.1` and writes a `daemon.json` endpoint/PID file in `dataDir`. Gated MCP tool calls are auto-rejected client-side (a background reject POST), needing no server dispatch changes.

**Tech Stack:** TypeScript, Node built-ins (`node:http` via global `fetch`, `node:child_process`, `node:fs`), esbuild bundle, Vitest. No new runtime dependencies.

---

## Conventions for every task

- Run a focused test with: `npx vitest run <path>` (backend project picks up `server/**` and — after Task 1 — `cli/**`).
- Type-check with: `npm run lint` (this is `tsc --noEmit`).
- Imports use the `@/` root alias (e.g. `@/server/lib/daemon-file`).
- Commit after each task with the message shown in its final step.

## File structure (locked)

```
server/lib/daemon-file.ts        # read/write/clear daemon.json  (shared, server writes / CLI reads)
server/lib/daemon-file.test.ts
server/index.ts                  # MODIFY: AETHER_DAEMON bind 127.0.0.1 + write/clear daemon.json

cli/config.ts                    # dataDir() + resolveEndpoint() precedence
cli/config.test.ts
cli/sse-consumer.ts              # streaming SSE text -> parsed events
cli/sse-consumer.test.ts
cli/output.ts                    # event -> stdout/stderr/json routing
cli/output.test.ts
cli/client.ts                    # createSession / dispatch / rejectDecision (HTTP+SSE)
cli/client.test.ts
cli/daemon.ts                    # start/stop/status (detached spawn, PID file, health)
cli/daemon.test.ts
cli/args.ts                      # parseArgs() pure parser
cli/args.test.ts
cli/index.ts                     # bin entrypoint: stdin + command router (thin, untested glue)

vitest.config.ts                 # MODIFY: cli/** in backend project + coverage thresholds
package.json                     # MODIFY: bin + esbuild cli bundle step
README.md / docs roadmap         # MODIFY: document the CLI
```

**Flag scope note:** global flags are `--json`, `--provider <name>`, `--port <n>`, `--session <id>`. The `--verbose` flag mentioned loosely in the spec is **deferred** (YAGNI) — thinking/tool events always go to stderr in text mode.

---

## Task 1: Wire `cli/**` into the test runner

**Files:**
- Modify: `vitest.config.ts:58` (backend `include`) and `vitest.config.ts:30-36` (thresholds)

- [ ] **Step 1: Add `cli/**` to the backend project include**

In `vitest.config.ts`, change the backend project's include (line 58) from:

```ts
          include: ['server/**/*.{test,spec}.ts'],
```

to:

```ts
          include: ['server/**/*.{test,spec}.ts', 'cli/**/*.{test,spec}.ts'],
```

- [ ] **Step 2: Add `cli/**` to coverage thresholds**

In the `thresholds` block (after line 32, the `server/lib/**` line), add:

```ts
        'cli/**': { branches: 80, functions: 80, lines: 80, statements: 80 },
```

- [ ] **Step 3: Verify config still loads**

Run: `npx vitest run --project backend -t "nonexistent-placeholder"`
Expected: exits cleanly with "No test files found" or 0 tests run — no config parse error.

- [ ] **Step 4: Commit**

```bash
git add vitest.config.ts
git commit -m "test(slice-24): include cli/** in backend vitest project + coverage"
```

---

## Task 2: `daemon-file.ts` — read/write/clear the endpoint file

**Files:**
- Create: `server/lib/daemon-file.ts`
- Test: `server/lib/daemon-file.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// server/lib/daemon-file.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  daemonFilePath,
  writeDaemonFile,
  readDaemonFile,
  clearDaemonFile,
} from './daemon-file';

let dir: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aether-daemon-'));
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('daemon-file', () => {
  it('writes then reads back the same info', () => {
    const info = { pid: 123, host: '127.0.0.1', port: 3000, startedAt: '2026-05-29T00:00:00.000Z' };
    writeDaemonFile(dir, info);
    expect(fs.existsSync(daemonFilePath(dir))).toBe(true);
    expect(readDaemonFile(dir)).toEqual(info);
  });

  it('returns null when the file is missing', () => {
    expect(readDaemonFile(dir)).toBeNull();
  });

  it('returns null when the file is corrupt', () => {
    fs.writeFileSync(daemonFilePath(dir), 'not json');
    expect(readDaemonFile(dir)).toBeNull();
  });

  it('clear removes the file and is safe when already absent', () => {
    writeDaemonFile(dir, { pid: 1, host: '127.0.0.1', port: 3000, startedAt: 'x' });
    clearDaemonFile(dir);
    expect(fs.existsSync(daemonFilePath(dir))).toBe(false);
    expect(() => clearDaemonFile(dir)).not.toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run server/lib/daemon-file.test.ts`
Expected: FAIL — `Cannot find module './daemon-file'`.

- [ ] **Step 3: Implement the module**

```ts
// server/lib/daemon-file.ts
import fs from 'node:fs';
import path from 'node:path';

export interface DaemonInfo {
  pid: number;
  host: string;
  port: number;
  startedAt: string;
}

export function daemonFilePath(dataDir: string): string {
  return path.join(dataDir, 'daemon.json');
}

export function writeDaemonFile(dataDir: string, info: DaemonInfo): void {
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(daemonFilePath(dataDir), JSON.stringify(info), 'utf8');
}

export function readDaemonFile(dataDir: string): DaemonInfo | null {
  try {
    const raw = fs.readFileSync(daemonFilePath(dataDir), 'utf8');
    const parsed = JSON.parse(raw) as DaemonInfo;
    if (typeof parsed.pid !== 'number' || typeof parsed.port !== 'number') return null;
    return parsed;
  } catch {
    return null;
  }
}

export function clearDaemonFile(dataDir: string): void {
  try {
    fs.unlinkSync(daemonFilePath(dataDir));
  } catch {
    // already gone — fine
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run server/lib/daemon-file.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add server/lib/daemon-file.ts server/lib/daemon-file.test.ts
git commit -m "feat(slice-24): daemon.json read/write/clear helper"
```

---

## Task 3: Server — bind `127.0.0.1` + manage `daemon.json` under `AETHER_DAEMON`

**Files:**
- Modify: `server/index.ts:207-209` (the `app.listen` block) and the imports near top.

`server/index.ts` is excluded from coverage (tested logic lives in Task 2); this task is wiring + a manual smoke check.

- [ ] **Step 1: Import the helper and `os`**

At the top of `server/index.ts`, after the existing `node:url` import, add:

```ts
import { writeDaemonFile, clearDaemonFile } from './lib/daemon-file';
```

- [ ] **Step 2: Replace the `app.listen` block**

Replace lines 207-209:

```ts
  app.listen(cfg.port, '0.0.0.0', () => {
    console.log(`Aether server running on http://localhost:${cfg.port}`);
  });
```

with:

```ts
  const isDaemon = process.env.AETHER_DAEMON === '1';
  const host = isDaemon ? '127.0.0.1' : '0.0.0.0';

  app.listen(cfg.port, host, () => {
    console.log(`Aether server running on http://localhost:${cfg.port}`);
    if (isDaemon) {
      writeDaemonFile(cfg.dataDir, {
        pid: process.pid,
        host: '127.0.0.1',
        port: cfg.port,
        startedAt: new Date().toISOString(),
      });
    }
  });

  if (isDaemon) {
    const cleanup = () => {
      clearDaemonFile(cfg.dataDir);
      process.exit(0);
    };
    process.on('SIGTERM', cleanup);
    process.on('SIGINT', cleanup);
    process.on('exit', () => clearDaemonFile(cfg.dataDir));
  }
```

- [ ] **Step 3: Type-check**

Run: `npm run lint`
Expected: no errors.

- [ ] **Step 4: Manual smoke check (documented, not automated)**

Run: `AETHER_DAEMON=1 AETHER_FAKE_PROVIDER=1 PORT=3999 npx tsx server/index.ts`
Expected: console prints the running line, and `data/daemon.json` exists containing the right pid/port. `Ctrl-C` removes the file. Stop the process afterwards.

- [ ] **Step 5: Commit**

```bash
git add server/index.ts
git commit -m "feat(slice-24): server binds 127.0.0.1 + writes daemon.json under AETHER_DAEMON"
```

---

## Task 4: `cli/config.ts` — endpoint resolution

**Files:**
- Create: `cli/config.ts`
- Test: `cli/config.test.ts`

Precedence for port: `opts.port` > `daemon.json.port` > `PORT` env > `3000`. Host: `daemon.json.host` if present, else `127.0.0.1`.

- [ ] **Step 1: Write the failing test**

```ts
// cli/config.test.ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { resolveEndpoint } from './config';

let dir: string;
const ORIG = { ...process.env };

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aether-cfg-'));
  process.env.AETHER_DATA_DIR = dir;
  delete process.env.PORT;
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
  process.env = { ...ORIG };
  vi.restoreAllMocks();
});

describe('resolveEndpoint', () => {
  it('defaults to 127.0.0.1:3000 when nothing is set', () => {
    expect(resolveEndpoint({})).toEqual({
      host: '127.0.0.1',
      port: 3000,
      baseUrl: 'http://127.0.0.1:3000',
    });
  });

  it('uses PORT env over the default', () => {
    process.env.PORT = '4100';
    expect(resolveEndpoint({}).port).toBe(4100);
  });

  it('uses daemon.json over PORT env', () => {
    process.env.PORT = '4100';
    fs.writeFileSync(
      path.join(dir, 'daemon.json'),
      JSON.stringify({ pid: 1, host: '127.0.0.1', port: 4222, startedAt: 'x' }),
    );
    expect(resolveEndpoint({}).port).toBe(4222);
  });

  it('uses opts.port over everything', () => {
    process.env.PORT = '4100';
    fs.writeFileSync(
      path.join(dir, 'daemon.json'),
      JSON.stringify({ pid: 1, host: '127.0.0.1', port: 4222, startedAt: 'x' }),
    );
    expect(resolveEndpoint({ port: 5000 }).port).toBe(5000);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run cli/config.test.ts`
Expected: FAIL — `Cannot find module './config'`.

- [ ] **Step 3: Implement the module**

```ts
// cli/config.ts
import path from 'node:path';
import { readDaemonFile } from '@/server/lib/daemon-file';

export function dataDir(): string {
  return process.env.AETHER_DATA_DIR ?? path.resolve(process.cwd(), 'data');
}

export interface Endpoint {
  host: string;
  port: number;
  baseUrl: string;
}

export function resolveEndpoint(opts: { port?: number }): Endpoint {
  const info = readDaemonFile(dataDir());
  const envPort = process.env.PORT ? parseInt(process.env.PORT, 10) : undefined;

  const port =
    opts.port ??
    info?.port ??
    (envPort && Number.isFinite(envPort) && envPort > 0 ? envPort : undefined) ??
    3000;
  const host = info?.host ?? '127.0.0.1';

  return { host, port, baseUrl: `http://${host}:${port}` };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run cli/config.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add cli/config.ts cli/config.test.ts
git commit -m "feat(slice-24): CLI endpoint resolution (--port > daemon.json > PORT > default)"
```

---

## Task 5: `cli/sse-consumer.ts` — streaming SSE parser

**Files:**
- Create: `cli/sse-consumer.ts`
- Test: `cli/sse-consumer.test.ts`

Parses the wire format produced by `server/lib/sse.ts`: blocks separated by `\n\n`, each with an `event: <name>` line and a `data: <json>` line.

- [ ] **Step 1: Write the failing test**

```ts
// cli/sse-consumer.test.ts
import { describe, it, expect } from 'vitest';
import { createSseParser, type SseEvent } from './sse-consumer';

function collect(chunks: string[]): SseEvent[] {
  const events: SseEvent[] = [];
  const feed = createSseParser((e) => events.push(e));
  for (const c of chunks) feed(c);
  return events;
}

describe('createSseParser', () => {
  it('parses a single complete event', () => {
    const events = collect(['event: text\ndata: {"chunk":"hi"}\n\n']);
    expect(events).toEqual([{ event: 'text', data: { chunk: 'hi' } }]);
  });

  it('parses multiple events in one chunk', () => {
    const events = collect([
      'event: text\ndata: {"chunk":"a"}\n\nevent: done\ndata: {"interrupted":false}\n\n',
    ]);
    expect(events.map((e) => e.event)).toEqual(['text', 'done']);
  });

  it('reassembles an event split across chunks mid-line', () => {
    const events = collect(['event: text\nda', 'ta: {"chunk":"split"}\n\n']);
    expect(events).toEqual([{ event: 'text', data: { chunk: 'split' } }]);
  });

  it('ignores blocks without a data line', () => {
    const events = collect([': keep-alive comment\n\n']);
    expect(events).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run cli/sse-consumer.test.ts`
Expected: FAIL — `Cannot find module './sse-consumer'`.

- [ ] **Step 3: Implement the parser**

```ts
// cli/sse-consumer.ts
export interface SseEvent {
  event: string;
  data: unknown;
}

/** Returns a `feed(chunk)` function that buffers partial SSE text and invokes
 *  `onEvent` for each complete `event:`/`data:` block (separated by a blank line). */
export function createSseParser(onEvent: (e: SseEvent) => void): (chunk: string) => void {
  let buffer = '';

  return (chunk: string) => {
    buffer += chunk;
    let sep: number;
    while ((sep = buffer.indexOf('\n\n')) !== -1) {
      const block = buffer.slice(0, sep);
      buffer = buffer.slice(sep + 2);

      let name = 'message';
      let dataLine: string | null = null;
      for (const line of block.split('\n')) {
        if (line.startsWith('event:')) name = line.slice('event:'.length).trim();
        else if (line.startsWith('data:')) dataLine = line.slice('data:'.length).trim();
      }
      if (dataLine === null) continue;

      let data: unknown = dataLine;
      try {
        data = JSON.parse(dataLine);
      } catch {
        // leave as raw string
      }
      onEvent({ event: name, data });
    }
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run cli/sse-consumer.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add cli/sse-consumer.ts cli/sse-consumer.test.ts
git commit -m "feat(slice-24): streaming SSE parser for the CLI"
```

---

## Task 6: `cli/output.ts` — route events to stdout/stderr/json

**Files:**
- Create: `cli/output.ts`
- Test: `cli/output.test.ts`

In text mode: `text` chunks → stdout; `thinking`, `tool_call_*` → stderr; `done` → returns `{done:true}`; `error` → returns `{done:true, error}`. In `--json` mode: every event → one JSON line on stdout.

- [ ] **Step 1: Write the failing test**

```ts
// cli/output.test.ts
import { describe, it, expect } from 'vitest';
import { handleEvent, type Writer } from './output';

function makeWriter() {
  const out: string[] = [];
  const err: string[] = [];
  const w: Writer = { out: (s) => out.push(s), err: (s) => err.push(s) };
  return { w, out, err };
}

describe('handleEvent (text mode)', () => {
  it('writes text chunks to stdout', () => {
    const { w, out, err } = makeWriter();
    const r = handleEvent({ event: 'text', data: { chunk: 'hello' } }, { json: false }, w);
    expect(out.join('')).toBe('hello');
    expect(err).toEqual([]);
    expect(r.done).toBe(false);
  });

  it('writes thinking to stderr, not stdout', () => {
    const { w, out, err } = makeWriter();
    handleEvent({ event: 'thinking', data: { chunk: 'pondering' } }, { json: false }, w);
    expect(out).toEqual([]);
    expect(err.join('')).toContain('pondering');
  });

  it('routes tool_call_request to stderr', () => {
    const { w, out, err } = makeWriter();
    handleEvent(
      { event: 'tool_call_request', data: { qualifiedName: 'fs.read', callId: 'c1' } },
      { json: false },
      w,
    );
    expect(out).toEqual([]);
    expect(err.join('')).toContain('fs.read');
  });

  it('signals done', () => {
    const { w } = makeWriter();
    const r = handleEvent({ event: 'done', data: { interrupted: false } }, { json: false }, w);
    expect(r.done).toBe(true);
  });

  it('signals done with error message', () => {
    const { w, err } = makeWriter();
    const r = handleEvent(
      { event: 'error', data: { message: 'boom', retryable: false } },
      { json: false },
      w,
    );
    expect(r.done).toBe(true);
    expect(r.error).toBe('boom');
    expect(err.join('')).toContain('boom');
  });
});

describe('handleEvent (json mode)', () => {
  it('emits one JSON line per event on stdout', () => {
    const { w, out } = makeWriter();
    handleEvent({ event: 'text', data: { chunk: 'x' } }, { json: true }, w);
    expect(out).toEqual(['{"event":"text","data":{"chunk":"x"}}\n']);
  });

  it('still signals done in json mode', () => {
    const { w } = makeWriter();
    const r = handleEvent({ event: 'done', data: {} }, { json: true }, w);
    expect(r.done).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run cli/output.test.ts`
Expected: FAIL — `Cannot find module './output'`.

- [ ] **Step 3: Implement the module**

```ts
// cli/output.ts
import type { SseEvent } from './sse-consumer';

export interface Writer {
  out: (s: string) => void;
  err: (s: string) => void;
}

export interface HandleResult {
  done: boolean;
  error?: string;
}

const DIM = '\x1b[2m';
const RESET = '\x1b[0m';

function dataChunk(data: unknown): string {
  return typeof data === 'object' && data !== null && 'chunk' in data
    ? String((data as { chunk: unknown }).chunk)
    : '';
}

export function handleEvent(
  ev: SseEvent,
  opts: { json: boolean },
  w: Writer,
): HandleResult {
  if (opts.json) {
    w.out(JSON.stringify(ev) + '\n');
    if (ev.event === 'done') return { done: true };
    if (ev.event === 'error') {
      const msg = (ev.data as { message?: string })?.message ?? 'error';
      return { done: true, error: msg };
    }
    return { done: false };
  }

  switch (ev.event) {
    case 'text':
      w.out(dataChunk(ev.data));
      return { done: false };
    case 'thinking':
      w.err(`${DIM}${dataChunk(ev.data)}${RESET}`);
      return { done: false };
    case 'tool_call_request': {
      const name = (ev.data as { qualifiedName?: string })?.qualifiedName ?? 'tool';
      w.err(`${DIM}→ tool: ${name}${RESET}\n`);
      return { done: false };
    }
    case 'tool_call_result': {
      const res = ev.data as { ok?: boolean; error?: string };
      const note = res?.ok ? 'ok' : `rejected/failed: ${res?.error ?? ''}`;
      w.err(`${DIM}← tool result: ${note}${RESET}\n`);
      return { done: false };
    }
    case 'tool_call_started':
    case 'tool_call_progress':
      return { done: false };
    case 'done':
      w.out('\n');
      return { done: true };
    case 'error': {
      const msg = (ev.data as { message?: string })?.message ?? 'error';
      w.err(`\naether: error: ${msg}\n`);
      return { done: true, error: msg };
    }
    default:
      return { done: false };
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run cli/output.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add cli/output.ts cli/output.test.ts
git commit -m "feat(slice-24): CLI output routing (stdout/stderr/json)"
```

---

## Task 7: `cli/client.ts` — create session, dispatch, reject gate

**Files:**
- Create: `cli/client.ts`
- Test: `cli/client.test.ts`

Uses global `fetch` (Node ≥18). `dispatch` streams the response body and feeds the SSE parser. On `tool_call_request` the caller (Task 9) triggers `rejectDecision`; the client exposes it as a standalone function. Tests spin a real ephemeral `node:http` server so the streaming path is exercised end to end.

- [ ] **Step 1: Write the failing test**

```ts
// cli/client.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { createSession, dispatch, rejectDecision } from './client';
import type { SseEvent } from './sse-consumer';

let server: http.Server;
let baseUrl: string;
const seen: { method: string; url: string; body: string }[] = [];

function start(handler: http.RequestListener): Promise<void> {
  server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      seen.push({ method: req.method ?? '', url: req.url ?? '', body });
      handler(req, res);
    });
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
      resolve();
    });
  });
}

beforeEach(() => {
  seen.length = 0;
});
afterEach(() => {
  server?.close();
});

describe('createSession', () => {
  it('POSTs /api/sessions and returns the new id', async () => {
    await start((_req, res) => {
      res.writeHead(201, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ id: 'sess-1' }));
    });
    const id = await createSession(baseUrl);
    expect(id).toBe('sess-1');
    expect(seen[0]).toMatchObject({ method: 'POST', url: '/api/sessions' });
  });
});

describe('dispatch', () => {
  it('streams SSE events to onEvent', async () => {
    await start((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      res.write('event: text\ndata: {"chunk":"hi"}\n\n');
      res.write('event: done\ndata: {"interrupted":false}\n\n');
      res.end();
    });
    const events: SseEvent[] = [];
    await dispatch({
      baseUrl,
      sessionId: 'sess-1',
      message: 'hello',
      onEvent: (e) => events.push(e),
    });
    expect(events.map((e) => e.event)).toEqual(['text', 'done']);
    expect(seen[0]).toMatchObject({ method: 'POST', url: '/api/ai/dispatch' });
    expect(JSON.parse(seen[0].body)).toMatchObject({ sessionId: 'sess-1', message: 'hello' });
  });
});

describe('rejectDecision', () => {
  it('POSTs a reject decision for the callId', async () => {
    await start((_req, res) => {
      res.writeHead(200);
      res.end('{}');
    });
    await rejectDecision(baseUrl, 'call-9');
    expect(seen[0]).toMatchObject({ method: 'POST', url: '/api/mcp/decision' });
    expect(JSON.parse(seen[0].body)).toEqual({ callId: 'call-9', action: 'reject' });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run cli/client.test.ts`
Expected: FAIL — `Cannot find module './client'`.

- [ ] **Step 3: Implement the client**

```ts
// cli/client.ts
import { createSseParser, type SseEvent } from './sse-consumer';

export async function createSession(baseUrl: string): Promise<string> {
  const res = await fetch(`${baseUrl}/api/sessions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
  });
  if (!res.ok) throw new Error(`create session failed: HTTP ${res.status}`);
  const meta = (await res.json()) as { id: string };
  return meta.id;
}

export interface DispatchOpts {
  baseUrl: string;
  sessionId: string;
  message: string;
  providerName?: string;
  onEvent: (e: SseEvent) => void;
  signal?: AbortSignal;
}

export async function dispatch(opts: DispatchOpts): Promise<void> {
  const res = await fetch(`${opts.baseUrl}/api/ai/dispatch`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      sessionId: opts.sessionId,
      message: opts.message,
      ...(opts.providerName ? { providerName: opts.providerName } : {}),
    }),
    signal: opts.signal,
  });
  if (!res.ok || !res.body) throw new Error(`dispatch failed: HTTP ${res.status}`);

  const feed = createSseParser(opts.onEvent);
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    feed(decoder.decode(value, { stream: true }));
  }
}

export async function rejectDecision(baseUrl: string, callId: string): Promise<void> {
  await fetch(`${baseUrl}/api/mcp/decision`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ callId, action: 'reject' }),
  }).catch(() => {
    // best-effort: gate rejection must never crash the stream
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run cli/client.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add cli/client.ts cli/client.test.ts
git commit -m "feat(slice-24): CLI HTTP+SSE client (session/dispatch/reject)"
```

---

## Task 8: `cli/daemon.ts` — start/stop/status

**Files:**
- Create: `cli/daemon.ts`
- Test: `cli/daemon.test.ts`

Dependencies are injectable for testing (spawn, health check, file read/clear, process-kill, sleep). Real defaults are provided so `index.ts` calls them with no args.

- [ ] **Step 1: Write the failing test**

```ts
// cli/daemon.test.ts
import { describe, it, expect, vi } from 'vitest';
import { startDaemon, statusDaemon, stopDaemon, type DaemonDeps } from './daemon';

function deps(over: Partial<DaemonDeps>): DaemonDeps {
  return {
    spawn: vi.fn(() => ({ pid: 4242, unref: vi.fn() })),
    health: vi.fn(async () => true),
    readInfo: vi.fn(() => null),
    clearInfo: vi.fn(),
    kill: vi.fn(),
    sleep: vi.fn(async () => {}),
    baseUrl: 'http://127.0.0.1:3000',
    serverEntry: '/repo/dist/server.cjs',
    port: 3000,
    ...over,
  };
}

describe('startDaemon', () => {
  it('returns already=true when health already responds', async () => {
    const d = deps({
      readInfo: vi.fn(() => ({ pid: 1, host: '127.0.0.1', port: 3000, startedAt: 'x' })),
      health: vi.fn(async () => true),
    });
    const r = await startDaemon(d);
    expect(r.already).toBe(true);
    expect(d.spawn).not.toHaveBeenCalled();
  });

  it('spawns detached and polls health when not running', async () => {
    const calls = [false, false, true];
    const d = deps({ health: vi.fn(async () => calls.shift() ?? true) });
    const r = await startDaemon(d);
    expect(d.spawn).toHaveBeenCalledTimes(1);
    expect(r.already).toBe(false);
    expect(r.pid).toBe(4242);
  });

  it('throws if health never comes up within the attempts', async () => {
    const d = deps({ health: vi.fn(async () => false) });
    await expect(startDaemon(d, { attempts: 3 })).rejects.toThrow(/did not become healthy/i);
  });
});

describe('statusDaemon', () => {
  it('reports running when info present and health ok', async () => {
    const d = deps({
      readInfo: vi.fn(() => ({ pid: 7, host: '127.0.0.1', port: 3000, startedAt: 'x' })),
      health: vi.fn(async () => true),
    });
    expect(await statusDaemon(d)).toMatchObject({ running: true, pid: 7, port: 3000 });
  });

  it('reports not running when no info', async () => {
    expect(await statusDaemon(deps({}))).toMatchObject({ running: false });
  });
});

describe('stopDaemon', () => {
  it('kills the pid and clears the file', async () => {
    const d = deps({
      readInfo: vi.fn(() => ({ pid: 99, host: '127.0.0.1', port: 3000, startedAt: 'x' })),
    });
    const r = await stopDaemon(d);
    expect(d.kill).toHaveBeenCalledWith(99);
    expect(d.clearInfo).toHaveBeenCalled();
    expect(r).toBe(true);
  });

  it('returns false when nothing is running', async () => {
    expect(await stopDaemon(deps({}))).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run cli/daemon.test.ts`
Expected: FAIL — `Cannot find module './daemon'`.

- [ ] **Step 3: Implement the module**

```ts
// cli/daemon.ts
import { spawn as nodeSpawn } from 'node:child_process';
import path from 'node:path';
import { readDaemonFile, clearDaemonFile, type DaemonInfo } from '@/server/lib/daemon-file';
import { dataDir, resolveEndpoint } from './config';

export interface SpawnedChild {
  pid?: number;
  unref: () => void;
}

export interface DaemonDeps {
  spawn: (entry: string, env: Record<string, string>) => SpawnedChild;
  health: (baseUrl: string) => Promise<boolean>;
  readInfo: () => DaemonInfo | null;
  clearInfo: () => void;
  kill: (pid: number) => void;
  sleep: (ms: number) => Promise<void>;
  baseUrl: string;
  serverEntry: string;
  port: number;
}

export async function defaultHealth(baseUrl: string): Promise<boolean> {
  try {
    const res = await fetch(`${baseUrl}/api/health`);
    return res.ok;
  } catch {
    return false;
  }
}

export function defaultDeps(opts: { port?: number }): DaemonDeps {
  const ep = resolveEndpoint(opts);
  const dir = dataDir();
  return {
    spawn: (entry, env) => {
      const child = nodeSpawn('node', [entry], {
        detached: true,
        stdio: 'ignore',
        env: { ...process.env, ...env },
      });
      return child;
    },
    health: defaultHealth,
    readInfo: () => readDaemonFile(dir),
    clearInfo: () => clearDaemonFile(dir),
    kill: (pid) => process.kill(pid, 'SIGTERM'),
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
    baseUrl: ep.baseUrl,
    serverEntry: path.resolve(process.cwd(), 'dist', 'server.cjs'),
    port: ep.port,
  };
}

export interface StartResult {
  already: boolean;
  pid: number;
  port: number;
}

export async function startDaemon(
  d: DaemonDeps,
  opts: { attempts?: number; intervalMs?: number } = {},
): Promise<StartResult> {
  const info = d.readInfo();
  if (info && (await d.health(d.baseUrl))) {
    return { already: true, pid: info.pid, port: d.port };
  }

  const child = d.spawn(d.serverEntry, { AETHER_DAEMON: '1', PORT: String(d.port) });
  child.unref();

  const attempts = opts.attempts ?? 20;
  const intervalMs = opts.intervalMs ?? 500;
  for (let i = 0; i < attempts; i++) {
    if (await d.health(d.baseUrl)) {
      return { already: false, pid: child.pid ?? -1, port: d.port };
    }
    await d.sleep(intervalMs);
  }
  throw new Error(`daemon did not become healthy at ${d.baseUrl}`);
}

export interface StatusResult {
  running: boolean;
  pid?: number;
  port?: number;
}

export async function statusDaemon(d: DaemonDeps): Promise<StatusResult> {
  const info = d.readInfo();
  if (!info) return { running: false };
  const running = await d.health(d.baseUrl);
  return running ? { running: true, pid: info.pid, port: info.port } : { running: false };
}

export async function stopDaemon(d: DaemonDeps): Promise<boolean> {
  const info = d.readInfo();
  if (!info) return false;
  try {
    d.kill(info.pid);
  } catch {
    // process already gone
  }
  d.clearInfo();
  return true;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run cli/daemon.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add cli/daemon.ts cli/daemon.test.ts
git commit -m "feat(slice-24): daemon lifecycle (start/stop/status) with injectable deps"
```

---

## Task 9: `cli/args.ts` — argument parser

**Files:**
- Create: `cli/args.ts`
- Test: `cli/args.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// cli/args.test.ts
import { describe, it, expect } from 'vitest';
import { parseArgs } from './args';

describe('parseArgs', () => {
  it('parses a bare prompt as the run command', () => {
    const r = parseArgs(['explain this error']);
    expect(r).toMatchObject({ command: 'run', prompt: 'explain this error' });
  });

  it('parses daemon subcommands', () => {
    expect(parseArgs(['daemon', 'start'])).toMatchObject({
      command: 'daemon',
      daemonAction: 'start',
    });
  });

  it('collects global flags', () => {
    const r = parseArgs(['--json', '--provider', 'anthropic:claude-opus-4-7', '--session', 's1', 'hi']);
    expect(r.command).toBe('run');
    expect(r.prompt).toBe('hi');
    expect(r.flags).toMatchObject({
      json: true,
      provider: 'anthropic:claude-opus-4-7',
      session: 's1',
    });
  });

  it('parses --port as a number', () => {
    expect(parseArgs(['--port', '4100', 'hi']).flags.port).toBe(4100);
  });

  it('treats no args as the help command', () => {
    expect(parseArgs([]).command).toBe('help');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run cli/args.test.ts`
Expected: FAIL — `Cannot find module './args'`.

- [ ] **Step 3: Implement the parser**

```ts
// cli/args.ts
export interface CliFlags {
  json: boolean;
  provider?: string;
  session?: string;
  port?: number;
}

export interface ParsedArgs {
  command: 'daemon' | 'run' | 'help';
  daemonAction?: string;
  prompt?: string;
  flags: CliFlags;
}

const VALUE_FLAGS = new Set(['--provider', '--session', '--port']);

export function parseArgs(argv: string[]): ParsedArgs {
  const flags: CliFlags = { json: false };
  const positionals: string[] = [];

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--json') {
      flags.json = true;
    } else if (VALUE_FLAGS.has(arg)) {
      const value = argv[++i];
      if (arg === '--provider') flags.provider = value;
      else if (arg === '--session') flags.session = value;
      else if (arg === '--port') flags.port = parseInt(value, 10);
    } else {
      positionals.push(arg);
    }
  }

  if (positionals.length === 0) return { command: 'help', flags };
  if (positionals[0] === 'daemon') {
    return { command: 'daemon', daemonAction: positionals[1] ?? 'status', flags };
  }
  return { command: 'run', prompt: positionals.join(' '), flags };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run cli/args.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add cli/args.ts cli/args.test.ts
git commit -m "feat(slice-24): CLI argument parser"
```

---

## Task 10: `cli/index.ts` — entrypoint glue

**Files:**
- Create: `cli/index.ts`

Thin orchestration only (no new logic worth unit-testing beyond the modules above); verified by lint + manual run.

- [ ] **Step 1: Implement the entrypoint**

```ts
// cli/index.ts
import { parseArgs } from './args';
import { resolveEndpoint } from './config';
import { createSession, dispatch, rejectDecision } from './client';
import { handleEvent } from './output';
import { startDaemon, stopDaemon, statusDaemon, defaultDeps } from './daemon';

const writer = {
  out: (s: string) => process.stdout.write(s),
  err: (s: string) => process.stderr.write(s),
};

async function readStdin(): Promise<string> {
  if (process.stdin.isTTY) return '';
  const chunks: Buffer[] = [];
  for await (const c of process.stdin) chunks.push(c as Buffer);
  return Buffer.concat(chunks).toString('utf8').trim();
}

function helpText(): string {
  return [
    'aether — headless CLI for the Aether daemon',
    '',
    'Usage:',
    '  aether daemon start|stop|status|restart',
    '  aether [--provider P] [--session ID] [--port N] [--json] "<prompt>"',
    '  cat file | aether "<prompt>"',
    '',
  ].join('\n');
}

async function runPrompt(prompt: string, flags: ReturnType<typeof parseArgs>['flags']): Promise<number> {
  const ep = resolveEndpoint({ port: flags.port });
  const deps = defaultDeps({ port: flags.port });
  if (!(await deps.health(ep.baseUrl))) {
    writer.err(`aether: daemon not reachable at ${ep.baseUrl}. Run \`aether daemon start\`.\n`);
    return 3;
  }

  const piped = await readStdin();
  const message = piped ? `${prompt}\n\n\`\`\`\n${piped}\n\`\`\`` : prompt;

  const sessionId = flags.session ?? (await createSession(ep.baseUrl));
  if (!flags.session) writer.err(`aether: session ${sessionId}\n`);

  let exitCode = 0;
  let finished = false;
  await dispatch({
    baseUrl: ep.baseUrl,
    sessionId,
    message,
    providerName: flags.provider,
    onEvent: (ev) => {
      if (ev.event === 'tool_call_request') {
        const callId = (ev.data as { callId?: string })?.callId;
        if (callId) void rejectDecision(ep.baseUrl, callId);
      }
      const r = handleEvent(ev, { json: flags.json }, writer);
      if (r.done) {
        finished = true;
        if (r.error) exitCode = 1;
      }
    },
  });
  if (!finished) exitCode = 1;
  return exitCode;
}

async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2));

  if (args.command === 'help') {
    writer.out(helpText());
    return 0;
  }

  if (args.command === 'daemon') {
    const deps = defaultDeps({ port: args.flags.port });
    switch (args.daemonAction) {
      case 'start': {
        const r = await startDaemon(deps);
        writer.out(r.already ? `already running on port ${r.port}\n` : `started (pid ${r.pid}) on port ${r.port}\n`);
        return 0;
      }
      case 'stop': {
        const stopped = await stopDaemon(deps);
        writer.out(stopped ? 'stopped\n' : 'not running\n');
        return 0;
      }
      case 'restart': {
        await stopDaemon(deps);
        await deps.sleep(500);
        const r = await startDaemon(deps);
        writer.out(`restarted on port ${r.port}\n`);
        return 0;
      }
      case 'status':
      default: {
        const s = await statusDaemon(deps);
        writer.out(s.running ? `running (pid ${s.pid}) on port ${s.port}\n` : 'stopped\n');
        return 0;
      }
    }
  }

  return runPrompt(args.prompt ?? '', args.flags);
}

main()
  .then((code) => process.exit(code))
  .catch((err: unknown) => {
    process.stderr.write(`aether: ${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(1);
  });
```

- [ ] **Step 2: Type-check**

Run: `npm run lint`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add cli/index.ts
git commit -m "feat(slice-24): CLI entrypoint (stdin + command router)"
```

---

## Task 11: Build wiring — `bin` + esbuild bundle

**Files:**
- Modify: `package.json` (`bin` field + `build` script)

- [ ] **Step 1: Add the `bin` field**

In `package.json`, add a top-level field (after `"type": "module"`):

```json
  "bin": {
    "aether": "dist/cli.cjs"
  },
```

- [ ] **Step 2: Add the CLI bundle to the `build` script**

Append to the existing `build` script (after the `aether-shell.ts` esbuild call), with a leading ` && `:

```
esbuild cli/index.ts --bundle --platform=node --format=cjs --packages=external --sourcemap --outfile=dist/cli.cjs --banner:js="#!/usr/bin/env node"
```

The full `build` value becomes:

```
vite build && esbuild server/index.ts --bundle --platform=node --format=cjs --packages=external --sourcemap --outfile=dist/server.cjs && esbuild server/mcp/builtin/aether-shell.ts --bundle --platform=node --format=esm --outfile=dist/server/mcp/builtin/aether-shell.js && esbuild cli/index.ts --bundle --platform=node --format=cjs --packages=external --sourcemap --outfile=dist/cli.cjs --banner:js="#!/usr/bin/env node"
```

- [ ] **Step 3: Build and verify both bundles exist**

Run: `npm run build`
Expected: completes; `dist/server.cjs` and `dist/cli.cjs` both exist, and `dist/cli.cjs` starts with the `#!/usr/bin/env node` shebang.

- [ ] **Step 4: End-to-end smoke (manual, documented)**

```bash
npm run build
node dist/cli.cjs daemon start          # spawns daemon, prints pid+port
node dist/cli.cjs daemon status         # running ...
AETHER_FAKE_PROVIDER=1 echo "log line" | node dist/cli.cjs "explain this"
node dist/cli.cjs daemon stop           # stopped
```
Expected: the prompt streams a fake-provider reply on stdout; session id on stderr. (For the fake provider the daemon must have been started with `AETHER_FAKE_PROVIDER=1` in its env.)

- [ ] **Step 5: Commit**

```bash
git add package.json
git commit -m "build(slice-24): bundle cli/index.ts to dist/cli.cjs + aether bin"
```

---

## Task 12: Docs — README + roadmap

**Files:**
- Modify: `README.md` (add a CLI section)
- Modify: `docs/superpowers/roadmap.md` (mark slice 24 shipped)

- [ ] **Step 1: Add a CLI section to `README.md`**

Add under the existing usage/commands area:

```markdown
## CLI (`aether`)

After `npm run build` (and `npm link` for a global `aether`):

```bash
aether daemon start            # start the background server (binds 127.0.0.1)
aether daemon status           # running/stopped + pid + port
aether daemon stop
aether "explain this stack trace"        # one-shot; creates a new session
aether --session <id> "follow-up"        # continue an existing session
cat error.log | aether "what went wrong?"   # stdin is appended to the prompt
aether --json "..."            # machine-readable JSONL events on stdout
```

Sessions created by the CLI appear in the web UI (shared SQLite). Gated MCP tool
calls are auto-rejected in CLI runs (interactive approval is web-UI only).
```

- [ ] **Step 2: Mark the slice shipped in the roadmap**

In `docs/superpowers/roadmap.md`, move the Slice 24 entry to the "Shipped" table:

```markdown
| 24 | Headless Daemon + aether-cli | `feat/slice-24-headless-cli` | ✅ |
```

and remove the now-implemented "Slice 24 — Headless Daemon + `aether-cli`" stub from the Planned section.

- [ ] **Step 3: Commit**

```bash
git add README.md docs/superpowers/roadmap.md
git commit -m "docs(slice-24): document the aether CLI + mark slice shipped"
```

---

## Final verification

- [ ] Run the full suite once: `npm run test:run` — all pass.
- [ ] Type-check: `npm run lint` — clean.
- [ ] Coverage on new code: `npm run test:coverage` — `cli/**` and `server/lib/**` meet the 80% thresholds.
- [ ] Build: `npm run build` — both `dist/server.cjs` and `dist/cli.cjs` produced.

## Self-review notes (author)

- **Spec coverage:** daemon lifecycle (T3,T8,T10), discovery/bind + daemon.json (T2,T3,T4), one-shot session + `--session` (T7,T10), clean stdout / stderr / `--json` (T6,T10), stdin piping (T10), packaging bin+esbuild (T11), gate auto-reject (T7,T10), testing + coverage (T1 + per-task), docs (T12). All spec sections map to a task.
- **Deviation from spec:** event names are `tool_call_*` (not `function_call`) — confirmed against `dispatch.service.ts`. Gate auto-reject is client-side via `POST /api/mcp/decision` (no server dispatch change), which is simpler than the spec's "server auto-reject" wording. `--verbose` deferred (YAGNI).
- **Type consistency:** `DaemonInfo` defined once in `server/lib/daemon-file.ts` and reused; `SseEvent` defined in `sse-consumer.ts` and consumed by `output.ts`/`client.ts`; `CliFlags`/`ParsedArgs` from `args.ts` used in `index.ts`; `DaemonDeps` shape matches between `daemon.ts` and its test.
```
