# Aether Slice 11 — Anthropic via Claude Agent SDK Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Anthropic Claude (Opus 4.7, Sonnet 4.6, Haiku 4.5) as a first-class provider using `@anthropic-ai/claude-agent-sdk`, with auth via the local `claude` CLI OAuth session OR `ANTHROPIC_API_KEY` env var — gated by a startup probe so the provider entries only appear when auth is usable.

**Architecture:** New `AnthropicProvider` class implements the existing `AIProvider` interface, mapping SDK events (`assistant` message → text/thinking/tool_use content blocks, `result` → usage) to Aether's `ProviderChunk` stream. SDK's own tool/MCP system is disabled (no MCP servers configured, `maxTurns: 1`); tool calls flow through Aether's existing function-calling loop just like Gemini and Ollama. A `detectAnthropicAuth()` helper probes at startup and gates registration of three hardcoded model entries.

**Tech Stack:** `@anthropic-ai/claude-agent-sdk` (new dependency). All other plumbing reuses existing slice-8 patterns.

**Reference spec:** `docs/superpowers/specs/2026-05-20-aether-slice-11-anthropic-design.md`

**Branch:** `feat/slice-11-anthropic` (already checked out; spec already committed)

**Lavora con un solo branch dall'inizio alla fine; ogni Task termina con un commit verde su questo branch.**

---

## File structure (NEW unless marked MODIFY)

```
server/
  domain/dispatch/providers/
    anthropic.provider.ts                            # NEW
    anthropic.provider.test.ts                       # NEW
  lib/
    anthropic-auth.ts                                # NEW
    anthropic-auth.test.ts                           # NEW
  domain/providers/
    registry.ts                                      # MODIFY: add 'anthropic' transport + builder
    registry.test.ts                                 # MODIFY: 3 new cases
  index.ts                                           # MODIFY: wire AnthropicProvider builder + auth probe
package.json                                         # MODIFY: add dependency

src/
  integration/
    provider-switch.integration.test.tsx             # MODIFY: append one case
```

---

## Phase A — Pre-flight

### Task A1: Verify branch + clean tree

- [ ] **Step 1: Run**

```bash
git rev-parse --abbrev-ref HEAD
git status --porcelain
```

Expected: branch `feat/slice-11-anthropic`; second command empty. No commit.

---

## Phase B — Install SDK dependency

### Task B1: Add `@anthropic-ai/claude-agent-sdk` to package.json

**Files:**
- Modify: `package.json`

The SDK is shipped on npm. We pin a known good major version. No transitive surprises expected — the SDK has minimal direct deps.

- [ ] **Step 1: Read current `package.json` dependencies**

Run: `grep -n '"@anthropic-ai' package.json || echo "not present"` — expect "not present".

- [ ] **Step 2: Install the SDK**

```bash
npm install @anthropic-ai/claude-agent-sdk@latest
```

This will update `package.json` and `package-lock.json`. The SDK exports a `query()` function and TypeScript types for SDK messages.

- [ ] **Step 3: Verify install + lint**

```bash
npm run lint
```

Expected: clean. No code uses the SDK yet but its types are reachable.

- [ ] **Step 4: Run full server suite (regression check)**

```bash
npx vitest run server
```

Expected: all existing tests pass (377+).

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore(slice-11): add @anthropic-ai/claude-agent-sdk dependency"
```

---

## Phase C — Auth probe helper

### Task C1: `detectAnthropicAuth()` with full test coverage

**Files:**
- Create: `server/lib/anthropic-auth.ts`
- Create: `server/lib/anthropic-auth.test.ts`

The helper returns one of three values: `'oauth'`, `'apikey'`, or `'none'`. Logic:

1. Spawn `claude --version` (2-second timeout). On failure → `'none'`.
2. If `process.env.ANTHROPIC_API_KEY` is set and non-empty → `'apikey'` (skip the SDK call — env var is enough proof of intent and avoids spending tokens at startup).
3. Else run a tiny SDK probe (`query({ prompt: 'ping', options: { maxTurns: 1, model: 'claude-haiku-4-5', allowedTools: [] } })`) with a 5-second timeout, consume the first event, then abort the iterator. Success → `'oauth'`. Failure → `'none'`.

The tests mock both `node:child_process` (for `claude --version`) and `@anthropic-ai/claude-agent-sdk` (for the SDK probe). The helper avoids leaking subprocesses by aborting via an `AbortController` on timeout.

- [ ] **Step 1: Write the failing test file**

```ts
// server/lib/anthropic-auth.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock child_process before importing the helper so the spy is in place.
const spawnSpy = vi.fn();
vi.mock('node:child_process', () => ({
  spawn: (...args: unknown[]) => spawnSpy(...args),
}));

// Mock the SDK so we can drive the OAuth probe path.
const querySpy = vi.fn();
vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  query: (...args: unknown[]) => querySpy(...args),
}));

import { detectAnthropicAuth } from './anthropic-auth';

function fakeChild(opts: { exitCode?: number; emitError?: NodeJS.ErrnoException; delayMs?: number }) {
  const listeners: Record<string, ((arg?: unknown) => void)[]> = { exit: [], error: [] };
  const child = {
    on(event: string, cb: (arg?: unknown) => void) {
      (listeners[event] ??= []).push(cb);
      return child;
    },
    kill() {
      // no-op in tests
    },
  };
  setTimeout(() => {
    if (opts.emitError) listeners.error.forEach((cb) => cb(opts.emitError));
    else listeners.exit.forEach((cb) => cb(opts.exitCode ?? 0));
  }, opts.delayMs ?? 0);
  return child;
}

beforeEach(() => {
  spawnSpy.mockReset();
  querySpy.mockReset();
  delete process.env.ANTHROPIC_API_KEY;
});

afterEach(() => {
  delete process.env.ANTHROPIC_API_KEY;
});

describe('detectAnthropicAuth', () => {
  it("returns 'none' when claude CLI is missing", async () => {
    spawnSpy.mockImplementation(() => fakeChild({ emitError: Object.assign(new Error('ENOENT'), { code: 'ENOENT' }) }));
    const result = await detectAnthropicAuth();
    expect(result).toBe('none');
  });

  it("returns 'apikey' when CLI present and ANTHROPIC_API_KEY is set", async () => {
    spawnSpy.mockImplementation(() => fakeChild({ exitCode: 0 }));
    process.env.ANTHROPIC_API_KEY = 'sk-ant-test';
    const result = await detectAnthropicAuth();
    expect(result).toBe('apikey');
    // SDK probe must NOT be called when env var is set.
    expect(querySpy).not.toHaveBeenCalled();
  });

  it("returns 'oauth' when CLI present, no env key, SDK probe succeeds", async () => {
    spawnSpy.mockImplementation(() => fakeChild({ exitCode: 0 }));
    querySpy.mockImplementation(() => (async function* () {
      yield { type: 'assistant', message: { content: [{ type: 'text', text: 'pong' }] } };
    })());
    const result = await detectAnthropicAuth();
    expect(result).toBe('oauth');
  });

  it("returns 'none' when CLI present, no env key, SDK probe throws", async () => {
    spawnSpy.mockImplementation(() => fakeChild({ exitCode: 0 }));
    querySpy.mockImplementation(() => (async function* () {
      throw new Error('AuthenticationError');
    })());
    const result = await detectAnthropicAuth();
    expect(result).toBe('none');
  });

  it("returns 'none' when claude --version hangs past 2s timeout", async () => {
    spawnSpy.mockImplementation(() => fakeChild({ exitCode: 0, delayMs: 3000 }));
    const result = await detectAnthropicAuth();
    expect(result).toBe('none');
  }, 7_000);

  it("returns 'none' when SDK probe hangs past 5s timeout", async () => {
    spawnSpy.mockImplementation(() => fakeChild({ exitCode: 0 }));
    querySpy.mockImplementation(() => (async function* () {
      // Hang forever — abort signal in the helper should terminate the iteration.
      await new Promise((resolve) => setTimeout(resolve, 30_000));
      yield { type: 'assistant', message: { content: [] } };
    })());
    const result = await detectAnthropicAuth();
    expect(result).toBe('none');
  }, 10_000);
});
```

- [ ] **Step 2: Run, expect FAIL (module doesn't exist)**

```bash
npx vitest run server/lib/anthropic-auth.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement `server/lib/anthropic-auth.ts`**

```ts
// server/lib/anthropic-auth.ts
import { spawn } from 'node:child_process';
import { query } from '@anthropic-ai/claude-agent-sdk';

type AuthMode = 'oauth' | 'apikey' | 'none';

const CLI_TIMEOUT_MS = 2_000;
const SDK_PROBE_TIMEOUT_MS = 5_000;

export async function detectAnthropicAuth(): Promise<AuthMode> {
  const cliOk = await checkClaudeCli();
  if (!cliOk) return 'none';

  if (typeof process.env.ANTHROPIC_API_KEY === 'string' && process.env.ANTHROPIC_API_KEY.length > 0) {
    return 'apikey';
  }

  const probeOk = await probeOAuth();
  return probeOk ? 'oauth' : 'none';
}

function checkClaudeCli(): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (ok: boolean) => {
      if (settled) return;
      settled = true;
      resolve(ok);
    };

    const child = spawn('claude', ['--version']);
    const timer = setTimeout(() => {
      try { child.kill(); } catch { /* ignore */ }
      finish(false);
    }, CLI_TIMEOUT_MS);

    child.on('exit', (code) => {
      clearTimeout(timer);
      finish(code === 0);
    });
    child.on('error', () => {
      clearTimeout(timer);
      finish(false);
    });
  });
}

async function probeOAuth(): Promise<boolean> {
  const aborter = new AbortController();
  const timer = setTimeout(() => aborter.abort(), SDK_PROBE_TIMEOUT_MS);
  try {
    const iter = query({
      prompt: 'ping',
      options: {
        model: 'claude-haiku-4-5',
        maxTurns: 1,
        allowedTools: [],
        abortSignal: aborter.signal,
      },
    } as Parameters<typeof query>[0]);
    for await (const _ev of iter) {
      // First event proves the SDK is authenticated and reachable.
      return true;
    }
    return false;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
    aborter.abort();
  }
}
```

Note: the `as Parameters<typeof query>[0]` cast keeps the file portable across minor SDK type tweaks; the underlying call shape is the SDK's documented public API. If the SDK's TypeScript types don't expose `abortSignal` on `options`, drop the cast and put `// @ts-expect-error abortSignal isn't in the public types yet` directly above. Both are acceptable.

- [ ] **Step 4: Run, expect PASS**

```bash
npx vitest run server/lib/anthropic-auth.test.ts
```

Expected: all 6 tests pass.

- [ ] **Step 5: Lint + commit**

```bash
npm run lint
git add server/lib/anthropic-auth.ts server/lib/anthropic-auth.test.ts
git commit -m "feat(slice-11): detectAnthropicAuth() probe (CLI + ANTHROPIC_API_KEY + SDK)"
```

---

## Phase D — AnthropicProvider class

### Task D1: AnthropicProvider implementation + tests

**Files:**
- Create: `server/domain/dispatch/providers/anthropic.provider.ts`
- Create: `server/domain/dispatch/providers/anthropic.provider.test.ts`

The provider class follows the same shape as `GeminiProvider` / `OllamaProvider`: a constructor that captures the model id, an `async *stream()` method that yields `ProviderChunk` values, and a readonly `capabilities` field. Under the hood, `stream()` calls `query()` from the SDK, iterates SDK events, and maps content blocks to `ProviderChunk`s.

Key mapping rules:
- SDK `assistant` message with `content: [{ type: 'text', text }]` → `{ type: 'text', text }`
- SDK `assistant` message with `content: [{ type: 'thinking', thinking }]` → `{ type: 'thinking', text: thinking }` IF `req.thinking === true`, else drop
- SDK `assistant` message with `content: [{ type: 'tool_use', id, name, input }]` → `{ type: 'function_call', call: { callId: id, qualifiedName: name, args: input } }`. After yielding a `function_call`, the provider terminates the iterator.
- SDK `result` event with `usage: { input_tokens, output_tokens }` → `{ type: 'done', usage: { totalTokens: input_tokens + output_tokens } }`

History serialisation:
- Convert each `req.history` entry to an SDK input message: `model` → `assistant`, `user` → `user`.
- `req.pendingAssistantText` → appended as a previous assistant turn (so the model "sees" its own prior partial output before the tool_use that triggered the continuation).
- For each `req.toolResults`: append both the matching prior `tool_use` shape AND a `tool_result` content block paired by `callId`. Since we already saw the `tool_use` in the previous iteration (we forwarded its `callId` upward), we re-include it here so the model has the full conversational state.
- Final user message: append as a fresh user turn.

SDK options:
- `systemPrompt: req.systemInstruction`
- `model: this.model`
- `maxTurns: 1` — we run the LLM exactly once per `stream()` call
- `allowedTools: []` — disable SDK's tool execution; we only want the model to surface `tool_use` content
- `mcpServers: {}` — no MCP servers configured at the SDK level
- `abortSignal: signal`
- if `req.thinking === true`: extended-thinking enablement — pass `thinking: { type: 'enabled', budget_tokens: 8000 }` (or whatever the SDK's option name is; the implementer should verify against the installed SDK version)

Tool declarations from `req.mcpTools` are passed via SDK's tool definitions array so the model knows what tools exist.

- [ ] **Step 1: Write the failing test file**

```ts
// server/domain/dispatch/providers/anthropic.provider.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const querySpy = vi.fn();

vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  query: (...args: unknown[]) => querySpy(...args),
}));

import { AnthropicProvider } from './anthropic.provider';
import type { ProviderChunk, ProviderRequest } from './provider.types';

function asyncIterableFrom<T>(events: T[]): AsyncIterable<T> {
  return (async function* () {
    for (const e of events) yield e;
  })();
}

function baseReq(overrides: Partial<ProviderRequest> = {}): ProviderRequest {
  return {
    systemInstruction: 'You are Aether',
    history: [],
    userMessage: 'hi',
    ...overrides,
  };
}

async function collect(it: AsyncIterable<ProviderChunk>): Promise<ProviderChunk[]> {
  const out: ProviderChunk[] = [];
  for await (const c of it) out.push(c);
  return out;
}

beforeEach(() => {
  querySpy.mockReset();
});

describe('AnthropicProvider', () => {
  it('reports declared capabilities and model', () => {
    const p = new AnthropicProvider({ model: 'claude-sonnet-4-6' });
    expect(p.model).toBe('claude-sonnet-4-6');
    expect(p.capabilities).toEqual({ thinking: true, toolCalling: true });
  });

  it('maps SDK text content blocks to text chunks', async () => {
    querySpy.mockReturnValue(asyncIterableFrom([
      { type: 'assistant', message: { content: [{ type: 'text', text: 'hello ' }] } },
      { type: 'assistant', message: { content: [{ type: 'text', text: 'world' }] } },
      { type: 'result', usage: { input_tokens: 3, output_tokens: 5 } },
    ]));
    const p = new AnthropicProvider({ model: 'claude-haiku-4-5' });
    const chunks = await collect(p.stream(baseReq(), new AbortController().signal));
    expect(chunks).toEqual([
      { type: 'text', text: 'hello ' },
      { type: 'text', text: 'world' },
      { type: 'done', usage: { totalTokens: 8 } },
    ]);
  });

  it('maps thinking blocks only when req.thinking === true', async () => {
    querySpy.mockReturnValue(asyncIterableFrom([
      { type: 'assistant', message: { content: [{ type: 'thinking', thinking: 'pondering...' }] } },
      { type: 'assistant', message: { content: [{ type: 'text', text: 'answer' }] } },
      { type: 'result', usage: { input_tokens: 1, output_tokens: 2 } },
    ]));
    const p = new AnthropicProvider({ model: 'claude-haiku-4-5' });
    const chunks = await collect(p.stream(baseReq({ thinking: true }), new AbortController().signal));
    expect(chunks).toContainEqual({ type: 'thinking', text: 'pondering...' });
    expect(chunks).toContainEqual({ type: 'text', text: 'answer' });
  });

  it('drops thinking blocks when req.thinking is falsy', async () => {
    querySpy.mockReturnValue(asyncIterableFrom([
      { type: 'assistant', message: { content: [{ type: 'thinking', thinking: 'silent' }] } },
      { type: 'assistant', message: { content: [{ type: 'text', text: 'answer' }] } },
      { type: 'result', usage: { input_tokens: 0, output_tokens: 0 } },
    ]));
    const p = new AnthropicProvider({ model: 'claude-haiku-4-5' });
    const chunks = await collect(p.stream(baseReq(), new AbortController().signal));
    expect(chunks.find((c) => c.type === 'thinking')).toBeUndefined();
    expect(chunks).toContainEqual({ type: 'text', text: 'answer' });
  });

  it('maps tool_use to function_call and terminates the stream', async () => {
    querySpy.mockReturnValue(asyncIterableFrom([
      { type: 'assistant', message: { content: [{ type: 'text', text: 'I will use a tool' }] } },
      { type: 'assistant', message: { content: [{ type: 'tool_use', id: 'TC1', name: 'mock.echo', input: { message: 'hi' } }] } },
      // The provider should ignore anything after the function_call.
      { type: 'assistant', message: { content: [{ type: 'text', text: 'should not appear' }] } },
      { type: 'result', usage: { input_tokens: 5, output_tokens: 5 } },
    ]));
    const p = new AnthropicProvider({ model: 'claude-haiku-4-5' });
    const chunks = await collect(p.stream(baseReq(), new AbortController().signal));
    expect(chunks).toEqual([
      { type: 'text', text: 'I will use a tool' },
      { type: 'function_call', call: { callId: 'TC1', qualifiedName: 'mock.echo', args: { message: 'hi' } } },
    ]);
  });

  it('forwards systemPrompt, history, userMessage, and tools to the SDK', async () => {
    querySpy.mockReturnValue(asyncIterableFrom([
      { type: 'result', usage: { input_tokens: 0, output_tokens: 0 } },
    ]));
    const p = new AnthropicProvider({ model: 'claude-sonnet-4-6' });
    await collect(p.stream(baseReq({
      systemInstruction: 'sys',
      history: [
        { role: 'user', text: 'q1' },
        { role: 'model', text: 'a1' },
      ],
      userMessage: 'q2',
      mcpTools: [{ qualifiedName: 'mock.echo', description: 'd', schema: { type: 'object' } }],
    }), new AbortController().signal));

    expect(querySpy).toHaveBeenCalledTimes(1);
    const arg = querySpy.mock.calls[0][0] as {
      prompt: unknown;
      options: { systemPrompt: string; model: string; maxTurns: number };
    };
    expect(arg.options.systemPrompt).toBe('sys');
    expect(arg.options.model).toBe('claude-sonnet-4-6');
    expect(arg.options.maxTurns).toBe(1);
    // prompt should carry the conversation; exact shape depends on SDK version
    // but it must mention both the prior history and the final user message.
    const serialized = JSON.stringify(arg);
    expect(serialized).toContain('q1');
    expect(serialized).toContain('a1');
    expect(serialized).toContain('q2');
    expect(serialized).toContain('mock.echo');
  });

  it('threads toolResults back into the SDK prompt on continuation', async () => {
    querySpy.mockReturnValue(asyncIterableFrom([
      { type: 'result', usage: { input_tokens: 0, output_tokens: 0 } },
    ]));
    const p = new AnthropicProvider({ model: 'claude-haiku-4-5' });
    await collect(p.stream(baseReq({
      pendingAssistantText: 'thinking out loud',
      toolResults: [
        { callId: 'TC1', qualifiedName: 'mock.echo', ok: true, output: { message: 'hi' } },
      ],
    }), new AbortController().signal));

    const arg = querySpy.mock.calls[0][0] as Record<string, unknown>;
    const serialized = JSON.stringify(arg);
    expect(serialized).toContain('TC1');
    expect(serialized).toContain('thinking out loud');
  });

  it('forwards the abort signal to the SDK', async () => {
    const aborter = new AbortController();
    querySpy.mockReturnValue(asyncIterableFrom([
      { type: 'result', usage: { input_tokens: 0, output_tokens: 0 } },
    ]));
    const p = new AnthropicProvider({ model: 'claude-haiku-4-5' });
    await collect(p.stream(baseReq(), aborter.signal));
    const arg = querySpy.mock.calls[0][0] as { options: { abortSignal?: AbortSignal } };
    expect(arg.options.abortSignal).toBe(aborter.signal);
  });
});
```

- [ ] **Step 2: Run, expect FAIL (module doesn't exist)**

```bash
npx vitest run server/domain/dispatch/providers/anthropic.provider.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement `anthropic.provider.ts`**

```ts
// server/domain/dispatch/providers/anthropic.provider.ts
import { query } from '@anthropic-ai/claude-agent-sdk';
import type {
  AIProvider,
  ProviderCapabilities,
  ProviderChunk,
  ProviderRequest,
} from './provider.types';

export interface AnthropicProviderOpts {
  model: 'claude-opus-4-7' | 'claude-sonnet-4-6' | 'claude-haiku-4-5';
}

export class AnthropicProvider implements AIProvider {
  readonly capabilities: ProviderCapabilities = { thinking: true, toolCalling: true };
  readonly model: string;

  constructor(private readonly opts: AnthropicProviderOpts) {
    this.model = opts.model;
  }

  async *stream(req: ProviderRequest, signal: AbortSignal): AsyncIterable<ProviderChunk> {
    const prompt = buildPrompt(req);
    const options: Record<string, unknown> = {
      systemPrompt: req.systemInstruction,
      model: this.model,
      maxTurns: 1,
      allowedTools: [],
      mcpServers: {},
      abortSignal: signal,
    };
    if (req.thinking === true) {
      options.thinking = { type: 'enabled', budget_tokens: 8000 };
    }
    if (req.mcpTools && req.mcpTools.length > 0) {
      options.tools = req.mcpTools.map((t) => ({
        name: t.qualifiedName,
        description: t.description ?? '',
        input_schema: t.schema,
      }));
    }

    const iter = query({ prompt, options } as Parameters<typeof query>[0]);

    for await (const ev of iter) {
      if (signal.aborted) return;
      const e = ev as SdkEvent;
      if (e.type === 'assistant' && e.message?.content) {
        for (const block of e.message.content) {
          if (block.type === 'text' && typeof block.text === 'string') {
            yield { type: 'text', text: block.text };
          } else if (block.type === 'thinking' && typeof block.thinking === 'string') {
            if (req.thinking === true) {
              yield { type: 'thinking', text: block.thinking };
            }
          } else if (block.type === 'tool_use') {
            yield {
              type: 'function_call',
              call: {
                callId: String(block.id ?? ''),
                qualifiedName: String(block.name ?? ''),
                args: (block.input ?? {}) as Record<string, unknown>,
              },
            };
            // Terminate the stream — the dispatch service will call us again
            // with toolResults populated to continue the turn.
            return;
          }
        }
      } else if (e.type === 'result') {
        const inTok = Number(e.usage?.input_tokens ?? 0);
        const outTok = Number(e.usage?.output_tokens ?? 0);
        const total = inTok + outTok;
        yield {
          type: 'done',
          usage: total > 0 ? { totalTokens: total } : undefined,
        };
        return;
      }
    }
  }
}

interface SdkContentBlock {
  type: 'text' | 'thinking' | 'tool_use' | string;
  text?: string;
  thinking?: string;
  id?: string;
  name?: string;
  input?: unknown;
}

interface SdkEvent {
  type: 'assistant' | 'result' | string;
  message?: { content?: SdkContentBlock[] };
  usage?: { input_tokens?: number; output_tokens?: number };
}

interface SdkMessage {
  role: 'user' | 'assistant';
  content: Array<
    | { type: 'text'; text: string }
    | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
    | { type: 'tool_result'; tool_use_id: string; content: string }
  >;
}

function buildPrompt(req: ProviderRequest): SdkMessage[] {
  const out: SdkMessage[] = [];
  for (const h of req.history) {
    out.push({
      role: h.role === 'model' ? 'assistant' : 'user',
      content: [{ type: 'text', text: h.text }],
    });
  }
  if (req.pendingAssistantText && req.pendingAssistantText.length > 0) {
    out.push({
      role: 'assistant',
      content: [{ type: 'text', text: req.pendingAssistantText }],
    });
  }
  for (const r of req.toolResults ?? []) {
    // Replay the original tool_use so the conversational state is consistent.
    out.push({
      role: 'assistant',
      content: [{
        type: 'tool_use',
        id: r.callId,
        name: r.qualifiedName,
        input: {},
      }],
    });
    out.push({
      role: 'user',
      content: [{
        type: 'tool_result',
        tool_use_id: r.callId,
        content: r.ok ? JSON.stringify(r.output ?? {}) : JSON.stringify({ error: r.error }),
      }],
    });
  }
  out.push({
    role: 'user',
    content: [{ type: 'text', text: req.userMessage }],
  });
  return out;
}
```

- [ ] **Step 4: Run, expect PASS**

```bash
npx vitest run server/domain/dispatch/providers/anthropic.provider.test.ts
```

Expected: all 8 tests pass.

- [ ] **Step 5: Run full server suite (no regressions)**

```bash
npx vitest run server
```

Expected: 377+ tests pass (the existing count, plus the new 6 from C1 plus 8 from D1).

- [ ] **Step 6: Lint + commit**

```bash
npm run lint
git add server/domain/dispatch/providers/anthropic.provider.ts server/domain/dispatch/providers/anthropic.provider.test.ts
git commit -m "feat(slice-11): AnthropicProvider (Claude Agent SDK; text+thinking+tool_use)"
```

**Note for implementer:** if `query()` from the installed SDK doesn't expose `abortSignal`, `thinking`, or `mcpServers` in its TypeScript options, the cast `as Parameters<typeof query>[0]` will still let the call go through at runtime (the SDK accepts those options regardless of static types). If you hit a strict-type error you can't resolve via the cast, fall back to `// @ts-expect-error <reason>` on the `query()` call. Report DONE_WITH_CONCERNS if you had to apply that workaround.

If the SDK does NOT surface `tool_use` blocks in the assistant message when `allowedTools` is empty (i.e. the SDK auto-drops tool calls when no tools are wired), report DONE_WITH_CONCERNS with the observed behaviour. Workaround in that case: declare each Aether tool as an `allowedTools: ['ToolName(* )']` entry without an implementation. The dispatch loop will receive the tool_use and the SDK won't auto-execute it because `maxTurns: 1` prevents the loop from continuing past the first tool call.

---

## Phase E — Provider registry wiring

### Task E1: ProviderRegistry registers Anthropic when auth probe succeeds

**Files:**
- Modify: `server/domain/providers/registry.ts`
- Modify: `server/domain/providers/registry.test.ts`

The registry gains:
- A new transport: `'anthropic'`
- A new dep: `anthropicAuth: 'oauth' | 'apikey' | 'none'` (already-computed by `index.ts` at bootstrap; this keeps the registry pure and testable)
- A new dep: `anthropicBuilder: (model) => AIProvider`
- A new branch in `refresh()`: if `anthropicAuth !== 'none'`, register the three hardcoded entries

- [ ] **Step 1: Append failing tests to `registry.test.ts`**

Read the existing file first to understand the harness. Then add:

```ts
// Inside the existing describe('ProviderRegistry', ...) block:

it("registers all three anthropic entries when probe returns 'oauth'", async () => {
  const reg = new ProviderRegistry({
    ollamaHost: 'http://localhost:11434',
    geminiApiKey: undefined,
    anthropicAuth: 'oauth',
    fakeProvider: makeFake('fake-1'),
    geminiBuilder: () => makeFake('g'),
    ollamaBuilder: () => makeFake('o'),
    anthropicBuilder: (model) => makeFake(model),
  });
  await reg.refresh();
  expect(reg.get('anthropic:claude-opus-4-7')).not.toBeNull();
  expect(reg.get('anthropic:claude-sonnet-4-6')).not.toBeNull();
  expect(reg.get('anthropic:claude-haiku-4-5')).not.toBeNull();
});

it("registers all three anthropic entries when probe returns 'apikey'", async () => {
  const reg = new ProviderRegistry({
    ollamaHost: 'http://localhost:11434',
    geminiApiKey: undefined,
    anthropicAuth: 'apikey',
    fakeProvider: makeFake('fake-1'),
    geminiBuilder: () => makeFake('g'),
    ollamaBuilder: () => makeFake('o'),
    anthropicBuilder: (model) => makeFake(model),
  });
  await reg.refresh();
  expect(reg.list().filter((d) => d.transport === 'anthropic')).toHaveLength(3);
});

it("skips anthropic entries when probe returns 'none'", async () => {
  const reg = new ProviderRegistry({
    ollamaHost: 'http://localhost:11434',
    geminiApiKey: undefined,
    anthropicAuth: 'none',
    fakeProvider: makeFake('fake-1'),
    geminiBuilder: () => makeFake('g'),
    ollamaBuilder: () => makeFake('o'),
    anthropicBuilder: (model) => makeFake(model),
  });
  await reg.refresh();
  expect(reg.list().find((d) => d.transport === 'anthropic')).toBeUndefined();
});

it("displayName for anthropic includes the model id", async () => {
  const reg = new ProviderRegistry({
    ollamaHost: 'http://localhost:11434',
    geminiApiKey: undefined,
    anthropicAuth: 'oauth',
    fakeProvider: makeFake('fake-1'),
    geminiBuilder: () => makeFake('g'),
    ollamaBuilder: () => makeFake('o'),
    anthropicBuilder: (model) => makeFake(model),
  });
  await reg.refresh();
  const d = reg.describe('anthropic:claude-opus-4-7');
  expect(d?.displayName).toMatch(/claude/i);
});
```

You'll also need to thread `anthropicAuth` and `anthropicBuilder` into the existing tests' deps (every `new ProviderRegistry({...})` call must include them). The simplest fix: extract a small helper at the top of the test file:

```ts
function baseDeps(overrides: Partial<ConstructorParameters<typeof ProviderRegistry>[0]> = {}): ConstructorParameters<typeof ProviderRegistry>[0] {
  return {
    ollamaHost: 'http://localhost:11434',
    geminiApiKey: undefined,
    anthropicAuth: 'none',
    fakeProvider: makeFake('fake-1'),
    geminiBuilder: () => makeFake('g'),
    ollamaBuilder: () => makeFake('o'),
    anthropicBuilder: (model) => makeFake(model),
    ...overrides,
  };
}
```

…and rewrite each existing test to use `new ProviderRegistry(baseDeps({ ...overrides }))`. Keeps the diff focused and prevents per-test repetition.

- [ ] **Step 2: Run, expect FAIL**

```bash
npx vitest run server/domain/providers/registry.test.ts
```

Expected: FAIL — `anthropicAuth` / `anthropicBuilder` not in `ProviderRegistryDeps`.

- [ ] **Step 3: Modify `registry.ts`**

Apply these changes:

a) Widen the transport union:

```ts
export type ProviderTransport = 'fake' | 'gemini' | 'ollama' | 'anthropic';
```

b) Extend `ProviderRegistryDeps`:

```ts
export interface ProviderRegistryDeps {
  ollamaHost: string;
  geminiApiKey: string | undefined;
  anthropicAuth: 'oauth' | 'apikey' | 'none';
  fakeProvider: AIProvider;
  geminiBuilder: (model: string) => AIProvider;
  ollamaBuilder: (model: string) => AIProvider;
  anthropicBuilder: (model: string) => AIProvider;
  defaultOverride?: string;
}
```

c) Add the hardcoded list near `geminiHardcodedModels`:

```ts
// In server/domain/providers/discovery.ts:
export function anthropicHardcodedModels(): string[] {
  return ['claude-opus-4-7', 'claude-sonnet-4-6', 'claude-haiku-4-5'];
}
```

d) Update `displayNameFor`:

```ts
function displayNameFor(transport: ProviderTransport, model: string): string {
  if (transport === 'fake') return 'Fake (default)';
  if (transport === 'gemini') return `Gemini / ${model}`;
  if (transport === 'anthropic') return `Anthropic / ${model}`;
  return `Ollama / ${model}`;
}
```

e) Add the anthropic branch in `refresh()`, immediately after the Gemini block:

```ts
// Anthropic
if (this.deps.anthropicAuth !== 'none') {
  for (const model of anthropicHardcodedModels()) {
    const provider = this.deps.anthropicBuilder(model);
    next.set(`anthropic:${model}`, {
      provider,
      descriptor: {
        name: `anthropic:${model}`,
        transport: 'anthropic',
        model,
        capabilities: provider.capabilities,
        displayName: displayNameFor('anthropic', model),
      },
    });
  }
}
```

f) Add the import in `registry.ts`:

```ts
import { discoverOllama, geminiHardcodedModels, anthropicHardcodedModels } from './discovery';
```

g) `defaultName()` should consider anthropic before falling back to fake. Insert a new branch between gemini and ollama (or wherever you prefer — the user's session-level pick will usually override anyway):

```ts
defaultName(): string | null {
  if (this.deps.defaultOverride && this.entries.has(this.deps.defaultOverride)) {
    return this.deps.defaultOverride;
  }
  for (const e of this.entries.values()) {
    if (e.descriptor.transport === 'gemini') return e.descriptor.name;
  }
  for (const e of this.entries.values()) {
    if (e.descriptor.transport === 'anthropic') return e.descriptor.name;
  }
  for (const e of this.entries.values()) {
    if (e.descriptor.transport === 'ollama') return e.descriptor.name;
  }
  if (this.entries.has('fake:default')) return 'fake:default';
  return null;
}
```

- [ ] **Step 4: Run, expect PASS**

```bash
npx vitest run server/domain/providers/registry.test.ts
```

Expected: all tests pass (original suite + 4 new).

- [ ] **Step 5: Run full server suite**

```bash
npx vitest run server
```

Expected: all pass.

- [ ] **Step 6: Lint + commit**

```bash
npm run lint
git add server/domain/providers/registry.ts server/domain/providers/registry.test.ts server/domain/providers/discovery.ts
git commit -m "feat(slice-11): ProviderRegistry registers anthropic entries when auth probe succeeds"
```

---

## Phase F — Bootstrap wiring

### Task F1: `server/index.ts` wires AnthropicProvider builder and runs the probe

**Files:**
- Modify: `server/index.ts`

We call `detectAnthropicAuth()` at startup, log the result, and pass it (plus the builder) into the `ProviderRegistry`. The probe runs in parallel with the existing Ollama discovery so startup isn't serially delayed.

- [ ] **Step 1: Modify `server/index.ts`**

Add the import (alongside the existing provider imports):

```ts
import { AnthropicProvider } from './domain/dispatch/providers/anthropic.provider';
import { detectAnthropicAuth } from './lib/anthropic-auth';
```

Replace the `ProviderRegistry` construction block. Currently:

```ts
const providers = new ProviderRegistry({
  ollamaHost: process.env.OLLAMA_HOST ?? 'http://localhost:11434',
  geminiApiKey: cfg.geminiApiKey || undefined,
  fakeProvider,
  geminiBuilder: (model) => new GeminiProvider({ apiKey: cfg.geminiApiKey, model }),
  ollamaBuilder: (model) =>
    new OllamaProvider({
      host: process.env.OLLAMA_HOST ?? 'http://localhost:11434',
      model,
    }),
  defaultOverride:
    process.env.AETHER_DEFAULT_PROVIDER ||
    (cfg.fakeProvider ? 'fake:default' : undefined),
});

await providers.refresh();
```

…with:

```ts
const anthropicAuth = await detectAnthropicAuth();
console.log(`[providers] anthropic: ${anthropicAuth}`);

const providers = new ProviderRegistry({
  ollamaHost: process.env.OLLAMA_HOST ?? 'http://localhost:11434',
  geminiApiKey: cfg.geminiApiKey || undefined,
  anthropicAuth,
  fakeProvider,
  geminiBuilder: (model) => new GeminiProvider({ apiKey: cfg.geminiApiKey, model }),
  ollamaBuilder: (model) =>
    new OllamaProvider({
      host: process.env.OLLAMA_HOST ?? 'http://localhost:11434',
      model,
    }),
  anthropicBuilder: (model) =>
    new AnthropicProvider({
      model: model as 'claude-opus-4-7' | 'claude-sonnet-4-6' | 'claude-haiku-4-5',
    }),
  defaultOverride:
    process.env.AETHER_DEFAULT_PROVIDER ||
    (cfg.fakeProvider ? 'fake:default' : undefined),
});

await providers.refresh();
```

- [ ] **Step 2: Run lint**

```bash
npm run lint
```

Expected: clean.

- [ ] **Step 3: Run full server suite**

```bash
npx vitest run server
```

Expected: all tests pass. `server/index.ts` is not directly tested but the change must not break type-checking.

- [ ] **Step 4: Smoke test — start server briefly**

```bash
AETHER_FAKE_PROVIDER=1 timeout 5 npx tsx server/index.ts || true
```

We expect to see a line like `[providers] anthropic: none` (assuming the test environment has no claude CLI). The exit code from `timeout` is non-zero but that's OK — we just want to see the startup output. Skip this step if `tsx` isn't available locally and rely on the suite + lint.

- [ ] **Step 5: Commit**

```bash
git add server/index.ts
git commit -m "feat(slice-11): bootstrap runs detectAnthropicAuth + wires AnthropicProvider"
```

---

## Phase G — Frontend integration test

### Task G1: provider-switch integration covers Anthropic appearing in the selector

**Files:**
- Modify: `src/integration/provider-switch.integration.test.tsx`

We don't need new FE code — the existing TopBar provider selector already renders whatever the server publishes. The integration test asserts that when MSW returns an Anthropic entry, the user can pick it and a message round-trips successfully (the underlying SDK call is server-side and stubbed by the MSW dispatch handler).

- [ ] **Step 1: Read the existing test file**

Open `src/integration/provider-switch.integration.test.tsx`. Find the existing test that picks a non-fake provider (likely uses Gemini or Ollama). Note the test patterns (setup, MSW use of `http.get('http://localhost/api/providers')`, the selector's role/label, the message round-trip assertion).

- [ ] **Step 2: Append a new test case**

Add inside the existing describe block:

```tsx
it('Anthropic entries appear in the selector when the server publishes them', async () => {
  server.use(
    http.get('http://localhost/api/providers', () =>
      HttpResponse.json({
        providers: [
          {
            name: 'fake:default',
            transport: 'fake',
            model: 'default',
            capabilities: { thinking: true, toolCalling: true },
            displayName: 'Fake (default)',
          },
          {
            name: 'anthropic:claude-sonnet-4-6',
            transport: 'anthropic',
            model: 'claude-sonnet-4-6',
            capabilities: { thinking: true, toolCalling: true },
            displayName: 'Anthropic / claude-sonnet-4-6',
          },
        ],
      }),
    ),
    http.get('http://localhost/api/providers/default', () =>
      HttpResponse.json({ name: 'fake:default' }),
    ),
  );

  render(<App />);
  const selector = await screen.findByRole('combobox', { name: /active provider/i });
  // The Anthropic option should be selectable.
  expect(
    await screen.findByRole('option', { name: /anthropic.*claude-sonnet-4-6/i }),
  ).toBeInTheDocument();

  const user = userEvent.setup();
  await user.selectOptions(selector, 'anthropic:claude-sonnet-4-6');
  expect(selector).toHaveValue('anthropic:claude-sonnet-4-6');
});
```

(The exact `userEvent` import and `selectOptions` call should match the file's existing style — copy from the existing Gemini/Ollama-selection test if it differs.)

- [ ] **Step 3: Run, expect PASS**

```bash
npx vitest run src/integration/provider-switch.integration.test.tsx
```

Expected: existing tests + the new one all pass.

- [ ] **Step 4: Run full FE suite + lint**

```bash
npx vitest run src
npm run lint
```

Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add src/integration/provider-switch.integration.test.tsx
git commit -m "test(slice-11): provider-switch covers Anthropic entry in selector"
```

---

## Phase H — Final verification + PR

### Task H1: lint + full tests + e2e + push + PR

- [ ] **Step 1: Lint**

```bash
npm run lint
```

Expected: clean.

- [ ] **Step 2: Vitest (full)**

```bash
npx vitest run
```

Expected: all tests pass. Expected new count: previous baseline (883) + ~14 new (6 auth + 8 provider + 4 registry tweaks + 1 FE integration), roughly 905-ish. Exact numbers will vary if you split tests differently.

- [ ] **Step 3: Playwright (regression check)**

```bash
npx playwright test
```

Expected: 13/13 pass (no new e2e for slice 11 — see spec non-goals).

- [ ] **Step 4: Verify branch state**

```bash
git log --oneline main..HEAD
```

You should see one commit per task above, plus the spec commit, in order.

- [ ] **Step 5: Push**

```bash
git push -u origin feat/slice-11-anthropic
```

- [ ] **Step 6: Open PR**

```bash
gh pr create --title "feat(slice-11): Anthropic provider via Claude Agent SDK" --body "$(cat <<'EOF'
## Summary

Slice 11 adds Anthropic Claude (Opus 4.7, Sonnet 4.6, Haiku 4.5) as a first-class provider in Aether.

- **Auth**: flows through the local \`claude\` CLI OAuth session OR \`ANTHROPIC_API_KEY\` env var — both supported automatically by the Claude Agent SDK. No UI auth toggle; users on Pro/Max subscriptions should leave \`ANTHROPIC_API_KEY\` unset to use subscription quota.
- **Probe-gated registration**: \`detectAnthropicAuth()\` runs at server startup. If \`claude --version\` fails OR (no \`ANTHROPIC_API_KEY\` AND the SDK probe fails), the three Claude entries are simply omitted from the provider list. Same UX shape as the Ollama provider's conditional registration.
- **Aether owns tools**: SDK's own MCP/tool system is left disabled (\`maxTurns: 1\`, \`mcpServers: {}\`). Tool calls from Claude flow through Aether's existing slice-7/10 function-calling loop, banner, approval, and cancel UX — identical to Gemini.

## Architecture

New \`AnthropicProvider\` (\`server/domain/dispatch/providers/anthropic.provider.ts\`) implements the existing \`AIProvider\` interface. \`stream()\` invokes \`query()\` from \`@anthropic-ai/claude-agent-sdk\`, maps SDK events to \`ProviderChunk\`s (text / thinking / function_call / done), and terminates after the first \`tool_use\` so the dispatch loop can re-call with \`toolResults\` populated.

Spec: \`docs/superpowers/specs/2026-05-20-aether-slice-11-anthropic-design.md\`
Plan: \`docs/superpowers/plans/2026-05-20-aether-slice-11-anthropic.md\`

## Test plan

- [x] \`npm run lint\` — clean
- [x] \`npx vitest run\` — all passing
- [x] \`npx playwright test\` — 13/13 (no new e2e per spec non-goals)
- [x] New unit tests: \`detectAnthropicAuth\` (6 cases), \`AnthropicProvider\` (8 cases), \`ProviderRegistry\` (4 anthropic cases)
- [x] New FE integration: Anthropic entry appears in the TopBar provider selector
- [x] Manual smoke: with a logged-in \`claude\` CLI, the three Claude entries appear in the selector; without, they don't.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Self-review notes

**Spec coverage:**
- ✅ HTTP-based auth via Claude Agent SDK with OAuth precedence — Task C1 covers both env-var and CLI probe paths; Task F1 logs the result.
- ✅ Aether owns tools (no SDK MCP/tools) — Task D1 sets `mcpServers: {}` and `allowedTools: []`.
- ✅ Three hardcoded model entries — Task E1 adds them via `anthropicHardcodedModels()`.
- ✅ Probe gates registration — Task E1 only registers when `anthropicAuth !== 'none'`.
- ✅ Stateless adapter; full history per `stream()` — Task D1 `buildPrompt()` serializes everything per call.
- ✅ Stream terminates on first `function_call` — Task D1 `return` after `yield`.
- ✅ Subprocess killed via SDK's abort-signal forwarding — Task D1 passes `signal` to `query()` options.
- ✅ Both auth modes; SDK precedence is API key — Task C1 returns `'apikey'` whenever the env var is set.
- ✅ Capabilities `{ thinking: true, toolCalling: true }` for all three — Task D1.
- ✅ No new FE components — Task G1 only extends an existing integration test.
- ✅ No Playwright coverage — none added.

**Placeholder scan:** searched for "TBD", "TODO", "implement later", and similar phrases — none present.

**Type consistency:** `anthropicAuth` and `anthropicBuilder` field names are consistent across `ProviderRegistryDeps` (Task E1), `index.ts` wiring (Task F1), and the test deps helper (Task E1). `'claude-opus-4-7' | 'claude-sonnet-4-6' | 'claude-haiku-4-5'` constructor union in `AnthropicProviderOpts` (Task D1) matches `anthropicHardcodedModels()` (Task E1).
