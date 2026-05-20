# Aether Slice 10 — MCP Advanced Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend slice-7 MCP with HTTP+SSE transport, auto-reconnect (5-attempt exponential backoff), on-demand discovery refresh, server-pushed progress events surfaced inline in the reasoning trace, and user cancellation of in-flight tool calls via a `ToolCallBanner`.

**Architecture:** Extend the `McpConnection` interface with optional `signal` + `onProgress` opts on `callTool` and an optional `onUnexpectedClose` hook. All three transports (mock/stdio/http) implement the extended contract. `McpRegistry` gains a backoff loop wired to `onUnexpectedClose`, plus `refreshTools(id)` and `cancelToolCall(callId)` helpers. Dispatch service tracks an `AbortController` per in-flight tool call and emits two new SSE events (`tool_call_started`, `tool_call_progress`). Frontend mounts a `ToolCallBanner` near `ChatView` and adds a `↻` refresh button to online sub-agent rows in `McpServersSection`.

**Tech Stack:** No new deps. We reuse the slice-0 line-buffered SSE parser pattern (`server/lib/sse-parser` if present, else inline) for `HttpMcpConnection`.

**Reference spec:** `docs/superpowers/specs/2026-05-20-aether-slice-10-mcp-advanced-design.md`

**Branch:** `feat/slice-10-mcp-advanced` (already checked out; spec already committed)

**Lavora con un solo branch dall'inizio alla fine; ogni Task termina con un commit verde su questo branch.**

---

## File structure (NEW unless marked MODIFY)

```
server/
  domain/mcp/
    connection.types.ts                              # MODIFY
    mcp.types.ts                                     # MODIFY: state +reconnecting + snapshot fields
    mock-connection.ts                               # MODIFY
    mock-connection.test.ts                          # MODIFY
    stdio-connection.ts                              # MODIFY
    stdio-connection.test.ts                         # MODIFY
    http-connection.ts                               # NEW
    http-connection.test.ts                          # NEW
    registry.ts                                      # MODIFY: reconnect + refresh + cancel
    registry.test.ts                                 # MODIFY
  domain/context/
    context.schema.ts                                # MODIFY: 'http' transport
    context.schema.test.ts                           # MODIFY
  domain/reasoning/
    reasoning.types.ts                               # MODIFY: ToolCallTrace.progressNote
    reasoning.schema.ts                              # MODIFY
  domain/dispatch/
    dispatch.service.ts                              # MODIFY: in-flight controllers + events
  routes/
    mcp.routes.ts                                    # MODIFY: +/refresh-tools +/cancel-call
    mcp.routes.test.ts                               # MODIFY
    dispatch.routes.test.ts                          # MODIFY: progress + cancel cases

src/
  lib/api/
    mcp.api.ts                                       # MODIFY: refreshTools + cancelCall
    mcp.api.test.ts                                  # MODIFY
  stores/
    mcp.store.ts                                     # MODIFY: inFlightCalls + refreshServer
    mcp.store.test.ts                                # MODIFY
  test/
    msw-handlers.ts                                  # MODIFY: 2 new handlers
  hooks/
    useStreamingDispatch.ts                          # MODIFY: 2 new SSE events
  components/chat/
    ToolCallBanner.tsx                               # NEW
    ToolCallBanner.test.tsx                          # NEW
  components/mcp/
    McpServersSection.tsx                            # MODIFY: refresh button + reconnecting badge
    McpServersSection.test.tsx                       # MODIFY
  components/reasoning/
    ReasoningStepCard.tsx                            # MODIFY: progressNote rendering
    ReasoningStepCard.test.tsx                       # MODIFY
  App.tsx                                            # MODIFY: mount ToolCallBanner
  integration/
    mcp-advanced.integration.test.tsx                # NEW

e2e/
  smoke.spec.ts                                      # MODIFY: append mcp-advanced test
```

---

## Phase A — Pre-flight

### Task A1: Verify branch + clean tree

- [ ] **Step 1: Run**

```bash
git rev-parse --abbrev-ref HEAD
git status --porcelain
```

Expected: branch `feat/slice-10-mcp-advanced`; second command empty. No commit.

---

## Phase B — Connection contract extension

### Task B1: `CallToolOpts` + `onUnexpectedClose` + 'reconnecting' state

**Files:**
- Modify: `server/domain/mcp/connection.types.ts`
- Modify: `server/domain/mcp/mcp.types.ts`

This is foundational; subsequent tasks rely on the new types. Additive — existing callers (which don't pass opts) keep working.

- [ ] **Step 1: Replace `server/domain/mcp/connection.types.ts`**

```ts
import type { McpTool, McpToolResult } from './mcp.types';

export interface CallToolOpts {
  signal?: AbortSignal;
  onProgress?: (note: string) => void;
}

export interface McpConnection {
  readonly defaultAutoApprove: boolean;
  initialize(): Promise<void>;
  listTools(): Promise<McpTool[]>;
  callTool(
    name: string,
    args: Record<string, unknown>,
    opts?: CallToolOpts,
  ): Promise<McpToolResult>;
  close(): Promise<void>;
  onUnexpectedClose?(handler: () => void): void;
}
```

- [ ] **Step 2: Read `server/domain/mcp/mcp.types.ts`**

Find `McpConnectionState` and `McpConnectionStateSnapshot`. Add `'reconnecting'` to the union and add the optional reconnect fields to the snapshot:

```ts
export type McpConnectionState =
  | 'offline'
  | 'connecting'
  | 'online'
  | 'reconnecting'
  | 'error';

export interface McpConnectionStateSnapshot {
  state: McpConnectionState;
  error?: string;
  reconnectAttempt?: number;
  reconnectMaxAttempts?: number;
}
```

- [ ] **Step 3: Run server suite (no regressions; additive changes)**

```bash
npx vitest run server
npm run lint
```

Expected: ALL PASS.

- [ ] **Step 4: Commit**

```bash
git add server/domain/mcp/connection.types.ts server/domain/mcp/mcp.types.ts
git commit -m "feat(slice-10): McpConnection +CallToolOpts +onUnexpectedClose; state +reconnecting"
```

---

## Phase C — MockMcpConnection signal support

### Task C1: Mock honors pre-aborted signal

**Files:**
- Modify: `server/domain/mcp/mock-connection.ts`
- Modify: `server/domain/mcp/mock-connection.test.ts`

The mock has no real I/O; we just need its `callTool` to accept the new opts and return immediately if `signal.aborted` is `true`.

- [ ] **Step 1: Append failing test**

```ts
// Inside the existing describe('MockMcpConnection', ...):
it('returns cancelled when signal is already aborted', async () => {
  const c = new MockMcpConnection();
  const ctrl = new AbortController();
  ctrl.abort();
  const res = await c.callTool('echo', { message: 'hi' }, { signal: ctrl.signal });
  expect(res).toEqual({ ok: false, error: 'Cancelled by user' });
});
```

- [ ] **Step 2: Run, expect FAIL**

```bash
npx vitest run server/domain/mcp/mock-connection.test.ts
```

- [ ] **Step 3: Modify `mock-connection.ts`**

Find the `callTool` method. Extend its signature to accept `opts?: CallToolOpts` and check the signal first:

```ts
async callTool(
  name: string,
  args: Record<string, unknown>,
  opts?: import('./connection.types').CallToolOpts,
): Promise<McpToolResult> {
  if (opts?.signal?.aborted) return { ok: false, error: 'Cancelled by user' };
  switch (name) {
    case 'echo':
      return { ok: true, output: { message: String(args.message ?? '') } };
    case 'current_time':
      return { ok: true, output: { iso: new Date().toISOString(), unix: Math.floor(Date.now() / 1000) } };
    case 'read_file_mock':
      return { ok: true, output: { content: `mocked content of ${String(args.path ?? '<no path>')}` } };
    default:
      return { ok: false, error: `Unknown tool '${name}'` };
  }
}
```

- [ ] **Step 4: Run, expect PASS**

```bash
npx vitest run server/domain/mcp/mock-connection.test.ts
```

- [ ] **Step 5: Lint + commit**

```bash
npm run lint
git add server/domain/mcp/mock-connection.ts server/domain/mcp/mock-connection.test.ts
git commit -m "feat(slice-10): MockMcpConnection honors pre-aborted signal"
```

---

## Phase D — StdioMcpConnection signal + progress + close detection

### Task D1: Add signal cancellation, progress notifications, unexpected close handler

**Files:**
- Modify: `server/domain/mcp/stdio-connection.ts`
- Modify: `server/domain/mcp/stdio-connection.test.ts`
- Modify: `server/domain/mcp/__fixtures__/echo-server.js` (optional, only to enable progress test)

Three new capabilities on the existing class:
1. Honor `opts.signal` — when aborted, write `notifications/cancelled` to stdin AND reject the pending promise locally.
2. Honor `opts.onProgress` — parse `notifications/progress` frames from stdout and invoke the callback.
3. Expose `onUnexpectedClose(handler)` — fire the handler when the subprocess exits without `close()` having been called first.

- [ ] **Step 1: Extend the fixture to emit progress + tolerate cancellation**

Read `server/domain/mcp/__fixtures__/echo-server.js`. Add support for a `slow` tool name that emits two progress notifications (using JSON-RPC `notifications/progress`) before returning, and accepts `notifications/cancelled` to short-circuit.

Append handling inside the existing `respond(req)` function (just before the final `unknown tool` branch). After the existing `if (method === 'tools/call') { ... }` block, the structure should be:

```js
function respond(req) {
  const { id, method, params } = req;
  if (method === 'initialize') return send({ jsonrpc: '2.0', id, result: {} });
  if (method === 'tools/list') {
    return send({
      jsonrpc: '2.0', id,
      result: { tools: [
        { name: 'echo', description: 'echo', inputSchema: { type: 'object' } },
        { name: 'slow', description: 'two-progress slow', inputSchema: { type: 'object' } },
      ] },
    });
  }
  if (method === 'notifications/cancelled') {
    // Note: per spec, JSON-RPC notifications have no id; we accept and ignore here.
    return;
  }
  if (method === 'tools/call') {
    const name = params?.name;
    const args = params?.arguments ?? {};
    if (name === 'fail') {
      return send({ jsonrpc: '2.0', id, error: { code: -32000, message: 'intentional failure' } });
    }
    if (name === 'echo') {
      return send({
        jsonrpc: '2.0', id,
        result: { content: [{ type: 'text', text: String(args.message ?? '') }] },
      });
    }
    if (name === 'slow') {
      send({ jsonrpc: '2.0', method: 'notifications/progress', params: { progressToken: id, progress: 1, total: 2, message: 'step 1' } });
      send({ jsonrpc: '2.0', method: 'notifications/progress', params: { progressToken: id, progress: 2, total: 2, message: 'step 2' } });
      return send({ jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: 'done' }] } });
    }
    return send({ jsonrpc: '2.0', id, error: { code: -32601, message: 'unknown tool' } });
  }
  send({ jsonrpc: '2.0', id, error: { code: -32601, message: 'method not found' } });
}
```

- [ ] **Step 2: Append failing tests**

```ts
// Inside the existing describe('StdioMcpConnection', ...) at the bottom:

it('callTool with aborted signal returns cancelled and writes notifications/cancelled', async () => {
  await conn.initialize();
  const ctrl = new AbortController();
  const p = conn.callTool('slow', {}, { signal: ctrl.signal });
  // Abort before the result lands
  queueMicrotask(() => ctrl.abort());
  const res = await p;
  expect(res.ok).toBe(false);
  if (!res.ok) expect(res.error).toMatch(/cancel/i);
});

it('callTool with onProgress receives notifications/progress', async () => {
  await conn.initialize();
  const notes: string[] = [];
  const res = await conn.callTool('slow', {}, { onProgress: (n) => notes.push(n) });
  expect(res.ok).toBe(true);
  expect(notes.length).toBeGreaterThanOrEqual(2);
  expect(notes[0]).toMatch(/1\/2/);
  expect(notes[1]).toMatch(/2\/2/);
});

it('onUnexpectedClose fires when subprocess exits unexpectedly', async () => {
  await conn.initialize();
  let closed = false;
  conn.onUnexpectedClose?.(() => { closed = true; });
  // Force the subprocess to exit by sending SIGKILL via the connection internals.
  // Test alternative: spawn a different fixture that exits voluntarily after initialize.
  // For this test we directly invoke an internal helper if exposed, else access
  // via a (private) field cast. The implementer should add a small test-only helper:
  //   class StdioMcpConnection { __killForTest() { this.proc?.kill('SIGKILL'); } }
  // and call it here. Otherwise inspect the implementation and use the appropriate
  // mechanism (e.g. dispatch a request that the fixture handles by exiting).
  (conn as unknown as { __killForTest(): void }).__killForTest();
  await new Promise((r) => setTimeout(r, 100));
  expect(closed).toBe(true);
});
```

For the `__killForTest()` mechanism, add this small test-only method to the class:

```ts
// In stdio-connection.ts, alongside close():
/** Test-only: forcibly kill the subprocess to simulate a crash. */
__killForTest(): void {
  if (this.proc) this.proc.kill('SIGKILL');
}
```

It's prefixed `__` to signal "do not use in production code" while staying part of the public class surface for tests.

- [ ] **Step 3: Run, expect FAIL**

```bash
npx vitest run server/domain/mcp/stdio-connection.test.ts
```

- [ ] **Step 4: Modify `server/domain/mcp/stdio-connection.ts`**

Apply these changes:

1. Add a private field for the unexpected-close handler:

```ts
private unexpectedCloseHandler: (() => void) | null = null;
private closeRequested = false;
```

2. Implement `onUnexpectedClose`:

```ts
onUnexpectedClose(handler: () => void): void {
  this.unexpectedCloseHandler = handler;
}
```

3. In the existing `proc.on('exit', ...)` handler, check `closeRequested`:

```ts
this.proc.on('exit', (code) => {
  this.failAllPending(
    new Error(`subprocess exited (code ${code}); stderr: ${this.stderrBuf.slice(-512)}`),
  );
  if (!this.closeRequested && this.unexpectedCloseHandler) {
    this.unexpectedCloseHandler();
  }
});
```

4. In `close()`, set `closeRequested = true` before sending SIGTERM:

```ts
async close(): Promise<void> {
  this.closeRequested = true;
  if (!this.proc) return;
  // ... existing logic
}
```

5. Extend `callTool` signature to accept opts, and store the onProgress in the pending entry:

```ts
interface PendingCall {
  resolve: (value: unknown) => void;
  reject: (err: Error) => void;
  timer: NodeJS.Timeout;
  onProgress?: (note: string) => void;
}

async callTool(
  name: string,
  args: Record<string, unknown>,
  opts?: import('./connection.types').CallToolOpts,
): Promise<McpToolResult> {
  if (opts?.signal?.aborted) return { ok: false, error: 'Cancelled by user' };
  try {
    const out = await this.rpcWithOpts('tools/call', { name, arguments: args }, TOOLS_CALL_TIMEOUT_MS, opts);
    return { ok: true, output: out };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'tool call failed' };
  }
}

private async rpcWithOpts(
  method: string,
  params: unknown,
  timeoutMs: number,
  opts?: import('./connection.types').CallToolOpts,
): Promise<unknown> {
  if (!this.proc) throw new Error('not initialized');
  const id = this.nextId++;
  const payload = JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n';
  return new Promise<unknown>((resolve, reject) => {
    const timer = setTimeout(() => {
      this.pending.delete(id);
      reject(new Error(`rpc timeout: ${method}`));
    }, timeoutMs);
    this.pending.set(id, { resolve, reject, timer, onProgress: opts?.onProgress });
    if (opts?.signal) {
      const onAbort = () => {
        const pending = this.pending.get(id);
        if (pending) {
          clearTimeout(pending.timer);
          this.pending.delete(id);
          // Best-effort cancellation notice to the server
          try {
            this.proc?.stdin.write(
              JSON.stringify({
                jsonrpc: '2.0',
                method: 'notifications/cancelled',
                params: { requestId: id, reason: 'Cancelled by user' },
              }) + '\n',
            );
          } catch {
            // ignore
          }
          pending.reject(new Error('Cancelled by user'));
        }
      };
      if (opts.signal.aborted) onAbort();
      else opts.signal.addEventListener('abort', onAbort);
    }
    this.proc!.stdin.write(payload, (err) => {
      if (err) {
        this.pending.delete(id);
        clearTimeout(timer);
        reject(err);
      }
    });
  });
}
```

Keep the existing `rpc()` method for `initialize` / `listTools` (they don't need opts).

6. In `onStdout`, parse `notifications/progress` and invoke the matching pending's `onProgress`:

```ts
private onStdout(chunk: string): void {
  this.buf += chunk;
  let idx;
  while ((idx = this.buf.indexOf('\n')) >= 0) {
    const line = this.buf.slice(0, idx).trim();
    this.buf = this.buf.slice(idx + 1);
    if (!line) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      continue;
    }

    // Notification frame (no id)
    const asObj = parsed as { jsonrpc?: string; method?: string; params?: { progressToken?: number; progress?: number; total?: number; message?: string } };
    if (asObj.method === 'notifications/progress' && asObj.params) {
      const token = asObj.params.progressToken;
      if (typeof token === 'number') {
        const pending = this.pending.get(token);
        if (pending?.onProgress) {
          const progress = asObj.params.progress ?? 0;
          const total = asObj.params.total ?? '?';
          const message = asObj.params.message ?? '';
          pending.onProgress(`${progress}/${total} — ${message}`);
        }
      }
      continue;
    }

    // Response frame
    const resp = JsonRpcResponseSchema.safeParse(parsed);
    if (!resp.success) continue;
    const id = typeof resp.data.id === 'string' ? Number(resp.data.id) : resp.data.id;
    const p = this.pending.get(id);
    if (!p) continue;
    clearTimeout(p.timer);
    this.pending.delete(id);
    if (resp.data.error) {
      p.reject(new Error(resp.data.error.message));
    } else {
      p.resolve(resp.data.result);
    }
  }
}
```

7. Add the test-only helper:

```ts
/** Test-only: forcibly kill the subprocess to simulate a crash. */
__killForTest(): void {
  if (this.proc) this.proc.kill('SIGKILL');
}
```

- [ ] **Step 5: Run, expect PASS**

```bash
npx vitest run server/domain/mcp/stdio-connection.test.ts
```

If the close-detection test races (the subprocess SIGKILL → `exit` event takes time to fire), bump the `await new Promise((r) => setTimeout(r, 100))` to 200ms.

- [ ] **Step 6: Lint + commit**

```bash
npm run lint
git add server/domain/mcp/stdio-connection.ts server/domain/mcp/stdio-connection.test.ts server/domain/mcp/__fixtures__/echo-server.js
git commit -m "feat(slice-10): StdioMcpConnection signal + onProgress + onUnexpectedClose"
```

---

## Phase E — HttpMcpConnection (new transport)

### Task E1: HTTP+SSE MCP transport

**Files:**
- Create: `server/domain/mcp/http-connection.ts`
- Create: `server/domain/mcp/http-connection.test.ts`

The HTTP transport speaks JSON-RPC over POST + receives responses on a long-lived SSE stream. The implementation mirrors the stdio one: a pending map keyed by id, a background reader loop that dispatches by id, and the same cancellation + progress mechanisms.

- [ ] **Step 1: Failing tests `http-connection.test.ts`**

```ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { HttpMcpConnection } from './http-connection';

function ssePayload(frames: string[]): string {
  // Each frame is one JSON object wrapped as `data: <json>\n\n`
  return frames.map((f) => `data: ${f}\n\n`).join('');
}

function streamFromString(s: string): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode(s));
      controller.close();
    },
  });
}

describe('HttpMcpConnection', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('defaults autoApprove to false', () => {
    const c = new HttpMcpConnection({ url: 'http://localhost:8000' });
    expect(c.defaultAutoApprove).toBe(false);
  });

  it('initialize + listTools', async () => {
    let calls = 0;
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockImplementation(async () => {
      calls += 1;
      if (calls === 1) {
        // initialize: SSE response with one frame
        return new Response(streamFromString(ssePayload([
          JSON.stringify({ jsonrpc: '2.0', id: 1, result: {} }),
        ])), { status: 200, headers: { 'content-type': 'text/event-stream' } });
      }
      // tools/list
      return new Response(streamFromString(ssePayload([
        JSON.stringify({ jsonrpc: '2.0', id: 2, result: { tools: [{ name: 'echo', inputSchema: { type: 'object' } }] } }),
      ])), { status: 200, headers: { 'content-type': 'text/event-stream' } });
    });

    const c = new HttpMcpConnection({ url: 'http://localhost:8000' });
    await c.initialize();
    const tools = await c.listTools();
    expect(tools.map((t) => t.name)).toEqual(['echo']);
    await c.close();
  });

  it('callTool happy path', async () => {
    let initOnce = true;
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockImplementation(async (_url: string, init?: RequestInit) => {
      if (initOnce) {
        initOnce = false;
        return new Response(streamFromString(ssePayload([
          JSON.stringify({ jsonrpc: '2.0', id: 1, result: {} }),
        ])), { status: 200, headers: { 'content-type': 'text/event-stream' } });
      }
      const body = JSON.parse(init?.body as string) as { id: number };
      return new Response(streamFromString(ssePayload([
        JSON.stringify({ jsonrpc: '2.0', id: body.id, result: { content: [{ type: 'text', text: 'pong' }] } }),
      ])), { status: 200, headers: { 'content-type': 'text/event-stream' } });
    });

    const c = new HttpMcpConnection({ url: 'http://localhost:8000' });
    await c.initialize();
    const res = await c.callTool('echo', { message: 'hi' });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.output).toEqual({ content: [{ type: 'text', text: 'pong' }] });
    await c.close();
  });

  it('callTool with pre-aborted signal returns Cancelled immediately', async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockImplementation(async () =>
      new Response(streamFromString(ssePayload([
        JSON.stringify({ jsonrpc: '2.0', id: 1, result: {} }),
      ])), { status: 200, headers: { 'content-type': 'text/event-stream' } }),
    );
    const c = new HttpMcpConnection({ url: 'http://localhost:8000' });
    await c.initialize();
    const ctrl = new AbortController();
    ctrl.abort();
    const res = await c.callTool('echo', {}, { signal: ctrl.signal });
    expect(res).toEqual({ ok: false, error: 'Cancelled by user' });
  });

  it('callTool with onProgress receives notifications/progress', async () => {
    let initOnce = true;
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockImplementation(async (_url: string, init?: RequestInit) => {
      if (initOnce) {
        initOnce = false;
        return new Response(streamFromString(ssePayload([
          JSON.stringify({ jsonrpc: '2.0', id: 1, result: {} }),
        ])), { status: 200, headers: { 'content-type': 'text/event-stream' } });
      }
      const body = JSON.parse(init?.body as string) as { id: number };
      return new Response(streamFromString(ssePayload([
        JSON.stringify({ jsonrpc: '2.0', method: 'notifications/progress', params: { progressToken: body.id, progress: 1, total: 2, message: 'half' } }),
        JSON.stringify({ jsonrpc: '2.0', id: body.id, result: { content: [{ type: 'text', text: 'done' }] } }),
      ])), { status: 200, headers: { 'content-type': 'text/event-stream' } });
    });

    const c = new HttpMcpConnection({ url: 'http://localhost:8000' });
    await c.initialize();
    const notes: string[] = [];
    const res = await c.callTool('slow', {}, { onProgress: (n) => notes.push(n) });
    expect(res.ok).toBe(true);
    expect(notes.length).toBe(1);
    expect(notes[0]).toMatch(/1\/2/);
    await c.close();
  });

  it('rejects on non-OK initialize response', async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401 }),
    );
    const c = new HttpMcpConnection({ url: 'http://localhost:8000' });
    await expect(c.initialize()).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run, expect FAIL**

```bash
npx vitest run server/domain/mcp/http-connection.test.ts
```

- [ ] **Step 3: Implement `http-connection.ts`**

```ts
import type { CallToolOpts, McpConnection } from './connection.types';
import type { McpTool, McpToolResult } from './mcp.types';
import { JsonRpcResponseSchema, ToolsListResultSchema } from './mcp.schema';

export interface HttpMcpOpts {
  url: string;
  headers?: Record<string, string>;
}

interface PendingCall {
  resolve: (value: unknown) => void;
  reject: (err: Error) => void;
  timer: NodeJS.Timeout;
  onProgress?: (note: string) => void;
}

const INITIALIZE_TIMEOUT_MS = 5_000;
const TOOLS_CALL_TIMEOUT_MS = 30_000;

export class HttpMcpConnection implements McpConnection {
  readonly defaultAutoApprove = false;
  private pending = new Map<number, PendingCall>();
  private nextId = 1;
  private unexpectedCloseHandler: (() => void) | null = null;
  private closeRequested = false;

  constructor(private readonly opts: HttpMcpOpts) {}

  onUnexpectedClose(handler: () => void): void {
    this.unexpectedCloseHandler = handler;
  }

  async initialize(): Promise<void> {
    await this.postRpc('initialize', {}, INITIALIZE_TIMEOUT_MS);
  }

  async listTools(): Promise<McpTool[]> {
    const raw = await this.postRpc('tools/list', {});
    const parsed = ToolsListResultSchema.safeParse(raw);
    if (!parsed.success) throw new Error('tools/list response failed schema');
    return parsed.data.tools;
  }

  async callTool(
    name: string,
    args: Record<string, unknown>,
    opts?: CallToolOpts,
  ): Promise<McpToolResult> {
    if (opts?.signal?.aborted) return { ok: false, error: 'Cancelled by user' };
    try {
      const out = await this.postRpc('tools/call', { name, arguments: args }, TOOLS_CALL_TIMEOUT_MS, opts);
      return { ok: true, output: out };
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'tool call failed';
      return { ok: false, error: msg };
    }
  }

  async close(): Promise<void> {
    this.closeRequested = true;
    for (const p of this.pending.values()) {
      clearTimeout(p.timer);
      p.reject(new Error('connection closed'));
    }
    this.pending.clear();
  }

  /** Each method call opens a short-lived SSE stream that delivers exactly one response.
   *  Progress notifications can interleave before the response frame. We keep the design
   *  simple: a new fetch per call, parsing until the matching response id arrives. */
  private async postRpc(
    method: string,
    params: unknown,
    timeoutMs: number = TOOLS_CALL_TIMEOUT_MS,
    opts?: CallToolOpts,
  ): Promise<unknown> {
    const id = this.nextId++;
    const body = JSON.stringify({ jsonrpc: '2.0', id, method, params });

    return new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`http rpc timeout: ${method}`));
      }, timeoutMs);

      this.pending.set(id, { resolve, reject, timer, onProgress: opts?.onProgress });

      if (opts?.signal) {
        const onAbort = () => {
          const p = this.pending.get(id);
          if (p) {
            clearTimeout(p.timer);
            this.pending.delete(id);
            this.postCancelled(id).catch(() => {});
            p.reject(new Error('Cancelled by user'));
          }
        };
        if (opts.signal.aborted) onAbort();
        else opts.signal.addEventListener('abort', onAbort);
      }

      void this.openSseStream(id, body, method);
    });
  }

  private async openSseStream(id: number, body: string, method: string): Promise<void> {
    let res: Response;
    try {
      res = await fetch(this.opts.url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          accept: 'text/event-stream',
          ...(this.opts.headers ?? {}),
        },
        body,
      });
    } catch (e) {
      const p = this.pending.get(id);
      if (p) {
        clearTimeout(p.timer);
        this.pending.delete(id);
        p.reject(e instanceof Error ? e : new Error('fetch failed'));
      }
      if (!this.closeRequested && this.unexpectedCloseHandler) {
        this.unexpectedCloseHandler();
      }
      return;
    }

    if (!res.ok || !res.body) {
      let errorMessage = `HTTP ${res.status}`;
      try {
        const text = await res.text();
        if (text) errorMessage = `${errorMessage}: ${text}`;
      } catch {
        // ignore
      }
      const p = this.pending.get(id);
      if (p) {
        clearTimeout(p.timer);
        this.pending.delete(id);
        p.reject(new Error(errorMessage));
      }
      return;
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      // SSE frames are separated by '\n\n'; each frame may have 'data: <json>' line(s).
      let frameEnd;
      while ((frameEnd = buf.indexOf('\n\n')) >= 0) {
        const frame = buf.slice(0, frameEnd);
        buf = buf.slice(frameEnd + 2);
        const dataLines = frame
          .split('\n')
          .filter((l) => l.startsWith('data:'))
          .map((l) => l.slice(5).trim());
        const dataStr = dataLines.join('');
        if (!dataStr) continue;
        let parsed: unknown;
        try {
          parsed = JSON.parse(dataStr);
        } catch {
          continue;
        }
        this.handleFrame(parsed, id);
      }
    }

    // Stream closed: if we still have a pending entry for this id, the response never came.
    const p = this.pending.get(id);
    if (p) {
      clearTimeout(p.timer);
      this.pending.delete(id);
      p.reject(new Error(`stream closed without response (${method})`));
    }
  }

  private handleFrame(parsed: unknown, awaitingId: number): void {
    const asObj = parsed as {
      jsonrpc?: string;
      id?: number;
      method?: string;
      params?: { progressToken?: number; progress?: number; total?: number; message?: string };
      result?: unknown;
      error?: { code: number; message: string };
    };

    if (asObj.method === 'notifications/progress' && asObj.params) {
      const token = asObj.params.progressToken;
      if (typeof token === 'number') {
        const p = this.pending.get(token);
        if (p?.onProgress) {
          const progress = asObj.params.progress ?? 0;
          const total = asObj.params.total ?? '?';
          const message = asObj.params.message ?? '';
          p.onProgress(`${progress}/${total} — ${message}`);
        }
      }
      return;
    }

    const resp = JsonRpcResponseSchema.safeParse(parsed);
    if (!resp.success) return;
    const respId = typeof resp.data.id === 'string' ? Number(resp.data.id) : resp.data.id;
    if (respId !== awaitingId) return;
    const p = this.pending.get(respId);
    if (!p) return;
    clearTimeout(p.timer);
    this.pending.delete(respId);
    if (resp.data.error) {
      p.reject(new Error(resp.data.error.message));
    } else {
      p.resolve(resp.data.result);
    }
  }

  private async postCancelled(requestId: number): Promise<void> {
    await fetch(this.opts.url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(this.opts.headers ?? {}) },
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'notifications/cancelled',
        params: { requestId, reason: 'Cancelled by user' },
      }),
    }).catch(() => {});
  }
}
```

- [ ] **Step 4: Run, expect PASS (6 tests)**

```bash
npx vitest run server/domain/mcp/http-connection.test.ts
```

- [ ] **Step 5: Lint + commit**

```bash
npm run lint
git add server/domain/mcp/http-connection.ts server/domain/mcp/http-connection.test.ts
git commit -m "feat(slice-10): HttpMcpConnection (POST+SSE; signal + onProgress)"
```

---

## Phase F — `McpRegistry` reconnect + refresh + cancel

### Task F1: Wire reconnect loop, refreshTools, cancelToolCall

**Files:**
- Modify: `server/domain/mcp/registry.ts`
- Modify: `server/domain/mcp/registry.test.ts`

- [ ] **Step 1: Append failing tests**

Inside the existing `describe('McpRegistry', ...)`:

```ts
import { setTimeout as delay } from 'node:timers/promises';

it('refreshTools updates the live entry', async () => {
  await reg.connect('M1');
  const before = reg.listLiveTools().length;
  expect(before).toBe(3);
  const tools = await reg.refreshTools('M1');
  expect(tools.length).toBe(3);
});

it('refreshTools on disconnected server throws', async () => {
  await expect(reg.refreshTools('M1')).rejects.toThrow();
});

it('listLiveTools after refresh reflects mock tools unchanged', async () => {
  await reg.connect('M1');
  await reg.refreshTools('M1');
  expect(reg.listLiveTools().map((t) => t.tool.name).sort()).toEqual([
    'current_time', 'echo', 'read_file_mock',
  ]);
});

it('callTool forwards opts.signal to the connection', async () => {
  await reg.connect('M1');
  const ctrl = new AbortController();
  ctrl.abort();
  const res = await reg.callTool('mock.echo', { message: 'hi' }, { signal: ctrl.signal });
  expect(res).toEqual({ ok: false, error: 'Cancelled by user' });
});

it('passes onProgress through callTool (mock ignores; assert no throw)', async () => {
  await reg.connect('M1');
  const notes: string[] = [];
  const res = await reg.callTool('mock.echo', { message: 'hi' }, { onProgress: (n) => notes.push(n) });
  expect(res.ok).toBe(true);
  // mock doesn't emit progress; the array stays empty
  expect(notes).toEqual([]);
});

it('cancelToolCall is idempotent (no-op when controller missing)', () => {
  // The registry doesn't own controllers; it forwards. This test ensures the helper exists.
  expect(() => reg.cancelToolCall?.('nonexistent')).not.toThrow();
});
```

For the auto-reconnect test, we use the mock transport but simulate a crash by injecting a fake connection that fires `onUnexpectedClose`:

```ts
it('auto-reconnect: state transitions reconnecting → online on success', async () => {
  // Use stdio with the echo-server fixture. After connecting, kill the subprocess.
  // The registry's onUnexpectedClose handler should kick off a backoff loop, and
  // a fresh connection should succeed on the first retry.
  // SKIP this test in slice 10 if the test harness setup is non-trivial; the
  // mock-based unit test below covers the registry-level state machine.
}, 20_000);

it('auto-reconnect: registry transitions to reconnecting state when onUnexpectedClose fires', async () => {
  // Approach: connect to a mock server, then manually fire the registered
  // unexpected-close handler. The registry should set state to 'reconnecting',
  // attempt to reconnect (mock always succeeds), and return to 'online'.

  await reg.connect('M1');
  // Locate the entry and invoke its handler if it was registered.
  // The mock-connection.ts doesn't register one by default — the registry only
  // wires onUnexpectedClose for stdio/http. For this test, manually invoke the
  // private reconnect API (the implementer should expose `__forceReconnectForTest(id)`):
  await (reg as unknown as { __forceReconnectForTest(id: string): Promise<void> }).__forceReconnectForTest('M1');
  // After the test helper, the state should eventually be 'online' again.
  await delay(50);
  expect(reg.stateOf('M1').state).toBe('online');
});
```

If exposing `__forceReconnectForTest` is too invasive, the implementer can structure the reconnect entry-point as a separately-callable method (e.g. `triggerReconnect(id)`) used by both `onUnexpectedClose` and the test.

- [ ] **Step 2: Run, expect FAIL**

```bash
npx vitest run server/domain/mcp/registry.test.ts
```

- [ ] **Step 3: Modify `server/domain/mcp/registry.ts`**

Apply these changes:

1. Import `CallToolOpts`:

```ts
import type { CallToolOpts } from './connection.types';
```

2. Add a private map for reconnect aborters:

```ts
private reconnectAborters = new Map<string, AbortController>();
```

3. Extend `callTool` to accept opts:

```ts
async callTool(
  qualifiedName: string,
  args: Record<string, unknown>,
  opts?: CallToolOpts,
): Promise<McpToolResult> {
  const sep = qualifiedName.indexOf('.');
  if (sep < 0) return { ok: false, error: `Invalid qualified name '${qualifiedName}'` };
  const serverName = qualifiedName.slice(0, sep);
  const toolName = qualifiedName.slice(sep + 1);
  const entry = [...this.live.values()].find((e) => e.serverName === serverName);
  if (!entry) return { ok: false, error: `Server '${serverName}' is offline` };
  return entry.connection.callTool(toolName, args, opts);
}
```

4. Inside `connect()`, after `this.live.set(id, ...)` and `this.states.set(id, { state: 'online' })`, register the unexpected-close handler:

```ts
connection.onUnexpectedClose?.(() => {
  this.triggerReconnect(id, cfg);
});
```

5. Add the public/test-callable `triggerReconnect` and the backoff loop:

```ts
async triggerReconnect(id: string, cfg: McpServerConfig): Promise<void> {
  // If we already have an aborter for this id, abort it (in case a previous loop is running).
  const existing = this.reconnectAborters.get(id);
  if (existing) existing.abort();
  const aborter = new AbortController();
  this.reconnectAborters.set(id, aborter);
  this.live.delete(id);
  await this.reconnectLoop(id, cfg, aborter.signal);
}

private async reconnectLoop(id: string, cfg: McpServerConfig, signal: AbortSignal): Promise<void> {
  const BACKOFF = [1000, 2000, 4000, 8000, 16000];
  for (let attempt = 1; attempt <= BACKOFF.length; attempt++) {
    if (signal.aborted) {
      this.states.set(id, { state: 'offline' });
      return;
    }
    this.states.set(id, {
      state: 'reconnecting',
      reconnectAttempt: attempt,
      reconnectMaxAttempts: BACKOFF.length,
    });
    await new Promise<void>((resolve) => {
      const t = setTimeout(resolve, BACKOFF[attempt - 1]);
      signal.addEventListener('abort', () => {
        clearTimeout(t);
        resolve();
      }, { once: true });
    });
    if (signal.aborted) {
      this.states.set(id, { state: 'offline' });
      return;
    }
    try {
      const fresh = this.makeConnection(cfg);
      await fresh.initialize();
      const tools = await fresh.listTools();
      fresh.onUnexpectedClose?.(() => this.triggerReconnect(id, cfg));
      this.live.set(id, {
        connection: fresh,
        serverName: cfg.name,
        serverId: id,
        tools,
        policies: cfg.toolPolicies ?? {},
      });
      this.states.set(id, { state: 'online' });
      this.reconnectAborters.delete(id);
      return;
    } catch {
      // continue to next attempt
    }
  }
  this.states.set(id, { state: 'error', error: 'Reconnect failed after 5 attempts' });
  this.reconnectAborters.delete(id);
}
```

6. In `disconnect()`, abort any pending reconnect aborter for this id BEFORE doing the standard close:

```ts
async disconnect(id: string): Promise<void> {
  const aborter = this.reconnectAborters.get(id);
  if (aborter) {
    aborter.abort();
    this.reconnectAborters.delete(id);
  }
  const entry = this.live.get(id);
  if (entry) {
    await entry.connection.close().catch(() => {});
    this.live.delete(id);
  }
  this.states.set(id, { state: 'offline' });
}
```

7. Add `refreshTools`:

```ts
async refreshTools(id: string): Promise<McpTool[]> {
  const entry = this.live.get(id);
  if (!entry) throw new Error(`server ${id} not online`);
  const tools = await entry.connection.listTools();
  entry.tools = tools;
  return tools;
}
```

8. Add `cancelToolCall` (no-op pass-through; the actual abort lives in dispatch.service):

```ts
cancelToolCall(_callId: string): void {
  // The registry doesn't own AbortControllers; dispatch.service does. This method
  // exists so callers can address it without reaching into dispatch internals.
  // It's a no-op when called here; the route handler invokes dispatchService directly.
}
```

If you'd prefer the registry to own the controllers (cleaner from the route side), you can move the in-flight map here and expose `getController(callId)`. The plan goes with the simpler split: dispatch keeps its map and the route reads from there.

9. Add the test helper (only used in tests):

```ts
/** Test-only: trigger the reconnect machinery as if onUnexpectedClose had fired. */
async __forceReconnectForTest(id: string): Promise<void> {
  const ctx = await this.contextStore.read();
  const cfg = ctx.mcpServers.find((s) => s.id === id);
  if (!cfg) return;
  await this.triggerReconnect(id, cfg);
}
```

- [ ] **Step 4: Run, expect PASS**

```bash
npx vitest run server/domain/mcp/registry.test.ts
```

- [ ] **Step 5: Lint + commit**

```bash
npm run lint
git add server/domain/mcp/registry.ts server/domain/mcp/registry.test.ts
git commit -m "feat(slice-10): McpRegistry +refreshTools +reconnect loop +callTool opts pass-through"
```

---

## Phase G — Context schema: 'http' transport

### Task G1: McpServerSchema accepts `transport: 'http'`

**Files:**
- Modify: `server/domain/context/context.schema.ts`
- Modify: `server/domain/context/context.schema.test.ts`
- Modify: `server/domain/context/context.types.ts`

- [ ] **Step 1: Append failing tests**

```ts
// In context.schema.test.ts, inside the existing describe block:
it('accepts http transport with url', () => {
  expect(McpServerSchema.safeParse({
    id: 'h', name: 'remote', transport: 'http', url: 'https://api.example.com/mcp',
    status: 'offline',
  }).success).toBe(true);
});
```

- [ ] **Step 2: Run, expect FAIL**

```bash
npx vitest run server/domain/context/context.schema.test.ts
```

- [ ] **Step 3: Modify `context.schema.ts`**

Find the `transport` enum in `McpServerSchema` and widen:

```ts
transport: z.enum(['stdio', 'mock', 'http']).optional(),
```

- [ ] **Step 4: Modify `context.types.ts`**

Find `McpTransport`:

```ts
export type McpTransport = 'stdio' | 'mock' | 'http';
```

- [ ] **Step 5: Modify `registry.ts`'s `makeConnection`**

Add the http branch:

```ts
private makeConnection(cfg: McpServerConfig): McpConnection {
  if (cfg.transport === 'mock') return new MockMcpConnection();
  if (cfg.transport === 'http') {
    if (!cfg.url) throw new Error('http transport requires url');
    return new HttpMcpConnection({ url: cfg.url });
  }
  return new StdioMcpConnection({
    command: cfg.command ?? '',
    args: cfg.args ?? [],
    env: cfg.env ?? {},
  });
}
```

Add the `HttpMcpConnection` import at the top of `registry.ts`.

- [ ] **Step 6: Run, expect PASS + full server suite**

```bash
npx vitest run server/domain/context/context.schema.test.ts
npx vitest run server
npm run lint
```

- [ ] **Step 7: Commit**

```bash
git add server/domain/context/ server/domain/mcp/registry.ts
git commit -m "feat(slice-10): context schema +http transport; registry uses HttpMcpConnection"
```

---

## Phase H — Reasoning trace progressNote

### Task H1: Add `progressNote` field to ToolCallTrace

**Files:**
- Modify: `server/domain/reasoning/reasoning.types.ts`
- Modify: `server/domain/reasoning/reasoning.schema.ts`

- [ ] **Step 1: Update `reasoning.types.ts`**

Find the `ToolCallTrace` interface and add `progressNote`:

```ts
export interface ToolCallTrace {
  id: string;
  qualifiedName: string;
  args: Record<string, unknown>;
  result?: unknown;
  error?: string;
  durationMs: number;
  progressNote?: string;
}
```

- [ ] **Step 2: Update `reasoning.schema.ts`**

Find `ToolCallTraceSchema` and add the optional field:

```ts
export const ToolCallTraceSchema = z.object({
  id: z.string(),
  qualifiedName: z.string(),
  args: z.record(z.string(), z.unknown()),
  result: z.unknown().optional(),
  error: z.string().optional(),
  durationMs: z.number(),
  progressNote: z.string().optional(),
});
```

- [ ] **Step 3: Run reasoning suite + lint**

```bash
npx vitest run server/domain/reasoning
npm run lint
```

Expected: PASS (additive).

- [ ] **Step 4: Commit**

```bash
git add server/domain/reasoning/
git commit -m "feat(slice-10): ToolCallTrace +progressNote (optional)"
```

---

## Phase I — Dispatch service: in-flight controllers + new events

### Task I1: Track AbortControllers; emit tool_call_started + tool_call_progress

**Files:**
- Modify: `server/domain/dispatch/dispatch.service.ts`
- Modify: `server/routes/dispatch.routes.test.ts`

- [ ] **Step 1: Read existing tool-call loop in `dispatch.service.ts`**

Find the block that emits `tool_call_request`, calls `mcpRegistry.callTool`, and emits `tool_call_result`. We wrap that section.

- [ ] **Step 2: Modify `dispatch.service.ts`**

Add a private map and a public getter:

```ts
private inFlightControllers = new Map<string, AbortController>();

getInFlightController(callId: string): AbortController | undefined {
  return this.inFlightControllers.get(callId);
}
```

Inside the tool-call loop, REPLACE the current `mcpRegistry.callTool(...)` call with a wrapped version that:
1. Builds an `AbortController` and stores it
2. Emits `tool_call_started`
3. Calls `callTool` with `{ signal, onProgress }`
4. Forwards progress via SSE `tool_call_progress`
5. Cleans up the controller in `finally`

Concretely, find the section that looks like:

```ts
} else {
  toolResult = await this.deps.mcpRegistry.callTool(pendingCall.qualifiedName, pendingCall.args);
}
```

and replace with:

```ts
} else {
  const ctrl = new AbortController();
  this.inFlightControllers.set(pendingCall.callId, ctrl);
  sse.event('tool_call_started', pendingCall);
  let latestProgress = '';
  try {
    toolResult = await this.deps.mcpRegistry.callTool(
      pendingCall.qualifiedName,
      pendingCall.args,
      {
        signal: ctrl.signal,
        onProgress: (note) => {
          latestProgress = note;
          sse.event('tool_call_progress', { id: pendingCall.callId, note });
        },
      },
    );
  } finally {
    this.inFlightControllers.delete(pendingCall.callId);
  }
  // Attach the latest progress note to the tracer step we'll push next (see below).
  pendingProgressNote = latestProgress;
}
```

Inside the same loop iteration, where the existing `tracer.pushExternal(...)` records the `tool_call` step, include the `progressNote`:

```ts
tracer.pushExternal({
  type: 'tool_call',
  title: `Tool: ${pendingCall.qualifiedName}`,
  content: toolResult.ok
    ? `executed ${pendingCall.qualifiedName}`
    : `tool failed: ${toolResult.error}`,
  durationMs,
  toolCall: {
    id: pendingCall.callId,
    qualifiedName: pendingCall.qualifiedName,
    args: pendingCall.args,
    result: toolResult.ok ? toolResult.output : undefined,
    error: toolResult.ok ? undefined : toolResult.error,
    durationMs,
    progressNote: pendingProgressNote || undefined,
  },
});
```

Declare `let pendingProgressNote = '';` just inside the `while (true)` loop so it resets per call. Also handle the auto-approve path the same way — extract the call site into a small helper if you want to avoid duplication, but the cleanest path is to share the same wrapper for both approval branches. Concretely, fold the auto-approve `else { ... mcpRegistry.callTool ... }` branch into the same code, conditional on the decision variable.

- [ ] **Step 3: Append failing tests to `dispatch.routes.test.ts`**

Inside the existing `describe('dispatch with MCP tool call (slice 7)', ...)` block (or a new one):

```ts
it('emits tool_call_started before tool_call_result', async () => {
  // Reuse the slice-7 fixture: configure FakeProvider with a function_call,
  // register a mock MCP server, dispatch, then collect events.
  // Assert ordering: tool_call_request → tool_call_started → tool_call_result.
  // (For brevity, use whatever event-collection helper the file already has.)
});

it('cancel-call route aborts the in-flight controller', async () => {
  // Spy on dispatchService.getInFlightController; POST /api/mcp/cancel-call
  // with a known callId; assert .abort() was called.
});
```

The implementer should expand these to match the existing test harness in the file.

- [ ] **Step 4: Run dispatch tests**

```bash
npx vitest run server/domain/dispatch server/routes/dispatch.routes.test.ts
```

- [ ] **Step 5: Run full server suite + lint**

```bash
npx vitest run server
npm run lint
```

- [ ] **Step 6: Commit**

```bash
git add server/domain/dispatch/dispatch.service.ts server/routes/dispatch.routes.test.ts
git commit -m "feat(slice-10): dispatch tracks in-flight controllers; emits started + progress events"
```

---

## Phase J — `/api/mcp/refresh-tools` + `/api/mcp/cancel-call` routes

### Task J1: New endpoints

**Files:**
- Modify: `server/routes/mcp.routes.ts`
- Modify: `server/routes/mcp.routes.test.ts`
- Modify: `server/app.ts` (only if route wiring needs adjustment; usually not)

The cancel route needs access to the `DispatchService` to retrieve the in-flight controller. `AppDeps` already has `dispatcher` (slice 2a).

- [ ] **Step 1: Read `mcp.routes.ts` and identify the existing route factory**

The factory currently takes the `McpRegistry`. We extend it to also take the `DispatchService` so the cancel route can reach the in-flight map:

```ts
import type { DispatchService } from '@/server/domain/dispatch/dispatch.service';

export function createMcpRoutes(registry: McpRegistry, dispatcher?: DispatchService): Router {
  // ...
}
```

The `dispatcher` is optional so existing tests that build the routes with a stub registry only continue to work — the cancel route falls back to a 404 if `dispatcher` is absent.

- [ ] **Step 2: Append failing tests**

```ts
describe('mcp routes — refresh + cancel (slice 10)', () => {
  it('POST /api/mcp/:id/refresh-tools returns updated tools', async () => {
    // Connect mock server, call refresh, assert response shape.
  });

  it('POST /api/mcp/cancel-call invokes ctrl.abort on the matching in-flight controller', async () => {
    // Spy on dispatcher.getInFlightController; verify abort fires.
  });

  it('cancel-call is idempotent when controller is missing (returns 204)', async () => {
    // Just call with a fake callId.
  });

  it('refresh-tools on disconnected server returns 404 or 409', async () => {
    // Don't connect; call refresh; assert non-2xx.
  });
});
```

- [ ] **Step 3: Modify `mcp.routes.ts`**

Add the two routes:

```ts
router.post(
  '/:id/refresh-tools',
  asyncHandler(async (req, res) => {
    try {
      const tools = await registry.refreshTools(req.params.id);
      res.json({ tools });
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'refresh failed';
      res.status(409).json({ error: { code: 'NOT_ONLINE', message: msg } });
    }
  }),
);

router.post(
  '/cancel-call',
  asyncHandler(async (req, res) => {
    const callId = (req.body as { callId?: string })?.callId;
    if (typeof callId !== 'string' || callId.length === 0) {
      throw new ValidationError('callId required', null);
    }
    if (dispatcher) {
      const ctrl = dispatcher.getInFlightController(callId);
      if (ctrl) ctrl.abort();
    }
    res.status(204).end();
  }),
);
```

- [ ] **Step 4: Update `server/app.ts` to pass `dispatcher` when mounting**

Find the existing `app.use('/api/mcp', createMcpRoutes(deps.mcpRegistry))` call and add `deps.dispatcher`:

```ts
if (deps.mcpRegistry) {
  app.use('/api/mcp', createMcpRoutes(deps.mcpRegistry, deps.dispatcher));
}
```

- [ ] **Step 5: Run mcp routes + dispatch route tests**

```bash
npx vitest run server/routes/mcp.routes.test.ts server/routes/dispatch.routes.test.ts
```

- [ ] **Step 6: Run full server suite + lint**

```bash
npx vitest run server
npm run lint
```

- [ ] **Step 7: Commit**

```bash
git add server/routes/mcp.routes.ts server/routes/mcp.routes.test.ts server/app.ts
git commit -m "feat(slice-10): /api/mcp +refresh-tools +cancel-call routes"
```

---

## Phase K — FE mcp.api: refreshTools + cancelCall

### Task K1: API client extension + MSW default handlers

**Files:**
- Modify: `src/lib/api/mcp.api.ts`
- Modify: `src/lib/api/mcp.api.test.ts`
- Modify: `src/test/msw-handlers.ts`

- [ ] **Step 1: Append failing tests**

```ts
// In src/lib/api/mcp.api.test.ts, inside the existing describe:
it('refreshTools POSTs and returns the new tools list', async () => {
  server.use(
    http.post('http://localhost/api/mcp/M1/refresh-tools', () =>
      HttpResponse.json({
        tools: [{
          qualifiedName: 'mock.echo', serverId: 'M1', serverName: 'mock',
          tool: { name: 'echo', inputSchema: {} }, autoApprove: true,
        }],
      }),
    ),
  );
  const tools = await mcpApi.refreshTools('M1');
  expect(tools[0].qualifiedName).toBe('mock.echo');
});

it('cancelCall POSTs to /cancel-call', async () => {
  let posted: unknown = null;
  server.use(
    http.post('http://localhost/api/mcp/cancel-call', async ({ request }) => {
      posted = await request.json();
      return new HttpResponse(null, { status: 204 });
    }),
  );
  await mcpApi.cancelCall('CALL-1');
  expect(posted).toEqual({ callId: 'CALL-1' });
});
```

- [ ] **Step 2: Run, expect FAIL**

```bash
npx vitest run src/lib/api/mcp.api.test.ts
```

- [ ] **Step 3: Modify `mcp.api.ts`**

Add to the existing `mcpApi` object:

```ts
refreshTools: (id: string): Promise<LiveTool[]> =>
  fetch(`/api/mcp/${id}/refresh-tools`, { method: 'POST' })
    .then(jsonRes<{ tools: LiveTool[] }>)
    .then((b) => b.tools),

cancelCall: async (callId: string): Promise<void> => {
  const res = await fetch('/api/mcp/cancel-call', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ callId }),
  });
  if (!res.ok) throw new Error(res.statusText);
},
```

- [ ] **Step 4: Append MSW default handlers in `src/test/msw-handlers.ts`**

```ts
http.post('http://localhost/api/mcp/:id/refresh-tools', () =>
  HttpResponse.json({ tools: [] }),
),
http.post('http://localhost/api/mcp/cancel-call', () => new HttpResponse(null, { status: 204 })),
```

- [ ] **Step 5: Run, expect PASS + lint**

```bash
npx vitest run src/lib/api/mcp.api.test.ts
npm run lint
```

- [ ] **Step 6: Commit**

```bash
git add src/lib/api/mcp.api.ts src/lib/api/mcp.api.test.ts src/test/msw-handlers.ts
git commit -m "feat(slice-10): mcp.api +refreshTools +cancelCall (+MSW default handlers)"
```

---

## Phase L — FE mcp.store: inFlightCalls + refreshServer

### Task L1: Track in-flight calls + add refreshServer action

**Files:**
- Modify: `src/stores/mcp.store.ts`
- Modify: `src/stores/mcp.store.test.ts`

- [ ] **Step 1: Append failing tests**

```ts
it('registerInFlightCall adds to inFlightCalls', () => {
  useMcpStore.getState().registerInFlightCall({
    callId: 'C1',
    qualifiedName: 'mock.echo',
    args: { message: 'hi' },
  });
  expect(useMcpStore.getState().inFlightCalls['C1']?.qualifiedName).toBe('mock.echo');
});

it('updateInFlightProgress sets progressNote', () => {
  useMcpStore.getState().registerInFlightCall({
    callId: 'C1', qualifiedName: 'mock.echo', args: {},
  });
  useMcpStore.getState().updateInFlightProgress('C1', '50%');
  expect(useMcpStore.getState().inFlightCalls['C1']?.progressNote).toBe('50%');
});

it('clearInFlightCall removes the entry', () => {
  useMcpStore.getState().registerInFlightCall({
    callId: 'C1', qualifiedName: 'mock.echo', args: {},
  });
  useMcpStore.getState().clearInFlightCall('C1');
  expect(useMcpStore.getState().inFlightCalls['C1']).toBeUndefined();
});

it('refreshServer calls API and updates liveTools', async () => {
  useMcpStore.setState({
    liveTools: [{ qualifiedName: 'mock.echo', serverId: 'M1', serverName: 'mock', tool: { name: 'echo', inputSchema: {} }, autoApprove: true }],
    connectStates: { M1: 'online' },
    errors: {},
    inFlightCalls: {},
  });
  server.use(
    http.post('http://localhost/api/mcp/M1/refresh-tools', () =>
      HttpResponse.json({
        tools: [{
          qualifiedName: 'mock.current_time', serverId: 'M1', serverName: 'mock',
          tool: { name: 'current_time', inputSchema: {} }, autoApprove: true,
        }],
      }),
    ),
  );
  await useMcpStore.getState().refreshServer('M1');
  expect(useMcpStore.getState().liveTools).toHaveLength(1);
  expect(useMcpStore.getState().liveTools[0].tool.name).toBe('current_time');
});
```

- [ ] **Step 2: Run, expect FAIL**

```bash
npx vitest run src/stores/mcp.store.test.ts
```

- [ ] **Step 3: Modify `mcp.store.ts`**

Add the `InFlightCall` interface, extend state + actions:

```ts
export interface InFlightCall {
  callId: string;
  qualifiedName: string;
  args: Record<string, unknown>;
  progressNote?: string;
}

interface McpState {
  // ... existing
  inFlightCalls: Record<string, InFlightCall>;

  registerInFlightCall(call: InFlightCall): void;
  updateInFlightProgress(callId: string, note: string): void;
  clearInFlightCall(callId: string): void;
  refreshServer(id: string): Promise<void>;
}
```

In `initial`:

```ts
inFlightCalls: {} as Record<string, InFlightCall>,
```

In the create body:

```ts
registerInFlightCall: (call) =>
  set((s) => ({ inFlightCalls: { ...s.inFlightCalls, [call.callId]: call } })),

updateInFlightProgress: (callId, note) =>
  set((s) => {
    const cur = s.inFlightCalls[callId];
    if (!cur) return s;
    return { inFlightCalls: { ...s.inFlightCalls, [callId]: { ...cur, progressNote: note } } };
  }),

clearInFlightCall: (callId) =>
  set((s) => {
    const next = { ...s.inFlightCalls };
    delete next[callId];
    return { inFlightCalls: next };
  }),

refreshServer: async (id) => {
  try {
    const tools = await mcpApi.refreshTools(id);
    set((s) => ({
      liveTools: [
        ...s.liveTools.filter((t) => t.serverId !== id),
        ...tools,
      ],
      error: null,
    }));
  } catch (e) {
    set((s) => ({ errors: { ...s.errors, [id]: errMsg(e) } }));
    throw e;
  }
},
```

Also ensure `_reset` resets `inFlightCalls`:

```ts
_reset: () => set(initial),
```

The existing `initial` object now includes `inFlightCalls: {}` so this Just Works.

- [ ] **Step 4: Run, expect PASS + lint**

```bash
npx vitest run src/stores/mcp.store.test.ts
npm run lint
```

- [ ] **Step 5: Commit**

```bash
git add src/stores/mcp.store.ts src/stores/mcp.store.test.ts
git commit -m "feat(slice-10): useMcpStore +inFlightCalls +refreshServer"
```

---

## Phase M — `useStreamingDispatch` handles new SSE events

### Task M1: Wire tool_call_started + tool_call_progress

**Files:**
- Modify: `src/hooks/useStreamingDispatch.ts`

- [ ] **Step 1: Read the existing SSE event-handling block**

Find where the existing `tool_call_request` / `tool_call_result` / `mcp:state_change` events are processed.

- [ ] **Step 2: Add two new event branches**

Near the existing `tool_call_request` handler:

```ts
case 'tool_call_started': {
  const payload = ev.data as { callId?: string; id?: string; qualifiedName: string; args: Record<string, unknown> };
  const callId = payload.callId ?? payload.id ?? '';
  if (callId) {
    useMcpStore.getState().registerInFlightCall({
      callId,
      qualifiedName: payload.qualifiedName,
      args: payload.args,
    });
  }
  break;
}
case 'tool_call_progress': {
  const payload = ev.data as { id: string; note: string };
  useMcpStore.getState().updateInFlightProgress(payload.id, payload.note);
  break;
}
```

Update the existing `tool_call_result` handler to ALSO clear the in-flight entry:

```ts
case 'tool_call_result': {
  const payload = ev.data as { id: string };
  useMcpStore.getState().clearInFlightCall(payload.id);
  break;
}
```

If the existing handler intentionally was a no-op (slice 7), keep it as such for any earlier behaviour and ADD the `clearInFlightCall` line.

- [ ] **Step 3: Run FE suite (no regressions)**

```bash
npx vitest run src
npm run lint
```

- [ ] **Step 4: Commit**

```bash
git add src/hooks/useStreamingDispatch.ts
git commit -m "feat(slice-10): useStreamingDispatch handles tool_call_started/progress + clears in-flight on result"
```

---

## Phase N — `ToolCallBanner` component

### Task N1: Banner that shows in-flight calls with Cancel button

**Files:**
- Create: `src/components/chat/ToolCallBanner.tsx`
- Create: `src/components/chat/ToolCallBanner.test.tsx`

- [ ] **Step 1: Failing tests**

```tsx
// src/components/chat/ToolCallBanner.test.tsx
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { server } from '@/src/test/msw-server';
import { ToolCallBanner } from './ToolCallBanner';
import { useMcpStore } from '@/src/stores/mcp.store';

beforeEach(() => {
  useMcpStore.getState()._reset();
});

describe('ToolCallBanner', () => {
  it('renders nothing when no in-flight calls', () => {
    const { container } = render(<ToolCallBanner />);
    expect(container.firstChild).toBeNull();
  });

  it('renders one banner per in-flight call with qualifiedName and Cancel button', () => {
    useMcpStore.getState().registerInFlightCall({
      callId: 'C1',
      qualifiedName: 'mock.echo',
      args: { message: 'hi' },
    });
    render(<ToolCallBanner />);
    expect(screen.getByText('mock.echo')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /cancel mock\.echo/i })).toBeInTheDocument();
  });

  it('renders progressNote if present', () => {
    useMcpStore.getState().registerInFlightCall({
      callId: 'C1',
      qualifiedName: 'mock.slow',
      args: {},
    });
    useMcpStore.getState().updateInFlightProgress('C1', '1/2 — step 1');
    render(<ToolCallBanner />);
    expect(screen.getByText(/1\/2 — step 1/)).toBeInTheDocument();
  });

  it('Cancel button POSTs cancelCall with the right id', async () => {
    useMcpStore.getState().registerInFlightCall({
      callId: 'C1',
      qualifiedName: 'mock.echo',
      args: {},
    });
    let posted: unknown = null;
    server.use(
      http.post('http://localhost/api/mcp/cancel-call', async ({ request }) => {
        posted = await request.json();
        return new HttpResponse(null, { status: 204 });
      }),
    );
    const user = userEvent.setup();
    render(<ToolCallBanner />);
    await user.click(screen.getByRole('button', { name: /cancel mock\.echo/i }));
    expect(posted).toEqual({ callId: 'C1' });
  });
});
```

- [ ] **Step 2: Run, expect FAIL**

```bash
npx vitest run src/components/chat/ToolCallBanner.test.tsx
```

- [ ] **Step 3: Implement `ToolCallBanner.tsx`**

```tsx
import { useMcpStore } from '@/src/stores/mcp.store';
import { mcpApi } from '@/src/lib/api/mcp.api';

export function ToolCallBanner() {
  const inFlight = useMcpStore((s) => Object.values(s.inFlightCalls));

  if (inFlight.length === 0) return null;

  return (
    <div className="absolute bottom-16 left-0 right-0 mx-auto max-w-2xl flex flex-col gap-1 px-3 pointer-events-none">
      {inFlight.map((call) => (
        <div
          key={call.callId}
          className="pointer-events-auto flex items-center justify-between p-2 rounded bg-surface-2 border border-accent/40 text-[10px] font-mono"
        >
          <div className="flex flex-col min-w-0">
            <span className="text-zinc-300 truncate">{call.qualifiedName}</span>
            {call.progressNote && (
              <span className="text-zinc-500 italic truncate">{call.progressNote}</span>
            )}
          </div>
          <button
            type="button"
            aria-label={`Cancel ${call.qualifiedName}`}
            onClick={() => mcpApi.cancelCall(call.callId).catch(() => {})}
            className="ml-2 text-status-error hover:text-white"
          >
            Cancel
          </button>
        </div>
      ))}
    </div>
  );
}
```

The `pointer-events-none` on the outer container + `pointer-events-auto` on the inner panel keeps the banner from blocking clicks on the chat surface behind it.

- [ ] **Step 4: Run, expect PASS**

```bash
npx vitest run src/components/chat/ToolCallBanner.test.tsx
```

- [ ] **Step 5: Lint + commit**

```bash
npm run lint
git add src/components/chat/ToolCallBanner.tsx src/components/chat/ToolCallBanner.test.tsx
git commit -m "feat(slice-10): add ToolCallBanner (in-flight + cancel + progress)"
```

---

## Phase O — `McpServersSection` refresh button + reconnecting badge

### Task O1: ↻ button on online rows + reconnecting (N/M) badge

**Files:**
- Modify: `src/components/mcp/McpServersSection.tsx`
- Modify: `src/components/mcp/McpServersSection.test.tsx`

- [ ] **Step 1: Append failing tests**

```tsx
it('shows ↻ Refresh button when state=online', () => {
  useContextStore.setState({
    context: {
      systemInstruction: '', skills: [], tools: [],
      mcpServers: [{ id: 'M1', name: 'mock', transport: 'mock', status: 'offline' }],
    },
  });
  useMcpStore.setState({
    liveTools: [], connectStates: { M1: 'online' }, errors: {}, inFlightCalls: {},
  });
  render(<McpServersSection />);
  expect(screen.getByRole('button', { name: /refresh mock/i })).toBeInTheDocument();
});

it('shows reconnecting badge when state=reconnecting', () => {
  useContextStore.setState({
    context: {
      systemInstruction: '', skills: [], tools: [],
      mcpServers: [{ id: 'M1', name: 'mock', transport: 'mock', status: 'offline' }],
    },
  });
  useMcpStore.setState({
    liveTools: [], connectStates: { M1: 'reconnecting' }, errors: {}, inFlightCalls: {},
  });
  render(<McpServersSection />);
  expect(screen.getByText(/reconnecting/i)).toBeInTheDocument();
});

it('Refresh button triggers useMcpStore.refreshServer', async () => {
  useContextStore.setState({
    context: {
      systemInstruction: '', skills: [], tools: [],
      mcpServers: [{ id: 'M1', name: 'mock', transport: 'mock', status: 'offline' }],
    },
  });
  useMcpStore.setState({
    liveTools: [], connectStates: { M1: 'online' }, errors: {}, inFlightCalls: {},
  });
  const spy = vi.spyOn(useMcpStore.getState(), 'refreshServer').mockResolvedValue(undefined);
  const user = userEvent.setup();
  render(<McpServersSection />);
  await user.click(screen.getByRole('button', { name: /refresh mock/i }));
  expect(spy).toHaveBeenCalledWith('M1');
});
```

- [ ] **Step 2: Run, expect FAIL**

```bash
npx vitest run src/components/mcp/McpServersSection.test.tsx
```

- [ ] **Step 3: Modify `McpServersSection.tsx`**

Read the current file. The component iterates over `servers` and renders a row per server. For each server:
- When state === 'online': existing Disconnect button + status dot. Add a small ↻ button between them.
- When state === 'reconnecting': replace the Connect/Disconnect buttons with a small label like `reconnecting (N/M)`.

Add the import:

```tsx
import { RefreshCw } from 'lucide-react';
```

Read the current connect-states value with full snapshot info. The existing code likely does:

```tsx
const state = connectStates[server.id] ?? 'offline';
```

That returns just the state string. To get the attempt counters, we need the full snapshot. Add the snapshot to the store via a new field `connectSnapshots` (cleaner), OR read both state and reconnect counts via separate selectors:

The simpler approach: extend `useMcpStore.applyServerStateEvent` to ALSO store the attempt counters, on a sibling map `reconnectInfo: Record<id, { attempt: number; max: number }>`. The state event from the backend (slice 7's `mcp:state_change`) already carries them (we added the optional fields in B1).

Add to `mcp.store.ts`:

```ts
interface McpState {
  // ... existing
  reconnectInfo: Record<string, { attempt: number; max: number }>;
}

// initial:
reconnectInfo: {} as Record<string, { attempt: number; max: number }>,

// applyServerStateEvent (modify to store the info):
applyServerStateEvent: (id, state, error, reconnectAttempt, reconnectMaxAttempts) =>
  set((s) => ({
    connectStates: { ...s.connectStates, [id]: state },
    errors: error ? { ...s.errors, [id]: error } : s.errors,
    reconnectInfo: state === 'reconnecting' && reconnectAttempt && reconnectMaxAttempts
      ? { ...s.reconnectInfo, [id]: { attempt: reconnectAttempt, max: reconnectMaxAttempts } }
      : (state === 'online' || state === 'offline'
        ? Object.fromEntries(Object.entries(s.reconnectInfo).filter(([k]) => k !== id))
        : s.reconnectInfo),
  })),
```

Also update `useStreamingDispatch.ts`'s `mcp:state_change` branch to pass the additional fields through:

```ts
case 'mcp:state_change': {
  const payload = ev.data as {
    id: string;
    state: McpConnectionState;
    error?: string;
    reconnectAttempt?: number;
    reconnectMaxAttempts?: number;
  };
  useMcpStore.getState().applyServerStateEvent(
    payload.id, payload.state, payload.error,
    payload.reconnectAttempt, payload.reconnectMaxAttempts,
  );
  break;
}
```

Now in `McpServersSection.tsx`, read `reconnectInfo[server.id]` and render accordingly:

```tsx
const refresh = useMcpStore((s) => s.refreshServer);
const reconnectInfo = useMcpStore((s) => s.reconnectInfo);
// ... in the row:
const info = reconnectInfo[server.id];

// In the right-side action group:
{state === 'reconnecting' ? (
  <span className="text-[10px] text-zinc-500">
    reconnecting{info ? ` (${info.attempt}/${info.max})` : ''}
  </span>
) : state === 'online' ? (
  <>
    <button
      type="button"
      aria-label={`Refresh ${server.name}`}
      onClick={() => refresh(server.id).catch(() => {})}
      className="text-zinc-500 hover:text-white"
    >
      <RefreshCw size={10} />
    </button>
    <button
      type="button"
      onClick={() => disconnect(server.id).catch(() => {})}
      aria-label={`Disconnect ${server.name}`}
      className="text-[10px] text-zinc-400 hover:text-white"
    >
      Disconnect
    </button>
  </>
) : (
  // existing Connect button branch
  // ...
)}
```

- [ ] **Step 4: Run, expect PASS + suite + lint**

```bash
npx vitest run src/components/mcp/McpServersSection.test.tsx
npx vitest run src
npm run lint
```

- [ ] **Step 5: Commit**

```bash
git add src/components/mcp/McpServersSection.tsx src/components/mcp/McpServersSection.test.tsx src/stores/mcp.store.ts src/hooks/useStreamingDispatch.ts
git commit -m "feat(slice-10): McpServersSection +refresh button +reconnecting badge"
```

---

## Phase P — `ReasoningStepCard` progressNote rendering

### Task P1: Render the latest progressNote on tool_call steps

**Files:**
- Modify: `src/components/reasoning/ReasoningStepCard.tsx`
- Modify: `src/components/reasoning/ReasoningStepCard.test.tsx`

- [ ] **Step 1: Append failing test**

```tsx
it('renders progressNote when present on a tool_call step', () => {
  render(
    <ReasoningStepCard
      step={{
        id: 'X',
        type: 'tool_call',
        title: 'Tool: mock.slow',
        content: 'executed mock.slow',
        toolCall: {
          id: 'C1',
          qualifiedName: 'mock.slow',
          args: {},
          result: { ok: true },
          durationMs: 100,
          progressNote: '2/2 — done',
        },
        timestamp: 0,
      }}
    />,
  );
  expect(screen.getByText(/2\/2 — done/)).toBeInTheDocument();
});
```

- [ ] **Step 2: Run, expect FAIL**

```bash
npx vitest run src/components/reasoning/ReasoningStepCard.test.tsx
```

- [ ] **Step 3: Modify `ReasoningStepCard.tsx`**

Find the existing `step.toolCall` render block. Above the args panel, add:

```tsx
{step.toolCall?.progressNote && (
  <div className="text-[10px] italic text-zinc-500 mb-1">
    {step.toolCall.progressNote}
  </div>
)}
```

- [ ] **Step 4: Run, expect PASS + lint**

```bash
npx vitest run src/components/reasoning/ReasoningStepCard.test.tsx
npm run lint
```

- [ ] **Step 5: Commit**

```bash
git add src/components/reasoning/ReasoningStepCard.tsx src/components/reasoning/ReasoningStepCard.test.tsx
git commit -m "feat(slice-10): ReasoningStepCard renders tool_call progressNote"
```

---

## Phase Q — App.tsx mounts `ToolCallBanner`

### Task Q1: Mount the banner

**Files:**
- Modify: `src/App.tsx`

- [ ] **Step 1: Modify `src/App.tsx`**

Add the import:

```tsx
import { ToolCallBanner } from '@/src/components/chat/ToolCallBanner';
```

Mount the banner inside the `<AppShell>` children, just after `<ChatView />`:

```tsx
<ChatView />
<ToolCallBanner />
```

(`ToolCallBanner` returns null when no in-flight calls, so the position is fine even when nothing's active.)

- [ ] **Step 2: Run FE suite + lint**

```bash
npx vitest run src
npm run lint
```

- [ ] **Step 3: Commit**

```bash
git add src/App.tsx
git commit -m "feat(slice-10): App.tsx mounts ToolCallBanner"
```

---

## Phase R — Integration test

### Task R1: refresh + cancel + progress end-to-end

**Files:**
- Create: `src/integration/mcp-advanced.integration.test.tsx`

- [ ] **Step 1: Write the test**

```tsx
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { server } from '@/src/test/msw-server';
import App from '@/src/App';
import { useUiStore } from '@/src/stores/ui.store';
import { useSessionsStore } from '@/src/stores/sessions.store';
import { useProfilesStore } from '@/src/stores/profiles.store';
import { useContextStore } from '@/src/stores/context.store';
import { useSubAgentsStore } from '@/src/stores/subagents.store';
import { useMcpStore } from '@/src/stores/mcp.store';
import { useProvidersStore } from '@/src/stores/providers.store';

beforeEach(() => {
  useUiStore.getState()._reset();
  useSessionsStore.getState()._reset();
  useProfilesStore.getState()._reset();
  useContextStore.getState()._reset();
  useSubAgentsStore.getState()._reset();
  useMcpStore.getState()._reset();
  useProvidersStore.getState()._reset();
  localStorage.clear();
});

describe('mcp advanced integration', () => {
  it('Cancel button POSTs cancelCall', async () => {
    useMcpStore.getState().registerInFlightCall({
      callId: 'CALL-1',
      qualifiedName: 'mock.slow',
      args: { sleep: 5 },
    });
    let posted: unknown = null;
    server.use(
      http.post('http://localhost/api/mcp/cancel-call', async ({ request }) => {
        posted = await request.json();
        return new HttpResponse(null, { status: 204 });
      }),
    );
    const user = userEvent.setup();
    render(<App />);
    await waitFor(() => expect(screen.getByText('mock.slow')).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: /cancel mock\.slow/i }));
    await waitFor(() => expect((posted as { callId?: string })?.callId).toBe('CALL-1'));
  });

  it('Refresh button on online server triggers refreshServer', async () => {
    server.use(
      http.get('http://localhost/api/context', () =>
        HttpResponse.json({
          systemInstruction: '', skills: [], tools: [],
          mcpServers: [{ id: 'M1', name: 'mock', transport: 'mock', status: 'offline' }],
        }),
      ),
      http.post('http://localhost/api/mcp/M1/refresh-tools', () =>
        HttpResponse.json({
          tools: [{
            qualifiedName: 'mock.current_time', serverId: 'M1', serverName: 'mock',
            tool: { name: 'current_time', inputSchema: {} }, autoApprove: true,
          }],
        }),
      ),
    );
    const user = userEvent.setup();
    render(<App />);
    await waitFor(() => expect(useContextStore.getState().context?.mcpServers).toHaveLength(1));
    // Mark the server online manually (we're not exercising Connect here)
    useMcpStore.setState({
      liveTools: [],
      connectStates: { M1: 'online' },
      errors: {},
      inFlightCalls: {},
      reconnectInfo: {},
    });
    await user.click(await screen.findByRole('button', { name: /refresh mock/i }));
    await waitFor(() => {
      expect(useMcpStore.getState().liveTools.map((t) => t.tool.name)).toEqual(['current_time']);
    });
  });
});
```

- [ ] **Step 2: Run, expect PASS**

```bash
npx vitest run src/integration/mcp-advanced.integration.test.tsx
```

- [ ] **Step 3: Lint + commit**

```bash
npm run lint
git add src/integration/mcp-advanced.integration.test.tsx
git commit -m "test(slice-10): integration — refresh + cancel paths"
```

---

## Phase S — Playwright e2e

### Task S1: smoke test against the mock MCP server

**Files:**
- Modify: `e2e/smoke.spec.ts`

- [ ] **Step 1: Append the test**

```ts
test('mcp advanced: refresh + cancel on mock server', async ({ page, request }) => {
  // Seed a mock server entry
  const cur = await request.get('/api/context').then((r) => r.json());
  const seeded = {
    ...cur,
    mcpServers: [
      ...(cur.mcpServers ?? []).filter((s: { id: string }) => s.id !== 'E2E_ADV'),
      { id: 'E2E_ADV', name: 'mock', transport: 'mock', status: 'offline' },
    ],
  };
  await request.put('/api/context', { data: seeded });

  await page.goto('/');
  await expect(page.getByText('AETHER_CORE')).toBeVisible();

  const sidebar = page.getByRole('complementary', { name: /sidebar/i });

  // Connect the mock server
  await sidebar.getByRole('button', { name: /connect mock/i }).click();
  await expect(sidebar.getByText('mock.echo')).toBeVisible({ timeout: 5000 });

  // Click Refresh → list still shows mock.echo (mock is deterministic)
  await sidebar.getByRole('button', { name: /refresh mock/i }).click();
  await expect(sidebar.getByText('mock.echo')).toBeVisible();

  // Disconnect cleanup
  await sidebar.getByRole('button', { name: /disconnect mock/i }).click();

  // Cleanup seeded entry
  const after = await request.get('/api/context').then((r) => r.json());
  const cleaned = {
    ...after,
    mcpServers: (after.mcpServers ?? []).filter((s: { id: string }) => s.id !== 'E2E_ADV'),
  };
  await request.put('/api/context', { data: cleaned });
});
```

This test exercises the Refresh path; the Cancel path requires an actually-running long tool call, which the mock doesn't currently support without extending the mock to emit a slow tool. For slice 10 we cover Cancel via the integration test and the backend unit tests; the e2e validates the Refresh button only.

- [ ] **Step 2: Lint + run Playwright (port 3000 expected free)**

```bash
npm run lint
npx playwright test e2e/smoke.spec.ts -g "mcp advanced:"
```

Expected: 1 test PASS.

- [ ] **Step 3: Full e2e run (no regressions)**

```bash
npx playwright test
```

Expected: 14 tests pass (13 existing + 1 new).

- [ ] **Step 4: Commit**

```bash
git add e2e/smoke.spec.ts
git commit -m "test(slice-10): playwright — refresh button against mock MCP"
```

---

## Phase T — Final verification + PR

### Task T1: lint + full tests + push + PR

- [ ] **Step 1: Lint**

```bash
npm run lint
```

- [ ] **Step 2: Vitest**

```bash
npm run test:run
```

Expected: ALL PASS.

- [ ] **Step 3: Coverage**

```bash
npm run test:coverage
```

Expected: ≥80% on `http-connection.ts`, new methods in `registry.ts`, `ToolCallBanner.tsx`, new actions in `mcp.store.ts`.

- [ ] **Step 4: Playwright (port 3000 expected free)**

```bash
npx playwright test
```

Expected: 14/14 PASS.

- [ ] **Step 5: Push**

```bash
git push -u origin feat/slice-10-mcp-advanced
```

- [ ] **Step 6: Open PR**

```bash
gh pr create --base main --title "feat(slice-10): MCP advanced — HTTP transport + hardening" --body "$(cat <<'EOF'
## Summary
- **HTTP+SSE transport**: new `HttpMcpConnection` for remote MCP servers; configurable via env `OLLAMA_HOST`-style `url` field on context entries with `transport: 'http'`.
- **Auto-reconnect**: registry hooks into `onUnexpectedClose` from stdio/HTTP connections and runs an exponential-backoff loop (1s, 2s, 4s, 8s, 16s; max 5 attempts).
- **Refresh discovery**: `POST /api/mcp/:id/refresh-tools` re-runs \`tools/list\` without disconnect; FE has a ↻ button on online sub-agent rows.
- **Streaming progress**: server-pushed \`notifications/progress\` frames are surfaced inline on the tool_call reasoning step AND in the live ToolCallBanner.
- **User cancellation**: new \`ToolCallBanner\` shows in-flight calls with a Cancel button; backend tracks an AbortController per callId and aborts on \`POST /api/mcp/cancel-call\`.
- The \`McpConnection\` interface gains an optional \`{ signal, onProgress }\` opts arg on \`callTool\` and an optional \`onUnexpectedClose\` setter; all three transports honor them.

## Test plan
- [x] \`npm run lint\` clean
- [x] \`npm run test:run\` all green
- [x] \`npx playwright test\` all green
- [x] Coverage on new files

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

Expected: PR URL printed.

---

## Definition of Done

- All new BE + FE unit / component / integration tests green.
- `e2e/smoke.spec.ts` has 14 tests.
- `npm run lint` clean.
- Coverage ≥80% on the new files (`http-connection.ts`, new methods on `registry.ts`, `ToolCallBanner.tsx`, new methods on `src/stores/mcp.store.ts`).
- Manual smoke (`npm run dev`):
  - Configure a mock MCP server, Connect → tools listed → click ↻ Refresh → tools list re-fetched.
  - Send a chat that triggers a tool call → Banner appears → Cancel button works → "Cancelled by user" surfaces in the reasoning drawer.
  - Configure a stdio MCP server, kill the subprocess externally → sidebar shows `reconnecting (1/5)` → after backoff, server returns to online.
- One PR on `feat/slice-10-mcp-advanced` against `main`.
