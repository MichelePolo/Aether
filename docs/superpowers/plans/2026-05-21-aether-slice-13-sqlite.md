# Aether Slice 13 — SQLite Persistence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the four JSON-file backed stores (`context.json`, `sessions.json`, `profiles.json`, `subagents.json`) with a single SQLite database (`aether.sqlite`). Fully relational schema (16 product tables). No data migration — the JSON stores are empty in development.

**Architecture:** A new `server/db/` module owns a single `better-sqlite3` `Database` handle. A migration runner applies `.sql` files in numeric order, tracked in `_migrations`. The four existing store classes get rewritten internals: constructor takes the `Database` handle instead of a file path; reads/writes use prepared statements; nested writes go through `db.transaction(...)`. Public Promise-based store APIs are preserved so routes, dispatch, and FE wiring are untouched.

**Tech Stack:** `better-sqlite3` (new dep, native module), `@types/better-sqlite3`. WAL journal mode, foreign keys ON, synchronous=NORMAL.

**Reference spec:** `docs/superpowers/specs/2026-05-21-aether-slice-13-sqlite-design.md`

**Branch:** `feat/slice-13-sqlite` (already checked out; spec already committed)

**Lavora con un solo branch dall'inizio alla fine; ogni Task termina con un commit verde su questo branch.**

---

## File structure (NEW unless marked MODIFY)

```
server/
  db/
    database.ts                                      # NEW: openDatabase() + pragmas
    migrate.ts                                       # NEW: applyMigrations()
    migrate.test.ts                                  # NEW
    migrations/
      001_initial.sql                                # NEW: full 16-table schema
  test/
    test-db.ts                                       # NEW: makeTestDb() helper
    db.integration.test.ts                           # NEW: cross-store flow
  domain/
    context/
      context.store.ts                               # REWRITE (preserves public API)
      context.store.test.ts                          # REWRITE (uses :memory: DB)
    history/
      history.store.ts                               # REWRITE
      history.store.test.ts                          # REWRITE
    profiles/
      profiles.store.ts                              # REWRITE
      profiles.store.test.ts                         # REWRITE
    subagents/
      subagents.store.ts                             # REWRITE
      subagents.store.test.ts                        # REWRITE
  routes/
    *.test.ts                                        # MODIFY where they construct stores
  domain/dispatch/dispatch.service.test.ts           # MODIFY (uses makeTestDb)
  index.ts                                           # MODIFY: open DB + run migrations + wire stores
package.json                                         # MODIFY: +better-sqlite3
```

---

## Phase A — Pre-flight

### Task A1: Verify branch + clean tree

- [ ] **Step 1: Run**

```bash
git rev-parse --abbrev-ref HEAD
git status --porcelain
```

Expected: branch `feat/slice-13-sqlite`; second command empty. No commit.

---

## Phase B — Install dependency

### Task B1: Install `better-sqlite3` + types

**Files:**
- Modify: `package.json`

`better-sqlite3` is a native module. `npm install` builds it via node-gyp; this takes 10-30 seconds on first install. No runtime config needed.

- [ ] **Step 1: Install runtime + type dep**

```bash
npm install better-sqlite3@latest
npm install --save-dev @types/better-sqlite3@latest
```

- [ ] **Step 2: Confirm the binding loads**

```bash
node -e "const Database = require('better-sqlite3'); const db = new Database(':memory:'); console.log(db.prepare('SELECT 1 AS one').get()); db.close();"
```

Expected output: `{ one: 1 }`. If it fails, run `npm rebuild better-sqlite3`.

- [ ] **Step 3: Lint + run server suite (no code yet — just confirm the dep didn't break anything)**

```bash
npm run lint
npx vitest run server
```

Expected: clean lint, all existing tests pass.

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore(slice-13): add better-sqlite3 dependency"
```

---

## Phase C — DB scaffolding (open, migrate, schema, test helper)

### Task C1: `openDatabase` + `applyMigrations` + initial schema + test helper

**Files:**
- Create: `server/db/database.ts`
- Create: `server/db/migrate.ts`
- Create: `server/db/migrate.test.ts`
- Create: `server/db/migrations/001_initial.sql`
- Create: `server/test/test-db.ts`

Five new files, all foundational. After this task, the rest of the slice has something to build on.

- [ ] **Step 1: Create `server/db/database.ts`**

```ts
import Database from 'better-sqlite3';

export type DatabaseHandle = Database.Database;

/**
 * Open a SQLite database file, apply Aether's standard pragmas, and return
 * the handle. Caller owns the lifecycle (must call .close() in tests).
 *
 * Pragmas:
 *  - journal_mode = WAL: concurrent reads + serialized writes via a write-ahead log
 *  - foreign_keys = ON:  SQLite ships with FK enforcement off by default
 *  - synchronous = NORMAL: durable under WAL; faster than FULL
 */
export function openDatabase(filePath: string): DatabaseHandle {
  const db = new Database(filePath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('synchronous = NORMAL');
  return db;
}
```

- [ ] **Step 2: Create `server/db/migrations/001_initial.sql`**

The full schema from the spec (Schema section). Single file. The migration runner splits on `;` boundaries and runs each statement via a prepared statement, all inside one transaction (see Step 3 for the runner).

```sql
-- Context (singleton + child tables)

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
  args TEXT,
  env TEXT,
  url TEXT,
  status TEXT NOT NULL
);

CREATE TABLE context_mcp_tool_policies (
  server_id TEXT NOT NULL REFERENCES context_mcp_servers(id) ON DELETE CASCADE,
  tool_name TEXT NOT NULL,
  auto_approve INTEGER NOT NULL,
  PRIMARY KEY (server_id, tool_name)
);

-- Sessions / messages / reasoning

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
  error TEXT,
  retryable INTEGER,
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
  args TEXT NOT NULL,
  result TEXT,
  error TEXT,
  duration_ms INTEGER NOT NULL,
  progress_note TEXT
);

-- Profiles

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

-- Sub-agents

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
  version TEXT NOT NULL,
  status TEXT NOT NULL,
  PRIMARY KEY (subagent_id, position)
);
```

Notes:
- `messages` includes `error` + `retryable` columns to round-trip the full `Message` shape from `server/domain/history/history.types.ts`.
- `subagent_tools` carries the full `Tool` columns (name, version, status). The `position` is both ordering and PK.
- The migration file uses ONLY statement-terminating semicolons (no semicolons inside string literals). The runner splits on `;` boundaries.

- [ ] **Step 3: Create `server/db/migrate.ts`**

The runner ensures `_migrations` exists, then for each unapplied file: splits the SQL on `;` into individual statements, runs each via `db.prepare(stmt).run()` inside a transaction, and records the version on success.

```ts
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { DatabaseHandle } from './database';

const MIGRATIONS_TABLE_DDL =
  'CREATE TABLE IF NOT EXISTS _migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)';

const FILE_RE = /^(\d+)_.+\.sql$/;

export interface MigrationResult {
  applied: number[];
}

function splitSqlStatements(sql: string): string[] {
  // Strip line comments (-- ...), then split on ';' boundaries and trim.
  // The migration files we author do not contain semicolons inside string
  // literals, so a naive split is safe and avoids pulling in a SQL parser.
  const cleaned = sql
    .split('\n')
    .map((line) => {
      const idx = line.indexOf('--');
      return idx === -1 ? line : line.slice(0, idx);
    })
    .join('\n');
  return cleaned
    .split(';')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/**
 * Apply all unapplied .sql files in `migrationsDir` to `db`, in numeric order.
 * Each file runs inside a transaction; on failure the transaction rolls back
 * and the version is NOT recorded.
 *
 * The `_migrations` table is created here (CREATE IF NOT EXISTS) before any
 * product migration runs, so migration 001 may assume it already exists.
 */
export function applyMigrations(db: DatabaseHandle, migrationsDir: string): MigrationResult {
  db.prepare(MIGRATIONS_TABLE_DDL).run();

  const allFiles = readdirSync(migrationsDir)
    .filter((f) => FILE_RE.test(f))
    .map((f) => {
      const match = FILE_RE.exec(f)!;
      return { version: Number(match[1]), file: f };
    })
    .sort((a, b) => a.version - b.version);

  const appliedRows = db
    .prepare('SELECT version FROM _migrations')
    .all() as { version: number }[];
  const appliedSet = new Set(appliedRows.map((r) => r.version));

  const newlyApplied: number[] = [];

  for (const { version, file } of allFiles) {
    if (appliedSet.has(version)) continue;
    const sql = readFileSync(join(migrationsDir, file), 'utf-8');
    const statements = splitSqlStatements(sql);
    const tx = db.transaction(() => {
      for (const stmt of statements) {
        db.prepare(stmt).run();
      }
      db.prepare('INSERT INTO _migrations (version, applied_at) VALUES (?, ?)').run(
        version,
        new Date().toISOString(),
      );
    });
    tx();
    newlyApplied.push(version);
  }

  return { applied: newlyApplied };
}
```

- [ ] **Step 4: Create `server/db/migrate.test.ts`**

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import Database from 'better-sqlite3';
import { applyMigrations } from './migrate';

let dir: string;
let db: ReturnType<typeof Database>;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'aether-migrate-'));
  db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
});

afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

function writeMigration(filename: string, sql: string): void {
  writeFileSync(join(dir, filename), sql);
}

describe('applyMigrations', () => {
  it('creates _migrations table and applies all files on empty DB', () => {
    writeMigration('001_a.sql', 'CREATE TABLE a (id INTEGER);');
    writeMigration('002_b.sql', 'CREATE TABLE b (id INTEGER);');

    const result = applyMigrations(db, dir);

    expect(result.applied).toEqual([1, 2]);
    const tables = (db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all() as { name: string }[]).map((r) => r.name);
    expect(tables).toContain('_migrations');
    expect(tables).toContain('a');
    expect(tables).toContain('b');
    const versions = (db.prepare('SELECT version FROM _migrations ORDER BY version').all() as { version: number }[]).map((r) => r.version);
    expect(versions).toEqual([1, 2]);
  });

  it('is idempotent: second run applies nothing', () => {
    writeMigration('001_a.sql', 'CREATE TABLE a (id INTEGER);');
    applyMigrations(db, dir);
    const second = applyMigrations(db, dir);
    expect(second.applied).toEqual([]);
  });

  it('rolls back a failing migration so its version is NOT recorded', () => {
    writeMigration('001_ok.sql', 'CREATE TABLE ok (id INTEGER);');
    writeMigration('002_bad.sql', 'CREATE TABLE bad (id INTEGER); INSERT INTO bad VALUES (1); SELECT broken_function();');

    expect(() => applyMigrations(db, dir)).toThrow();

    const versions = (db.prepare('SELECT version FROM _migrations ORDER BY version').all() as { version: number }[]).map((r) => r.version);
    expect(versions).toEqual([1]); // 001 applied; 002 rolled back
    const tables = (db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name = 'bad'").all() as unknown[]).length;
    expect(tables).toBe(0); // 002 created `bad` but transaction rolled back
  });

  it('orders migrations numerically, not lexically', () => {
    writeMigration('002_b.sql', 'CREATE TABLE b (id INTEGER);');
    writeMigration('010_j.sql', 'CREATE TABLE j (id INTEGER);');
    writeMigration('001_a.sql', 'CREATE TABLE a (id INTEGER);');

    const result = applyMigrations(db, dir);

    expect(result.applied).toEqual([1, 2, 10]);
  });

  it('ignores files that do not match NNN_*.sql', () => {
    writeMigration('001_a.sql', 'CREATE TABLE a (id INTEGER);');
    writeMigration('README.md', 'not a migration');
    writeMigration('rollback.sql', 'not a migration');

    const result = applyMigrations(db, dir);
    expect(result.applied).toEqual([1]);
  });

  it('handles multi-statement files (the real schema is ~16 CREATE TABLEs)', () => {
    writeMigration(
      '001_multi.sql',
      `
      CREATE TABLE a (id INTEGER);
      CREATE TABLE b (id INTEGER);
      CREATE INDEX idx_b_id ON b(id);
      `,
    );
    const result = applyMigrations(db, dir);
    expect(result.applied).toEqual([1]);
    const tables = (db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name IN ('a','b')").all() as unknown[]).length;
    expect(tables).toBe(2);
  });
});
```

- [ ] **Step 5: Create `server/test/test-db.ts`**

```ts
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { applyMigrations } from '@/server/db/migrate';
import type { DatabaseHandle } from '@/server/db/database';

const MIGRATIONS_DIR = join(__dirname, '..', 'db', 'migrations');

/**
 * Open an in-memory SQLite database with Aether's pragmas + full schema
 * applied. Each call returns a fresh, isolated handle. Caller must .close().
 */
export function makeTestDb(): DatabaseHandle {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  applyMigrations(db, MIGRATIONS_DIR);
  return db;
}
```

- [ ] **Step 6: Run the migrate tests, full server suite, lint**

```bash
npx vitest run server/db/migrate.test.ts
npx vitest run server
npm run lint
```

Expected: migrate tests 6/6 pass. Full server suite passes (existing 429 + the 6 new).

- [ ] **Step 7: Commit**

```bash
git add server/db/database.ts server/db/migrate.ts server/db/migrate.test.ts server/db/migrations/001_initial.sql server/test/test-db.ts
git commit -m "feat(slice-13): db scaffolding — openDatabase, migration runner, initial schema, test helper"
```

---

## Phase D — ContextStore SQLite rewrite

### Task D1: Rewrite `ContextStore` against SQLite + update tests

**Files:**
- Modify: `server/domain/context/context.store.ts`
- Modify: `server/domain/context/context.store.test.ts`

The public API is preserved exactly: same method names, same return types (still Promise-based). Internals switch from `JsonStore<AetherContext>` to prepared statements against the context tables.

`AetherContext` shape recap:
```ts
{
  systemInstruction: string,
  skills: string[],
  tools: Tool[],          // Tool = { id, name, version, status }
  mcpServers: McpServerConfig[],  // includes toolPolicies record
}
```

The constructor takes `db: DatabaseHandle` now. `init()` is replaced by an `INSERT OR IGNORE INTO context (id, system_instruction) VALUES (1, '<default>')` seed call that runs once per construction (idempotent).

- [ ] **Step 1: Read the existing test file**

Open `server/domain/context/context.store.test.ts` to see the current assertions. They all use `mkdtemp` + a file path. We'll swap setup but preserve every `expect(...)` line so we don't lose behavioral coverage.

- [ ] **Step 2: Rewrite `server/domain/context/context.store.ts`**

```ts
import { randomUUID } from 'node:crypto';
import { ValidationError, NotFoundError } from '@/server/lib/errors';
import {
  AetherContextSchema,
  ToolSchema,
  McpServerSchema,
} from './context.schema';
import type { AetherContext, Tool, McpServerConfig, McpToolPolicy } from './context.types';
import type { DatabaseHandle } from '@/server/db/database';

export const defaultContext: AetherContext = {
  systemInstruction:
    'You are Aether, an advanced AI development agent. You provide transparent reasoning and can dispatch sub-agents.',
  skills: [],
  tools: [],
  mcpServers: [],
};

type ServerRow = {
  id: string;
  name: string;
  transport: 'stdio' | 'mock' | 'http';
  command: string | null;
  args: string | null;
  env: string | null;
  url: string | null;
  status: string;
};

type PolicyRow = {
  server_id: string;
  tool_name: string;
  auto_approve: number;
};

export class ContextStore {
  constructor(private readonly db: DatabaseHandle) {
    this.db
      .prepare('INSERT OR IGNORE INTO context (id, system_instruction) VALUES (1, ?)')
      .run(defaultContext.systemInstruction);
  }

  read(): Promise<AetherContext> {
    return Promise.resolve(this.readSync());
  }

  async patch(partial: Partial<AetherContext>): Promise<AetherContext> {
    return this.writeAll({ ...this.readSync(), ...partial });
  }

  async bulkOverwrite(next: AetherContext): Promise<AetherContext> {
    const parsed = AetherContextSchema.safeParse(next);
    if (!parsed.success) throw new ValidationError('Invalid context payload', parsed.error);
    return this.writeAll(parsed.data);
  }

  async addSkill(name: string): Promise<void> {
    const trimmed = name.trim();
    if (!trimmed) throw new ValidationError('Skill name cannot be empty');
    const cur = this.readSync();
    this.writeAll({ ...cur, skills: [...cur.skills, trimmed] });
  }

  async updateSkillAt(index: number, value: string): Promise<void> {
    const trimmed = value.trim();
    if (!trimmed) throw new ValidationError('Skill name cannot be empty');
    const cur = this.readSync();
    if (index < 0 || index >= cur.skills.length) {
      throw new NotFoundError(`skill index ${index}`);
    }
    const skills = [...cur.skills];
    skills[index] = trimmed;
    this.writeAll({ ...cur, skills });
  }

  async removeSkillAt(index: number): Promise<void> {
    const cur = this.readSync();
    if (index < 0 || index >= cur.skills.length) {
      throw new NotFoundError(`skill index ${index}`);
    }
    this.writeAll({ ...cur, skills: cur.skills.filter((_, i) => i !== index) });
  }

  async addTool(input: Omit<Tool, 'id'>): Promise<Tool> {
    const parsed = ToolSchema.omit({ id: true }).safeParse(input);
    if (!parsed.success) throw new ValidationError('Invalid tool', parsed.error);
    const tool: Tool = { ...parsed.data, id: randomUUID() };
    const cur = this.readSync();
    this.writeAll({ ...cur, tools: [...cur.tools, tool] });
    return tool;
  }

  async updateTool(id: string, patch: Partial<Omit<Tool, 'id'>>): Promise<void> {
    const cur = this.readSync();
    const idx = cur.tools.findIndex((t) => t.id === id);
    if (idx === -1) throw new NotFoundError(`tool ${id}`);
    const merged = { ...cur.tools[idx], ...patch };
    const validated = ToolSchema.safeParse(merged);
    if (!validated.success) throw new ValidationError('Invalid tool patch', validated.error);
    const tools = [...cur.tools];
    tools[idx] = validated.data;
    this.writeAll({ ...cur, tools });
  }

  async removeTool(id: string): Promise<void> {
    const cur = this.readSync();
    if (!cur.tools.some((t) => t.id === id)) throw new NotFoundError(`tool ${id}`);
    this.writeAll({ ...cur, tools: cur.tools.filter((t) => t.id !== id) });
  }

  async addMcpServer(input: Omit<McpServerConfig, 'id'>): Promise<McpServerConfig> {
    const parsed = McpServerSchema.omit({ id: true }).safeParse(input);
    if (!parsed.success) throw new ValidationError('Invalid MCP server', parsed.error);
    const srv: McpServerConfig = { ...parsed.data, id: randomUUID() };
    const cur = this.readSync();
    this.writeAll({ ...cur, mcpServers: [...cur.mcpServers, srv] });
    return srv;
  }

  async removeMcpServer(id: string): Promise<void> {
    const cur = this.readSync();
    if (!cur.mcpServers.some((s) => s.id === id)) throw new NotFoundError(`mcp server ${id}`);
    this.writeAll({ ...cur, mcpServers: cur.mcpServers.filter((s) => s.id !== id) });
  }

  // ---- private synchronous helpers ----

  private readSync(): AetherContext {
    const ctx = this.db
      .prepare('SELECT system_instruction AS systemInstruction FROM context WHERE id = 1')
      .get() as { systemInstruction: string } | undefined;
    const systemInstruction = ctx?.systemInstruction ?? defaultContext.systemInstruction;

    const skills = (
      this.db
        .prepare('SELECT name FROM context_skills ORDER BY position')
        .all() as { name: string }[]
    ).map((r) => r.name);

    const tools = (
      this.db
        .prepare('SELECT id, name, version, status FROM context_tools ORDER BY position')
        .all() as Tool[]
    );

    const serverRows = this.db
      .prepare(
        'SELECT id, name, transport, command, args, env, url, status FROM context_mcp_servers ORDER BY rowid',
      )
      .all() as ServerRow[];

    const policyRows = this.db
      .prepare('SELECT server_id, tool_name, auto_approve FROM context_mcp_tool_policies')
      .all() as PolicyRow[];

    const policiesByServer = new Map<string, Record<string, McpToolPolicy>>();
    for (const p of policyRows) {
      const map = policiesByServer.get(p.server_id) ?? {};
      map[p.tool_name] = { autoApprove: p.auto_approve === 1 };
      policiesByServer.set(p.server_id, map);
    }

    const mcpServers: McpServerConfig[] = serverRows.map((r) => {
      const policies = policiesByServer.get(r.id);
      const base: McpServerConfig = {
        id: r.id,
        name: r.name,
        transport: r.transport,
        status: r.status as McpServerConfig['status'],
      };
      if (r.command !== null) base.command = r.command;
      if (r.args !== null) base.args = JSON.parse(r.args) as string[];
      if (r.env !== null) base.env = JSON.parse(r.env) as Record<string, string>;
      if (r.url !== null) base.url = r.url;
      if (policies) base.toolPolicies = policies;
      return base;
    });

    return { systemInstruction, skills, tools, mcpServers };
  }

  private writeAll(next: AetherContext): AetherContext {
    const tx = this.db.transaction(() => {
      this.db
        .prepare('UPDATE context SET system_instruction = ? WHERE id = 1')
        .run(next.systemInstruction);

      this.db.prepare('DELETE FROM context_skills').run();
      const insertSkill = this.db.prepare(
        'INSERT INTO context_skills (position, name) VALUES (?, ?)',
      );
      next.skills.forEach((s, i) => insertSkill.run(i, s));

      this.db.prepare('DELETE FROM context_tools').run();
      const insertTool = this.db.prepare(
        'INSERT INTO context_tools (id, name, version, status, position) VALUES (?, ?, ?, ?, ?)',
      );
      next.tools.forEach((t, i) => insertTool.run(t.id, t.name, t.version, t.status, i));

      this.db.prepare('DELETE FROM context_mcp_servers').run();
      const insertServer = this.db.prepare(
        'INSERT INTO context_mcp_servers (id, name, transport, command, args, env, url, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      );
      const insertPolicy = this.db.prepare(
        'INSERT INTO context_mcp_tool_policies (server_id, tool_name, auto_approve) VALUES (?, ?, ?)',
      );
      for (const s of next.mcpServers) {
        insertServer.run(
          s.id,
          s.name,
          s.transport ?? 'stdio',
          s.command ?? null,
          s.args ? JSON.stringify(s.args) : null,
          s.env ? JSON.stringify(s.env) : null,
          s.url ?? null,
          s.status,
        );
        if (s.toolPolicies) {
          for (const [toolName, policy] of Object.entries(s.toolPolicies)) {
            insertPolicy.run(s.id, toolName, policy.autoApprove ? 1 : 0);
          }
        }
      }
    });
    tx();
    return this.readSync();
  }
}
```

Notes for the implementer:
- `McpServerConfig['transport']` is optional in the type; SQLite requires NOT NULL. Default to `'stdio'` (matches the loose schema's preprocess).
- `args`/`env` go through `JSON.stringify` on write and `JSON.parse` on read. `null` round-trips to the field being absent in the object (matches the optional field shape).

- [ ] **Step 3: Rewrite `server/domain/context/context.store.test.ts`**

Replace the file with the in-memory DB setup. Preserve every assertion from the original.

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ContextStore, defaultContext } from './context.store';
import { makeTestDb } from '@/server/test/test-db';
import type { DatabaseHandle } from '@/server/db/database';

let db: DatabaseHandle;
let store: ContextStore;

beforeEach(() => {
  db = makeTestDb();
  store = new ContextStore(db);
});

afterEach(() => {
  db.close();
});

describe('ContextStore', () => {
  it('read() returns the default context on a fresh DB', async () => {
    const ctx = await store.read();
    expect(ctx).toEqual(defaultContext);
  });

  it('patch() merges and persists', async () => {
    await store.patch({ systemInstruction: 'You are Aether v2' });
    const ctx = await store.read();
    expect(ctx.systemInstruction).toBe('You are Aether v2');
    expect(ctx.skills).toEqual([]);
  });

  it('bulkOverwrite() replaces everything atomically', async () => {
    await store.bulkOverwrite({
      systemInstruction: 'new',
      skills: ['a', 'b'],
      tools: [{ id: 't1', name: 'X', version: '1.0', status: 'online' }],
      mcpServers: [],
    });
    const ctx = await store.read();
    expect(ctx.systemInstruction).toBe('new');
    expect(ctx.skills).toEqual(['a', 'b']);
    expect(ctx.tools).toEqual([{ id: 't1', name: 'X', version: '1.0', status: 'online' }]);
  });

  it('bulkOverwrite() rejects invalid payloads', async () => {
    await expect(
      store.bulkOverwrite({
        systemInstruction: 'x',
        skills: ['a'],
        tools: [{ id: 't1', name: 'X', version: '1', status: 'busy' as 'online' }],
        mcpServers: [],
      }),
    ).rejects.toThrow();
  });

  it('addSkill / updateSkillAt / removeSkillAt preserve order', async () => {
    await store.addSkill('one');
    await store.addSkill('two');
    await store.addSkill('three');
    await store.updateSkillAt(1, 'TWO');
    await store.removeSkillAt(0);
    const ctx = await store.read();
    expect(ctx.skills).toEqual(['TWO', 'three']);
  });

  it('addSkill rejects empty / whitespace', async () => {
    await expect(store.addSkill('   ')).rejects.toThrow();
  });

  it('updateSkillAt rejects out-of-range index', async () => {
    await expect(store.updateSkillAt(0, 'x')).rejects.toThrow();
  });

  it('addTool returns the new tool with a generated id', async () => {
    const t = await store.addTool({ name: 'Google', version: '1', status: 'online' });
    expect(t.id).toBeTruthy();
    expect(t.name).toBe('Google');
    const ctx = await store.read();
    expect(ctx.tools).toHaveLength(1);
    expect(ctx.tools[0].id).toBe(t.id);
  });

  it('updateTool merges patch + validates', async () => {
    const t = await store.addTool({ name: 'A', version: '1', status: 'online' });
    await store.updateTool(t.id, { version: '2', status: 'offline' });
    const ctx = await store.read();
    expect(ctx.tools[0]).toEqual({ id: t.id, name: 'A', version: '2', status: 'offline' });
  });

  it('removeTool removes the right entry; missing id throws', async () => {
    const t = await store.addTool({ name: 'A', version: '1', status: 'online' });
    await store.removeTool(t.id);
    expect((await store.read()).tools).toEqual([]);
    await expect(store.removeTool('nope')).rejects.toThrow();
  });

  it('addMcpServer round-trips command/args/env and stored on read', async () => {
    const srv = await store.addMcpServer({
      name: 'fs',
      transport: 'stdio',
      command: 'npx',
      args: ['@modelcontextprotocol/server-filesystem', '/tmp'],
      env: { FOO: 'bar' },
      status: 'offline',
    });
    const ctx = await store.read();
    expect(ctx.mcpServers).toHaveLength(1);
    expect(ctx.mcpServers[0]).toEqual({
      id: srv.id,
      name: 'fs',
      transport: 'stdio',
      command: 'npx',
      args: ['@modelcontextprotocol/server-filesystem', '/tmp'],
      env: { FOO: 'bar' },
      status: 'offline',
    });
  });

  it('addMcpServer with toolPolicies round-trips', async () => {
    await store.bulkOverwrite({
      systemInstruction: '',
      skills: [],
      tools: [],
      mcpServers: [{
        id: 'M1',
        name: 'mock',
        transport: 'mock',
        status: 'offline',
        toolPolicies: { echo: { autoApprove: true }, fail: { autoApprove: false } },
      }],
    });
    const ctx = await store.read();
    expect(ctx.mcpServers[0].toolPolicies).toEqual({
      echo: { autoApprove: true },
      fail: { autoApprove: false },
    });
  });

  it('removeMcpServer cascades to tool policies', async () => {
    await store.bulkOverwrite({
      systemInstruction: '',
      skills: [],
      tools: [],
      mcpServers: [{
        id: 'M1',
        name: 'mock',
        transport: 'mock',
        status: 'offline',
        toolPolicies: { echo: { autoApprove: true } },
      }],
    });
    await store.removeMcpServer('M1');
    const policies = db.prepare('SELECT COUNT(*) AS n FROM context_mcp_tool_policies').get() as { n: number };
    expect(policies.n).toBe(0);
  });
});
```

- [ ] **Step 4: Run tests, lint**

```bash
npx vitest run server/domain/context/context.store.test.ts
npm run lint
```

Expected: all pass.

- [ ] **Step 5: Run full server suite (other tests that instantiate ContextStore may break)**

```bash
npx vitest run server
```

If a test in `routes/context.routes.test.ts` (or similar) constructs `new ContextStore(filePath)` directly, it'll fail with a type error. Fix it inline by using `makeTestDb()` + `new ContextStore(db)` instead.

- [ ] **Step 6: Commit**

```bash
git add server/domain/context/context.store.ts server/domain/context/context.store.test.ts server/routes/context.routes.test.ts
git commit -m "feat(slice-13): ContextStore SQLite-backed (preserves public API)"
```

(If the routes test file didn't need changes, drop it from the `git add` line.)

---

## Phase E — HistoryStore SQLite rewrite

### Task E1: Rewrite `HistoryStore` against SQLite + update tests

**Files:**
- Modify: `server/domain/history/history.store.ts`
- Modify: `server/domain/history/history.store.test.ts`
- Possibly: `server/routes/history.routes.test.ts` (and other downstream tests that construct `HistoryStore`)

This is the biggest store rewrite: nested writes (session → messages → reasoning_steps → tool_call_traces) and a custom title-on-first-user-message rule. The legacy V1 → V2 migration in `_doMigrate` goes away — no JSON file to migrate.

`Message` shape recap (from `server/domain/history/history.types.ts`):
```ts
{ id, role, text, timestamp, model?, interrupted?, error?, retryable?, reasoningSteps? }
```

`ReasoningStep` shape (from `server/domain/reasoning/reasoning.types.ts`):
```ts
{ id, type, title, content, tokens?, durationMs?, subAgent?, toolCall?, timestamp }
```

`ToolCallTrace`:
```ts
{ id, qualifiedName, args, result?, error?, durationMs, progressNote? }
```

`SessionMeta.updatedAt` rule: `messages.at(-1)?.timestamp ?? createdAt`. We materialize this in `sessions.updated_at` and update it on every `append()`.

- [ ] **Step 1: Rewrite `server/domain/history/history.store.ts`**

```ts
import { randomUUID } from 'node:crypto';
import { ValidationError, NotFoundError } from '@/server/lib/errors';
import { computeTitle } from './title';
import type { Message, SessionMeta, SessionRecord } from './history.types';
import type { ReasoningStep, ToolCallTrace } from '@/server/domain/reasoning/reasoning.types';
import type { DatabaseHandle } from '@/server/db/database';

const TITLE_MAX = 200;

type SessionRow = {
  id: string;
  title: string;
  created_at: number;
  updated_at: number;
  provider_name: string | null;
};

type MessageRow = {
  id: string;
  session_id: string;
  role: 'user' | 'model';
  content: string;
  model: string | null;
  interrupted: number;
  error: string | null;
  retryable: number | null;
  created_at: number;
  position: number;
};

type ReasoningRow = {
  id: string;
  message_id: string;
  type: string;
  title: string;
  content: string;
  tokens: number | null;
  duration_ms: number | null;
  sub_agent: string | null;
  timestamp: number;
  position: number;
};

type ToolCallRow = {
  id: string;
  reasoning_step_id: string;
  qualified_name: string;
  args: string;
  result: string | null;
  error: string | null;
  duration_ms: number;
  progress_note: string | null;
};

export class HistoryStore {
  constructor(private readonly db: DatabaseHandle) {}

  async listSessions(): Promise<SessionMeta[]> {
    const rows = this.db
      .prepare(
        'SELECT id, title, created_at, updated_at, provider_name FROM sessions ORDER BY updated_at DESC',
      )
      .all() as SessionRow[];
    return rows.map((r) => ({
      id: r.id,
      title: r.title,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
      providerName: r.provider_name ?? undefined,
    }));
  }

  async read(sessionId: string): Promise<Message[] | null> {
    const session = this.db
      .prepare('SELECT id FROM sessions WHERE id = ?')
      .get(sessionId) as { id: string } | undefined;
    if (!session) return null;
    return this.readMessages(sessionId);
  }

  async createEmpty(opts?: { providerName?: string }): Promise<SessionMeta> {
    const id = randomUUID();
    const now = Date.now();
    this.db
      .prepare(
        'INSERT INTO sessions (id, title, created_at, updated_at, provider_name) VALUES (?, ?, ?, ?, ?)',
      )
      .run(id, '', now, now, opts?.providerName ?? null);
    return { id, title: '', createdAt: now, updatedAt: now, providerName: opts?.providerName };
  }

  async readRecord(id: string): Promise<SessionRecord | null> {
    const row = this.db
      .prepare(
        'SELECT id, title, created_at, updated_at, provider_name FROM sessions WHERE id = ?',
      )
      .get(id) as SessionRow | undefined;
    if (!row) return null;
    const messages = this.readMessages(id);
    return {
      title: row.title,
      createdAt: row.created_at,
      providerName: row.provider_name ?? undefined,
      messages,
    };
  }

  async setProviderName(id: string, providerName: string): Promise<void> {
    const info = this.db
      .prepare('UPDATE sessions SET provider_name = ? WHERE id = ?')
      .run(providerName, id);
    if (info.changes === 0) throw new NotFoundError(`session ${id}`);
  }

  async append(sessionId: string, message: Message): Promise<void> {
    const tx = this.db.transaction(() => {
      const session = this.db
        .prepare('SELECT title FROM sessions WHERE id = ?')
        .get(sessionId) as { title: string } | undefined;
      if (!session) throw new NotFoundError(`session ${sessionId}`);

      const position =
        (this.db
          .prepare('SELECT COALESCE(MAX(position), -1) + 1 AS p FROM messages WHERE session_id = ?')
          .get(sessionId) as { p: number }).p;

      const isFirstUser = position === 0 && message.role === 'user' && session.title === '';
      const nextTitle = isFirstUser ? computeTitle(message.text) : session.title;

      this.db
        .prepare(
          'INSERT INTO messages (id, session_id, role, content, model, interrupted, error, retryable, created_at, position) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        )
        .run(
          message.id,
          sessionId,
          message.role,
          message.text,
          message.model ?? null,
          message.interrupted ? 1 : 0,
          message.error ?? null,
          message.retryable === undefined ? null : (message.retryable ? 1 : 0),
          message.timestamp,
          position,
        );

      this.insertReasoningSteps(message.id, message.reasoningSteps ?? []);

      this.db
        .prepare('UPDATE sessions SET title = ?, updated_at = ? WHERE id = ?')
        .run(nextTitle, message.timestamp, sessionId);
    });
    tx();
  }

  async rename(sessionId: string, title: string): Promise<SessionMeta> {
    if (!title.trim()) throw new ValidationError('Title cannot be empty');
    if (title.length > TITLE_MAX) throw new ValidationError(`Title too long (max ${TITLE_MAX})`);
    const info = this.db
      .prepare('UPDATE sessions SET title = ? WHERE id = ?')
      .run(title, sessionId);
    if (info.changes === 0) throw new NotFoundError(`session ${sessionId}`);
    const row = this.db
      .prepare(
        'SELECT id, title, created_at, updated_at, provider_name FROM sessions WHERE id = ?',
      )
      .get(sessionId) as SessionRow;
    return {
      id: row.id,
      title: row.title,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      providerName: row.provider_name ?? undefined,
    };
  }

  async delete(sessionId: string): Promise<void> {
    const info = this.db.prepare('DELETE FROM sessions WHERE id = ?').run(sessionId);
    if (info.changes === 0) throw new NotFoundError(`session ${sessionId}`);
  }

  // ---- private helpers ----

  private readMessages(sessionId: string): Message[] {
    const msgRows = this.db
      .prepare(
        'SELECT id, session_id, role, content, model, interrupted, error, retryable, created_at, position FROM messages WHERE session_id = ? ORDER BY position',
      )
      .all(sessionId) as MessageRow[];

    return msgRows.map((m) => {
      const msg: Message = {
        id: m.id,
        role: m.role,
        text: m.content,
        timestamp: m.created_at,
      };
      if (m.model !== null) msg.model = m.model;
      if (m.interrupted === 1) msg.interrupted = true;
      if (m.error !== null) msg.error = m.error;
      if (m.retryable !== null) msg.retryable = m.retryable === 1;
      const steps = this.readReasoningSteps(m.id);
      if (steps.length > 0) msg.reasoningSteps = steps;
      return msg;
    });
  }

  private readReasoningSteps(messageId: string): ReasoningStep[] {
    const stepRows = this.db
      .prepare(
        'SELECT id, message_id, type, title, content, tokens, duration_ms, sub_agent, timestamp, position FROM reasoning_steps WHERE message_id = ? ORDER BY position',
      )
      .all(messageId) as ReasoningRow[];

    return stepRows.map((s) => {
      const step: ReasoningStep = {
        id: s.id,
        type: s.type as ReasoningStep['type'],
        title: s.title,
        content: s.content,
        timestamp: s.timestamp,
      };
      if (s.tokens !== null) step.tokens = s.tokens;
      if (s.duration_ms !== null) step.durationMs = s.duration_ms;
      if (s.sub_agent !== null) step.subAgent = s.sub_agent;
      if (s.type === 'tool_call') {
        const trace = this.readToolCallTrace(s.id);
        if (trace) step.toolCall = trace;
      }
      return step;
    });
  }

  private readToolCallTrace(reasoningStepId: string): ToolCallTrace | null {
    const row = this.db
      .prepare(
        'SELECT id, reasoning_step_id, qualified_name, args, result, error, duration_ms, progress_note FROM tool_call_traces WHERE reasoning_step_id = ?',
      )
      .get(reasoningStepId) as ToolCallRow | undefined;
    if (!row) return null;
    const trace: ToolCallTrace = {
      id: row.id,
      qualifiedName: row.qualified_name,
      args: JSON.parse(row.args) as Record<string, unknown>,
      durationMs: row.duration_ms,
    };
    if (row.result !== null) trace.result = JSON.parse(row.result);
    if (row.error !== null) trace.error = row.error;
    if (row.progress_note !== null) trace.progressNote = row.progress_note;
    return trace;
  }

  private insertReasoningSteps(messageId: string, steps: ReasoningStep[]): void {
    const insertStep = this.db.prepare(
      'INSERT INTO reasoning_steps (id, message_id, type, title, content, tokens, duration_ms, sub_agent, timestamp, position) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    );
    const insertTrace = this.db.prepare(
      'INSERT INTO tool_call_traces (id, reasoning_step_id, qualified_name, args, result, error, duration_ms, progress_note) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    );

    steps.forEach((step, i) => {
      insertStep.run(
        step.id,
        messageId,
        step.type,
        step.title,
        step.content,
        step.tokens ?? null,
        step.durationMs ?? null,
        step.subAgent ?? null,
        step.timestamp,
        i,
      );
      if (step.type === 'tool_call' && step.toolCall) {
        const tc = step.toolCall;
        insertTrace.run(
          tc.id,
          step.id,
          tc.qualifiedName,
          JSON.stringify(tc.args),
          tc.result === undefined ? null : JSON.stringify(tc.result),
          tc.error ?? null,
          tc.durationMs,
          tc.progressNote ?? null,
        );
      }
    });
  }
}
```

- [ ] **Step 2: Rewrite `server/domain/history/history.store.test.ts`**

Read the existing file first. Replace setup with `makeTestDb()` + `new HistoryStore(db)`. Preserve every assertion. The `_doMigrate` test cases (if any) get DELETED — the legacy V1 migration path no longer exists.

Use the new test cases below; they cover the same behaviors as the original suite plus a few additions for the relational schema (cascade deletes, optional Message fields round-trip).

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { HistoryStore } from './history.store';
import { makeTestDb } from '@/server/test/test-db';
import type { DatabaseHandle } from '@/server/db/database';
import type { Message } from './history.types';

let db: DatabaseHandle;
let store: HistoryStore;

beforeEach(() => {
  db = makeTestDb();
  store = new HistoryStore(db);
});

afterEach(() => {
  db.close();
});

describe('HistoryStore', () => {
  it('listSessions() returns [] on a fresh DB', async () => {
    expect(await store.listSessions()).toEqual([]);
  });

  it('createEmpty() returns a session with empty title and matching createdAt/updatedAt', async () => {
    const s = await store.createEmpty();
    expect(s.title).toBe('');
    expect(s.createdAt).toBe(s.updatedAt);
    expect(s.id).toBeTruthy();
  });

  it('append() infers title from the first user message', async () => {
    const s = await store.createEmpty();
    const msg: Message = { id: 'm1', role: 'user', text: 'Hello world this is the prompt', timestamp: Date.now() };
    await store.append(s.id, msg);
    const list = await store.listSessions();
    expect(list[0].title).toBeTruthy();
    expect(list[0].title).toContain('Hello');
  });

  it('append() preserves an explicitly-set title', async () => {
    const s = await store.createEmpty();
    await store.rename(s.id, 'My session');
    await store.append(s.id, { id: 'm1', role: 'user', text: 'q', timestamp: Date.now() });
    const list = await store.listSessions();
    expect(list[0].title).toBe('My session');
  });

  it('append() updates updatedAt to the message timestamp', async () => {
    const s = await store.createEmpty();
    const later = s.createdAt + 5000;
    await store.append(s.id, { id: 'm1', role: 'user', text: 'q', timestamp: later });
    const list = await store.listSessions();
    expect(list[0].updatedAt).toBe(later);
  });

  it('append() round-trips reasoningSteps + tool_call traces', async () => {
    const s = await store.createEmpty();
    const msg: Message = {
      id: 'm1',
      role: 'model',
      text: 'reply',
      timestamp: Date.now(),
      reasoningSteps: [
        {
          id: 'r1',
          type: 'context_fetch',
          title: 'context',
          content: 'loaded',
          tokens: 100,
          durationMs: 12,
          timestamp: Date.now(),
        },
        {
          id: 'r2',
          type: 'tool_call',
          title: 'Tool: mock.echo',
          content: 'used mock.echo',
          durationMs: 5,
          timestamp: Date.now(),
          toolCall: {
            id: 'TC1',
            qualifiedName: 'mock.echo',
            args: { message: 'hi' },
            result: { message: 'hi' },
            durationMs: 5,
            progressNote: '1/1',
          },
        },
      ],
    };
    await store.append(s.id, msg);
    const messages = await store.read(s.id);
    expect(messages).toHaveLength(1);
    const m = messages![0];
    expect(m.reasoningSteps).toHaveLength(2);
    expect(m.reasoningSteps![0].tokens).toBe(100);
    expect(m.reasoningSteps![1].toolCall).toEqual({
      id: 'TC1',
      qualifiedName: 'mock.echo',
      args: { message: 'hi' },
      result: { message: 'hi' },
      durationMs: 5,
      progressNote: '1/1',
    });
  });

  it('append() round-trips optional Message fields (model, interrupted, error, retryable)', async () => {
    const s = await store.createEmpty();
    await store.append(s.id, {
      id: 'm1',
      role: 'model',
      text: '',
      timestamp: Date.now(),
      model: 'gpt-5',
      interrupted: true,
      error: 'boom',
      retryable: false,
    });
    const messages = await store.read(s.id);
    expect(messages![0]).toMatchObject({
      model: 'gpt-5',
      interrupted: true,
      error: 'boom',
      retryable: false,
    });
  });

  it('read() returns null for unknown session', async () => {
    expect(await store.read('nope')).toBeNull();
  });

  it('setProviderName() updates the column; missing id throws', async () => {
    const s = await store.createEmpty();
    await store.setProviderName(s.id, 'openai:gpt-5');
    const list = await store.listSessions();
    expect(list[0].providerName).toBe('openai:gpt-5');
    await expect(store.setProviderName('nope', 'x')).rejects.toThrow();
  });

  it('rename() validates input', async () => {
    const s = await store.createEmpty();
    await expect(store.rename(s.id, '   ')).rejects.toThrow();
    await expect(store.rename(s.id, 'x'.repeat(201))).rejects.toThrow();
    await expect(store.rename('nope', 'title')).rejects.toThrow();
  });

  it('delete() cascades to messages, reasoning_steps, tool_call_traces', async () => {
    const s = await store.createEmpty();
    await store.append(s.id, {
      id: 'm1',
      role: 'user',
      text: 'q',
      timestamp: Date.now(),
      reasoningSteps: [{
        id: 'r1',
        type: 'tool_call',
        title: 'T',
        content: '',
        durationMs: 1,
        timestamp: Date.now(),
        toolCall: { id: 'TC1', qualifiedName: 'a.b', args: {}, durationMs: 1 },
      }],
    });
    await store.delete(s.id);
    expect((db.prepare('SELECT COUNT(*) AS n FROM messages').get() as { n: number }).n).toBe(0);
    expect((db.prepare('SELECT COUNT(*) AS n FROM reasoning_steps').get() as { n: number }).n).toBe(0);
    expect((db.prepare('SELECT COUNT(*) AS n FROM tool_call_traces').get() as { n: number }).n).toBe(0);
  });

  it('readRecord() returns the full record including messages', async () => {
    const s = await store.createEmpty({ providerName: 'fake:default' });
    await store.append(s.id, { id: 'm1', role: 'user', text: 'q', timestamp: Date.now() });
    const rec = await store.readRecord(s.id);
    expect(rec).not.toBeNull();
    expect(rec!.providerName).toBe('fake:default');
    expect(rec!.messages).toHaveLength(1);
  });

  it('listSessions() sorts by updated_at DESC', async () => {
    const a = await store.createEmpty();
    await new Promise((r) => setTimeout(r, 5));
    const b = await store.createEmpty();
    await store.append(b.id, { id: 'm1', role: 'user', text: 'q', timestamp: Date.now() + 1000 });
    const list = await store.listSessions();
    expect(list[0].id).toBe(b.id);
    expect(list[1].id).toBe(a.id);
  });
});
```

- [ ] **Step 3: Run tests + full server suite + lint**

```bash
npx vitest run server/domain/history/history.store.test.ts
npx vitest run server
npm run lint
```

Fix any route/dispatch tests that constructed `HistoryStore(filePath)` — switch to `new HistoryStore(makeTestDb())`.

- [ ] **Step 4: Commit**

```bash
git add server/domain/history/history.store.ts server/domain/history/history.store.test.ts <other touched test files>
git commit -m "feat(slice-13): HistoryStore SQLite-backed (nested messages/reasoning/tool-calls)"
```

Note: the legacy `migrateLegacyDefault` helper in `server/domain/history/history.migrate.ts` is now unused; delete it (and its test) within this commit if it exists:

```bash
git rm server/domain/history/history.migrate.ts server/domain/history/history.migrate.test.ts 2>/dev/null || true
```

(Only if those files exist. Skip if they don't.)

---

## Phase F — ProfilesStore SQLite rewrite

### Task F1: Rewrite `ProfilesStore` against SQLite + update tests

**Files:**
- Modify: `server/domain/profiles/profiles.store.ts`
- Modify: `server/domain/profiles/profiles.store.test.ts`

`ProfileRecord` contains an entire `AetherContext` snapshot. The 5 profile_* tables mirror the 5 context_* tables. Write transactions delete-then-insert child rows.

- [ ] **Step 1: Rewrite `server/domain/profiles/profiles.store.ts`**

```ts
import { randomUUID } from 'node:crypto';
import { ValidationError, NotFoundError } from '@/server/lib/errors';
import type { AetherContext, McpServerConfig, McpToolPolicy, Tool } from '@/server/domain/context/context.types';
import type { ProfileMeta, ProfileRecord } from './profiles.types';
import type { DatabaseHandle } from '@/server/db/database';

const NAME_MAX = 100;

type ProfileRow = {
  id: string;
  name: string;
  created_at: number;
  updated_at: number;
  system_instruction: string;
  thinking_enabled: number;
};

type ProfileServerRow = {
  server_id: string;
  name: string;
  transport: string;
  command: string | null;
  args: string | null;
  env: string | null;
  url: string | null;
  status: string;
};

type ProfilePolicyRow = {
  server_id: string;
  tool_name: string;
  auto_approve: number;
};

function validateName(name: string): void {
  if (!name.trim()) throw new ValidationError('Name cannot be empty');
  if (name.length > NAME_MAX) throw new ValidationError(`Name too long (max ${NAME_MAX})`);
}

export class ProfilesStore {
  constructor(private readonly db: DatabaseHandle) {}

  async listProfiles(): Promise<ProfileMeta[]> {
    const rows = this.db
      .prepare('SELECT id, name, created_at, updated_at FROM profiles ORDER BY updated_at DESC')
      .all() as { id: string; name: string; created_at: number; updated_at: number }[];
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    }));
  }

  async read(id: string): Promise<ProfileRecord | null> {
    const row = this.db
      .prepare(
        'SELECT id, name, created_at, updated_at, system_instruction, thinking_enabled FROM profiles WHERE id = ?',
      )
      .get(id) as ProfileRow | undefined;
    if (!row) return null;

    const skills = (
      this.db
        .prepare('SELECT name FROM profile_skills WHERE profile_id = ? ORDER BY position')
        .all(id) as { name: string }[]
    ).map((r) => r.name);

    const tools = this.db
      .prepare(
        'SELECT tool_id AS id, name, version, status FROM profile_tools WHERE profile_id = ? ORDER BY position',
      )
      .all(id) as Tool[];

    const serverRows = this.db
      .prepare(
        'SELECT server_id, name, transport, command, args, env, url, status FROM profile_mcp_servers WHERE profile_id = ?',
      )
      .all(id) as ProfileServerRow[];

    const policyRows = this.db
      .prepare(
        'SELECT server_id, tool_name, auto_approve FROM profile_mcp_tool_policies WHERE profile_id = ?',
      )
      .all(id) as ProfilePolicyRow[];

    const policiesByServer = new Map<string, Record<string, McpToolPolicy>>();
    for (const p of policyRows) {
      const map = policiesByServer.get(p.server_id) ?? {};
      map[p.tool_name] = { autoApprove: p.auto_approve === 1 };
      policiesByServer.set(p.server_id, map);
    }

    const mcpServers: McpServerConfig[] = serverRows.map((r) => {
      const policies = policiesByServer.get(r.server_id);
      const base: McpServerConfig = {
        id: r.server_id,
        name: r.name,
        transport: r.transport as McpServerConfig['transport'],
        status: r.status as McpServerConfig['status'],
      };
      if (r.command !== null) base.command = r.command;
      if (r.args !== null) base.args = JSON.parse(r.args) as string[];
      if (r.env !== null) base.env = JSON.parse(r.env) as Record<string, string>;
      if (r.url !== null) base.url = r.url;
      if (policies) base.toolPolicies = policies;
      return base;
    });

    const context: AetherContext = {
      systemInstruction: row.system_instruction,
      skills,
      tools,
      mcpServers,
    };

    return {
      name: row.name,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      context,
      thinkingEnabled: row.thinking_enabled === 1,
    };
  }

  async create(input: {
    name: string;
    context: AetherContext;
    thinkingEnabled: boolean;
  }): Promise<ProfileMeta> {
    validateName(input.name);
    const id = randomUUID();
    const now = Date.now();
    const tx = this.db.transaction(() => {
      const uniqueName = this.findUniqueName(input.name);
      this.db
        .prepare(
          'INSERT INTO profiles (id, name, created_at, updated_at, system_instruction, thinking_enabled) VALUES (?, ?, ?, ?, ?, ?)',
        )
        .run(id, uniqueName, now, now, input.context.systemInstruction, input.thinkingEnabled ? 1 : 0);
      this.writeChildren(id, input.context);
    });
    tx();
    return this.metaOf(id);
  }

  async update(
    id: string,
    patch: Partial<Omit<ProfileRecord, 'createdAt'>>,
  ): Promise<ProfileMeta> {
    if (patch.name !== undefined) validateName(patch.name);
    const tx = this.db.transaction(() => {
      const exists = this.db.prepare('SELECT id FROM profiles WHERE id = ?').get(id);
      if (!exists) throw new NotFoundError(`profile ${id}`);
      const now = Date.now();

      const cur = this.db
        .prepare('SELECT name, system_instruction, thinking_enabled FROM profiles WHERE id = ?')
        .get(id) as { name: string; system_instruction: string; thinking_enabled: number };

      const nextName = patch.name ?? cur.name;
      const nextSystemInstruction =
        patch.context?.systemInstruction ?? cur.system_instruction;
      const nextThinking =
        patch.thinkingEnabled === undefined ? cur.thinking_enabled : (patch.thinkingEnabled ? 1 : 0);

      this.db
        .prepare(
          'UPDATE profiles SET name = ?, updated_at = ?, system_instruction = ?, thinking_enabled = ? WHERE id = ?',
        )
        .run(nextName, now, nextSystemInstruction, nextThinking, id);

      if (patch.context) {
        this.writeChildren(id, patch.context);
      }
    });
    tx();
    return this.metaOf(id);
  }

  rename(id: string, name: string): Promise<ProfileMeta> {
    return this.update(id, { name });
  }

  async delete(id: string): Promise<void> {
    const info = this.db.prepare('DELETE FROM profiles WHERE id = ?').run(id);
    if (info.changes === 0) throw new NotFoundError(`profile ${id}`);
  }

  // ---- private helpers ----

  private metaOf(id: string): ProfileMeta {
    const row = this.db
      .prepare('SELECT id, name, created_at, updated_at FROM profiles WHERE id = ?')
      .get(id) as { id: string; name: string; created_at: number; updated_at: number };
    return {
      id: row.id,
      name: row.name,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  private findUniqueName(desired: string): string {
    const existing = new Set(
      (this.db.prepare('SELECT name FROM profiles').all() as { name: string }[]).map((r) => r.name),
    );
    if (!existing.has(desired)) return desired;
    let n = 1;
    while (existing.has(`${desired} (${n})`)) n++;
    return `${desired} (${n})`;
  }

  private writeChildren(profileId: string, context: AetherContext): void {
    this.db.prepare('DELETE FROM profile_skills WHERE profile_id = ?').run(profileId);
    const insertSkill = this.db.prepare(
      'INSERT INTO profile_skills (profile_id, position, name) VALUES (?, ?, ?)',
    );
    context.skills.forEach((s, i) => insertSkill.run(profileId, i, s));

    this.db.prepare('DELETE FROM profile_tools WHERE profile_id = ?').run(profileId);
    const insertTool = this.db.prepare(
      'INSERT INTO profile_tools (profile_id, tool_id, name, version, status, position) VALUES (?, ?, ?, ?, ?, ?)',
    );
    context.tools.forEach((t, i) =>
      insertTool.run(profileId, t.id, t.name, t.version, t.status, i),
    );

    // Children of mcp_servers cascade on delete, so we don't need to delete policies separately.
    this.db.prepare('DELETE FROM profile_mcp_servers WHERE profile_id = ?').run(profileId);
    const insertServer = this.db.prepare(
      'INSERT INTO profile_mcp_servers (profile_id, server_id, name, transport, command, args, env, url, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    );
    const insertPolicy = this.db.prepare(
      'INSERT INTO profile_mcp_tool_policies (profile_id, server_id, tool_name, auto_approve) VALUES (?, ?, ?, ?)',
    );
    for (const s of context.mcpServers) {
      insertServer.run(
        profileId,
        s.id,
        s.name,
        s.transport ?? 'stdio',
        s.command ?? null,
        s.args ? JSON.stringify(s.args) : null,
        s.env ? JSON.stringify(s.env) : null,
        s.url ?? null,
        s.status,
      );
      if (s.toolPolicies) {
        for (const [toolName, policy] of Object.entries(s.toolPolicies)) {
          insertPolicy.run(profileId, s.id, toolName, policy.autoApprove ? 1 : 0);
        }
      }
    }
  }
}
```

- [ ] **Step 2: Rewrite `server/domain/profiles/profiles.store.test.ts`**

Read the existing file. Replace setup; preserve every assertion. Add at least these cases:

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ProfilesStore } from './profiles.store';
import { makeTestDb } from '@/server/test/test-db';
import type { DatabaseHandle } from '@/server/db/database';
import type { AetherContext } from '@/server/domain/context/context.types';

let db: DatabaseHandle;
let store: ProfilesStore;

const ctx: AetherContext = {
  systemInstruction: 'You are Aether',
  skills: ['s1', 's2'],
  tools: [{ id: 't1', name: 'X', version: '1', status: 'online' }],
  mcpServers: [{
    id: 'M1',
    name: 'mock',
    transport: 'mock',
    status: 'offline',
    toolPolicies: { echo: { autoApprove: true } },
  }],
};

beforeEach(() => {
  db = makeTestDb();
  store = new ProfilesStore(db);
});

afterEach(() => {
  db.close();
});

describe('ProfilesStore', () => {
  it('listProfiles() returns [] on a fresh DB', async () => {
    expect(await store.listProfiles()).toEqual([]);
  });

  it('create() inserts a profile and returns its meta', async () => {
    const meta = await store.create({ name: 'p1', context: ctx, thinkingEnabled: true });
    expect(meta.name).toBe('p1');
    expect(meta.id).toBeTruthy();
  });

  it('create() generates a unique name when colliding', async () => {
    await store.create({ name: 'p1', context: ctx, thinkingEnabled: false });
    const second = await store.create({ name: 'p1', context: ctx, thinkingEnabled: false });
    expect(second.name).toBe('p1 (1)');
  });

  it('create() rejects empty/oversized names', async () => {
    await expect(store.create({ name: '', context: ctx, thinkingEnabled: false })).rejects.toThrow();
    await expect(store.create({ name: 'x'.repeat(101), context: ctx, thinkingEnabled: false })).rejects.toThrow();
  });

  it('read() round-trips the full context including skills, tools, mcp servers, policies', async () => {
    const meta = await store.create({ name: 'p1', context: ctx, thinkingEnabled: true });
    const rec = await store.read(meta.id);
    expect(rec).not.toBeNull();
    expect(rec!.thinkingEnabled).toBe(true);
    expect(rec!.context.skills).toEqual(['s1', 's2']);
    expect(rec!.context.tools).toEqual([{ id: 't1', name: 'X', version: '1', status: 'online' }]);
    expect(rec!.context.mcpServers[0].toolPolicies).toEqual({ echo: { autoApprove: true } });
  });

  it('update() merges patch and bumps updatedAt', async () => {
    const meta = await store.create({ name: 'p1', context: ctx, thinkingEnabled: false });
    await new Promise((r) => setTimeout(r, 5));
    const updated = await store.update(meta.id, { name: 'renamed', thinkingEnabled: true });
    expect(updated.name).toBe('renamed');
    expect(updated.updatedAt).toBeGreaterThan(meta.updatedAt);
    const rec = await store.read(meta.id);
    expect(rec!.thinkingEnabled).toBe(true);
  });

  it('update() with new context replaces all child rows atomically', async () => {
    const meta = await store.create({ name: 'p1', context: ctx, thinkingEnabled: false });
    const newCtx: AetherContext = {
      systemInstruction: 'replaced',
      skills: ['only'],
      tools: [],
      mcpServers: [],
    };
    await store.update(meta.id, { context: newCtx });
    const rec = await store.read(meta.id);
    expect(rec!.context.systemInstruction).toBe('replaced');
    expect(rec!.context.skills).toEqual(['only']);
    expect(rec!.context.tools).toEqual([]);
    expect(rec!.context.mcpServers).toEqual([]);
  });

  it('rename() is a thin wrapper around update()', async () => {
    const meta = await store.create({ name: 'p1', context: ctx, thinkingEnabled: false });
    const renamed = await store.rename(meta.id, 'q');
    expect(renamed.name).toBe('q');
  });

  it('rename() rejects unknown id', async () => {
    await expect(store.rename('nope', 'x')).rejects.toThrow();
  });

  it('delete() cascades to all child tables', async () => {
    const meta = await store.create({ name: 'p1', context: ctx, thinkingEnabled: false });
    await store.delete(meta.id);
    expect((db.prepare('SELECT COUNT(*) AS n FROM profile_skills').get() as { n: number }).n).toBe(0);
    expect((db.prepare('SELECT COUNT(*) AS n FROM profile_tools').get() as { n: number }).n).toBe(0);
    expect((db.prepare('SELECT COUNT(*) AS n FROM profile_mcp_servers').get() as { n: number }).n).toBe(0);
    expect((db.prepare('SELECT COUNT(*) AS n FROM profile_mcp_tool_policies').get() as { n: number }).n).toBe(0);
  });

  it('listProfiles() sorts by updated_at DESC', async () => {
    const a = await store.create({ name: 'A', context: ctx, thinkingEnabled: false });
    await new Promise((r) => setTimeout(r, 5));
    const b = await store.create({ name: 'B', context: ctx, thinkingEnabled: false });
    const list = await store.listProfiles();
    expect(list[0].id).toBe(b.id);
    expect(list[1].id).toBe(a.id);
  });
});
```

- [ ] **Step 3: Run + lint + commit**

```bash
npx vitest run server/domain/profiles/profiles.store.test.ts
npx vitest run server
npm run lint
git add server/domain/profiles/profiles.store.ts server/domain/profiles/profiles.store.test.ts <other touched files>
git commit -m "feat(slice-13): ProfilesStore SQLite-backed (5 normalized tables)"
```

---

## Phase G — SubAgentsStore SQLite rewrite

### Task G1: Rewrite `SubAgentsStore` against SQLite + update tests

**Files:**
- Modify: `server/domain/subagents/subagents.store.ts`
- Modify: `server/domain/subagents/subagents.store.test.ts`

Smallest of the four rewrites: 3 tables, no nested JSON columns.

- [ ] **Step 1: Rewrite `server/domain/subagents/subagents.store.ts`**

```ts
import { randomUUID } from 'node:crypto';
import { NotFoundError } from '@/server/lib/errors';
import type { SubAgentMeta, SubAgentRecord } from './subagents.types';
import type { Tool } from '@/server/domain/context/context.types';
import type { DatabaseHandle } from '@/server/db/database';

interface CreateInput {
  name: string;
  systemInstruction?: string;
  skills?: string[];
  tools?: Tool[];
}

type SubAgentRow = {
  id: string;
  name: string;
  system_instruction: string;
  created_at: number;
  updated_at: number;
};

type SubAgentToolRow = {
  position: number;
  name: string;
  version: string;
  status: string;
};

export class SubAgentsStore {
  constructor(private readonly db: DatabaseHandle) {}

  async list(): Promise<SubAgentMeta[]> {
    const rows = this.db
      .prepare('SELECT id, name, created_at, updated_at FROM subagents ORDER BY updated_at DESC')
      .all() as { id: string; name: string; created_at: number; updated_at: number }[];
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    }));
  }

  async read(id: string): Promise<SubAgentRecord | null> {
    const row = this.db
      .prepare(
        'SELECT id, name, system_instruction, created_at, updated_at FROM subagents WHERE id = ?',
      )
      .get(id) as SubAgentRow | undefined;
    if (!row) return null;

    const skills = (
      this.db
        .prepare('SELECT name FROM subagent_skills WHERE subagent_id = ? ORDER BY position')
        .all(id) as { name: string }[]
    ).map((r) => r.name);

    const tools = (
      this.db
        .prepare(
          'SELECT position, name, version, status FROM subagent_tools WHERE subagent_id = ? ORDER BY position',
        )
        .all(id) as SubAgentToolRow[]
    ).map(
      (t, i): Tool => ({
        id: `${id}-${i}`, // synthetic; SubAgentRecord.tools.id isn't surfaced anywhere user-visible
        name: t.name,
        version: t.version,
        status: t.status as 'online' | 'offline',
      }),
    );

    return {
      name: row.name,
      systemInstruction: row.system_instruction,
      skills,
      tools,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  async create(input: CreateInput): Promise<SubAgentMeta> {
    const id = randomUUID();
    const now = Date.now();
    const tx = this.db.transaction(() => {
      const uniqueName = this.findUniqueName(input.name);
      this.db
        .prepare(
          'INSERT INTO subagents (id, name, system_instruction, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
        )
        .run(id, uniqueName, input.systemInstruction ?? '', now, now);
      this.writeChildren(id, input.skills ?? [], input.tools ?? []);
    });
    tx();
    return this.metaOf(id);
  }

  async update(
    id: string,
    patch: Partial<Omit<SubAgentRecord, 'createdAt'>>,
  ): Promise<SubAgentMeta> {
    const tx = this.db.transaction(() => {
      const exists = this.db.prepare('SELECT id FROM subagents WHERE id = ?').get(id);
      if (!exists) throw new NotFoundError(`subagent ${id}`);
      const now = Date.now();

      const cur = this.db
        .prepare('SELECT name, system_instruction FROM subagents WHERE id = ?')
        .get(id) as { name: string; system_instruction: string };

      this.db
        .prepare(
          'UPDATE subagents SET name = ?, system_instruction = ?, updated_at = ? WHERE id = ?',
        )
        .run(
          patch.name ?? cur.name,
          patch.systemInstruction ?? cur.system_instruction,
          now,
          id,
        );

      if (patch.skills || patch.tools) {
        const existingSkills = (
          this.db
            .prepare('SELECT name FROM subagent_skills WHERE subagent_id = ? ORDER BY position')
            .all(id) as { name: string }[]
        ).map((r) => r.name);
        const existingTools = (
          this.db
            .prepare(
              'SELECT name, version, status FROM subagent_tools WHERE subagent_id = ? ORDER BY position',
            )
            .all(id) as { name: string; version: string; status: string }[]
        ).map((t, i): Tool => ({
          id: `${id}-${i}`,
          name: t.name,
          version: t.version,
          status: t.status as 'online' | 'offline',
        }));
        const nextSkills = patch.skills ?? existingSkills;
        const nextTools = patch.tools ?? existingTools;
        this.writeChildren(id, nextSkills, nextTools);
      }
    });
    tx();
    return this.metaOf(id);
  }

  async delete(id: string): Promise<void> {
    const info = this.db.prepare('DELETE FROM subagents WHERE id = ?').run(id);
    if (info.changes === 0) throw new NotFoundError(`subagent ${id}`);
  }

  // ---- private helpers ----

  private metaOf(id: string): SubAgentMeta {
    const row = this.db
      .prepare('SELECT id, name, created_at, updated_at FROM subagents WHERE id = ?')
      .get(id) as { id: string; name: string; created_at: number; updated_at: number };
    return {
      id: row.id,
      name: row.name,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  private findUniqueName(desired: string): string {
    const existing = new Set(
      (this.db.prepare('SELECT name FROM subagents').all() as { name: string }[]).map((r) => r.name),
    );
    if (!existing.has(desired)) return desired;
    let n = 2;
    while (existing.has(`${desired} (${n})`)) n++;
    return `${desired} (${n})`;
  }

  private writeChildren(id: string, skills: string[], tools: Tool[]): void {
    this.db.prepare('DELETE FROM subagent_skills WHERE subagent_id = ?').run(id);
    const insertSkill = this.db.prepare(
      'INSERT INTO subagent_skills (subagent_id, position, name) VALUES (?, ?, ?)',
    );
    skills.forEach((s, i) => insertSkill.run(id, i, s));

    this.db.prepare('DELETE FROM subagent_tools WHERE subagent_id = ?').run(id);
    const insertTool = this.db.prepare(
      'INSERT INTO subagent_tools (subagent_id, position, name, version, status) VALUES (?, ?, ?, ?, ?)',
    );
    tools.forEach((t, i) => insertTool.run(id, i, t.name, t.version, t.status));
  }
}
```

Note: the original `SubAgentRecord.tools: Tool[]` uses `Tool.id` from the context tool table, but sub-agent tools historically just carry the meta (name/version/status); the `id` is treated as opaque by consumers. The synthetic `${id}-${i}` round-trips safely.

If integration tests later require preserving the original `Tool.id`, add an `id` column to `subagent_tools` and update writes — but the existing test suite doesn't require it.

- [ ] **Step 2: Rewrite `server/domain/subagents/subagents.store.test.ts`**

Mirror the pattern from D1/E1/F1: `makeTestDb()` in `beforeEach`, `db.close()` in `afterEach`. Preserve every existing assertion. Add at least:

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SubAgentsStore } from './subagents.store';
import { makeTestDb } from '@/server/test/test-db';
import type { DatabaseHandle } from '@/server/db/database';

let db: DatabaseHandle;
let store: SubAgentsStore;

beforeEach(() => {
  db = makeTestDb();
  store = new SubAgentsStore(db);
});

afterEach(() => {
  db.close();
});

describe('SubAgentsStore', () => {
  it('list() returns [] on a fresh DB', async () => {
    expect(await store.list()).toEqual([]);
  });

  it('create() inserts with defaults', async () => {
    const meta = await store.create({ name: 'designer' });
    expect(meta.name).toBe('designer');
    const rec = await store.read(meta.id);
    expect(rec).toEqual({
      name: 'designer',
      systemInstruction: '',
      skills: [],
      tools: [],
      createdAt: meta.createdAt,
      updatedAt: meta.updatedAt,
    });
  });

  it('create() generates a unique name when colliding (starts at suffix 2)', async () => {
    await store.create({ name: 'designer' });
    const second = await store.create({ name: 'designer' });
    expect(second.name).toBe('designer (2)');
  });

  it('create() persists skills + tools', async () => {
    const meta = await store.create({
      name: 'sculptor',
      skills: ['clay', 'kiln'],
      tools: [{ id: 'ignored', name: 'X', version: '1', status: 'online' }],
    });
    const rec = await store.read(meta.id);
    expect(rec!.skills).toEqual(['clay', 'kiln']);
    expect(rec!.tools).toHaveLength(1);
    expect(rec!.tools[0].name).toBe('X');
  });

  it('update() merges name + systemInstruction without touching skills', async () => {
    const meta = await store.create({ name: 'a', skills: ['s1'] });
    await new Promise((r) => setTimeout(r, 5));
    const updated = await store.update(meta.id, { name: 'b', systemInstruction: 'sys' });
    expect(updated.name).toBe('b');
    expect(updated.updatedAt).toBeGreaterThan(meta.updatedAt);
    const rec = await store.read(meta.id);
    expect(rec!.skills).toEqual(['s1']); // untouched
    expect(rec!.systemInstruction).toBe('sys');
  });

  it('update() replaces skills atomically when provided', async () => {
    const meta = await store.create({ name: 'a', skills: ['s1', 's2'] });
    await store.update(meta.id, { skills: ['only'] });
    const rec = await store.read(meta.id);
    expect(rec!.skills).toEqual(['only']);
  });

  it('delete() cascades to subagent_skills + subagent_tools', async () => {
    const meta = await store.create({
      name: 'a',
      skills: ['s1'],
      tools: [{ id: 'x', name: 'X', version: '1', status: 'online' }],
    });
    await store.delete(meta.id);
    expect((db.prepare('SELECT COUNT(*) AS n FROM subagent_skills').get() as { n: number }).n).toBe(0);
    expect((db.prepare('SELECT COUNT(*) AS n FROM subagent_tools').get() as { n: number }).n).toBe(0);
  });

  it('list() sorts by updated_at DESC', async () => {
    const a = await store.create({ name: 'A' });
    await new Promise((r) => setTimeout(r, 5));
    const b = await store.create({ name: 'B' });
    const list = await store.list();
    expect(list[0].id).toBe(b.id);
    expect(list[1].id).toBe(a.id);
  });

  it('delete() throws on unknown id', async () => {
    await expect(store.delete('nope')).rejects.toThrow();
  });

  it('read() returns null for unknown id', async () => {
    expect(await store.read('nope')).toBeNull();
  });
});
```

- [ ] **Step 3: Run + lint + commit**

```bash
npx vitest run server/domain/subagents/subagents.store.test.ts
npx vitest run server
npm run lint
git add server/domain/subagents/subagents.store.ts server/domain/subagents/subagents.store.test.ts <other touched files>
git commit -m "feat(slice-13): SubAgentsStore SQLite-backed (3 normalized tables)"
```

---

## Phase H — Bootstrap wiring

### Task H1: `server/index.ts` opens DB, runs migrations, wires all stores

**Files:**
- Modify: `server/index.ts`
- Possibly: any remaining test file that constructs stores with file paths

- [ ] **Step 1: Modify `server/index.ts`**

Add imports + replace the four `new XStore(path.join(cfg.dataDir, '*.json'))` lines with a single DB open + 4 store constructions.

```ts
import path from 'node:path';
import express from 'express';
import { createServer as createViteServer } from 'vite';
import dotenv from 'dotenv';
import { createApp } from './app';
import { loadConfig } from './config';
import { openDatabase } from './db/database';
import { applyMigrations } from './db/migrate';
import { ContextStore } from './domain/context/context.store';
import { HistoryStore } from './domain/history/history.store';
import { ProfilesStore } from './domain/profiles/profiles.store';
import { SubAgentsStore } from './domain/subagents/subagents.store';
import { DispatchService } from './domain/dispatch/dispatch.service';
import { FakeProvider } from './domain/dispatch/providers/fake.provider';
import { GeminiProvider } from './domain/dispatch/providers/gemini.provider';
import { McpRegistry } from './domain/mcp/registry';
import { ProviderRegistry } from './domain/providers/registry';
import { OllamaProvider } from './domain/dispatch/providers/ollama.provider';
import { AnthropicProvider } from './domain/dispatch/providers/anthropic.provider';
import { OpenAIProvider } from './domain/dispatch/providers/openai.provider';
import { detectAnthropicAuth } from './lib/anthropic-auth';

dotenv.config();

async function bootstrap() {
  const cfg = loadConfig();

  const db = openDatabase(path.join(cfg.dataDir, 'aether.sqlite'));
  const migrated = applyMigrations(db, path.join(__dirname, 'db', 'migrations'));
  if (migrated.applied.length > 0) {
    console.log(`[db] applied migrations: ${migrated.applied.join(', ')}`);
  }

  const contextStore = new ContextStore(db);
  const historyStore = new HistoryStore(db);
  const profilesStore = new ProfilesStore(db);
  const subAgentsStore = new SubAgentsStore(db);

  const mcpRegistry = new McpRegistry(contextStore);

  const fakeProvider = new FakeProvider({
    chunks: ['pong'],
    thoughtChunks: ['thinking about it…'],
    chunkDelayMs: 50,
    model: 'fake-1',
  });

  if (cfg.fakeProvider) {
    console.log('[aether] Using FakeProvider (AETHER_FAKE_PROVIDER=1)');
  }

  const anthropicAuth = await detectAnthropicAuth();
  console.log(`[providers] anthropic: ${anthropicAuth}`);

  const providers = new ProviderRegistry({
    ollamaHost: process.env.OLLAMA_HOST ?? 'http://localhost:11434',
    geminiApiKey: cfg.geminiApiKey || undefined,
    anthropicAuth,
    openAIApiKey: cfg.openAIApiKey || undefined,
    fakeProvider,
    geminiBuilder: (model) => new GeminiProvider({ apiKey: cfg.geminiApiKey, model }),
    ollamaBuilder: (model) =>
      new OllamaProvider({
        host: process.env.OLLAMA_HOST ?? 'http://localhost:11434',
        model,
      }),
    anthropicBuilder: (model) =>
      new AnthropicProvider({
        model: model as 'claude-opus-4-7' | 'claude-sonnet-4-6' | 'claude-haiku-4-5',
      }),
    openAIBuilder: (model) =>
      new OpenAIProvider({
        apiKey: cfg.openAIApiKey,
        model: model as 'gpt-5' | 'gpt-5-mini' | 'gpt-4.1' | 'o3',
      }),
    defaultOverride:
      process.env.AETHER_DEFAULT_PROVIDER ||
      (cfg.fakeProvider ? 'fake:default' : undefined),
  });

  await providers.refresh();

  const dispatcher = new DispatchService({ providers, historyStore, contextStore, subAgentsStore, mcpRegistry });

  const app = createApp({ contextStore, historyStore, dispatcher, profilesStore, subAgentsStore, mcpRegistry, providers });

  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(cfg.port, '0.0.0.0', () => {
    console.log(`Aether server running on http://localhost:${cfg.port}`);
  });
}

bootstrap().catch((err) => {
  console.error('Bootstrap failed:', err);
  process.exit(1);
});
```

- [ ] **Step 2: Lint + full server suite**

```bash
npm run lint
npx vitest run server
```

Expected: clean lint; full server suite green. Any route/dispatch test still using `mkdtemp` + `new XStore(filePath)` will fail — fix by switching to `makeTestDb()` + `new XStore(db)`.

- [ ] **Step 3: Smoke test the server briefly (manual, optional)**

```bash
mkdir -p /tmp/aether-slice13-smoke
AETHER_DATA_DIR=/tmp/aether-slice13-smoke AETHER_FAKE_PROVIDER=1 PORT=3099 timeout 5 npx tsx server/index.ts || true
ls -la /tmp/aether-slice13-smoke/
```

Expected: a line like `[db] applied migrations: 1` in the output, and `aether.sqlite` + `aether.sqlite-wal` + `aether.sqlite-shm` files exist in the data dir. The `timeout` exit code is non-zero but expected. Clean up: `rm -rf /tmp/aether-slice13-smoke`.

Skip this step if `tsx` is not available locally; rely on the suite + lint.

- [ ] **Step 4: Commit**

```bash
git add server/index.ts
git commit -m "feat(slice-13): bootstrap opens SQLite + runs migrations + wires stores"
```

---

## Phase I — Cross-store integration test

### Task I1: New integration test exercises all four stores against one DB

**Files:**
- Create: `server/test/db.integration.test.ts`

A single test file that boots `makeTestDb()` once, constructs all four stores, and runs a small end-to-end flow that touches each.

- [ ] **Step 1: Create the file**

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { makeTestDb } from './test-db';
import { ContextStore } from '@/server/domain/context/context.store';
import { HistoryStore } from '@/server/domain/history/history.store';
import { ProfilesStore } from '@/server/domain/profiles/profiles.store';
import { SubAgentsStore } from '@/server/domain/subagents/subagents.store';
import type { DatabaseHandle } from '@/server/db/database';

let db: DatabaseHandle;
let context: ContextStore;
let history: HistoryStore;
let profiles: ProfilesStore;
let subagents: SubAgentsStore;

beforeEach(() => {
  db = makeTestDb();
  context = new ContextStore(db);
  history = new HistoryStore(db);
  profiles = new ProfilesStore(db);
  subagents = new SubAgentsStore(db);
});

afterEach(() => {
  db.close();
});

describe('SQLite stores — cross-store integration', () => {
  it('end-to-end: create profile from current context, create session, append message, verify all reads agree', async () => {
    // 1. Mutate context: add a skill + a tool + an MCP server.
    await context.addSkill('typescript');
    const tool = await context.addTool({ name: 'GoogleSearch', version: '1.0', status: 'online' });
    const srv = await context.addMcpServer({
      name: 'mock',
      transport: 'mock',
      status: 'offline',
    });
    const ctx = await context.read();
    expect(ctx.skills).toContain('typescript');
    expect(ctx.tools.map((t) => t.id)).toContain(tool.id);
    expect(ctx.mcpServers.map((s) => s.id)).toContain(srv.id);

    // 2. Snapshot the context into a new profile.
    const profile = await profiles.create({
      name: 'dev',
      context: ctx,
      thinkingEnabled: true,
    });
    const readProfile = await profiles.read(profile.id);
    expect(readProfile!.context.skills).toContain('typescript');
    expect(readProfile!.context.tools.map((t) => t.id)).toContain(tool.id);

    // 3. Create a sub-agent.
    const designer = await subagents.create({
      name: 'designer',
      systemInstruction: 'You design.',
      skills: ['layout'],
      tools: [{ id: 't1', name: 'X', version: '1', status: 'online' }],
    });
    const readDesigner = await subagents.read(designer.id);
    expect(readDesigner!.skills).toEqual(['layout']);

    // 4. Create a session and append a message with reasoning + tool_call.
    const session = await history.createEmpty({ providerName: 'fake:default' });
    await history.append(session.id, {
      id: 'm1',
      role: 'user',
      text: 'ping',
      timestamp: Date.now(),
    });
    await history.append(session.id, {
      id: 'm2',
      role: 'model',
      text: 'pong',
      timestamp: Date.now() + 1,
      model: 'fake-1',
      reasoningSteps: [{
        id: 'r1',
        type: 'tool_call',
        title: 'Tool: mock.echo',
        content: 'used mock.echo',
        durationMs: 5,
        timestamp: Date.now(),
        toolCall: {
          id: 'TC1',
          qualifiedName: 'mock.echo',
          args: { message: 'ping' },
          result: { message: 'ping' },
          durationMs: 5,
        },
      }],
    });

    // 5. Verify nested reads stitch correctly.
    const messages = await history.read(session.id);
    expect(messages).toHaveLength(2);
    expect(messages![0]).toMatchObject({ id: 'm1', role: 'user' });
    expect(messages![1].reasoningSteps).toHaveLength(1);
    expect(messages![1].reasoningSteps![0].toolCall?.qualifiedName).toBe('mock.echo');

    // 6. Verify cross-cascade: deleting the session removes its messages + reasoning + tool_calls
    //    but leaves profiles, sub-agents, and context intact.
    await history.delete(session.id);
    expect(await history.listSessions()).toEqual([]);
    expect((await profiles.listProfiles())[0].id).toBe(profile.id);
    expect((await subagents.list())[0].id).toBe(designer.id);
    expect((await context.read()).skills).toContain('typescript');
  });
});
```

- [ ] **Step 2: Run + lint + commit**

```bash
npx vitest run server/test/db.integration.test.ts
npm run lint
git add server/test/db.integration.test.ts
git commit -m "test(slice-13): cross-store integration against shared in-memory DB"
```

---

## Phase J — Final verification + PR

### Task J1: lint + full tests + e2e + push + PR

- [ ] **Step 1: Lint**

```bash
npm run lint
```

Expected: clean.

- [ ] **Step 2: Vitest (full)**

```bash
npx vitest run
```

Expected: all tests pass. Previous baseline (post-slice 12) was 927. The store rewrites preserve test assertions, so the count should land ~927 + ~25-30 (6 new migrate + 1 new integration + extra cases added in the rewrites).

- [ ] **Step 3: Playwright (e2e — exercises the real SQLite path)**

```bash
npx playwright test
```

Expected: 13/13. The scratch `AETHER_DATA_DIR` now gets `aether.sqlite` (+ WAL files) instead of `*.json`. Migrations apply on first server boot per test run.

If any e2e fails, inspect: most likely cause is a route still expecting JSON file behavior (e.g., reading a file at a specific path). Routes should be untouched since stores preserve their public API, but verify.

- [ ] **Step 4: Verify branch state**

```bash
git log --oneline main..HEAD
```

You should see one commit per task, plus the spec commit.

- [ ] **Step 5: Push**

```bash
git push -u origin feat/slice-13-sqlite
```

- [ ] **Step 6: Open PR**

```bash
gh pr create --title "feat(slice-13): SQLite persistence (fully relational)" --body "$(cat <<'EOF'
## Summary

Slice 13 replaces the four JSON-file backed stores (\`context.json\`, \`sessions.json\`, \`profiles.json\`, \`subagents.json\`) with a single SQLite database (\`aether.sqlite\`) using \`better-sqlite3\`. Schema is fully relational — 16 product tables across context (5), sessions/messages/reasoning (4), profiles (5), and sub-agents (3) — plus a \`_migrations\` tracking table.

- **Public store APIs are preserved.** All four store classes keep their Promise-based method signatures; only internals change. Routes / dispatch / FE wiring is untouched.
- **Migration runner.** \`server/db/migrate.ts\` reads \`.sql\` files from \`server/db/migrations/\` in numeric order, wraps each in a transaction, records applied versions in \`_migrations\`. Idempotent on second run.
- **Pragmas.** \`journal_mode = WAL\` + \`foreign_keys = ON\` + \`synchronous = NORMAL\` applied at every open.
- **Tests use \`:memory:\` SQLite** via \`makeTestDb()\` helper. Each test gets a fresh isolated DB with the full schema applied. Replaces the \`mkdtemp\` + JSON-file pattern.

## Architecture

\`server/db/database.ts\` exports \`openDatabase(path)\` that opens the file and applies pragmas. \`server/db/migrate.ts\` exports \`applyMigrations(db, dir)\` that ensures \`_migrations\` exists then applies each unapplied file inside a transaction. \`server/index.ts\` opens the DB once at startup, runs migrations, then injects the handle into the four store constructors. All four stores wrap multi-row writes in \`db.transaction(...)\` for atomicity.

Spec: \`docs/superpowers/specs/2026-05-21-aether-slice-13-sqlite-design.md\`
Plan: \`docs/superpowers/plans/2026-05-21-aether-slice-13-sqlite.md\`

## Test plan

- [x] \`npm run lint\` — clean
- [x] \`npx vitest run\` — all passing (previous 927 + ~25-30 new)
- [x] \`npx playwright test\` — 13/13 (exercises the real SQLite path via the scratch AETHER_DATA_DIR)
- [x] New unit tests: migrate runner (6 cases — empty/idempotent/rollback/numeric ordering/ignore non-matching files/multi-statement)
- [x] Rewritten store tests: same assertions as before; only setup changes (mkdtemp → makeTestDb)
- [x] New integration test: cross-store flow (context mutation → profile snapshot → sub-agent create → session+message with reasoning+tool_call → verify all reads agree → verify session-delete cascade leaves other stores intact)

## Notes

- \`better-sqlite3\` is a native module; first \`npm install\` after this lands will trigger a node-gyp build.
- No data migration from the JSON files — the dev environment has no real data. A one-off migration script can be written later if needed.
- The legacy \`history.migrate.ts\` (V1 → V2 JSON migration) is removed; no longer needed without JSON files.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Self-review notes

**Spec coverage:**
- ✅ better-sqlite3 — Task B1.
- ✅ `openDatabase` + pragmas (WAL, FK, synchronous=NORMAL) — Task C1 (database.ts).
- ✅ `applyMigrations` (numeric ordering, transactional, `_migrations` table owned by runner) — Task C1 (migrate.ts).
- ✅ `001_initial.sql` with the full 16-table schema — Task C1.
- ✅ `makeTestDb()` helper — Task C1.
- ✅ ContextStore rewrite preserving public API — Task D1.
- ✅ HistoryStore rewrite with nested messages/reasoning/tool_calls — Task E1.
- ✅ ProfilesStore rewrite with 5 profile_* tables — Task F1.
- ✅ SubAgentsStore rewrite with 3 subagent_* tables — Task G1.
- ✅ Bootstrap wiring — Task H1.
- ✅ Cross-store integration test — Task I1.
- ✅ Playwright e2e regression check — Task J1.
- ✅ No FE changes — preserved by keeping store public APIs.

**Placeholder scan:** searched for "TBD", "TODO", "implement later", and similar — none present. The `<other touched test files>` in the git-add lines (Phases E, F, G) is an explicit instruction to the implementer to discover those file paths via `npx vitest run server` failure output; the plan can't enumerate them at write time because the failures depend on each store's downstream test set.

**Type consistency:** `DatabaseHandle` from `server/db/database.ts` is the constructor type for every store. `makeTestDb()` returns the same type. Field names (`createdAt` / `updatedAt` / `providerName` etc.) match the existing `*.types.ts` files exactly. Method signatures preserved verbatim from each store's current public surface.
