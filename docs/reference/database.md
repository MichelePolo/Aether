# Database

How persistence works: SQLite file layout, append-only migrations, FTS, cascade rules. When to read it: you're changing schema or debugging data.

## File layout

Aether uses `better-sqlite3` (synchronous), with a single database file at `${AETHER_DATA_DIR}/aether.sqlite` (default `AETHER_DATA_DIR` is `./data` — see [`configuration.md`](configuration.md)).

## Migrations

Schema evolves via append-only, numbered SQL files in [`server/db/migrations/`](../../server/db/migrations/), applied in numeric order on boot by `applyMigrations()` (`../../server/db/migrate.ts`). Each migration file runs inside its own transaction; on failure the transaction rolls back and that version is not recorded. Applied versions are tracked in the `_migrations` table (created with `CREATE TABLE IF NOT EXISTS` before any product migration runs).

**Hard rule: add a new migration file to change schema — never edit an existing one.** An edited file won't re-run on databases where its version is already recorded in `_migrations`, so existing installs silently miss the change.

Current migration files (as of this writing):

| File | Purpose |
| --- | --- |
| `001_initial.sql` | Initial schema |
| `002_fts.sql` | Full-text search over messages (see below) |
| `003_provider_keys.sql` | Provider key storage |
| `004_message_usage.sql` | Per-message token usage |
| `005_message_attachments.sql` | Per-message attachments (see below) |
| `006_builtin_mcp_state.sql` | Built-in MCP tool state |
| `007_breakpoint_policy.sql` | Tool-call breakpoint/approval policy |
| `008_tool_policy_category.sql` | Tool policy categorization |
| `009_workspaces.sql` | Workspaces |
| `010_ollama_endpoints.sql` | Ollama endpoint registration |
| `011_swarms.sql` | Swarm orchestration |
| `012_builtin_git.sql` | Built-in git tool |
| `013_skill_enabled.sql` | Skill enable/disable state |
| `014_schedules.sql` | Scheduled/cron jobs |
| `015_skill_state.sql` | Additional skill state |
| `016_swarm_step_provider.sql` | Per-step provider selection for swarms |
| `017_swarm_workspace.sql` | Swarm-to-workspace linkage |
| `018_openai_compat_endpoints.sql` | OpenAI-compatible (vLLM) endpoint registration |
| `019_ollama_endpoints_headers.sql` | Custom auth headers for Ollama endpoints |

Run `ls server/db/migrations/` to get the current list — this table is a snapshot and will drift as new migrations are added.

## Full-text search

`messages_fts` is a SQLite FTS5 virtual table (`content`, `tokenize='unicode61'`) created in [`002_fts.sql`](../../server/db/migrations/002_fts.sql), backfilled from the `messages` table at creation time. It indexes message content for the search feature (`/api/search`, see [`api.md`](api.md)).

## Attachments

`messages_attachments` stores per-message file/image attachments with raw bytes in a `BLOB content` column, created in [`005_message_attachments.sql`](../../server/db/migrations/005_message_attachments.sql). Each row references its parent message via `message_id ... ON DELETE CASCADE`, so attachments are deleted automatically when the owning message is deleted.

## Cascade rules

Foreign keys are enabled (`PRAGMA foreign_keys = ON`), and cascading deletes/nulling are expressed per-column in the migrations that define them — e.g. `messages_attachments.message_id` uses `ON DELETE CASCADE` (above). Check `ON DELETE CASCADE` / `ON DELETE SET NULL` clauses in the relevant migration file (`001_initial.sql`, `009_workspaces.sql`, `011_swarms.sql`, `014_schedules.sql`) when tracing what happens to child rows on delete.
