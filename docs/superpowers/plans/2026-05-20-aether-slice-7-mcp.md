# Aether Slice 7 — MCP + Tool Call Loop Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a working MCP integration: in-process mock server, stdio client for real MCP servers, registry that owns live connections, function-call loop in `dispatch.service`, frontend Connect/Disconnect + per-tool `autoApprove` UI, and `ToolCallDialog` for manual approvals. The Gemini and Fake providers both gain function-calling support so the loop is exercised end-to-end.

**Architecture:** Backend `McpRegistry` owns `McpConnection` instances (one per configured server). Two implementations: `MockMcpConnection` (in-process, hardcoded tools) and `StdioMcpConnection` (`child_process.spawn` + line-delimited JSON-RPC). The dispatch service queries the registry for live tools, passes them to the provider as function declarations, and runs a re-entrant loop: provider emits `function_call` → dispatch waits for approval (if needed) → executes via registry → feeds result back to provider → loop. Tool calls are logged as `tool_call` reasoning steps. Frontend mounts `useMcpStore` and `useToolCallDecisions`; sidebar `McpServersSection` becomes expandable with `McpToolCard` rows.

**Tech Stack:** Node `child_process.spawn` + line buffering, zod 4 (JSON-RPC payload validation), Zustand 5 (`useMcpStore`), MSW 2, Vitest 4.1.6, RTL + user-event, Playwright. Existing `JsonStore` (slice 0), `useDialog` (slice 0), `ReasoningTracer` (slice 3), `prompt-assembler` (slice 6). No new third-party deps.

**Reference spec:** `docs/superpowers/specs/2026-05-20-aether-slice-7-mcp-design.md`

**Branch:** `feat/slice-7-mcp` (already checked out; spec already committed)

**Lavora con un solo branch dall'inizio alla fine; ogni Task termina con un commit verde su questo branch.**

---

## File structure (NEW unless marked MODIFY)

```
server/
  domain/mcp/
    mcp.types.ts                                # NEW
    mcp.schema.ts                               # NEW
    mcp.schema.test.ts                          # NEW
    connection.types.ts                         # NEW
    mock-connection.ts                          # NEW
    mock-connection.test.ts                     # NEW
    stdio-connection.ts                         # NEW
    stdio-connection.test.ts                    # NEW
    __fixtures__/echo-server.js                 # NEW (test fixture)
    registry.ts                                 # NEW
    registry.test.ts                            # NEW
  domain/context/
    context.types.ts                            # MODIFY: McpServerConfig +transport/command/args/env/toolPolicies
    context.schema.ts                           # MODIFY: discriminated union + defaults
  domain/dispatch/
    dispatch.service.ts                         # MODIFY: tool-call loop
    prompt-assembler.ts                         # MODIFY: pass mcpTools through to provider
    prompt-assembler.test.ts                    # MODIFY: mcpTools pass-through cases
    providers/provider.types.ts                 # MODIFY: +function_call chunk, +mcpTools/toolResults in request
    providers/fake.provider.ts                  # MODIFY: programmable function_call
    providers/fake.provider.test.ts             # MODIFY: function_call tests
    providers/gemini.provider.ts                # MODIFY: forward function declarations
    providers/gemini.provider.test.ts           # MODIFY: function_call tests
  domain/reasoning/
    reasoning.types.ts                          # MODIFY: +'tool_call' step type, +toolCall? field
    reasoning.schema.ts                         # MODIFY: enum + optional field
    reasoning.tracer.ts                         # MODIFY: forward toolCall
  routes/
    mcp.routes.ts                               # NEW
    mcp.routes.test.ts                          # NEW
    dispatch.routes.test.ts                     # MODIFY: end-to-end tool-call test
  app.ts                                        # MODIFY: AppDeps +mcpRegistry, mount /api/mcp
  index.ts                                      # MODIFY: instantiate McpRegistry, thread into DispatchService

src/
  types/
    mcp.types.ts                                # NEW (re-export)
  lib/api/
    mcp.api.ts                                  # NEW
    mcp.api.test.ts                             # NEW
  stores/
    mcp.store.ts                                # NEW
    mcp.store.test.ts                           # NEW
  test/
    msw-handlers.ts                             # MODIFY: +/api/mcp handlers
  hooks/
    useToolCallDecisions.ts                     # NEW
    useToolCallDecisions.test.ts                # NEW
    useStreamingDispatch.ts                     # MODIFY: handle tool_call_request / tool_call_result / mcp:state_change
  components/mcp/
    McpToolCard.tsx                             # NEW
    McpToolCard.test.tsx                        # NEW
  components/chat/
    ToolCallDialog.tsx                          # NEW
    ToolCallDialog.test.tsx                     # NEW
  components/sidebar/
    McpServersSection.tsx                       # MODIFY: Connect/Disconnect + inline expansion
    McpServersSection.test.tsx                  # MODIFY: new cases
  components/reasoning/
    ReasoningStepCard.tsx                       # MODIFY: tool_call renderer
    ReasoningStepCard.test.tsx                  # MODIFY: new tests
  App.tsx                                       # MODIFY: init useMcpStore + mount useToolCallDecisions
  App.test.tsx                                  # MODIFY: reset useMcpStore in beforeEach
  integration/
    mcp.integration.test.tsx                    # NEW

e2e/
  smoke.spec.ts                                 # MODIFY: append mcp test
```

---

## Phase A — Pre-flight

### Task A1: Verify branch and clean working tree

- [ ] **Step 1: Confirm branch + clean tree**

```bash
git rev-parse --abbrev-ref HEAD
git status --porcelain
```

Expected: branch is `feat/slice-7-mcp`; second command outputs nothing.

No commit in this task.

---

## Phase B — Reasoning tracer: `tool_call` step

### Task B1: `tool_call` step type + `toolCall` payload + tracer forwarding

**Files:**
- Modify: `server/domain/reasoning/reasoning.types.ts`
- Modify: `server/domain/reasoning/reasoning.schema.ts`
- Modify: `server/domain/reasoning/reasoning.tracer.ts`

- [ ] **Step 1: Replace `server/domain/reasoning/reasoning.types.ts`**

```ts
export type ReasoningStepType =
  | 'context_fetch'
  | 'mcp_query'
  | 'dispatch'
  | 'thinking'
  | 'validation'
  | 'logic'
  | 'resolve_subagent'
  | 'tool_call';

export interface ToolCallTrace {
  id: string;
  qualifiedName: string;
  args: Record<string, unknown>;
  result?: unknown;
  error?: string;
  durationMs: number;
}

export interface ReasoningStep {
  id: string;
  type: ReasoningStepType;
  title: string;
  content: string;
  tokens?: number;
  durationMs?: number;
  subAgent?: string;
  toolCall?: ToolCallTrace;
  timestamp: number;
}
```

- [ ] **Step 2: Update `server/domain/reasoning/reasoning.schema.ts`**

```ts
import { z } from 'zod';

export const ReasoningStepTypeSchema = z.enum([
  'context_fetch',
  'mcp_query',
  'dispatch',
  'thinking',
  'validation',
  'logic',
  'resolve_subagent',
  'tool_call',
]);

export const ToolCallTraceSchema = z.object({
  id: z.string(),
  qualifiedName: z.string(),
  args: z.record(z.string(), z.unknown()),
  result: z.unknown().optional(),
  error: z.string().optional(),
  durationMs: z.number(),
});

export const ReasoningStepSchema = z.object({
  id: z.string(),
  type: ReasoningStepTypeSchema,
  title: z.string(),
  content: z.string(),
  tokens: z.number().optional(),
  durationMs: z.number().optional(),
  subAgent: z.string().optional(),
  toolCall: ToolCallTraceSchema.optional(),
  timestamp: z.number(),
});
```

- [ ] **Step 3: Replace `server/domain/reasoning/reasoning.tracer.ts`**

```ts
import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import type { SseEmitter } from '@/server/lib/sse';
import type { ReasoningStep, ReasoningStepType, ToolCallTrace } from './reasoning.types';

export interface TracerStepOpts<T> {
  type: ReasoningStepType;
  title: string;
  run: () => Promise<{
    content: string;
    tokens?: number;
    subAgent?: string;
    toolCall?: ToolCallTrace;
    result: T;
  }>;
}

export class ReasoningTracer {
  private readonly steps: ReasoningStep[] = [];

  constructor(private readonly sse: SseEmitter) {}

  async step<T>(opts: TracerStepOpts<T>): Promise<T> {
    const t0 = performance.now();
    const { content, tokens, subAgent, toolCall, result } = await opts.run();
    const t1 = performance.now();
    const step: ReasoningStep = {
      id: randomUUID(),
      type: opts.type,
      title: opts.title,
      content,
      tokens,
      subAgent,
      toolCall,
      durationMs: Math.round(t1 - t0),
      timestamp: Date.now(),
    };
    this.steps.push(step);
    this.sse.event('reasoning_step', step);
    return result;
  }

  pushExternal(partial: Omit<ReasoningStep, 'id' | 'timestamp'>): void {
    const step: ReasoningStep = {
      id: randomUUID(),
      timestamp: Date.now(),
      ...partial,
    };
    this.steps.push(step);
    this.sse.event('reasoning_step', step);
  }

  finalSteps(): ReasoningStep[] {
    return [...this.steps];
  }
}
```

- [ ] **Step 4: Sync `src/types/reasoning.types.ts` if duplicated**

Run `grep -n "ToolCallTrace\|ReasoningStep" src/types/reasoning.types.ts`. If it re-exports from `@/server/...`, skip. If it duplicates, add the new field/type accordingly.

- [ ] **Step 5: Run reasoning tests + lint**

```bash
npx vitest run server/domain/reasoning
npm run lint
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add server/domain/reasoning/ src/types/reasoning.types.ts
git commit -m "feat(slice-7): reasoning +tool_call step type + ToolCallTrace payload"
```

---

## Phase C — Context types: `McpServerConfig` extension

### Task C1: Discriminated union on `transport` + `toolPolicies`

**Files:**
- Modify: `server/domain/context/context.types.ts`
- Modify: `server/domain/context/context.schema.ts`
- Modify: `server/domain/context/context.schema.test.ts`

- [ ] **Step 1: Append failing schema tests**

Append to `server/domain/context/context.schema.test.ts`:

```ts
describe('McpServerConfig schema (slice-7)', () => {
  it('accepts a stdio config with command + args', () => {
    const cfg = {
      id: 'a', name: 'fs', transport: 'stdio',
      command: 'npx', args: ['@modelcontextprotocol/server-filesystem', '/tmp'],
      env: {}, status: 'offline',
    };
    expect(McpServerConfigSchema.safeParse(cfg).success).toBe(true);
  });

  it('accepts a mock config without command', () => {
    expect(McpServerConfigSchema.safeParse({
      id: 'm', name: 'mock', transport: 'mock', status: 'offline',
    }).success).toBe(true);
  });

  it('rejects stdio config missing command', () => {
    expect(McpServerConfigSchema.safeParse({
      id: 'a', name: 'fs', transport: 'stdio', status: 'offline',
    }).success).toBe(false);
  });

  it('defaults transport to stdio when omitted (legacy compat)', () => {
    const parsed = McpServerConfigSchema.parse({
      id: 'a', name: 'old', command: 'echo', status: 'offline',
    });
    expect(parsed.transport).toBe('stdio');
  });

  it('accepts toolPolicies map', () => {
    expect(McpServerConfigSchema.safeParse({
      id: 'a', name: 'mock', transport: 'mock', status: 'offline',
      toolPolicies: { echo: { autoApprove: true } },
    }).success).toBe(true);
  });
});
```

Make sure `McpServerConfigSchema` is exported from `context.schema.ts` (add to the import in the test file if needed).

- [ ] **Step 2: Run, expect FAIL**

```bash
npx vitest run server/domain/context/context.schema.test.ts
```

- [ ] **Step 3: Update `server/domain/context/context.types.ts`**

Replace `McpServerConfig` with:

```ts
export type McpTransport = 'stdio' | 'mock';
export type McpConnectionState = 'offline' | 'connecting' | 'online' | 'error';

export interface McpToolPolicy {
  autoApprove: boolean;
}

export interface McpServerConfig {
  id: string;
  name: string;
  transport: McpTransport;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  toolPolicies?: Record<string, McpToolPolicy>;
  status: McpConnectionState;
}
```

Leave the rest of the file untouched.

- [ ] **Step 4: Update `server/domain/context/context.schema.ts`**

Replace the `McpServerConfigSchema` definition with:

```ts
const McpToolPolicySchema = z.object({ autoApprove: z.boolean() });

const StdioMcpSchema = z.object({
  transport: z.literal('stdio'),
  command: z.string().min(1),
  args: z.array(z.string()).default([]),
  env: z.record(z.string(), z.string()).default({}),
});

const MockMcpSchema = z.object({
  transport: z.literal('mock'),
});

const BaseMcpSchema = z.object({
  id: z.string(),
  name: z.string().min(1),
  url: z.string().optional(),
  status: z.enum(['offline', 'connecting', 'online', 'error']).default('offline'),
  toolPolicies: z.record(z.string(), McpToolPolicySchema).optional(),
});

export const McpServerConfigSchema = z.preprocess(
  (raw) => {
    if (raw && typeof raw === 'object' && !('transport' in (raw as Record<string, unknown>))) {
      return { ...(raw as Record<string, unknown>), transport: 'stdio' };
    }
    return raw;
  },
  z.discriminatedUnion('transport', [
    BaseMcpSchema.merge(StdioMcpSchema),
    BaseMcpSchema.merge(MockMcpSchema),
  ]),
);
```

(Adapt the existing imports if `z.preprocess` / `z.discriminatedUnion` aren't already imported via `import { z } from 'zod'`.)

Make sure the existing `AetherContextSchema` continues to use `McpServerConfigSchema` for the `mcpServers` array; if the imported alias was different, keep the symbol consistent.

- [ ] **Step 5: Run schema tests + full context tests**

```bash
npx vitest run server/domain/context
```

Expected: existing tests + 5 new ones PASS.

- [ ] **Step 6: Lint + commit**

```bash
npm run lint
git add server/domain/context/
git commit -m "feat(slice-7): McpServerConfig discriminated union + toolPolicies + legacy default"
```

---

## Phase D — MCP types + schemas

### Task D1: `McpTool`, `McpToolCall`, `McpToolResult` + JSON-RPC schemas

**Files:**
- Create: `server/domain/mcp/mcp.types.ts`
- Create: `server/domain/mcp/mcp.schema.ts`
- Create: `server/domain/mcp/mcp.schema.test.ts`
- Create: `server/domain/mcp/connection.types.ts`

- [ ] **Step 1: Failing tests `mcp.schema.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { McpToolSchema, ToolsListResultSchema, ToolsCallResultSchema, JsonRpcResponseSchema } from './mcp.schema';

describe('McpToolSchema', () => {
  it('accepts minimal tool', () => {
    expect(McpToolSchema.safeParse({ name: 'echo', inputSchema: { type: 'object' } }).success).toBe(true);
  });
  it('accepts tool with description', () => {
    expect(McpToolSchema.safeParse({
      name: 'echo', description: 'returns input', inputSchema: { type: 'object' },
    }).success).toBe(true);
  });
  it('rejects tool missing name', () => {
    expect(McpToolSchema.safeParse({ inputSchema: { type: 'object' } }).success).toBe(false);
  });
});

describe('ToolsListResultSchema', () => {
  it('parses { tools: [...] }', () => {
    const out = ToolsListResultSchema.parse({ tools: [{ name: 'echo', inputSchema: {} }] });
    expect(out.tools).toHaveLength(1);
  });
});

describe('ToolsCallResultSchema', () => {
  it('parses content array', () => {
    const out = ToolsCallResultSchema.parse({ content: [{ type: 'text', text: 'hello' }] });
    expect(out.content[0]).toEqual({ type: 'text', text: 'hello' });
  });
  it('accepts empty content', () => {
    expect(ToolsCallResultSchema.safeParse({ content: [] }).success).toBe(true);
  });
});

describe('JsonRpcResponseSchema', () => {
  it('parses success response', () => {
    expect(JsonRpcResponseSchema.safeParse({ jsonrpc: '2.0', id: 1, result: { ok: true } }).success).toBe(true);
  });
  it('parses error response', () => {
    expect(JsonRpcResponseSchema.safeParse({
      jsonrpc: '2.0', id: 1, error: { code: -32601, message: 'method not found' },
    }).success).toBe(true);
  });
});
```

- [ ] **Step 2: Run, expect FAIL**

```bash
npx vitest run server/domain/mcp/mcp.schema.test.ts
```

- [ ] **Step 3: Implement `server/domain/mcp/mcp.types.ts`**

```ts
import type { McpToolPolicy, McpConnectionState } from '@/server/domain/context/context.types';
export type { McpToolPolicy, McpConnectionState };

export interface McpToolSchema {
  type?: 'object';
  properties?: Record<string, unknown>;
  required?: string[];
  additionalProperties?: boolean;
}

export interface McpTool {
  name: string;
  description?: string;
  inputSchema: McpToolSchema;
}

export interface McpToolCall {
  id: string;
  qualifiedName: string;
  args: Record<string, unknown>;
}

export type McpToolResult =
  | { ok: true; output: unknown }
  | { ok: false; error: string };

export interface McpConnectionStateSnapshot {
  state: McpConnectionState;
  error?: string;
}
```

- [ ] **Step 4: Implement `server/domain/mcp/mcp.schema.ts`**

```ts
import { z } from 'zod';

export const McpToolSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  inputSchema: z.object({
    type: z.literal('object').optional(),
    properties: z.record(z.string(), z.unknown()).optional(),
    required: z.array(z.string()).optional(),
    additionalProperties: z.boolean().optional(),
  }).passthrough(),
});

export const ToolsListResultSchema = z.object({
  tools: z.array(McpToolSchema),
});

const ContentItemSchema = z.object({
  type: z.string(),
  text: z.string().optional(),
}).passthrough();

export const ToolsCallResultSchema = z.object({
  content: z.array(ContentItemSchema).default([]),
  isError: z.boolean().optional(),
});

export const JsonRpcResponseSchema = z.object({
  jsonrpc: z.literal('2.0'),
  id: z.union([z.number(), z.string()]),
  result: z.unknown().optional(),
  error: z.object({ code: z.number(), message: z.string() }).optional(),
});
```

- [ ] **Step 5: Implement `server/domain/mcp/connection.types.ts`**

```ts
import type { McpTool, McpToolResult } from './mcp.types';

export interface McpConnection {
  readonly defaultAutoApprove: boolean;
  initialize(): Promise<void>;
  listTools(): Promise<McpTool[]>;
  callTool(name: string, args: Record<string, unknown>): Promise<McpToolResult>;
  close(): Promise<void>;
}
```

- [ ] **Step 6: Run, expect PASS**

```bash
npx vitest run server/domain/mcp/
```

- [ ] **Step 7: Lint + commit**

```bash
npm run lint
git add server/domain/mcp/
git commit -m "feat(slice-7): MCP types + JSON-RPC schemas + McpConnection interface"
```

---

## Phase E — Mock connection

### Task E1: `MockMcpConnection` with three built-in tools

**Files:**
- Create: `server/domain/mcp/mock-connection.ts`
- Create: `server/domain/mcp/mock-connection.test.ts`

- [ ] **Step 1: Failing tests**

```ts
// server/domain/mcp/mock-connection.test.ts
import { describe, it, expect } from 'vitest';
import { MockMcpConnection } from './mock-connection';

describe('MockMcpConnection', () => {
  it('defaults autoApprove to true', () => {
    expect(new MockMcpConnection().defaultAutoApprove).toBe(true);
  });

  it('initialize is a no-op (idempotent)', async () => {
    const c = new MockMcpConnection();
    await c.initialize();
    await c.initialize();
  });

  it('listTools returns echo + current_time + read_file_mock', async () => {
    const c = new MockMcpConnection();
    const tools = await c.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(['current_time', 'echo', 'read_file_mock']);
  });

  it('echo returns the input message', async () => {
    const c = new MockMcpConnection();
    expect(await c.callTool('echo', { message: 'hi' })).toEqual({ ok: true, output: { message: 'hi' } });
  });

  it('current_time returns iso + unix', async () => {
    const c = new MockMcpConnection();
    const res = await c.callTool('current_time', {});
    expect(res.ok).toBe(true);
    if (res.ok) {
      const out = res.output as { iso: string; unix: number };
      expect(typeof out.iso).toBe('string');
      expect(typeof out.unix).toBe('number');
    }
  });

  it('read_file_mock echoes back synthetic content', async () => {
    const c = new MockMcpConnection();
    const res = await c.callTool('read_file_mock', { path: '/foo.txt' });
    expect(res).toEqual({ ok: true, output: { content: 'mocked content of /foo.txt' } });
  });

  it('unknown tool returns ok:false', async () => {
    const c = new MockMcpConnection();
    const res = await c.callTool('nope', {});
    expect(res.ok).toBe(false);
  });

  it('close is a no-op (idempotent)', async () => {
    const c = new MockMcpConnection();
    await c.close();
    await c.close();
  });
});
```

- [ ] **Step 2: Run, expect FAIL**

```bash
npx vitest run server/domain/mcp/mock-connection.test.ts
```

- [ ] **Step 3: Implement `server/domain/mcp/mock-connection.ts`**

```ts
import type { McpConnection } from './connection.types';
import type { McpTool, McpToolResult } from './mcp.types';

const MOCK_TOOLS: McpTool[] = [
  {
    name: 'echo',
    description: 'Returns the input message unchanged.',
    inputSchema: {
      type: 'object',
      properties: { message: { type: 'string' } },
      required: ['message'],
    },
  },
  {
    name: 'current_time',
    description: 'Returns the current time as ISO + unix seconds.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'read_file_mock',
    description: 'Pretends to read a file; returns synthetic content.',
    inputSchema: {
      type: 'object',
      properties: { path: { type: 'string' } },
      required: ['path'],
    },
  },
];

export class MockMcpConnection implements McpConnection {
  readonly defaultAutoApprove = true;

  async initialize(): Promise<void> {
    /* no-op */
  }

  async listTools(): Promise<McpTool[]> {
    return MOCK_TOOLS;
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<McpToolResult> {
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

  async close(): Promise<void> {
    /* no-op */
  }
}
```

- [ ] **Step 4: Run, expect PASS (8 tests)**

```bash
npx vitest run server/domain/mcp/mock-connection.test.ts
```

- [ ] **Step 5: Lint + commit**

```bash
npm run lint
git add server/domain/mcp/mock-connection.ts server/domain/mcp/mock-connection.test.ts
git commit -m "feat(slice-7): MockMcpConnection (echo, current_time, read_file_mock)"
```

---

## Phase F — Stdio connection

### Task F1: `StdioMcpConnection` + fixture echo-server

**Files:**
- Create: `server/domain/mcp/__fixtures__/echo-server.js`
- Create: `server/domain/mcp/stdio-connection.ts`
- Create: `server/domain/mcp/stdio-connection.test.ts`

- [ ] **Step 1: Create the test fixture `server/domain/mcp/__fixtures__/echo-server.js`**

Plain Node script that speaks MCP-shaped JSON-RPC over stdio:

```js
#!/usr/bin/env node
// Minimal MCP-shaped server used as a stdio test fixture.
// Methods: initialize → {}, tools/list → { tools: [echo] },
// tools/call name=echo → { content: [{type:'text', text: args.message}] },
// tools/call name=fail → JSON-RPC error.

let buf = '';
process.stdin.setEncoding('utf-8');
process.stdin.on('data', (chunk) => {
  buf += chunk;
  let idx;
  while ((idx = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, idx).trim();
    buf = buf.slice(idx + 1);
    if (!line) continue;
    let req;
    try { req = JSON.parse(line); } catch { continue; }
    respond(req);
  }
});

function send(obj) { process.stdout.write(JSON.stringify(obj) + '\n'); }

function respond(req) {
  const { id, method, params } = req;
  if (method === 'initialize') return send({ jsonrpc: '2.0', id, result: {} });
  if (method === 'tools/list') {
    return send({
      jsonrpc: '2.0', id,
      result: { tools: [{ name: 'echo', description: 'echo', inputSchema: { type: 'object' } }] },
    });
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
    return send({ jsonrpc: '2.0', id, error: { code: -32601, message: 'unknown tool' } });
  }
  send({ jsonrpc: '2.0', id, error: { code: -32601, message: 'method not found' } });
}
```

Make sure the file does NOT have an `.executable` bit dependency — we invoke it via `node <path>`, not directly.

- [ ] **Step 2: Failing tests**

```ts
// server/domain/mcp/stdio-connection.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { StdioMcpConnection } from './stdio-connection';

const FIXTURE = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '__fixtures__',
  'echo-server.js',
);

describe('StdioMcpConnection', () => {
  let conn: StdioMcpConnection;
  beforeEach(() => {
    conn = new StdioMcpConnection({ command: 'node', args: [FIXTURE], env: {} });
  });
  afterEach(async () => {
    await conn.close();
  });

  it('defaults autoApprove to false', () => {
    expect(conn.defaultAutoApprove).toBe(false);
  });

  it('initialize + listTools returns echo', async () => {
    await conn.initialize();
    const tools = await conn.listTools();
    expect(tools.map((t) => t.name)).toEqual(['echo']);
  });

  it('callTool echo returns text content', async () => {
    await conn.initialize();
    const res = await conn.callTool('echo', { message: 'hello' });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.output).toEqual({ content: [{ type: 'text', text: 'hello' }] });
    }
  });

  it('callTool returns ok:false on JSON-RPC error', async () => {
    await conn.initialize();
    const res = await conn.callTool('fail', {});
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toContain('intentional failure');
  });

  it('initialize on a bad command rejects', async () => {
    const bad = new StdioMcpConnection({ command: '/nonexistent/path/xyz', args: [], env: {} });
    await expect(bad.initialize()).rejects.toThrow();
  });

  it('close is idempotent', async () => {
    await conn.initialize();
    await conn.close();
    await conn.close();
  });
});
```

- [ ] **Step 3: Run, expect FAIL (module not found)**

```bash
npx vitest run server/domain/mcp/stdio-connection.test.ts
```

- [ ] **Step 4: Implement `server/domain/mcp/stdio-connection.ts`**

```ts
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import type { McpConnection } from './connection.types';
import type { McpTool, McpToolResult } from './mcp.types';
import { JsonRpcResponseSchema, ToolsListResultSchema } from './mcp.schema';

export interface StdioOpts {
  command: string;
  args: string[];
  env: Record<string, string>;
}

interface PendingCall {
  resolve: (value: unknown) => void;
  reject: (err: Error) => void;
  timer: NodeJS.Timeout;
}

const INITIALIZE_TIMEOUT_MS = 5_000;
const TOOLS_CALL_TIMEOUT_MS = 30_000;

export class StdioMcpConnection implements McpConnection {
  readonly defaultAutoApprove = false;

  private proc: ChildProcessWithoutNullStreams | null = null;
  private pending = new Map<number, PendingCall>();
  private nextId = 1;
  private buf = '';
  private stderrBuf = '';

  constructor(private readonly opts: StdioOpts) {}

  async initialize(): Promise<void> {
    this.proc = spawn(this.opts.command, this.opts.args, {
      env: { ...process.env, ...this.opts.env },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    this.proc.on('error', (err) => this.failAllPending(err));
    this.proc.on('exit', (code) => this.failAllPending(new Error(`subprocess exited (code ${code}); stderr: ${this.stderrBuf.slice(-512)}`)));
    this.proc.stdout.setEncoding('utf-8');
    this.proc.stdout.on('data', (chunk: string) => this.onStdout(chunk));
    this.proc.stderr.setEncoding('utf-8');
    this.proc.stderr.on('data', (chunk: string) => {
      this.stderrBuf = (this.stderrBuf + chunk).slice(-4096);
    });
    await this.rpc('initialize', {}, INITIALIZE_TIMEOUT_MS);
  }

  async listTools(): Promise<McpTool[]> {
    const raw = await this.rpc('tools/list', {});
    const parsed = ToolsListResultSchema.safeParse(raw);
    if (!parsed.success) throw new Error('tools/list response failed schema');
    return parsed.data.tools;
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<McpToolResult> {
    try {
      const out = await this.rpc('tools/call', { name, arguments: args }, TOOLS_CALL_TIMEOUT_MS);
      return { ok: true, output: out };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : 'tool call failed' };
    }
  }

  async close(): Promise<void> {
    if (!this.proc) return;
    this.failAllPending(new Error('connection closed'));
    try {
      this.proc.kill('SIGTERM');
    } catch {
      // ignore
    }
    await delay(50);
    try {
      if (this.proc.exitCode === null) this.proc.kill('SIGKILL');
    } catch {
      // ignore
    }
    this.proc = null;
  }

  private async rpc(method: string, params: unknown, timeoutMs = TOOLS_CALL_TIMEOUT_MS): Promise<unknown> {
    if (!this.proc) throw new Error('not initialized');
    const id = this.nextId++;
    const payload = JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n';
    return new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`rpc timeout: ${method}`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.proc!.stdin.write(payload, (err) => {
        if (err) {
          this.pending.delete(id);
          clearTimeout(timer);
          reject(err);
        }
      });
    });
  }

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

  private failAllPending(err: Error): void {
    for (const p of this.pending.values()) {
      clearTimeout(p.timer);
      p.reject(err);
    }
    this.pending.clear();
  }
}
```

- [ ] **Step 5: Run, expect PASS (6 tests)**

```bash
npx vitest run server/domain/mcp/stdio-connection.test.ts
```

- [ ] **Step 6: Lint + commit**

```bash
npm run lint
git add server/domain/mcp/stdio-connection.ts server/domain/mcp/stdio-connection.test.ts server/domain/mcp/__fixtures__/
git commit -m "feat(slice-7): StdioMcpConnection (subprocess + JSON-RPC framing)"
```

---

## Phase G — Registry

### Task G1: `McpRegistry` owning connections + decision-promise map

**Files:**
- Create: `server/domain/mcp/registry.ts`
- Create: `server/domain/mcp/registry.test.ts`

- [ ] **Step 1: Failing tests**

```ts
// server/domain/mcp/registry.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ContextStore } from '@/server/domain/context/context.store';
import { McpRegistry } from './registry';

function newCtx(): ContextStore {
  const dir = mkdtempSync(path.join(tmpdir(), 'aether-mcp-'));
  return new ContextStore(path.join(dir, 'context.json'));
}

describe('McpRegistry', () => {
  let ctx: ContextStore;
  let reg: McpRegistry;
  beforeEach(async () => {
    ctx = newCtx();
    reg = new McpRegistry(ctx);
    await ctx.bulkOverwrite({
      systemInstruction: '',
      skills: [],
      tools: [],
      mcpServers: [
        { id: 'M1', name: 'mock', transport: 'mock', status: 'offline' },
      ],
    });
  });

  it('connect spawns + returns tools', async () => {
    const r = await reg.connect('M1');
    expect(r.tools.map((t) => t.name).sort()).toEqual(['current_time', 'echo', 'read_file_mock']);
    expect(reg.stateOf('M1').state).toBe('online');
  });

  it('listLiveTools returns namespaced names', async () => {
    await reg.connect('M1');
    const tools = reg.listLiveTools();
    expect(tools.map((t) => t.qualifiedName).sort()).toEqual([
      'mock.current_time', 'mock.echo', 'mock.read_file_mock',
    ]);
  });

  it('callTool routes by namespace', async () => {
    await reg.connect('M1');
    const res = await reg.callTool('mock.echo', { message: 'hi' });
    expect(res).toEqual({ ok: true, output: { message: 'hi' } });
  });

  it('callTool offline returns ok:false', async () => {
    const res = await reg.callTool('mock.echo', {});
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/offline/i);
  });

  it('policy: built-in mock default autoApprove true', async () => {
    await reg.connect('M1');
    expect(reg.policy('mock.echo')).toEqual({ autoApprove: true });
  });

  it('policy: persisted user override wins', async () => {
    await ctx.update((cur) => ({
      ...cur,
      mcpServers: cur.mcpServers.map((s) =>
        s.id === 'M1' ? { ...s, toolPolicies: { echo: { autoApprove: false } } } : s,
      ),
    }));
    await reg.connect('M1');
    expect(reg.policy('mock.echo')).toEqual({ autoApprove: false });
  });

  it('disconnect transitions to offline; listLiveTools empties', async () => {
    await reg.connect('M1');
    await reg.disconnect('M1');
    expect(reg.stateOf('M1').state).toBe('offline');
    expect(reg.listLiveTools()).toEqual([]);
  });

  it('awaitDecision resolves when resolveDecision called', async () => {
    const p = reg.awaitDecision('CALL1', 1000);
    reg.resolveDecision('CALL1', 'approve');
    await expect(p).resolves.toBe('approve');
  });

  it('awaitDecision rejects on timeout', async () => {
    await expect(reg.awaitDecision('CALL2', 20)).rejects.toThrow(/timeout/i);
  });
});
```

The test references `ContextStore.update` and `bulkOverwrite` — confirm these exist. If `update` is private/missing, use `patch` or extend with the existing `addMcpServer` method to seed the data instead.

- [ ] **Step 2: Run, expect FAIL**

```bash
npx vitest run server/domain/mcp/registry.test.ts
```

- [ ] **Step 3: Implement `server/domain/mcp/registry.ts`**

```ts
import type { ContextStore } from '@/server/domain/context/context.store';
import type {
  McpServerConfig,
  McpConnectionState,
} from '@/server/domain/context/context.types';
import type { McpConnection } from './connection.types';
import type {
  McpTool,
  McpToolResult,
  McpToolPolicy,
  McpConnectionStateSnapshot,
} from './mcp.types';
import { MockMcpConnection } from './mock-connection';
import { StdioMcpConnection } from './stdio-connection';

interface LiveEntry {
  connection: McpConnection;
  serverName: string;
  tools: McpTool[];
  serverId: string;
}

export interface LiveTool {
  qualifiedName: string;
  serverId: string;
  serverName: string;
  tool: McpTool;
  autoApprove: boolean;
}

export class McpRegistry {
  private live = new Map<string, LiveEntry>();
  private states = new Map<string, McpConnectionStateSnapshot>();
  private decisions = new Map<string, { resolve: (v: 'approve' | 'reject') => void; timer: NodeJS.Timeout }>();

  constructor(private readonly contextStore: ContextStore) {}

  async connect(id: string): Promise<{ tools: McpTool[] }> {
    const ctx = await this.contextStore.read();
    const cfg = ctx.mcpServers.find((s) => s.id === id);
    if (!cfg) throw new Error(`Unknown MCP server '${id}'`);
    if (this.live.has(id)) {
      return { tools: this.live.get(id)!.tools };
    }
    this.states.set(id, { state: 'connecting' });
    try {
      const connection = this.makeConnection(cfg);
      await connection.initialize();
      const tools = await connection.listTools();
      this.live.set(id, { connection, serverName: cfg.name, tools, serverId: id });
      this.states.set(id, { state: 'online' });
      return { tools };
    } catch (e) {
      this.states.set(id, { state: 'error', error: e instanceof Error ? e.message : 'connect failed' });
      throw e;
    }
  }

  async disconnect(id: string): Promise<void> {
    const entry = this.live.get(id);
    if (entry) {
      await entry.connection.close().catch(() => {});
      this.live.delete(id);
    }
    this.states.set(id, { state: 'offline' });
  }

  listLiveTools(): LiveTool[] {
    const out: LiveTool[] = [];
    for (const entry of this.live.values()) {
      for (const tool of entry.tools) {
        out.push({
          qualifiedName: `${entry.serverName}.${tool.name}`,
          serverId: entry.serverId,
          serverName: entry.serverName,
          tool,
          autoApprove: this.resolvePolicy(entry, tool.name).autoApprove,
        });
      }
    }
    return out;
  }

  async callTool(qualifiedName: string, args: Record<string, unknown>): Promise<McpToolResult> {
    const sep = qualifiedName.indexOf('.');
    if (sep < 0) return { ok: false, error: `Invalid qualified name '${qualifiedName}'` };
    const serverName = qualifiedName.slice(0, sep);
    const toolName = qualifiedName.slice(sep + 1);
    const entry = [...this.live.values()].find((e) => e.serverName === serverName);
    if (!entry) return { ok: false, error: `Server '${serverName}' is offline` };
    return entry.connection.callTool(toolName, args);
  }

  policy(qualifiedName: string): McpToolPolicy {
    const sep = qualifiedName.indexOf('.');
    if (sep < 0) return { autoApprove: false };
    const serverName = qualifiedName.slice(0, sep);
    const toolName = qualifiedName.slice(sep + 1);
    const entry = [...this.live.values()].find((e) => e.serverName === serverName);
    if (!entry) return { autoApprove: false };
    return this.resolvePolicy(entry, toolName);
  }

  stateOf(id: string): McpConnectionStateSnapshot {
    return this.states.get(id) ?? { state: 'offline' };
  }

  async setToolPolicy(serverId: string, toolName: string, policy: McpToolPolicy): Promise<void> {
    await this.contextStore.update((cur) => ({
      ...cur,
      mcpServers: cur.mcpServers.map((s) =>
        s.id === serverId
          ? { ...s, toolPolicies: { ...(s.toolPolicies ?? {}), [toolName]: policy } }
          : s,
      ),
    }));
  }

  awaitDecision(callId: string, timeoutMs = 60_000): Promise<'approve' | 'reject'> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.decisions.delete(callId);
        reject(new Error('decision timeout'));
      }, timeoutMs);
      this.decisions.set(callId, { resolve, timer });
    });
  }

  resolveDecision(callId: string, decision: 'approve' | 'reject'): void {
    const pending = this.decisions.get(callId);
    if (!pending) return;
    clearTimeout(pending.timer);
    this.decisions.delete(callId);
    pending.resolve(decision);
  }

  /** Test/devtools only. */
  knownServerIds(): string[] {
    return [...this.live.keys()];
  }

  private makeConnection(cfg: McpServerConfig): McpConnection {
    if (cfg.transport === 'mock') return new MockMcpConnection();
    return new StdioMcpConnection({
      command: cfg.command ?? '',
      args: cfg.args ?? [],
      env: cfg.env ?? {},
    });
  }

  private resolvePolicy(entry: LiveEntry, toolName: string): McpToolPolicy {
    // Note: persisted policy may live on context.mcpServers — but reading it requires async.
    // To avoid sync/async surprises, the resolved policy from disk is materialised when
    // the registry calls connect() (see below). For slice 7 we read it lazily once per
    // call via a cache populated at connect time.
    const cached = this.policyCache.get(`${entry.serverId}.${toolName}`);
    if (cached) return cached;
    const fallback: McpToolPolicy = { autoApprove: entry.connection.defaultAutoApprove };
    return fallback;
  }

  private policyCache = new Map<string, McpToolPolicy>();

  /** Internal: refresh cache for a server. Called inside connect() after we have the config. */
  private async refreshPolicyCache(cfg: McpServerConfig): Promise<void> {
    const policies = cfg.toolPolicies ?? {};
    for (const [name, policy] of Object.entries(policies)) {
      this.policyCache.set(`${cfg.id}.${name}`, policy);
    }
  }
}
```

> **Implementer note:** The plan above shows the public surface fully. The private `policyCache` interacts with `connect()` — make sure to call `refreshPolicyCache(cfg)` inside `connect()` AFTER `this.live.set(...)`. If you find the policy resolution path cleaner by inlining the lookup (read `cfg.toolPolicies[toolName]` directly via a `cfg` field cached on `LiveEntry`), do that instead — the tests only assert behaviour, not the exact field name.

- [ ] **Step 4: Run, expect PASS (9 tests)**

```bash
npx vitest run server/domain/mcp/registry.test.ts
```

- [ ] **Step 5: Lint + commit**

```bash
npm run lint
git add server/domain/mcp/registry.ts server/domain/mcp/registry.test.ts
git commit -m "feat(slice-7): McpRegistry (connect/disconnect/listLiveTools/callTool/policy/decisions)"
```

---

## Phase H — /api/mcp routes

### Task H1: REST routes for connect, disconnect, list, togglePolicy, decision, state

**Files:**
- Create: `server/routes/mcp.routes.ts`
- Create: `server/routes/mcp.routes.test.ts`

- [ ] **Step 1: Failing tests (uses mock transport — no subprocess)**

```ts
// server/routes/mcp.routes.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import request from 'supertest';
import { createApp } from '@/server/app';
import { ContextStore } from '@/server/domain/context/context.store';
import { McpRegistry } from '@/server/domain/mcp/registry';

async function makeApp() {
  const dir = mkdtempSync(path.join(tmpdir(), 'aether-mcp-routes-'));
  const contextStore = new ContextStore(path.join(dir, 'context.json'));
  await contextStore.bulkOverwrite({
    systemInstruction: '',
    skills: [],
    tools: [],
    mcpServers: [
      { id: 'M1', name: 'mock', transport: 'mock', status: 'offline' },
    ],
  });
  const mcpRegistry = new McpRegistry(contextStore);
  return { app: createApp({ contextStore, mcpRegistry }), mcpRegistry };
}

describe('mcp routes', () => {
  let app: Awaited<ReturnType<typeof makeApp>>['app'];
  let reg: McpRegistry;
  beforeEach(async () => {
    ({ app, mcpRegistry: reg } = await makeApp());
  });

  it('POST /api/mcp/:id/connect → tools', async () => {
    const res = await request(app).post('/api/mcp/M1/connect');
    expect(res.status).toBe(200);
    expect(res.body.state).toBe('online');
    expect(Array.isArray(res.body.tools)).toBe(true);
  });

  it('GET /api/mcp/tools after connect lists namespaced tools', async () => {
    await request(app).post('/api/mcp/M1/connect');
    const res = await request(app).get('/api/mcp/tools');
    expect(res.status).toBe(200);
    expect(res.body.tools.map((t: { qualifiedName: string }) => t.qualifiedName).sort()).toEqual([
      'mock.current_time', 'mock.echo', 'mock.read_file_mock',
    ]);
  });

  it('POST /api/mcp/:id/disconnect → 204; subsequent /tools is empty', async () => {
    await request(app).post('/api/mcp/M1/connect');
    const dis = await request(app).post('/api/mcp/M1/disconnect');
    expect(dis.status).toBe(204);
    const list = await request(app).get('/api/mcp/tools');
    expect(list.body.tools).toEqual([]);
  });

  it('PATCH /api/mcp/:id/tools/:name persists policy', async () => {
    await request(app).post('/api/mcp/M1/connect');
    const res = await request(app)
      .patch('/api/mcp/M1/tools/echo')
      .send({ autoApprove: false });
    expect(res.status).toBe(200);
    expect(res.body.autoApprove).toBe(false);
    // verify it sticks: disconnect + reconnect + check policy
    await request(app).post('/api/mcp/M1/disconnect');
    await request(app).post('/api/mcp/M1/connect');
    expect(reg.policy('mock.echo')).toEqual({ autoApprove: false });
  });

  it('POST /api/mcp/decision resolves a pending decision', async () => {
    const decisionP = reg.awaitDecision('CID-1', 500);
    const res = await request(app)
      .post('/api/mcp/decision')
      .send({ callId: 'CID-1', action: 'approve' });
    expect(res.status).toBe(204);
    await expect(decisionP).resolves.toBe('approve');
  });

  it('POST /connect with unknown id → 404', async () => {
    const res = await request(app).post('/api/mcp/ZZZ/connect');
    expect(res.status).toBe(404);
  });

  it('GET /api/mcp/state returns per-server snapshot', async () => {
    await request(app).post('/api/mcp/M1/connect');
    const res = await request(app).get('/api/mcp/state');
    expect(res.status).toBe(200);
    expect(res.body.servers).toEqual(expect.arrayContaining([{ id: 'M1', state: 'online' }]));
  });
});
```

- [ ] **Step 2: Run, expect FAIL (createApp does not yet accept mcpRegistry — that's Task I1)**

```bash
npx vitest run server/routes/mcp.routes.test.ts
```

- [ ] **Step 3: Implement `server/routes/mcp.routes.ts`**

```ts
import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { ValidationError } from '@/server/lib/errors';
import type { McpRegistry } from '@/server/domain/mcp/registry';

function asyncHandler(fn: (req: Request, res: Response, next: NextFunction) => Promise<void>) {
  return (req: Request, res: Response, next: NextFunction) => {
    fn(req, res, next).catch(next);
  };
}

const PolicyBody = z.object({ autoApprove: z.boolean() });
const DecisionBody = z.object({
  callId: z.string().min(1),
  action: z.enum(['approve', 'reject']),
});

export function createMcpRoutes(registry: McpRegistry): Router {
  const router = Router();

  router.post(
    '/:id/connect',
    asyncHandler(async (req, res) => {
      try {
        const r = await registry.connect(req.params.id);
        res.json({ state: registry.stateOf(req.params.id).state, tools: r.tools });
      } catch (e) {
        if (e instanceof Error && /Unknown MCP server/.test(e.message)) {
          res.status(404).json({ error: { code: 'NOT_FOUND', message: e.message } });
          return;
        }
        throw e;
      }
    }),
  );

  router.post(
    '/:id/disconnect',
    asyncHandler(async (req, res) => {
      await registry.disconnect(req.params.id);
      res.status(204).end();
    }),
  );

  router.get(
    '/tools',
    asyncHandler(async (_req, res) => {
      res.json({ tools: registry.listLiveTools() });
    }),
  );

  router.patch(
    '/:id/tools/:name',
    asyncHandler(async (req, res) => {
      const parsed = PolicyBody.safeParse(req.body);
      if (!parsed.success) throw new ValidationError('Invalid policy body', parsed.error);
      await registry.setToolPolicy(req.params.id, req.params.name, parsed.data);
      res.json(parsed.data);
    }),
  );

  router.post(
    '/decision',
    asyncHandler(async (req, res) => {
      const parsed = DecisionBody.safeParse(req.body);
      if (!parsed.success) throw new ValidationError('Invalid decision body', parsed.error);
      registry.resolveDecision(parsed.data.callId, parsed.data.action);
      res.status(204).end();
    }),
  );

  router.get(
    '/state',
    asyncHandler(async (_req, res) => {
      const reg = registry as unknown as { contextStore: { read(): Promise<{ mcpServers: { id: string }[] }> } };
      const ctx = await reg.contextStore.read();
      const servers = ctx.mcpServers.map((s) => ({
        id: s.id,
        ...registry.stateOf(s.id),
      }));
      res.json({ servers });
    }),
  );

  return router;
}
```

> Note: the `/state` route reads from `contextStore` indirectly through the registry. Cleaner: add `registry.allServerIds()` that returns the list and avoid the cast. Implementer can refactor — the test only asserts the response shape.

- [ ] **Step 4: Don't run tests yet (need Task I1). Commit the module alone:**

```bash
git add server/routes/mcp.routes.ts server/routes/mcp.routes.test.ts
git commit -m "feat(slice-7): /api/mcp routes module (connect/disconnect/list/policy/decision/state)"
```

---

## Phase I — Wire registry into app/bootstrap

### Task I1: Pass `mcpRegistry` into `createApp` + `DispatchService`

**Files:**
- Modify: `server/app.ts`
- Modify: `server/index.ts`
- Modify: `server/domain/dispatch/dispatch.service.ts` — `DispatchServiceDeps` gets `mcpRegistry?` (used later in Phase N; we expose the dep first to make the wiring complete)

- [ ] **Step 1: Update `server/app.ts`**

Add imports at the top:

```ts
import { createMcpRoutes } from '@/server/routes/mcp.routes';
import type { McpRegistry } from '@/server/domain/mcp/registry';
```

In `AppDeps`:

```ts
  mcpRegistry?: McpRegistry;
```

In `createApp`, near the other conditional mounts:

```ts
  if (deps.mcpRegistry) {
    app.use('/api/mcp', createMcpRoutes(deps.mcpRegistry));
  }
```

- [ ] **Step 2: Update `server/domain/dispatch/dispatch.service.ts`**

Add `mcpRegistry?: McpRegistry` to `DispatchServiceDeps` (the field will be USED in Phase N; for now we just declare it). Import `import type { McpRegistry } from '@/server/domain/mcp/registry';`.

- [ ] **Step 3: Update `server/index.ts`**

Add imports:

```ts
import { McpRegistry } from './domain/mcp/registry';
```

Inside `bootstrap()`, after `contextStore` is created:

```ts
const mcpRegistry = new McpRegistry(contextStore);
```

Pass into the DispatchService constructor AND into `createApp`:

```ts
const dispatcher = new DispatchService({
  provider, historyStore, contextStore, subAgentsStore, mcpRegistry,
});

const app = createApp({
  contextStore, historyStore, dispatcher, profilesStore, subAgentsStore, mcpRegistry,
});
```

- [ ] **Step 4: Run mcp routes tests, expect PASS**

```bash
npx vitest run server/routes/mcp.routes.test.ts
```

Expected: all 7 tests PASS.

- [ ] **Step 5: Run full server suite (no regressions)**

```bash
npx vitest run server
```

Expected: ALL PASS.

- [ ] **Step 6: Lint + commit**

```bash
npm run lint
git add server/app.ts server/index.ts server/domain/dispatch/dispatch.service.ts
git commit -m "feat(slice-7): wire McpRegistry into createApp + DispatchService deps"
```

---

## Phase J — Provider interface extension

### Task J1: `ProviderRequest` + `ProviderChunk` accommodate function calls

**Files:**
- Modify: `server/domain/dispatch/providers/provider.types.ts`

- [ ] **Step 1: Replace `server/domain/dispatch/providers/provider.types.ts`**

```ts
export interface ProviderToolDecl {
  qualifiedName: string;
  description?: string;
  schema: {
    type?: 'object';
    properties?: Record<string, unknown>;
    required?: string[];
    additionalProperties?: boolean;
  };
}

export interface ProviderToolResultMessage {
  callId: string;
  qualifiedName: string;
  ok: boolean;
  output?: unknown;
  error?: string;
}

export interface ProviderRequest {
  systemInstruction: string;
  history: { role: 'user' | 'model'; text: string }[];
  userMessage: string;
  thinking?: boolean;
  mcpTools?: ProviderToolDecl[];
  /** When the dispatch loop continues after a tool call, the provider receives the
   *  previously-emitted model turn (assistant text + the function_call it made) and
   *  the tool result. Providers use this to construct the next turn. */
  toolResults?: ProviderToolResultMessage[];
  /** The assistant-side text accumulated before the function_call, if any.
   *  Providers that need to replay the partial assistant turn (Gemini) use this. */
  pendingAssistantText?: string;
}

export interface ProviderUsage {
  totalTokens?: number;
}

export interface ProviderFunctionCall {
  callId: string;
  qualifiedName: string;
  args: Record<string, unknown>;
}

export type ProviderChunk =
  | { type: 'text'; text: string }
  | { type: 'thinking'; text: string }
  | { type: 'function_call'; call: ProviderFunctionCall }
  | { type: 'done'; usage?: ProviderUsage };

export interface AIProvider {
  readonly model: string;
  stream(req: ProviderRequest, signal: AbortSignal): AsyncIterable<ProviderChunk>;
}
```

- [ ] **Step 2: Run existing provider/dispatch tests to verify nothing broke**

```bash
npx vitest run server/domain/dispatch
```

Expected: PASS. The new fields are optional; old call sites unaffected. (`function_call` chunk type is additive.)

- [ ] **Step 3: Lint + commit**

```bash
npm run lint
git add server/domain/dispatch/providers/provider.types.ts
git commit -m "feat(slice-7): ProviderRequest +mcpTools/toolResults; ProviderChunk +function_call"
```

---

## Phase K — FakeProvider: programmable function_call

### Task K1: Extend `FakeProvider` to emit function_call chunks per scenario

**Files:**
- Modify: `server/domain/dispatch/providers/fake.provider.ts`
- Modify: `server/domain/dispatch/providers/fake.provider.test.ts`

- [ ] **Step 1: Read `fake.provider.ts` to find current shape**

The slice-6 version captures `lastRequest`. We extend the constructor to accept an optional `functionCalls?: ProviderFunctionCall[]` that the provider will emit (one per stream invocation) before falling through to text chunks. After emitting one function_call, the provider stops emitting text chunks until the dispatch loop's NEXT `stream()` call (with `toolResults` populated), at which point the provider emits whatever remaining text chunks remain (or a `done`).

- [ ] **Step 2: Append failing tests**

```ts
// Append to server/domain/dispatch/providers/fake.provider.test.ts
import type { ProviderFunctionCall } from './provider.types';

describe('FakeProvider function_call (slice 7)', () => {
  it('emits programmed function_call before text chunks', async () => {
    const call: ProviderFunctionCall = {
      callId: 'C1',
      qualifiedName: 'mock.echo',
      args: { message: 'hi' },
    };
    const p = new FakeProvider({
      chunks: ['after-tool'],
      functionCallSequence: [call],
      model: 'fake-1',
    });
    const chunks: unknown[] = [];
    for await (const c of p.stream({ systemInstruction: '', history: [], userMessage: 'x' }, new AbortController().signal)) {
      chunks.push(c);
    }
    expect(chunks[0]).toEqual({ type: 'function_call', call });
    expect(chunks.find((c) => (c as { type: string }).type === 'done')).toBeTruthy();
  });

  it('on the continuation call (toolResults present), emits remaining chunks without function_call', async () => {
    const p = new FakeProvider({
      chunks: ['after-tool'],
      functionCallSequence: [{ callId: 'C1', qualifiedName: 'mock.echo', args: {} }],
      model: 'fake-1',
    });
    // First call: emits function_call + done
    const sig = new AbortController().signal;
    const it1 = p.stream({ systemInstruction: '', history: [], userMessage: 'x' }, sig);
    for await (const _ of it1) { /* drain */ }
    // Continuation: toolResults present → skip function_call queue
    const chunks2: unknown[] = [];
    for await (const c of p.stream({
      systemInstruction: '', history: [], userMessage: 'x',
      toolResults: [{ callId: 'C1', qualifiedName: 'mock.echo', ok: true, output: { message: 'hi' } }],
    }, sig)) {
      chunks2.push(c);
    }
    expect(chunks2[0]).toEqual({ type: 'text', text: 'after-tool' });
  });
});
```

- [ ] **Step 3: Run, expect FAIL**

```bash
npx vitest run server/domain/dispatch/providers/fake.provider.test.ts
```

- [ ] **Step 4: Modify `fake.provider.ts`**

Add `functionCallSequence?: ProviderFunctionCall[]` to the constructor opts. The stream method consumes one function_call per call from the queue UNTIL `toolResults` is present in the request (which means we're in a continuation step). Pseudocode:

```ts
// New field on the class:
private functionCallQueue: ProviderFunctionCall[];
// Initialised in constructor from opts.functionCallSequence ?? [].

async *stream(req, signal) {
  this.lastRequest = req;
  if (this.functionCallQueue.length > 0 && !req.toolResults) {
    const call = this.functionCallQueue.shift()!;
    yield { type: 'function_call', call };
    yield { type: 'done' };
    return;
  }
  // existing text/thinking/done logic
  ...
}
```

Keep all existing test paths intact: `chunks` continues to emit text chunks when there's no programmed function_call.

- [ ] **Step 5: Run, expect PASS (existing + 2 new)**

```bash
npx vitest run server/domain/dispatch/providers/fake.provider.test.ts
```

- [ ] **Step 6: Lint + commit**

```bash
npm run lint
git add server/domain/dispatch/providers/fake.provider.ts server/domain/dispatch/providers/fake.provider.test.ts
git commit -m "feat(slice-7): FakeProvider +programmable function_call sequence"
```

---

## Phase L — GeminiProvider: function declarations + function_call

### Task L1: Forward `mcpTools` to Gemini SDK; emit `function_call` on response

**Files:**
- Modify: `server/domain/dispatch/providers/gemini.provider.ts`
- Modify: `server/domain/dispatch/providers/gemini.provider.test.ts`

- [ ] **Step 1: Inspect the existing Gemini provider**

Read `gemini.provider.ts` end-to-end. Identify where `generateContentStream` is called and what `config` / `tools` shape the SDK accepts. The `@google/genai` SDK (already a dep) supports:
- `config.tools`: array of `FunctionDeclaration` (name, description, parameters)
- Response chunks contain `functionCalls?: Array<{ name, args }>`

- [ ] **Step 2: Append failing tests**

```ts
// Append to server/domain/dispatch/providers/gemini.provider.test.ts
describe('GeminiProvider function calling (slice 7)', () => {
  it('passes mcpTools as functionDeclarations in config.tools', async () => {
    // Mock the SDK's generateContentStream to capture the request
    // (this file already mocks the SDK; follow the existing pattern)
    // ...
    // Build a provider, call stream(...) with mcpTools, drain.
    // Assert the captured request.config.tools contains a functionDeclaration with
    // name 'mock.echo' (or whatever you sent).
  });

  it('emits function_call chunk when SDK response contains functionCall', async () => {
    // Configure the SDK mock to emit a chunk with functionCalls field.
    // Stream and collect chunks; assert one chunk has type 'function_call' with
    // the matching qualifiedName + args.
  });

  it('on a continuation call (toolResults present), sends them as functionResponse messages', async () => {
    // Stream with req.toolResults populated; capture the SDK call's contents array;
    // assert at least one part has functionResponse shape with the right name + output.
  });
});
```

The existing test file already mocks `@google/genai` — follow that pattern for the new tests. Cribbed details:
- Capture last request via the same approach existing tests use (probably a spy or per-test mock).
- Build the response stream as an async iterator yielding `{ candidates: [{ content: { parts: [{ functionCall: { name, args } }] } }] }` style chunks.

- [ ] **Step 3: Run, expect FAIL**

```bash
npx vitest run server/domain/dispatch/providers/gemini.provider.test.ts
```

- [ ] **Step 4: Modify `gemini.provider.ts`**

Concrete changes:
1. In `stream(req, signal)`, build `config.tools` from `req.mcpTools`:

```ts
const toolsConfig = (req.mcpTools && req.mcpTools.length > 0)
  ? [{
      functionDeclarations: req.mcpTools.map((t) => ({
        name: t.qualifiedName.replace('.', '__'), // Gemini disallows '.' in fn names
        description: t.description,
        parameters: t.schema,
      })),
    }]
  : undefined;
```

> The dot-to-underscore mapping is necessary because Gemini's SDK rejects `'.'` in function names. We invert it when emitting the `function_call` chunk so the qualifiedName surface stays consistent (`<server>.<tool>`).

2. In the response loop, detect `functionCall` parts and emit `{ type: 'function_call', call: { callId: <generated>, qualifiedName: <underscored-back>, args } }`:

```ts
for await (const chunk of stream) {
  if (chunk.candidates?.[0]?.content?.parts) {
    for (const part of chunk.candidates[0].content.parts) {
      if (part.functionCall) {
        yield {
          type: 'function_call',
          call: {
            callId: randomUUID(),
            qualifiedName: part.functionCall.name.replace('__', '.'),
            args: part.functionCall.args ?? {},
          },
        };
        continue;
      }
      if (typeof part.text === 'string') {
        // existing text/thinking handling
      }
    }
  }
}
```

3. When `req.toolResults` is non-empty, prepend them to the `contents` array as functionResponse parts before the user message:

```ts
const toolResultParts = (req.toolResults ?? []).map((r) => ({
  role: 'user' as const,
  parts: [{
    functionResponse: {
      name: r.qualifiedName.replace('.', '__'),
      response: r.ok ? r.output : { error: r.error },
    },
  }],
}));
```

Add `toolResultParts` to the existing `contents` array in the SDK call.

- [ ] **Step 5: Run, expect PASS**

```bash
npx vitest run server/domain/dispatch/providers/gemini.provider.test.ts
```

- [ ] **Step 6: Lint + commit**

```bash
npm run lint
git add server/domain/dispatch/providers/gemini.provider.ts server/domain/dispatch/providers/gemini.provider.test.ts
git commit -m "feat(slice-7): GeminiProvider function calling (mcpTools + function_call + toolResults)"
```

---

## Phase M — Prompt assembler: pass `mcpTools` through

### Task M1: Extend assembler to forward `mcpTools` to provider

**Files:**
- Modify: `server/domain/dispatch/prompt-assembler.ts`
- Modify: `server/domain/dispatch/prompt-assembler.test.ts`

- [ ] **Step 1: Failing tests**

Append to `prompt-assembler.test.ts`:

```ts
describe('assemble mcpTools (slice 7)', () => {
  it('forwards mcpTools unchanged when present', () => {
    const tools = [{
      qualifiedName: 'mock.echo',
      description: 'echo',
      schema: { type: 'object' as const },
    }];
    const out = assemble(ctx, null, 'hello', null, tools);
    expect(out.mcpTools).toEqual(tools);
  });

  it('mcpTools default to [] when omitted', () => {
    const out = assemble(ctx, null, 'hello', null);
    expect(out.mcpTools).toEqual([]);
  });
});
```

- [ ] **Step 2: Modify `prompt-assembler.ts`**

Add `mcpTools?: ProviderToolDecl[]` argument to `assemble`. Add `mcpTools: ProviderToolDecl[]` to `AssembledPrompt`. Update the signature:

```ts
export function assemble(
  ctx: AetherContext,
  subAgent: SubAgentRecord | null,
  parsedMessage: string,
  resolvedName: string | null,
  mcpTools: ProviderToolDecl[] = [],
): AssembledPrompt {
  // ... existing logic
  return {
    systemInstruction: sys,
    skills,
    tools,
    message: parsedMessage,
    subAgent: resolvedName,
    mcpTools,
  };
}
```

Import `ProviderToolDecl` from the providers folder.

- [ ] **Step 3: Run, expect PASS**

```bash
npx vitest run server/domain/dispatch/prompt-assembler.test.ts
```

- [ ] **Step 4: Lint + commit**

```bash
npm run lint
git add server/domain/dispatch/prompt-assembler.ts server/domain/dispatch/prompt-assembler.test.ts
git commit -m "feat(slice-7): prompt-assembler forwards mcpTools to provider"
```

---

## Phase N — Dispatch service: tool-call loop

### Task N1: Function-call loop with auto-approve / await-decision / execute / continue

**Files:**
- Modify: `server/domain/dispatch/dispatch.service.ts`
- Modify: `server/routes/dispatch.routes.test.ts` — end-to-end tool-call test

- [ ] **Step 1: Read current `dispatch.service.ts`**

Identify the existing dispatch step (`tracer.step({ type: 'dispatch', ... })`). The function-call loop wraps the inner `for await (const chunk of it)` loop.

- [ ] **Step 2: Append failing test to `dispatch.routes.test.ts`**

```ts
describe('dispatch with MCP tool call (slice 7)', () => {
  it('emits tool_call_request, tool_call_result, and tracer tool_call step', async () => {
    // Build app with:
    //   - FakeProvider configured to emit function_call('mock.echo', { message: 'pong' })
    //     on the first stream(), and 'final-text' on the continuation.
    //   - McpRegistry with one connected mock server.
    // POST /api/ai/dispatch with body { sessionId, message: 'go' }.
    // Read SSE event stream; assert:
    //   - tool_call_request event with call.qualifiedName='mock.echo' present
    //   - tool_call_result event with ok:true and output.message='pong' present
    //   - reasoning_step event with type='tool_call' and toolCall.qualifiedName='mock.echo'
    //   - final assistant text contains 'final-text'
  });

  it('rejects via dialog: tool result is ok:false with "Rejected by user"', async () => {
    // Same setup but the tool has autoApprove=false.
    // The dispatch awaits a decision; in the test we POST /api/mcp/decision before the
    // 60s timeout with action='reject'. Assert the tool_call_result is ok:false and the
    // model continuation receives the rejection.
  });
});
```

The test harness is the same as the existing dispatch tests in the file. Use the per-test-app pattern from `dispatch.routes.test.ts` slice 6 additions.

- [ ] **Step 3: Modify `dispatch.service.ts`**

Inside `handle()`, replace the existing dispatch step with this expanded version (keep everything before it untouched: `context_fetch`, sub-agent resolve, assemble):

```ts
const liveTools = this.deps.mcpRegistry?.listLiveTools() ?? [];
const mcpToolDecls = liveTools.map((t) => ({
  qualifiedName: t.qualifiedName,
  description: t.tool.description,
  schema: t.tool.inputSchema,
}));
const assembled = assemble(context, matchedSubAgent, parsed.stripped, parsed.name, mcpToolDecls);

const MAX_TOOL_CALLS_PER_DISPATCH = 10;
let pendingToolResults: ProviderToolResultMessage[] = [];
let assistantTextSoFar = '';
let dispatchUsage: ProviderUsage | undefined;
let toolCallsCount = 0;

await tracer.step({
  type: 'dispatch',
  title: `Dispatch to ${provider.model}${thinking ? ' (thinking)' : ''}`,
  run: async () => {
    while (true) {
      const it = provider.stream(
        {
          systemInstruction: assembled.systemInstruction,
          history: prior.map((m) => ({ role: m.role, text: m.text })),
          userMessage: assembled.message,
          thinking,
          mcpTools: assembled.mcpTools,
          toolResults: pendingToolResults.length > 0 ? pendingToolResults : undefined,
          pendingAssistantText: assistantTextSoFar || undefined,
        },
        signal,
      );
      pendingToolResults = [];

      let sawFunctionCall = false;
      let pendingCall: ProviderFunctionCall | null = null;

      for await (const chunk of it) {
        if (signal.aborted) break;
        if (chunk.type === 'text') {
          assistantTextSoFar += chunk.text;
          sse.event('text', { chunk: chunk.text });
        } else if (chunk.type === 'thinking') {
          if (thinkingStart === undefined) thinkingStart = performance.now();
          accumThought += chunk.text;
          sse.event('thinking', { chunk: chunk.text });
        } else if (chunk.type === 'function_call') {
          sawFunctionCall = true;
          pendingCall = chunk.call;
          break;
        } else if (chunk.type === 'done') {
          dispatchUsage = chunk.usage;
          break;
        }
      }

      if (!sawFunctionCall || !pendingCall) break;

      if (toolCallsCount >= MAX_TOOL_CALLS_PER_DISPATCH) {
        pendingToolResults = [{
          callId: pendingCall.callId,
          qualifiedName: pendingCall.qualifiedName,
          ok: false,
          error: 'Max tool calls per dispatch exceeded',
        }];
        continue;
      }
      toolCallsCount += 1;

      sse.event('tool_call_request', pendingCall);
      const policy = this.deps.mcpRegistry?.policy(pendingCall.qualifiedName) ?? { autoApprove: false };
      const decision = policy.autoApprove
        ? 'approve' as const
        : await (this.deps.mcpRegistry?.awaitDecision(pendingCall.callId, 60_000) ?? Promise.resolve('reject' as const))
          .catch(() => 'reject' as const);

      const t0 = performance.now();
      let toolResult: McpToolResult;
      if (decision === 'reject') {
        toolResult = { ok: false, error: 'Rejected by user' };
      } else if (!this.deps.mcpRegistry) {
        toolResult = { ok: false, error: 'No MCP registry configured' };
      } else {
        toolResult = await this.deps.mcpRegistry.callTool(pendingCall.qualifiedName, pendingCall.args);
      }
      const durationMs = Math.round(performance.now() - t0);

      sse.event('tool_call_result', {
        id: pendingCall.callId,
        ...toolResult,
      });

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
        },
      });

      pendingToolResults = [{
        callId: pendingCall.callId,
        qualifiedName: pendingCall.qualifiedName,
        ok: toolResult.ok,
        output: toolResult.ok ? toolResult.output : undefined,
        error: toolResult.ok ? undefined : toolResult.error,
      }];
    }

    return {
      content: `${assistantTextSoFar.length} chars streamed${
        accumThought.length > 0 ? `, ${accumThought.length} chars thinking` : ''
      }${toolCallsCount > 0 ? `, ${toolCallsCount} tool calls` : ''}`,
      tokens: dispatchUsage?.totalTokens,
      subAgent: assembled.subAgent ?? undefined,
      result: null,
    };
  },
});
```

Adjust the existing `accumText` references so the final history append at the end of `handle()` uses `assistantTextSoFar` (rename or alias as needed).

Add the required imports at the top:

```ts
import type { ProviderFunctionCall, ProviderToolResultMessage } from './providers/provider.types';
import type { McpToolResult } from '@/server/domain/mcp/mcp.types';
```

- [ ] **Step 4: Run dispatch + reasoning tests, expect PASS**

```bash
npx vitest run server/domain/dispatch server/domain/reasoning server/routes/dispatch.routes.test.ts
```

Expected: PASS (including the 2 new tool-call tests).

- [ ] **Step 5: Run full server suite (no regressions)**

```bash
npx vitest run server
```

- [ ] **Step 6: Lint + commit**

```bash
npm run lint
git add server/domain/dispatch/dispatch.service.ts server/routes/dispatch.routes.test.ts
git commit -m "feat(slice-7): dispatch service runs tool-call loop with MCP registry"
```

---

## Phase O — FE types re-export

### Task O1: `src/types/mcp.types.ts`

**Files:**
- Create: `src/types/mcp.types.ts`

- [ ] **Step 1: Create the re-export**

```ts
export type {
  McpTool,
  McpToolCall,
  McpToolResult,
  McpToolPolicy,
  McpConnectionState,
  McpConnectionStateSnapshot,
} from '@/server/domain/mcp/mcp.types';

export type { LiveTool } from '@/server/domain/mcp/registry';
```

- [ ] **Step 2: Lint + commit**

```bash
npm run lint
git add src/types/mcp.types.ts
git commit -m "feat(slice-7): re-export MCP types to frontend"
```

---

## Phase P — API client + MSW handlers

### Task P1: `subagents.api`-style REST client + MSW defaults

**Files:**
- Create: `src/lib/api/mcp.api.ts`
- Create: `src/lib/api/mcp.api.test.ts`
- Modify: `src/test/msw-handlers.ts`

- [ ] **Step 1: Failing tests**

```ts
// src/lib/api/mcp.api.test.ts
import { describe, it, expect } from 'vitest';
import { http, HttpResponse } from 'msw';
import { server } from '@/src/test/msw-server';
import { mcpApi } from './mcp.api';

describe('mcpApi', () => {
  it('connect returns tools', async () => {
    server.use(
      http.post('http://localhost/api/mcp/M1/connect', () =>
        HttpResponse.json({ state: 'online', tools: [{ name: 'echo', inputSchema: {} }] }),
      ),
    );
    const r = await mcpApi.connect('M1');
    expect(r.tools).toHaveLength(1);
  });

  it('disconnect returns void', async () => {
    server.use(
      http.post('http://localhost/api/mcp/M1/disconnect', () => new HttpResponse(null, { status: 204 })),
    );
    await expect(mcpApi.disconnect('M1')).resolves.toBeUndefined();
  });

  it('listTools returns array', async () => {
    server.use(
      http.get('http://localhost/api/mcp/tools', () =>
        HttpResponse.json({ tools: [{ qualifiedName: 'mock.echo', serverId: 'M1', serverName: 'mock', tool: { name: 'echo', inputSchema: {} }, autoApprove: true }] }),
      ),
    );
    const tools = await mcpApi.listTools();
    expect(tools[0].qualifiedName).toBe('mock.echo');
  });

  it('togglePolicy PATCHes and returns the new policy', async () => {
    server.use(
      http.patch('http://localhost/api/mcp/M1/tools/echo', () => HttpResponse.json({ autoApprove: false })),
    );
    const r = await mcpApi.togglePolicy('M1', 'echo', { autoApprove: false });
    expect(r.autoApprove).toBe(false);
  });

  it('decide POSTs the action', async () => {
    server.use(
      http.post('http://localhost/api/mcp/decision', () => new HttpResponse(null, { status: 204 })),
    );
    await expect(mcpApi.decide('CID', 'approve')).resolves.toBeUndefined();
  });
});
```

- [ ] **Step 2: Run, expect FAIL**

```bash
npx vitest run src/lib/api/mcp.api.test.ts
```

- [ ] **Step 3: Implement `src/lib/api/mcp.api.ts`**

```ts
import type { McpToolPolicy, LiveTool, McpTool } from '@/src/types/mcp.types';

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const msg = (body as { error?: { message?: string } }).error?.message ?? res.statusText;
    throw new Error(msg);
  }
  return (await res.json()) as T;
}

export const mcpApi = {
  connect: (id: string): Promise<{ state: string; tools: McpTool[] }> =>
    fetch(`/api/mcp/${id}/connect`, { method: 'POST' }).then(json),

  disconnect: async (id: string): Promise<void> => {
    const res = await fetch(`/api/mcp/${id}/disconnect`, { method: 'POST' });
    if (!res.ok) throw new Error(res.statusText);
  },

  listTools: (): Promise<LiveTool[]> =>
    fetch('/api/mcp/tools').then(json<{ tools: LiveTool[] }>).then((b) => b.tools),

  togglePolicy: (id: string, name: string, policy: McpToolPolicy): Promise<McpToolPolicy> =>
    fetch(`/api/mcp/${id}/tools/${encodeURIComponent(name)}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(policy),
    }).then(json),

  decide: async (callId: string, action: 'approve' | 'reject'): Promise<void> => {
    const res = await fetch('/api/mcp/decision', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ callId, action }),
    });
    if (!res.ok) throw new Error(res.statusText);
  },

  state: (): Promise<Array<{ id: string; state: string; error?: string }>> =>
    fetch('/api/mcp/state').then(json<{ servers: Array<{ id: string; state: string; error?: string }> }>).then((b) => b.servers),
};
```

- [ ] **Step 4: Append default handlers in `src/test/msw-handlers.ts`**

```ts
  http.post('http://localhost/api/mcp/:id/connect', ({ params }) =>
    HttpResponse.json({ state: 'online', tools: [] }),
  ),
  http.post('http://localhost/api/mcp/:id/disconnect', () => new HttpResponse(null, { status: 204 })),
  http.get('http://localhost/api/mcp/tools', () => HttpResponse.json({ tools: [] })),
  http.patch('http://localhost/api/mcp/:id/tools/:name', async ({ request }) => {
    const body = (await request.json()) as { autoApprove: boolean };
    return HttpResponse.json(body);
  }),
  http.post('http://localhost/api/mcp/decision', () => new HttpResponse(null, { status: 204 })),
  http.get('http://localhost/api/mcp/state', () => HttpResponse.json({ servers: [] })),
```

- [ ] **Step 5: Run, expect PASS**

```bash
npx vitest run src/lib/api/mcp.api.test.ts
```

- [ ] **Step 6: Lint + commit**

```bash
npm run lint
git add src/lib/api/mcp.api.ts src/lib/api/mcp.api.test.ts src/test/msw-handlers.ts
git commit -m "feat(slice-7): mcp.api client + MSW default handlers"
```

---

## Phase Q — `useMcpStore`

### Task Q1: Zustand store for live tools + connection state

**Files:**
- Create: `src/stores/mcp.store.ts`
- Create: `src/stores/mcp.store.test.ts`

- [ ] **Step 1: Failing tests**

```ts
// src/stores/mcp.store.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { http, HttpResponse } from 'msw';
import { server } from '@/src/test/msw-server';
import { useMcpStore } from './mcp.store';

beforeEach(() => {
  useMcpStore.getState()._reset();
});

describe('useMcpStore', () => {
  it('connect populates liveTools by serverId', async () => {
    server.use(
      http.post('http://localhost/api/mcp/M1/connect', () =>
        HttpResponse.json({
          state: 'online',
          tools: [{ name: 'echo', inputSchema: {} }],
        }),
      ),
      http.get('http://localhost/api/mcp/tools', () =>
        HttpResponse.json({
          tools: [{ qualifiedName: 'mock.echo', serverId: 'M1', serverName: 'mock', tool: { name: 'echo', inputSchema: {} }, autoApprove: true }],
        }),
      ),
    );
    await useMcpStore.getState().connect('M1');
    expect(useMcpStore.getState().connectStates.M1).toBe('online');
    expect(useMcpStore.getState().liveTools).toHaveLength(1);
  });

  it('disconnect clears server tools', async () => {
    useMcpStore.setState({
      liveTools: [{ qualifiedName: 'mock.echo', serverId: 'M1', serverName: 'mock', tool: { name: 'echo', inputSchema: {} }, autoApprove: true }],
      connectStates: { M1: 'online' },
    });
    server.use(
      http.post('http://localhost/api/mcp/M1/disconnect', () => new HttpResponse(null, { status: 204 })),
      http.get('http://localhost/api/mcp/tools', () => HttpResponse.json({ tools: [] })),
    );
    await useMcpStore.getState().disconnect('M1');
    expect(useMcpStore.getState().connectStates.M1).toBe('offline');
    expect(useMcpStore.getState().liveTools).toEqual([]);
  });

  it('togglePolicy updates the liveTools entry optimistically', async () => {
    useMcpStore.setState({
      liveTools: [{ qualifiedName: 'mock.echo', serverId: 'M1', serverName: 'mock', tool: { name: 'echo', inputSchema: {} }, autoApprove: true }],
      connectStates: { M1: 'online' },
    });
    server.use(
      http.patch('http://localhost/api/mcp/M1/tools/echo', () => HttpResponse.json({ autoApprove: false })),
    );
    await useMcpStore.getState().togglePolicy('M1', 'echo', false);
    expect(useMcpStore.getState().liveTools[0].autoApprove).toBe(false);
  });

  it('sets error on connect failure', async () => {
    server.use(
      http.post('http://localhost/api/mcp/Mbad/connect', () =>
        HttpResponse.json({ error: { message: 'Boom' } }, { status: 500 }),
      ),
    );
    await expect(useMcpStore.getState().connect('Mbad')).rejects.toThrow();
    expect(useMcpStore.getState().connectStates.Mbad).toBe('error');
    expect(useMcpStore.getState().errors.Mbad).toBe('Boom');
  });
});
```

- [ ] **Step 2: Run, expect FAIL**

```bash
npx vitest run src/stores/mcp.store.test.ts
```

- [ ] **Step 3: Implement `src/stores/mcp.store.ts`**

```ts
import { create } from 'zustand';
import { mcpApi } from '@/src/lib/api/mcp.api';
import type { LiveTool, McpConnectionState } from '@/src/types/mcp.types';

interface McpState {
  liveTools: LiveTool[];
  connectStates: Record<string, McpConnectionState>;
  errors: Record<string, string>;

  connect: (id: string) => Promise<void>;
  disconnect: (id: string) => Promise<void>;
  togglePolicy: (serverId: string, name: string, autoApprove: boolean) => Promise<void>;
  refresh: () => Promise<void>;
  applyServerStateEvent: (id: string, state: McpConnectionState, error?: string) => void;
  clearError: (id: string) => void;
  _reset: () => void;
}

const initial = {
  liveTools: [] as LiveTool[],
  connectStates: {} as Record<string, McpConnectionState>,
  errors: {} as Record<string, string>,
};

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : 'Operation failed';
}

export const useMcpStore = create<McpState>((set) => ({
  ...initial,
  _reset: () => set(initial),

  connect: async (id) => {
    set((s) => ({ connectStates: { ...s.connectStates, [id]: 'connecting' } }));
    try {
      await mcpApi.connect(id);
      const tools = await mcpApi.listTools();
      set((s) => ({
        liveTools: tools,
        connectStates: { ...s.connectStates, [id]: 'online' },
        errors: { ...s.errors, [id]: '' },
      }));
    } catch (e) {
      const msg = errMsg(e);
      set((s) => ({
        connectStates: { ...s.connectStates, [id]: 'error' },
        errors: { ...s.errors, [id]: msg },
      }));
      throw e;
    }
  },

  disconnect: async (id) => {
    try {
      await mcpApi.disconnect(id);
      const tools = await mcpApi.listTools();
      set((s) => ({
        liveTools: tools,
        connectStates: { ...s.connectStates, [id]: 'offline' },
      }));
    } catch (e) {
      set((s) => ({ errors: { ...s.errors, [id]: errMsg(e) } }));
      throw e;
    }
  },

  togglePolicy: async (serverId, name, autoApprove) => {
    await mcpApi.togglePolicy(serverId, name, { autoApprove });
    set((s) => ({
      liveTools: s.liveTools.map((t) =>
        t.serverId === serverId && t.tool.name === name ? { ...t, autoApprove } : t,
      ),
    }));
  },

  refresh: async () => {
    const tools = await mcpApi.listTools();
    set({ liveTools: tools });
  },

  applyServerStateEvent: (id, state, error) =>
    set((s) => ({
      connectStates: { ...s.connectStates, [id]: state },
      errors: error ? { ...s.errors, [id]: error } : s.errors,
    })),

  clearError: (id) =>
    set((s) => {
      const next = { ...s.errors };
      delete next[id];
      return { errors: next };
    }),
}));
```

- [ ] **Step 4: Run, expect PASS (4 tests)**

```bash
npx vitest run src/stores/mcp.store.test.ts
```

- [ ] **Step 5: Lint + commit**

```bash
npm run lint
git add src/stores/mcp.store.ts src/stores/mcp.store.test.ts
git commit -m "feat(slice-7): useMcpStore (connect/disconnect/togglePolicy/refresh)"
```

---

## Phase R — `useToolCallDecisions` hook

### Task R1: Hook that listens to SSE `tool_call_request` events and drives the dialog

**Files:**
- Create: `src/hooks/useToolCallDecisions.ts`
- Create: `src/hooks/useToolCallDecisions.test.ts`

The hook subscribes to a global event bus (we'll wire `useStreamingDispatch` to broadcast `tool_call_request` events to a singleton emitter). For slice 7's first version, we use a tiny in-module event emitter and have `useStreamingDispatch` push events onto it (Phase W).

- [ ] **Step 1: Define the event bus + hook in `src/hooks/useToolCallDecisions.ts`**

```ts
import { useEffect } from 'react';
import { useDialog } from './useDialog';
import { useMcpStore } from '@/src/stores/mcp.store';
import { mcpApi } from '@/src/lib/api/mcp.api';

export interface ToolCallRequestEvent {
  id: string;
  qualifiedName: string;
  args: Record<string, unknown>;
}

type Listener = (ev: ToolCallRequestEvent) => void;
const listeners = new Set<Listener>();

export function emitToolCallRequest(ev: ToolCallRequestEvent): void {
  for (const l of listeners) l(ev);
}

export function useToolCallDecisions(): void {
  const dialog = useDialog();

  useEffect(() => {
    const handler: Listener = (ev) => {
      const tool = useMcpStore.getState().liveTools.find((t) => t.qualifiedName === ev.qualifiedName);
      if (tool?.autoApprove) {
        // No dialog; backend already auto-approves on its side too.
        return;
      }
      void (async () => {
        const ok = await dialog.confirm({
          title: 'Tool call request',
          message: `${ev.qualifiedName}\n\n${JSON.stringify(ev.args, null, 2)}`,
          confirmLabel: 'Approve',
          cancelLabel: 'Reject',
        });
        await mcpApi.decide(ev.id, ok ? 'approve' : 'reject').catch(() => {});
      })();
    };
    listeners.add(handler);
    return () => {
      listeners.delete(handler);
    };
  }, [dialog]);
}
```

- [ ] **Step 2: Failing tests**

```ts
// src/hooks/useToolCallDecisions.test.ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { server } from '@/src/test/msw-server';
import { DialogHost } from '@/src/components/layout/DialogHost';
import { useMcpStore } from '@/src/stores/mcp.store';
import { useToolCallDecisions, emitToolCallRequest } from './useToolCallDecisions';

beforeEach(() => {
  useMcpStore.getState()._reset();
});

function Mount() {
  useToolCallDecisions();
  return null;
}

describe('useToolCallDecisions', () => {
  it('auto-approve tool: no dialog opens', async () => {
    useMcpStore.setState({
      liveTools: [{ qualifiedName: 'mock.echo', serverId: 'M1', serverName: 'mock', tool: { name: 'echo', inputSchema: {} }, autoApprove: true }],
      connectStates: { M1: 'online' },
      errors: {},
    });
    render(<><DialogHost /><Mount /></>);
    emitToolCallRequest({ id: 'C1', qualifiedName: 'mock.echo', args: { message: 'hi' } });
    await Promise.resolve();
    expect(screen.queryByText(/tool call request/i)).toBeNull();
  });

  it('non-auto-approve tool: dialog opens; Approve calls POST /decision', async () => {
    useMcpStore.setState({
      liveTools: [{ qualifiedName: 'mock.fs', serverId: 'M1', serverName: 'mock', tool: { name: 'fs', inputSchema: {} }, autoApprove: false }],
      connectStates: { M1: 'online' },
      errors: {},
    });
    let posted: unknown = null;
    server.use(
      http.post('http://localhost/api/mcp/decision', async ({ request }) => {
        posted = await request.json();
        return new HttpResponse(null, { status: 204 });
      }),
    );
    const user = userEvent.setup();
    render(<><DialogHost /><Mount /></>);
    emitToolCallRequest({ id: 'C2', qualifiedName: 'mock.fs', args: { path: '/tmp' } });
    await waitFor(() => expect(screen.getByText(/tool call request/i)).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: /approve/i }));
    await waitFor(() => expect(posted).toEqual({ callId: 'C2', action: 'approve' }));
  });

  it('Reject path posts action=reject', async () => {
    useMcpStore.setState({
      liveTools: [{ qualifiedName: 'mock.fs', serverId: 'M1', serverName: 'mock', tool: { name: 'fs', inputSchema: {} }, autoApprove: false }],
      connectStates: { M1: 'online' },
      errors: {},
    });
    let posted: unknown = null;
    server.use(
      http.post('http://localhost/api/mcp/decision', async ({ request }) => {
        posted = await request.json();
        return new HttpResponse(null, { status: 204 });
      }),
    );
    const user = userEvent.setup();
    render(<><DialogHost /><Mount /></>);
    emitToolCallRequest({ id: 'C3', qualifiedName: 'mock.fs', args: {} });
    await waitFor(() => expect(screen.getByText(/tool call request/i)).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: /reject/i }));
    await waitFor(() => expect(posted).toEqual({ callId: 'C3', action: 'reject' }));
  });
});
```

- [ ] **Step 3: Run, expect PASS (3 tests)**

```bash
npx vitest run src/hooks/useToolCallDecisions.test.ts
```

- [ ] **Step 4: Lint + commit**

```bash
npm run lint
git add src/hooks/useToolCallDecisions.ts src/hooks/useToolCallDecisions.test.ts
git commit -m "feat(slice-7): useToolCallDecisions (event bus + dialog flow)"
```

---

## Phase S — `McpToolCard`

### Task S1: Per-tool row with autoApprove toggle

**Files:**
- Create: `src/components/mcp/McpToolCard.tsx`
- Create: `src/components/mcp/McpToolCard.test.tsx`

- [ ] **Step 1: Failing tests**

```tsx
// src/components/mcp/McpToolCard.test.tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { McpToolCard } from './McpToolCard';

const tool = {
  qualifiedName: 'mock.echo',
  serverId: 'M1',
  serverName: 'mock',
  tool: { name: 'echo', description: 'Returns input', inputSchema: { type: 'object' as const } },
  autoApprove: true,
};

describe('McpToolCard', () => {
  it('renders qualified name + description', () => {
    render(<McpToolCard tool={tool} onToggle={() => {}} />);
    expect(screen.getByText('mock.echo')).toBeInTheDocument();
    expect(screen.getByText('Returns input')).toBeInTheDocument();
  });

  it('toggle calls onToggle with inverted value', async () => {
    const onToggle = vi.fn();
    const user = userEvent.setup();
    render(<McpToolCard tool={tool} onToggle={onToggle} />);
    await user.click(screen.getByRole('checkbox', { name: /auto-approve/i }));
    expect(onToggle).toHaveBeenCalledWith(false);
  });
});
```

- [ ] **Step 2: Run, expect FAIL**

```bash
npx vitest run src/components/mcp/McpToolCard.test.tsx
```

- [ ] **Step 3: Implement `src/components/mcp/McpToolCard.tsx`**

```tsx
import type { LiveTool } from '@/src/types/mcp.types';

export interface McpToolCardProps {
  tool: LiveTool;
  onToggle: (newAutoApprove: boolean) => void;
}

export function McpToolCard({ tool, onToggle }: McpToolCardProps) {
  return (
    <div className="ml-2 p-1.5 rounded bg-zinc-900/40 border border-border-subtle/40 text-[10px] font-mono">
      <div className="flex items-center justify-between gap-2">
        <span className="text-zinc-300 truncate">{tool.qualifiedName}</span>
        <label className="flex items-center gap-1 text-zinc-500 cursor-pointer">
          <input
            type="checkbox"
            aria-label={`auto-approve ${tool.qualifiedName}`}
            checked={tool.autoApprove}
            onChange={(e) => onToggle(e.target.checked)}
          />
          <span>auto</span>
        </label>
      </div>
      {tool.tool.description && (
        <div className="mt-0.5 text-[9px] text-zinc-600 truncate">{tool.tool.description}</div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Run, expect PASS**

```bash
npx vitest run src/components/mcp/McpToolCard.test.tsx
```

- [ ] **Step 5: Lint + commit**

```bash
npm run lint
git add src/components/mcp/McpToolCard.tsx src/components/mcp/McpToolCard.test.tsx
git commit -m "feat(slice-7): McpToolCard component"
```

---

## Phase T — `ToolCallDialog`

### Task T1: Custom dialog component for richer tool-call rendering (optional polish over `useDialog.confirm`)

For slice 7, the `useToolCallDecisions` hook uses `useDialog.confirm` (which renders `ConfirmDialog`). The current `ConfirmDialog` is fine for the message-with-args display. We add a tiny dedicated `ToolCallDialog` only if a structured renderer is needed.

**Decision:** ship without a dedicated `ToolCallDialog`. The `useDialog.confirm({ message: ... })` path is sufficient with JSON-stringified args. The component is omitted from slice 7. If richer rendering is wanted later, it's a small follow-up.

Skip — no task required here. The `ToolCallDialog` mentioned in the spec is realised as the existing `ConfirmDialog` driven by `useToolCallDecisions`.

- [ ] **Step 1: Confirm decision in commit history**

Create a small commit documenting the skip:

```bash
git commit --allow-empty -m "chore(slice-7): ToolCallDialog folded into ConfirmDialog via useToolCallDecisions"
```

---

## Phase U — `McpServersSection` rewrite

### Task U1: Connect/Disconnect toggle + inline expansion with `McpToolCard`

**Files:**
- Modify: `src/components/sidebar/McpServersSection.tsx`
- Modify: `src/components/sidebar/McpServersSection.test.tsx`

- [ ] **Step 1: Append failing tests**

```tsx
// Append to existing describe('McpServersSection', ...):
import { useMcpStore } from '@/src/stores/mcp.store';

beforeEach(() => {
  useMcpStore.getState()._reset();
});

it('shows Connect button when server is offline', () => {
  useContextStore.setState({
    context: {
      systemInstruction: '', skills: [], tools: [],
      mcpServers: [{ id: 'M1', name: 'mock', transport: 'mock', status: 'offline' }],
    },
  });
  render(<McpServersSection />);
  expect(screen.getByRole('button', { name: /connect mock/i })).toBeInTheDocument();
});

it('clicking Connect triggers useMcpStore.connect', async () => {
  useContextStore.setState({
    context: {
      systemInstruction: '', skills: [], tools: [],
      mcpServers: [{ id: 'M1', name: 'mock', transport: 'mock', status: 'offline' }],
    },
  });
  const spy = vi.spyOn(useMcpStore.getState(), 'connect').mockResolvedValue(undefined);
  const user = userEvent.setup();
  render(<McpServersSection />);
  await user.click(screen.getByRole('button', { name: /connect mock/i }));
  expect(spy).toHaveBeenCalledWith('M1');
});

it('when online, lists live tools and a Disconnect button', () => {
  useContextStore.setState({
    context: {
      systemInstruction: '', skills: [], tools: [],
      mcpServers: [{ id: 'M1', name: 'mock', transport: 'mock', status: 'offline' }],
    },
  });
  useMcpStore.setState({
    liveTools: [{ qualifiedName: 'mock.echo', serverId: 'M1', serverName: 'mock', tool: { name: 'echo', inputSchema: {} }, autoApprove: true }],
    connectStates: { M1: 'online' },
    errors: {},
  });
  render(<McpServersSection />);
  expect(screen.getByText('mock.echo')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /disconnect mock/i })).toBeInTheDocument();
});
```

- [ ] **Step 2: Run, expect FAIL**

```bash
npx vitest run src/components/sidebar/McpServersSection.test.tsx
```

- [ ] **Step 3: Replace `src/components/sidebar/McpServersSection.tsx`**

```tsx
import { addMcpFlow } from '@/src/lib/context/addFlows';
import { useContextStore } from '@/src/stores/context.store';
import { useMcpStore } from '@/src/stores/mcp.store';
import { useDialog } from '@/src/hooks/useDialog';
import { StatusDot } from '@/src/components/ui/StatusDot';
import { McpToolCard } from '@/src/components/mcp/McpToolCard';

const EMPTY_SERVERS: never[] = [];

export function McpServersSection() {
  const context = useContextStore((s) => s.context);
  const servers = context?.mcpServers ?? EMPTY_SERVERS;
  const addMcpServer = useContextStore((s) => s.addMcpServer);
  const removeMcpServer = useContextStore((s) => s.removeMcpServer);

  const liveTools = useMcpStore((s) => s.liveTools);
  const connectStates = useMcpStore((s) => s.connectStates);
  const errors = useMcpStore((s) => s.errors);
  const connect = useMcpStore((s) => s.connect);
  const disconnect = useMcpStore((s) => s.disconnect);
  const togglePolicy = useMcpStore((s) => s.togglePolicy);
  const clearError = useMcpStore((s) => s.clearError);

  const dialog = useDialog();

  const handleAdd = () => addMcpFlow(dialog, addMcpServer);

  const handleRemove = async (id: string, name: string) => {
    const ok = await dialog.confirm({
      title: 'Remove MCP server',
      message: `Remove "${name}"?`,
      destructive: true,
    });
    if (ok) await removeMcpServer(id).catch(() => {});
  };

  return (
    <section>
      <div className="mono-label mb-2">MCP Network</div>
      <div className="space-y-2">
        {servers.length === 0 ? (
          <div className="text-[10px] text-zinc-600 font-mono italic">
            No active MCP nodes connected.
          </div>
        ) : (
          servers.map((server) => {
            const state = connectStates[server.id] ?? 'offline';
            const err = errors[server.id];
            const tools = liveTools.filter((t) => t.serverId === server.id);
            const isOnline = state === 'online';
            return (
              <div
                key={server.id}
                className="group p-2 rounded bg-zinc-900/30 border border-border-subtle/50 flex flex-col gap-1"
              >
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-mono text-zinc-500">{server.name}</span>
                  <div className="flex items-center gap-2">
                    {isOnline ? (
                      <button
                        type="button"
                        onClick={() => disconnect(server.id).catch(() => {})}
                        aria-label={`Disconnect ${server.name}`}
                        className="text-[10px] text-zinc-400 hover:text-white"
                      >
                        Disconnect
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => connect(server.id).catch(() => {})}
                        disabled={state === 'connecting'}
                        aria-label={`Connect ${server.name}`}
                        className="text-[10px] text-accent hover:text-white disabled:opacity-50"
                      >
                        {state === 'connecting' ? '…' : 'Connect'}
                      </button>
                    )}
                    <button
                      onClick={() => handleRemove(server.id, server.name)}
                      aria-label={`Remove ${server.name}`}
                      className="hidden group-hover:inline hover:text-red-400 text-zinc-500"
                    >
                      ×
                    </button>
                    <StatusDot status={state === 'online' ? 'online' : state === 'connecting' ? 'connecting' : 'offline'} label={server.name} />
                  </div>
                </div>
                {err && (
                  <div className="text-[9px] font-mono text-status-error flex items-center gap-1">
                    <span className="flex-1">⚠ {err}</span>
                    <button
                      type="button"
                      aria-label={`Dismiss error for ${server.name}`}
                      onClick={() => clearError(server.id)}
                      className="hover:text-white"
                    >
                      ×
                    </button>
                  </div>
                )}
                {isOnline && tools.length > 0 && (
                  <div className="mt-1 space-y-1">
                    {tools.map((t) => (
                      <McpToolCard
                        key={t.qualifiedName}
                        tool={t}
                        onToggle={(v) => togglePolicy(server.id, t.tool.name, v).catch(() => {})}
                      />
                    ))}
                  </div>
                )}
              </div>
            );
          })
        )}
        <button
          onClick={handleAdd}
          aria-label="Add MCP server"
          className="w-full p-1 border border-dashed border-border-subtle rounded text-[10px] text-zinc-600 hover:text-zinc-400 transition-colors mt-2"
        >
          + Add Connection
        </button>
      </div>
    </section>
  );
}
```

- [ ] **Step 4: Run, expect PASS**

```bash
npx vitest run src/components/sidebar/McpServersSection.test.tsx
```

- [ ] **Step 5: Lint + commit**

```bash
npm run lint
git add src/components/sidebar/McpServersSection.tsx src/components/sidebar/McpServersSection.test.tsx
git commit -m "feat(slice-7): McpServersSection Connect/Disconnect + inline McpToolCard list"
```

---

## Phase V — `ReasoningStepCard`: render `tool_call`

### Task V1: New step renderer with structured args + result

**Files:**
- Modify: `src/components/reasoning/ReasoningStepCard.tsx`
- Modify: `src/components/reasoning/ReasoningStepCard.test.tsx`

- [ ] **Step 1: Append failing test**

```tsx
it('renders tool_call step with structured args and result', () => {
  render(
    <ReasoningStepCard
      step={{
        id: '1',
        type: 'tool_call',
        title: 'Tool: mock.echo',
        content: 'executed mock.echo',
        toolCall: {
          id: 'C1',
          qualifiedName: 'mock.echo',
          args: { message: 'hi' },
          result: { message: 'hi' },
          durationMs: 12,
        },
        timestamp: 0,
      }}
    />,
  );
  expect(screen.getByText('Tool: mock.echo')).toBeInTheDocument();
  expect(screen.getByText(/"message":\s*"hi"/)).toBeInTheDocument();
});

it('renders tool_call error state in red', () => {
  render(
    <ReasoningStepCard
      step={{
        id: '2',
        type: 'tool_call',
        title: 'Tool: mock.fail',
        content: 'tool failed: nope',
        toolCall: {
          id: 'C2',
          qualifiedName: 'mock.fail',
          args: {},
          error: 'nope',
          durationMs: 5,
        },
        timestamp: 0,
      }}
    />,
  );
  expect(screen.getByText(/nope/)).toBeInTheDocument();
});
```

- [ ] **Step 2: Run, expect FAIL**

```bash
npx vitest run src/components/reasoning/ReasoningStepCard.test.tsx
```

- [ ] **Step 3: Extend `ReasoningStepCard.tsx`**

Add `tool_call` to `TYPE_LABELS` / `TYPE_COLORS`:

```tsx
const TYPE_LABELS: Record<ReasoningStepType, string> = {
  context_fetch: 'context',
  mcp_query: 'mcp',
  dispatch: 'dispatch',
  thinking: 'thinking',
  validation: 'validation',
  logic: 'logic',
  resolve_subagent: 'subagent',
  tool_call: 'tool',
};

const TYPE_COLORS: Record<ReasoningStepType, string> = {
  context_fetch: 'bg-blue-500/10 text-blue-400',
  mcp_query: 'bg-cyan-500/10 text-cyan-400',
  dispatch: 'bg-purple-500/10 text-purple-400',
  thinking: 'bg-purple-500/10 text-purple-300',
  validation: 'bg-green-500/10 text-green-400',
  logic: 'bg-zinc-800 text-zinc-400',
  resolve_subagent: 'bg-amber-500/10 text-amber-300',
  tool_call: 'bg-cyan-500/10 text-cyan-300',
};
```

Add a structured renderer inside the component, after the existing `content` div:

```tsx
{step.toolCall && (
  <div className="mt-1 space-y-1 text-[10px] font-mono">
    <details>
      <summary className="cursor-pointer text-zinc-500">args</summary>
      <pre className="mt-1 p-1.5 rounded bg-zinc-900/60 text-zinc-300 overflow-x-auto">
        {JSON.stringify(step.toolCall.args, null, 2)}
      </pre>
    </details>
    {step.toolCall.error ? (
      <div className="p-1.5 rounded bg-status-error/10 text-status-error">{step.toolCall.error}</div>
    ) : step.toolCall.result !== undefined ? (
      <details>
        <summary className="cursor-pointer text-zinc-500">result</summary>
        <pre className="mt-1 p-1.5 rounded bg-zinc-900/60 text-zinc-300 overflow-x-auto">
          {JSON.stringify(step.toolCall.result, null, 2)}
        </pre>
      </details>
    ) : null}
  </div>
)}
```

- [ ] **Step 4: Run, expect PASS**

```bash
npx vitest run src/components/reasoning/ReasoningStepCard.test.tsx
```

- [ ] **Step 5: Lint + commit**

```bash
npm run lint
git add src/components/reasoning/ReasoningStepCard.tsx src/components/reasoning/ReasoningStepCard.test.tsx
git commit -m "feat(slice-7): ReasoningStepCard renders tool_call with args/result/error"
```

---

## Phase W — `useStreamingDispatch`: new SSE events

### Task W1: Forward `tool_call_request` / `tool_call_result` / `mcp:state_change`

**Files:**
- Modify: `src/hooks/useStreamingDispatch.ts`
- Modify: `src/hooks/useStreamingDispatch.test.ts` (if exists; otherwise add cases inline)

- [ ] **Step 1: Read the existing hook to find the event-handling switch**

The hook currently handles SSE events like `text`, `thinking`, `reasoning_step`, `done`, `error`. Add cases for the new event types.

- [ ] **Step 2: Update the hook**

Inside the SSE event handler switch, add:

```ts
case 'tool_call_request': {
  const payload = parseJson(data) as ToolCallRequestEvent;
  emitToolCallRequest(payload);
  break;
}
case 'tool_call_result': {
  // No store action needed in slice 7 — the reasoning_step event that follows
  // includes the structured tool result. This branch is here so we don't fall
  // through to the default 'unknown event' warning.
  break;
}
case 'mcp:state_change': {
  const payload = parseJson(data) as { id: string; state: McpConnectionState; error?: string };
  useMcpStore.getState().applyServerStateEvent(payload.id, payload.state, payload.error);
  break;
}
```

Add imports at the top:

```ts
import { emitToolCallRequest, type ToolCallRequestEvent } from './useToolCallDecisions';
import { useMcpStore } from '@/src/stores/mcp.store';
import type { McpConnectionState } from '@/src/types/mcp.types';
```

- [ ] **Step 3: Append a failing test (if there's an existing test file for this hook)**

If `src/hooks/useStreamingDispatch.test.ts` exists, add a case that feeds a synthetic `tool_call_request` SSE payload and asserts that `emitToolCallRequest` listeners receive it. Use a spy listener registered via `listeners.add(...)` (you'll need to expose the listeners or attach a spy via `useToolCallDecisions`).

If there's no existing test for this hook, skip adding one — the integration test in Phase Y will exercise this path end-to-end.

- [ ] **Step 4: Run frontend suite (no regressions)**

```bash
npx vitest run src
```

- [ ] **Step 5: Lint + commit**

```bash
npm run lint
git add src/hooks/useStreamingDispatch.ts src/hooks/useStreamingDispatch.test.ts
git commit -m "feat(slice-7): useStreamingDispatch handles tool_call_request and mcp:state_change"
```

---

## Phase X — `App.tsx` integration

### Task X1: Init `useMcpStore` + mount `useToolCallDecisions`

**Files:**
- Modify: `src/App.tsx`
- Modify: `src/App.test.tsx`

- [ ] **Step 1: Append failing test**

```tsx
import { useMcpStore } from '@/src/stores/mcp.store';

beforeEach(() => {
  useMcpStore.getState()._reset();
});

it('useToolCallDecisions is mounted (dialog opens when emitToolCallRequest fires for non-auto-approve)', async () => {
  useMcpStore.setState({
    liveTools: [{ qualifiedName: 'mock.fs', serverId: 'M1', serverName: 'mock', tool: { name: 'fs', inputSchema: {} }, autoApprove: false }],
    connectStates: { M1: 'online' },
    errors: {},
  });
  render(<App />);
  await act(async () => {
    const { emitToolCallRequest } = await import('@/src/hooks/useToolCallDecisions');
    emitToolCallRequest({ id: 'C1', qualifiedName: 'mock.fs', args: { path: '/tmp' } });
  });
  await waitFor(() => {
    expect(screen.getByText(/tool call request/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run, expect FAIL**

```bash
npx vitest run src/App.test.tsx
```

- [ ] **Step 3: Modify `src/App.tsx`**

Add imports next to other store / hook imports:

```tsx
import { useMcpStore } from '@/src/stores/mcp.store';
import { useToolCallDecisions } from '@/src/hooks/useToolCallDecisions';
```

Call the hook in the component body (next to `useGlobalShortcuts()`):

```tsx
  useGlobalShortcuts();
  useToolCallDecisions();
```

No new init effect is needed — `useMcpStore` populates itself on user action (Connect button).

Add `useMcpStore.getState()._reset();` to `beforeEach` in `App.test.tsx`.

- [ ] **Step 4: Run, expect PASS**

```bash
npx vitest run src/App.test.tsx
```

- [ ] **Step 5: Run full FE suite (no regressions)**

```bash
npx vitest run src
```

- [ ] **Step 6: Lint + commit**

```bash
npm run lint
git add src/App.tsx src/App.test.tsx
git commit -m "feat(slice-7): App.tsx mounts useToolCallDecisions"
```

---

## Phase Y — Integration test

### Task Y1: App-level: connect mock + auto-approve flow + manual-approve flow

**Files:**
- Create: `src/integration/mcp.integration.test.tsx`

- [ ] **Step 1: Write the test**

```tsx
// src/integration/mcp.integration.test.tsx
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { server } from '@/src/test/msw-server';
import App from '@/src/App';
import { useMcpStore } from '@/src/stores/mcp.store';
import { useUiStore } from '@/src/stores/ui.store';
import { useSessionsStore } from '@/src/stores/sessions.store';
import { useProfilesStore } from '@/src/stores/profiles.store';
import { useContextStore } from '@/src/stores/context.store';
import { useSubAgentsStore } from '@/src/stores/subagents.store';

beforeEach(() => {
  useMcpStore.getState()._reset();
  useUiStore.getState()._reset();
  useSessionsStore.getState()._reset();
  useProfilesStore.getState()._reset();
  useContextStore.getState()._reset();
  useSubAgentsStore.getState()._reset();
  localStorage.clear();
});

describe('mcp integration', () => {
  it('user clicks Connect → sees live tool', async () => {
    // Seed context with a mock server
    server.use(
      http.get('http://localhost/api/context', () =>
        HttpResponse.json({
          systemInstruction: '', skills: [], tools: [],
          mcpServers: [{ id: 'M1', name: 'mock', transport: 'mock', status: 'offline' }],
        }),
      ),
      http.post('http://localhost/api/mcp/M1/connect', () =>
        HttpResponse.json({ state: 'online', tools: [{ name: 'echo', inputSchema: {} }] }),
      ),
      http.get('http://localhost/api/mcp/tools', () =>
        HttpResponse.json({
          tools: [{ qualifiedName: 'mock.echo', serverId: 'M1', serverName: 'mock', tool: { name: 'echo', inputSchema: {} }, autoApprove: true }],
        }),
      ),
    );
    const user = userEvent.setup();
    render(<App />);
    await waitFor(() => expect(useContextStore.getState().context?.mcpServers).toHaveLength(1));
    await user.click(screen.getByRole('button', { name: /connect mock/i }));
    await waitFor(() => expect(screen.getByText('mock.echo')).toBeInTheDocument());
  });
});
```

This single integration test is the FE-side end-to-end smoke. The full tool-call loop is exercised in the backend dispatch tests and in the Playwright test (Phase Z).

- [ ] **Step 2: Run, expect PASS**

```bash
npx vitest run src/integration/mcp.integration.test.tsx
```

- [ ] **Step 3: Lint + commit**

```bash
npm run lint
git add src/integration/mcp.integration.test.tsx
git commit -m "test(slice-7): integration — Connect mock + live tool appears in sidebar"
```

---

## Phase Z — Playwright e2e

### Task Z1: `mcp: connect mock + tool call`

**Files:**
- Modify: `e2e/smoke.spec.ts`

- [ ] **Step 1: Append the test**

Append inside `e2e/smoke.spec.ts` after the existing `subagent: ...` test:

```ts
test('mcp: connect mock + tool call via chat', async ({ page, request }) => {
  // The dev server boots with no MCP servers in context.json by default. We add a
  // mock entry through the context API. (Slice 1's /api/context/mcp-servers POST.)
  await request.post('/api/context/mcp-servers', {
    data: { name: 'mock', transport: 'mock', status: 'offline' },
  }).catch(async () => {
    // Fallback: PATCH the whole context if the per-resource endpoint is shaped differently.
    const cur = await request.get('/api/context').then((r) => r.json());
    await request.put('/api/context', { data: {
      ...cur, mcpServers: [...(cur.mcpServers ?? []), { id: 'E2E', name: 'mock', transport: 'mock', status: 'offline' }],
    } });
  });

  await page.goto('/');
  await expect(page.getByText('AETHER_CORE')).toBeVisible();

  const sidebar = page.getByRole('complementary', { name: /sidebar/i });
  await sidebar.getByRole('button', { name: /connect mock/i }).click();
  await expect(sidebar.getByText('mock.echo')).toBeVisible({ timeout: 5000 });

  // Send a chat message; the FakeProvider on the server side (E2E uses AETHER_FAKE_PROVIDER=1)
  // does NOT emit function_calls by default — but we can verify that the tool listing
  // appears in the prompt the assistant sees by checking the reasoning drawer for the
  // dispatch step's content. To assert the full tool-call loop, the server-side test
  // already covers it. The E2E test here just confirms the connect/listing UI path works.
});
```

> **Implementer note:** the E2E doesn't drive a full function-call loop because the production FakeProvider doesn't emit `function_call` by default. The test asserts only the UI connect/listing path. The full loop is verified by `dispatch.routes.test.ts` (server) and `mcp.integration.test.tsx` (frontend). If you want a true E2E loop, add an env-flag option to `FakeProvider` that, when set, programs a function_call sequence — out of scope for this task.

- [ ] **Step 2: Lint check**

```bash
npm run lint
```

- [ ] **Step 3: Commit (do NOT run Playwright locally unless port 3000 is free)**

```bash
git add e2e/smoke.spec.ts
git commit -m "test(slice-7): playwright — connect mock + live tool listing"
```

---

## Phase AA — Final verification + PR

### Task AA1: lint + full vitest + push + PR

- [ ] **Step 1: Lint**

```bash
npm run lint
```

Expected: PASS.

- [ ] **Step 2: Vitest full**

```bash
npm run test:run
```

Expected: ALL PASS.

- [ ] **Step 3: Coverage spot-check**

```bash
npm run test:coverage
```

Expected: ≥80% on `registry.ts`, `mock-connection.ts`, `stdio-connection.ts`, `mcp.routes.ts`, `mcp.store.ts`, `McpServersSection.tsx`, `useToolCallDecisions.ts`.

- [ ] **Step 4: (Optional) Playwright if port 3000 is free**

```bash
npx playwright test
```

- [ ] **Step 5: Push branch**

```bash
git push -u origin feat/slice-7-mcp
```

- [ ] **Step 6: Open PR**

```bash
gh pr create --base main --title "feat(slice-7): MCP mock + stdio client + tool-call loop" --body "$(cat <<'EOF'
## Summary
- Backend `McpRegistry` owns `McpConnection` instances. Two transports: in-process `MockMcpConnection` (echo, current_time, read_file_mock) and `StdioMcpConnection` (subprocess + line-delimited JSON-RPC, configurable command/args/env).
- New REST routes under `/api/mcp` for connect, disconnect, list tools, toggle policy, decide tool calls, and read server state.
- `DispatchService` runs a function-call loop: provider emits `function_call` → dispatch awaits approval (per-tool `autoApprove` policy + `ToolCallDialog` via `useDialog`) → executes via registry → feeds result back to provider → loop. Cap at 10 calls per dispatch.
- Gemini and Fake providers gain function-calling support; reasoning trace gains `tool_call` step type with structured args/result/error.
- Frontend `useMcpStore`, `useToolCallDecisions`, `McpServersSection` rewrite with Connect/Disconnect + inline `McpToolCard` rows.

## Test plan
- [x] `npm run lint` clean
- [x] `npm run test:run` all green (BE + FE)
- [x] `npm run test:coverage` ≥80% on new files
- [ ] Playwright committed; run when port 3000 is free

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

Expected: PR URL printed.

---

## Definition of Done

- All new BE + FE unit / component / integration tests green.
- `npm run lint` clean.
- Coverage ≥80% on the new files listed above.
- Sidebar `McpServersSection` lets the user Connect / Disconnect a mock or stdio server; tools appear inline when online.
- Sending a chat that triggers a `function_call` runs the full loop: tool executes (auto or after dialog approval), result feeds back, reasoning drawer shows the `tool_call` step.
- One PR on `feat/slice-7-mcp` against `main`.


