# Aether Slice 19 — Conversation forking + token-only context meter (design spec)

**Date:** 2026-05-23
**Branch:** `feat/slice-19-fork-and-meter`
**Roadmap entry:** docs/superpowers/roadmap.md → "Slice 19 — Conversation forking + cost meter (bundled)"

## Goal

Let the user branch off any session at a specific user message — turning Aether into a true studio for prompt iteration — while making the model's token cost of the current conversation visible at a glance. No dollar conversions: the "meter" is a context-size meter measured strictly in tokens.

## Scope decisions

| Decision | Choice |
|---|---|
| Token granularity | Split: `inputTokens` + `outputTokens` (extend existing `ProviderUsage`). Adapters that can't split (Ollama) leave them undefined. |
| Fork cut semantics | Copy messages up to and **including** the clicked user message; drop the model's reply that followed. |
| Right-click on a model message | Single menu item "Branch from previous user message" — walks back to the nearest user turn. |
| Fork UI | Custom context menu on right-click of a message bubble. No buttons in the bubble chrome. |
| Meter scope | `lastAssistant.tokensIn + lastAssistant.tokensOut` of the active session. Reflects "what would be sent if I dispatched one more message right now." |
| Meter placement | TopBar chip next to the provider selector + per-message tooltip on assistant bubbles. |
| Persistence | `tokens_in` + `tokens_out` columns on `messages` (NULL for user messages). Migration 004. |
| Provider populate | Gemini/OpenAI/Anthropic split; Ollama emits only total. |
| Fork inheritance | New session inherits `providerName` from source. `tokensIn`/`tokensOut` on copied assistant messages preserved verbatim (fork is a historical snapshot, no re-billing). |
| Fork during streaming | New session prepended; activation deferred (existing `setActive` is a no-op during streaming). |

## Data shapes

```ts
// server/domain/dispatch/providers/provider.types.ts
export interface ProviderUsage {
  totalTokens?: number;
  inputTokens?: number;
  outputTokens?: number;
}
```

```sql
-- server/db/migrations/004_message_usage.sql
ALTER TABLE messages ADD COLUMN tokens_in INTEGER;
ALTER TABLE messages ADD COLUMN tokens_out INTEGER;
```

```ts
// server/domain/history/history.types.ts (extension)
export interface Message {
  // ...existing fields...
  tokensIn?: number;   // assistant messages only; null for user
  tokensOut?: number;  // assistant messages only; null for user
}
```

```ts
// Fork API
// POST /api/sessions/:id/fork { fromMessageId } → 201 { meta: SessionMeta }
interface ForkRequest { fromMessageId: string; }
interface ForkResponse { meta: SessionMeta; }
```

### Cut-point resolution (server-side)

Given the clicked `fromMessageId` in the source session's ordered message array:
1. Find its `position`.
2. If `role === 'user'`, cut-point is that position (inclusive).
3. If `role === 'model'`, walk backward until the nearest `role === 'user'`; that's the cut-point.
4. If no earlier user message exists, respond `400 NO_FORK_POINT`.
5. The new session contains messages at positions `0..cutPoint` inclusive. All ids regenerate; `position` preserved by enumeration order; all timestamps unified to one `Date.now()`. `tokensIn`/`tokensOut` on copied assistant messages are written verbatim.
6. New session row in `sessions` copies `title` and `provider_name` from source.

### TopBar chip selector

```ts
// src/stores/chat.store.ts — additional exported helper
export function contextSizeOfActive(state: ChatState): {
  total: number;
  prompt: number;
  reply: number;
} | null {
  const lastAssistant = [...state.messages].reverse().find((m) => m.role === 'model');
  if (!lastAssistant || lastAssistant.tokensIn == null || lastAssistant.tokensOut == null) return null;
  return {
    prompt: lastAssistant.tokensIn,
    reply: lastAssistant.tokensOut,
    total: lastAssistant.tokensIn + lastAssistant.tokensOut,
  };
}
```

The chip renders nothing when the selector returns `null` (no assistant message yet, or older sessions whose assistant messages predate slice 19's tracking).

### Export envelope compatibility (slice 16)

The existing `exportEnvelopeSchema` in `history.export.ts` uses lenient zod parsing — unknown keys are silently dropped at every level. Adding optional `tokensIn`/`tokensOut` to the inner `messageSchema` is forward-and-backward compatible. **No version bump** (still `version: 1`).

## Architecture

### Server

- **`server/db/migrations/004_message_usage.sql`** (new) — two `ALTER TABLE` columns.

- **`server/domain/dispatch/providers/provider.types.ts`** — extend `ProviderUsage` with `inputTokens?` and `outputTokens?`.

- **Provider adapters** — populate the new fields where the upstream supports them:
  - `gemini.provider.ts` — `usageMetadata.promptTokenCount` / `candidatesTokenCount`.
  - `openai.provider.ts` — `usage.prompt_tokens` / `completion_tokens`.
  - `anthropic.provider.ts` — `message.usage.input_tokens` / `output_tokens`.
  - `ollama.provider.ts` — leave both `undefined`.
  - `fake.provider.ts` — config accepts optional `inputTokens` / `outputTokens` for tests.

- **`server/domain/history/history.store.ts`**:
  - `append(sessionId, message)` writes `tokens_in` / `tokens_out` columns (NULL when absent).
  - `readMessages(sessionId)` SELECTs the columns and maps back onto `Message` (omit when NULL).
  - New `forkSession(sessionId, fromMessageId): Promise<SessionMeta>` — single `db.transaction` mirroring `importSession`'s rewrite pattern; resolves cut-point internally; writes to `sessions`, `messages`, `messages_fts`, `reasoning_steps`, `tool_call_traces`.

- **`server/domain/dispatch/dispatch.service.ts`** — at finalize (`send` path) and resume completion, pass `tokensIn: dispatchUsage?.inputTokens` and `tokensOut: dispatchUsage?.outputTokens` into `historyStore.append` on the assistant message. Also emit them on the `done` SSE event payload so the FE chat store can render the chip before re-hydrating.

- **`server/routes/sessions.routes.ts`** — extend with:
  - `POST /:id/fork` body `{ fromMessageId }` → 201 `{ meta }`. Returns `404` if session unknown, `400 VALIDATION_ERROR` if `fromMessageId` not in this session, `400 NO_FORK_POINT` if no user message exists at or before the cut.

### Frontend

- **`src/types/session.types.ts`** (or wherever the FE `Message` lives) — add optional `tokensIn`, `tokensOut`.

- **`src/lib/api/sessions.api.ts`** — add `forkSession(id: string, fromMessageId: string): Promise<SessionMeta>`.

- **`src/stores/sessions.store.ts`** — add `forkSession(fromMessageId: string): Promise<void>`:
  - Reads `activeSessionId`; POSTs `/api/sessions/<id>/fork`.
  - Prepends new `SessionMeta`, calls `setActive(newId)`. `setActive` is a no-op while streaming → user must wait.
  - On error, sets `error` to `'Fork failed: <message>'`.

- **`src/stores/chat.store.ts`** — export the `contextSizeOfActive` helper. Also extend `finishAssistant` to accept `tokensIn` / `tokensOut` from the `done` event and merge them into the persisted assistant message.

- **`src/stores/ui.store.ts`** — add `messageContextMenu: { x: number; y: number; messageId: string; role: 'user' | 'model' } | null`. Actions: `openMessageContextMenu(payload)`, `closeMessageContextMenu()`.

- **`src/components/chat/MessageContextMenu.tsx`** (new) — small floating menu at `{ x, y }`. Suppresses native context menu via the parent `MessageBubble`. Closes on Escape, outside-click, item activation. Renders exactly one item:
  - `role === 'user'` → "Branch from here".
  - `role === 'model'` → "Branch from previous user message".

- **`src/components/chat/MessageBubble.tsx`** — add `onContextMenu={(e) => { e.preventDefault(); openMessageContextMenu({ x: e.clientX, y: e.clientY, messageId: m.id, role: m.role }); }}`. For assistant bubbles, add a `title={...}` tooltip when `m.tokensIn != null && m.tokensOut != null` formatted as `Prompt: <in> / Reply: <out> tokens`.

- **`src/components/layout/TokenChip.tsx`** (new) — reads `contextSizeOfActive`. Renders nothing when null. Otherwise: `▵ <total formatted with k suffix> tok`. `title` tooltip: `prompt <in> / reply <out>`.

- **`src/components/layout/TopBar.tsx`** — mount `<TokenChip />` next to the existing provider selector.

- **`src/App.tsx`** — mount `<MessageContextMenu />` once at App level so it can position itself absolutely.

### MSW

- **`src/test/msw-handlers.ts`** — add default for `POST /api/sessions/:id/fork` that returns a synthetic `SessionMeta`.

## Data flow

### Fork
1. Right-click on a `MessageBubble` → `e.preventDefault()` + `openMessageContextMenu({ x, y, messageId, role })`.
2. `MessageContextMenu` renders at coordinates. User clicks the menu item.
3. Menu closes. `sessions.store.forkSession(messageId)` runs.
4. `POST /api/sessions/<activeId>/fork` with `{ fromMessageId: messageId }`.
5. Server resolves cut-point and runs `historyStore.forkSession` in a `db.transaction`.
6. 201 `{ meta }`. FE prepends + `setActive(meta.id)`.
7. Chat re-hydrates the new session (existing `setActive` hydration path) — user sees only the messages up through the cut-point.

### Token capture
1. Provider stream emits `done` with `usage: { totalTokens?, inputTokens?, outputTokens? }`.
2. `DispatchService` finalize:
   - Passes `tokensIn` + `tokensOut` to `historyStore.append` for the assistant message.
   - Emits `done` SSE event including `tokensIn` + `tokensOut` so the FE chat store can stamp the message without waiting for re-hydration.
3. FE `useStreamingDispatch` extracts `tokensIn`/`tokensOut` from the `done` payload and calls `chat.store.finishAssistant({ ..., tokensIn, tokensOut })`.
4. `TokenChip` re-renders via the selector. Per-message tooltip works immediately.

## Error handling

| Scenario | Server | FE surface |
|---|---|---|
| Fork from unknown session id (URL tamper) | 404 NOT_FOUND | `sessions.error = 'Fork failed: …'` |
| Fork with `fromMessageId` not in this session | 400 VALIDATION_ERROR | Same |
| Fork where no user message exists ≤ cut | 400 NO_FORK_POINT | Same; rare (right-click only fires on real bubbles) |
| Provider returns no usage | `tokens_in`/`tokens_out` NULL | `TokenChip` hides; no per-message tooltip |
| Provider returns only `totalTokens` (Ollama) | `inputTokens`/`outputTokens` undefined → columns NULL | Same as above; `validation` reasoning step still shows the total in the drawer |
| Right-click outside any bubble | Native browser menu fires | Expected |
| Fork during streaming on another session | 201; `setActive` no-ops, new session appears in sidebar but not active until streaming ends | Expected; consistent with import behavior |

**Logging:** no special logging for fork (existing `app` error pipeline covers it). Token capture: the dispatcher's existing `validation` step already logs `tokens N` — the new split fields can extend that line if convenient but are not required for this slice.

## Testing strategy

### Server (vitest)
- `history.store.test.ts`: 
  - `append` persists `tokens_in`/`tokens_out`; NULL when absent; round-trip with mixed user (NULL) + assistant (populated) messages.
  - `forkSession` 11+ cases: unknown source, fork from user message, fork from model resolves to previous user, unknown `fromMessageId` throws, id regeneration, timestamp unification with `vi.useFakeTimers`, FTS mirror, `tokensIn`/`tokensOut` preserved verbatim, providerName preserved, atomicity on injected failure.
- Provider tests: one case per adapter verifying `done.usage` carries the new fields (or omits them, for Ollama).
- `dispatch.service.test.ts`: assistant message persisted with `tokensIn`/`tokensOut` matching the provider's `done.usage`.
- `sessions.routes.test.ts` (slice 16 file): 5 new cases — fork-from-user, fork-from-model resolves, unknown id 400, unknown session 404, no-user-message 400.

### Frontend (vitest + RTL + MSW)
- `sessions.api.test.ts`: `forkSession` POSTs to the right URL with the right body.
- `sessions.store.test.ts`: 3 cases — success prepend + activate; error sets error; fork-during-streaming doesn't activate.
- `chat.store.test.ts`: 3 cases for `contextSizeOfActive` — null when no assistant, null when columns missing, returns `{ prompt, reply, total }`.
- `MessageContextMenu.test.tsx`: 5 cases — render only when open, user-role label, model-role label, click activates fork + closes, Escape/outside-click closes.
- `MessageBubble.test.tsx`: 2 new cases — `onContextMenu` preventDefault + opens menu; assistant bubble tooltip when tokens present.
- `TokenChip.test.tsx`: 3 cases — hidden when null, renders formatted total, tooltip splits prompt/reply.

### Integration (vitest + RTL + MSW)
- `src/integration/fork.integration.test.tsx`: hydrate a session → right-click user message → click "Branch from here" → new session active, chat trimmed.

### Playwright (`e2e/smoke.spec.ts`)
- One smoke: send a message → wait for reply → assert `TokenChip` visible with non-zero total → right-click user bubble → click "Branch from here" → new session row appears in sidebar and chat resets.

## Out of scope

- Editing prior user messages in place (no in-bubble edit — fork + retype is the path).
- Token estimate for messages before slice 19 (no backfill — they stay NULL).
- Cost-in-dollars display.
- Multi-message fork (e.g. "split into N branches"). One fork per click.
- Fork the *latest* message via palette command (right-click is the only surface; palette command can be added later if useful).

## Acceptance criteria

1. Right-clicking any message bubble opens a small custom context menu with the appropriate single item.
2. Clicking the menu item creates a new session containing exactly the messages up to and including the resolved cut-point, with fresh ids and a single unified timestamp; the new session becomes active (unless streaming is in progress).
3. Token columns `tokens_in` / `tokens_out` populate for every successful assistant message dispatched against Gemini, OpenAI, or Anthropic.
4. The `TokenChip` in the TopBar shows `▵ <N> tok` whenever the active session has at least one assistant message with populated token columns; clicking/hovering it splits prompt/reply.
5. Assistant message bubbles surface their per-message in/out token counts via tooltip.
6. Forked sessions inherit the source's `providerName`; copied assistant messages preserve their original `tokens_in` / `tokens_out` values.
7. Round-tripping a session through slice 16's export/import preserves `tokensIn` / `tokensOut` (lenient schema, no version bump).
