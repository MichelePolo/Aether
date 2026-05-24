# Aether Slice 23 — Native Workspace Management GUI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A managed list of named workspaces (folder paths) with per-session activation that reroots the Filesystem MCP (slice 21).

**Architecture:** New `workspaces` table + `sessions.workspace_id` FK (migration 009). Server-backed file browser modal (`GET /api/workspaces/browse`) avoids browser-API impedance for path picking. Switching focus to a session calls `POST /api/workspaces/activate-for-session`, which compares the session's `workspace_id.rootPath` to the current Filesystem MCP `fs_root`; if different and the filesystem MCP is enabled, it calls `setFsRoot` + `reconnectBuiltin('filesystem')`.

**Tech Stack:** TypeScript, Node 22, Express, better-sqlite3, zustand, React 18, vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-05-24-aether-slice-23-workspaces-design.md`

---

## Notes for the implementer

- Branch `feat/slice-23-workspaces` is already checked out.
- Test runner: `pnpm test` (full) or `pnpm vitest run <path>` (single file).
- Lint+typecheck: `pnpm lint`.
- Any new endpoint a FE store touches MUST have a default MSW handler in `src/test/msw-handlers.ts` or store/api tests will fail.
- Pre-existing flakes (don't treat as slice-23 regressions): two Ollama tests when a local daemon is reachable; occasional Playwright isolation flakes.
- Migration filename MUST be `009_workspaces.sql`. `migrate.test.ts` bumps to `[1..9]`.
- Dedupe pattern: module-level `Map<string, Promise<…>>` — copy from `src/stores/providerAuth.store.ts`.
- Commit after each task with the exact message provided.

---

### Task A1: Verify branch + clean tree

**Files:** (none — sanity check)

- [ ] **Step 1: Confirm branch and clean tree**

Run: `git status && git branch --show-current`
Expected:
```
On branch feat/slice-23-workspaces
nothing to commit, working tree clean
```

If anything is dirty, stop and surface to the user. Do NOT proceed.

---

### Task B1: Migration 009 + types + migrate-test bump

**Files:**
- Create: `server/db/migrations/009_workspaces.sql`
- Create: `server/domain/workspaces/workspaces.types.ts`
- Modify: `server/domain/history/history.types.ts` (extend `SessionMeta` with `workspaceId?`)
- Modify: `server/db/migrate.test.ts` (bump to `[1..9]`)

- [ ] **Step 1: Write the migration**

Create `server/db/migrations/009_workspaces.sql`:

```sql
-- Workspaces (slice 23). N rows, one per saved project folder. Unique on rootPath.
CREATE TABLE workspaces (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  root_path TEXT NOT NULL,
  added_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX idx_workspaces_root_path ON workspaces(root_path);

-- Sessions get an optional FK pointing at a workspace. ON DELETE SET NULL so
-- removing a workspace doesn't cascade-delete its sessions.
ALTER TABLE sessions ADD COLUMN workspace_id TEXT
  REFERENCES workspaces(id) ON DELETE SET NULL;
```

- [ ] **Step 2: Create the types file**

Create `server/domain/workspaces/workspaces.types.ts`:

```ts
export interface Workspace {
  id: string;
  name: string;
  rootPath: string;
  addedAt: number;
}

export interface BrowseEntry {
  name: string;
  isDir: boolean;
}
```

- [ ] **Step 3: Extend SessionMeta**

In `server/domain/history/history.types.ts`, change:

```ts
export interface SessionMeta {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  providerName?: string;
}
```

to:

```ts
export interface SessionMeta {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  providerName?: string;
  workspaceId?: string;
}
```

- [ ] **Step 4: Bump the migrate-test assertion**

In `server/db/migrate.test.ts`, find:

```ts
expect(versions).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
```

and change to:

```ts
expect(versions).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
```

- [ ] **Step 5: Run the migrate test**

Run: `pnpm vitest run server/db/migrate.test.ts`
Expected: all green.

- [ ] **Step 6: Run typecheck**

Run: `pnpm lint`
Expected: PASS. Existing HistoryStore reads/writes don't touch the new column yet — `workspaceId` stays undefined.

- [ ] **Step 7: Commit**

```bash
git add server/db/migrations/009_workspaces.sql \
        server/domain/workspaces/workspaces.types.ts \
        server/domain/history/history.types.ts \
        server/db/migrate.test.ts
git commit -m "feat(slice-23): migration 009 + workspaces types + SessionMeta.workspaceId"
```

---

### Task C1: WorkspacesStore (SQLite-backed)

**Files:**
- Create: `server/domain/workspaces/workspaces.store.ts`
- Create: `server/domain/workspaces/workspaces.store.test.ts`

- [ ] **Step 1: Write the failing test**

Create `server/domain/workspaces/workspaces.store.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { applyMigrations } from '@/server/db/migrate';
import { WorkspacesStore } from './workspaces.store';

let dir: string;
let db: ReturnType<typeof Database>;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'aether-ws-'));
  mkdirSync(join(dir, 'migrations'), { recursive: true });
  const sql = `
    CREATE TABLE sessions (id TEXT PRIMARY KEY);
    CREATE TABLE workspaces (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      root_path TEXT NOT NULL,
      added_at INTEGER NOT NULL
    );
    CREATE UNIQUE INDEX idx_workspaces_root_path ON workspaces(root_path);
    ALTER TABLE sessions ADD COLUMN workspace_id TEXT
      REFERENCES workspaces(id) ON DELETE SET NULL;
  `;
  writeFileSync(join(dir, 'migrations', '001_ws.sql'), sql);
  db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  applyMigrations(db, join(dir, 'migrations'));
});

afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

describe('WorkspacesStore', () => {
  it('create() persists a workspace and returns it', () => {
    const store = new WorkspacesStore(db);
    const w = store.create({ name: 'proj', rootPath: dir });
    expect(w.name).toBe('proj');
    expect(w.rootPath).toBe(dir);
    expect(typeof w.id).toBe('string');
    expect(typeof w.addedAt).toBe('number');
  });

  it('list() returns all workspaces sorted by addedAt', () => {
    const store = new WorkspacesStore(db);
    const a = store.create({ name: 'a', rootPath: dir + '/a-' + Date.now() });
    const b = store.create({ name: 'b', rootPath: dir + '/b-' + Date.now() });
    const list = store.list();
    expect(list.map((w) => w.id)).toEqual([a.id, b.id]);
  });

  it('rename() updates the name', () => {
    const store = new WorkspacesStore(db);
    const w = store.create({ name: 'old', rootPath: dir });
    store.rename(w.id, 'new');
    expect(store.get(w.id)?.name).toBe('new');
  });

  it('delete() removes the workspace and SET NULLs sessions.workspace_id', () => {
    const store = new WorkspacesStore(db);
    const w = store.create({ name: 'a', rootPath: dir });
    db.prepare('INSERT INTO sessions (id, workspace_id) VALUES (?, ?)').run('s1', w.id);
    store.delete(w.id);
    expect(store.get(w.id)).toBeUndefined();
    const row = db.prepare('SELECT workspace_id FROM sessions WHERE id = ?').get('s1') as { workspace_id: string | null };
    expect(row.workspace_id).toBeNull();
  });

  it('create() with duplicate rootPath throws a clean error', () => {
    const store = new WorkspacesStore(db);
    store.create({ name: 'a', rootPath: dir });
    expect(() => store.create({ name: 'b', rootPath: dir })).toThrow(/already/i);
  });

  it('get() returns undefined for unknown id', () => {
    const store = new WorkspacesStore(db);
    expect(store.get('nope')).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run — expect failure**

Run: `pnpm vitest run server/domain/workspaces/workspaces.store.test.ts`
Expected: FAIL "Cannot find module './workspaces.store'".

- [ ] **Step 3: Implement the store**

Create `server/domain/workspaces/workspaces.store.ts`:

```ts
import { randomUUID } from 'node:crypto';
import type { DatabaseHandle } from '@/server/db/database';
import { ValidationError } from '@/server/lib/errors';
import type { Workspace } from './workspaces.types';

interface Row {
  id: string;
  name: string;
  root_path: string;
  added_at: number;
}

function rowToWorkspace(r: Row): Workspace {
  return { id: r.id, name: r.name, rootPath: r.root_path, addedAt: r.added_at };
}

export class WorkspacesStore {
  constructor(private readonly db: DatabaseHandle) {}

  list(): Workspace[] {
    const rows = this.db
      .prepare('SELECT id, name, root_path, added_at FROM workspaces ORDER BY added_at ASC')
      .all() as Row[];
    return rows.map(rowToWorkspace);
  }

  get(id: string): Workspace | undefined {
    const row = this.db
      .prepare('SELECT id, name, root_path, added_at FROM workspaces WHERE id = ?')
      .get(id) as Row | undefined;
    return row ? rowToWorkspace(row) : undefined;
  }

  create(input: { name: string; rootPath: string }): Workspace {
    const id = randomUUID();
    const addedAt = Date.now();
    try {
      this.db
        .prepare('INSERT INTO workspaces (id, name, root_path, added_at) VALUES (?, ?, ?, ?)')
        .run(id, input.name, input.rootPath, addedAt);
    } catch (e: unknown) {
      const msg = (e as { message?: string }).message ?? '';
      if (msg.includes('UNIQUE constraint failed')) {
        throw new ValidationError(`Workspace already exists for path: ${input.rootPath}`);
      }
      throw e;
    }
    return { id, name: input.name, rootPath: input.rootPath, addedAt };
  }

  rename(id: string, name: string): void {
    this.db.prepare('UPDATE workspaces SET name = ? WHERE id = ?').run(name, id);
  }

  delete(id: string): void {
    this.db.prepare('DELETE FROM workspaces WHERE id = ?').run(id);
  }
}
```

- [ ] **Step 4: Run — green**

Run: `pnpm vitest run server/domain/workspaces/workspaces.store.test.ts`
Expected: 6 passing.

- [ ] **Step 5: Commit**

```bash
git add server/domain/workspaces/workspaces.store.ts server/domain/workspaces/workspaces.store.test.ts
git commit -m "feat(slice-23): WorkspacesStore (SQLite-backed CRUD)"
```

---

### Task D1: FilesystemBrowserService

**Files:**
- Create: `server/domain/workspaces/filesystem-browser.service.ts`
- Create: `server/domain/workspaces/filesystem-browser.service.test.ts`

- [ ] **Step 1: Write the failing test**

Create `server/domain/workspaces/filesystem-browser.service.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { FilesystemBrowserService } from './filesystem-browser.service';

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'aether-fsb-'));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('FilesystemBrowserService', () => {
  it('returns subdirectories sorted alphabetically', async () => {
    mkdirSync(join(dir, 'zebra'));
    mkdirSync(join(dir, 'alpha'));
    mkdirSync(join(dir, 'middle'));
    const svc = new FilesystemBrowserService();
    const r = await svc.browse(dir);
    expect(r.map((e) => e.name)).toEqual(['alpha', 'middle', 'zebra']);
    expect(r.every((e) => e.isDir)).toBe(true);
  });

  it('filters out files (only dirs returned)', async () => {
    mkdirSync(join(dir, 'sub'));
    writeFileSync(join(dir, 'file.txt'), 'x');
    const svc = new FilesystemBrowserService();
    const r = await svc.browse(dir);
    expect(r.map((e) => e.name)).toEqual(['sub']);
  });

  it('returns empty array on empty directory', async () => {
    const svc = new FilesystemBrowserService();
    expect(await svc.browse(dir)).toEqual([]);
  });

  it('throws on missing path', async () => {
    const svc = new FilesystemBrowserService();
    await expect(svc.browse(join(dir, 'nope'))).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run — expect failure**

Run: `pnpm vitest run server/domain/workspaces/filesystem-browser.service.test.ts`
Expected: FAIL "Cannot find module './filesystem-browser.service'".

- [ ] **Step 3: Implement the service**

Create `server/domain/workspaces/filesystem-browser.service.ts`:

```ts
import { readdir } from 'node:fs/promises';
import type { BrowseEntry } from './workspaces.types';

export class FilesystemBrowserService {
  async browse(path: string): Promise<BrowseEntry[]> {
    const dirents = await readdir(path, { withFileTypes: true });
    const entries = dirents
      .filter((d) => d.isDirectory())
      .map((d) => ({ name: d.name, isDir: true }));
    entries.sort((a, b) => a.name.localeCompare(b.name));
    return entries;
  }
}
```

- [ ] **Step 4: Run — green**

Run: `pnpm vitest run server/domain/workspaces/filesystem-browser.service.test.ts`
Expected: 4 passing.

- [ ] **Step 5: Commit**

```bash
git add server/domain/workspaces/filesystem-browser.service.ts \
        server/domain/workspaces/filesystem-browser.service.test.ts
git commit -m "feat(slice-23): FilesystemBrowserService (dir-only listing, sorted)"
```

---

### Task E1: HistoryStore — createEmpty({workspaceId}) + setSessionWorkspace + reads include workspaceId

**Files:**
- Modify: `server/domain/history/history.store.ts`
- Modify: `server/domain/history/history.store.test.ts` (add 3 cases)

- [ ] **Step 1: Write the failing tests (extend history.store.test.ts)**

Open `server/domain/history/history.store.test.ts`. Find an existing describe block and append:

```ts
describe('HistoryStore — workspaces (slice 23)', () => {
  it('createEmpty({workspaceId}) writes the FK', async () => {
    const db = makeTestDb();
    // Seed a workspace so the FK is satisfiable.
    db.prepare('INSERT INTO workspaces (id, name, root_path, added_at) VALUES (?, ?, ?, ?)')
      .run('w1', 'proj', '/tmp/proj', Date.now());
    const store = new HistoryStore(db);
    const meta = await store.createEmpty({ workspaceId: 'w1' });
    expect(meta.workspaceId).toBe('w1');
    const row = db.prepare('SELECT workspace_id FROM sessions WHERE id = ?').get(meta.id) as { workspace_id: string };
    expect(row.workspace_id).toBe('w1');
  });

  it('setSessionWorkspace updates the FK', async () => {
    const db = makeTestDb();
    db.prepare('INSERT INTO workspaces (id, name, root_path, added_at) VALUES (?, ?, ?, ?)')
      .run('w1', 'proj', '/tmp/proj', Date.now());
    const store = new HistoryStore(db);
    const meta = await store.createEmpty();
    await store.setSessionWorkspace(meta.id, 'w1');
    const list = await store.listSessions();
    expect(list.find((s) => s.id === meta.id)?.workspaceId).toBe('w1');
    await store.setSessionWorkspace(meta.id, null);
    const list2 = await store.listSessions();
    expect(list2.find((s) => s.id === meta.id)?.workspaceId).toBeUndefined();
  });

  it('listSessions includes workspaceId when set', async () => {
    const db = makeTestDb();
    db.prepare('INSERT INTO workspaces (id, name, root_path, added_at) VALUES (?, ?, ?, ?)')
      .run('w1', 'proj', '/tmp/proj', Date.now());
    const store = new HistoryStore(db);
    await store.createEmpty({ workspaceId: 'w1' });
    const list = await store.listSessions();
    expect(list[0].workspaceId).toBe('w1');
  });
});
```

(`makeTestDb` is the existing helper from `server/test/test-db.ts` that runs all migrations.)

- [ ] **Step 2: Run — expect failure**

Run: `pnpm vitest run server/domain/history/history.store.test.ts`
Expected: new cases fail (createEmpty doesn't yet accept `workspaceId`; `setSessionWorkspace` undefined; listSessions doesn't include `workspaceId`).

- [ ] **Step 3: Extend HistoryStore**

In `server/domain/history/history.store.ts`:

a) Update `listSessions` to also SELECT and map `workspace_id`. Find:

```ts
async listSessions(): Promise<SessionMeta[]> {
  const rows = this.db
    .prepare(
      'SELECT id, title, created_at, updated_at, provider_name FROM sessions ORDER BY updated_at DESC',
    )
```

and change to:

```ts
async listSessions(): Promise<SessionMeta[]> {
  const rows = this.db
    .prepare(
      'SELECT id, title, created_at, updated_at, provider_name, workspace_id FROM sessions ORDER BY updated_at DESC',
    )
```

And update the mapping (a few lines below — the `.map(r => ({...}))` block) to add:

```ts
workspaceId: r.workspace_id ?? undefined,
```

The row type also needs the new column. If there's an inline type like `as { id: string; title: string; created_at: number; updated_at: number; provider_name: string | null }[]`, append `workspace_id: string | null` to it.

b) Update `createEmpty` signature + INSERT:

```ts
async createEmpty(opts?: { providerName?: string; workspaceId?: string }): Promise<SessionMeta> {
  const id = randomUUID();
  const now = Date.now();
  this.db
    .prepare('INSERT INTO sessions (id, title, created_at, updated_at, provider_name, workspace_id) VALUES (?, ?, ?, ?, ?, ?)')
    .run(id, '', now, now, opts?.providerName ?? null, opts?.workspaceId ?? null);
  return {
    id, title: '', createdAt: now, updatedAt: now,
    providerName: opts?.providerName,
    workspaceId: opts?.workspaceId,
  };
}
```

c) Add a new method:

```ts
async setSessionWorkspace(id: string, workspaceId: string | null): Promise<void> {
  this.db
    .prepare('UPDATE sessions SET workspace_id = ? WHERE id = ?')
    .run(workspaceId, id);
}
```

d) For the other `SELECT … FROM sessions` site (around line 98, the `getMeta` method that backs PATCH), make the same column + mapping changes.

- [ ] **Step 4: Run — green**

Run: `pnpm vitest run server/domain/history/history.store.test.ts`
Expected: all existing + 3 new tests pass.

- [ ] **Step 5: Commit**

```bash
git add server/domain/history/history.store.ts server/domain/history/history.store.test.ts
git commit -m "feat(slice-23): HistoryStore reads/writes session.workspaceId; setSessionWorkspace"
```

---

### Task F1: Sessions PATCH route accepts `workspaceId`

**Files:**
- Modify: `server/routes/history.routes.ts` (PatchBody + handler)
- Modify: `server/routes/history.routes.test.ts` (1 new case)

- [ ] **Step 1: Write the failing test (extend history.routes.test.ts)**

Open `server/routes/history.routes.test.ts`. Find the existing PATCH test block and append:

```ts
it('PATCH /:id accepts { workspaceId } and updates the row', async () => {
  const db = makeTestDb();
  db.prepare('INSERT INTO workspaces (id, name, root_path, added_at) VALUES (?, ?, ?, ?)')
    .run('w1', 'proj', '/tmp/proj', Date.now());
  const store = new HistoryStore(db);
  const meta = await store.createEmpty();
  const app = makeApp(store);
  const res = await request(app).patch(`/api/sessions/${meta.id}`).send({ workspaceId: 'w1' });
  expect(res.status).toBe(200);
  const list = await store.listSessions();
  expect(list.find((s) => s.id === meta.id)?.workspaceId).toBe('w1');
});

it('PATCH /:id rejects { workspaceId } for unknown workspace with 400', async () => {
  const db = makeTestDb();
  const store = new HistoryStore(db);
  const meta = await store.createEmpty();
  const app = makeApp(store);
  const res = await request(app).patch(`/api/sessions/${meta.id}`).send({ workspaceId: 'ghost' });
  expect(res.status).toBe(400);
});
```

(`makeApp` is the existing helper that mounts `createHistoryRoutes`; reuse its pattern.)

- [ ] **Step 2: Run — expect failure**

Run: `pnpm vitest run server/routes/history.routes.test.ts`
Expected: new cases fail (PatchBody rejects `workspaceId`).

- [ ] **Step 3: Update PatchBody + handler**

In `server/routes/history.routes.ts`:

a) Top of file, add:

```ts
import { WorkspacesStore } from '@/server/domain/workspaces/workspaces.store';
```

b) Update the schema:

```ts
const PatchBody = z
  .object({
    title: z.string().optional(),
    providerName: z.string().optional(),
    workspaceId: z.union([z.string(), z.null()]).optional(),
  })
  .refine(
    (b) => b.title !== undefined || b.providerName !== undefined || b.workspaceId !== undefined,
    { message: 'At least one field is required' },
  );
```

c) Update `createHistoryRoutes` to accept an optional second arg:

```ts
export function createHistoryRoutes(store: HistoryStore, workspaces?: WorkspacesStore): Router {
```

d) In the PATCH handler, after the `title`/`providerName` branches, add:

```ts
if (parsed.data.workspaceId !== undefined) {
  if (parsed.data.workspaceId !== null && workspaces && !workspaces.get(parsed.data.workspaceId)) {
    throw new ValidationError(`Unknown workspaceId: ${parsed.data.workspaceId}`);
  }
  await store.setSessionWorkspace(req.params.id, parsed.data.workspaceId);
}
```

e) In `server/app.ts`, the call site is `createHistoryRoutes(deps.historyStore)`. Update to:

```ts
createHistoryRoutes(deps.historyStore, deps.workspacesStore)
```

(The `workspacesStore` dep will be added formally in Task H1; using it here is safe since it's optional.)

- [ ] **Step 4: Run — green**

Run: `pnpm vitest run server/routes/history.routes.test.ts`
Expected: green.

- [ ] **Step 5: Commit**

```bash
git add server/routes/history.routes.ts server/routes/history.routes.test.ts server/app.ts
git commit -m "feat(slice-23): PATCH /api/sessions/:id accepts workspaceId"
```

---

### Task G1: workspaces.routes (CRUD + browse + activate-for-session)

**Files:**
- Create: `server/routes/workspaces.routes.ts`
- Create: `server/routes/workspaces.routes.test.ts`

- [ ] **Step 1: Write the failing test**

Create `server/routes/workspaces.routes.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import express from 'express';
import request from 'supertest';
import { createWorkspacesRoutes } from './workspaces.routes';
import { WorkspacesStore } from '@/server/domain/workspaces/workspaces.store';
import { FilesystemBrowserService } from '@/server/domain/workspaces/filesystem-browser.service';
import { makeTestDb } from '@/server/test/test-db';

function makeApp(opts: {
  store?: WorkspacesStore;
  browser?: FilesystemBrowserService;
  historyStore?: {
    setSessionWorkspace?: (id: string, w: string | null) => Promise<void>;
    listSessions?: () => Promise<Array<{ id: string; workspaceId?: string }>>;
  };
  builtinStore?: {
    read: () => Array<{ transport: string; enabled: boolean; fsRoot: string | null }>;
    setFsRoot: (t: string, p: string | null) => void;
  };
  mcpRegistry?: { reconnectBuiltin: (t: string) => Promise<void> };
}) {
  const app = express();
  app.use(express.json());
  app.use('/api/workspaces', createWorkspacesRoutes({
    store: opts.store!,
    browser: opts.browser ?? new FilesystemBrowserService(),
    historyStore: opts.historyStore as any,
    builtinStore: opts.builtinStore as any,
    mcpRegistry: opts.mcpRegistry as any,
  }));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  app.use((err: any, _req: any, res: any, _next: any) => {
    res.status(err.statusCode ?? 500).json({ error: { message: err.message } });
  });
  return app;
}

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'aether-wsroute-')); });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

describe('workspaces.routes', () => {
  it('GET /api/workspaces returns []', async () => {
    const db = makeTestDb();
    const store = new WorkspacesStore(db);
    const res = await request(makeApp({ store })).get('/api/workspaces');
    expect(res.status).toBe(200);
    expect(res.body.workspaces).toEqual([]);
  });

  it('POST /api/workspaces creates and validates path is a directory', async () => {
    const db = makeTestDb();
    const store = new WorkspacesStore(db);
    const res = await request(makeApp({ store })).post('/api/workspaces').send({ name: 'p', rootPath: dir });
    expect(res.status).toBe(201);
    expect(res.body.rootPath).toBe(dir);
  });

  it('POST /api/workspaces rejects non-existent path with 400', async () => {
    const db = makeTestDb();
    const store = new WorkspacesStore(db);
    const res = await request(makeApp({ store })).post('/api/workspaces').send({ name: 'p', rootPath: '/nope/nope' });
    expect(res.status).toBe(400);
  });

  it('POST /api/workspaces rejects duplicate rootPath with 400', async () => {
    const db = makeTestDb();
    const store = new WorkspacesStore(db);
    const app = makeApp({ store });
    await request(app).post('/api/workspaces').send({ name: 'a', rootPath: dir });
    const res = await request(app).post('/api/workspaces').send({ name: 'b', rootPath: dir });
    expect(res.status).toBe(400);
  });

  it('PATCH /api/workspaces/:id renames', async () => {
    const db = makeTestDb();
    const store = new WorkspacesStore(db);
    const created = store.create({ name: 'old', rootPath: dir });
    const res = await request(makeApp({ store })).patch(`/api/workspaces/${created.id}`).send({ name: 'new' });
    expect(res.status).toBe(200);
    expect(store.get(created.id)?.name).toBe('new');
  });

  it('DELETE /api/workspaces/:id removes', async () => {
    const db = makeTestDb();
    const store = new WorkspacesStore(db);
    const created = store.create({ name: 'a', rootPath: dir });
    const res = await request(makeApp({ store })).delete(`/api/workspaces/${created.id}`);
    expect(res.status).toBe(204);
    expect(store.get(created.id)).toBeUndefined();
  });

  it('GET /api/workspaces/browse lists subdirectories of given path', async () => {
    mkdirSync(join(dir, 'a'));
    mkdirSync(join(dir, 'b'));
    const db = makeTestDb();
    const store = new WorkspacesStore(db);
    const res = await request(makeApp({ store })).get('/api/workspaces/browse').query({ path: dir });
    expect(res.status).toBe(200);
    expect(res.body.entries.map((e: { name: string }) => e.name)).toEqual(['a', 'b']);
  });

  it('GET /api/workspaces/browse with no path uses homedir', async () => {
    const db = makeTestDb();
    const store = new WorkspacesStore(db);
    const res = await request(makeApp({ store })).get('/api/workspaces/browse');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.entries)).toBe(true);
  });

  it('GET /api/workspaces/browse with bad path returns 400', async () => {
    const db = makeTestDb();
    const store = new WorkspacesStore(db);
    const res = await request(makeApp({ store })).get('/api/workspaces/browse').query({ path: '/nope/nope' });
    expect(res.status).toBe(400);
  });

  it('POST /api/workspaces/activate-for-session reroots Filesystem MCP when needed', async () => {
    const db = makeTestDb();
    const store = new WorkspacesStore(db);
    const created = store.create({ name: 'p', rootPath: dir });
    const setFsRoot = vi.fn();
    const reconnectBuiltin = vi.fn().mockResolvedValue(undefined);
    const builtinStore = {
      read: () => [{ transport: 'filesystem', enabled: true, fsRoot: '/old' }],
      setFsRoot,
    };
    const historyStore = {
      listSessions: () => Promise.resolve([{ id: 's1', workspaceId: created.id }]),
      setSessionWorkspace: vi.fn().mockResolvedValue(undefined),
    };
    const res = await request(
      makeApp({ store, builtinStore, mcpRegistry: { reconnectBuiltin }, historyStore }),
    )
      .post('/api/workspaces/activate-for-session')
      .send({ sessionId: 's1' });
    expect(res.status).toBe(200);
    expect(res.body.rooted).toBe(dir);
    expect(setFsRoot).toHaveBeenCalledWith('filesystem', dir);
    expect(reconnectBuiltin).toHaveBeenCalledWith('filesystem');
  });

  it('POST activate-for-session skips reroot when filesystem MCP is disabled', async () => {
    const db = makeTestDb();
    const store = new WorkspacesStore(db);
    const created = store.create({ name: 'p', rootPath: dir });
    const setFsRoot = vi.fn();
    const reconnectBuiltin = vi.fn();
    const builtinStore = {
      read: () => [{ transport: 'filesystem', enabled: false, fsRoot: null }],
      setFsRoot,
    };
    const historyStore = {
      listSessions: () => Promise.resolve([{ id: 's1', workspaceId: created.id }]),
      setSessionWorkspace: vi.fn(),
    };
    const res = await request(
      makeApp({ store, builtinStore, mcpRegistry: { reconnectBuiltin: vi.fn() }, historyStore }),
    )
      .post('/api/workspaces/activate-for-session')
      .send({ sessionId: 's1' });
    expect(res.status).toBe(200);
    expect(res.body.rooted).toBeNull();
    expect(setFsRoot).not.toHaveBeenCalled();
    expect(reconnectBuiltin).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run — expect failure**

Run: `pnpm vitest run server/routes/workspaces.routes.test.ts`
Expected: FAIL "Cannot find module './workspaces.routes'".

- [ ] **Step 3: Implement the routes**

Create `server/routes/workspaces.routes.ts`:

```ts
import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import fs from 'node:fs';
import os from 'node:os';
import { ValidationError } from '@/server/lib/errors';
import type { WorkspacesStore } from '@/server/domain/workspaces/workspaces.store';
import type { FilesystemBrowserService } from '@/server/domain/workspaces/filesystem-browser.service';
import type { HistoryStore } from '@/server/domain/history/history.store';
import type { BuiltinMcpStore } from '@/server/domain/mcp/builtin/builtin.store';
import type { McpRegistry } from '@/server/domain/mcp/registry';

function asyncHandler(fn: (req: Request, res: Response, next: NextFunction) => Promise<void>) {
  return (req: Request, res: Response, next: NextFunction) => {
    fn(req, res, next).catch(next);
  };
}

const CreateBody = z.object({ name: z.string().min(1), rootPath: z.string().min(1) });
const RenameBody = z.object({ name: z.string().min(1) });
const ActivateBody = z.object({ sessionId: z.string().min(1) });

export interface WorkspacesRoutesDeps {
  store: WorkspacesStore;
  browser: FilesystemBrowserService;
  historyStore: HistoryStore;
  builtinStore: BuiltinMcpStore;
  mcpRegistry: McpRegistry;
}

export function createWorkspacesRoutes(deps: WorkspacesRoutesDeps): Router {
  const router = Router();

  router.get('/', (_req, res) => {
    res.json({ workspaces: deps.store.list() });
  });

  router.post(
    '/',
    asyncHandler(async (req, res) => {
      const parsed = CreateBody.safeParse(req.body);
      if (!parsed.success) throw new ValidationError('Invalid body', parsed.error);
      // Validate path exists + is a directory before storing.
      try {
        const stat = fs.statSync(parsed.data.rootPath);
        if (!stat.isDirectory()) throw new ValidationError('rootPath must be a directory');
      } catch (e) {
        if (e instanceof ValidationError) throw e;
        throw new ValidationError(`rootPath does not exist: ${parsed.data.rootPath}`);
      }
      const w = deps.store.create(parsed.data);
      res.status(201).json(w);
    }),
  );

  router.patch(
    '/:id',
    asyncHandler(async (req, res) => {
      const parsed = RenameBody.safeParse(req.body);
      if (!parsed.success) throw new ValidationError('Invalid body', parsed.error);
      if (!deps.store.get(req.params.id)) throw new ValidationError('Unknown workspace');
      deps.store.rename(req.params.id, parsed.data.name);
      res.json(deps.store.get(req.params.id));
    }),
  );

  router.delete(
    '/:id',
    asyncHandler(async (req, res) => {
      deps.store.delete(req.params.id);
      res.status(204).end();
    }),
  );

  router.get(
    '/browse',
    asyncHandler(async (req, res) => {
      let path = typeof req.query.path === 'string' && req.query.path.length > 0
        ? req.query.path
        : (os.homedir?.() ?? process.cwd());
      try {
        const entries = await deps.browser.browse(path);
        res.json({ entries });
      } catch (e: unknown) {
        throw new ValidationError(
          `Cannot list directory: ${(e as { message?: string }).message ?? String(e)}`,
        );
      }
    }),
  );

  router.post(
    '/activate-for-session',
    asyncHandler(async (req, res) => {
      const parsed = ActivateBody.safeParse(req.body);
      if (!parsed.success) throw new ValidationError('Invalid body', parsed.error);
      const sessions = await deps.historyStore.listSessions();
      const session = sessions.find((s) => s.id === parsed.data.sessionId);
      const workspaceId = session?.workspaceId;
      const workspace = workspaceId ? deps.store.get(workspaceId) : undefined;
      const targetRoot = workspace?.rootPath ?? null;

      const fsRow = deps.builtinStore.read().find((r) => r.transport === 'filesystem');
      if (!fsRow || !fsRow.enabled) {
        res.json({ rooted: null });
        return;
      }
      if (targetRoot === null || targetRoot === fsRow.fsRoot) {
        res.json({ rooted: targetRoot });
        return;
      }
      deps.builtinStore.setFsRoot('filesystem', targetRoot);
      await deps.mcpRegistry.reconnectBuiltin('filesystem');
      res.json({ rooted: targetRoot });
    }),
  );

  return router;
}
```

- [ ] **Step 4: Run — green**

Run: `pnpm vitest run server/routes/workspaces.routes.test.ts`
Expected: 10 passing.

- [ ] **Step 5: Commit**

```bash
git add server/routes/workspaces.routes.ts server/routes/workspaces.routes.test.ts
git commit -m "feat(slice-23): workspaces routes (CRUD + browse + activate-for-session)"
```

---

### Task H1: app.ts + bootstrap wiring

**Files:**
- Modify: `server/app.ts`
- Modify: `server/index.ts`

- [ ] **Step 1: Extend AppDeps + mount routes**

In `server/app.ts`:

a) Top of file imports:

```ts
import type { WorkspacesStore } from '@/server/domain/workspaces/workspaces.store';
import type { FilesystemBrowserService } from '@/server/domain/workspaces/filesystem-browser.service';
import { createWorkspacesRoutes } from './routes/workspaces.routes';
```

b) In `AppDeps`, add:

```ts
workspacesStore?: WorkspacesStore;
filesystemBrowser?: FilesystemBrowserService;
```

c) After the `if (deps.policyStore && deps.previewService) { … }` block (slice 22), add:

```ts
if (
  deps.workspacesStore &&
  deps.filesystemBrowser &&
  deps.historyStore &&
  deps.builtinStore &&
  deps.mcpRegistry
) {
  app.use(
    '/api/workspaces',
    createWorkspacesRoutes({
      store: deps.workspacesStore,
      browser: deps.filesystemBrowser,
      historyStore: deps.historyStore,
      builtinStore: deps.builtinStore,
      mcpRegistry: deps.mcpRegistry,
    }),
  );
}
```

- [ ] **Step 2: Wire in bootstrap**

In `server/index.ts`:

a) Imports near other domain imports:

```ts
import { WorkspacesStore } from './domain/workspaces/workspaces.store';
import { FilesystemBrowserService } from './domain/workspaces/filesystem-browser.service';
```

b) After the `const breakpointService = ...` line, add:

```ts
const workspacesStore = new WorkspacesStore(db);
const filesystemBrowser = new FilesystemBrowserService();
```

c) In the `createApp({ ... })` call, add the two new keys at the end:

```ts
workspacesStore,
filesystemBrowser,
```

- [ ] **Step 3: Typecheck**

Run: `pnpm lint`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add server/app.ts server/index.ts
git commit -m "feat(slice-23): bootstrap wiring for WorkspacesStore + FilesystemBrowserService"
```

---

### Task I1: FE types + workspaces.api + sessions.api.updateSession + MSW

**Files:**
- Create: `src/types/workspace.types.ts`
- Create: `src/lib/api/workspaces.api.ts`
- Create: `src/lib/api/workspaces.api.test.ts`
- Modify: `src/lib/api/sessions.api.ts` (generalize renameSession → updateSession)
- Modify: `src/test/msw-handlers.ts`

- [ ] **Step 1: Mirror server types**

Create `src/types/workspace.types.ts`:

```ts
export interface Workspace {
  id: string;
  name: string;
  rootPath: string;
  addedAt: number;
}

export interface BrowseEntry {
  name: string;
  isDir: boolean;
}
```

- [ ] **Step 2: Write the failing api test**

Create `src/lib/api/workspaces.api.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { workspacesApi } from './workspaces.api';

describe('workspacesApi (against MSW defaults)', () => {
  it('list returns []', async () => {
    expect(await workspacesApi.list()).toEqual([]);
  });

  it('create returns the created row', async () => {
    const w = await workspacesApi.create({ name: 'p', rootPath: '/tmp/p' });
    expect(w.name).toBe('p');
    expect(w.rootPath).toBe('/tmp/p');
  });

  it('rename returns the updated row', async () => {
    const w = await workspacesApi.rename('w1', 'renamed');
    expect(w.name).toBe('renamed');
  });

  it('remove resolves with no body', async () => {
    await expect(workspacesApi.remove('w1')).resolves.toBeUndefined();
  });

  it('browse returns entries', async () => {
    const r = await workspacesApi.browse('/tmp');
    expect(Array.isArray(r)).toBe(true);
  });

  it('activateForSession returns rooted', async () => {
    const r = await workspacesApi.activateForSession('s1');
    expect(r).toHaveProperty('rooted');
  });
});
```

- [ ] **Step 3: Add MSW handlers**

In `src/test/msw-handlers.ts`, add inside the `handlers` array (near other endpoints):

```ts
http.get('http://localhost/api/workspaces', () =>
  HttpResponse.json({ workspaces: [] }),
),
http.post('http://localhost/api/workspaces', async ({ request }) => {
  const body = (await request.json()) as { name: string; rootPath: string };
  return HttpResponse.json(
    { id: `w-${Date.now()}`, name: body.name, rootPath: body.rootPath, addedAt: Date.now() },
    { status: 201 },
  );
}),
http.patch('http://localhost/api/workspaces/:id', async ({ params, request }) => {
  const body = (await request.json()) as { name: string };
  return HttpResponse.json({
    id: params.id,
    name: body.name,
    rootPath: '/tmp/p',
    addedAt: Date.now(),
  });
}),
http.delete('http://localhost/api/workspaces/:id', () =>
  new HttpResponse(null, { status: 204 }),
),
http.get('http://localhost/api/workspaces/browse', () =>
  HttpResponse.json({ entries: [{ name: 'sub', isDir: true }] }),
),
http.post('http://localhost/api/workspaces/activate-for-session', () =>
  HttpResponse.json({ rooted: null }),
),
```

- [ ] **Step 4: Implement workspaces.api**

Create `src/lib/api/workspaces.api.ts`:

```ts
import type { Workspace, BrowseEntry } from '@/src/types/workspace.types';

async function jsonOrThrow<T>(res: Response): Promise<T> {
  if (!res.ok) throw new Error(`Request failed: ${res.status}`);
  return (await res.json()) as T;
}

export const workspacesApi = {
  list: async (): Promise<Workspace[]> => {
    const r = await jsonOrThrow<{ workspaces: Workspace[] }>(await fetch('/api/workspaces'));
    return r.workspaces;
  },

  create: async (input: { name: string; rootPath: string }): Promise<Workspace> =>
    jsonOrThrow<Workspace>(
      await fetch('/api/workspaces', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      }),
    ),

  rename: async (id: string, name: string): Promise<Workspace> =>
    jsonOrThrow<Workspace>(
      await fetch(`/api/workspaces/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      }),
    ),

  remove: async (id: string): Promise<void> => {
    const res = await fetch(`/api/workspaces/${id}`, { method: 'DELETE' });
    if (!res.ok) throw new Error(`Request failed: ${res.status}`);
  },

  browse: async (path?: string): Promise<BrowseEntry[]> => {
    const qs = path ? `?path=${encodeURIComponent(path)}` : '';
    const r = await jsonOrThrow<{ entries: BrowseEntry[] }>(
      await fetch(`/api/workspaces/browse${qs}`),
    );
    return r.entries;
  },

  activateForSession: async (sessionId: string): Promise<{ rooted: string | null }> =>
    jsonOrThrow<{ rooted: string | null }>(
      await fetch('/api/workspaces/activate-for-session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId }),
      }),
    ),
};
```

- [ ] **Step 5: Extend sessions.api with updateSession**

In `src/lib/api/sessions.api.ts`, after the existing `renameSession` function add:

```ts
export async function updateSession(
  id: string,
  patch: { title?: string; workspaceId?: string | null },
): Promise<{ id: string; title: string; createdAt: number; updatedAt: number }> {
  const res = await fetch(`${BASE}/${id}`, json('PATCH', patch));
  if (!res.ok) throw new Error(`Request failed: ${res.status}`);
  return res.json() as Promise<{ id: string; title: string; createdAt: number; updatedAt: number }>;
}
```

Also add a MSW handler if a PATCH for sessions doesn't already accept arbitrary bodies — check `msw-handlers.ts`. If it already returns a generic shape on PATCH, no change needed.

- [ ] **Step 6: Run — green**

Run: `pnpm vitest run src/lib/api/workspaces.api.test.ts`
Expected: 6 passing.

- [ ] **Step 7: Commit**

```bash
git add src/types/workspace.types.ts src/lib/api/workspaces.api.ts \
        src/lib/api/workspaces.api.test.ts src/lib/api/sessions.api.ts \
        src/test/msw-handlers.ts
git commit -m "feat(slice-23): FE workspace types + workspaces.api + sessions.api.updateSession + MSW"
```

---

### Task J1: workspaces.store

**Files:**
- Create: `src/stores/workspaces.store.ts`
- Create: `src/stores/workspaces.store.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/stores/workspaces.store.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { useWorkspacesStore } from './workspaces.store';

describe('useWorkspacesStore', () => {
  beforeEach(() => {
    useWorkspacesStore.getState()._reset();
  });

  it('init() populates from server (default []) ', async () => {
    await useWorkspacesStore.getState().init();
    expect(useWorkspacesStore.getState().workspaces).toEqual([]);
  });

  it('create() appends to the local list', async () => {
    await useWorkspacesStore.getState().init();
    await useWorkspacesStore.getState().create({ name: 'p', rootPath: '/tmp/p' });
    expect(useWorkspacesStore.getState().workspaces).toHaveLength(1);
    expect(useWorkspacesStore.getState().workspaces[0].name).toBe('p');
  });

  it('rename() updates the local row', async () => {
    await useWorkspacesStore.getState().init();
    const w = await useWorkspacesStore.getState().create({ name: 'a', rootPath: '/tmp/a' });
    await useWorkspacesStore.getState().rename(w.id, 'b');
    expect(useWorkspacesStore.getState().workspaces[0].name).toBe('b');
  });

  it('remove() removes locally even on missing id', async () => {
    await useWorkspacesStore.getState().init();
    const w = await useWorkspacesStore.getState().create({ name: 'a', rootPath: '/tmp/a' });
    await useWorkspacesStore.getState().remove(w.id);
    expect(useWorkspacesStore.getState().workspaces).toEqual([]);
  });

  it('init() failure surfaces in error', async () => {
    const orig = global.fetch;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    global.fetch = (() => Promise.resolve(new Response('', { status: 500 }))) as any;
    await useWorkspacesStore.getState().init();
    expect(useWorkspacesStore.getState().error).toBeTruthy();
    expect(useWorkspacesStore.getState().loading).toBe(false);
    global.fetch = orig;
  });
});
```

- [ ] **Step 2: Run — expect failure**

Run: `pnpm vitest run src/stores/workspaces.store.test.ts`
Expected: FAIL "Cannot find module './workspaces.store'".

- [ ] **Step 3: Implement the store**

Create `src/stores/workspaces.store.ts`:

```ts
import { create } from 'zustand';
import { workspacesApi } from '@/src/lib/api/workspaces.api';
import type { Workspace } from '@/src/types/workspace.types';

interface WorkspacesState {
  workspaces: Workspace[];
  loading: boolean;
  error: string | null;
  init(): Promise<void>;
  create(input: { name: string; rootPath: string }): Promise<Workspace>;
  rename(id: string, name: string): Promise<void>;
  remove(id: string): Promise<void>;
  _reset(): void;
}

const initial = {
  workspaces: [] as Workspace[],
  loading: false,
  error: null as string | null,
};

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : 'Operation failed';
}

const inflight = new Map<string, Promise<unknown>>();

export const useWorkspacesStore = create<WorkspacesState>((set, get) => ({
  ...initial,
  _reset: () => { inflight.clear(); set(initial); },
  init: async () => {
    set({ loading: true, error: null });
    try {
      const workspaces = await workspacesApi.list();
      set({ workspaces, loading: false, error: null });
    } catch (e) {
      set({ loading: false, error: errMsg(e) });
    }
  },
  create: async (input) => {
    set({ loading: true, error: null });
    try {
      const w = await workspacesApi.create(input);
      set((s) => ({ workspaces: [...s.workspaces, w], loading: false }));
      return w;
    } catch (e) {
      set({ loading: false, error: errMsg(e) });
      throw e;
    }
  },
  rename: async (id, name) => {
    const key = `rename:${id}`;
    const existing = inflight.get(key);
    if (existing) { await existing.catch(() => {}); return; }
    const promise = workspacesApi.rename(id, name);
    inflight.set(key, promise);
    try {
      const updated = await promise;
      set((s) => ({
        workspaces: s.workspaces.map((w) => (w.id === id ? { ...w, name: updated.name } : w)),
      }));
    } catch (e) {
      set({ error: errMsg(e) });
    } finally {
      inflight.delete(key);
    }
  },
  remove: async (id) => {
    try {
      await workspacesApi.remove(id);
    } catch {
      // Idempotent: still remove locally if the server says it's gone.
    }
    set((s) => ({ workspaces: s.workspaces.filter((w) => w.id !== id) }));
    void get;
  },
}));
```

- [ ] **Step 4: Run — green**

Run: `pnpm vitest run src/stores/workspaces.store.test.ts`
Expected: 5 passing.

- [ ] **Step 5: Commit**

```bash
git add src/stores/workspaces.store.ts src/stores/workspaces.store.test.ts
git commit -m "feat(slice-23): workspaces store with per-rename dedupe"
```

---

### Task K1: sessions.store extensions (activation on setActive + setSessionWorkspace + createSession inheritance)

**Files:**
- Modify: `src/stores/sessions.store.ts`
- Modify: `src/stores/sessions.store.test.ts` (add 2 cases)

- [ ] **Step 1: Write the failing tests (extend sessions.store.test.ts)**

Open `src/stores/sessions.store.test.ts`. Append a new describe block:

```ts
import { workspacesApi } from '@/src/lib/api/workspaces.api';
// (if already imported at top, skip)

describe('useSessionsStore — workspaces (slice 23)', () => {
  beforeEach(() => useSessionsStore.getState()._reset?.());

  it('setSessionWorkspace PATCHes then calls activateForSession', async () => {
    const spy = vi.spyOn(workspacesApi, 'activateForSession').mockResolvedValue({ rooted: '/x' });
    // Seed the store with a session.
    useSessionsStore.setState({
      sessions: [{ id: 's1', title: 't', createdAt: 0, updatedAt: 0 }],
      activeSessionId: 's1',
    } as Partial<ReturnType<typeof useSessionsStore.getState>>);
    await useSessionsStore.getState().setSessionWorkspace('s1', 'w1');
    expect(useSessionsStore.getState().sessions[0].workspaceId).toBe('w1');
    expect(spy).toHaveBeenCalledWith('s1');
    spy.mockRestore();
  });

  it('setActive calls workspacesApi.activateForSession (non-fatal on error)', async () => {
    const spy = vi.spyOn(workspacesApi, 'activateForSession').mockRejectedValue(new Error('nope'));
    useSessionsStore.setState({
      sessions: [
        { id: 's1', title: 't1', createdAt: 0, updatedAt: 0 },
        { id: 's2', title: 't2', createdAt: 0, updatedAt: 0 },
      ],
      activeSessionId: 's1',
    } as Partial<ReturnType<typeof useSessionsStore.getState>>);
    useSessionsStore.getState().setActive('s2');
    // Yield microtasks
    await Promise.resolve();
    await Promise.resolve();
    expect(spy).toHaveBeenCalledWith('s2');
    expect(useSessionsStore.getState().activeSessionId).toBe('s2');
    spy.mockRestore();
  });
});
```

(Add the `import { vi } from 'vitest'` at the top if missing.)

- [ ] **Step 2: Run — expect failure**

Run: `pnpm vitest run src/stores/sessions.store.test.ts`
Expected: new cases fail (no `setSessionWorkspace`; `setActive` doesn't call `activateForSession`).

- [ ] **Step 3: Extend sessions.store.ts**

In `src/stores/sessions.store.ts`:

a) Top of file imports:

```ts
import { workspacesApi } from '@/src/lib/api/workspaces.api';
import { updateSession as updateSessionApi } from '@/src/lib/api/sessions.api';
```

(If `updateSession` doesn't exist yet, this is from Task I1.)

b) In the state interface, add:

```ts
setSessionWorkspace: (sessionId: string, workspaceId: string | null) => Promise<void>;
```

c) In the store body, add the implementation (place near `rename`):

```ts
setSessionWorkspace: async (sessionId, workspaceId) => {
  await updateSessionApi(sessionId, { workspaceId });
  set((s) => ({
    sessions: s.sessions.map((x) =>
      x.id === sessionId ? { ...x, workspaceId: workspaceId ?? undefined } : x,
    ),
  }));
  workspacesApi.activateForSession(sessionId).catch(() => {});
},
```

d) In the existing `setActive(id)` action, after the local state update + history hydrate (look for `historyApi.fetchById(id).then(...)`), add a fire-and-forget call:

```ts
// Reroot Filesystem MCP if this session has a different workspace.
workspacesApi.activateForSession(id).catch(() => {});
```

Place it after `persistActive(id);` and before `historyApi.fetchById(id)…`.

e) Update `createSession`/`create` (the action that POSTs a new session) to read the current active session's `workspaceId` and pass it in the POST body. Find the existing POST call to sessions:

```ts
const res = await fetch(`${BASE}`, json('POST', {}));
```

(or similar — likely going through `sessionsApi.create()`). The simplest change: extend `sessionsApi.create()` to accept an optional `workspaceId`:

In `src/lib/api/sessions.api.ts`:

```ts
export async function createSession(opts?: { workspaceId?: string }): Promise<SessionMeta> {
  const res = await fetch(BASE, json('POST', opts ?? {}));
  if (!res.ok) throw new Error(`Request failed: ${res.status}`);
  return res.json() as Promise<SessionMeta>;
}
```

Then in `src/stores/sessions.store.ts` `create` action:

```ts
const active = get().sessions.find((s) => s.id === get().activeSessionId);
const meta = await sessionsApi.createSession(active?.workspaceId ? { workspaceId: active.workspaceId } : undefined);
```

(Match whatever the existing call is — keep the rest of the action intact.)

Also update the server's POST `/api/sessions` handler to accept `{ workspaceId }` in the body and pass it to `createEmpty`:

In `server/routes/history.routes.ts`:

```ts
router.post(
  '/',
  asyncHandler(async (req, res) => {
    const body = (req.body ?? {}) as { workspaceId?: string };
    const meta = await store.createEmpty(body.workspaceId ? { workspaceId: body.workspaceId } : undefined);
    res.status(201).json(meta);
  }),
);
```

- [ ] **Step 4: Run — green**

Run: `pnpm vitest run src/stores/sessions.store.test.ts`
Expected: green (existing + 2 new).

- [ ] **Step 5: Commit**

```bash
git add src/stores/sessions.store.ts src/stores/sessions.store.test.ts \
        src/lib/api/sessions.api.ts server/routes/history.routes.ts
git commit -m "feat(slice-23): sessions store activation on setActive + setSessionWorkspace + new-session inheritance"
```

---

### Task L1: ui.store workspaceBrowserOpen

**Files:**
- Modify: `src/stores/ui.store.ts`
- Modify: `src/stores/ui.store.test.ts` (add 1 case)

- [ ] **Step 1: Extend ui.store**

In `src/stores/ui.store.ts`:

a) In the state interface, add:

```ts
workspaceBrowserOpen: boolean;
openWorkspaceBrowser(): void;
closeWorkspaceBrowser(): void;
```

b) In `initial`:

```ts
workspaceBrowserOpen: false,
```

c) In the store body:

```ts
openWorkspaceBrowser: () => set({ workspaceBrowserOpen: true }),
closeWorkspaceBrowser: () => set({ workspaceBrowserOpen: false }),
```

- [ ] **Step 2: Extend tests**

In `src/stores/ui.store.test.ts`, add:

```ts
describe('useUiStore.workspaceBrowserOpen', () => {
  it('opens and closes', () => {
    useUiStore.getState().openWorkspaceBrowser();
    expect(useUiStore.getState().workspaceBrowserOpen).toBe(true);
    useUiStore.getState().closeWorkspaceBrowser();
    expect(useUiStore.getState().workspaceBrowserOpen).toBe(false);
  });
});
```

- [ ] **Step 3: Run — green**

Run: `pnpm vitest run src/stores/ui.store.test.ts`
Expected: green.

- [ ] **Step 4: Commit**

```bash
git add src/stores/ui.store.ts src/stores/ui.store.test.ts
git commit -m "feat(slice-23): ui.store.workspaceBrowserOpen"
```

---

### Task M1: WorkspacesSection sidebar component

**Files:**
- Create: `src/components/sidebar/WorkspacesSection.tsx`
- Create: `src/components/sidebar/WorkspacesSection.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `src/components/sidebar/WorkspacesSection.test.tsx`:

```tsx
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { useWorkspacesStore } from '@/src/stores/workspaces.store';
import { useUiStore } from '@/src/stores/ui.store';
import { WorkspacesSection } from './WorkspacesSection';

describe('WorkspacesSection', () => {
  beforeEach(() => {
    useWorkspacesStore.getState()._reset();
    useUiStore.getState().closeWorkspaceBrowser();
  });

  it('renders existing workspaces', () => {
    useWorkspacesStore.setState({
      workspaces: [
        { id: 'w1', name: 'proj-1', rootPath: '/tmp/p1', addedAt: 0 },
        { id: 'w2', name: 'proj-2', rootPath: '/tmp/p2', addedAt: 1 },
      ],
    });
    render(<WorkspacesSection />);
    expect(screen.getByText('proj-1')).toBeInTheDocument();
    expect(screen.getByText('proj-2')).toBeInTheDocument();
  });

  it('clicking + Add workspace… opens the browser modal', () => {
    render(<WorkspacesSection />);
    fireEvent.click(screen.getByRole('button', { name: /add workspace/i }));
    expect(useUiStore.getState().workspaceBrowserOpen).toBe(true);
  });

  it('shows a delete button per row that calls remove', async () => {
    useWorkspacesStore.setState({
      workspaces: [{ id: 'w1', name: 'p', rootPath: '/tmp/p', addedAt: 0 }],
    });
    render(<WorkspacesSection />);
    fireEvent.click(screen.getByLabelText(/delete p/i));
    // Workspace removed from local list (idempotent remove)
    await Promise.resolve();
    await Promise.resolve();
    expect(useWorkspacesStore.getState().workspaces).toEqual([]);
  });
});
```

- [ ] **Step 2: Run — expect failure**

Run: `pnpm vitest run src/components/sidebar/WorkspacesSection.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implement**

Create `src/components/sidebar/WorkspacesSection.tsx`:

```tsx
import { useWorkspacesStore } from '@/src/stores/workspaces.store';
import { useUiStore } from '@/src/stores/ui.store';

export function WorkspacesSection() {
  const workspaces = useWorkspacesStore((s) => s.workspaces);
  const remove = useWorkspacesStore((s) => s.remove);
  const openBrowser = useUiStore((s) => s.openWorkspaceBrowser);

  return (
    <section>
      <div className="flex items-center justify-between mb-2">
        <span className="mono-label">Workspaces</span>
        <button
          type="button"
          onClick={openBrowser}
          className="text-[10px] text-accent hover:underline"
        >
          + Add workspace…
        </button>
      </div>
      <div className="space-y-1">
        {workspaces.map((w) => (
          <div
            key={w.id}
            data-testid="workspace-row"
            className="group flex items-center gap-2 p-1.5 bg-zinc-900 border border-border-subtle rounded text-[10px] font-mono"
          >
            <span className="text-zinc-300 flex-1 truncate">{w.name}</span>
            <span className="text-zinc-600 truncate" title={w.rootPath}>
              {w.rootPath}
            </span>
            <button
              type="button"
              aria-label={`delete ${w.name}`}
              onClick={() => void remove(w.id)}
              className="hidden group-hover:flex text-zinc-500 hover:text-rose-400 px-1"
            >
              ×
            </button>
          </div>
        ))}
      </div>
    </section>
  );
}
```

- [ ] **Step 4: Run — green**

Run: `pnpm vitest run src/components/sidebar/WorkspacesSection.test.tsx`
Expected: 3 passing.

- [ ] **Step 5: Commit**

```bash
git add src/components/sidebar/WorkspacesSection.tsx \
        src/components/sidebar/WorkspacesSection.test.tsx
git commit -m "feat(slice-23): WorkspacesSection sidebar"
```

---

### Task N1: WorkspaceBrowserModal

**Files:**
- Create: `src/components/workspaces/WorkspaceBrowserModal.tsx`
- Create: `src/components/workspaces/WorkspaceBrowserModal.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `src/components/workspaces/WorkspaceBrowserModal.test.tsx`:

```tsx
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { useUiStore } from '@/src/stores/ui.store';
import { useWorkspacesStore } from '@/src/stores/workspaces.store';
import { WorkspaceBrowserModal } from './WorkspaceBrowserModal';

vi.mock('@/src/lib/api/workspaces.api', () => ({
  workspacesApi: {
    browse: vi.fn().mockResolvedValue([
      { name: 'sub-a', isDir: true },
      { name: 'sub-b', isDir: true },
    ]),
    create: vi.fn().mockResolvedValue({
      id: 'w1', name: 'sub-a', rootPath: '/start/sub-a', addedAt: 0,
    }),
  },
}));

describe('WorkspaceBrowserModal', () => {
  beforeEach(() => {
    useUiStore.getState().closeWorkspaceBrowser();
    useWorkspacesStore.getState()._reset();
  });

  it('renders null when closed', () => {
    const { container } = render(<WorkspaceBrowserModal />);
    expect(container.firstChild).toBeNull();
  });

  it('lists browse entries when open', async () => {
    useUiStore.getState().openWorkspaceBrowser();
    render(<WorkspaceBrowserModal />);
    await waitFor(() => expect(screen.getByText('sub-a')).toBeInTheDocument());
    expect(screen.getByText('sub-b')).toBeInTheDocument();
  });

  it('clicking a folder descends into it', async () => {
    const { workspacesApi } = await import('@/src/lib/api/workspaces.api');
    useUiStore.getState().openWorkspaceBrowser();
    render(<WorkspaceBrowserModal />);
    await waitFor(() => screen.getByText('sub-a'));
    fireEvent.click(screen.getByText('sub-a'));
    await waitFor(() => expect(workspacesApi.browse).toHaveBeenCalledTimes(2));
  });

  it('"Add this folder" calls create and closes', async () => {
    const { workspacesApi } = await import('@/src/lib/api/workspaces.api');
    useUiStore.getState().openWorkspaceBrowser();
    render(<WorkspaceBrowserModal />);
    await waitFor(() => screen.getByText('Add this folder'));
    fireEvent.click(screen.getByText('Add this folder'));
    await waitFor(() => expect(workspacesApi.create).toHaveBeenCalled());
    expect(useUiStore.getState().workspaceBrowserOpen).toBe(false);
  });

  it('Escape closes without creating', async () => {
    useUiStore.getState().openWorkspaceBrowser();
    render(<WorkspaceBrowserModal />);
    await waitFor(() => screen.getByText('sub-a'));
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(useUiStore.getState().workspaceBrowserOpen).toBe(false);
  });
});
```

- [ ] **Step 2: Run — expect failure**

Run: `pnpm vitest run src/components/workspaces/WorkspaceBrowserModal.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implement**

Create `src/components/workspaces/WorkspaceBrowserModal.tsx`:

```tsx
import { useCallback, useEffect, useState } from 'react';
import { useUiStore } from '@/src/stores/ui.store';
import { useWorkspacesStore } from '@/src/stores/workspaces.store';
import { workspacesApi } from '@/src/lib/api/workspaces.api';
import type { BrowseEntry } from '@/src/types/workspace.types';

function basename(p: string): string {
  const trimmed = p.replace(/\/+$/, '');
  const idx = trimmed.lastIndexOf('/');
  return idx >= 0 ? trimmed.slice(idx + 1) : trimmed;
}

function parentOf(p: string): string {
  const trimmed = p.replace(/\/+$/, '');
  const idx = trimmed.lastIndexOf('/');
  return idx > 0 ? trimmed.slice(0, idx) : '/';
}

export function WorkspaceBrowserModal() {
  const open = useUiStore((s) => s.workspaceBrowserOpen);
  const close = useUiStore((s) => s.closeWorkspaceBrowser);
  const createWorkspace = useWorkspacesStore((s) => s.create);

  const [currentPath, setCurrentPath] = useState<string>('');
  const [entries, setEntries] = useState<BrowseEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState<string>('');

  const loadPath = useCallback(async (path?: string) => {
    setError(null);
    try {
      const r = await workspacesApi.browse(path);
      setEntries(r);
      if (path) setCurrentPath(path);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Cannot list directory');
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    setCurrentPath('');
    setEntries([]);
    setName('');
    void loadPath();
  }, [open, loadPath]);

  useEffect(() => {
    setName(basename(currentPath));
  }, [currentPath]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, close]);

  if (!open) return null;

  const descend = (subName: string) => {
    const next = currentPath ? `${currentPath.replace(/\/+$/, '')}/${subName}` : subName;
    void loadPath(next);
  };

  const goUp = () => {
    if (!currentPath) return;
    void loadPath(parentOf(currentPath));
  };

  const add = async () => {
    if (!currentPath || !name.trim()) return;
    try {
      await createWorkspace({ name: name.trim(), rootPath: currentPath });
      close();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Cannot create workspace');
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      onClick={close}
    >
      <div
        className="w-[640px] max-w-[90vw] max-h-[85vh] flex flex-col rounded border border-border-subtle bg-surface-1 p-4 text-sm"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-2 flex items-center gap-2">
          <button
            type="button"
            onClick={goUp}
            disabled={!currentPath}
            className="text-zinc-400 hover:text-zinc-200 disabled:opacity-30 text-[12px]"
          >
            ↑ Up
          </button>
          <span className="text-zinc-300 font-mono text-[11px] truncate flex-1">
            {currentPath || '(home)'}
          </span>
        </div>

        {error && <div className="mb-2 text-rose-400 text-[11px]">{error}</div>}

        <div className="flex-1 overflow-y-auto border border-border-subtle rounded bg-zinc-950 mb-3">
          {entries.length === 0 && (
            <div className="p-2 text-zinc-600 text-[11px]">No subdirectories</div>
          )}
          {entries.map((e) => (
            <button
              key={e.name}
              type="button"
              onClick={() => descend(e.name)}
              className="block w-full text-left px-2 py-1 text-zinc-300 hover:bg-zinc-800 font-mono text-[11px]"
            >
              📁 {e.name}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2 mb-3">
          <label className="text-zinc-400 text-[11px]">Name</label>
          <input
            type="text"
            value={name}
            onChange={(ev) => setName(ev.target.value)}
            className="flex-1 bg-zinc-950 border border-border-subtle text-zinc-300 rounded px-2 py-1 font-mono text-[11px]"
          />
        </div>

        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={close}
            className="px-3 py-1.5 rounded border border-border-subtle text-zinc-300 hover:bg-zinc-800"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void add()}
            disabled={!currentPath || !name.trim()}
            className="px-3 py-1.5 rounded bg-accent text-black font-medium disabled:opacity-40"
          >
            Add this folder
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run — green**

Run: `pnpm vitest run src/components/workspaces/WorkspaceBrowserModal.test.tsx`
Expected: 5 passing.

- [ ] **Step 5: Commit**

```bash
git add src/components/workspaces/WorkspaceBrowserModal.tsx \
        src/components/workspaces/WorkspaceBrowserModal.test.tsx
git commit -m "feat(slice-23): WorkspaceBrowserModal (server-backed file picker)"
```

---

### Task O1: WorkspaceChip in TopBar

**Files:**
- Create: `src/components/topbar/WorkspaceChip.tsx`
- Create: `src/components/topbar/WorkspaceChip.test.tsx`
- Modify: `src/components/topbar/TopBar.tsx` (mount the chip)

- [ ] **Step 1: Write the failing test**

Create `src/components/topbar/WorkspaceChip.test.tsx`:

```tsx
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { useSessionsStore } from '@/src/stores/sessions.store';
import { useWorkspacesStore } from '@/src/stores/workspaces.store';
import { WorkspaceChip } from './WorkspaceChip';

describe('WorkspaceChip', () => {
  beforeEach(() => {
    useWorkspacesStore.getState()._reset();
    // Reset sessions store to a known state. Avoid _reset() interactions.
  });

  it('shows "no workspace" when active session has none', () => {
    useSessionsStore.setState({
      sessions: [{ id: 's1', title: 't', createdAt: 0, updatedAt: 0 }],
      activeSessionId: 's1',
    } as Partial<ReturnType<typeof useSessionsStore.getState>>);
    render(<WorkspaceChip />);
    expect(screen.getByText(/no workspace/i)).toBeInTheDocument();
  });

  it('shows active session\'s workspace name', () => {
    useSessionsStore.setState({
      sessions: [{ id: 's1', title: 't', createdAt: 0, updatedAt: 0, workspaceId: 'w1' }],
      activeSessionId: 's1',
    } as Partial<ReturnType<typeof useSessionsStore.getState>>);
    useWorkspacesStore.setState({
      workspaces: [{ id: 'w1', name: 'proj', rootPath: '/tmp/p', addedAt: 0 }],
    });
    render(<WorkspaceChip />);
    expect(screen.getByText('proj')).toBeInTheDocument();
  });

  it('clicking opens dropdown; selecting a workspace calls setSessionWorkspace', async () => {
    const spy = vi.spyOn(useSessionsStore.getState(), 'setSessionWorkspace').mockResolvedValue();
    useSessionsStore.setState({
      sessions: [{ id: 's1', title: 't', createdAt: 0, updatedAt: 0 }],
      activeSessionId: 's1',
    } as Partial<ReturnType<typeof useSessionsStore.getState>>);
    useWorkspacesStore.setState({
      workspaces: [{ id: 'w1', name: 'proj', rootPath: '/tmp/p', addedAt: 0 }],
    });
    render(<WorkspaceChip />);
    fireEvent.click(screen.getByRole('button', { name: /active workspace/i }));
    await waitFor(() => screen.getByText('proj'));
    fireEvent.click(screen.getByText('proj'));
    expect(spy).toHaveBeenCalledWith('s1', 'w1');
    spy.mockRestore();
  });
});
```

- [ ] **Step 2: Run — expect failure**

Run: `pnpm vitest run src/components/topbar/WorkspaceChip.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implement**

Create `src/components/topbar/WorkspaceChip.tsx`:

```tsx
import { useState } from 'react';
import { useSessionsStore } from '@/src/stores/sessions.store';
import { useWorkspacesStore } from '@/src/stores/workspaces.store';

export function WorkspaceChip() {
  const activeId = useSessionsStore((s) => s.activeSessionId);
  const sessions = useSessionsStore((s) => s.sessions);
  const setSessionWorkspace = useSessionsStore((s) => s.setSessionWorkspace);
  const workspaces = useWorkspacesStore((s) => s.workspaces);
  const [open, setOpen] = useState(false);

  const session = sessions.find((x) => x.id === activeId);
  const ws = session?.workspaceId
    ? workspaces.find((w) => w.id === session.workspaceId)
    : undefined;
  const label = ws ? ws.name : 'no workspace';

  const pick = (id: string | null) => {
    setOpen(false);
    if (!activeId) return;
    void setSessionWorkspace(activeId, id);
  };

  return (
    <div className="relative">
      <button
        type="button"
        aria-label="active workspace"
        onClick={() => setOpen((v) => !v)}
        className="px-2 py-1 text-[11px] font-mono text-zinc-300 border border-border-subtle rounded hover:bg-zinc-800"
      >
        📁 {label}
      </button>
      {open && (
        <div className="absolute right-0 mt-1 w-56 max-h-64 overflow-y-auto rounded border border-border-subtle bg-surface-1 shadow z-30">
          <button
            type="button"
            onClick={() => pick(null)}
            className="block w-full text-left px-2 py-1.5 text-[11px] text-zinc-500 hover:bg-zinc-800 italic"
          >
            (no workspace)
          </button>
          {workspaces.map((w) => (
            <button
              key={w.id}
              type="button"
              onClick={() => pick(w.id)}
              className="block w-full text-left px-2 py-1.5 text-[11px] font-mono text-zinc-300 hover:bg-zinc-800 truncate"
            >
              {w.name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Mount in TopBar**

In `src/components/topbar/TopBar.tsx`, import and mount `<WorkspaceChip />` next to the existing provider selector / profile button. Add the import and place it visually (right side of the bar).

- [ ] **Step 5: Run — green**

Run: `pnpm vitest run src/components/topbar/WorkspaceChip.test.tsx src/components/topbar/TopBar.test.tsx`
Expected: green.

- [ ] **Step 6: Commit**

```bash
git add src/components/topbar/WorkspaceChip.tsx \
        src/components/topbar/WorkspaceChip.test.tsx \
        src/components/topbar/TopBar.tsx
git commit -m "feat(slice-23): WorkspaceChip in TopBar (active-workspace picker)"
```

---

### Task P1: App.tsx mount + init

**Files:**
- Modify: `src/App.tsx`

- [ ] **Step 1: Mount the new pieces**

In `src/App.tsx`:

a) Imports (next to existing sidebar + modal imports):

```ts
import { WorkspacesSection } from '@/src/components/sidebar/WorkspacesSection';
import { WorkspaceBrowserModal } from '@/src/components/workspaces/WorkspaceBrowserModal';
import { useWorkspacesStore } from '@/src/stores/workspaces.store';
```

b) Add the init action + include it in the `useEffect` deps list:

```ts
const initWorkspaces = useWorkspacesStore((s) => s.init);

useEffect(() => {
  // …existing inits…
  initWorkspaces();
}, [/*…, */ initWorkspaces]);
```

c) Sidebar JSX — mount `<WorkspacesSection />` immediately below `<BreakpointsSection />` (and above `<McpServersSection />`).

d) Modal mount — add `<WorkspaceBrowserModal />` near `<ApprovalGate />` and the other modals.

- [ ] **Step 2: Typecheck**

Run: `pnpm typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/App.tsx
git commit -m "feat(slice-23): App mounts WorkspacesSection + WorkspaceBrowserModal + init store"
```

---

### Task Q1: Integration test

**Files:**
- Create: `src/integration/workspaces.integration.test.tsx`

- [ ] **Step 1: Write the integration test**

Create `src/integration/workspaces.integration.test.tsx`:

```tsx
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { server } from '@/src/test/msw-server';
import App from '@/src/App';
import { useUiStore } from '@/src/stores/ui.store';
import { useSessionsStore } from '@/src/stores/sessions.store';
import { useProfilesStore } from '@/src/stores/profiles.store';
import { useContextStore } from '@/src/stores/context.store';
import { useSubAgentsStore } from '@/src/stores/subagents.store';
import { useMcpStore } from '@/src/stores/mcp.store';
import { useProvidersStore } from '@/src/stores/providers.store';
import { useChatStore } from '@/src/stores/chat.store';
import { useKeyVaultStore } from '@/src/stores/keyVault.store';
import { useProviderAuthStore } from '@/src/stores/providerAuth.store';
import { useBuiltinMcpStore } from '@/src/stores/builtinMcp.store';
import { useBreakpointsStore } from '@/src/stores/breakpoints.store';
import { useWorkspacesStore } from '@/src/stores/workspaces.store';

beforeEach(() => {
  useUiStore.getState()._reset();
  useSessionsStore.getState()._reset();
  useProfilesStore.getState()._reset();
  useContextStore.getState()._reset();
  useSubAgentsStore.getState()._reset();
  useMcpStore.getState()._reset();
  useProvidersStore.getState()._reset();
  useChatStore.getState()._reset();
  useKeyVaultStore.getState()._reset();
  useProviderAuthStore.getState()._reset();
  useBuiltinMcpStore.getState()._reset();
  useBreakpointsStore.getState()._reset();
  useWorkspacesStore.getState()._reset();
});

describe('workspaces integration', () => {
  it('add workspace → browser modal → create → row appears in sidebar', async () => {
    server.use(
      http.get('http://localhost/api/workspaces/browse', () =>
        HttpResponse.json({ entries: [{ name: 'project-a', isDir: true }] }),
      ),
      http.post('http://localhost/api/workspaces', async ({ request }) => {
        const body = (await request.json()) as { name: string; rootPath: string };
        return HttpResponse.json(
          { id: 'w-int-1', name: body.name, rootPath: body.rootPath, addedAt: Date.now() },
          { status: 201 },
        );
      }),
    );

    render(<App />);
    // Open the modal
    await waitFor(() => screen.getByRole('button', { name: /add workspace/i }));
    fireEvent.click(screen.getByRole('button', { name: /add workspace/i }));

    // Descend into "project-a"
    await waitFor(() => screen.getByText('project-a'));
    fireEvent.click(screen.getByText('project-a'));

    // Click "Add this folder"
    await waitFor(() => screen.getByText('Add this folder'));
    fireEvent.click(screen.getByText('Add this folder'));

    // Modal closes; new workspace row appears in sidebar.
    await waitFor(() =>
      expect(useUiStore.getState().workspaceBrowserOpen).toBe(false),
    );
    await waitFor(() =>
      expect(useWorkspacesStore.getState().workspaces.length).toBe(1),
    );
  });
});
```

- [ ] **Step 2: Run — green**

Run: `pnpm vitest run src/integration/workspaces.integration.test.tsx`
Expected: 1 passing.

- [ ] **Step 3: Commit**

```bash
git add src/integration/workspaces.integration.test.tsx
git commit -m "test(slice-23): integration — add workspace via browser modal"
```

---

### Task R1: Playwright smoke + final gates + PR

**Files:**
- Modify: `e2e/smoke.spec.ts`
- Modify: `docs/superpowers/roadmap.md`

- [ ] **Step 1: Add a Playwright smoke**

In `e2e/smoke.spec.ts`, append (mirroring the existing builtin MCP test style):

```ts
test('workspaces: Add modal opens with browse entries', async ({ page }) => {
  await page.goto('/');
  await page.getByText('AETHER_CORE').waitFor();

  // The Workspaces section header should be visible
  await expect(page.getByText(/^Workspaces$/)).toBeVisible();

  // Open the modal
  await page.getByRole('button', { name: /add workspace/i }).click();

  // Modal: "Add this folder" button visible + at least one folder entry rendered.
  await expect(page.getByText('Add this folder')).toBeVisible({ timeout: 3000 });

  // Cancel out.
  await page.getByRole('button', { name: /^cancel$/i }).click();
});
```

- [ ] **Step 2: Run Playwright smoke**

Run: `pnpm playwright test e2e/smoke.spec.ts -g "workspaces" --reporter=line`
Expected: PASS.

- [ ] **Step 3: Full gates**

Run: `pnpm lint && pnpm test`
Expected: green modulo the pre-existing flakes documented in the plan notes.

- [ ] **Step 4: Update roadmap**

In `docs/superpowers/roadmap.md`, move slice 23 into the Shipped table:

```md
| 23 | Native workspace management GUI | `feat/slice-23-workspaces` | ✅ |
```

…and remove the "Slice 23 — Native Workspace Management GUI" detail block.

```bash
git add docs/superpowers/roadmap.md
git commit -m "docs(slice-23): mark slice 23 shipped in roadmap"
```

- [ ] **Step 5: Push and open PR**

```bash
git push -u origin feat/slice-23-workspaces
gh pr create --title "feat(slice-23): Native workspace management GUI" --body "..."
```

PR body summary:
- New `workspaces` table (migration 009) + `sessions.workspace_id` FK.
- 6 new routes (`/api/workspaces` CRUD + browse + activate-for-session).
- New `<WorkspacesSection>` in sidebar, `<WorkspaceBrowserModal>` server-backed picker, `<WorkspaceChip>` in TopBar.
- Per-session activation: switching focus to a session reroots the Filesystem MCP via `setFsRoot` + `reconnectBuiltin('filesystem')`.
- New sessions inherit the active session's workspace.
- Pre-existing Ollama flakes noted.

- [ ] **Step 6: Wait for user merge**

---

## Self-review checklist (applied inline)

- **Spec coverage:** Migration 009 (B1), types (B1, I1), WorkspacesStore (C1), FilesystemBrowserService (D1), HistoryStore extension (E1), sessions PATCH (F1), workspaces routes (G1), app/bootstrap wiring (H1), FE api+types+MSW (I1), workspaces store (J1), sessions store activation+inheritance (K1), ui.store browser flag (L1), WorkspacesSection (M1), WorkspaceBrowserModal (N1), WorkspaceChip (O1), App mount (P1), integration (Q1), Playwright + gates + roadmap (R1). All 8 spec acceptance criteria covered.
- **Type consistency:** `Workspace { id, name, rootPath, addedAt }` defined once and mirrored on FE. `setSessionWorkspace`, `activateForSession`, `createEmpty({ workspaceId })` consistent across tasks. `BrowseEntry { name, isDir }`.
- **No placeholders:** All code blocks are concrete; all commands have expected output; the PR body template explicitly enumerates what to include.
