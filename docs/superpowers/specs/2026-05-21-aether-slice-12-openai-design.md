# Aether Slice 12 — OpenAI Provider — Design

**Status:** approved (2026-05-21)
**Branch:** `feat/slice-12-openai`
**Depends on:** Slice 8 (multi-provider runtime + TopBar selector), Slice 7 (function-calling loop)

---

## Goal

Add OpenAI (`gpt-5`, `gpt-5-mini`, `gpt-4.1`, `o3`) as a first-class provider in Aether. Auth flows through the `OPENAI_API_KEY` env var. The provider talks directly to OpenAI's Chat Completions API via HTTP+SSE — no SDK dependency.

## Non-goals

- No Responses API support (Chat Completions only).
- No Playwright e2e against the real OpenAI API (CI has no key; the existing Fake-provider suite covers the UI).
- No SDK dependency on `openai` npm package — raw `fetch` is sufficient and matches the Ollama provider's shape.
- No UI for choosing among models beyond the existing TopBar selector.

---

## Architecture

A new `OpenAIProvider` class implements the existing `AIProvider` interface (`server/domain/dispatch/providers/provider.types.ts`). It is stateless: each `stream(req, signal)` call issues `POST https://api.openai.com/v1/chat/completions` with `stream: true` and parses the SSE response body. The adapter mirrors the `OllamaProvider` shape almost line-for-line.

Tool declarations from `req.mcpTools` map to OpenAI's `tools: [{ type: 'function', function: { name, description, parameters } }]` format. Tool calls in the response stream arrive as incremental `delta.tool_calls[]` fragments keyed by index; the provider accumulates `function.arguments` strings and yields a single `function_call` chunk per tool call when `finish_reason === 'tool_calls'`. After yielding `function_call`, the stream terminates so Aether's existing dispatch loop can drive approval + execution + continuation exactly like Gemini.

Reasoning tokens emitted by the o-series models are surfaced via `delta.reasoning` / `delta.reasoning_content` and yielded as `thinking` chunks — gated on `req.thinking`. Field naming has varied across API versions; the provider checks both spellings defensively.

Four model entries are registered at server startup when `OPENAI_API_KEY` is set in env:
- `openai:gpt-5` — `{ thinking: false, toolCalling: true }`
- `openai:gpt-5-mini` — `{ thinking: false, toolCalling: true }`
- `openai:gpt-4.1` — `{ thinking: false, toolCalling: true }`
- `openai:o3` — `{ thinking: true, toolCalling: true }`

Registration mirrors the Gemini pattern: presence of the env var is sufficient; no live probe at startup. Auth failures surface as send-time error toasts (same as Gemini today).

---

## Components

### Backend

**New files:**
- `server/domain/dispatch/providers/openai.provider.ts` — the `OpenAIProvider` class. Constructor: `new OpenAIProvider({ apiKey: string; model: 'gpt-5' | 'gpt-5-mini' | 'gpt-4.1' | 'o3' })`. Read-only `capabilities` field derives from the model (o3 → `thinking: true`, others false; all four `toolCalling: true`). Single public method: `stream(req: ProviderRequest, signal: AbortSignal): AsyncIterable<ProviderChunk>`.
- `server/domain/dispatch/providers/openai.provider.test.ts` — unit tests; `fetch` is mocked via `vi.stubGlobal('fetch', vi.fn())`.

**Modified files:**
- `server/domain/providers/discovery.ts` — add `openAIHardcodedModels(): string[]` returning `['gpt-5', 'gpt-5-mini', 'gpt-4.1', 'o3']`.
- `server/domain/providers/registry.ts` — widen `ProviderTransport` with `'openai'`; add deps `openAIApiKey: string | undefined` + `openAIBuilder: (model: string) => AIProvider`; insert a registration block (after Anthropic, before Ollama) gated on `openAIApiKey` truthy; update `displayNameFor` to return `OpenAI / ${model}`. The `defaultName()` priority becomes: explicit > gemini > openai > anthropic > ollama > fake (OpenAI right after Gemini, since both are HTTP commercial APIs).
- `server/domain/providers/registry.test.ts` — extend the `baseDeps()` helper from slice 11 with `openAIApiKey` + `openAIBuilder` defaults; 4 new cases.
- `server/index.ts` — read `cfg.openAIApiKey`; pass `openAIApiKey` + `openAIBuilder: (model) => new OpenAIProvider({ apiKey: cfg.openAIApiKey, model: model as ... })` into `ProviderRegistry`.
- `server/config.ts` — add `openAIApiKey: string` field sourced from `process.env.OPENAI_API_KEY ?? ''`.

### Frontend

No new components. The four OpenAI models appear in the TopBar selector when registration succeeds. Existing per-session provider persistence (slice 8) handles selection.

**Modified files:**
- `src/integration/provider-switch.integration.test.tsx` — append one case: MSW returns a provider list including `openai:gpt-5`; user selects it; assertions on selector value + session PATCH body's `providerName`.

### No new dependency

Uses native `fetch` + `ReadableStream` + `TextDecoder`. The `openai` npm SDK is not added.

---

## Data flow

### Send path

Per `OpenAIProvider.stream(req, signal)`:

1. Build the request body:
   - `model: this.model`
   - `stream: true`
   - `stream_options: { include_usage: true }` (so the final chunk carries token counts)
   - `messages`:
     - `{ role: 'system', content: req.systemInstruction }` (only when non-empty)
     - For each `req.history` entry: `{ role: m.role === 'model' ? 'assistant' : 'user', content: m.text }`
     - If `req.pendingAssistantText`: `{ role: 'assistant', content: req.pendingAssistantText }`
     - For each `req.toolResults`: a pair of messages:
       - `{ role: 'assistant', content: null, tool_calls: [{ id: r.callId, type: 'function', function: { name: r.qualifiedName, arguments: '{}' } }] }`
       - `{ role: 'tool', tool_call_id: r.callId, content: r.ok ? JSON.stringify(r.output ?? {}) : JSON.stringify({ error: r.error }) }`
     - `{ role: 'user', content: req.userMessage }`
   - `tools`: if `req.mcpTools` non-empty, `req.mcpTools.map(t => ({ type: 'function', function: { name: t.qualifiedName, description: t.description ?? '', parameters: t.schema } }))`

2. `POST https://api.openai.com/v1/chat/completions` with headers `{ 'content-type': 'application/json', 'authorization': 'Bearer <apiKey>', 'accept': 'text/event-stream' }`. Forward `signal`.

3. Read `res.body` as a stream. For each SSE frame (`data: <json>\n\n` separated by blank lines), parse JSON. Skip the `data: [DONE]` sentinel.

4. For each chunk's `choices[0].delta`:
   - `delta.content` (non-empty string) → `{ type: 'text', text: delta.content }`
   - `delta.reasoning` or `delta.reasoning_content` (non-empty string) → `{ type: 'thinking', text }` only when `req.thinking === true`; silently dropped otherwise.
   - `delta.tool_calls` (array): accumulate by `index`. Each entry can carry partial `id`, `function.name`, and incremental `function.arguments` string fragments. Maintain a per-index buffer `{ id, name, argsBuffer }`. Update each field whenever the current chunk supplies it.

5. When `choices[0].finish_reason === 'tool_calls'`:
   - For each accumulated tool call, parse `JSON.parse(argsBuffer)`. Yield `{ type: 'function_call', call: { callId: id, qualifiedName: name, args } }`. After yielding the function calls, terminate the iterator.

6. When `finish_reason === 'stop'` (or the stream ends naturally) AND we've received a chunk with `usage`:
   - Yield `{ type: 'done', usage: { totalTokens: usage.total_tokens } }` and return.

7. The function-call chunks flow through `DispatchService`'s existing approval loop (slice 7) → `McpRegistry.callTool` (slice 7 + 10) → next iteration with `toolResults` populated.

### Cancellation

The incoming `AbortSignal` is forwarded to `fetch()`. On abort, the request closes; the iterator stops. Same UX as cancelling any other provider.

---

## Error handling

### Send-time
- **HTTP 401** → `throw new Error('OpenAI auth failed — check OPENAI_API_KEY')`. Dispatch maps to `{ event: 'error', data: { message, retryable: false } }`.
- **HTTP 429** → throw with the API's error message. Dispatch → retryable.
- **HTTP 5xx** → throw with the status code. Dispatch → retryable.
- **Network / fetch error** → propagates as-is. Dispatch → retryable.
- **Subprocess killed by abort signal** → no error; existing `interrupted: true` path on `done`.
- **Malformed SSE frame** → silently skipped (same as Ollama).

### Tool-call edge cases
- Empty `argsBuffer` when `finish_reason === 'tool_calls'` arrives → treat as `{}` args (defensive).
- Multiple `tool_calls` indices in one response → yield one `function_call` chunk per index, in index order, then terminate. (Aether's dispatch loop handles one tool call per iteration; the second would be dropped — same constraint as Gemini today, and not a practical concern with the prompts Aether sends.)
- Tool name with dots (e.g. `mock.echo`) — OpenAI's function names accept dots; pass through unchanged.

### Probe-time
- **No `OPENAI_API_KEY` at startup** → no OpenAI entries registered. No error surfaced. Same UX as Gemini today.

---

## Testing

### Unit (`openai.provider.test.ts`)

The HTTP layer is mocked via `vi.stubGlobal('fetch', vi.fn())`. Helper builds a fake `Response` whose body is a `ReadableStream<Uint8Array>` carrying SSE frames (`data: <json>\n\n`). The `streamFromString` / `ssePayload` helpers from `http-connection.test.ts` (slice 10) can be inlined or factored into `server/test/sse-helpers.ts`.

Test cases:

1. Maps multi-chunk `delta.content` to ordered `text` chunks + final `done` with `totalTokens`.
2. Maps `delta.reasoning` to `thinking` chunks only when `req.thinking === true`; otherwise drops.
3. Tool call accumulation: two streamed chunks with partial `function.arguments` fragments, then `finish_reason: 'tool_calls'` → yields one `function_call` chunk with parsed args + terminates the iterator.
4. Body shape: asserts the mocked `fetch` was called with the expected JSON body — system message present, history alternation (`role: 'user'` ↔ `role: 'assistant'`), final user turn, `stream: true`, `stream_options.include_usage: true`.
5. `req.toolResults` populated → emits the assistant `tool_calls` message + the `tool` result message in the right order.
6. `req.pendingAssistantText` → spliced as an assistant turn before the new user message.
7. `Authorization: Bearer <key>` header present + `Accept: text/event-stream`.
8. 401 response → throws `'OpenAI auth failed — check OPENAI_API_KEY'`.
9. 429 response → throws with the API's error message.
10. Pre-aborted signal → `fetch` is invoked with the signal; iterator yields nothing.
11. Capability differs by model: `new OpenAIProvider({ apiKey, model: 'o3' }).capabilities.thinking === true`; for the others `=== false`.

### Provider registry (`registry.test.ts` extension)

- `openAIApiKey: 'sk-test'` → 4 entries registered (`openai:gpt-5`, `openai:gpt-5-mini`, `openai:gpt-4.1`, `openai:o3`).
- `openAIApiKey: undefined` → no OpenAI entries.
- Capabilities visible via `describe(...)`: o3 reports `thinking: true`; others `thinking: false`.
- `displayName` for `openai:o3` → `OpenAI / o3`.

### Frontend integration (`provider-switch.integration.test.tsx`)

One new case: MSW returns a provider list including `openai:gpt-5`; user picks it; selector value + the session PATCH body's `providerName` reflect the choice.

### Playwright

No new e2e. CI has no `OPENAI_API_KEY`; the existing Fake-provider suite covers cross-provider UI behavior.

---

## Decisions log

| # | Decision | Rationale |
|---|---|---|
| 1 | Chat Completions API (not Responses API) | Mature, broadly supported, shape matches the existing Gemini/Ollama adapter pattern; o-series reasoning works on chat.completions too |
| 2 | Native `fetch` instead of `openai` npm SDK | Matches `OllamaProvider`; smaller dep surface; full control of SSE parsing; can adopt the SDK later if it pays for itself |
| 3 | Four hardcoded model entries | Predictable; mirrors the Gemini + Anthropic patterns; updating for new releases is a one-line change |
| 4 | Capabilities differ per model (o3 thinks, others don't) | Reflects the actual API surface; the FE's existing thinking-toggle gating works without changes |
| 5 | Env-var presence is enough to register; no live probe | Mirrors Gemini's pattern; live probe adds startup latency for no UX gain — auth failures surface fine at send time |
| 6 | Stream terminates on first `function_call` chunk; dispatch re-calls with `toolResults` | Same loop shape as Gemini, lets the existing dispatch service drive Anthropic and OpenAI identically |
| 7 | `stream_options.include_usage: true` always | Ensures the final chunk carries `usage` so we can emit `done.usage.totalTokens` |
| 8 | Check both `delta.reasoning` and `delta.reasoning_content` | OpenAI's field naming has varied across API versions; defensive both-spellings handling avoids silent regression on minor API changes |
| 9 | Multiple tool_calls in one response: emit each as a separate `function_call` chunk in index order | Future-proof; Aether's dispatch currently handles them one at a time, second is queued for next iteration in practice |
| 10 | No Playwright coverage for OpenAI | CI has no key; gating merges on developer's local auth is brittle |
