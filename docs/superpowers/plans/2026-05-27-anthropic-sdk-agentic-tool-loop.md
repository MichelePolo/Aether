# Anthropic SDK Agentic Tool Loop Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Anthropic (Claude subscription / OAuth) models work for both multi-turn chat and tool use by letting the Claude Agent SDK drive the agentic loop, while Aether keeps owning approval gating, tool execution, SSE streaming, and reasoning traces.

**Architecture:** The Claude Agent SDK's streaming-input prompt only accepts `role:'user'` messages, and it owns tool execution (you cannot intercept with `maxTurns:1` and feed `tool_result`s back via `resume` — the model just re-calls the tool; proven by spike). So the Anthropic provider (1) flattens prior conversation into a single user message, and (2) registers Aether's tools as an in-process MCP server whose handlers call back into a new `req.runToolCall(...)` callback. DispatchService implements `runToolCall` by reusing its existing gate+execute+SSE+trace logic (extracted into a shared `gateExecuteAndTrace` method). The provider never yields a `function_call` chunk, so `runDispatchLoop`'s manual tool loop is simply inert for Anthropic — it only streams text/thinking/done.

**Tech Stack:** TypeScript (strict), `@anthropic-ai/claude-agent-sdk@0.3.145`, `zod`, Vitest (backend project, node env). Run focused tests with `npx vitest run <file>`.

---

## Background: confirmed root cause

The current provider's `buildPromptStream` emits `role:'assistant'` messages (history model turns at `anthropic.provider.ts:183`, `pendingAssistantText` at `:192`, reconstructed `tool_use` at `:203`). The SDK rejects these synchronously: `Error: Expected message role 'user', got 'assistant'` → the `claude` child exits 1. This single bug causes BOTH reported symptoms (tool calls die on the continuation turn; any second message in a session instant-fails because history now contains an assistant turn). Spikes proved Option B (resume + manual tool_result) is not viable and Option C (SDK-driven loop + in-process MCP handlers + `canUseTool`/allowedTools) works.

## File Structure

- **Modify** `server/domain/dispatch/providers/provider.types.ts` — add `ProviderToolCallOutcome` and optional `ProviderRequest.runToolCall`.
- **Modify** `server/domain/dispatch/dispatch.service.ts` — extract `gateExecuteAndTrace(fnCall, sse, tracer)`; build a `runToolCall` closure in `runDispatchLoop`; pass it into every `provider.stream(...)` request. (`runDispatchLoop` is at `:148`, the inline gate/execute block to refactor is `:226-282`.)
- **Rewrite** `server/domain/dispatch/providers/anthropic.provider.ts` — `stream()` drives the SDK loop; `buildPromptStream` becomes user-only; `toolDefFor` bridges to `req.runToolCall`; add `renderConversation` (history flattening); keep + tidy the stderr enrichment.
- **Rewrite tests** `server/domain/dispatch/providers/anthropic.provider.test.ts` — assert user-only prompt, handler→runToolCall bridge, event mapping. Add the regression guard for the role bug.
- **Add tests** `server/domain/dispatch/dispatch.service.test.ts` — cover `runToolCall` (request→gate→result SSE, reject path, cap).

---

### Task 1: Provider contract — `runToolCall` callback

**Files:**
- Modify: `server/domain/dispatch/providers/provider.types.ts`

- [ ] **Step 1: Add the outcome type and the optional request callback**

In `server/domain/dispatch/providers/provider.types.ts`, add after `ProviderToolResultMessage` (line 18):

```ts
/** Outcome of executing one tool call. Mirrors McpToolResult without coupling
 *  provider.types to the mcp domain. */
export interface ProviderToolCallOutcome {
  ok: boolean;
  output?: unknown;
  error?: string;
}
```

Then add this field to the `ProviderRequest` interface (after `attachments?` at line 32):

```ts
  /** Provided by the dispatch layer for providers that run the agentic tool
   *  loop INTERNALLY (Anthropic via the Claude Agent SDK). The provider calls
   *  this once per tool the model invokes; the dispatch layer performs approval
   *  gating, execution, SSE events and tracing, then returns the outcome.
   *  Stateless REST providers (gemini/openai/ollama/fake) ignore it and instead
   *  yield `function_call` chunks for runDispatchLoop to handle. */
  runToolCall?: (call: {
    qualifiedName: string;
    args: Record<string, unknown>;
  }) => Promise<ProviderToolCallOutcome>;
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: exit 0 (no usages yet; optional field is non-breaking).

- [ ] **Step 3: Commit**

```bash
git add server/domain/dispatch/providers/provider.types.ts
git commit -m "feat(dispatch): add ProviderRequest.runToolCall for SDK-driven tool loops"
```

---

### Task 2: DispatchService — shared gate/execute + `runToolCall`

**Files:**
- Modify: `server/domain/dispatch/dispatch.service.ts`
- Test: `server/domain/dispatch/dispatch.service.test.ts`

- [ ] **Step 1: Write the failing test (agentic provider via runToolCall)**

Add to `server/domain/dispatch/dispatch.service.test.ts`. This uses a stub provider that does NOT yield `function_call`; instead it calls `req.runToolCall` (like the Anthropic provider will) and streams the result back as text. Reuse the file's existing harness for building a `DispatchService` with a `mcpRegistry` + `historyStore` (copy the setup from the nearest existing tool-calling test in this file).

```ts
describe('runToolCall (agentic providers)', () => {
  it('gates, executes, emits tool_call_request + tool_call_result, returns outcome', async () => {
    // Stub provider that drives its own tool loop via req.runToolCall.
    const agenticProvider = {
      model: 'claude-test',
      capabilities: { thinking: false, toolCalling: true, vision: true },
      async *stream(req: ProviderRequest) {
        const outcome = await req.runToolCall!({ qualifiedName: 'mock.echo', args: { message: 'hi' } });
        yield { type: 'text', text: outcome.ok ? `OUT:${JSON.stringify(outcome.output)}` : `ERR:${outcome.error}` };
        yield { type: 'done', usage: { totalTokens: 1 } };
      },
    } as unknown as AIProvider;

    // Wire DispatchService so this provider is selected, mcpRegistry.callTool
    // returns { ok:true, output:{ echoed:'hi' } }, and policy auto-approves.
    // (Mirror the setup of the existing tool-call test in this file.)
    const { service, sse, sessionId, historyStore } = buildAgenticHarness(agenticProvider);

    await service.handle({ sessionId, message: 'use the tool' }, sse, new AbortController().signal);

    const events = sse.captured();
    expect(events.find((e) => e.event === 'tool_call_request')?.data).toMatchObject({ qualifiedName: 'mock.echo' });
    expect(events.find((e) => e.event === 'tool_call_result')?.data).toMatchObject({ ok: true });
    const text = events.filter((e) => e.event === 'text').map((e) => (e.data as { chunk: string }).chunk).join('');
    expect(text).toContain('OUT:');
    const stored = await historyStore.read(sessionId);
    expect(stored!.some((m) => m.role === 'model' && m.text.includes('OUT:'))).toBe(true);
  });

  it('returns reject outcome (no execution) when the gate rejects', async () => {
    const agenticProvider = {
      model: 'claude-test',
      capabilities: { thinking: false, toolCalling: true, vision: true },
      async *stream(req: ProviderRequest) {
        const outcome = await req.runToolCall!({ qualifiedName: 'mock.echo', args: {} });
        yield { type: 'text', text: outcome.ok ? 'OK' : `ERR:${outcome.error}` };
        yield { type: 'done' };
      },
    } as unknown as AIProvider;

    // Harness with a breakpointService/registry whose awaitDecision resolves 'reject'.
    const { service, sse, sessionId } = buildAgenticHarness(agenticProvider, { decision: 'reject' });
    await service.handle({ sessionId, message: 'x' }, sse, new AbortController().signal);

    const text = sse.captured().filter((e) => e.event === 'text').map((e) => (e.data as { chunk: string }).chunk).join('');
    expect(text).toContain('ERR:Rejected by user');
  });
});
```

> **Note:** `buildAgenticHarness` is a thin wrapper you write over the file's existing setup helpers — it just selects the stub provider and configures `mcpRegistry.callTool`/`policy`/`awaitDecision`. Keep it local to this describe block. If the existing file already exposes a reusable setup, call that instead and pass the stub provider.

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run server/domain/dispatch/dispatch.service.test.ts -t "runToolCall"`
Expected: FAIL — `req.runToolCall` is `undefined`, so the stub throws "runToolCall is not a function".

- [ ] **Step 3: Extract `gateExecuteAndTrace` and add the `runToolCall` closure**

In `server/domain/dispatch/dispatch.service.ts`, add a private method (place it just above `runDispatchLoop` at `:148`):

```ts
  /** Emit the approval request, resolve the gate decision, execute (or reject),
   *  emit the result, and push a reasoning-tracer step. Shared by the manual
   *  function_call loop and the agentic runToolCall path. */
  private async gateExecuteAndTrace(
    fnCall: ProviderFunctionCall,
    sse: SseEmitter,
    tracer: ReasoningTracer,
  ): Promise<McpToolResult> {
    sse.event('tool_call_request', fnCall);

    let mode: 'auto' | 'gate';
    if (this.deps.breakpointService) {
      mode = await this.deps.breakpointService.resolveDecision({
        qualifiedName: fnCall.qualifiedName,
        args: fnCall.args,
      });
    } else {
      const policy = this.deps.mcpRegistry?.policy(fnCall.qualifiedName) ?? {};
      mode = policy.autoApprove ? 'auto' : 'gate';
    }
    const decision: 'approve' | 'reject' = mode === 'auto'
      ? 'approve'
      : await (this.deps.mcpRegistry?.awaitDecision(fnCall.callId, 60_000) ?? Promise.resolve('reject' as const))
          .catch(() => 'reject' as const);

    const t0 = performance.now();
    let toolResult: McpToolResult;
    let progressNote = '';
    if (decision === 'reject') {
      toolResult = { ok: false, error: 'Rejected by user' };
    } else if (!this.deps.mcpRegistry) {
      toolResult = { ok: false, error: 'No MCP registry configured' };
    } else {
      const executed = await this.executeToolCall(fnCall, sse);
      toolResult = executed.result;
      progressNote = executed.progressNote;
    }
    const durationMs = Math.round(performance.now() - t0);

    sse.event('tool_call_result', { id: fnCall.callId, ...toolResult });
    tracer.pushExternal({
      type: 'tool_call',
      title: `Tool: ${fnCall.qualifiedName}`,
      content: toolResult.ok
        ? `executed ${fnCall.qualifiedName}`
        : `tool failed: ${toolResult.error}`,
      durationMs,
      toolCall: {
        id: fnCall.callId,
        qualifiedName: fnCall.qualifiedName,
        args: fnCall.args,
        result: toolResult.ok ? toolResult.output : undefined,
        error: toolResult.ok ? undefined : toolResult.error,
        durationMs,
        progressNote: progressNote || undefined,
      },
    });
    return toolResult;
  }
```

- [ ] **Step 4: Refactor the inline loop to use it, and build + pass `runToolCall`**

In `runDispatchLoop`, replace the inline block from `sse.event('tool_call_request', pendingCall);` (line 226) through the `tracer.pushExternal({...})` ending at line 274 with a single call. Keep the cap check (lines 214-224) and the `pendingToolResults`/`pendingCall = null` assignment (lines 276-283). The replaced section becomes:

```ts
            toolCallsCount += 1;

            const toolResult = await this.gateExecuteAndTrace(pendingCall, sse, tracer);

            pendingToolResults = [{
              callId: pendingCall.callId,
              qualifiedName: pendingCall.qualifiedName,
              ok: toolResult.ok,
              output: toolResult.ok ? toolResult.output : undefined,
              error: toolResult.ok ? undefined : toolResult.error,
            }];
            pendingCall = null;
```

(Delete the now-duplicated `sse.event('tool_call_request'...)`, the `mode`/`decision`/`t0`/`toolResult`/`durationMs` locals, the `sse.event('tool_call_result'...)`, and the `tracer.pushExternal(...)` — they now live in `gateExecuteAndTrace`. Note `toolCallsCount += 1;` was previously at line 224; keep it.)

Then define the agentic callback at the top of the `tracer.step('dispatch', ...).run` body, before the `while (true)` loop:

```ts
          const runToolCall = async (
            call: { qualifiedName: string; args: Record<string, unknown> },
          ): Promise<{ ok: boolean; output?: unknown; error?: string }> => {
            if (toolCallsCount >= MAX_TOOL_CALLS_PER_DISPATCH) {
              return { ok: false, error: 'Max tool calls per dispatch exceeded' };
            }
            toolCallsCount += 1;
            const fnCall: ProviderFunctionCall = {
              callId: randomUUID(),
              qualifiedName: call.qualifiedName,
              args: call.args,
            };
            const r = await this.gateExecuteAndTrace(fnCall, sse, tracer);
            return r.ok ? { ok: true, output: r.output } : { ok: false, error: r.error };
          };
```

Finally, add `runToolCall` to the request object passed to `opts.provider.stream(...)` (inside the `while` loop, the object currently spanning lines 178-187): add the line `runToolCall,` alongside `attachments: opts.attachments,`.

- [ ] **Step 5: Run the new + existing dispatch tests**

Run: `npx vitest run server/domain/dispatch/dispatch.service.test.ts`
Expected: PASS — new `runToolCall` tests pass; all pre-existing tests (manual function_call loop for fake/gemini-style providers) still pass (proves the `gateExecuteAndTrace` extraction didn't regress).

- [ ] **Step 6: Commit**

```bash
git add server/domain/dispatch/dispatch.service.ts server/domain/dispatch/dispatch.service.test.ts
git commit -m "feat(dispatch): share gate/execute logic + provide runToolCall to providers"
```

---

### Task 3: Rewrite AnthropicProvider for the SDK-driven loop

**Files:**
- Modify: `server/domain/dispatch/providers/anthropic.provider.ts`
- Test: `server/domain/dispatch/providers/anthropic.provider.test.ts`

- [ ] **Step 1: Write the failing tests (replace tool/history tests; keep mapping tests)**

In `server/domain/dispatch/providers/anthropic.provider.test.ts`:

(a) DELETE these now-invalid tests: `'maps tool_use to function_call and terminates the stream (strips mcp__aether__ prefix)'`, `'forwards tool_use names unchanged when prefix is missing (defensive)'`, and `'threads toolResults back into the SDK prompt on continuation'`.

(b) REPLACE `'forwards systemPrompt, history, userMessage to the SDK as an AsyncIterable<SDKUserMessage>'` with a user-only assertion (this is the regression guard for the root-cause bug):

```ts
  it('sends history flattened into a SINGLE user-role message (never role:assistant)', async () => {
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
    }), new AbortController().signal));

    const arg = querySpy.mock.calls[0][0] as {
      prompt: AsyncIterable<{ message: { role: string; content: Array<{ type: string; text?: string }> } }>;
      options: { systemPrompt: string; model: string; maxTurns: number };
    };
    expect(arg.options.systemPrompt).toBe('sys');
    expect(arg.options.model).toBe('claude-sonnet-4-6');
    expect(arg.options.maxTurns).toBeGreaterThan(1);

    const messages: Array<{ message: { role: string; content: Array<{ type: string; text?: string }> } }> = [];
    for await (const m of arg.prompt) messages.push(m);
    // EXACTLY one message, role 'user', and every message is role 'user'.
    expect(messages).toHaveLength(1);
    expect(messages.every((m) => m.message.role === 'user')).toBe(true);
    const text = messages[0].message.content.find((c) => c.type === 'text')!.text!;
    expect(text).toContain('q1');
    expect(text).toContain('a1');
    expect(text).toContain('q2');
  });
```

(c) ADD a handler-bridge test:

```ts
  it('registers tool handlers that delegate execution to req.runToolCall', async () => {
    querySpy.mockReturnValue(asyncIterableFrom([
      { type: 'result', usage: { input_tokens: 0, output_tokens: 0 } },
    ]));
    const runToolCall = vi.fn(async () => ({ ok: true, output: { echoed: 'hi' } }));
    const p = new AnthropicProvider({ model: 'claude-haiku-4-5' });
    await collect(p.stream(baseReq({
      mcpTools: [{ qualifiedName: 'mock.echo', description: 'Echoes', schema: { type: 'object', properties: { message: {} } } }],
      runToolCall,
    }), new AbortController().signal));

    const serverOpts = createSdkMcpServerSpy.mock.calls[0][0] as {
      tools: Array<{ name: string; handler: (a: unknown, e: unknown) => Promise<{ content: Array<{ type: string; text: string }>; isError?: boolean }> }>;
    };
    const handler = serverOpts.tools[0].handler;
    const result = await handler({ message: 'hi' }, {});
    expect(runToolCall).toHaveBeenCalledWith({ qualifiedName: 'mock.echo', args: { message: 'hi' } });
    expect(result.content[0].text).toContain('echoed');
    expect(result.isError).toBeUndefined();

    // Allowed tools are the prefixed names.
    const arg = querySpy.mock.calls[0][0] as { options: { allowedTools: string[] } };
    expect(arg.options.allowedTools).toEqual(['mcp__aether__mock.echo']);
  });

  it('handler maps a failed runToolCall outcome to an isError CallToolResult', async () => {
    querySpy.mockReturnValue(asyncIterableFrom([{ type: 'result', usage: { input_tokens: 0, output_tokens: 0 } }]));
    const runToolCall = vi.fn(async () => ({ ok: false, error: 'Rejected by user' }));
    const p = new AnthropicProvider({ model: 'claude-haiku-4-5' });
    await collect(p.stream(baseReq({
      mcpTools: [{ qualifiedName: 'mock.echo', description: '', schema: { type: 'object', properties: {} } }],
      runToolCall,
    }), new AbortController().signal));
    const serverOpts = createSdkMcpServerSpy.mock.calls[0][0] as { tools: Array<{ handler: (a: unknown, e: unknown) => Promise<{ content: Array<{ type: string; text: string }>; isError?: boolean }> }> };
    const result = await serverOpts.tools[0].handler({}, {});
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Rejected by user');
  });

  it('does NOT yield a function_call chunk when the SDK reports a tool_use (SDK owns execution)', async () => {
    querySpy.mockReturnValue(asyncIterableFrom([
      { type: 'assistant', message: { content: [{ type: 'tool_use', id: 'TC1', name: 'mcp__aether__mock.echo', input: {} }] } },
      { type: 'assistant', message: { content: [{ type: 'text', text: 'done' }] } },
      { type: 'result', usage: { input_tokens: 1, output_tokens: 1 } },
    ]));
    const p = new AnthropicProvider({ model: 'claude-haiku-4-5' });
    const chunks = await collect(p.stream(baseReq(), new AbortController().signal));
    expect(chunks.find((c) => c.type === 'function_call')).toBeUndefined();
    expect(chunks).toContainEqual({ type: 'text', text: 'done' });
  });
```

(d) UPDATE the attachments test `'prepends image blocks to the final user message content when attachments are present'`: there is now exactly ONE message (the flattened user message). Change `messages.at(-1)` to `messages[0]`, and the text block assertion to use `.toContain('describe this image')` instead of strict equality (the text now also carries any flattened history; with empty history it is just the user message, but `toContain` is robust).

- [ ] **Step 2: Run to verify failures**

Run: `npx vitest run server/domain/dispatch/providers/anthropic.provider.test.ts`
Expected: FAIL — current `buildPromptStream` emits multiple messages with `role:'assistant'`; current `toolDefFor` handler throws; current code yields `function_call`.

- [ ] **Step 3: Rewrite `anthropic.provider.ts`**

Replace the whole file with:

```ts
import { query, createSdkMcpServer } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import type {
  AIProvider,
  ProviderCapabilities,
  ProviderChunk,
  ProviderRequest,
  ProviderToolDecl,
} from './provider.types';

const AETHER_MCP_NAME = 'aether';
const AETHER_TOOL_PREFIX = `mcp__${AETHER_MCP_NAME}__`;
// Generous turn budget so the SDK can run a multi-step tool loop without hitting
// error_max_turns in normal use. The per-dispatch tool cap is still enforced by
// the dispatch layer's runToolCall (returns an error outcome past the limit).
const MAX_TURNS = 24;

export interface AnthropicProviderOpts {
  model: 'claude-opus-4-7' | 'claude-sonnet-4-6' | 'claude-haiku-4-5';
}

interface SdkContentBlock {
  type: 'text' | 'thinking' | 'tool_use' | string;
  text?: string;
  thinking?: string;
}

interface SdkEvent {
  type: 'assistant' | 'result' | string;
  error?: string;
  message?: { content?: SdkContentBlock[] };
  usage?: { input_tokens?: number; output_tokens?: number };
}

interface SdkUserMessageEnvelope {
  type: 'user';
  message: {
    role: 'user';
    content: Array<
      | { type: 'text'; text: string }
      | { type: 'image'; source: { type: 'base64'; media_type: string; data: string } }
    >;
  };
  parent_tool_use_id: null;
}

export class AnthropicProvider implements AIProvider {
  readonly capabilities: ProviderCapabilities = { thinking: true, toolCalling: true, vision: true };
  readonly model: string;

  constructor(opts: AnthropicProviderOpts) {
    this.model = opts.model;
  }

  async *stream(req: ProviderRequest, signal: AbortSignal): AsyncIterable<ProviderChunk> {
    const aborter = new AbortController();
    const onAbort = (): void => aborter.abort();
    if (signal.aborted) aborter.abort();
    else signal.addEventListener('abort', onAbort, { once: true });

    let stderrBuf = '';
    try {
      const options: Record<string, unknown> = {
        systemPrompt: req.systemInstruction,
        model: this.model,
        maxTurns: MAX_TURNS,
        abortController: aborter,
        // Surface the spawned `claude` child's stderr so a non-zero exit reports
        // WHY instead of the SDK's generic "exited with code 1".
        stderr: (data: string): void => { stderrBuf += data; },
      };
      if (req.thinking === true) {
        options.thinking = { type: 'enabled', budgetTokens: 8000 };
      }
      if (req.mcpTools && req.mcpTools.length > 0) {
        const server = createSdkMcpServer({
          name: AETHER_MCP_NAME,
          tools: req.mcpTools.map((decl) => toolDefFor(decl, req)),
        });
        options.mcpServers = { [AETHER_MCP_NAME]: server };
        // Pre-allow our tools so the SDK runs the handler directly; the handler
        // delegates to req.runToolCall which performs Aether's own approval gate.
        options.allowedTools = req.mcpTools.map((t) => AETHER_TOOL_PREFIX + t.qualifiedName);
      } else {
        options.allowedTools = [];
        options.mcpServers = {};
      }

      const iter = query({
        prompt: buildPromptStream(req),
        options,
      } as unknown as Parameters<typeof query>[0]);

      for await (const ev of iter) {
        if (signal.aborted) return;
        const e = ev as SdkEvent;
        if (e.type === 'assistant') {
          if (typeof e.error === 'string') {
            throw new Error(`Anthropic error: ${e.error}`);
          }
          for (const block of e.message?.content ?? []) {
            if (block.type === 'text' && typeof block.text === 'string') {
              yield { type: 'text', text: block.text };
            } else if (block.type === 'thinking' && typeof block.thinking === 'string') {
              if (req.thinking === true) {
                yield { type: 'thinking', text: block.thinking };
              }
            }
            // tool_use blocks are executed by the SDK via the in-process MCP
            // handler (-> req.runToolCall). We do NOT surface function_call.
          }
        } else if (e.type === 'result') {
          const input = typeof e.usage?.input_tokens === 'number' ? e.usage.input_tokens : undefined;
          const output = typeof e.usage?.output_tokens === 'number' ? e.usage.output_tokens : undefined;
          const total = (input ?? 0) + (output ?? 0);
          yield {
            type: 'done',
            usage: total > 0 ? {
              totalTokens: total,
              ...(input !== undefined ? { inputTokens: input } : {}),
              ...(output !== undefined ? { outputTokens: output } : {}),
            } : undefined,
          };
          return;
        }
      }
    } catch (err) {
      if (stderrBuf.length > 0 && err instanceof Error) {
        throw new Error(`${err.message} | claude stderr: ${stderrBuf.slice(-2000)}`);
      }
      throw err;
    } finally {
      signal.removeEventListener('abort', onAbort);
    }
  }
}

/**
 * Build an SDK in-process MCP tool. The handler delegates the actual gate +
 * execution to req.runToolCall (the dispatch layer), then maps the outcome to a
 * CallToolResult the SDK feeds back to the model.
 */
function toolDefFor(decl: ProviderToolDecl, req: ProviderRequest): {
  name: string;
  description: string;
  inputSchema: Record<string, z.ZodType>;
  handler: (args: unknown, extra: unknown) => Promise<{ content: Array<{ type: 'text'; text: string }>; isError?: boolean }>;
} {
  const shape: Record<string, z.ZodType> = {};
  for (const key of Object.keys(decl.schema.properties ?? {})) {
    shape[key] = z.unknown();
  }
  return {
    name: decl.qualifiedName,
    description: decl.description ?? '',
    inputSchema: shape,
    handler: async (args: unknown) => {
      const outcome = req.runToolCall
        ? await req.runToolCall({
            qualifiedName: decl.qualifiedName,
            args: (args ?? {}) as Record<string, unknown>,
          })
        : { ok: false, error: 'No tool executor available (req.runToolCall missing)' };
      if (outcome.ok) {
        const text = typeof outcome.output === 'string'
          ? outcome.output
          : JSON.stringify(outcome.output ?? {});
        return { content: [{ type: 'text', text }] };
      }
      return { content: [{ type: 'text', text: outcome.error ?? 'tool failed' }], isError: true };
    },
  };
}

/**
 * Render the whole turn as ONE user-role message. The Claude Agent SDK's
 * streaming input only accepts role:'user'; prior assistant turns cannot be
 * replayed structurally, so they are flattened into a text transcript.
 *
 * ── DESIGN DECISION (your input shapes model behavior) ──────────────────────
 * The transcript format below is the default. Tune labels/structure to taste.
 */
function renderConversation(req: ProviderRequest): string {
  const parts: string[] = [];
  if (req.history.length > 0) {
    parts.push('# Conversation so far');
    for (const h of req.history) {
      parts.push(`${h.role === 'model' ? 'Assistant' : 'User'}: ${h.text}`);
    }
    parts.push('');
  }
  if (req.pendingAssistantText && req.pendingAssistantText.length > 0) {
    parts.push(`Assistant (interrupted — continue this response): ${req.pendingAssistantText}`);
    parts.push('');
  }
  parts.push(req.userMessage);
  return parts.join('\n');
}

async function* buildPromptStream(req: ProviderRequest): AsyncGenerator<SdkUserMessageEnvelope> {
  const content: SdkUserMessageEnvelope['message']['content'] = [];
  for (const a of req.attachments ?? []) {
    content.push({
      type: 'image',
      source: { type: 'base64', media_type: a.mime, data: a.bytes.toString('base64') },
    });
  }
  content.push({ type: 'text', text: renderConversation(req) });
  yield { type: 'user', message: { role: 'user', content }, parent_tool_use_id: null };
}
```

- [ ] **Step 4: Run the provider tests**

Run: `npx vitest run server/domain/dispatch/providers/anthropic.provider.test.ts`
Expected: PASS (all rewritten + retained tests).

- [ ] **Step 5: Type-check the whole project**

Run: `npx tsc --noEmit`
Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
git add server/domain/dispatch/providers/anthropic.provider.ts server/domain/dispatch/providers/anthropic.provider.test.ts
git commit -m "fix(anthropic): SDK-driven agentic loop with user-only prompt + runToolCall bridge"
```

> **Learning-mode contribution point:** `renderConversation` (the history-flattening format) is the natural place for your input — it directly shapes how Claude perceives prior turns and interrupted responses. Implement/tune it yourself during execution; the default above is a working starting point.

---

### Task 4: Tidy the diagnostic stderr instrumentation

**Files:**
- Modify: `server/domain/dispatch/providers/anthropic.provider.ts` (already includes the buffered enrichment from Task 3)

- [ ] **Step 1: Confirm no noisy per-line logging remains**

The Task-3 rewrite already drops the temporary `console.error('[anthropic][claude stderr]', ...)` per-line spam and keeps only the buffered `stderrBuf` that enriches a thrown error. Verify there is no `console.error` left in the file:

Run: `grep -n "console.error" server/domain/dispatch/providers/anthropic.provider.ts`
Expected: no output.

- [ ] **Step 2: Commit (only if a change was needed)**

```bash
git add server/domain/dispatch/providers/anthropic.provider.ts
git commit -m "chore(anthropic): keep stderr enrichment, drop debug log noise"
```

---

### Task 5: Full suite + manual verification of the real flow

**Files:** none (verification only)

- [ ] **Step 1: Run the full backend test project + type-check**

Run: `npx vitest run --project backend && npx tsc --noEmit`
Expected: all pass, exit 0.

- [ ] **Step 2: Manual — multi-turn chat (Symptom 2)**

Start the dev server (`npm run dev`), select an Anthropic model (e.g. Sonnet 4.6), send a message, wait for the reply, then send a SECOND message. Expected: the second message no longer instant-fails with "exited with code 1"; you get a normal reply. (This is the regression that proves the role-validation bug is fixed.)

- [ ] **Step 3: Manual — tool use (Symptom 1)**

Ask the model to `ping www.google.it`. Expected: the approval gate appears; on Approve, the Terminal tool runs and the model returns a normal answer using the output — no "Claude Code process exited with code 1". On Reject, the model is told the call was rejected and responds accordingly.

- [ ] **Step 4: Commit any doc/notes if needed** (otherwise nothing to commit).

---

## Self-Review

- **Spec coverage:** Symptom 2 (multi-turn chat) → Task 3 user-only prompt (regression test in Task 3 Step 1b) + Task 5 Step 2. Symptom 1 (tools) → Tasks 2+3 (runToolCall bridge) + Task 5 Step 3. Gating preserved → `gateExecuteAndTrace` (Task 2) used by both paths. SSE contract (`tool_call_request`/`started`/`progress`/`result`) preserved → reused via `executeToolCall` + `gateExecuteAndTrace`. Diagnostic stderr → Task 4.
- **Type consistency:** `runToolCall` signature identical in `provider.types.ts` (Task 1), the dispatch closure (Task 2 Step 4), and the provider handler (Task 3). `ProviderToolCallOutcome` shape `{ ok; output?; error? }` matches the closure return and the handler's consumption. `gateExecuteAndTrace(fnCall, sse, tracer)` signature matches both call sites.
- **No placeholders:** all steps contain full code or exact commands. `buildAgenticHarness` in Task 2 is explicitly defined as a local wrapper over the file's existing setup; if a reusable helper already exists, use it.
- **Risk note:** the only behavior change to the SHARED path is extracting `gateExecuteAndTrace`; Task 2 Step 5 re-runs all pre-existing dispatch tests to catch any regression for gemini/openai/fake.
