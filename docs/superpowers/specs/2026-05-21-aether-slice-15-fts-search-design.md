# Aether Slice 15 — Full-text Search over Messages — Design

**Status:** approved (2026-05-21)
**Branch:** `feat/slice-15-fts-search`
**Depends on:** slice 13 (SQLite persistence — provides `messages` table + migration runner), slice 5 (Command Palette).

---

## Goal

Add full-text search across all chat messages. Users open the existing Command Palette, run the new **Search history…** command, type a query, and see session-grouped results with highlighted snippet excerpts. Clicking a result opens that session.

## Non-goals

- No new dependency. SQLite's FTS5 module ships with `better-sqlite3`.
- No search over reasoning steps or tool call traces — messages only.
- No search-by-date or search-by-provider filters. Plain text MATCH for v1.
- No Playwright e2e — covered by FE integration test.
- No FE component for an inline "find in current session" affordance. The palette is the only search entry.
- No deep-linking to a specific message id within a session (clicking a hit opens the session; the user can scroll to find it). Adding a scroll-to-message would be a follow-up.

---

## Architecture

A new `messages_fts` standalone FTS5 virtual table contains `(message_id, session_id, role, content)` and is created in migration `002_fts.sql`. `HistoryStore` maintains the index explicitly: `append()` inserts a matching FTS row inside its existing transaction; `delete(sessionId)` deletes the session's FTS rows first, then deletes the session (the existing FK cascade still handles `messages` cleanup).

A new `SearchService` (`server/domain/search/search.service.ts`) exposes `search(query, opts): Promise<SessionHits[]>`. It runs a single FTS5 MATCH query joined to `sessions`, uses SQLite's `snippet()` function with custom NON-HTML markers (`«M»…«/M»`) for highlighted excerpts, groups results by session, and returns the top N (default 3) hits per session ordered by BM25 rank.

A new route `GET /api/search?q=...&limit=...` validates the query and returns the grouped results as JSON.

Frontend: a new `searchApi.search(q)` client + a new "Search history…" command in the existing Command Palette. The palette store gains a `mode: 'commands' | 'search'` discriminator. In search mode the input switches to a "Search messages…" placeholder; results render via a `<SnippetHighlight>` component that splits the snippet string on the `«M»...«/M»` markers and renders React `<mark>` elements around the matches. **No `dangerouslySetInnerHTML`.**

---

## Components

### Backend — new

- `server/db/migrations/002_fts.sql` — declares the FTS5 virtual table:
  ```sql
  CREATE VIRTUAL TABLE messages_fts USING fts5(
    message_id UNINDEXED,
    session_id UNINDEXED,
    role UNINDEXED,
    content,
    tokenize='unicode61'
  );
  ```
  Followed by a one-shot backfill statement (idempotent on empty data):
  ```sql
  INSERT INTO messages_fts (message_id, session_id, role, content)
    SELECT id, session_id, role, content FROM messages;
  ```
  The `UNINDEXED` columns are stored as payload (returned alongside the match) but not searched.
- `server/domain/search/search.types.ts` — exports the result type:
  ```ts
  export interface SnippetHit {
    messageId: string;
    role: 'user' | 'model';
    snippet: string;        // contains «M»…«/M» highlight markers
  }
  export interface SessionHits {
    sessionId: string;
    title: string;
    updatedAt: number;
    hits: SnippetHit[];
  }
  ```
- `server/domain/search/search.service.ts` — `SearchService` class. Constructor: `new SearchService(db: DatabaseHandle)`. Single public method `search(query: string, opts?: { limit?: number; snippetsPerSession?: number }): Promise<SessionHits[]>`. Default `limit: 100`, `snippetsPerSession: 3`. Trims the query; returns `[]` on empty. Wraps the prepared statement in try/catch to swallow FTS5 syntax errors and return `[]`.
- `server/domain/search/search.service.test.ts` — 9 cases (see Testing).
- `server/routes/search.routes.ts` — exports `createSearchRoutes(svc: SearchService): Router`. Single endpoint `GET /search?q=...&limit=...`. Validates `q` non-empty; clamps `limit` to `[1, 500]`. Returns `{ results: SessionHits[] }`.
- `server/routes/search.routes.test.ts` — 4 cases.

### Backend — modified

- `server/domain/history/history.store.ts` — extend `append()` and `delete()`:
  - `append()`: after `INSERT INTO messages`, also `INSERT INTO messages_fts (message_id, session_id, role, content) VALUES (?, ?, ?, ?)` with the same values. Inside the same transaction.
  - `delete(sessionId)`: prepend `DELETE FROM messages_fts WHERE session_id = ?`. Same transaction as the existing session DELETE.
- `server/domain/history/history.store.test.ts` — 2 new cases (append populates FTS; delete clears FTS).
- `server/app.ts` — mount `createSearchRoutes(searchService)` at `/api/search`. Add `searchService?: SearchService` to `AppDeps`.
- `server/index.ts` — `const searchService = new SearchService(db)`; pass to `createApp`.

### Frontend — new

- `src/types/search.types.ts` — mirrors the backend `SessionHits` / `SnippetHit` shapes.
- `src/lib/api/search.api.ts` — exports `searchApi.search(q: string, opts?: { limit?: number }): Promise<SessionHits[]>`. Encodes `q` via `encodeURIComponent`.
- `src/lib/api/search.api.test.ts` — 1 case (GET URL + result mapping).
- `src/components/palette/SnippetHighlight.tsx` — small presentational component. Takes `snippet: string`, splits on the `«M»...«/M»` markers, renders alternating plain spans and `<mark>` elements. **No `dangerouslySetInnerHTML`** — pure React element construction. Tested with content that contains literal HTML characters (`<script>` etc.) to confirm zero injection surface.
- `src/components/palette/SnippetHighlight.test.tsx` — 3 cases (no markers → plain text; markers → mark elements; literal HTML chars stay as text).

### Frontend — modified

- `src/stores/palette.store.ts` — add `mode: 'commands' | 'search'`, `searchQuery: string`, `searchResults: SessionHits[]`. Actions: `enterSearchMode()`, `exitSearchMode()`, `setSearchQuery(q)`, `setSearchResults(results)`. Existing `open()` resets to `mode: 'commands'`. `close()` resets both.
- `src/stores/palette.store.test.ts` — 4 new cases (mode transitions, results setter, exit clears).
- `src/components/palette/CommandPalette.tsx` — add "Search history…" command entry. In search mode: input placeholder = "Search messages…", debounced `useEffect` calls `searchApi.search` ~150ms after typing stops, renders session-grouped results using `<SnippetHighlight>` for each snippet, Enter on a result calls `sessionsStore.setActiveSession(sessionId)` + closes. Escape exits search mode.
- `src/components/palette/CommandPalette.test.tsx` — 6 new cases (entry visible, mode switch, debounced search call, result rendering with marks, Enter switches session, Escape exits).
- `src/test/msw-handlers.ts` — default handler for `GET /api/search` returning `{ results: [] }`.

### Frontend — integration

- `src/integration/search.integration.test.tsx` — one new case: open palette → select "Search history…" → type query → results render → click a result → active session changes.

### No new dependency

`messages_fts` is created by an existing migration runner. `snippet()` and `bm25()` are FTS5 built-ins. No npm install.

---

## Data flow

### Migration path

`server/db/migrate.ts` runs at server start, applies any pending migrations from `server/db/migrations/`. After slice 15:
1. `002_fts.sql` runs:
   - `CREATE VIRTUAL TABLE messages_fts USING fts5(...)`
   - `INSERT INTO messages_fts (...) SELECT id, session_id, role, content FROM messages` — idempotent on empty data, one-shot for any existing rows.
2. `_migrations` records version 2.

### Append path

`HistoryStore.append(sessionId, message)`, wrapped in the existing `db.transaction(() => { ... })`:
1. Read session row → NotFoundError if missing.
2. Compute next `position`.
3. `INSERT INTO messages (...)`.
4. **NEW:** `INSERT INTO messages_fts (message_id, session_id, role, content) VALUES (?, ?, ?, ?)`.
5. Insert reasoning steps + tool_call_traces.
6. `UPDATE sessions SET title = ?, updated_at = ?`.

The transaction commits atomically — partial-write inconsistencies are impossible.

### Delete path

`HistoryStore.delete(sessionId)`, wrapped in `db.transaction(() => { ... })`:
1. **NEW:** `DELETE FROM messages_fts WHERE session_id = ?`.
2. `DELETE FROM sessions WHERE id = ?` (FK cascade removes `messages` + `reasoning_steps` + `tool_call_traces`).

### Search path

`SearchService.search(query, opts)`:
1. Trim + normalize the query. If empty, return `[]` (no DB roundtrip).
2. Run the FTS5 query:
   ```sql
   SELECT
     mf.message_id AS messageId,
     mf.session_id AS sessionId,
     mf.role,
     snippet(messages_fts, 3, '«M»', '«/M»', '…', 20) AS snippet,
     bm25(messages_fts) AS rank,
     s.title,
     s.updated_at AS updatedAt
   FROM messages_fts mf
   JOIN sessions s ON s.id = mf.session_id
   WHERE messages_fts MATCH ?
   ORDER BY rank ASC, s.updated_at DESC
   LIMIT ?
   ```
   - `snippet(messages_fts, 3, '«M»', '«/M»', '…', 20)` highlights matches in column index 3 (`content`), with non-HTML markers (`«M»` / `«/M»`) and `…` as the truncation marker and ~20-token snippet length. The markers are chosen specifically to NOT collide with any HTML and to be improbable in user content.
   - `bm25()` rank: lower is better; ASC puts best first.
3. Group rows in memory by `sessionId`. Per session, keep the top `snippetsPerSession` hits. Sort sessions by their BEST hit's rank.
4. Return `SessionHits[]`.

If the FTS5 MATCH expression has syntax errors, the prepared statement throws `SqliteError`. The service catches and returns `[]`.

### HTTP path

`GET /api/search?q=...&limit=...`:
1. Validate `q` is a non-empty string after trim → 400 with `MISSING_QUERY` envelope if not.
2. Parse `limit` as int; clamp to `[1, 500]`. Default 100.
3. Call `searchService.search(q, { limit })`.
4. Return `{ results: SessionHits[] }` as JSON, HTTP 200.

### Frontend path

1. User opens palette (Cmd+K). Existing command list renders; "Search history…" is one of the items.
2. User selects "Search history…" → `paletteStore.enterSearchMode()` flips `mode: 'search'`, clears `searchQuery` + `searchResults`.
3. User types. A debounced effect (150ms) calls `searchApi.search(query)`. `paletteStore.setSearchResults(results)`.
4. Results render: each session as a row group with title (bold) + up to 3 snippet excerpts. Each snippet is rendered via `<SnippetHighlight snippet={hit.snippet} />`, which splits on the `«M»` / `«/M»` markers and emits alternating `<span>` and `<mark>` React elements. **No `dangerouslySetInnerHTML`.** User content stays as React text nodes; literal HTML characters (`<`, `>`, `&`) render escaped by React automatically.
5. Arrow keys navigate hit list; Enter on a result → `sessionsStore.setActiveSession(sessionId)` + `paletteStore.close()`.
6. Escape exits search mode back to the command list (palette stays open).

### Cancellation

The debounced effect uses an `AbortController` per query so a stale in-flight fetch is cancelled when the user keeps typing. The store's `searchResults` field is only updated when the latest fetch resolves.

---

## Error handling

- **FTS5 syntax error** (e.g., unmatched quote) → `SearchService.search()` catches the `SqliteError`, returns `[]`. The route returns `{ results: [] }`. FE shows "No results" — same as a query that genuinely has zero matches. No exception surfaces.
- **Empty query** (after `.trim()`) → `SearchService.search()` short-circuits to `[]` without a DB roundtrip. Route returns `{ results: [] }`.
- **Missing `q` parameter** → route returns HTTP 400 `{ error: { code: 'MISSING_QUERY', message: 'Query parameter q is required' } }`. The FE never triggers this (always sends `q`); defensive guard for direct API misuse.
- **`limit` out of range** → route clamps to `[1, 500]`. Default 100. No error returned.
- **Append-time FTS insert failure** (disk-full, corruption — extremely unlikely) → the outer `db.transaction(...)` rolls back; the message is NOT inserted. Existing dispatch error handling surfaces it.
- **Delete-time FTS delete failure** → same rollback semantics; the session stays.
- **Search hit references a session that was just deleted** (read+delete race) → the JOIN on `sessions` filters it out.
- **Network error on FE** → existing palette error UX (toast or inline error row). Stale results stay until the next successful query.

---

## Testing

### Migration (`server/db/migrate.test.ts` extension)
1. One new case: applying `002_fts.sql` creates the `messages_fts` virtual table; `_migrations` contains versions 1 + 2.

### SearchService (`server/domain/search/search.service.test.ts`)
Uses `makeTestDb()` + `HistoryStore` to seed messages.
1. Empty index → `search('anything')` returns `[]`.
2. Single message match → 1 SessionHits with 1 hit; snippet contains `«M»` around the matched term.
3. Multiple matches across sessions → grouped by session; sessions ordered by best rank.
4. Multiple matches in one session → at most `snippetsPerSession` (default 3) hits per session.
5. `limit` opt caps the raw row count returned from SQLite.
6. Empty query → `[]` returned without preparing/executing any statement (assertable via spy on `db.prepare`).
7. FTS5 syntax error (e.g., `'"foo'` unmatched quote) → `[]` returned, no throw.
8. Result `snippet` preserves literal HTML characters in user content (e.g., a message containing `<script>` returns a snippet whose plain-text segments contain the raw `<script>`; only the highlight markers `«M»`/`«/M»` are added by SQLite).
9. Result `title` + `updatedAt` come from the joined `sessions` row.

### HistoryStore extension (`server/domain/history/history.store.test.ts` extension)
1. `append()` inserts a row in `messages_fts` with matching `message_id`, `session_id`, `role`, `content`.
2. `delete(sessionId)` removes all `messages_fts` rows for that session's messages.

### Search route (`server/routes/search.routes.test.ts`)
1. `GET /api/search?q=hello` returns 200 + `{ results: [...] }`.
2. `GET /api/search` (no `q`) returns 400 + `MISSING_QUERY` envelope.
3. `GET /api/search?q=%20%20` (whitespace-only after decode) returns 200 + `{ results: [] }`.
4. `GET /api/search?q=x&limit=2` respects the cap.

### FE API client (`src/lib/api/search.api.test.ts`)
1. `searchApi.search('q')` GETs `/api/search?q=q` and returns the `results` array unwrapped.

### SnippetHighlight (`src/components/palette/SnippetHighlight.test.tsx`)
1. Snippet without markers renders plain text in a single span.
2. Snippet with markers splits into spans + `<mark>` elements; the matched text is inside `<mark>`.
3. Snippet containing literal `<script>` renders the `<script>` as text content (React escaping), NOT as an executable element. Assert by querying the DOM for a `script` element and confirming none exists.

### Palette store (`src/stores/palette.store.test.ts` extension)
1. `enterSearchMode()` flips `mode` to `'search'`, clears `searchQuery` + `searchResults`.
2. `exitSearchMode()` flips back to `'commands'`, clears `searchResults`.
3. `setSearchResults(...)` stores the array.
4. `close()` resets mode + clears results (existing test extended if needed).

### Command Palette component (`src/components/palette/CommandPalette.test.tsx` extension)
1. "Search history…" entry visible in command list.
2. Selecting it switches palette into search mode (placeholder changes).
3. Typing in search mode debounces a call to `searchApi.search` (MSW stub captures the request; assert via spy or MSW listener).
4. Search results render as session-grouped items; `<mark>` elements appear in the DOM (assertable via `screen.getAllByRole('mark')` or class selector).
5. Enter on a result calls `sessionsStore.setActiveSession(sessionId)` and exits the palette.
6. Escape exits search mode back to commands without closing the palette.

### FE integration (`src/integration/search.integration.test.tsx`)
One case: open palette → select "Search history…" → type a query → MSW returns 2 sessions with 1 hit each → click the first result → palette closes + active session changes.

### Playwright
None new. CI has no seeded data; the integration test covers the full FE flow.

---

## Decisions log

| # | Decision | Rationale |
|---|---|---|
| 1 | Standalone FTS5 (not external-content) | User picked app-level sync over triggers; standalone is simpler to reason about + the HistoryStore's existing transactions already serialize writes |
| 2 | App-level sync via HistoryStore.append/delete | All FTS mutations live in TypeScript; explicit + visible; no hidden SQL triggers |
| 3 | Delete: drop FTS rows BEFORE session delete (same transaction) | FK cascade fires on `messages` after the session delete; doing FTS first keeps everything in TS-visible app code |
| 4 | Backfill statement in 002_fts.sql | One-shot for any existing rows (none today, but defensive for future deployments that migrate from a non-empty state) |
| 5 | `snippet(messages_fts, 3, '«M»', '«/M»', '…', 20)` with NON-HTML markers | SQLite does NOT HTML-escape user content; using HTML-like tags (e.g., `<mark>`) would create an XSS vector. The `«M»` markers are improbable in user content and unambiguous to parse client-side |
| 6 | `bm25(messages_fts)` for ranking, ASC order | BM25 is the standard FTS5 relevance score; lower-is-better; ASC puts best matches first |
| 7 | Default `limit: 100`, max 500, per-session `snippetsPerSession: 3` | Avoids dominating sessions; 3 snippets typically enough to gauge relevance |
| 8 | Results grouped by session in the SERVICE (not by the SQL) | Cleaner: SQL returns flat rows ordered by rank; service groups in memory. Simplifies the SQL. |
| 9 | FTS5 syntax errors → `[]` (not 4xx) | Users don't think in FTS5 syntax; treating syntax errors as "no results" is the friendlier UX |
| 10 | Palette `mode: 'commands' \| 'search'` discriminator | Single store, two modes; smallest UX change vs a separate overlay |
| 11 | `<SnippetHighlight>` parses markers to React elements (NO `dangerouslySetInnerHTML`) | SQLite doesn't sanitize user content; rendering raw text via `dangerouslySetInnerHTML` would be an XSS vector. Splitting on custom markers + emitting React elements is XSS-free by construction |
| 12 | Search scope: messages only (no titles, no reasoning) | v1 scope; can extend later by adding columns to `messages_fts` or a second FTS table |
| 13 | No Playwright e2e | CI has no seeded data; integration test covers FE end-to-end adequately |
