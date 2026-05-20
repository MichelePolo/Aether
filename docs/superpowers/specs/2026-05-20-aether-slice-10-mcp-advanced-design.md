# Aether — Slice 10: MCP Advanced — HTTP transport + hardening (Design)

**Branch:** `feat/slice-10-mcp-advanced`
**Date:** 2026-05-20
**Depends on:** slices 0–9 (especially slice 7 for the MCP foundation).

## Goal

Extend the slice-7 MCP integration with five hardening features bundled into a single slice: HTTP+SSE transport (in addition to the existing `stdio` and `mock`), auto-reconnect with exponential backoff after unexpected connection loss, on-demand discovery refresh while a server is connected, server-pushed progress events surfaced inline in the reasoning trace, and user-initiated cancellation of in-flight tool calls.

## Non-goals

- Persistent reconnect across server restarts (the server itself is in-memory state; on Aether restart, no auto-connect).
- HTTP authentication beyond what the configured `headers` already allow at the request level.
- Streamable HTTP variant (the newer MCP HTTP transport that uses pure request/response). We ship only the spec's HTTP+SSE variant.
- Showing past progress notes in the reasoning trace (only the latest note is rendered).
- Cancellation of multiple in-flight calls in one click — each banner has its own button.
- Tracking historical reconnect attempts in persistence — the counter resets when a connection enters `online` or `offline`.
- A separate "advanced" UI surface for the new features. Everything lives in the existing `McpServersSection` + `ToolCallBanner` (new) + `ReasoningStepCard`.

## Decisions log

| # | Decision | Chosen | Rationale |
|---|---|---|---|
| 1 | Scope | All five features in one slice | "MCP advanced" is naturally cohesive; splitting would leak abstractions |
| 2 | HTTP variant | Official MCP HTTP+SSE | Compatible with existing servers exposed via HTTP wrapper |
| 3 | Reconnect policy | Exponential backoff `1s, 2s, 4s, 8s, 16s`, max 5 attempts, then `'error'` | Covers transient crashes; gives up on permanent failures |
| 4 | Cancel trigger UX | `ToolCallBanner` with per-call Cancel button | Specific to each call; visible only while in flight |
| 5 | Progress UX | Latest note rendered inline on the tool_call reasoning step | Already a structured surface; no new UI slot |
| 6 | Refresh trigger | `↻` button next to Disconnect when state=online | Explicit; no polling traffic |
| 7 | Connection contract | `callTool` gains `{ signal?, onProgress? }` opts (additive) | Backward-compatible with mock/stdio existing callers |
| 8 | Unexpected close handler | Optional `onUnexpectedClose` setter on the connection | Registry installs it; connection emits when transport drops without `close()` |
| 9 | HTTP `url` requirement | Schema stays permissive; registry's `makeConnection` enforces "http needs url" at runtime | Matches slice-7 pattern for "stdio needs command" |
| 10 | Cancellation wire format | `notifications/cancelled` JSON-RPC notification + local pending-promise rejection | Per MCP spec; tolerates server's lack of cooperation |
| 11 | Progress wire format | `notifications/progress` parsed from server; `progress`/`total`/`message` joined into a single human-readable `note` | Spec-compliant; the renderer doesn't need structured fields |
| 12 | In-flight tracking | Backend `dispatch.service` keeps a `Map<callId, AbortController>`; FE `useMcpStore` keeps a parallel `inFlightCalls` map | Two halves; no shared mutable state |
| 13 | Reconnect during refresh | Refresh on `state='reconnecting'` server returns 409 | Don't pretend a refresh worked when there's no live connection |
| 14 | Final state transition | `reconnecting` is a new `McpConnectionState` value | Distinct from `connecting` (initial connect) for UX clarity |

## Architecture

### Library

No new third-party deps. We reuse the slice-0 line-buffered SSE parser pattern for the HTTP transport.

### Backend (`server/`)

| Path | Role |
|---|---|
| `domain/mcp/connection.types.ts` | **MODIFY**: add `CallToolOpts` (signal + onProgress); extend `McpConnection.callTool`; add optional `onUnexpectedClose(handler)` |
| `domain/mcp/mock-connection.ts` | **MODIFY**: honor `signal` (immediate abort if pre-aborted); ignore `onProgress` |
| `domain/mcp/stdio-connection.ts` | **MODIFY**: wire `signal` (write `notifications/cancelled` on abort); parse `notifications/progress` → invoke `onProgress`; expose `onUnexpectedClose` |
| `domain/mcp/http-connection.ts` | **NEW**: fetch + SSE-stream parsing; per-call pending map; signal + onProgress support; onUnexpectedClose when SSE drops |
| `domain/mcp/http-connection.test.ts` | **NEW** |
| `domain/mcp/registry.ts` | **MODIFY**: auto-reconnect loop with exp backoff; `refreshTools(id)`; `cancelToolCall(callId)`; pass opts through `callTool` |
| `domain/mcp/registry.test.ts` | **MODIFY**: cover reconnect lifecycle, refresh, cancel |
| `domain/mcp/mcp.types.ts` | **MODIFY**: `McpConnectionState` adds `'reconnecting'`; `McpConnectionStateSnapshot` adds optional `reconnectAttempt` + `reconnectMaxAttempts` |
| `domain/context/context.schema.ts` | **MODIFY**: `McpServerSchema` enum widens to `'stdio' \| 'mock' \| 'http'` |
| `domain/context/context.types.ts` | **MODIFY**: `McpTransport` adds `'http'` |
| `domain/reasoning/reasoning.types.ts` | **MODIFY**: `ToolCallTrace.progressNote?: string` |
| `domain/reasoning/reasoning.schema.ts` | **MODIFY**: schema mirrors |
| `domain/dispatch/dispatch.service.ts` | **MODIFY**: track in-flight `AbortController` per `callId`; expose getter for routes; emit `tool_call_started` + `tool_call_progress` SSE events; honor cancellation; update the tool_call reasoning step's `progressNote` with the latest note |
| `routes/mcp.routes.ts` | **MODIFY**: add `POST /api/mcp/:id/refresh-tools`, `POST /api/mcp/cancel-call` |
| `routes/mcp.routes.test.ts` | **MODIFY** |

### Frontend (`src/`)

| Path | Role |
|---|---|
| `types/mcp.types.ts` | **VERIFY**: re-exports already cover new fields via the upstream types |
| `lib/api/mcp.api.ts` | **MODIFY**: add `refreshTools(id)` + `cancelCall(callId)` |
| `lib/api/mcp.api.test.ts` | **MODIFY** |
| `stores/mcp.store.ts` | **MODIFY**: add `inFlightCalls: Record<callId, InFlightCall>`; `refreshServer(id)`; `registerInFlightCall`, `updateInFlightProgress`, `clearInFlightCall` |
| `stores/mcp.store.test.ts` | **MODIFY** |
| `test/msw-handlers.ts` | **MODIFY**: default handlers for the two new endpoints |
| `hooks/useStreamingDispatch.ts` | **MODIFY**: handle `tool_call_started`, `tool_call_progress` (clear is in existing `tool_call_result`) |
| `components/chat/ToolCallBanner.tsx` | **NEW**: renders one banner per in-flight call with Cancel button |
| `components/chat/ToolCallBanner.test.tsx` | **NEW** |
| `components/mcp/McpServersSection.tsx` | **MODIFY**: add `↻ Refresh` button on online rows; show `reconnecting (N/M)` badge |
| `components/mcp/McpServersSection.test.tsx` | **MODIFY** |
| `components/reasoning/ReasoningStepCard.tsx` | **MODIFY**: render `progressNote` if present (small italic line above args) |
| `App.tsx` | **MODIFY**: mount `<ToolCallBanner />` near `<ChatView />` |
| `integration/mcp-advanced.integration.test.tsx` | **NEW**: progress + cancel + refresh end-to-end |

### E2E

Append one Playwright test using the in-process mock transport. No remote HTTP server required.

## Types

### `CallToolOpts` and `McpConnection`

```ts
// server/domain/mcp/connection.types.ts
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

### `McpConnectionState` + snapshot

```ts
// server/domain/mcp/mcp.types.ts (modified)
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

### Reasoning step

```ts
// server/domain/reasoning/reasoning.types.ts (additive)
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

## HTTP transport — `HttpMcpConnection`

```ts
export interface HttpMcpOpts {
  url: string;
  headers?: Record<string, string>;
}

export class HttpMcpConnection implements McpConnection {
  readonly defaultAutoApprove = false;
  private reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  private streamAborter = new AbortController();
  private pending = new Map<number, PendingCall>();
  private nextId = 1;
  private unexpectedCloseHandler: (() => void) | null = null;

  constructor(private readonly opts: HttpMcpOpts) {}

  onUnexpectedClose(handler: () => void): void {
    this.unexpectedCloseHandler = handler;
  }

  async initialize(): Promise<void> { /* POST initialize + open SSE */ }
  async listTools(): Promise<McpTool[]> { /* POST tools/list + await */ }
  async callTool(name, args, opts?): Promise<McpToolResult> { /* signal + onProgress */ }
  async close(): Promise<void> { /* abort SSE + reject pending */ }
}
```

### Wire format

```
POST  ${url}
Content-Type: application/json
Accept: text/event-stream
Body: { jsonrpc: '2.0', id, method, params }
```

Response body is an SSE stream. Each `data:` frame is a single JSON-RPC message (response | notification). The client parses frames, routes by `id`:

- `response with result` → resolves the pending entry's promise
- `response with error` → rejects it
- `notification 'notifications/progress'` (params: `{ progressToken, progress, total?, message? }`) → looks up the pending entry by `progressToken` (which equals `callId`); invokes `onProgress(note)` where `note = `${progress}/${total ?? '?'} — ${message ?? ''}``
- `notification 'notifications/cancelled'` → ignored (this is what WE send to the server, not what we receive)

Each `POST` for a method (initialize, tools/list, tools/call) carries the next outgoing id and a `progressToken` equal to the id so the server can address progress messages back. The SSE stream is shared across all outgoing requests for the lifetime of the connection.

### Cancellation (HTTP)

```
opts.signal.addEventListener('abort', () => {
  fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      method: 'notifications/cancelled',
      params: { requestId: id, reason: 'Cancelled by user' },
    }),
  }).catch(() => {});
  const p = pending.get(id);
  if (p) {
    pending.delete(id);
    p.reject(new Error('Cancelled by user'));
  }
});
```

The server may ignore the notification; the client doesn't wait for confirmation.

## Auto-reconnect

`McpRegistry` installs `onUnexpectedClose` on every newly-built connection. When fired:

```ts
private async reconnectLoop(id: string, cfg: McpServerConfig): Promise<void> {
  const ABORTABLE = new AbortController();
  this.reconnectAborters.set(id, ABORTABLE);
  const BACKOFF = [1000, 2000, 4000, 8000, 16000];
  for (let attempt = 1; attempt <= BACKOFF.length; attempt++) {
    if (ABORTABLE.signal.aborted) return;
    this.states.set(id, {
      state: 'reconnecting',
      reconnectAttempt: attempt,
      reconnectMaxAttempts: BACKOFF.length,
    });
    this.emitStateChange(id);
    await sleepUnlessAborted(BACKOFF[attempt - 1], ABORTABLE.signal);
    if (ABORTABLE.signal.aborted) return;
    try {
      const fresh = this.makeConnection(cfg);
      await fresh.initialize();
      const tools = await fresh.listTools();
      const policies = cfg.toolPolicies ?? {};
      fresh.onUnexpectedClose?.(() => this.reconnectLoop(id, cfg));
      this.live.set(id, { connection: fresh, serverName: cfg.name, serverId: id, tools, policies });
      this.states.set(id, { state: 'online' });
      this.emitStateChange(id);
      this.reconnectAborters.delete(id);
      return;
    } catch (e) {
      // continue to next attempt
    }
  }
  this.states.set(id, { state: 'error', error: 'Reconnect failed after 5 attempts' });
  this.emitStateChange(id);
  this.reconnectAborters.delete(id);
}
```

User-initiated `disconnect(id)` aborts the `reconnectAborters` controller for that id, ensuring no orphan retry runs.

## Refresh discovery

```ts
async refreshTools(id: string): Promise<McpTool[]> {
  const entry = this.live.get(id);
  if (!entry) throw new NotFoundError(`server ${id} not online`);
  const tools = await entry.connection.listTools();
  entry.tools = tools;
  return tools;
}
```

Route:

```
POST /api/mcp/:id/refresh-tools
  → 200 { tools: LiveTool[] }
  → 404 { error: 'server X not online' }
```

FE: `mcpApi.refreshTools(id)` → `useMcpStore.refreshServer(id)` → optimistic spin icon, replace `liveTools` for that server.

## Cancellation — dispatch wire-up

```ts
// dispatch.service.ts
class DispatchService {
  private inFlightControllers = new Map<string, AbortController>();

  getInFlightController(callId: string): AbortController | undefined {
    return this.inFlightControllers.get(callId);
  }

  // Inside the tool-call loop:
  const ctrl = new AbortController();
  this.inFlightControllers.set(call.callId, ctrl);
  sse.event('tool_call_started', call);
  try {
    toolResult = await this.deps.mcpRegistry.callTool(
      call.qualifiedName,
      call.args,
      {
        signal: ctrl.signal,
        onProgress: (note) => sse.event('tool_call_progress', { id: call.callId, note }),
      },
    );
  } finally {
    this.inFlightControllers.delete(call.callId);
  }
}
```

Route:

```
POST /api/mcp/cancel-call
  Body: { callId: string }
  → 204 (whether or not a controller existed)
```

The route looks up the controller via `dispatchService.getInFlightController(callId)` and calls `.abort()`. Idempotent.

## Progress + reasoning trace

The dispatch's `onProgress` callback emits `tool_call_progress` SSE events AND updates the local `progressNote` field that will eventually be written into the tool_call reasoning step at the end of the call (before `tracer.pushExternal`). The FE listens for both events:

- `tool_call_progress` → updates `useMcpStore.inFlightCalls[callId].progressNote`; the live banner reflects it
- `reasoning_step` of type `tool_call` (existing) → the final step carries the LAST `progressNote`, persisted in chat history

`ReasoningStepCard` renders `step.toolCall.progressNote` if present, as italic text above the args panel.

## Frontend banner

```tsx
// src/components/chat/ToolCallBanner.tsx
export function ToolCallBanner() {
  const inFlight = useMcpStore((s) => Object.values(s.inFlightCalls));
  if (inFlight.length === 0) return null;
  return (
    <div className="absolute bottom-16 left-0 right-0 mx-auto max-w-2xl flex flex-col gap-1 px-3">
      {inFlight.map((call) => (
        <div
          key={call.callId}
          className="flex items-center justify-between p-2 rounded bg-surface-2 border border-accent/40 text-[10px] font-mono"
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

## Refresh button in `McpServersSection`

A small `↻` button between the Disconnect button and the status dot when the server is online. Click calls `useMcpStore.refreshServer(id)` and renders a brief spin animation while pending.

When state is `reconnecting`, the connect/disconnect button area shows `reconnecting (3/5)` instead of the action buttons. User can click the status dot or a dedicated `Cancel` link to abort reconnect (calls `disconnect`).

## Error handling

Already enumerated in Section 4 of brainstorming. The key points:
- Unreachable HTTP server → `state: 'error'`, sidebar error pill
- Backoff exhaustion → `state: 'error'`, message "Reconnect failed after 5 attempts"
- Cancel mid-call → standard `{ ok: false, error: 'Cancelled by user' }`
- Cancel after call finished → 204 no-op
- Refresh on disconnected server → 409
- Malformed progress notification → skip with warning, don't crash

## Persistence

- `inFlightCalls` lives only in the FE store; cleared on disconnect/refresh/server-restart.
- `reconnectAttempt` lives only in the registry; reset on `'online'` or `'offline'`.
- `progressNote` is persisted as part of the tool_call reasoning step in chat history (so reopening a session still shows the last note that came in during that call).
- No new server-side persistence.

## Testing

(Reproduced from brainstorming Section 4.)

### Backend unit (Vitest)
- `http-connection.test.ts` (new) — ~10 cases including initialize, listTools, callTool with/without signal, onProgress, error paths, onUnexpectedClose.
- `stdio-connection.test.ts` (extend) — 3 new cases: signal abort, onProgress, onUnexpectedClose.
- `mock-connection.test.ts` (extend) — 1 case: pre-aborted signal.
- `registry.test.ts` (extend) — 5 new cases: refreshTools (happy + offline), cancelToolCall, reconnect happy, reconnect exhaustion.

### Backend integration (supertest)
- `mcp.routes.test.ts` (extend) — 2 cases: refresh-tools + cancel-call.
- `dispatch.routes.test.ts` (extend) — 2 cases: tool_call_started + tool_call_progress events, and cancel-mid-call.

### Frontend (Vitest + RTL + MSW)
- `mcp.api.test.ts` (extend) — `refreshTools` + `cancelCall`.
- `mcp.store.test.ts` (extend) — `refreshServer`, in-flight management.
- `ToolCallBanner.test.tsx` (new) — visibility + Cancel click.
- `McpServersSection.test.tsx` (extend) — refresh button + reconnecting badge.
- `ReasoningStepCard.test.tsx` (extend) — progressNote rendering.

### Integration (RTL + MSW)
- `mcp-advanced.integration.test.tsx` (new) — progress + cancel + refresh end-to-end against MSW.

### E2E (Playwright)
- One test: connect mock, send chat that triggers a tool call, Cancel via banner, assert reasoning step shows "Cancelled by user".

### Coverage target (≥80%)
- `http-connection.ts`
- New methods on `registry.ts` (refreshTools, cancelToolCall, reconnect)
- `ToolCallBanner.tsx`
- New methods on `src/stores/mcp.store.ts`

## Risks

| Risk | Mitigation |
|---|---|
| HTTP+SSE servers in the wild use different framing | We follow the published MCP spec; if a server diverges, the user gets a clear "invalid response" error — they switch transports or fix the server |
| Cancellation requires server cooperation | We send `notifications/cancelled` (per spec) AND drop the client-side pending promise. The local-side cleanup is unconditional; server-side cleanup is best-effort |
| Progress notification storms (many per second) | Each event updates a single field; React reconciliation is cheap. If observed, the FE could debounce — out of scope for slice 10 |
| Reconnect during a session in flight | The in-flight tool call rejects (connection dropped) → standard `{ ok: false, error: '…' }`. Reconnect attempts happen in parallel; new calls wait for `online` state |
| The MAX_RECONNECT_ATTEMPTS = 5 hardcode | Acceptable for slice 10. Future slice can expose it as env var if needed |
| HTTP transport opens a long-lived SSE stream that blocks app exit | The registry's `close()` aborts the stream controller during shutdown. We rely on the SDK + Node's standard SIGTERM teardown |

## Definition of Done

- All new BE + FE unit / component / integration tests green.
- `e2e/smoke.spec.ts` gains 1 test; total 14.
- `npm run lint` clean.
- Coverage ≥80% on the new files listed above.
- Manual smoke (`npm run dev`):
  - Configure a mock MCP server, Connect → tools listed → click ↻ Refresh → tools list re-fetched.
  - Send a chat that triggers a tool call → Banner appears → Cancel button works → "Cancelled by user" surfaces in the reasoning drawer.
  - (Manually) configure a stdio MCP server, kill the subprocess externally → sidebar shows `reconnecting (1/5)` → after backoff, server returns to online.
- One PR on `feat/slice-10-mcp-advanced` against `main`.
