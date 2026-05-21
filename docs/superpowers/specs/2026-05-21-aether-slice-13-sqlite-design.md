# Aether Slice 13 — SQLite Persistence — Design

**Status:** approved (2026-05-21)
**Branch:** `feat/slice-13-sqlite`
**Depends on:** every prior slice's stores (Context / History / Profiles / SubAgents)

---

## Goal

Replace the four JSON-file backed stores (`context.json`, `sessions.json`, `profiles.json`, `subagents.json`) with a single SQLite database. Fully relational schema (no JSON blobs in columns) with foreign keys and indexes. No data migration — the JSON stores are empty in development.

## Non-goals

- No new product features. Pure persistence refactor.
- No ORM dependency (Drizzle / Prisma / Kysely). Hand-written prepared statements only.
- No data migration from existing JSON files. If a deployment ever needs it, write a one-off script later.
- No async / connection-pool concerns. `better-sqlite3` is synchronous and single-process.
- No FE changes. Public store APIs are preserved.

---

## Architecture

A new module `server/db/` owns the SQLite connection + migration runner. At bootstrap, `server/index.ts` opens a single `Database` instance pointing at `${cfg.dataDir}/aether.sqlite`, runs any pending migrations from `server/db/migrations/*.sql`, then constructs the four existing stores with the `Database` handle injected (instead of a file path).

`better-sqlite3` is synchronous — `db.prepare(sql).get()` / `.all()` / `.run()` return immediately. The four store classes keep their public Promise-based API to avoid rippling changes through routes + dispatch + tests; internally each method does synchronous SQLite calls wrapped in `async`. Fast enough — Node never blocks anywhere meaningful since SQLite in-process queries take microseconds.

**Migration runner:** simple `.sql`-files-in-order pattern. Each file has a numeric prefix (`001_initial.sql`, `002_add_progress_note.sql`, etc.). The runner tracks applied migrations in a `_migrations(version INTEGER PRIMARY KEY, applied_at TEXT)` table; on startup it computes the unapplied set and applies each in a transaction.

**Pragmas applied at startup:** `journal_mode = WAL` (faster writes, concurrent reads), `foreign_keys = ON` (off by default in SQLite), `synchronous = NORMAL` (durable enough; WAL keeps it safe across crashes).

**Tests:** each store's test file constructs `new Database(':memory:')`, runs migrations, then exercises the store. Replaces the current `mkdtemp` + JSON-file pattern.

---

## Schema (relational tables)

### Migrations / system

`_migrations` is created by the migration runner itself (`CREATE TABLE IF NOT EXISTS ...`) before any product migration runs, so the very first migration file (`001_initial.sql`) is free to assume `_migrations` already exists. Schema:

```sql
CREATE TABLE _migrations (
  version INTEGER PRIMARY KEY,
  applied_at TEXT NOT NULL
);
```

### Context (singleton)

```sql
CREATE TABLE context (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  system_instruction TEXT NOT NULL DEFAULT ''
);

CREATE TABLE context_skills (
  position INTEGER PRIMARY KEY,
  name TEXT NOT NULL
);

CREATE TABLE context_tools (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  version TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('online','offline')),
  position INTEGER NOT NULL
);

CREATE TABLE context_mcp_servers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  transport TEXT NOT NULL CHECK (transport IN ('stdio','mock','http')),
  command TEXT,
  args TEXT,                       -- JSON array of strings; NULL when not applicable
  env TEXT,                        -- JSON object; NULL when not applicable
  url TEXT,
  status TEXT NOT NULL
);

CREATE TABLE context_mcp_tool_policies (
  server_id TEXT NOT NULL REFERENCES context_mcp_servers(id) ON DELETE CASCADE,
  tool_name TEXT NOT NULL,
  auto_approve INTEGER NOT NULL,
  PRIMARY KEY (server_id, tool_name)
);
```

### Sessions / messages / reasoning

```sql
CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  provider_name TEXT
);
CREATE INDEX idx_sessions_updated_at ON sessions(updated_at DESC);

CREATE TABLE messages (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('user','model')),
  content TEXT NOT NULL,
  model TEXT,
  interrupted INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  position INTEGER NOT NULL
);
CREATE INDEX idx_messages_session ON messages(session_id, position);

CREATE TABLE reasoning_steps (
  id TEXT PRIMARY KEY,
  message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  tokens INTEGER,
  duration_ms INTEGER,
  sub_agent TEXT,
  timestamp INTEGER NOT NULL,
  position INTEGER NOT NULL
);
CREATE INDEX idx_reasoning_message ON reasoning_steps(message_id, position);

CREATE TABLE tool_call_traces (
  id TEXT PRIMARY KEY,
  reasoning_step_id TEXT NOT NULL REFERENCES reasoning_steps(id) ON DELETE CASCADE,
  qualified_name TEXT NOT NULL,
  args TEXT NOT NULL,              -- JSON
  result TEXT,                     -- JSON, NULL on error
  error TEXT,
  duration_ms INTEGER NOT NULL,
  progress_note TEXT
);
```

### Profiles

```sql
CREATE TABLE profiles (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  system_instruction TEXT NOT NULL DEFAULT '',
  thinking_enabled INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE profile_skills (
  profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  name TEXT NOT NULL,
  PRIMARY KEY (profile_id, position)
);

CREATE TABLE profile_tools (
  profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  tool_id TEXT NOT NULL,
  name TEXT NOT NULL,
  version TEXT NOT NULL,
  status TEXT NOT NULL,
  position INTEGER NOT NULL,
  PRIMARY KEY (profile_id, tool_id)
);

CREATE TABLE profile_mcp_servers (
  profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  server_id TEXT NOT NULL,
  name TEXT NOT NULL,
  transport TEXT NOT NULL,
  command TEXT,
  args TEXT,
  env TEXT,
  url TEXT,
  status TEXT NOT NULL,
  PRIMARY KEY (profile_id, server_id)
);

CREATE TABLE profile_mcp_tool_policies (
  profile_id TEXT NOT NULL,
  server_id TEXT NOT NULL,
  tool_name TEXT NOT NULL,
  auto_approve INTEGER NOT NULL,
  PRIMARY KEY (profile_id, server_id, tool_name),
  FOREIGN KEY (profile_id, server_id)
    REFERENCES profile_mcp_servers(profile_id, server_id)
    ON DELETE CASCADE
);
```

### Sub-agents

```sql
CREATE TABLE subagents (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  system_instruction TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE subagent_skills (
  subagent_id TEXT NOT NULL REFERENCES subagents(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  name TEXT NOT NULL,
  PRIMARY KEY (subagent_id, position)
);

CREATE TABLE subagent_tools (
  subagent_id TEXT NOT NULL REFERENCES subagents(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  name TEXT NOT NULL,
  PRIMARY KEY (subagent_id, position)
);
```

16 tables total (excluding `_migrations`).

---

## Components

### Backend — new

- `server/db/database.ts` — exports `openDatabase(filePath: string): Database`. Opens better-sqlite3, applies pragmas (WAL, foreign_keys=ON, synchronous=NORMAL), returns the handle.
- `server/db/migrate.ts` — `applyMigrations(db: Database, migrationsDir: string): { applied: number[] }`. First ensures `_migrations` exists via `CREATE TABLE IF NOT EXISTS _migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)`. Then reads `.sql` files from `migrationsDir` sorted numerically by their `NNN_` prefix, checks which versions are already in `_migrations`, applies each pending one inside a `db.transaction(...)`, and records the version on success.
- `server/db/migrate.test.ts` — covers: empty DB applies all; second run is a no-op; bad migration rolls back; numeric-not-lexical ordering.
- `server/db/migrations/001_initial.sql` — full schema from above (the 16 product tables). Does NOT create `_migrations` — the runner owns that table.
- `server/test/test-db.ts` — small helper `makeTestDb(): Database` that opens `:memory:`, runs migrations, returns the handle.

### Backend — modified (stores)

Each store's public Promise-based API is preserved; only the internals change.

- `server/domain/context/context.store.ts` — constructor now takes `db: Database` instead of `filePath: string`. `read()` / `write()` / `patch()` use SQL via prepared statements. `init()` becomes `INSERT OR IGNORE INTO context(id, system_instruction) VALUES (1, '')` to seed the singleton.
- `server/domain/context/context.store.test.ts` — uses `makeTestDb()` instead of `mkdtemp` + JSON file.
- `server/domain/history/history.store.ts` — SQL-backed `createEmpty` / `list` / `read` / `appendMessage` / `patch` / `delete`. Nested reads (messages → reasoning_steps → tool_call_traces) use separate queries per level (N+1 acceptable at chat-load granularity).
- `server/domain/history/history.store.test.ts` — same setup change.
- `server/domain/profiles/profiles.store.ts` — SQL-backed; profile snapshots span the 5 profile_* tables. Writes use a transaction with delete-then-insert for child tables.
- `server/domain/profiles/profiles.store.test.ts` — same setup change.
- `server/domain/subagents/subagents.store.ts` — SQL-backed; sub-agents span the 3 subagent_* tables.
- `server/domain/subagents/subagents.store.test.ts` — same setup change.

### Backend — modified (bootstrap)

- `server/index.ts` — open the DB once via `openDatabase(path.join(cfg.dataDir, 'aether.sqlite'))`, run `applyMigrations(db, ...)`, then pass `db` to each store. The four `path.join(cfg.dataDir, '*.json')` calls go away.

### Other tests

Route tests (`server/routes/history.routes.test.ts`, etc.) and dispatch tests currently construct stores from a `tmpdir` path. They get updated to construct stores from a `makeTestDb()` handle. Same assertions, only setup changes.

### Optional helper

- `server/test/store-helpers.ts` — `makeStores(): { db, contextStore, historyStore, profilesStore, subAgentsStore }` for tests that need a full backend wired up. Reduces duplication in integration tests.

### No FE changes

Public store APIs are preserved (Promise-based, same method names and return types). Routes / dispatch / SSE wiring is unchanged.

### New dependency

`better-sqlite3` (native module). One-time `npm install` rebuild step.

---

## Data flow

### Bootstrap path

1. `server/index.ts` calls `loadConfig()`, then `openDatabase(path.join(cfg.dataDir, 'aether.sqlite'))`.
2. `applyMigrations(db, path.join(__dirname, 'db/migrations'))` reads `.sql` files sorted numerically, applies any not in `_migrations`, each wrapped in `db.transaction(...)`. On first run the schema is created and `_migrations` is populated with version 1.
3. Stores are constructed with the shared `db` handle: `new ContextStore(db)`, `new HistoryStore(db)`, `new ProfilesStore(db)`, `new SubAgentsStore(db)`.
4. Existing wiring (`createApp(...)`, `DispatchService(...)`, `McpRegistry(contextStore)`) is unchanged.

### Read example — `HistoryStore.list()`

1. `db.prepare('SELECT id, title, created_at, updated_at, provider_name FROM sessions ORDER BY updated_at DESC').all()` → rows.
2. Map each row to `{ id, title, createdAt, updatedAt, providerName }`, return as `Promise.resolve([...])`.

### Read example — `HistoryStore.read(sessionId)`

1. `db.prepare('SELECT id, role, content, model, interrupted, created_at, position FROM messages WHERE session_id = ? ORDER BY position').all(sessionId)`.
2. For each message, separate query: `db.prepare('SELECT ... FROM reasoning_steps WHERE message_id = ? ORDER BY position').all(message.id)`.
3. For each reasoning step with type `'tool_call'`: separate query for the matching `tool_call_traces` row.
4. Stitch nested shape together; return.

N+1 query cost noted but acceptable: chat-load is per-session-open, not per message; SQLite in-process queries take microseconds. If profiling later shows this matters, batch-fetch with a single JOIN.

### Write example — `HistoryStore.appendMessage(sessionId, msg)`

Wrapped in `db.transaction(() => { ... })`:
1. Compute `position = (SELECT COALESCE(MAX(position), -1) + 1 FROM messages WHERE session_id = ?)`.
2. `INSERT INTO messages (...)` with that position.
3. For each `reasoningStep`: `INSERT INTO reasoning_steps (...)`. If `step.toolCall`: also `INSERT INTO tool_call_traces (...)`.
4. `UPDATE sessions SET updated_at = ? WHERE id = ?`.

The transaction commits atomically; partial-write inconsistencies are impossible.

### Write example — `ProfilesStore.upsert(profile)`

Inside a transaction:
1. `INSERT OR REPLACE INTO profiles (...)`.
2. `DELETE FROM profile_skills WHERE profile_id = ?` + `INSERT INTO profile_skills (...)` for each entry.
3. Same delete-then-insert for `profile_tools`, `profile_mcp_servers`, `profile_mcp_tool_policies`.

"Delete-then-insert" is simpler than computing deltas and fast enough at our scale (a profile snapshot is ~10 rows total).

### Test data flow

1. `beforeEach`: `const db = makeTestDb()` → `new Database(':memory:')` + `applyMigrations(db, ...)`. Each test gets an empty schema-applied DB.
2. `afterEach`: `db.close()`.
3. Store under test gets the fresh handle. No filesystem touched.

### Cancellation / errors

SQLite operations are synchronous and either succeed or throw `SqliteError`. Stores wrap the throw in the existing error envelope (currently they throw `new Error(...)` on file-not-found etc.; SQL errors get the same treatment).

---

## Error handling

- **`Database` open failure** (disk full, permissions, corruption) → `openDatabase()` throws; bootstrap fails fast via the existing `bootstrap().catch(err => { console.error(...); process.exit(1) })` path. No silent fallback to JSON files.
- **Migration failure mid-transaction** → `db.transaction(...)` rolls back; the failing version is NOT recorded in `_migrations`; `applyMigrations` rethrows. Bootstrap aborts.
- **Foreign-key constraint violation at runtime** → SQLite throws `SqliteError SQLITE_CONSTRAINT_FOREIGNKEY`. Stores let it bubble; routes turn it into a 500. In practice impossible because inserts live inside transactions that own their session.
- **Concurrent writes from two requests** → WAL mode handles read+write concurrency; SQLite serializes writes. better-sqlite3 is single-threaded so within Aether's process there's no race.
- **`UNIQUE` / `CHECK` violation** → throws; stores let it bubble.
- **Missing row on `read()`** → return `null` (matches current JSON-store behavior).

---

## Testing

- `server/test/test-db.ts` exports `makeTestDb(): Database` — opens `:memory:`, runs migrations, returns the handle. Used by every store test.
- Each existing store test file is rewritten to use `makeTestDb()` in `beforeEach` + `db.close()` in `afterEach`. All existing test cases are preserved (same `expect(...)` assertions); only the setup changes.
- `server/db/migrate.test.ts` covers:
  - Empty DB → all migrations apply, `_migrations` has correct version rows.
  - Second `applyMigrations()` run → no-op, returns `applied: []`.
  - Migration that throws → transaction rolls back; `_migrations` does NOT contain that version; the partial schema is gone.
  - Numeric-not-lexical ordering (`002_x.sql` runs before `010_x.sql`).
- One **integration test** (new file `server/test/db.integration.test.ts`): boots a real `:memory:` DB, constructs all four stores, runs a small cross-store flow (create profile → save context from it → create session → append message → verify reads agree). Catches breakage in store-to-store interactions that unit tests miss.
- Tests that construct stores indirectly (e.g., `dispatch.service.test.ts`, route tests) get their setup updated to use `makeStores()` from the new helper module.
- **No Playwright changes.** The e2e suite already uses a scratch `AETHER_DATA_DIR`; it'll get an `aether.sqlite` instead of `*.json` files there. Migrations run on startup. The 13 existing e2e tests pass unchanged.

---

## Decisions log

| # | Decision | Rationale |
|---|---|---|
| 1 | `better-sqlite3` for the SQLite driver | Synchronous API → simpler store code; mature; widest adoption; fast |
| 2 | Fully relational schema (16 tables) | User picked it explicitly over the hybrid alternative, accepting the larger slice scope; future query/search features get free indexing |
| 3 | Hand-written prepared statements; no ORM | Smaller dep surface; SQL is short enough to maintain by hand; ORM lock-in not justified at this scale |
| 4 | Migration runner reads `.sql` files in numeric order | Smallest possible runner; explicit SQL; transactions per migration |
| 5 | Pragmas: WAL + foreign_keys=ON + synchronous=NORMAL | WAL for concurrency, FK for the cascade deletes we depend on, NORMAL is durable enough under WAL |
| 6 | Public store APIs stay Promise-based | Avoids rippling a sync/async API change through routes + dispatch + tests; perf cost is zero |
| 7 | Tests use in-memory SQLite (`:memory:`) via `makeTestDb()` | Faster than tmpfile per test; trivially isolated; idiomatic for better-sqlite3 |
| 8 | Profile child-table writes use delete-then-insert (not delta) | Simpler; profile snapshots are tiny (~10 rows); transaction makes it atomic |
| 9 | Message read uses N+1 (one query per level) instead of a single JOIN | Chat-load is rare and SQLite in-process queries are microseconds; optimize later if profiling demands it |
| 10 | No data migration from JSON files | User confirmed JSON stores are empty in development; a migration script can be added later if needed |
| 11 | No FE changes | Public store APIs are preserved; routes / dispatch / FE see no difference |
| 12 | Single DB file, not per-domain | Cross-domain queries (e.g., profile → context) become possible with JOINs in the future; transactional consistency across domains is automatic |
