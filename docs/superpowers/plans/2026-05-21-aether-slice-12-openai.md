# Aether Slice 12 — OpenAI Provider Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add OpenAI (gpt-5, gpt-5-mini, gpt-4.1, o3) as a first-class provider via the Chat Completions API. Auth via `OPENAI_API_KEY` env var. Stream parsing follows the Ollama pattern; tool calls flow through Aether's existing function-calling loop.

**Architecture:** A new `OpenAIProvider` class implements `AIProvider`. `stream()` issues `POST /v1/chat/completions` with `stream: true`, parses SSE `data: <json>` frames, yields `text` / `thinking` / `function_call` / `done` `ProviderChunk`s. Tool calls are accumulated by index across streaming chunks and emitted on `finish_reason: 'tool_calls'`. Registration of four hardcoded model entries is gated on `OPENAI_API_KEY` (mirrors the Gemini pattern).

**Tech Stack:** Native `fetch` + `ReadableStream` + `TextDecoder`. No new dependency.

**Reference spec:** `docs/superpowers/specs/2026-05-21-aether-slice-12-openai-design.md`

**Branch:** `feat/slice-12-openai` (already checked out; spec already committed)

**Lavora con un solo branch dall'inizio alla fine; ogni Task termina con un commit verde su questo branch.**

---

## File structure (NEW unless marked MODIFY)

```
server/
  domain/dispatch/providers/
    openai.provider.ts                               # NEW
    openai.provider.test.ts                          # NEW
  domain/providers/
    discovery.ts                                     # MODIFY: +openAIHardcodedModels()
    registry.ts                                      # MODIFY: +openai transport + deps + register block
    registry.test.ts                                 # MODIFY: +4 cases; baseDeps gains openAI fields
  config.ts                                          # MODIFY: +openAIApiKey
  index.ts                                           # MODIFY: wire OpenAIProvider builder
  test/registry.test-helper.ts                       # MODIFY: pass openAI fields

src/
  integration/
    provider-switch.integration.test.tsx             # MODIFY: append 1 case
```

---

## Phase A — Pre-flight

### Task A1: Verify branch + clean tree

- [ ] **Step 1: Run**

```bash
git rev-parse --abbrev-ref HEAD
git status --porcelain
```

Expected: branch `feat/slice-12-openai`; second command empty. No commit.

---

## Phase B — OpenAIProvider implementation

### Task B1: `OpenAIProvider` class + tests

**Files:**
- Create: `server/domain/dispatch/providers/openai.provider.ts`
- Create: `server/domain/dispatch/providers/openai.provider.test.ts`

The provider mirrors `OllamaProvider`'s SSE-parsing shape: `fetch` to the endpoint with `stream: true`, read the response body as a stream, split on `\n\n` to extract SSE frames, parse `data: <json>` payloads, accumulate tool-call fragments by index, yield `ProviderChunk`s.

Key mapping rules:
- `delta.content` (non-empty string) → `{ type: 'text', text }`
- `delta.reasoning` OR `delta.reasoning_content` (string, non-empty) → `{ type: 'thinking', text }` only when `req.thinking === true`
- `delta.tool_calls[]`: accumulate per-`index` buffer `{ id, name, argsBuffer }`. Each chunk may carry partial `id`, partial `function.name`, or incremental `function.arguments` string fragments.
- `finish_reason: 'tool_calls'` → parse each accumulated `argsBuffer` via `JSON.parse`, yield one `function_call` per index in index order, terminate the iterator.
- `finish_reason: 'stop'` (or natural stream end) once `usage` has been seen → `{ type: 'done', usage: { totalTokens } }`.
- HTTP 401 → throw `Error('OpenAI auth failed — check OPENAI_API_KEY')`.
- HTTP 429 / 5xx → throw with the API's `error.message` (falling back to the status code).

Capabilities differ per model: `o3` reports `thinking: true`; the other three `thinking: false`. All four declare `toolCalling: true`.

- [ ] **Step 1: Write the failing test file**

```ts
// server/domain/dispatch/providers/openai.provider.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { OpenAIProvider } from './openai.provider';
import type { ProviderChunk, ProviderRequest } from './provider.types';

function ssePayload(frames: string[]): string {
  return frames.map((f) => `data: ${f}\n\n`).join('') + 'data: [DONE]\n\n';
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
  vi.stubGlobal('fetch', vi.fn());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('OpenAIProvider', () => {
  it('reports model and capability per-model (o3 thinks, others do not)', () => {
    expect(new OpenAIProvider({ apiKey: 'sk-x', model: 'gpt-5' }).capabilities).toEqual({
      thinking: false,
      toolCalling: true,
    });
    expect(new OpenAIProvider({ apiKey: 'sk-x', model: 'o3' }).capabilities).toEqual({
      thinking: true,
      toolCalling: true,
    });
    expect(new OpenAIProvider({ apiKey: 'sk-x', model: 'gpt-5' }).model).toBe('gpt-5');
  });

  it('maps multi-chunk delta.content to ordered text chunks + done with totalTokens', async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      new Response(streamFromString(ssePayload([
        JSON.stringify({ choices: [{ delta: { content: 'hello ' } }] }),
        JSON.stringify({ choices: [{ delta: { content: 'world' }, finish_reason: 'stop' }] }),
        JSON.stringify({ choices: [], usage: { prompt_tokens: 3, completion_tokens: 5, total_tokens: 8 } }),
      ])), { status: 200, headers: { 'content-type': 'text/event-stream' } }),
    );

    const p = new OpenAIProvider({ apiKey: 'sk-x', model: 'gpt-5' });
    const chunks = await collect(p.stream(baseReq(), new AbortController().signal));

    expect(chunks).toEqual([
      { type: 'text', text: 'hello ' },
      { type: 'text', text: 'world' },
      { type: 'done', usage: { totalTokens: 8 } },
    ]);
  });

  it('yields thinking chunks only when req.thinking === true (delta.reasoning)', async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      new Response(streamFromString(ssePayload([
        JSON.stringify({ choices: [{ delta: { reasoning: 'pondering...' } }] }),
        JSON.stringify({ choices: [{ delta: { content: 'answer' }, finish_reason: 'stop' }] }),
        JSON.stringify({ choices: [], usage: { total_tokens: 1 } }),
      ])), { status: 200 }),
    );

    const p = new OpenAIProvider({ apiKey: 'sk-x', model: 'o3' });
    const withThinking = await collect(p.stream(baseReq({ thinking: true }), new AbortController().signal));
    expect(withThinking).toContainEqual({ type: 'thinking', text: 'pondering...' });
  });

  it('yields thinking chunks for delta.reasoning_content (alternate field name)', async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      new Response(streamFromString(ssePayload([
        JSON.stringify({ choices: [{ delta: { reasoning_content: 'alt-naming' } }] }),
        JSON.stringify({ choices: [{ delta: { content: 'answer' }, finish_reason: 'stop' }] }),
        JSON.stringify({ choices: [], usage: { total_tokens: 1 } }),
      ])), { status: 200 }),
    );

    const p = new OpenAIProvider({ apiKey: 'sk-x', model: 'o3' });
    const chunks = await collect(p.stream(baseReq({ thinking: true }), new AbortController().signal));
    expect(chunks).toContainEqual({ type: 'thinking', text: 'alt-naming' });
  });

  it('drops thinking blocks when req.thinking is falsy', async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      new Response(streamFromString(ssePayload([
        JSON.stringify({ choices: [{ delta: { reasoning: 'silent' } }] }),
        JSON.stringify({ choices: [{ delta: { content: 'answer' }, finish_reason: 'stop' }] }),
        JSON.stringify({ choices: [], usage: { total_tokens: 1 } }),
      ])), { status: 200 }),
    );

    const p = new OpenAIProvider({ apiKey: 'sk-x', model: 'o3' });
    const chunks = await collect(p.stream(baseReq(), new AbortController().signal));
    expect(chunks.find((c) => c.type === 'thinking')).toBeUndefined();
    expect(chunks).toContainEqual({ type: 'text', text: 'answer' });
  });

  it('accumulates partial tool_call arguments and emits function_call on finish_reason: tool_calls', async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      new Response(streamFromString(ssePayload([
        JSON.stringify({ choices: [{ delta: { tool_calls: [{ index: 0, id: 'TC1', type: 'function', function: { name: 'mock.echo', arguments: '{"mess' } }] } }] }),
        JSON.stringify({ choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: 'age":"hi"}' } }] } }] }),
        JSON.stringify({ choices: [{ delta: {}, finish_reason: 'tool_calls' }] }),
      ])), { status: 200 }),
    );

    const p = new OpenAIProvider({ apiKey: 'sk-x', model: 'gpt-5' });
    const chunks = await collect(p.stream(baseReq(), new AbortController().signal));
    expect(chunks).toEqual([
      { type: 'function_call', call: { callId: 'TC1', qualifiedName: 'mock.echo', args: { message: 'hi' } } },
    ]);
  });

  it('forwards correct body: messages, tools, stream, stream_options.include_usage', async () => {
    let captured: { url?: string; init?: RequestInit } = {};
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockImplementation(async (url: string, init?: RequestInit) => {
      captured = { url, init };
      return new Response(streamFromString(ssePayload([
        JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }] }),
        JSON.stringify({ choices: [], usage: { total_tokens: 0 } }),
      ])), { status: 200 });
    });

    const p = new OpenAIProvider({ apiKey: 'sk-test', model: 'gpt-5' });
    await collect(p.stream(baseReq({
      systemInstruction: 'sys',
      history: [
        { role: 'user', text: 'q1' },
        { role: 'model', text: 'a1' },
      ],
      userMessage: 'q2',
      mcpTools: [{ qualifiedName: 'mock.echo', description: 'd', schema: { type: 'object', properties: { message: { type: 'string' } } } }],
    }), new AbortController().signal));

    expect(captured.url).toBe('https://api.openai.com/v1/chat/completions');
    const headers = new Headers(captured.init?.headers);
    expect(headers.get('authorization')).toBe('Bearer sk-test');
    expect(headers.get('accept')).toBe('text/event-stream');

    const body = JSON.parse(captured.init?.body as string) as {
      model: string;
      stream: boolean;
      stream_options: { include_usage: boolean };
      messages: Array<{ role: string; content?: string }>;
      tools: Array<{ type: string; function: { name: string } }>;
    };
    expect(body.model).toBe('gpt-5');
    expect(body.stream).toBe(true);
    expect(body.stream_options.include_usage).toBe(true);
    expect(body.messages[0]).toEqual({ role: 'system', content: 'sys' });
    expect(body.messages[1]).toEqual({ role: 'user', content: 'q1' });
    expect(body.messages[2]).toEqual({ role: 'assistant', content: 'a1' });
    expect(body.messages[body.messages.length - 1]).toEqual({ role: 'user', content: 'q2' });
    expect(body.tools[0].function.name).toBe('mock.echo');
  });

  it('threads toolResults back as the assistant tool_calls + tool result pair', async () => {
    let captured: { init?: RequestInit } = {};
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockImplementation(async (_url: string, init?: RequestInit) => {
      captured = { init };
      return new Response(streamFromString(ssePayload([
        JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }] }),
        JSON.stringify({ choices: [], usage: { total_tokens: 0 } }),
      ])), { status: 200 });
    });

    const p = new OpenAIProvider({ apiKey: 'sk-x', model: 'gpt-5' });
    await collect(p.stream(baseReq({
      toolResults: [
        { callId: 'TC1', qualifiedName: 'mock.echo', ok: true, output: { message: 'hi' } },
      ],
    }), new AbortController().signal));

    const body = JSON.parse(captured.init?.body as string) as {
      messages: Array<Record<string, unknown>>;
    };
    const idxAssistant = body.messages.findIndex((m) => m.role === 'assistant' && Array.isArray(m.tool_calls));
    expect(idxAssistant).toBeGreaterThanOrEqual(0);
    const tcMsg = body.messages[idxAssistant] as { tool_calls: Array<{ id: string; function: { name: string } }> };
    expect(tcMsg.tool_calls[0].id).toBe('TC1');
    expect(tcMsg.tool_calls[0].function.name).toBe('mock.echo');

    const idxToolResult = body.messages.findIndex((m) => m.role === 'tool');
    expect(idxToolResult).toBeGreaterThan(idxAssistant);
    expect(body.messages[idxToolResult]).toMatchObject({
      role: 'tool',
      tool_call_id: 'TC1',
      content: JSON.stringify({ message: 'hi' }),
    });
  });

  it('throws OpenAI auth failed message on HTTP 401', async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      new Response(JSON.stringify({ error: { message: 'invalid_api_key' } }), { status: 401 }),
    );
    const p = new OpenAIProvider({ apiKey: 'sk-bad', model: 'gpt-5' });
    await expect(collect(p.stream(baseReq(), new AbortController().signal))).rejects.toThrow(
      /OpenAI auth failed/,
    );
  });

  it('throws with API error message on HTTP 429', async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      new Response(JSON.stringify({ error: { message: 'rate_limit_exceeded' } }), { status: 429 }),
    );
    const p = new OpenAIProvider({ apiKey: 'sk-x', model: 'gpt-5' });
    await expect(collect(p.stream(baseReq(), new AbortController().signal))).rejects.toThrow(
      /rate_limit_exceeded/,
    );
  });

  it('forwards the abort signal to fetch', async () => {
    const aborter = new AbortController();
    let receivedSignal: AbortSignal | undefined;
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockImplementation(async (_url: string, init?: RequestInit) => {
      receivedSignal = init?.signal ?? undefined;
      return new Response(streamFromString(ssePayload([
        JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }] }),
        JSON.stringify({ choices: [], usage: { total_tokens: 0 } }),
      ])), { status: 200 });
    });

    const p = new OpenAIProvider({ apiKey: 'sk-x', model: 'gpt-5' });
    await collect(p.stream(baseReq(), aborter.signal));
    expect(receivedSignal).toBe(aborter.signal);
  });
});
```

- [ ] **Step 2: Run, expect FAIL (module doesn't exist)**

```bash
npx vitest run server/domain/dispatch/providers/openai.provider.test.ts
```

- [ ] **Step 3: Implement `openai.provider.ts`**

```ts
// server/domain/dispatch/providers/openai.provider.ts
import type {
  AIProvider,
  ProviderCapabilities,
  ProviderChunk,
  ProviderRequest,
  ProviderToolDecl,
  ProviderToolResultMessage,
} from './provider.types';

export type OpenAIModel = 'gpt-5' | 'gpt-5-mini' | 'gpt-4.1' | 'o3';

export interface OpenAIProviderOpts {
  apiKey: string;
  model: OpenAIModel;
}

interface OpenAIToolCallFrag {
  index: number;
  id?: string;
  type?: 'function';
  function?: { name?: string; arguments?: string };
}

interface OpenAIDelta {
  content?: string;
  reasoning?: string;
  reasoning_content?: string;
  tool_calls?: OpenAIToolCallFrag[];
}

interface OpenAIChoice {
  delta?: OpenAIDelta;
  finish_reason?: 'stop' | 'tool_calls' | 'length' | 'content_filter' | null;
}

interface OpenAIChunk {
  choices?: OpenAIChoice[];
  usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
}

interface OpenAIErrorBody {
  error?: { message?: string };
}

const ENDPOINT = 'https://api.openai.com/v1/chat/completions';

export class OpenAIProvider implements AIProvider {
  readonly model: string;
  readonly capabilities: ProviderCapabilities;

  constructor(private readonly opts: OpenAIProviderOpts) {
    this.model = opts.model;
    this.capabilities = {
      thinking: opts.model === 'o3',
      toolCalling: true,
    };
  }

  async *stream(req: ProviderRequest, signal: AbortSignal): AsyncIterable<ProviderChunk> {
    const body = buildBody(this.model, req);

    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'authorization': `Bearer ${this.opts.apiKey}`,
        'accept': 'text/event-stream',
      },
      body: JSON.stringify(body),
      signal,
    });

    if (!res.ok) {
      let apiMsg = '';
      try {
        const errBody = (await res.json()) as OpenAIErrorBody;
        if (typeof errBody.error?.message === 'string') apiMsg = errBody.error.message;
      } catch {
        // ignore body parse failure
      }
      if (res.status === 401) {
        throw new Error('OpenAI auth failed — check OPENAI_API_KEY');
      }
      throw new Error(apiMsg || `OpenAI HTTP ${res.status}`);
    }

    if (!res.body) {
      throw new Error('OpenAI response has no body');
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = '';
    const toolBuffers = new Map<number, { id: string; name: string; argsBuffer: string }>();
    let totalTokens = 0;
    let sawUsage = false;

    try {
      while (true) {
        if (signal.aborted) return;
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });

        let sep;
        while ((sep = buf.indexOf('\n\n')) >= 0) {
          const frame = buf.slice(0, sep);
          buf = buf.slice(sep + 2);
          const dataLines: string[] = [];
          for (const line of frame.split('\n')) {
            if (line.startsWith('data:')) {
              dataLines.push(line.slice(5).trimStart());
            }
          }
          if (dataLines.length === 0) continue;
          const dataStr = dataLines.join('\n');
          if (dataStr === '[DONE]') {
            // OpenAI's terminator. Bail out — done emission happens via finish_reason+usage path.
            return;
          }
          let parsed: OpenAIChunk;
          try {
            parsed = JSON.parse(dataStr) as OpenAIChunk;
          } catch {
            continue;
          }

          if (parsed.usage && typeof parsed.usage.total_tokens === 'number') {
            totalTokens = parsed.usage.total_tokens;
            sawUsage = true;
          }

          const choice = parsed.choices?.[0];
          if (!choice) continue;
          const delta = choice.delta ?? {};

          if (typeof delta.content === 'string' && delta.content.length > 0) {
            yield { type: 'text', text: delta.content };
          }
          const reasoning = delta.reasoning ?? delta.reasoning_content;
          if (typeof reasoning === 'string' && reasoning.length > 0 && req.thinking === true) {
            yield { type: 'thinking', text: reasoning };
          }
          if (Array.isArray(delta.tool_calls)) {
            for (const frag of delta.tool_calls) {
              const idx = frag.index;
              const existing = toolBuffers.get(idx) ?? { id: '', name: '', argsBuffer: '' };
              if (typeof frag.id === 'string' && frag.id.length > 0) existing.id = frag.id;
              if (frag.function?.name) existing.name = frag.function.name;
              if (typeof frag.function?.arguments === 'string') {
                existing.argsBuffer += frag.function.arguments;
              }
              toolBuffers.set(idx, existing);
            }
          }

          if (choice.finish_reason === 'tool_calls') {
            const sortedIndices = [...toolBuffers.keys()].sort((a, b) => a - b);
            for (const i of sortedIndices) {
              const entry = toolBuffers.get(i)!;
              let parsedArgs: Record<string, unknown> = {};
              if (entry.argsBuffer.length > 0) {
                try {
                  parsedArgs = JSON.parse(entry.argsBuffer) as Record<string, unknown>;
                } catch {
                  parsedArgs = {};
                }
              }
              yield {
                type: 'function_call',
                call: {
                  callId: entry.id,
                  qualifiedName: entry.name,
                  args: parsedArgs,
                },
              };
            }
            return;
          }
          if (choice.finish_reason === 'stop') {
            yield {
              type: 'done',
              usage: sawUsage && totalTokens > 0 ? { totalTokens } : undefined,
            };
            return;
          }
        }
      }
    } finally {
      try { reader.releaseLock(); } catch { /* ignore */ }
    }

    // Stream ended naturally without an explicit finish_reason: emit a defensive done.
    yield {
      type: 'done',
      usage: sawUsage && totalTokens > 0 ? { totalTokens } : undefined,
    };
  }
}

function buildBody(model: string, req: ProviderRequest): unknown {
  const messages: Array<Record<string, unknown>> = [];
  if (req.systemInstruction.trim().length > 0) {
    messages.push({ role: 'system', content: req.systemInstruction });
  }
  for (const m of req.history) {
    messages.push({
      role: m.role === 'model' ? 'assistant' : 'user',
      content: m.text,
    });
  }
  if (req.pendingAssistantText && req.pendingAssistantText.length > 0) {
    messages.push({ role: 'assistant', content: req.pendingAssistantText });
  }
  for (const r of req.toolResults ?? []) {
    messages.push(...buildToolResultMessages(r));
  }
  messages.push({ role: 'user', content: req.userMessage });

  return {
    model,
    stream: true,
    stream_options: { include_usage: true },
    messages,
    tools: req.mcpTools && req.mcpTools.length > 0 ? req.mcpTools.map(toOpenAITool) : undefined,
  };
}

function toOpenAITool(t: ProviderToolDecl) {
  return {
    type: 'function' as const,
    function: {
      name: t.qualifiedName,
      description: t.description ?? '',
      parameters: t.schema,
    },
  };
}

function buildToolResultMessages(r: ProviderToolResultMessage): Array<Record<string, unknown>> {
  return [
    {
      role: 'assistant',
      content: null,
      tool_calls: [{
        id: r.callId,
        type: 'function',
        function: { name: r.qualifiedName, arguments: '{}' },
      }],
    },
    {
      role: 'tool',
      tool_call_id: r.callId,
      content: r.ok ? JSON.stringify(r.output ?? {}) : JSON.stringify({ error: r.error }),
    },
  ];
}
```

- [ ] **Step 4: Run, expect PASS (11 tests)**

```bash
npx vitest run server/domain/dispatch/providers/openai.provider.test.ts
```

- [ ] **Step 5: Run full server suite (regression check)**

```bash
npx vitest run server
```

Expected: all existing tests pass + the 11 new ones (413 → 424).

- [ ] **Step 6: Lint + commit**

```bash
npm run lint
git add server/domain/dispatch/providers/openai.provider.ts server/domain/dispatch/providers/openai.provider.test.ts
git commit -m "feat(slice-12): OpenAIProvider (Chat Completions API; SSE streaming)"
```

---

## Phase C — Provider registry wiring

### Task C1: ProviderRegistry registers openai entries when API key is set

**Files:**
- Modify: `server/domain/providers/discovery.ts`
- Modify: `server/domain/providers/registry.ts`
- Modify: `server/domain/providers/registry.test.ts`
- Modify: `server/test/registry.test-helper.ts`

The registry follows the Gemini pattern: present env-var key → register entries; absent → omit. Three additions: a new transport literal, two new deps fields (`openAIApiKey` + `openAIBuilder`), and a registration block in `refresh()`.

- [ ] **Step 1: Add the model list to `discovery.ts`**

```ts
// Append to server/domain/providers/discovery.ts:
export function openAIHardcodedModels(): string[] {
  return ['gpt-5', 'gpt-5-mini', 'gpt-4.1', 'o3'];
}
```

- [ ] **Step 2: Append failing tests to `registry.test.ts`**

Read the existing file first. Find the `baseDeps()` helper from slice 11. Add `openAIApiKey: undefined` and `openAIBuilder: (model: string) => makeFake(model)` to the helper's return value. Then append:

```ts
// Inside the existing describe('ProviderRegistry', ...) block:

it("registers all four openai entries when API key is set", async () => {
  const reg = new ProviderRegistry(baseDeps({ openAIApiKey: 'sk-test' }));
  await reg.refresh();
  expect(reg.get('openai:gpt-5')).not.toBeNull();
  expect(reg.get('openai:gpt-5-mini')).not.toBeNull();
  expect(reg.get('openai:gpt-4.1')).not.toBeNull();
  expect(reg.get('openai:o3')).not.toBeNull();
});

it("skips openai entries when API key is absent", async () => {
  const reg = new ProviderRegistry(baseDeps({ openAIApiKey: undefined }));
  await reg.refresh();
  expect(reg.list().find((d) => d.transport === 'openai')).toBeUndefined();
});

it("displayName for openai includes OpenAI and the model id", async () => {
  const reg = new ProviderRegistry(baseDeps({ openAIApiKey: 'sk-test' }));
  await reg.refresh();
  const d = reg.describe('openai:o3');
  expect(d?.displayName).toMatch(/openai/i);
  expect(d?.displayName).toContain('o3');
});

it("capabilities flow from the builder's instance (o3 thinks, others don't)", async () => {
  // The fake builder gives every model { thinking: true, toolCalling: true }.
  // For this test, swap in an openAIBuilder that returns model-specific caps.
  const reg = new ProviderRegistry(baseDeps({
    openAIApiKey: 'sk-test',
    openAIBuilder: (model: string) => ({
      model,
      capabilities: { thinking: model === 'o3', toolCalling: true },
      async *stream() { yield { type: 'done' as const }; },
    }),
  }));
  await reg.refresh();
  expect(reg.describe('openai:gpt-5')?.capabilities).toEqual({ thinking: false, toolCalling: true });
  expect(reg.describe('openai:o3')?.capabilities).toEqual({ thinking: true, toolCalling: true });
});
```

- [ ] **Step 3: Run, expect FAIL**

```bash
npx vitest run server/domain/providers/registry.test.ts
```

Expected: FAIL — `openAIApiKey` / `openAIBuilder` not in `ProviderRegistryDeps`.

- [ ] **Step 4: Modify `registry.ts`**

a) Widen the transport union:

```ts
export type ProviderTransport = 'fake' | 'gemini' | 'ollama' | 'anthropic' | 'openai';
```

b) Add the deps fields:

```ts
export interface ProviderRegistryDeps {
  ollamaHost: string;
  geminiApiKey: string | undefined;
  anthropicAuth: 'oauth' | 'apikey' | 'none';
  openAIApiKey: string | undefined;
  fakeProvider: AIProvider;
  geminiBuilder: (model: string) => AIProvider;
  ollamaBuilder: (model: string) => AIProvider;
  anthropicBuilder: (model: string) => AIProvider;
  openAIBuilder: (model: string) => AIProvider;
  defaultOverride?: string;
}
```

c) Import the new helper:

```ts
import { discoverOllama, geminiHardcodedModels, anthropicHardcodedModels, openAIHardcodedModels } from './discovery';
```

d) Update `displayNameFor`:

```ts
function displayNameFor(transport: ProviderTransport, model: string): string {
  if (transport === 'fake') return 'Fake (default)';
  if (transport === 'gemini') return `Gemini / ${model}`;
  if (transport === 'anthropic') return `Anthropic / ${model}`;
  if (transport === 'openai') return `OpenAI / ${model}`;
  return `Ollama / ${model}`;
}
```

e) In `refresh()`, insert this block AFTER the Anthropic block and BEFORE the Ollama block:

```ts
    // OpenAI
    if (this.deps.openAIApiKey) {
      for (const model of openAIHardcodedModels()) {
        const provider = this.deps.openAIBuilder(model);
        next.set(`openai:${model}`, {
          provider,
          descriptor: {
            name: `openai:${model}`,
            transport: 'openai',
            model,
            capabilities: provider.capabilities,
            displayName: displayNameFor('openai', model),
          },
        });
      }
    }
```

f) Update `defaultName()` to consider OpenAI between Gemini and Anthropic (priority: explicit > gemini > openai > anthropic > ollama > fake):

```ts
defaultName(): string | null {
  if (this.deps.defaultOverride && this.entries.has(this.deps.defaultOverride)) {
    return this.deps.defaultOverride;
  }
  for (const e of this.entries.values()) {
    if (e.descriptor.transport === 'gemini') return e.descriptor.name;
  }
  for (const e of this.entries.values()) {
    if (e.descriptor.transport === 'openai') return e.descriptor.name;
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

- [ ] **Step 5: Update `server/test/registry.test-helper.ts`**

The `buildSingleProviderRegistry` helper builds a registry where every transport's builder returns the same provider. Add the new fields:

```ts
import { ProviderRegistry } from '@/server/domain/providers/registry';
import type { AIProvider } from '@/server/domain/dispatch/providers/provider.types';

export async function buildSingleProviderRegistry(provider: AIProvider): Promise<ProviderRegistry> {
  const reg = new ProviderRegistry({
    ollamaHost: 'http://localhost:11434',
    geminiApiKey: undefined,
    anthropicAuth: 'none',
    openAIApiKey: undefined,
    fakeProvider: provider,
    geminiBuilder: () => provider,
    ollamaBuilder: () => provider,
    anthropicBuilder: () => provider,
    openAIBuilder: () => provider,
  });
  await reg.refresh();
  return reg;
}
```

- [ ] **Step 6: Run, expect PASS**

```bash
npx vitest run server/domain/providers/registry.test.ts
```

Expected: all existing tests + 4 new pass.

- [ ] **Step 7: Run full server suite (catch any other call sites broken by the new required fields)**

```bash
npx vitest run server
```

If a test fails because some other call site constructs `new ProviderRegistry({...})` without the new fields, fix it the same way: add `openAIApiKey: undefined` and a `openAIBuilder` stub. Check `server/routes/providers.routes.test.ts` if it uses `ProviderRegistry` directly.

- [ ] **Step 8: Lint + commit**

```bash
npm run lint
git add server/domain/providers/discovery.ts server/domain/providers/registry.ts server/domain/providers/registry.test.ts server/test/registry.test-helper.ts server/routes/providers.routes.test.ts
git commit -m "feat(slice-12): ProviderRegistry registers openai entries when API key is set"
```

(If `providers.routes.test.ts` didn't need changes, drop it from the `git add` line.)

---

## Phase D — Bootstrap wiring

### Task D1: `config.ts` reads `OPENAI_API_KEY` + `server/index.ts` wires `OpenAIProvider`

**Files:**
- Modify: `server/config.ts`
- Modify: `server/index.ts`

- [ ] **Step 1: Modify `server/config.ts`**

Add `openAIApiKey` to the config interface + loader:

```ts
import path from 'node:path';

export interface AppConfig {
  port: number;
  dataDir: string;
  fakeProvider: boolean;
  geminiApiKey: string;
  openAIApiKey: string;
}

function parsePort(raw: string | undefined): number {
  if (!raw) return 3000;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : 3000;
}

export function loadConfig(): AppConfig {
  return {
    port: parsePort(process.env.PORT),
    dataDir: process.env.AETHER_DATA_DIR ?? path.resolve(process.cwd(), 'data'),
    fakeProvider: process.env.AETHER_FAKE_PROVIDER === '1',
    geminiApiKey: process.env.GEMINI_API_KEY ?? '',
    openAIApiKey: process.env.OPENAI_API_KEY ?? '',
  };
}
```

- [ ] **Step 2: Modify `server/index.ts`**

Add the import alongside the other provider imports:

```ts
import { OpenAIProvider } from './domain/dispatch/providers/openai.provider';
```

Update the `ProviderRegistry` construction. Find the existing block and replace it with:

```ts
const providers = new ProviderRegistry({
  ollamaHost: process.env.OLLAMA_HOST ?? 'http://localhost:11434',
  geminiApiKey: cfg.geminiApiKey || undefined,
  anthropicAuth,
  openAIApiKey: cfg.openAIApiKey || undefined,
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
  openAIBuilder: (model) =>
    new OpenAIProvider({
      apiKey: cfg.openAIApiKey,
      model: model as 'gpt-5' | 'gpt-5-mini' | 'gpt-4.1' | 'o3',
    }),
  defaultOverride:
    process.env.AETHER_DEFAULT_PROVIDER ||
    (cfg.fakeProvider ? 'fake:default' : undefined),
});
```

- [ ] **Step 3: Run lint**

```bash
npm run lint
```

Expected: clean.

- [ ] **Step 4: Run full server suite**

```bash
npx vitest run server
```

Expected: all green. `server/index.ts` isn't directly unit-tested but its type-check must pass.

- [ ] **Step 5: Commit**

```bash
git add server/config.ts server/index.ts
git commit -m "feat(slice-12): bootstrap reads OPENAI_API_KEY + wires OpenAIProvider"
```

---

## Phase E — Frontend integration test

### Task E1: provider-switch integration covers OpenAI

**Files:**
- Modify: `src/integration/provider-switch.integration.test.tsx`

- [ ] **Step 1: Read the existing file**

Find the existing Anthropic case (added in slice 11). The new OpenAI case mirrors it exactly.

- [ ] **Step 2: Append the test**

```tsx
it('OpenAI entries appear in the selector when the server publishes them', async () => {
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
            name: 'openai:gpt-5',
            transport: 'openai',
            model: 'gpt-5',
            capabilities: { thinking: false, toolCalling: true },
            displayName: 'OpenAI / gpt-5',
          },
          {
            name: 'openai:o3',
            transport: 'openai',
            model: 'o3',
            capabilities: { thinking: true, toolCalling: true },
            displayName: 'OpenAI / o3',
          },
        ],
      }),
    ),
    http.get('http://localhost/api/providers/default', () =>
      HttpResponse.json({ name: 'fake:default' }),
    ),
    http.patch('http://localhost/api/sessions/:id', () =>
      HttpResponse.json({ id: '1', title: 't', createdAt: 0, updatedAt: 1 }),
    ),
  );

  const user = userEvent.setup();
  render(<App />);

  await waitFor(() => expect(useProvidersStore.getState().hydrated).toBe(true));
  await waitFor(() => expect(useSessionsStore.getState().activeSessionId).toBeTruthy());

  const selector = screen.getByRole('combobox', { name: /active provider/i });
  expect(
    await screen.findByRole('option', { name: /openai.*gpt-5/i }),
  ).toBeInTheDocument();
  expect(
    await screen.findByRole('option', { name: /openai.*o3/i }),
  ).toBeInTheDocument();

  await user.selectOptions(selector, 'openai:gpt-5');
  expect(selector).toHaveValue('openai:gpt-5');
});
```

- [ ] **Step 3: Run, expect PASS**

```bash
npx vitest run src/integration/provider-switch.integration.test.tsx
```

- [ ] **Step 4: Run full FE suite + lint**

```bash
npx vitest run src
npm run lint
```

- [ ] **Step 5: Commit**

```bash
git add src/integration/provider-switch.integration.test.tsx
git commit -m "test(slice-12): provider-switch covers OpenAI entries in selector"
```

---

## Phase F — Final verification + PR

### Task F1: lint + full tests + e2e + push + PR

- [ ] **Step 1: Lint**

```bash
npm run lint
```

Expected: clean.

- [ ] **Step 2: Vitest (full)**

```bash
npx vitest run
```

Expected: all tests pass. Previous baseline (post-slice 11) was 910. Expected new count: ~910 + 16 new (11 provider + 4 registry + 1 FE integration) ≈ 926.

- [ ] **Step 3: Playwright (regression check)**

```bash
npx playwright test
```

Expected: 13/13 pass (no new e2e per spec non-goals).

- [ ] **Step 4: Verify branch state**

```bash
git log --oneline main..HEAD
```

You should see one commit per task above, plus the spec commit, in order.

- [ ] **Step 5: Push**

```bash
git push -u origin feat/slice-12-openai
```

- [ ] **Step 6: Open PR**

```bash
gh pr create --title "feat(slice-12): OpenAI provider (Chat Completions API)" --body "$(cat <<'EOF'
## Summary

Slice 12 adds OpenAI (`gpt-5`, `gpt-5-mini`, `gpt-4.1`, `o3`) as a first-class provider in Aether.

- **Chat Completions API + native fetch.** No SDK dependency; direct HTTP+SSE to `/v1/chat/completions` with `stream: true` and `stream_options.include_usage: true`.
- **Auth via `OPENAI_API_KEY` env var.** Registration is gated on presence (Gemini pattern). Absent key → no entries in selector. Auth failures surface as send-time error toasts.
- **Tool calling preserved.** Tool declarations map to OpenAI's `tools: [{ type: 'function', ... }]` format. Streaming `delta.tool_calls[]` are accumulated by index; on `finish_reason: 'tool_calls'` the provider emits one `function_call` chunk per index and terminates. Flows through Aether's existing slice 7/10 approval/cancel/banner UX — identical to Gemini.
- **Reasoning tokens** for `o3` are surfaced via `delta.reasoning` OR `delta.reasoning_content` (both spellings handled defensively), gated on `req.thinking`.

## Architecture

`OpenAIProvider` (`server/domain/dispatch/providers/openai.provider.ts`) implements the existing `AIProvider` interface. `stream()` mirrors `OllamaProvider`'s SSE parser shape. Four hardcoded model entries; capabilities derive per-instance (o3 reports `thinking: true`; others false).

Spec: `docs/superpowers/specs/2026-05-21-aether-slice-12-openai-design.md`
Plan: `docs/superpowers/plans/2026-05-21-aether-slice-12-openai.md`

## Test plan

- [x] `npm run lint` — clean
- [x] `npx vitest run` — all passing
- [x] `npx playwright test` — 13/13 (no new e2e per spec non-goals)
- [x] New unit tests: `OpenAIProvider` (11 cases — capabilities, multi-chunk text + done, reasoning gating, alt reasoning field, tool_call accumulation, body shape, toolResults threading, 401 / 429, abort signal)
- [x] New registry cases: 4 entries on key set, 0 on absent, displayName, per-model capabilities
- [x] New FE integration: OpenAI entries appear in the TopBar provider selector

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Self-review notes

**Spec coverage:**
- ✅ Chat Completions API + native fetch — Task B1.
- ✅ Four hardcoded model entries — Tasks B1 (constructor) + C1 (registry).
- ✅ Capabilities: o3 thinks, others don't — Task B1 (constructor branch on model).
- ✅ Env-var-gated registration (no live probe) — Task C1 registry block.
- ✅ Stream terminates on `function_call`; dispatch re-calls with `toolResults` — Task B1.
- ✅ `stream_options.include_usage: true` — Task B1.
- ✅ Both `delta.reasoning` and `delta.reasoning_content` checked — Task B1 + dedicated test.
- ✅ Multiple `tool_calls` in one response, emitted in index order — Task B1 (sortedIndices loop).
- ✅ 401 → non-retryable; 429/5xx → retryable. Provider throws; dispatch maps — Task B1 covers the provider side.
- ✅ Frontend: zero new components, only an integration test — Task E1.

**Placeholder scan:** searched for "TBD", "TODO", "implement later", and similar phrases — none present.

**Type consistency:** `OpenAIModel` union (`'gpt-5' | 'gpt-5-mini' | 'gpt-4.1' | 'o3'`) is defined in B1 and referenced in D1's `index.ts` builder cast. `openAIApiKey` and `openAIBuilder` field names match across `ProviderRegistryDeps` (C1), the `baseDeps()` test helper (C1), `server/index.ts` wiring (D1), and `buildSingleProviderRegistry` (C1 step 5). `openAIHardcodedModels()` order matches the entries the tests look up.
