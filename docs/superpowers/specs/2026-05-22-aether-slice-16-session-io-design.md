# Aether Slice 16 — Export / import single session (design spec)

**Date:** 2026-05-22
**Branch:** `feat/slice-16-session-io`
**Roadmap entry:** docs/superpowers/roadmap.md → "Slice 16 — Export/import single session"

## Goal

Let users move a single chat session in and out of Aether as a self-contained JSON file. Export a row to download its full transcript (messages + reasoning + tool call traces). Import a file via the Command Palette to create a fresh session populated from that transcript.

## Scope decisions

The brainstorming session settled the following:

| Decision | Choice |
|---|---|
| Export payload | Session only (no skills/tools/MCP/system instruction snapshot). Context stays a global concern. |
| Timestamps on import | All set to a single `Date.now()` captured at import. |
| `providerName` on import | Copied as-is. If the provider isn't registered locally, the chip just shows the name without functional impact. |
| IDs on import | New UUIDs for session, every message, every reasoning step, every tool call trace. |
| Import trigger | Command Palette command `Import session…` (no sidebar button). |
| Export trigger | Per-row hover button `↓` next to the existing `✎` / `×`. |
| Import validation | Zod with **lenient** behavior — unknown keys silently dropped at every level. Wrong `app` or `version` is still a hard reject. |
| Import size cap | 10 MB enforced via `express.json({ limit: '10mb' })` on the import route. |
| Export of a streaming session | Allowed. Reads from DB; in-flight (unpersisted) assistant message is naturally excluded. |
| Import during streaming on a different session | Allowed. New session is appended; active session and streaming state are untouched. |

## Envelope format

```ts
interface ExportEnvelope {
  app: 'aether';
  version: 1;
  exportedAt: number;        // Date.now() at export
  session: {
    title: string;
    createdAt: number;
    providerName?: string;
    messages: Message[];     // includes reasoningSteps; each tool_call step carries toolCall
  };
}
```

`Message` and `ReasoningStep` reuse the existing types from `server/domain/history/history.types.ts` and `server/domain/reasoning/reasoning.types.ts`. No new field shapes are introduced — the envelope is a thin discriminator + version wrapper around what `HistoryStore.readRecord(id)` already returns.

## Architecture

### Server

- **`server/domain/history/history.export.ts`** (new) — keeps serialization concerns out of the store:
  - `EXPORT_VERSION = 1` constant.
  - `exportEnvelopeSchema` — Zod schema. Top-level `app` and `version` are literal-matched; inner objects use default (non-strict) parsing so unknown keys are silently dropped at every level.
  - `wrap(record: SessionRecord, exportedAt: number): ExportEnvelope` — produces the envelope.
  - `slugifyFilename(title: string, exportedAt: number): string` — produces e.g. `aether-session-my-chat-20260522-1830.json`. Falls back to `aether-session-untitled-<ts>.json` if title is empty.

- **`server/domain/history/history.store.ts`** — two new methods:
  - `exportSession(id: string): Promise<ExportEnvelope | null>` — calls `readRecord(id)`; returns `null` if not found, else `wrap(record, Date.now())`.
  - `importSession(envelope: ExportEnvelope): Promise<SessionMeta>` — runs inside a single `db.transaction(...)`:
    1. Generate new session id and a single `now = Date.now()`.
    2. Insert into `sessions` (`id`, `title`, `created_at`, `updated_at`, `provider_name`) with `created_at = updated_at = now`.
    3. For each message in input order: generate new message id, insert into `messages` with the new id, `created_at = now`, `position = i`; insert mirror row into `messages_fts`; recursively insert reasoning steps (new ids, `timestamp = now`) and tool call traces (new ids).
    4. Reuse the existing private helpers `insertReasoningSteps` (already handles the nested tool call trace insertion).
    5. Return the new `SessionMeta`.
  - Both methods are wired into `AppDeps` exactly like the existing CRUD methods — no DI changes.

- **`server/routes/sessions.routes.ts`** (new) — small dedicated file:
  - `GET /api/sessions/:id/export` — calls `historyStore.exportSession(id)`. `null` → `404`. Otherwise sets `Content-Type: application/json`, `Content-Disposition: attachment; filename="<slug>"`, and `res.json(envelope)`.
  - `POST /api/sessions/import` — mounted with its own `express.json({ limit: '10mb' })` middleware (default app limit stays untouched). Validates body with `exportEnvelopeSchema`; on failure throws `ValidationError`. On success calls `historyStore.importSession(envelope)`, returns `201` with the new `SessionMeta`.
  - Mounted in `server/app.ts` after the existing routes.

### Frontend

- **`src/lib/api/sessions.api.ts`** — extend:
  - `exportSession(id: string): string` — returns the URL `/api/sessions/${id}/export` (export is a GET navigation, not a fetch).
  - `importSession(envelope: unknown): Promise<SessionMeta>` — POSTs JSON body, returns parsed `SessionMeta`. Throws on non-2xx.

- **`src/stores/sessions.store.ts`** — new action `importSession(file: File): Promise<void>`:
  1. `await file.text()` → `JSON.parse` (catch sets `error: 'Import failed: invalid JSON file'`).
  2. POST via `sessionsApi.importSession` (catches surface the server error message as `error: 'Import failed: <message>'`).
  3. On success: prepend the new `SessionMeta` to `sessions[]`, call `setActive(newId)`.

- **`src/components/layout/HiddenImportInput.tsx`** (new) — a singleton `<input type="file" accept="application/json" hidden>` mounted once at App level. Exposes a module-level `triggerImportOpen()` function that calls `.click()` on the ref. On `change`, reads the file and calls `useSessionsStore.getState().importSession(file)`, then resets the input value to allow re-import of the same filename.

- **`src/hooks/useCommands.ts`** — add `sessions.import` command:
  ```ts
  { id: 'sessions.import', group: 'sessions', label: 'Import session…', icon: Upload,
    run: () => triggerImportOpen() }
  ```

- **`src/components/sidebar/SessionsSection.tsx`** — extend `SessionRow`:
  - Add `↓` button between `✎` and `×`. `aria-label={`Export ${label}`}`. `onClick={() => window.location.assign(\`/api/sessions/${session.id}/export\`)}`.
  - Disabled when this row is the currently-streaming session (mirrors rename/delete).

- **`src/App.tsx`** — mount `<HiddenImportInput />` once.

### MSW

- **`src/test/msw-handlers.ts`** — add defaults:
  - `GET /api/sessions/:id/export` → minimal valid envelope.
  - `POST /api/sessions/import` → `201` with a synthetic `SessionMeta` derived from the request body.

## Data flow

### Export
1. User hovers a session row → clicks `↓`.
2. `window.location.assign('/api/sessions/<id>/export')` triggers a top-level navigation.
3. Server responds with `Content-Disposition: attachment` → browser opens native save dialog.
4. SPA state is preserved because the response is `attachment`, not a page replacement.

### Import
1. User opens palette (`Cmd+K`) → runs `Import session…`.
2. `triggerImportOpen()` programmatically opens the hidden file picker.
3. User selects a `.json` file → `change` event reads via `file.text()` + `JSON.parse`.
4. Frontend `POST /api/sessions/import` with the parsed envelope body.
5. Server `express.json({ limit: '10mb' })` middleware enforces size cap → `413` on overflow.
6. Zod parse: lenient (unknown keys dropped). On required-field failure → `400 ValidationError`.
7. Route handler calls `historyStore.importSession(envelope)`. The DB transaction either fully succeeds or rolls back — no partial sessions.
8. Server returns `201 { id, title, createdAt, updatedAt, providerName? }`.
9. Frontend prepends to `sessions[]`, sets active. The user sees the new session row appear and become selected.

## Error handling

| Error | Where | Surface |
|---|---|---|
| Malformed JSON | FE `JSON.parse` | `sessions.error = 'Import failed: invalid JSON file'` |
| Schema validation (missing required, wrong app, wrong version) | Server, zod | `400` with `error.message`; FE sets `sessions.error = 'Import failed: <message>'` |
| File > 10 MB | Server, express.json | `413 entity.too.large`; FE sets `sessions.error = 'Import failed: file exceeds 10 MB'` |
| Network | FE fetch | `sessions.error = 'Import failed: <message>'` |
| Export of unknown id (URL tampering) | Server | `404`; browser shows a 404 in a new tab — acceptable, only reachable by URL tampering |
| Transaction rollback (e.g., bad reasoning step that bypassed the lenient schema) | Server | Bubble as `500`; FE sets `sessions.error = 'Import failed: <message>'` |

The existing error banner in `SessionsSection` already renders `sessions.error` and provides a dismiss button. No new UI surface for errors.

## Testing strategy

### Server (vitest)
- `history.store.test.ts` — extend:
  - `exportSession` of unknown id returns `null`.
  - `exportSession` of seeded session returns envelope with full message/reasoning/toolCall shape and `version: 1`.
  - `importSession` creates new session id; original id remains absent; new id present in `listSessions()`.
  - `importSession` regenerates all message / reasoningStep / toolCall ids (assert no overlap with input).
  - `importSession` sets all timestamps to a single import-time `Date.now()` (mock with `vi.useFakeTimers`).
  - `importSession` populates `messages_fts` (assert via `SELECT count(*) FROM messages_fts WHERE session_id = ?`).
  - `importSession` is atomic — inject a failing insert and assert no leftover rows in `sessions` / `messages` / `messages_fts`.
- `history.export.test.ts` (new) — `exportEnvelopeSchema`:
  - Extra top-level keys dropped.
  - Extra keys inside `session.messages[i]` dropped.
  - Wrong `app` rejected.
  - Wrong `version` rejected.
  - Missing `session.messages` rejected.
- `sessions.routes.test.ts` (new) — supertest:
  - `GET /api/sessions/:id/export` → 200 + JSON body + `Content-Disposition` header includes `filename=`.
  - `GET /api/sessions/:id/export` for unknown id → 404.
  - `POST /api/sessions/import` with valid envelope → 201 + `SessionMeta`; listSessions shows the new session.
  - `POST /api/sessions/import` with invalid envelope → 400.
  - `POST /api/sessions/import` with payload > 10 MB → 413.

### Frontend (vitest + RTL + MSW)
- `sessions.api.test.ts` — `exportSession(id)` returns the canonical URL; `importSession(envelope)` POSTs JSON and returns parsed `SessionMeta`.
- `sessions.store.test.ts` — `importSession(file)` reads file, prepends to list, sets active; surfaces parse and network errors to `sessions.error`.
- `SessionsSection.test.tsx` — `↓` button renders per row with correct `aria-label`; click triggers `window.location.assign` with the right URL; disabled when row is the streaming session.
- `HiddenImportInput.test.tsx` (new) — calling the trigger opens the picker; selecting a file dispatches `importSession`.
- `useCommands.test.ts` — `sessions.import` command is present and calls the trigger.

### Integration (vitest + RTL + MSW)
- `src/integration/session-io.integration.test.tsx` — Cmd+K → click `Import session…` → simulate file selection → MSW returns new `SessionMeta` → new session row appears in sidebar and is active.

### Playwright (e2e/smoke.spec.ts)
- One smoke test: open palette → run `Import session…` → upload a fixture JSON from `e2e/fixtures/` → assert new session row appears with the fixture title and is active.

## Out of scope

- Bulk export of the whole library — single session only.
- Importing into an existing session (merge) — always creates a new session.
- Schema versions other than 1 — future versions will add a migrator + version-N parser.
- Encrypted / signed exports.
- Exporting context (skills/tools/MCP/system instruction) — explicitly excluded; orthogonal slice if ever needed.
- Drag-and-drop import surface — file picker only.

## Acceptance criteria

1. Hovering any session row exposes a `↓` button that downloads `aether-session-<slug>-<ts>.json` containing a `version: 1` envelope with all messages, reasoning steps, and tool call traces.
2. The Command Palette exposes `Import session…`. Running it opens a file picker. Selecting a valid export file creates a new session at the top of the list, sets it active, with fresh ids/timestamps and the original `providerName`.
3. Invalid JSON, schema-invalid bodies, files >10 MB, and network errors are all surfaced in the sidebar error banner with a clear message.
4. Imported messages appear in FTS search results (verified by integration with `messages_fts`).
5. Round-trip: export → import → export produces a session whose content (after timestamp normalization) matches the original.
