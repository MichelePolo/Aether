# Aether Slice 11 — Anthropic Provider via Claude Agent SDK — Design

**Status:** approved (2026-05-20)
**Branch:** `feat/slice-11-anthropic`
**Depends on:** Slice 8 (multi-provider runtime + TopBar selector), Slice 7 (function-calling loop)

---

## Goal

Add Anthropic Claude (Opus 4.7, Sonnet 4.6, Haiku 4.5) as a first-class provider in Aether. Auth flows through the local `claude` CLI's OAuth session (Claude Pro/Max subscription) OR a configured `ANTHROPIC_API_KEY` env var — both supported automatically by the Claude Agent SDK.

## Non-goals

- No UI for switching between OAuth and API key (env-driven only).
- No Anthropic-specific tool surface (web_search, code-exec, etc.); the SDK's built-in MCP/tool system is left disabled. All tool calls flow through Aether's existing MCP layer (slice 7/10).
- No Playwright e2e test against a real Claude session (CI has no authenticated session).
- No support for Anthropic's HTTP API directly via `@anthropic-ai/sdk` — only the Agent SDK route.

---

## Architecture

A new `AnthropicProvider` class implements the existing `AIProvider` interface (`server/domain/dispatch/providers/provider.types.ts`). It is stateless: each `stream(req, signal)` call invokes `query()` from `@anthropic-ai/claude-agent-sdk`, which spawns a fresh subprocess and returns an async-iterable of SDK events. The provider maps those events to Aether's `ProviderChunk` stream (`text` / `thinking` / `function_call` / `done`).

The SDK's own MCP/tool plumbing is left unconfigured (no MCP servers, no permission hooks). Tool declarations from `req.mcpTools` are passed through to the SDK so the model knows what tools are available; emitted `tool_use` events are translated to `function_call` chunks that flow through Aether's existing approval/cancel/banner UX (slice 7 + slice 10) exactly like Gemini and Ollama.

Three model entries are registered at server startup:
- `anthropic:claude-opus-4-7` — capabilities `{ thinking: true, toolCalling: true }`
- `anthropic:claude-sonnet-4-6` — capabilities `{ thinking: true, toolCalling: true }`
- `anthropic:claude-haiku-4-5` — capabilities `{ thinking: true, toolCalling: true }`

Registration is gated by a startup probe (`detectAnthropicAuth()`) that checks the `claude` CLI is on PATH AND either succeeds at a tiny SDK call (OAuth path) OR finds `ANTHROPIC_API_KEY` in env (API key path). If neither, the three entries are simply omitted from the provider list — the TopBar selector won't show them, no error is surfaced. Mirrors how the Ollama provider conditionally registers based on whether the daemon is reachable.

When both auth modes are present, the SDK prefers the explicit `ANTHROPIC_API_KEY`. Users on Pro/Max who want subscription-based quota must leave the env var unset. The send-time error message for `AuthenticationError` calls this out.

---

## Components

### Backend

**New files:**
- `server/domain/dispatch/providers/anthropic.provider.ts` — the `AnthropicProvider` class. Constructor signature: `new AnthropicProvider({ model: 'claude-opus-4-7' | 'claude-sonnet-4-6' | 'claude-haiku-4-5' })`. Single public method: `stream(req: ProviderRequest, signal: AbortSignal): AsyncIterable<ProviderChunk>`. Read-only `capabilities` field returns `{ thinking: true, toolCalling: true }`. Read-only `model` field returns the constructor's model id.
- `server/domain/dispatch/providers/anthropic.provider.test.ts` — unit tests; the SDK is mocked via `vi.mock('@anthropic-ai/claude-agent-sdk')`.
- `server/lib/anthropic-auth.ts` — helper `detectAnthropicAuth(): Promise<'oauth' | 'apikey' | 'none'>`. Internally:
  1. Spawn `claude --version` with a 2-second timeout. On failure → return `'none'`.
  2. If `process.env.ANTHROPIC_API_KEY` is set and non-empty → return `'apikey'` (no SDK call — the env var is enough proof of intent and avoids spending tokens at startup).
  3. Else run a tiny SDK probe (`query({ prompt: 'ping', options: { maxTurns: 1, model: 'claude-haiku-4-5' } })`) with a 5-second timeout, consume the first event, then abort the stream. Success → `'oauth'`. Failure → `'none'`.
- `server/lib/anthropic-auth.test.ts` — covers the four branches (no CLI / env API key / OAuth probe success / OAuth probe failure).

**Modified files:**
- `server/domain/providers/provider-registry.ts` (or whichever module assembles the provider list — slice 8) — extend the discovery routine: call `detectAnthropicAuth()` in parallel with the existing Ollama probe. Based on the result, append zero or three Anthropic entries to the published provider list.
- `server/domain/providers/provider-registry.test.ts` — add two cases: probe returns `'oauth'`/`'apikey'` → three entries present; probe returns `'none'` → no entries.
- `package.json` — add `@anthropic-ai/claude-agent-sdk` to dependencies. Pin a known version.

### Frontend

No new components. The existing TopBar provider selector (slice 8) renders whatever the server publishes via `GET /api/providers`. The three Claude entries appear when the probe succeeds; the existing per-session provider persistence stores the chosen Claude model.

**Modified files:**
- `src/integration/provider-switch.integration.test.tsx` — one new case: MSW returns a provider list including `anthropic:claude-sonnet-4-6`; user selects it; sending a message routes successfully (the actual SDK call is server-side, stubbed by the existing MSW dispatch handler).

---

## Data flow

### Send path

Per `AnthropicProvider.stream(req, signal)`:

1. The provider maps `ProviderRequest` → SDK input:
   - `req.systemInstruction` → SDK `options.systemPrompt`
   - `req.history` (array of `{ role: 'user' | 'model', text }`) → previous-turns array of SDK messages. The mapping converts each entry to the SDK's expected message format (user → user, model → assistant).
   - `req.userMessage` → final user turn (appended to the previous-turns array).
   - `req.thinking === true` → SDK option enabling extended thinking.
   - `req.mcpTools` → SDK `tools` declarations (name + description + JSON schema for input). No MCP servers configured in `options.mcpServers`.
   - `req.toolResults` (populated by `DispatchService` when continuing after a tool call) → appended as `tool_result` messages in the previous-turn array, paired with the original `tool_use` from the prior turn.
   - `req.pendingAssistantText` → if present, prepended as the start of the previous assistant turn so the model sees its own prior partial output before the tool_use.
   - `signal` → forwarded to the SDK as the abort signal (the SDK kills the subprocess on abort).

2. `query()` returns an `AsyncIterable<SDKEvent>`. The provider iterates and yields:
   - SDK `text_delta` (or equivalent text event) → `ProviderChunk { type: 'text', text }`
   - SDK `thinking_delta` → `ProviderChunk { type: 'thinking', text }` (yielded only if `req.thinking === true`; silently dropped otherwise to keep the FE behaviour consistent with Gemini's gate)
   - SDK `tool_use` event → `ProviderChunk { type: 'function_call', call: { callId: <SDK tool_use id>, qualifiedName: <SDK tool name>, args: <SDK tool input> } }`. After yielding a `function_call`, the provider terminates the stream (the dispatch loop will call `stream()` again with `toolResults` populated).
   - SDK `result` / final usage event → `ProviderChunk { type: 'done', usage: { totalTokens: <input + output tokens, summed> } }`.

3. The function-call chunk flows into `DispatchService`'s existing approval flow (slice 7) → tool execution via `McpRegistry.callTool` (slice 7 + slice 10) → `req.toolResults` populated on the next iteration → continue the loop.

### Probe path (startup)

1. Server-init code calls `detectAnthropicAuth()` in parallel with the Ollama probe (and any other future provider probes).
2. Result is logged once at info level (`[providers] anthropic: oauth` / `apikey` / `none`).
3. Based on the result, the provider registry includes or omits the three Claude entries.

### Cancellation

The dispatch loop already owns an `AbortController` per request (slice 2a) and per tool call (slice 10). On abort:
- Mid-stream → SDK signal fires → SDK kills its subprocess → the async iterator terminates → dispatch handles the `interrupted: true` finalisation path.
- Mid-tool-execution → existing slice-10 `/api/mcp/cancel-call` aborts the tool's controller; the SDK is not yet involved on this call iteration, so no special handling needed.

---

## Error handling

### Probe-time (startup)
- `claude` CLI missing on PATH → log `[anthropic] claude CLI not found on PATH; skipping registration` at info. No registration. No surfaced error.
- Probe SDK call throws or times out → log at warn with the SDK's error message. No registration.
- Probe call completes but reports no usable model → same as failure.

### Send-time (mid-request)
- SDK throws `AuthenticationError` (e.g., session expired between probe and request) → provider stream ends; `DispatchService` emits SSE `{ event: 'error', data: { message: 'Anthropic auth failed — try `claude login` or unset ANTHROPIC_API_KEY to use your subscription', retryable: false } }`.
- SDK throws transient network / process error → SSE `{ event: 'error', data: { message, retryable: true } }`, same path as Gemini / Ollama transient errors.
- Subprocess killed by abort signal → no error event; existing `interrupted: true` path on `done`.
- SDK `result` with `is_error: true` → mapped to a non-retryable error with the SDK's error message.

### Tool-call edge cases
- SDK emits a `tool_use` for a tool not in Aether's MCP layer → the provider still yields the `function_call`; downstream the dispatch handles it the same way as Gemini today (rejects with "Server 'X' is offline" if the qualified name doesn't resolve).
- User cancels mid-tool-execution → covered by slice 10.

---

## Testing

### Unit (`anthropic.provider.test.ts`)

The SDK is mocked via `vi.mock('@anthropic-ai/claude-agent-sdk')`. Helper builds a controlled async-iterable of fake SDK events. Test cases:

- Maps `text_delta` events → `ProviderChunk { type: 'text' }`.
- Maps `thinking_delta` events → `ProviderChunk { type: 'thinking' }` **only when** `req.thinking === true`; otherwise drops them.
- Maps `tool_use` → `function_call` with the correct `callId` / `qualifiedName` / `args`; stream terminates after the first `function_call`.
- Final `result` event with usage → yields one `done` chunk carrying `totalTokens`.
- System instruction + history serialization: asserts the mocked SDK was called with the expected `systemPrompt` and previous-turns array shape.
- `req.toolResults` populated → asserts the SDK input includes the corresponding `tool_result` messages alongside the matching prior `tool_use`.
- `req.pendingAssistantText` populated → asserts it's spliced into the prior assistant turn.
- Signal abort → asserts the mocked SDK call received the signal and the iterator stops yielding.
- SDK throws `AuthenticationError` → the provider's iterator surfaces the error; downstream behavior verified via the dispatch service test below.

### Auth probe (`anthropic-auth.test.ts`)

- `claude` binary missing → returns `'none'`. `child_process.spawn` mocked to emit ENOENT.
- `claude --version` succeeds + `ANTHROPIC_API_KEY` set in env → returns `'apikey'`.
- `claude --version` succeeds + no env key + SDK probe succeeds → returns `'oauth'`.
- `claude --version` succeeds + no env key + SDK probe throws → returns `'none'`.
- `claude --version` hangs past 2-second timeout → returns `'none'`.
- SDK probe hangs past 5-second timeout → returns `'none'`.

### Provider registry (`provider-registry.test.ts` extension)

- Probe returns `'oauth'` → registry contains entries `anthropic:claude-opus-4-7`, `anthropic:claude-sonnet-4-6`, `anthropic:claude-haiku-4-5`, each with `{ thinking: true, toolCalling: true }`.
- Probe returns `'apikey'` → same three entries.
- Probe returns `'none'` → no Anthropic entries.

### Dispatch-level (extension to existing `dispatch.routes.test.ts`)

- Using `AnthropicProvider` with the SDK mocked to emit an `AuthenticationError` mid-stream → SSE produces an `error` event with `retryable: false` and the configured auth-failure message.

### Frontend integration (`provider-switch.integration.test.tsx`)

One new case: MSW returns a provider list including the three Anthropic entries; user picks `anthropic:claude-sonnet-4-6`; sending a message routes through the SSE stream and renders the assistant reply (the actual SDK call is server-side and stubbed by the existing MSW dispatch handler — there is no FE-visible difference from Gemini).

### Playwright

No new e2e test. CI does not have an authenticated Claude session and we don't want to gate merges on the user's local auth. The existing Fake-provider e2e suite continues to cover the cross-provider UI behavior.

---

## Decisions log

| # | Decision | Rationale |
|---|---|---|
| 1 | Use `@anthropic-ai/claude-agent-sdk` (subprocess) rather than `@anthropic-ai/sdk` (HTTP, API-key only) | The user wants OAuth/Pro/Max login support; only the Agent SDK exposes that auth path |
| 2 | Aether owns tool-calling; SDK's MCP/tool system stays disabled | Consistent UX across providers — same approval flow, banner, cancel; no parallel tool surface to maintain |
| 3 | Three hardcoded model entries (Opus 4.7, Sonnet 4.6, Haiku 4.5) | Same shape as Gemini's hardcoded entries; predictable; updating for new Claude releases is a one-line change |
| 4 | Probe at startup, gate registration | Mirrors Ollama's conditional registration; no half-broken entries in the selector |
| 5 | Support both OAuth (CLI session) AND `ANTHROPIC_API_KEY` env var | SDK handles both automatically; widening the probe is trivial; gives users a fallback path |
| 6 | No UI for switching auth mode | Env-driven config is enough; UI auth-mode toggle is out of scope |
| 7 | Stateless adapter: each `stream()` call passes the full history | Same pattern as Gemini/Ollama; Aether keeps full history ownership |
| 8 | After a `function_call`, the stream terminates; dispatch re-calls `stream()` with `toolResults` | Same loop shape as Gemini, allowing the existing dispatch service to drive both providers identically |
| 9 | All three Claude 4.x models declare `thinking: true` | All Claude 4.x models support extended thinking; the FE gate via `req.thinking` controls when it's actually emitted |
| 10 | Subprocess killed via the SDK's abort-signal forwarding; no custom kill path | The SDK already wires `AbortSignal` to subprocess termination; no need for parallel mechanism |
| 11 | When both auth modes configured, SDK precedence is API key | Mirrors SDK behavior; surface this in the auth-failure error message so Pro/Max users know to unset the env var |
| 12 | No Playwright coverage for Anthropic | CI has no authenticated session; gating merges on developer's local auth is brittle |
