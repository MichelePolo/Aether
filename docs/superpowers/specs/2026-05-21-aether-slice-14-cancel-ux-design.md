# Aether Slice 14 — Cancellation UX Polish — Design

**Status:** approved (2026-05-21)
**Branch:** `feat/slice-14-cancel-ux`
**Depends on:** slice 2a (streaming dispatch + abort), slice 7 (function-calling loop + `pendingAssistantText`), slice 13 (SQLite persistence)

---

## Goal

Improve the UX around stopping an in-progress assistant reply:
1. Show a rough `~N token` estimate alongside the existing `⏸ Interrotto dall'utente` badge so the user sees how much output they got before stopping.
2. Add a **Riprendi** button that continues the assistant's reply from where it stopped, creating a new continuation message in the same session.

## Non-goals

- No mutation of the original interrupted message (clean separation between original + continuation).
- No backend schema change (the existing `interrupted: true` field on `messages` is sufficient).
- No new dependency.
- No tracking of true model token usage during streaming (no `done` event arrives on abort). The token count is a pure-FE character-based estimate (`Math.ceil(text.length / 4)`).
- No Playwright e2e — covered by FE integration tests.

---

## Architecture

Two-part change:

**Backend.** The existing `DispatchService.handle()` does a normal user-message-driven dispatch. We add a sibling method `resume()` that takes `{ sessionId, messageId }`, reads the interrupted assistant message, and dispatches a new turn with `userMessage: ''` and `pendingAssistantText: msg.text`. The `pendingAssistantText` field already exists on `ProviderRequest` (slice 7) and all four providers honor it. The streaming loop, function-call handling, history-store appending, and reasoning-step tracing are all shared with `handle()` via the existing private helpers.

A new route `POST /api/dispatch/resume` accepts the JSON body, validates the target message is an interrupted model message, and streams SSE events identical to `/api/dispatch`. Errors (404 / 409) flow through the existing error envelope.

**Frontend.** The interrupted footer on `MessageBubble.tsx:78` is extended: a `~N token` badge based on `Math.ceil(message.text.length / 4)`, and a **Riprendi** button. Clicking calls `useStreamingDispatch().resume(message.id)`. The hook re-uses every existing SSE event handler (text / thinking / reasoning_step / done / error / tool_call_*); only the dispatch URL differs.

---

## Components

### Backend — new

- `server/routes/dispatch.routes.ts` — add `POST /api/dispatch/resume` handler. Body is `{ sessionId: string, messageId: string }`, validated by a small zod schema inline.
- `server/domain/dispatch/dispatch.service.ts` — add public method `resume(opts, emitter, signal)` that mirrors `handle()`'s post-validation streaming setup. Read the session via `historyStore.readRecord(sessionId)`, locate the message by id, run state-validation, build the `ProviderRequest` with `pendingAssistantText`, then delegate to the shared streaming helper that `handle()` already uses. Minimal refactor: if `streamFromProvider` is not already a private helper, extract it.

### Backend — modified tests

- `server/routes/dispatch.routes.test.ts` — 4 new cases (happy / 404 unknown session / 404 unknown message / 409 not interrupted).
- `server/domain/dispatch/dispatch.service.test.ts` — 2 new cases (threads `pendingAssistantText`; appends new message without mutating original).

### Frontend — new

- `src/lib/api/dispatch.api.ts` — new export `createResumingDispatch({ sessionId, messageId }, signal): AsyncIterable<SseEvent>`. Posts to `/api/dispatch/resume`. Reuses the existing SSE parsing helper.
- `src/lib/api/dispatch.api.test.ts` — 1 case: posts to the right URL with the right body, forwards the abort signal.

### Frontend — modified

- `src/hooks/useStreamingDispatch.ts` — new exported function `resume(messageId: string): Promise<void>`. Same body as `send()` minus the user-input handling (no `appendUser`, no `computeTitle`, no `setLocalTitle`). Starts a new assistant message, sets up the abort controller, iterates `createResumingDispatch(...)`, handles every existing SSE event type unchanged.
- `src/components/chat/MessageBubble.tsx` — modify the existing interrupted footer (line 78). New structure:

  ```tsx
  {!message.error && message.interrupted && (
    <div className="mt-2 pt-2 border-t border-border-subtle flex items-center justify-between text-zinc-500 text-xs">
      <span>
        ⏸ Interrotto · ~{Math.ceil(message.text.length / 4)} token
      </span>
      {message.text.length > 0 && (
        <button
          type="button"
          onClick={() => resume(message.id)}
          disabled={isStreaming}
          aria-label="Riprendi la risposta"
          className="px-2 py-0.5 text-[10px] uppercase tracking-widest font-bold rounded bg-accent/20 hover:bg-accent/30 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          Riprendi
        </button>
      )}
    </div>
  )}
  ```

  The component reads `resume` + `isStreaming` from `useStreamingDispatch()` at the top.

- `src/components/chat/MessageBubble.test.tsx` — extend the existing interrupted test; add cases for token estimate, button presence/absence based on text non-empty, disabled state during streaming, click invocation.

### Frontend — integration tests

- `src/integration/chat.integration.test.tsx` (or wherever the existing chat integration tests live) — one new case: user stops mid-stream → `interrupted` message rendered with Riprendi → user clicks Riprendi → second model message appears with continued text.

### No new dependency

Reuses native `fetch` + the existing SSE parser. Token estimate is pure-arithmetic FE code.

---

## Data flow

### Resume path — FE

1. User clicks Riprendi on an interrupted assistant message.
2. Handler calls `useStreamingDispatch().resume(message.id)`.
3. Hook checks `isStreaming` → early-return if another stream is in flight.
4. Hook starts a new assistant message via `chat.startAssistant()`, sets up an `AbortController`, sets the chat-store streaming id (input is disabled, Stop button works exactly like for a normal send).
5. Hook iterates `createResumingDispatch({ sessionId: activeId, messageId }, controller.signal)`. SSE event types are identical to the normal send path; the existing switch in `useStreamingDispatch` handles every event without changes.
6. On `done`, the new model message is finalized via `chat.finishAssistant(...)`. The interrupted message above stays exactly as it was (`interrupted: true`, same id, same text).

### Resume path — server

1. `POST /api/dispatch/resume` body validated by zod: `{ sessionId: string, messageId: string }`.
2. Route handler calls `dispatchService.resume({ sessionId, messageId }, sseEmitter, abortSignal)`.
3. `dispatch.service.resume()`:
   - `historyStore.readRecord(sessionId)` → 404 if missing.
   - Find target message in `session.messages` → 404 if missing.
   - Validate `msg.role === 'model'` AND `msg.interrupted === true` → 409 `code: 'NOT_INTERRUPTED'` otherwise.
   - Validate `msg.text.length > 0` → 409 `code: 'EMPTY_INTERRUPTED'` (defensive — no anchor to continue from).
   - Build a `ProviderRequest`:
     - `userMessage: ''`
     - `pendingAssistantText: msg.text`
     - `history: session.messages.slice(0, idx).map(toProviderHistoryEntry)` — everything before the interrupted message
     - `systemInstruction: contextStore.read().systemInstruction`
     - `mcpTools: mcpRegistry.listLiveTools()`
     - `thinking: false` (default; the original session may have had thinking enabled but we don't replay it on resume — keeps the slice scope tight)
   - Resolve provider: prefer `session.providerName`, fall back to `providers.defaultName()`.
   - Delegate to the shared `streamFromProvider(req, provider, emitter, signal, ...)` helper used by `handle()`.
4. Streaming events flow over SSE; the dispatch service appends a new `Message` to history on `done`.

### Token estimate (FE-only)

`MessageBubble` computes `tokens = Math.ceil(message.text.length / 4)` when rendering the interrupted footer. ~4 chars/token is the standard English heuristic. The badge format: `⏸ Interrotto · ~N token`. Falsy text → render the badge without a token count.

### Cancellation during resume

If the user stops the resume mid-stream (via Stop button), the same `AbortController` plumbing fires. The new resumed message itself becomes `interrupted: true`, with its own Riprendi button. Recursive resume is supported by the design (no state preventing it).

---

## Error handling

- **HTTP 404 — session not found** → `NotFoundError(session ${sessionId})` before the SSE stream opens. Existing error middleware → JSON 404 → FE catches in `createResumingDispatch`, surfaces via `failAssistant(id, msg, retryable: false)`.
- **HTTP 404 — message not found** → `NotFoundError(message ${messageId})`. Same pipeline.
- **HTTP 409 — message exists but not interrupted** → `ValidationError('Message is not interrupted', { code: 'NOT_INTERRUPTED' })`. Defensive against stale clicks.
- **HTTP 409 — message has `role === 'user'`** → `ValidationError('Cannot resume a user message')`. Defensive.
- **HTTP 409 — interrupted message has empty text** → `ValidationError('Cannot resume an empty interrupted message', { code: 'EMPTY_INTERRUPTED' })`. The FE already hides the button in this case; this is a backstop.
- **Provider error mid-resume** → bubbles via the shared `streamFromProvider` helper. SSE `error` event with provider's message + retryability. The new continuation message ends in `error` state with the existing Retry button. Retry on a continuation retries the continuation, not the original.
- **User aborts the resume** → new continuation message ends `interrupted: true`. Now two interrupted messages exist in the session; both get their own Riprendi button. Recursive resume allowed by design.
- **No active session** → defensive guard in the hook (same as `send()`).
- **Stream race** — user clicks Riprendi while another stream is in flight → hook's `isStreaming` early-return + button `disabled={isStreaming}` together prevent it.

---

## Testing

### Backend unit (`dispatch.service.test.ts` extension)

1. `resume()` threads `pendingAssistantText` into the provider call — assert via FakeProvider configured to echo back its `pendingAssistantText` field; verify the resumed message's text starts with the interrupted text content.
2. `resume()` appends a NEW message to the session — `historyStore.read(sessionId).length` grows by 1; original interrupted message unchanged.
3. `resume()` throws `NotFoundError` on unknown session id.
4. `resume()` throws `NotFoundError` on unknown message id.
5. `resume()` throws `ValidationError` (`code: NOT_INTERRUPTED`) when target message isn't interrupted.
6. `resume()` throws `ValidationError` when target message has `role === 'user'`.
7. `resume()` throws `ValidationError` (`code: EMPTY_INTERRUPTED`) when interrupted message has empty text.
8. `resume()` resolves provider via `session.providerName`; falls back to `providers.defaultName()` when null.

### Backend routes (`dispatch.routes.test.ts` extension)

1. `POST /api/dispatch/resume` happy path — SSE stream emits `text`/`done` events.
2. `POST /api/dispatch/resume` returns 404 on unknown session.
3. `POST /api/dispatch/resume` returns 404 on unknown message.
4. `POST /api/dispatch/resume` returns 4xx on not-interrupted message.

### FE unit (`MessageBubble.test.tsx` extension)

1. Renders Riprendi button + token estimate when `interrupted: true` and non-empty text.
2. Does NOT render the button when text is empty.
3. Does NOT render the button (or replaces with Retry) when message has `error`.
4. Token estimate matches `Math.ceil(text.length / 4)` for representative inputs (e.g. text of 100 chars → `~25 token`).
5. Clicking Riprendi invokes `useStreamingDispatch().resume(message.id)`.
6. Button is disabled while another stream is in progress.

### FE unit (`dispatch.api.test.ts` extension)

1. `createResumingDispatch({ sessionId, messageId }, signal)` posts to `/api/dispatch/resume` with the correct body; forwards the abort signal.

### FE integration

One new case in the existing chat integration test file: user stops mid-stream → interrupted message rendered with Riprendi → user clicks → second model message appears with continued text. MSW returns two distinct dispatch streams.

### Playwright

No new e2e. The existing tests cover normal send/stop; the integration test covers the full resume flow at the FE level.

---

## Decisions log

| # | Decision | Rationale |
|---|---|---|
| 1 | Resume creates a NEW continuation message; original is unchanged | Simpler than mutating an existing row; matches the existing per-dispatch-message pattern; no race conditions on repeat clicks |
| 2 | Use existing `pendingAssistantText` field on `ProviderRequest` for the continuation context | All four providers already honor it (slice 7 function-calling loop); zero provider changes |
| 3 | Pure-FE character-based token estimate (`Math.ceil(text.length / 4)`) | No `done` event arrives on abort so true usage isn't tracked; ~4 chars/token is the standard heuristic; no schema change |
| 4 | New route `POST /api/dispatch/resume` (not extending `POST /api/dispatch`) | Cleaner separation of validation (resume needs an interrupted message id; send needs userMessage); minimal route surface |
| 5 | Riprendi label in Italian | Matches the existing badge `⏸ Interrotto dall'utente` and other Italian user-facing text in the app |
| 6 | `thinking: false` on resume regardless of original turn's setting | Keeps the slice scope tight; the user can always start a new turn if they want thinking on |
| 7 | Empty-text interrupted message → button hidden + server rejects 409 | No anchor to continue from; FE hides for UX, server rejects defensively |
| 8 | Recursive resume allowed (interrupt during resume → resume again) | No state preventing it; mirrors the existing send-stop-send cycle |
| 9 | No new dependency, no schema change | The `interrupted` column already exists; `pendingAssistantText` already exists on the provider interface |
| 10 | No Playwright e2e for the resume flow | FE integration tests cover it adequately; e2e suite stays lean |
