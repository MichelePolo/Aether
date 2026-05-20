# Aether — Slice 7: MCP Mock + Real Stdio Client + Tool Call Loop (Design)

**Branch:** `feat/slice-7-mcp`
**Date:** 2026-05-20
**Depends on:** slices 0–6.

## Goal

Make Aether genuinely useful with MCP. Ship two transports (`mock`, `stdio`), a registry that owns live connections, a function-calling loop in `dispatch.service` that lets the model call discovered tools, an inline UI in `McpServersSection` for connect/disconnect + per-tool `autoApprove` policy, and a `ToolCallDialog` for manual approvals. The `gemini.provider` and `FakeProvider` both gain function-calling support so the loop is exercised end-to-end.

## Non-goals

- HTTP / SSE MCP transports. `stdio` + built-in mock are enough for slice 7. HTTP can be added later through the same `McpConnection` interface.
- Auto-reconnect on subprocess crash. The user sees the dead state and clicks Connect to retry.
- Auto-discovery refresh while a server is connected. Tools are fetched once on `connect`; the user can disconnect/reconnect to refresh.
- Streaming partial results from a tool call. Tool calls return a single value (the MCP protocol does support progress; we ignore it in slice 7).
- Tool-call cancellation by the user during execution. The 30s timeout is the only abort path.
- A separate `/api/mcp-servers` CRUD. MCP server configs live inside `AetherContext.mcpServers` (slice 1) and are mutated through the existing `/api/context/mcp-servers` endpoints, which we extend to accept the new `transport`/`command`/`args` fields.
- Function calling for Ollama. Slice 8 covers Ollama and will plug into the same registry/loop.

## Decisions log

| # | Decision | Chosen | Rationale |
|---|---|---|---|
| 1 | Scope | Mock + real stdio MCP client | Stdio covers the vast majority of MCP servers in the wild; mock keeps tests deterministic |
| 2 | Tool call loop | Full function-calling | Anything less leaves slice 7 half-finished — discovery without execution is dead code |
| 3 | Lifecycle | Manual Connect / Disconnect per server | User wants explicit control over which subprocesses are alive |
| 4 | Approval | Per-tool `autoApprove` policy, default `false` except for pure mock tools | Matches Claude Desktop / Continue.dev convention |
| 5 | UI | Inline expansion of `McpServersSection` (no separate view) | Mental model: server contains tools |
| 6 | Tool naming | Forced `<serverName>.<toolName>` namespace | No collisions; clarity for the model |
| 7 | Pending-decision wait | Promise-correlated by `callId` + dedicated `POST /api/mcp/decision` route | Avoids client-side timing race; integrates cleanly with `useDialog` |
| 8 | Reasoning trace | New `tool_call` step type with structured `toolCall` field on `ReasoningStep` | Tool calls deserve a distinct visualization in `ReasoningStepCard` |
| 9 | McpServerConfig migration | zod default `transport: 'stdio'` + existing `url` becomes display-only | Avoids breaking slice-1 stored data |
| 10 | Tool policies persistence | `toolPolicies` field on `McpServerConfig` (in `context.json`) | Survives restarts naturally; no new store needed |
| 11 | Crash policy | No auto-restart; transition to `'offline'`, emit SSE state event | YAGNI — user can reconnect manually |
| 12 | Tool call execution timeout | 30s on `tools/call`; 60s on decision wait | Conservative defaults; configurable in a follow-up |
| 13 | Mock tools shipped | `echo`, `current_time`, `read_file_mock` — all `autoApprove: true` | Pure / no side effects; useful for dev and E2E |

## Architecture

### Library

`@modelcontextprotocol/sdk` exists in the npm ecosystem and would save work — **but** it pulls in a large transport abstraction we don't need. Slice 7 implements a minimal MCP client in-house (~150 lines of stdio framing + JSON-RPC correlation). If/when we need HTTP transport, we revisit the SDK call.

### Backend (`server/`)

| Path | Role |
|---|---|
| `domain/mcp/mcp.types.ts` | `McpTool`, `McpToolCall`, `McpToolResult`, `McpTransport`, `McpConnectionState`, `McpToolPolicy` |
| `domain/mcp/mcp.schema.ts` | zod schemas (validation of tools/list / tools/call payloads + per-tool policy) |
| `domain/mcp/connection.types.ts` | `interface McpConnection { state, initialize(), listTools(), callTool(name, args), close() }` + per-connection `defaultAutoApprove: boolean` flag (mock=`true`, stdio=`false`) |
| `domain/mcp/mock-connection.ts` | In-process implementation with hardcoded `echo`, `current_time`, `read_file_mock` |
| `domain/mcp/mock-connection.test.ts` | Unit tests |
| `domain/mcp/stdio-connection.ts` | `child_process.spawn` + line-delimited JSON-RPC + id correlation |
| `domain/mcp/stdio-connection.test.ts` | Unit tests against a fixture echo-server.js |
| `domain/mcp/__fixtures__/echo-server.js` | Tiny Node script speaking MCP over stdio, used in tests |
| `domain/mcp/registry.ts` | `McpRegistry` owning per-server connections + decision-promise map |
| `domain/mcp/registry.test.ts` | Unit tests |
| `routes/mcp.routes.ts` | `POST /api/mcp/:id/connect`, `POST /api/mcp/:id/disconnect`, `GET /api/mcp/tools`, `PATCH /api/mcp/:id/tools/:name`, `POST /api/mcp/decision` |
| `routes/mcp.routes.test.ts` | Supertest |
| `domain/context/context.types.ts` | **Modify**: `McpServerConfig` gains `transport`, `command?`, `args?`, `env?`, `toolPolicies?` |
| `domain/context/context.schema.ts` | **Modify**: discriminated union by `transport`; defaults |
| `domain/dispatch/dispatch.service.ts` | **Modify**: gains `mcpRegistry` dep; runs function-call loop in dispatch step |
| `domain/dispatch/prompt-assembler.ts` | **Modify** (small): accepts list of MCP tools, returns them in `AssembledPrompt.mcpTools` for the provider to convert |
| `domain/dispatch/providers/provider.types.ts` | **Modify**: `ProviderRequest` gains `mcpTools?: McpTool[]`; provider chunk types add `function_call` |
| `domain/dispatch/providers/gemini.provider.ts` | **Modify**: pass tools as function declarations; emit `function_call` chunk on response |
| `domain/dispatch/providers/fake.provider.ts` | **Modify**: optionally emit a programmed `function_call` chunk for test scenarios |
| `domain/reasoning/reasoning.types.ts` | **Modify**: add `'tool_call'` to `ReasoningStepType`; add optional `toolCall?: { qualifiedName, args, result?, error?, durationMs }` field |
| `domain/reasoning/reasoning.schema.ts` | **Modify**: enum + optional field |
| `domain/reasoning/reasoning.tracer.ts` | **Modify**: forward `toolCall` from the `run()` return |
| `app.ts` | **Modify**: `AppDeps` gains `mcpRegistry?`; mount `/api/mcp` routes when present |
| `index.ts` | **Modify**: instantiate `McpRegistry`, pass to `DispatchService` *and* `createApp` |

### Frontend (`src/`)

| Path | Role |
|---|---|
| `types/mcp.types.ts` | Re-export of `McpTool`, `McpToolCall`, `McpToolResult`, `McpConnectionState`, `McpToolPolicy` |
| `lib/api/mcp.api.ts` | REST client (`connect`, `disconnect`, `listTools`, `togglePolicy`, `decide`) |
| `lib/api/mcp.api.test.ts` | MSW tests |
| `stores/mcp.store.ts` | Zustand: `liveTools`, `connectStates`, `connect`, `disconnect`, `togglePolicy`, `error`, `_reset` |
| `stores/mcp.store.test.ts` | Unit tests |
| `test/msw-handlers.ts` | **Modify**: default MSW handlers for `/api/mcp/*` |
| `components/mcp/McpToolCard.tsx` | One row per discovered tool: name, description, autoApprove toggle |
| `components/mcp/McpToolCard.test.tsx` | Component tests |
| `components/chat/ToolCallDialog.tsx` | Render pending tool-call request, `Approve` / `Reject` / `Always approve` |
| `components/chat/ToolCallDialog.test.tsx` | Component tests |
| `hooks/useToolCallDecisions.ts` | Listens to SSE `tool_call_request` events, enqueues into `useDialog` when policy requires approval, POSTs decision |
| `hooks/useToolCallDecisions.test.ts` | Unit tests |
| `components/sidebar/McpServersSection.tsx` | **Modify**: Connect/Disconnect toggle, inline expansion with `<McpToolCard>` rows, error pill |
| `components/sidebar/McpServersSection.test.tsx` | **Modify**: new cases |
| `components/reasoning/ReasoningStepCard.tsx` | **Modify**: structured renderer for `tool_call` step (args panel + result/error panel) |
| `components/reasoning/ReasoningStepCard.test.tsx` | **Modify**: new tests |
| `hooks/useStreamingDispatch.ts` | **Modify**: handle new SSE events (`tool_call_request`, `tool_call_result`, `mcp:state_change`) |
| `App.tsx` | **Modify**: init `useMcpStore`, mount `useToolCallDecisions` |
| `App.test.tsx` | **Modify**: reset `useMcpStore` in `beforeEach` |
| `integration/mcp.integration.test.tsx` | App-level: connect mock + auto-approve flow + manual-approve flow |

### E2E

`e2e/smoke.spec.ts` gains one test: `mcp: connect mock + tool call`. Uses the built-in mock server, no subprocess; FakeProvider extended to emit a `function_call('mock.echo', {message: 'hi'})` chunk.

## Types

```ts
// server/domain/mcp/mcp.types.ts
export type McpTransport = 'stdio' | 'mock';

export interface McpToolSchema {
  type?: 'object';
  properties?: Record<string, unknown>;
  required?: string[];
  additionalProperties?: boolean;
}

export interface McpTool {
  /** Local name, e.g. "read_file". Qualified form is `<serverName>.<name>`. */
  name: string;
  description?: string;
  inputSchema: McpToolSchema;
}

export interface McpToolPolicy {
  autoApprove: boolean;
}

export interface McpToolCall {
  /** Stable per-dispatch id, used by the decision-wait promise map. */
  id: string;
  qualifiedName: string;
  args: Record<string, unknown>;
}

export type McpToolResult =
  | { ok: true; output: unknown }
  | { ok: false; error: string };

export type McpConnectionState = 'offline' | 'connecting' | 'online' | 'error';

export interface McpConnectionStateSnapshot {
  state: McpConnectionState;
  error?: string;
}
```

**Connection interface** (`server/domain/mcp/connection.types.ts`):

```ts
import type { McpTool, McpToolResult } from './mcp.types';

export interface McpConnection {
  /** Open the connection (spawn subprocess, send `initialize`). */
  initialize(): Promise<void>;

  /** Discover tools (`tools/list`). Must succeed before tools are exposed. */
  listTools(): Promise<McpTool[]>;

  /** Execute a tool (`tools/call`). Local name (without `<server>.` prefix). */
  callTool(name: string, args: Record<string, unknown>): Promise<McpToolResult>;

  /** Close subprocess / dispose resources. Idempotent. */
  close(): Promise<void>;
}
```

**McpServerConfig** (extension in `server/domain/context/context.types.ts`):

```ts
export interface McpServerConfig {
  id: string;
  name: string;
  transport: McpTransport;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  toolPolicies?: Record<string, McpToolPolicy>;
  status: 'online' | 'offline' | 'connecting' | 'error';
}
```

zod schema becomes a discriminated union on `transport`, with `transport` defaulting to `'stdio'` so slice-1 entries that lack the field continue to load.

## Mock connection

```ts
// server/domain/mcp/mock-connection.ts
import type { McpConnection } from './connection.types';
import type { McpTool, McpToolResult } from './mcp.types';

const MOCK_TOOLS: McpTool[] = [
  {
    name: 'echo',
    description: 'Returns the input message unchanged.',
    inputSchema: { type: 'object', properties: { message: { type: 'string' } }, required: ['message'] },
  },
  {
    name: 'current_time',
    description: 'Returns the current time as ISO + unix seconds.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'read_file_mock',
    description: 'Pretends to read a file; returns synthetic content.',
    inputSchema: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] },
  },
];

export class MockMcpConnection implements McpConnection {
  async initialize(): Promise<void> { /* no-op */ }
  async listTools(): Promise<McpTool[]> { return MOCK_TOOLS; }
  async callTool(name: string, args: Record<string, unknown>): Promise<McpToolResult> {
    switch (name) {
      case 'echo':         return { ok: true, output: { message: String(args.message ?? '') } };
      case 'current_time': return { ok: true, output: { iso: new Date().toISOString(), unix: Math.floor(Date.now() / 1000) } };
      case 'read_file_mock':
        return { ok: true, output: { content: `mocked content of ${String(args.path ?? '<no path>')}` } };
      default:             return { ok: false, error: `Unknown tool '${name}'` };
    }
  }
  async close(): Promise<void> { /* no-op */ }
}
```

## Stdio connection

`spawn(command, args, { env })` from `node:child_process`. Communicates with the subprocess via line-delimited JSON-RPC. Each outgoing request gets an incrementing `id`; an in-memory `Map<id, { resolve, reject, timeout }>` correlates responses. `stdout` is decoded line-by-line using a `LineReader` helper that buffers until `\n`. `stderr` is captured into a ring buffer (last 4 KiB) for inclusion in error messages.

```ts
// server/domain/mcp/stdio-connection.ts (abridged)
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';

interface StdioOpts {
  command: string;
  args: string[];
  env: Record<string, string>;
}

export class StdioMcpConnection implements McpConnection {
  private proc: ChildProcessWithoutNullStreams | null = null;
  private pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void; t: NodeJS.Timeout }>();
  private nextId = 1;

  constructor(private readonly opts: StdioOpts) {}

  async initialize(): Promise<void> {
    this.proc = spawn(this.opts.command, this.opts.args, {
      env: { ...process.env, ...this.opts.env },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    this.wireStdio();
    await this.rpc('initialize', {});
  }

  async listTools(): Promise<McpTool[]> {
    const res = await this.rpc('tools/list', {}) as { tools: McpTool[] };
    return res.tools ?? [];
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<McpToolResult> {
    try {
      const out = await this.rpc('tools/call', { name, arguments: args }, 30_000);
      return { ok: true, output: out };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : 'tool call failed' };
    }
  }

  async close(): Promise<void> {
    if (!this.proc) return;
    for (const { reject, t } of this.pending.values()) {
      clearTimeout(t);
      reject(new Error('connection closed'));
    }
    this.pending.clear();
    this.proc.kill('SIGTERM');
    await delay(50);
    if (!this.proc.killed) this.proc.kill('SIGKILL');
    this.proc = null;
  }

  // ... wireStdio() and rpc() omitted from the design; full code in plan.
}
```

## Registry

Owns connections + decision-promise map.

```ts
// server/domain/mcp/registry.ts (signature)
export class McpRegistry {
  constructor(private readonly contextStore: ContextStore) {}

  /** Connect a server by id (looks up config in context.mcpServers). */
  connect(id: string): Promise<{ tools: McpTool[] }>;
  disconnect(id: string): Promise<void>;

  /** Returns the union of live tools, fully namespaced (`<serverName>.<toolName>`). */
  listLiveTools(): Array<{ qualifiedName: string; serverId: string; tool: McpTool; autoApprove: boolean }>;

  /** Call a tool by qualified name; routes to the correct connection. */
  callTool(qualifiedName: string, args: Record<string, unknown>): Promise<McpToolResult>;

  /** Look up policy for a qualified tool name. Resolution order:
   *  1. Persisted `McpServerConfig.toolPolicies[localName]` from `context.json`
   *  2. The connection's own builtin default (mock → `true`, stdio → `false`)
   *  3. Hard fallback: `autoApprove: false`
   *  The user can always override via `PATCH /api/mcp/:id/tools/:name`. */
  policy(qualifiedName: string): McpToolPolicy;

  /** Register a pending decision; returns a Promise that resolves when POST /decision arrives. */
  awaitDecision(callId: string, timeoutMs?: number): Promise<'approve' | 'reject'>;
  resolveDecision(callId: string, decision: 'approve' | 'reject'): void;

  /** Get the live state snapshot of a server (for /api/mcp/state). */
  stateOf(id: string): McpConnectionStateSnapshot;
}
```

## Dispatch loop

Inside `dispatch.service.handle`, after `resolve_subagent` (slice 6) and before the existing dispatch step:

```ts
const liveTools = mcpRegistry?.listLiveTools() ?? [];
// (Existing) assemble + dispatch step:
const assembled = assemble(context, matchedSubAgent, parsed.stripped, parsed.name);

// The dispatch step now runs a function-call loop:
await tracer.step({
  type: 'dispatch',
  title: ...,
  run: async () => {
    let pending = await provider.stream({
      ...assembled,
      mcpTools: liveTools.map((t) => ({ qualifiedName: t.qualifiedName, schema: t.tool.inputSchema, description: t.tool.description })),
    }, signal);
    // pending is an async iterator; loop, dispatching tool-calls as they arrive.
    while (true) {
      const result = await iterateUntilFunctionCallOrDone(pending);
      if (result.kind === 'done') break;
      // function_call branch:
      const call = result.call;
      sse.event('tool_call_request', call);
      const policy = mcpRegistry.policy(call.qualifiedName);
      const decision = policy.autoApprove
        ? 'approve'
        : await mcpRegistry.awaitDecision(call.id, 60_000).catch(() => 'reject' as const);
      let toolResult: McpToolResult;
      if (decision === 'reject') {
        toolResult = { ok: false, error: 'Rejected by user' };
      } else {
        toolResult = await mcpRegistry.callTool(call.qualifiedName, call.args);
      }
      sse.event('tool_call_result', { id: call.id, ...toolResult });
      tracer.pushExternal({
        type: 'tool_call',
        title: `Tool: ${call.qualifiedName}`,
        content: summarize(call, toolResult),
        toolCall: { ...call, ...toolResult, durationMs: ... },
      });
      pending = await provider.continue(toolResult);
    }
    return { content: ..., result: null };
  },
});
```

The exact provider interface for `continue(toolResult)` is detailed in the plan; it maps to Gemini's "send tool result, get next chunks" SDK call.

## Routes

```
POST   /api/mcp/:id/connect          → { state: 'online', tools: McpTool[] } | error
POST   /api/mcp/:id/disconnect       → 204
GET    /api/mcp/tools                → { tools: Array<{ qualifiedName, serverId, ...McpTool, autoApprove }> }
PATCH  /api/mcp/:id/tools/:name      → { autoApprove: boolean }  (body: { autoApprove })
POST   /api/mcp/decision             → 204  (body: { callId, action: 'approve' | 'reject' })
GET    /api/mcp/state                → { servers: Array<{ id, state, error? }> }
```

400 on validation, 404 on unknown id, 500 on registry IO. No bulk endpoints.

## Frontend wiring

`useMcpStore` mirrors `useSubAgentsStore` in shape. `useToolCallDecisions` is mounted once in `App.tsx` and subscribes to the SSE stream — when `tool_call_request` arrives:
- If `liveTools` says `autoApprove: true`: do nothing (server already auto-approves).
- Else: open `ToolCallDialog` via `useDialog.confirm({ destructive: false, message: <tool details> })`. On confirm/reject, POST `/api/mcp/decision`.

`ToolCallDialog` is wired through the existing `DialogHost` queue (slice 0). It renders args + a "Always approve this tool" checkbox; checking it calls `mcp.togglePolicy` before resolving.

## Reasoning trace

`ReasoningStepType` gains `'tool_call'`. `ReasoningStep` gains an optional `toolCall?: { qualifiedName: string; args: Record<string, unknown>; result?: unknown; error?: string; durationMs: number }`. `ReasoningStepCard` adds a renderer for that type: collapsible args block + result/error block, with appropriate colors (amber for pending, green ok, red error).

## Error handling

Already enumerated in Section 4 of the brainstorming. Summary table in spec form:

| Source | Behaviour |
|---|---|
| spawn fails | `state: 'error'`, error captured, sidebar pill |
| `initialize` times out (5s) | Kill subprocess, `state: 'error'` |
| `tools/list` fails | `state: 'error'`, subprocess kept alive briefly |
| Subprocess exits unexpectedly | `state: 'offline'`, no auto-restart, SSE state event |
| Tool call: server offline | `{ ok: false, error: 'Server <name> is offline' }`; loop continues |
| Tool call: JSON-RPC error | `{ ok: false, error: <server msg> }` |
| Tool call: user reject | `{ ok: false, error: 'Rejected by user' }` |
| Tool call: 60s decision timeout | Default reject |
| Tool call: 30s execution timeout | `{ ok: false, error: 'Tool call timeout' }` |
| Schema mismatch on `tools/list` | Connection rejected, `state: 'error'` |
| User disconnects mid-stream | Pending decisions reject; dispatch records partial state |

## Persistence

- `context.mcpServers[].transport`, `command`, `args`, `env`, `toolPolicies` — all in `context.json` via `ContextStore`. No new store.
- Live connection state lives only in memory in the registry.
- `toolPolicies` survive restarts but require explicit user toggle from `McpToolCard`.

## Testing

(Enumerated in Section 4 of brainstorming; full list reproduced below.)

### Backend unit (Vitest)
- `mock-connection.test.ts` — list + each tool + unknown.
- `stdio-connection.test.ts` — fixture echo-server.js; spawn/initialize/list/call/exit/crash.
- `registry.test.ts` — connect mock + stdio, listLiveTools namespacing, callTool routing, server offline path, awaitDecision/resolveDecision happy + timeout.
- `mcp.schema.test.ts` — discriminated union, defaults, migration from legacy entries.
- `dispatch.service.test.ts` (extend) — tool-call loop scenarios.
- `prompt-assembler.test.ts` (extend) — `mcpTools` passed through unchanged.
- `gemini.provider.test.ts` (extend) — function declarations → emitted on response.
- `fake.provider.test.ts` (extend) — programmed `function_call` chunk emission.

### Backend integration (supertest)
- `mcp.routes.test.ts` — connect/disconnect/list/togglePolicy/decision/state.
- `dispatch.routes.test.ts` (extend) — end-to-end SSE with `tool_call_request` + `tool_call_result`.

### Frontend unit (Vitest + MSW)
- `mcp.api.test.ts` — round-trip each route.
- `mcp.store.test.ts` — connect/disconnect/togglePolicy + error.
- `useToolCallDecisions.test.ts` — auto-approve path no-op; manual path opens dialog and POSTs.

### Frontend component (RTL + user-event)
- `McpToolCard.test.tsx`, `ToolCallDialog.test.tsx`, `McpServersSection.test.tsx` (extend), `ReasoningStepCard.test.tsx` (extend).

### Integration (RTL + MSW)
- `mcp.integration.test.tsx` — connect mock + auto-approve + manual-approve.

### E2E (Playwright)
- `mcp: connect mock + tool call` (single test, no subprocess).

### Coverage
≥80% on `registry.ts`, `mock-connection.ts`, `stdio-connection.ts`, `mcp.routes.ts`, `mcp.store.ts`, `McpServersSection.tsx`, `ToolCallDialog.tsx`, `useToolCallDecisions.ts`.

## Risks

| Risk | Mitigation |
|---|---|
| Stdio JSON-RPC framing bugs (partial lines, large payloads) | Dedicated `LineReader` helper with explicit tests; fixture echo-server triggers >4 KiB payloads |
| Gemini SDK function-calling API mismatch with our `McpTool` schema | Conversion layer in `gemini.provider.ts` validates with zod before forwarding; unit tests cover schema shapes |
| Subprocess hangs on close | `close()` sends SIGTERM, waits 50ms, escalates to SIGKILL |
| Tool call loop infinite | Hard cap of 10 sequential tool calls per dispatch; 11th returns an error to the model. (Constant `MAX_TOOL_CALLS_PER_DISPATCH = 10`) |
| User clicks Disconnect while a tool call is pending | Pending decision promise rejects; dispatch step records 'connection closed' error |
| Function call args fail schema validation | `{ ok: false, error: 'Invalid arguments: <details>' }` — model can retry |
| Per-test Playwright requires a real MCP subprocess | The E2E test uses the built-in mock transport; no subprocess needed |

## Cross-cutting changes (size estimate)

- New backend modules: ~6 files, ~600 lines.
- Backend modifications: `dispatch.service.ts` (~80 new lines), `gemini.provider.ts` (~50), `fake.provider.ts` (~30), `prompt-assembler.ts` (~10), `reasoning.types.ts` / schema / tracer (~10 each), `context.types.ts` / schema (~20), `app.ts` / `index.ts` (~10).
- New frontend modules: ~6 files, ~400 lines.
- Frontend modifications: `McpServersSection.tsx` (~80 new lines), `ReasoningStepCard.tsx` (~30), `useStreamingDispatch.ts` (~40).
- Tests: substantial — ~25 new test files, comparable to slice 6.

This is the biggest slice so far. Worth planning at the same granularity as slice 6 (15+ tasks).

## Definition of Done

- All new BE + FE unit / component / integration tests green.
- `e2e/smoke.spec.ts` has 10 tests (9 existing + 1 new mock-MCP).
- `npm run lint` clean.
- Coverage ≥80% on the new files listed above.
- Manual smoke via `npm run dev`: configure a stdio MCP server (e.g. `npx @modelcontextprotocol/server-filesystem /tmp`) in the sidebar, click Connect, see tools listed, send a chat that triggers a call, see the ToolCallDialog (or auto-approve), get a result back, see the reasoning step.
- One PR on `feat/slice-7-mcp` against `main`.
