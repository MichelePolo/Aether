# Aether Slice 15 — FTS Search over Messages Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Full-text search across all chat messages via SQLite FTS5, surfaced through a new "Search history…" command in the existing Command Palette. Results group by session and show highlighted snippet excerpts.

**Architecture:** New `messages_fts` standalone FTS5 virtual table created in migration `002_fts.sql`. `HistoryStore.append()` / `delete()` are extended to maintain the FTS index in their existing transactions. New `SearchService` + `GET /api/search?q=...` route + FE `searchApi` + `<SnippetHighlight>` component. The Command Palette's existing `ui.store` gains a `paletteMode: 'commands' | 'search'` discriminator; in search mode the input + result rendering switch to the search UX.

**Tech Stack:** existing — no new dependency. SQLite FTS5 ships with `better-sqlite3`.

**Reference spec:** `docs/superpowers/specs/2026-05-21-aether-slice-15-fts-search-design.md`

**Branch:** `feat/slice-15-fts-search` (already checked out; spec already committed)

**Lavora con un solo branch dall'inizio alla fine; ogni Task termina con un commit verde su questo branch.**

---

## File structure (NEW unless marked MODIFY)

```
server/
  db/migrations/
    002_fts.sql                                      # NEW
  domain/history/
    history.store.ts                                 # MODIFY
    history.store.test.ts                            # MODIFY
  domain/search/
    search.types.ts                                  # NEW
    search.service.ts                                # NEW
    search.service.test.ts                           # NEW
  routes/
    search.routes.ts                                 # NEW
    search.routes.test.ts                            # NEW
  app.ts                                             # MODIFY: mount + AppDeps
  index.ts                                           # MODIFY: construct SearchService
  db/migrate.test.ts                                 # MODIFY: +1 case

src/
  types/
    search.types.ts                                  # NEW
  lib/api/
    search.api.ts                                    # NEW
    search.api.test.ts                               # NEW
  components/palette/
    SnippetHighlight.tsx                             # NEW
    SnippetHighlight.test.tsx                        # NEW
    CommandPalette.tsx                               # MODIFY
    CommandPalette.test.tsx                          # MODIFY
  hooks/
    useCommands.ts                                   # MODIFY: +Search history command
  stores/
    ui.store.ts                                      # MODIFY: +paletteMode + search state
    ui.store.test.ts                                 # MODIFY (or create)
  test/
    msw-handlers.ts                                  # MODIFY: +default /api/search handler
  integration/
    search.integration.test.tsx                      # NEW
```

---

## Phase A — Pre-flight

### Task A1: Verify branch + clean tree

- [ ] **Step 1: Run**

```bash
git rev-parse --abbrev-ref HEAD
git status --porcelain
```

Expected: branch `feat/slice-15-fts-search`; second command empty. No commit.

---

## Phase B — Migration

### Task B1: `002_fts.sql` + migration test

**Files:**
- Create: `server/db/migrations/002_fts.sql`
- Modify: `server/db/migrate.test.ts`

- [ ] **Step 1: Create `server/db/migrations/002_fts.sql`**

```sql
CREATE VIRTUAL TABLE messages_fts USING fts5(
  message_id UNINDEXED,
  session_id UNINDEXED,
  role UNINDEXED,
  content,
  tokenize='unicode61'
);

INSERT INTO messages_fts (message_id, session_id, role, content)
  SELECT id, session_id, role, content FROM messages;
```

Two statements; the migration runner splits on `;` and runs each separately.

- [ ] **Step 2: Add a test case to `server/db/migrate.test.ts`**

Read the existing file first. Add a new test inside the existing describe block:

```ts
it('applying both migrations creates messages_fts and records versions 1+2', () => {
  const fullDb = makeTestDb();
  try {
    const tables = (fullDb
      .prepare("SELECT name FROM sqlite_master WHERE type IN ('table','virtual_table') OR name LIKE '%_fts%' ORDER BY name")
      .all() as { name: string }[]).map((r) => r.name);
    expect(tables).toContain('messages_fts');

    const versions = (fullDb
      .prepare('SELECT version FROM _migrations ORDER BY version')
      .all() as { version: number }[]).map((r) => r.version);
    expect(versions).toEqual([1, 2]);
  } finally {
    fullDb.close();
  }
});
```

`makeTestDb` is imported from `@/server/test/test-db`. Add the import if not present.

- [ ] **Step 3: Run the migrate test + full server suite**

```bash
npx vitest run server/db/migrate.test.ts
npx vitest run server
```

Expected: migrate test green (existing + 1 new); full server suite green (no behavior change to other paths — `messages_fts` exists but is empty + unused by other code).

- [ ] **Step 4: Lint + commit**

```bash
npm run lint
git add server/db/migrations/002_fts.sql server/db/migrate.test.ts
git commit -m "feat(slice-15): migration 002_fts — messages_fts FTS5 virtual table"
```

---

## Phase C — HistoryStore FTS sync

### Task C1: Extend `HistoryStore.append()` + `delete()` to maintain `messages_fts`

**Files:**
- Modify: `server/domain/history/history.store.ts`
- Modify: `server/domain/history/history.store.test.ts`

Both methods need to mutate `messages_fts` inside their existing (or new) `db.transaction(...)` block.

- [ ] **Step 1: Read the current `history.store.ts`**

Locate `append()` (currently around line 116) and `delete()` (currently around line 178). Confirm `append()` uses `db.transaction(() => { ... })` and `delete()` does NOT (it's currently a single statement).

- [ ] **Step 2: Add an FTS insert inside `append()`'s transaction**

In `append()`, immediately AFTER the existing `INSERT INTO messages (...)` statement and BEFORE `insertReasoningSteps(...)`, add:

```ts
this.db
  .prepare(
    'INSERT INTO messages_fts (message_id, session_id, role, content) VALUES (?, ?, ?, ?)',
  )
  .run(message.id, sessionId, message.role, message.text);
```

- [ ] **Step 3: Wrap `delete()` in a transaction + add FTS delete**

`delete(sessionId)` currently does `const info = this.db.prepare('DELETE FROM sessions WHERE id = ?').run(sessionId);`. Wrap in a transaction so both deletes commit atomically:

```ts
async delete(sessionId: string): Promise<void> {
  let deleted = false;
  const tx = this.db.transaction(() => {
    this.db.prepare('DELETE FROM messages_fts WHERE session_id = ?').run(sessionId);
    const info = this.db.prepare('DELETE FROM sessions WHERE id = ?').run(sessionId);
    deleted = info.changes > 0;
  });
  tx();
  if (!deleted) throw new NotFoundError(`session ${sessionId}`);
}
```

The FTS delete fires before the session delete. The existing FK cascade on `messages` still handles the `messages` table cleanup.

- [ ] **Step 4: Append failing tests to `server/domain/history/history.store.test.ts`**

Inside the existing describe block:

```ts
it('append() populates messages_fts with the same fields', async () => {
  const s = await store.createEmpty();
  await store.append(s.id, {
    id: 'm1',
    role: 'user',
    text: 'searchable hello world',
    timestamp: Date.now(),
  });
  const row = db
    .prepare('SELECT message_id, session_id, role, content FROM messages_fts WHERE message_id = ?')
    .get('m1') as { message_id: string; session_id: string; role: string; content: string };
  expect(row).toEqual({
    message_id: 'm1',
    session_id: s.id,
    role: 'user',
    content: 'searchable hello world',
  });
});

it('delete(sessionId) cascades to messages_fts rows', async () => {
  const s = await store.createEmpty();
  await store.append(s.id, { id: 'm1', role: 'user', text: 'a', timestamp: Date.now() });
  await store.append(s.id, { id: 'm2', role: 'model', text: 'b', timestamp: Date.now() });
  expect((db.prepare('SELECT COUNT(*) AS n FROM messages_fts').get() as { n: number }).n).toBe(2);
  await store.delete(s.id);
  expect((db.prepare('SELECT COUNT(*) AS n FROM messages_fts').get() as { n: number }).n).toBe(0);
});
```

- [ ] **Step 5: Run tests + lint**

```bash
npx vitest run server/domain/history/history.store.test.ts
npx vitest run server
npm run lint
```

Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add server/domain/history/history.store.ts server/domain/history/history.store.test.ts
git commit -m "feat(slice-15): HistoryStore maintains messages_fts in append/delete transactions"
```

---

## Phase D — SearchService

### Task D1: New `SearchService` + types + tests

**Files:**
- Create: `server/domain/search/search.types.ts`
- Create: `server/domain/search/search.service.ts`
- Create: `server/domain/search/search.service.test.ts`

- [ ] **Step 1: Create `server/domain/search/search.types.ts`**

```ts
export interface SnippetHit {
  messageId: string;
  role: 'user' | 'model';
  snippet: string; // contains «M»…«/M» highlight markers
}

export interface SessionHits {
  sessionId: string;
  title: string;
  updatedAt: number;
  hits: SnippetHit[];
}
```

- [ ] **Step 2: Create `server/domain/search/search.service.ts`**

```ts
import type { DatabaseHandle } from '@/server/db/database';
import type { SessionHits, SnippetHit } from './search.types';

type RowShape = {
  messageId: string;
  sessionId: string;
  role: 'user' | 'model';
  snippet: string;
  rank: number;
  title: string;
  updatedAt: number;
};

interface SearchOpts {
  limit?: number;
  snippetsPerSession?: number;
}

const SQL = `
  SELECT
    mf.message_id AS messageId,
    mf.session_id AS sessionId,
    mf.role AS role,
    snippet(messages_fts, 3, '«M»', '«/M»', '…', 20) AS snippet,
    bm25(messages_fts) AS rank,
    s.title AS title,
    s.updated_at AS updatedAt
  FROM messages_fts mf
  JOIN sessions s ON s.id = mf.session_id
  WHERE messages_fts MATCH ?
  ORDER BY rank ASC, s.updated_at DESC
  LIMIT ?
`;

export class SearchService {
  constructor(private readonly db: DatabaseHandle) {}

  async search(query: string, opts: SearchOpts = {}): Promise<SessionHits[]> {
    const trimmed = query.trim();
    if (trimmed.length === 0) return [];

    const limit = Math.min(Math.max(opts.limit ?? 100, 1), 500);
    const snippetsPerSession = Math.max(opts.snippetsPerSession ?? 3, 1);

    let rows: RowShape[];
    try {
      rows = this.db.prepare(SQL).all(trimmed, limit) as RowShape[];
    } catch {
      // FTS5 syntax error or any other prepare/run failure → empty results.
      return [];
    }

    const grouped = new Map<string, SessionHits>();
    for (const r of rows) {
      let entry = grouped.get(r.sessionId);
      if (!entry) {
        entry = {
          sessionId: r.sessionId,
          title: r.title,
          updatedAt: r.updatedAt,
          hits: [],
        };
        grouped.set(r.sessionId, entry);
      }
      if (entry.hits.length < snippetsPerSession) {
        const hit: SnippetHit = {
          messageId: r.messageId,
          role: r.role,
          snippet: r.snippet,
        };
        entry.hits.push(hit);
      }
    }

    // SQL ORDER BY already sorts rows by rank ASC; insertion order into the
    // Map preserves session ordering by best hit's rank.
    return Array.from(grouped.values());
  }
}
```

- [ ] **Step 3: Create `server/domain/search/search.service.test.ts`**

```ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { makeTestDb } from '@/server/test/test-db';
import { HistoryStore } from '@/server/domain/history/history.store';
import { SearchService } from './search.service';
import type { DatabaseHandle } from '@/server/db/database';

let db: DatabaseHandle;
let history: HistoryStore;
let search: SearchService;

beforeEach(() => {
  db = makeTestDb();
  history = new HistoryStore(db);
  search = new SearchService(db);
});

afterEach(() => {
  db.close();
});

async function seedSession(title: string, msgs: Array<{ id: string; role: 'user' | 'model'; text: string }>) {
  const s = await history.createEmpty();
  if (title) await history.rename(s.id, title);
  for (const m of msgs) {
    await history.append(s.id, { ...m, timestamp: Date.now() });
  }
  return s;
}

describe('SearchService', () => {
  it('returns [] on empty index', async () => {
    const results = await search.search('anything');
    expect(results).toEqual([]);
  });

  it('returns one SessionHits with one snippet for a single match', async () => {
    const s = await seedSession('S1', [
      { id: 'm1', role: 'user', text: 'discussing hyperloop transit systems' },
    ]);
    const results = await search.search('hyperloop');
    expect(results).toHaveLength(1);
    expect(results[0].sessionId).toBe(s.id);
    expect(results[0].title).toBe('S1');
    expect(results[0].hits).toHaveLength(1);
    expect(results[0].hits[0].messageId).toBe('m1');
    expect(results[0].hits[0].snippet).toContain('«M»');
    expect(results[0].hits[0].snippet).toContain('«/M»');
  });

  it('groups hits per session and orders sessions by best rank', async () => {
    const s1 = await seedSession('S1', [
      { id: 'a1', role: 'user', text: 'apple banana cherry' },
    ]);
    const s2 = await seedSession('S2', [
      { id: 'b1', role: 'user', text: 'apple apple apple' },
    ]);
    const results = await search.search('apple');
    expect(results).toHaveLength(2);
    // S2 mentions "apple" three times → better BM25 → ordered first.
    expect(results[0].sessionId).toBe(s2.id);
    expect(results[1].sessionId).toBe(s1.id);
  });

  it('caps hits per session via snippetsPerSession', async () => {
    const s = await seedSession('S', [
      { id: 'm1', role: 'user', text: 'searchterm one' },
      { id: 'm2', role: 'model', text: 'searchterm two' },
      { id: 'm3', role: 'user', text: 'searchterm three' },
      { id: 'm4', role: 'model', text: 'searchterm four' },
    ]);
    expect(s.id).toBeTruthy();
    const results = await search.search('searchterm', { snippetsPerSession: 2 });
    expect(results).toHaveLength(1);
    expect(results[0].hits).toHaveLength(2);
  });

  it('respects the raw limit on SQL row count', async () => {
    await seedSession('S', [
      { id: 'm1', role: 'user', text: 'x' },
      { id: 'm2', role: 'user', text: 'x' },
      { id: 'm3', role: 'user', text: 'x' },
    ]);
    const results = await search.search('x', { limit: 2 });
    expect(results[0].hits).toHaveLength(2);
  });

  it('returns [] for empty query without preparing any statement', async () => {
    const spy = vi.spyOn(db, 'prepare');
    const results = await search.search('   ');
    expect(results).toEqual([]);
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it('returns [] on FTS5 syntax error (does not throw)', async () => {
    await seedSession('S', [{ id: 'm1', role: 'user', text: 'hello' }]);
    const results = await search.search('"foo');
    expect(results).toEqual([]);
  });

  it('snippet preserves literal HTML characters from user content', async () => {
    await seedSession('S', [
      { id: 'm1', role: 'user', text: 'beware of <script>alert(1)</script> in messages' },
    ]);
    const results = await search.search('script');
    expect(results).toHaveLength(1);
    // SQLite does not HTML-escape; the literal <script> stays as text in the snippet.
    // The «M» markers are the ONLY tags injected.
    expect(results[0].hits[0].snippet).toContain('<script>');
    expect(results[0].hits[0].snippet).toContain('«M»');
  });

  it('title + updatedAt come from joined sessions row', async () => {
    const s = await seedSession('My Session', [
      { id: 'm1', role: 'user', text: 'searchword' },
    ]);
    const results = await search.search('searchword');
    expect(results[0].title).toBe('My Session');
    expect(typeof results[0].updatedAt).toBe('number');
    expect(results[0].updatedAt).toBeGreaterThan(0);
    expect(results[0].sessionId).toBe(s.id);
  });
});
```

- [ ] **Step 4: Run tests + full server suite + lint**

```bash
npx vitest run server/domain/search/search.service.test.ts
npx vitest run server
npm run lint
```

Expected: 9/9 in the new file; full server suite green.

- [ ] **Step 5: Commit**

```bash
git add server/domain/search/search.types.ts server/domain/search/search.service.ts server/domain/search/search.service.test.ts
git commit -m "feat(slice-15): SearchService (FTS5 MATCH + snippet + per-session grouping)"
```

---

## Phase E — Search route + bootstrap wiring

### Task E1: `GET /api/search` + app.ts mount + index.ts wiring

**Files:**
- Create: `server/routes/search.routes.ts`
- Create: `server/routes/search.routes.test.ts`
- Modify: `server/app.ts`
- Modify: `server/index.ts`

- [ ] **Step 1: Create `server/routes/search.routes.ts`**

```ts
import { Router, type Request, type Response } from 'express';
import type { SearchService } from '@/server/domain/search/search.service';

export function createSearchRoutes(svc: SearchService): Router {
  const router = Router();

  router.get('/', async (req: Request, res: Response) => {
    if (req.query.q === undefined) {
      res.status(400).json({
        error: { code: 'MISSING_QUERY', message: 'Query parameter q is required' },
      });
      return;
    }

    const q = typeof req.query.q === 'string' ? req.query.q : '';

    let limit = 100;
    if (typeof req.query.limit === 'string') {
      const parsed = parseInt(req.query.limit, 10);
      if (Number.isFinite(parsed)) {
        limit = Math.min(Math.max(parsed, 1), 500);
      }
    }

    const results = await svc.search(q, { limit });
    res.json({ results });
  });

  return router;
}
```

Note: the 400 fires only when `q` is COMPLETELY absent from the query string. A present-but-empty/whitespace `q` returns `{ results: [] }` (SearchService handles the trim).

- [ ] **Step 2: Create `server/routes/search.routes.test.ts`**

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import express from 'express';
import { makeTestDb } from '@/server/test/test-db';
import { HistoryStore } from '@/server/domain/history/history.store';
import { SearchService } from '@/server/domain/search/search.service';
import { createSearchRoutes } from './search.routes';
import type { DatabaseHandle } from '@/server/db/database';

let db: DatabaseHandle;
let history: HistoryStore;
let app: express.Express;

beforeEach(() => {
  db = makeTestDb();
  history = new HistoryStore(db);
  const svc = new SearchService(db);
  app = express();
  app.use(express.json());
  app.use('/api/search', createSearchRoutes(svc));
});

afterEach(() => {
  db.close();
});

describe('GET /api/search', () => {
  it('returns grouped hits for a matching query', async () => {
    const s = await history.createEmpty();
    await history.rename(s.id, 'My Session');
    await history.append(s.id, {
      id: 'm1',
      role: 'user',
      text: 'discussing hyperloop transit',
      timestamp: Date.now(),
    });

    const res = await request(app).get('/api/search').query({ q: 'hyperloop' });
    expect(res.status).toBe(200);
    expect(res.body.results).toHaveLength(1);
    expect(res.body.results[0].sessionId).toBe(s.id);
    expect(res.body.results[0].hits[0].snippet).toContain('«M»');
  });

  it('returns 400 with MISSING_QUERY when q is absent', async () => {
    const res = await request(app).get('/api/search');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('MISSING_QUERY');
  });

  it('returns 200 with empty results when q is whitespace-only', async () => {
    const res = await request(app).get('/api/search').query({ q: '   ' });
    expect(res.status).toBe(200);
    expect(res.body.results).toEqual([]);
  });

  it('respects the limit query param', async () => {
    const s = await history.createEmpty();
    for (let i = 0; i < 5; i++) {
      await history.append(s.id, {
        id: `m${i}`,
        role: 'user',
        text: `searchterm number ${i}`,
        timestamp: Date.now(),
      });
    }
    const res = await request(app)
      .get('/api/search')
      .query({ q: 'searchterm', limit: '2' });
    expect(res.status).toBe(200);
    expect(res.body.results).toHaveLength(1);
    expect(res.body.results[0].hits).toHaveLength(2);
  });
});
```

- [ ] **Step 3: Modify `server/app.ts` — mount the route**

Add the imports alongside the others:

```ts
import { createSearchRoutes } from './routes/search.routes';
import type { SearchService } from './domain/search/search.service';
```

Add `searchService` to `AppDeps`:

```ts
export interface AppDeps {
  // ... existing fields ...
  searchService?: SearchService;
}
```

Mount the route inside `createApp`, near the other `app.use('/api/...', ...)` lines:

```ts
if (deps.searchService) {
  app.use('/api/search', createSearchRoutes(deps.searchService));
}
```

- [ ] **Step 4: Modify `server/index.ts` — construct + pass the service**

Add the import:

```ts
import { SearchService } from './domain/search/search.service';
```

Construct after the stores are built (right after `SubAgentsStore`):

```ts
const searchService = new SearchService(db);
```

Pass it into `createApp`:

```ts
const app = createApp({
  contextStore,
  historyStore,
  dispatcher,
  profilesStore,
  subAgentsStore,
  mcpRegistry,
  providers,
  searchService,
});
```

- [ ] **Step 5: Run + lint**

```bash
npx vitest run server/routes/search.routes.test.ts
npx vitest run server
npm run lint
```

Expected: 4/4 in the new file; full server suite green.

- [ ] **Step 6: Commit**

```bash
git add server/routes/search.routes.ts server/routes/search.routes.test.ts server/app.ts server/index.ts
git commit -m "feat(slice-15): GET /api/search route + bootstrap wiring"
```

---

## Phase F — FE API client + MSW handler

### Task F1: `searchApi.search()` + types + MSW default handler

**Files:**
- Create: `src/types/search.types.ts`
- Create: `src/lib/api/search.api.ts`
- Create: `src/lib/api/search.api.test.ts`
- Modify: `src/test/msw-handlers.ts`

- [ ] **Step 1: Create `src/types/search.types.ts`**

```ts
export interface SnippetHit {
  messageId: string;
  role: 'user' | 'model';
  snippet: string;
}

export interface SessionHits {
  sessionId: string;
  title: string;
  updatedAt: number;
  hits: SnippetHit[];
}
```

- [ ] **Step 2: Create `src/lib/api/search.api.ts`**

```ts
import type { SessionHits } from '@/src/types/search.types';

export interface SearchOpts {
  limit?: number;
  signal?: AbortSignal;
}

export const searchApi = {
  async search(q: string, opts: SearchOpts = {}): Promise<SessionHits[]> {
    const params = new URLSearchParams({ q });
    if (typeof opts.limit === 'number') {
      params.set('limit', String(opts.limit));
    }
    const res = await fetch(`/api/search?${params.toString()}`, {
      method: 'GET',
      signal: opts.signal,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const body = (await res.json()) as { results: SessionHits[] };
    return body.results;
  },
};
```

- [ ] **Step 3: Create `src/lib/api/search.api.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { http, HttpResponse } from 'msw';
import { server } from '@/src/test/msw-server';
import { searchApi } from './search.api';

describe('searchApi.search', () => {
  it('GETs /api/search?q=… and unwraps results', async () => {
    let receivedUrl = '';
    server.use(
      http.get('http://localhost/api/search', ({ request }) => {
        receivedUrl = request.url;
        return HttpResponse.json({
          results: [
            {
              sessionId: 'S1',
              title: 'Session 1',
              updatedAt: 1,
              hits: [{ messageId: 'm1', role: 'user', snippet: 'hello «M»world«/M»' }],
            },
          ],
        });
      }),
    );
    const results = await searchApi.search('world');
    expect(receivedUrl).toContain('q=world');
    expect(results).toHaveLength(1);
    expect(results[0].hits[0].snippet).toContain('«M»');
  });

  it('forwards the limit param when provided', async () => {
    let receivedUrl = '';
    server.use(
      http.get('http://localhost/api/search', ({ request }) => {
        receivedUrl = request.url;
        return HttpResponse.json({ results: [] });
      }),
    );
    await searchApi.search('x', { limit: 5 });
    expect(receivedUrl).toContain('limit=5');
  });
});
```

- [ ] **Step 4: Add a default handler to `src/test/msw-handlers.ts`**

Find the list of handlers; append (next to other `/api/...` handlers):

```ts
http.get('http://localhost/api/search', () =>
  HttpResponse.json({ results: [] }),
),
```

- [ ] **Step 5: Run + lint**

```bash
npx vitest run src/lib/api/search.api.test.ts
npm run lint
```

Expected: 2/2 pass; lint clean.

- [ ] **Step 6: Commit**

```bash
git add src/types/search.types.ts src/lib/api/search.api.ts src/lib/api/search.api.test.ts src/test/msw-handlers.ts
git commit -m "feat(slice-15): searchApi.search() + MSW default handler"
```

---

## Phase G — SnippetHighlight component

### Task G1: `<SnippetHighlight>` + tests

**Files:**
- Create: `src/components/palette/SnippetHighlight.tsx`
- Create: `src/components/palette/SnippetHighlight.test.tsx`

The component renders search snippets by splitting on the `«M»` / `«/M»` markers and emitting React elements directly. It avoids any raw-HTML-write path (no innerHTML, no string-to-DOM); all output is React text nodes + `<mark>` elements, so literal HTML characters in user content (e.g. `<script>`) are escaped by React automatically.

- [ ] **Step 1: Create `src/components/palette/SnippetHighlight.tsx`**

```tsx
import { Fragment } from 'react';

const MARK_OPEN = '«M»';
const MARK_CLOSE = '«/M»';

interface SnippetHighlightProps {
  snippet: string;
  className?: string;
}

/**
 * Renders a search snippet with «M»…«/M» markers turned into <mark> elements.
 *
 * The markers come from SQLite FTS5's snippet() function, which does NOT
 * HTML-escape user content. Splitting the string on the markers and emitting
 * React elements keeps the rendering XSS-free by construction: literal HTML
 * characters in user content stay as React text nodes and are escaped by
 * React automatically. No raw-HTML write path is used.
 */
export function SnippetHighlight({ snippet, className }: SnippetHighlightProps): JSX.Element {
  const parts: Array<{ text: string; mark: boolean }> = [];
  let i = 0;
  while (i < snippet.length) {
    const openIdx = snippet.indexOf(MARK_OPEN, i);
    if (openIdx === -1) {
      parts.push({ text: snippet.slice(i), mark: false });
      break;
    }
    if (openIdx > i) {
      parts.push({ text: snippet.slice(i, openIdx), mark: false });
    }
    const closeIdx = snippet.indexOf(MARK_CLOSE, openIdx + MARK_OPEN.length);
    if (closeIdx === -1) {
      // Unmatched open marker — treat the rest as plain text to avoid losing content.
      parts.push({ text: snippet.slice(openIdx), mark: false });
      break;
    }
    parts.push({
      text: snippet.slice(openIdx + MARK_OPEN.length, closeIdx),
      mark: true,
    });
    i = closeIdx + MARK_CLOSE.length;
  }

  return (
    <span className={className}>
      {parts.map((p, idx) => (
        <Fragment key={idx}>
          {p.mark ? <mark className="bg-accent/30 text-white rounded-sm px-0.5">{p.text}</mark> : p.text}
        </Fragment>
      ))}
    </span>
  );
}
```

- [ ] **Step 2: Create `src/components/palette/SnippetHighlight.test.tsx`**

```tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SnippetHighlight } from './SnippetHighlight';

describe('SnippetHighlight', () => {
  it('renders plain text when no markers are present', () => {
    render(<SnippetHighlight snippet="just plain text" />);
    expect(screen.getByText('just plain text')).toBeInTheDocument();
  });

  it('wraps marked segments in <mark> elements', () => {
    render(<SnippetHighlight snippet="hello «M»world«/M» today" />);
    const mark = screen.getByText('world');
    expect(mark.tagName).toBe('MARK');
    expect(mark.textContent).toBe('world');
  });

  it('renders literal HTML characters as text (no XSS surface)', () => {
    const { container } = render(
      <SnippetHighlight snippet="prefix <script>alert(1)</script> «M»danger«/M» suffix" />,
    );
    // The <script> stays as text — querying for an actual script element finds none.
    expect(container.querySelectorAll('script')).toHaveLength(0);
    // The text appears verbatim.
    expect(container.textContent).toContain('<script>alert(1)</script>');
    // The marker becomes a <mark>.
    expect(screen.getByText('danger').tagName).toBe('MARK');
  });

  it('handles multiple marks in one snippet', () => {
    render(<SnippetHighlight snippet="«M»foo«/M» middle «M»bar«/M»" />);
    const marks = document.querySelectorAll('mark');
    expect(marks).toHaveLength(2);
    expect(marks[0].textContent).toBe('foo');
    expect(marks[1].textContent).toBe('bar');
  });

  it('gracefully handles an unmatched open marker', () => {
    const { container } = render(<SnippetHighlight snippet="hello «M»world (no close)" />);
    // No <mark> element since the marker pair is incomplete.
    expect(container.querySelectorAll('mark')).toHaveLength(0);
    // The text including the marker shows verbatim.
    expect(container.textContent).toContain('«M»world (no close)');
  });
});
```

- [ ] **Step 3: Run + lint**

```bash
npx vitest run src/components/palette/SnippetHighlight.test.tsx
npm run lint
```

Expected: 5/5 pass; lint clean.

- [ ] **Step 4: Commit**

```bash
git add src/components/palette/SnippetHighlight.tsx src/components/palette/SnippetHighlight.test.tsx
git commit -m "feat(slice-15): SnippetHighlight component (XSS-free marker rendering)"
```

---

## Phase H — ui.store search mode

### Task H1: Add palette mode + search state to `ui.store.ts`

**Files:**
- Modify: `src/stores/ui.store.ts`
- Modify or create: `src/stores/ui.store.test.ts`

- [ ] **Step 1: Read `src/stores/ui.store.ts` to confirm the existing shape**

The store has `paletteOpen: boolean` + `openPalette` / `closePalette` / `togglePalette`. We add:
- `paletteMode: 'commands' | 'search'`
- `searchQuery: string`
- `searchResults: SessionHits[]`
- Actions: `enterSearchMode()`, `exitSearchMode()`, `setSearchQuery(q)`, `setSearchResults(results)`.

`closePalette()` should reset mode + clear search state.

- [ ] **Step 2: Modify `src/stores/ui.store.ts`**

Add the import:

```ts
import type { SessionHits } from '@/src/types/search.types';
```

Add fields to the `UiState` interface:

```ts
paletteMode: 'commands' | 'search';
searchQuery: string;
searchResults: SessionHits[];

enterSearchMode: () => void;
exitSearchMode: () => void;
setSearchQuery: (q: string) => void;
setSearchResults: (results: SessionHits[]) => void;
```

Add initial values to the state object (near `paletteOpen: false`):

```ts
paletteMode: 'commands' as 'commands' | 'search',
searchQuery: '',
searchResults: [] as SessionHits[],
```

Add the actions (near `openPalette` / `closePalette`):

```ts
enterSearchMode: () => set({ paletteMode: 'search', searchQuery: '', searchResults: [] }),
exitSearchMode: () => set({ paletteMode: 'commands', searchQuery: '', searchResults: [] }),
setSearchQuery: (q) => set({ searchQuery: q }),
setSearchResults: (results) => set({ searchResults: results }),
```

Modify `closePalette` and `openPalette` to reset the search state:

```ts
openPalette: () => set({ paletteOpen: true, paletteMode: 'commands', searchQuery: '', searchResults: [] }),
closePalette: () => set({ paletteOpen: false, paletteMode: 'commands', searchQuery: '', searchResults: [] }),
```

If `_reset()` is in the store, ensure it also resets the new fields (it typically uses an `initial` object — extend that).

- [ ] **Step 3: Add failing tests to `src/stores/ui.store.test.ts`**

If a test file exists, append the describe block below. If it doesn't exist, create it with `import { describe, it, expect } from 'vitest'` + `import { useUiStore } from './ui.store'` at top, then add:

```ts
describe('palette search mode', () => {
  it('starts in commands mode with empty search state', () => {
    useUiStore.getState()._reset();
    const s = useUiStore.getState();
    expect(s.paletteMode).toBe('commands');
    expect(s.searchQuery).toBe('');
    expect(s.searchResults).toEqual([]);
  });

  it('enterSearchMode flips mode to search and clears search state', () => {
    useUiStore.setState({ searchQuery: 'leftover', searchResults: [{ sessionId: 'x', title: 't', updatedAt: 1, hits: [] }] });
    useUiStore.getState().enterSearchMode();
    expect(useUiStore.getState().paletteMode).toBe('search');
    expect(useUiStore.getState().searchQuery).toBe('');
    expect(useUiStore.getState().searchResults).toEqual([]);
  });

  it('exitSearchMode flips back to commands and clears results', () => {
    useUiStore.getState().enterSearchMode();
    useUiStore.getState().setSearchResults([{ sessionId: 'x', title: 't', updatedAt: 1, hits: [] }]);
    useUiStore.getState().exitSearchMode();
    expect(useUiStore.getState().paletteMode).toBe('commands');
    expect(useUiStore.getState().searchResults).toEqual([]);
  });

  it('closePalette resets search state', () => {
    useUiStore.getState().enterSearchMode();
    useUiStore.getState().setSearchResults([{ sessionId: 'x', title: 't', updatedAt: 1, hits: [] }]);
    useUiStore.getState().closePalette();
    expect(useUiStore.getState().paletteMode).toBe('commands');
    expect(useUiStore.getState().searchResults).toEqual([]);
  });

  it('setSearchResults stores the array', () => {
    useUiStore.getState().setSearchResults([{ sessionId: 'a', title: 't', updatedAt: 1, hits: [] }]);
    expect(useUiStore.getState().searchResults).toHaveLength(1);
  });
});
```

- [ ] **Step 4: Run + lint**

```bash
npx vitest run src/stores/ui.store.test.ts
npm run lint
```

Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add src/stores/ui.store.ts src/stores/ui.store.test.ts
git commit -m "feat(slice-15): ui.store palette mode + search state"
```

---

## Phase I — Command Palette integration

### Task I1: "Search history…" command + search-mode rendering in CommandPalette + tests

**Files:**
- Modify: `src/hooks/useCommands.ts`
- Modify: `src/components/palette/CommandPalette.tsx`
- Modify: `src/components/palette/CommandPalette.test.tsx`

- [ ] **Step 1: Add the "Search history…" command in `src/hooks/useCommands.ts`**

In the existing `useCommands()` function, near the other sessions group commands (find the `'sessions.new'` push), add:

```ts
out.push({
  id: 'sessions.search-history',
  group: 'sessions',
  label: 'Search history…',
  icon: Search,
  run: async () => {
    useUiStore.getState().enterSearchMode();
  },
});
```

Add the `Search` import from `lucide-react` (alongside the existing icon imports near the top of the file).

The command's `run()` does NOT close the palette — it switches the palette into search mode while keeping it open. The existing `runCmd` wrapper in `CommandPalette.tsx` always calls `close()` after `cmd.run()`; we change that next.

- [ ] **Step 2: Replace `src/components/palette/CommandPalette.tsx`**

```tsx
import { useEffect, useState } from 'react';
import { Command as Cmdk } from 'cmdk';
import { useUiStore } from '@/src/stores/ui.store';
import { useSessionsStore } from '@/src/stores/sessions.store';
import { useCommands } from '@/src/hooks/useCommands';
import { CommandItem } from './CommandItem';
import { SnippetHighlight } from './SnippetHighlight';
import { searchApi } from '@/src/lib/api/search.api';
import type { Command, CommandGroup } from '@/src/types/command.types';
import type { SessionHits } from '@/src/types/search.types';

const GROUP_LABEL: Record<CommandGroup, string> = {
  sessions: 'Sessions',
  profiles: 'Profiles',
  ui: 'UI',
  context: 'Context',
};

const GROUP_ORDER: CommandGroup[] = ['sessions', 'profiles', 'ui', 'context'];

function groupBy(cmds: Command[]): Record<CommandGroup, Command[]> {
  const out: Record<CommandGroup, Command[]> = {
    sessions: [],
    profiles: [],
    ui: [],
    context: [],
  };
  for (const c of cmds) out[c.group].push(c);
  return out;
}

const DEBOUNCE_MS = 150;

export function CommandPalette() {
  const open = useUiStore((s) => s.paletteOpen);
  const close = useUiStore((s) => s.closePalette);
  const mode = useUiStore((s) => s.paletteMode);
  const searchQuery = useUiStore((s) => s.searchQuery);
  const searchResults = useUiStore((s) => s.searchResults);
  const setSearchQuery = useUiStore((s) => s.setSearchQuery);
  const setSearchResults = useUiStore((s) => s.setSearchResults);
  const exitSearchMode = useUiStore((s) => s.exitSearchMode);
  const setActiveSession = useSessionsStore((s) => s.setActive);
  const commands = useCommands();

  const [inputValue, setInputValue] = useState('');

  // Reset the input whenever the mode changes (commands ↔ search).
  useEffect(() => {
    setInputValue('');
  }, [mode]);

  // Debounce: push the user's typing into the store as searchQuery.
  useEffect(() => {
    if (mode !== 'search') return;
    const t = setTimeout(() => {
      setSearchQuery(inputValue);
    }, DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [inputValue, mode, setSearchQuery]);

  // Effect: when searchQuery changes, hit the API.
  useEffect(() => {
    if (mode !== 'search') return;
    if (searchQuery.trim().length === 0) {
      setSearchResults([]);
      return;
    }
    const aborter = new AbortController();
    searchApi
      .search(searchQuery, { signal: aborter.signal })
      .then((results) => setSearchResults(results))
      .catch(() => {
        // Network error or abort — leave previous results in place.
      });
    return () => aborter.abort();
  }, [searchQuery, mode, setSearchResults]);

  if (!open) return null;

  const groups = groupBy(commands);

  const runCmd = async (cmd: Command) => {
    try {
      await cmd.run();
    } catch {
      // store owns error display
    } finally {
      // The "Search history…" command intentionally KEEPS the palette open
      // (it switches into search mode). All other commands close.
      if (cmd.id !== 'sessions.search-history') {
        close();
      }
    }
  };

  const onSelectResult = (sessionId: string) => {
    setActiveSession(sessionId);
    close();
  };

  return (
    <Cmdk.Dialog
      open={open}
      onOpenChange={(v) => (v ? null : close())}
      label="Command palette"
      className="fixed inset-0 z-50 flex items-start justify-center pt-[15vh] bg-black/60"
      contentClassName="w-full max-w-xl bg-surface-2 border border-border-subtle rounded-lg shadow-2xl overflow-hidden"
    >
      <Cmdk.Input
        autoFocus
        placeholder={mode === 'search' ? 'Search messages…' : 'Type a command…'}
        value={inputValue}
        onValueChange={setInputValue}
        onKeyDown={(e) => {
          if (mode === 'search' && e.key === 'Escape') {
            e.preventDefault();
            e.stopPropagation();
            exitSearchMode();
          }
        }}
        className="w-full px-3 py-2 bg-surface-3 border-b border-border-subtle text-sm text-white outline-none placeholder:text-zinc-500"
      />
      <Cmdk.List className="max-h-80 overflow-y-auto p-1">
        {mode === 'commands' ? (
          <>
            <Cmdk.Empty className="px-3 py-4 text-center text-xs text-zinc-500">
              No matching commands
            </Cmdk.Empty>
            {GROUP_ORDER.map((g) =>
              groups[g].length === 0 ? null : (
                <Cmdk.Group
                  key={g}
                  heading={GROUP_LABEL[g]}
                  className="px-1 py-1 [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1 [&_[cmdk-group-heading]]:text-[10px] [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-widest [&_[cmdk-group-heading]]:text-zinc-500 [&_[cmdk-group-heading]]:font-mono"
                >
                  {groups[g].map((c) => (
                    <Cmdk.Item
                      key={c.id}
                      value={`${c.label} ${c.id}`}
                      onSelect={() => runCmd(c)}
                      className="px-2 py-1.5 rounded cursor-pointer data-[selected=true]:bg-surface-3"
                    >
                      <CommandItem label={c.label} shortcut={c.shortcut} icon={c.icon} />
                    </Cmdk.Item>
                  ))}
                </Cmdk.Group>
              ),
            )}
          </>
        ) : (
          <SearchResults results={searchResults} onSelect={onSelectResult} />
        )}
      </Cmdk.List>
    </Cmdk.Dialog>
  );
}

function SearchResults({
  results,
  onSelect,
}: {
  results: SessionHits[];
  onSelect: (sessionId: string) => void;
}): JSX.Element {
  if (results.length === 0) {
    return (
      <div className="px-3 py-4 text-center text-xs text-zinc-500">
        No results
      </div>
    );
  }
  return (
    <>
      {results.map((session) => (
        <Cmdk.Item
          key={session.sessionId}
          value={`session-${session.sessionId}`}
          onSelect={() => onSelect(session.sessionId)}
          className="px-2 py-2 rounded cursor-pointer data-[selected=true]:bg-surface-3 flex flex-col gap-1"
        >
          <div className="text-sm text-white font-medium">
            {session.title || '(untitled session)'}
          </div>
          <div className="flex flex-col gap-0.5">
            {session.hits.map((hit) => (
              <SnippetHighlight
                key={hit.messageId}
                snippet={hit.snippet}
                className="text-xs text-zinc-400 truncate"
              />
            ))}
          </div>
        </Cmdk.Item>
      ))}
    </>
  );
}
```

The Escape key handling in search mode calls `exitSearchMode()` and stops propagation so the cmdk library doesn't close the dialog.

- [ ] **Step 3: Append failing tests to `src/components/palette/CommandPalette.test.tsx`**

Read the existing test file to confirm the test harness (MSW, store reset, etc.). Add a new describe block:

```ts
describe('CommandPalette search mode', () => {
  beforeEach(() => {
    useUiStore.getState()._reset?.();
    useUiStore.setState({ paletteOpen: true, paletteMode: 'commands' });
  });

  it('shows the "Search history…" command in the commands list', () => {
    render(<CommandPalette />);
    expect(screen.getByText('Search history…')).toBeInTheDocument();
  });

  it('clicking "Search history…" switches the palette into search mode (placeholder changes)', async () => {
    const user = userEvent.setup();
    render(<CommandPalette />);
    expect(screen.getByPlaceholderText(/type a command/i)).toBeInTheDocument();
    await user.click(screen.getByText('Search history…'));
    await waitFor(() => {
      expect(screen.getByPlaceholderText(/search messages/i)).toBeInTheDocument();
    });
    expect(useUiStore.getState().paletteMode).toBe('search');
  });

  it('typing in search mode triggers searchApi.search via MSW', async () => {
    let receivedQuery = '';
    server.use(
      http.get('http://localhost/api/search', ({ request }) => {
        const url = new URL(request.url);
        receivedQuery = url.searchParams.get('q') ?? '';
        return HttpResponse.json({
          results: [
            {
              sessionId: 'S1',
              title: 'Search target',
              updatedAt: 1,
              hits: [{ messageId: 'm1', role: 'user', snippet: 'hello «M»world«/M»' }],
            },
          ],
        });
      }),
    );

    useUiStore.setState({ paletteMode: 'search' });
    const user = userEvent.setup();
    render(<CommandPalette />);
    await user.type(screen.getByPlaceholderText(/search messages/i), 'world');
    await waitFor(() => {
      expect(receivedQuery).toBe('world');
    });
    await waitFor(() => {
      expect(screen.getByText('Search target')).toBeInTheDocument();
    });
  });

  it('renders <mark> elements around the highlighted snippet segments', async () => {
    server.use(
      http.get('http://localhost/api/search', () =>
        HttpResponse.json({
          results: [
            {
              sessionId: 'S1',
              title: 'S1',
              updatedAt: 1,
              hits: [{ messageId: 'm1', role: 'user', snippet: 'see «M»match«/M» here' }],
            },
          ],
        }),
      ),
    );
    useUiStore.setState({ paletteMode: 'search' });
    const user = userEvent.setup();
    render(<CommandPalette />);
    await user.type(screen.getByPlaceholderText(/search messages/i), 'match');
    await waitFor(() => {
      const mark = document.querySelector('mark');
      expect(mark).not.toBeNull();
      expect(mark!.textContent).toBe('match');
    });
  });

  it('selecting a result calls sessionsStore.setActive and closes the palette', async () => {
    server.use(
      http.get('http://localhost/api/search', () =>
        HttpResponse.json({
          results: [
            {
              sessionId: 'session-target',
              title: 'Pick me',
              updatedAt: 1,
              hits: [{ messageId: 'm1', role: 'user', snippet: 'pick' }],
            },
          ],
        }),
      ),
    );

    const setActiveSpy = vi.fn();
    useSessionsStore.setState({ setActive: setActiveSpy });

    useUiStore.setState({ paletteMode: 'search' });
    const user = userEvent.setup();
    render(<CommandPalette />);
    await user.type(screen.getByPlaceholderText(/search messages/i), 'pick');
    await waitFor(() => {
      expect(screen.getByText('Pick me')).toBeInTheDocument();
    });
    await user.click(screen.getByText('Pick me'));
    expect(setActiveSpy).toHaveBeenCalledWith('session-target');
    expect(useUiStore.getState().paletteOpen).toBe(false);
  });

  it('Escape in search mode exits to command mode without closing', async () => {
    useUiStore.setState({ paletteMode: 'search' });
    const user = userEvent.setup();
    render(<CommandPalette />);
    const input = screen.getByPlaceholderText(/search messages/i);
    input.focus();
    await user.keyboard('{Escape}');
    expect(useUiStore.getState().paletteMode).toBe('commands');
    expect(useUiStore.getState().paletteOpen).toBe(true);
  });
});
```

Add the imports at the top of the test file (if not already present): `import { useUiStore } from '@/src/stores/ui.store'`, `import { useSessionsStore } from '@/src/stores/sessions.store'`, `import { http, HttpResponse } from 'msw'`, `import { server } from '@/src/test/msw-server'`, `import { vi, beforeEach } from 'vitest'`, `import { waitFor } from '@testing-library/react'`.

- [ ] **Step 4: Run + lint**

```bash
npx vitest run src/components/palette/CommandPalette.test.tsx
npx vitest run src
npm run lint
```

Expected: all existing tests + the 6 new pass; full FE suite green.

- [ ] **Step 5: Commit**

```bash
git add src/hooks/useCommands.ts src/components/palette/CommandPalette.tsx src/components/palette/CommandPalette.test.tsx
git commit -m "feat(slice-15): CommandPalette search mode + Search history command"
```

---

## Phase J — FE integration test

### Task J1: End-to-end search flow

**Files:**
- Create: `src/integration/search.integration.test.tsx`

- [ ] **Step 1: Create the file**

```tsx
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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

beforeEach(() => {
  useUiStore.getState()._reset();
  useSessionsStore.getState()._reset();
  useProfilesStore.getState()._reset();
  useContextStore.getState()._reset();
  useSubAgentsStore.getState()._reset();
  useMcpStore.getState()._reset();
  useProvidersStore.getState()._reset();
  useChatStore.getState()._reset();
  localStorage.clear();
});

afterEach(() => {
  server.resetHandlers();
});

describe('search integration', () => {
  it('Cmd+K → Search history… → type → click result → active session changes', async () => {
    server.use(
      http.get('http://localhost/api/search', () =>
        HttpResponse.json({
          results: [
            {
              sessionId: 'S-target',
              title: 'Target session',
              updatedAt: 100,
              hits: [{ messageId: 'm1', role: 'user', snippet: 'a «M»hyperloop«/M» mention' }],
            },
            {
              sessionId: 'S-other',
              title: 'Other session',
              updatedAt: 50,
              hits: [{ messageId: 'm2', role: 'model', snippet: 'also has «M»hyperloop«/M»' }],
            },
          ],
        }),
      ),
    );

    const user = userEvent.setup();
    render(<App />);

    // Open the palette via the existing global keyboard shortcut.
    await user.keyboard('{Meta>}k{/Meta}');
    await waitFor(() => {
      expect(useUiStore.getState().paletteOpen).toBe(true);
    });

    // Click "Search history…".
    await user.click(screen.getByText('Search history…'));
    await waitFor(() => {
      expect(useUiStore.getState().paletteMode).toBe('search');
    });

    // Type the query.
    await user.type(screen.getByPlaceholderText(/search messages/i), 'hyperloop');

    // Both sessions render.
    await waitFor(() => {
      expect(screen.getByText('Target session')).toBeInTheDocument();
      expect(screen.getByText('Other session')).toBeInTheDocument();
    });

    // Click the first result.
    await user.click(screen.getByText('Target session'));

    // Palette closed and active session updated.
    await waitFor(() => {
      expect(useUiStore.getState().paletteOpen).toBe(false);
      expect(useSessionsStore.getState().activeSessionId).toBe('S-target');
    });
  });
});
```

- [ ] **Step 2: Run + lint**

```bash
npx vitest run src/integration/search.integration.test.tsx
npx vitest run src
npm run lint
```

Expected: 1/1 pass; full FE suite green.

- [ ] **Step 3: Commit**

```bash
git add src/integration/search.integration.test.tsx
git commit -m "test(slice-15): integration — Cmd+K → Search history → click result"
```

---

## Phase K — Final verification + PR

### Task K1: lint + full tests + e2e + push + PR

- [ ] **Step 1: Lint**

```bash
npm run lint
```

Expected: clean.

- [ ] **Step 2: Vitest (full)**

```bash
npx vitest run
```

Expected: all pass. Previous baseline (post-slice 14) was 977. Expected new count: 977 + ~25 new (9 service + 4 route + 2 history + 1 migrate + 2 api + 5 component + 5 store + 6 palette + 1 integration) ≈ 1002.

- [ ] **Step 3: Playwright (regression check)**

```bash
npx playwright test
```

Expected: 13/13 pass. No new e2e per spec non-goals; the existing tests cover the rest of the app and continue to pass because route mounting + store extensions are additive.

- [ ] **Step 4: Verify branch state**

```bash
git log --oneline main..HEAD
```

You should see: spec commit + plan commit + Phase B/C/D/E/F/G/H/I/J commits, in order (roughly 11 commits).

- [ ] **Step 5: Push**

```bash
git push -u origin feat/slice-15-fts-search
```

- [ ] **Step 6: Open PR**

```bash
gh pr create --title "feat(slice-15): full-text search over messages (SQLite FTS5)" --body "$(cat <<'EOF'
## Summary

Slice 15 adds full-text search across all chat messages, surfaced through a new "Search history…" command in the existing Command Palette.

- **SQLite FTS5 virtual table** (\`messages_fts\`) created in migration \`002_fts.sql\`. Standalone (not external-content); HistoryStore.append/delete maintain it inside the existing transactions.
- **\`SearchService\`** runs an FTS5 MATCH query joined to \`sessions\`, uses \`snippet()\` for highlighted excerpts with non-HTML markers (\`«M»\` / \`«/M»\`), and returns session-grouped results ordered by BM25 rank.
- **\`GET /api/search?q=...&limit=...\`** route validates the query and returns \`{ results: SessionHits[] }\`.
- **Command Palette** gains a "Search history…" command that switches the palette into search mode. Typing debounces a fetch (150ms); results render as session-grouped items with \`<mark>\`-highlighted snippets. Enter on a result switches sessions and closes the palette. Escape exits search mode back to commands.

## Architecture

The XSS-free snippet rendering is the key design choice: SQLite's \`snippet()\` does NOT HTML-escape user content, so we configure it to insert non-HTML markers (\`«M»\` / \`«/M»\`) and the FE \`<SnippetHighlight>\` component splits on those markers to emit React \`<mark>\` elements directly. Literal HTML characters in user content (e.g. \`<script>\`) render as text nodes, escaped by React automatically.

Spec: \`docs/superpowers/specs/2026-05-21-aether-slice-15-fts-search-design.md\`
Plan: \`docs/superpowers/plans/2026-05-21-aether-slice-15-fts-search.md\`

## Test plan

- [x] \`npm run lint\` — clean
- [x] \`npx vitest run\` — all passing (previous 977 + ~25 new)
- [x] \`npx playwright test\` — 13/13 (no new e2e per spec non-goals)
- [x] New backend tests: \`SearchService\` (9 cases), search route (4 cases), HistoryStore FTS sync (2 cases), migration verification (1 case)
- [x] New FE tests: \`searchApi\` (2 cases), \`<SnippetHighlight>\` (5 cases — explicitly tests literal \`<script>\` is rendered as text, no XSS surface), \`ui.store\` search mode (5 cases), \`CommandPalette\` search mode (6 cases)
- [x] New FE integration: Cmd+K → Search history… → type → click result → active session changes

## Notes

- No new dependency. SQLite FTS5 ships with \`better-sqlite3\`.
- No schema change to existing tables; \`messages_fts\` is a new virtual table.
- The migration's backfill statement (\`INSERT INTO messages_fts SELECT ... FROM messages\`) is idempotent on empty data and one-shot for any existing rows.
- FTS5 syntax errors (e.g., unmatched quote) are silently treated as zero results — friendlier UX than surfacing SQLite errors.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Self-review notes

**Spec coverage:**
- ✅ `messages_fts` virtual table created in migration 002 — Task B1.
- ✅ Backfill statement for any existing rows — Task B1 (within 002_fts.sql).
- ✅ HistoryStore.append/delete maintain FTS index — Task C1.
- ✅ SearchService with grouping + BM25 ordering — Task D1.
- ✅ Non-HTML markers `«M»` / `«/M»` for XSS-free highlights — Task D1 (SQL) + Task G1 (`<SnippetHighlight>`).
- ✅ GET /api/search route + 400 / 200 / limit clamping — Task E1.
- ✅ FE searchApi + MSW default handler — Task F1.
- ✅ `<SnippetHighlight>` component (no raw HTML write) — Task G1.
- ✅ ui.store palette mode + search state — Task H1.
- ✅ "Search history…" command + Command Palette search-mode rendering — Task I1.
- ✅ Debounced fetch + AbortController per query — Task I1.
- ✅ Escape exits search mode without closing palette — Task I1.
- ✅ FE integration test — Task J1.
- ✅ No Playwright e2e per spec non-goals — Task K1 only runs the regression.

**Placeholder scan:** searched for "TBD", "TODO", "implement later", and similar — none present. The plan instructs the implementer to "adapt to the existing harness" in a few spots — these are guidance, not placeholders.

**Type consistency:** `SessionHits` and `SnippetHit` shapes match across the backend (`server/domain/search/search.types.ts`) and the frontend (`src/types/search.types.ts`). `searchApi.search(q, opts?)` opts shape matches its consumers. The store fields (`paletteMode`, `searchQuery`, `searchResults`) and actions (`enterSearchMode`, `exitSearchMode`, `setSearchQuery`, `setSearchResults`) are referenced consistently by `CommandPalette.tsx` and `useCommands.ts`. The marker strings `«M»` / `«/M»` are defined in `SnippetHighlight.tsx` as constants and referenced in the SQL query in `search.service.ts`; both must stay in sync.
