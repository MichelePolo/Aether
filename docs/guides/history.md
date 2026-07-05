# History

What this covers: how conversations are persisted, forked, exported/imported, searched, and how attachments are stored and re-sent to providers. Read this when you're touching session storage, the fork/export/import flows, or attachment handling in dispatch.

## How it works

Every session is a row in `sessions`, and every message a row in `messages` (`server/domain/history/history.store.ts`, `HistoryStore`). `append()` inserts the message, mirrors its text into the `messages_fts` FTS5 table, writes any reasoning steps/tool-call traces and attachments in the same transaction, and — if it's the first user message of a still-untitled session — derives the session title from it (`computeTitle`, `server/domain/history/title.ts`). Reads (`readMessages`, used by `read()`/`readRecord()`) reassemble the full message tree — attachments, reasoning steps, tool-call traces — with four prepared statements regardless of message count.

**Forking**: `forkSession(sessionId, fromMessageId)` implements "time-travel" — it copies all messages up to a cut point into a brand-new session. If `fromMessageId` points at a model message, the cut walks backward to the nearest preceding user message (so the fork always starts from a user turn); if there's no user message at or before it, it throws a `ValidationError` tagged `NO_FORK_POINT`. Exposed via `POST /api/sessions/:id/fork` (`server/routes/sessions.routes.ts`), body `{ fromMessageId }`.

**Export/import**: `exportSession()` wraps a session's full record in a versioned envelope (`ExportEnvelope`, `{ app: 'aether', version: 1, exportedAt, session }`, `server/domain/history/history.export.ts`) validated by a lenient Zod schema (unknown keys silently dropped) so old exports stay importable. `GET /api/sessions/:id/export` streams it as a downloadable JSON file named via `slugifyFilename()` (from the session title + timestamp); `POST /api/sessions/import` re-validates the envelope and calls `importSession()`, which re-IDs every session/message/reasoning-step/tool-call/attachment to avoid collisions.

**Search**: `SearchService.search()` (`server/domain/search/search.service.ts`) runs a `messages_fts MATCH` query with `bm25()` ranking and `snippet()` highlighting, grouping hits by session; any FTS5 syntax error in the query is swallowed and returns an empty result rather than a 500. Mounted at `/api/search` (`server/routes/search.routes.ts`).

**Attachments**: attachments are stored as `MessageAttachment` rows (`id`, `mime`, `name`, `size`, plus `contentBase64` only on the write/import path — never on read) alongside the message they were sent with. At dispatch time, `preprocessAttachments()` (`server/domain/dispatch/dispatch.service.ts`) classifies each attachment via `classifyAttachment()`, enforces `MAX_ATTACHMENTS` and a **10 MB total cap** across all attachments in a single dispatch (`AppError` with `PAYLOAD_TOO_LARGE`/413 if exceeded), then splits them: text attachments are inlined into the user message as fenced code blocks (`inlineTextAttachments`), while image attachments are only forwarded to the provider if `provider.capabilities.vision` is true (`providerAttachments`) — non-vision providers never see them. The message is persisted with its **original** attachments regardless of which the provider actually received.

**Token/usage meter**: each persisted model message can carry `tokensIn`/`tokensOut` (from the provider's usage reporting); the UI reads them off the message to show a "Prompt: N / Reply: M tokens" line (`src/components/chat/MessageBubble.tsx`).

## Key files

- `server/domain/history/history.store.ts` — `HistoryStore`: append, read, fork, export, import, delete
- `server/domain/history/history.export.ts` — `ExportEnvelope`, `wrap`, `slugifyFilename`
- `server/domain/history/history.types.ts` — `Message`, `MessageAttachment`, `SessionRecord`
- `server/domain/history/title.ts` — `computeTitle`
- `server/domain/search/search.service.ts` — `SearchService.search`, the `messages_fts` query
- `server/routes/sessions.routes.ts` — `/export`, `/import`, `/:id/fork`
- `server/routes/history.routes.ts` — session CRUD, `PATCH` for title/provider/workspace
- `server/domain/dispatch/dispatch.service.ts` — `preprocessAttachments`, `inlineTextAttachments`, the 10 MB cap

## See also

- [Providers](providers.md) — `capabilities.vision` gating for image attachments
- [Subagents & swarms](subagents-swarms.md) — how a resolved subagent flows into the same dispatch that handles attachments
- [Architecture](../architecture.md) — the dispatch loop and where history persistence fits
