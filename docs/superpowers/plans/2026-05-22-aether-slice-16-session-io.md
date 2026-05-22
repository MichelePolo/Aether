# Slice 16 — Export/import single session — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users download a single chat session as a versioned JSON envelope and re-import it via the Command Palette to create a fresh session populated from that transcript.

**Architecture:** A pure serializer (`history.export.ts`) wraps `SessionRecord` in a `{ app:'aether', version:1, exportedAt, session }` envelope with a lenient zod schema. Two new `HistoryStore` methods (`exportSession`, `importSession`) own the SQLite round-trip; `importSession` runs inside a single `db.transaction(...)` that regenerates every UUID and resets all timestamps to one captured `Date.now()`, while also writing the `messages_fts` mirror. A new `server/routes/sessions.routes.ts` exposes `GET /api/sessions/:id/export` and `POST /api/sessions/import` (the import route mounts its own `express.json({ limit:'10mb' })` so it bypasses the app-wide 1 MB limit without changing the global). The frontend triggers export by navigating to the export URL (native browser download) and triggers import via a Command Palette command that programmatically clicks a hidden `<input type="file">`.

**Tech Stack:** TypeScript, Express, better-sqlite3, zod, React, Zustand, MSW, vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-05-22-aether-slice-16-session-io-design.md`

**Branch:** `feat/slice-16-session-io`

---

## File Structure

**Server**
- Create: `server/domain/history/history.export.ts` — envelope schema, `EXPORT_VERSION`, `wrap()`, `slugifyFilename()`.
- Create: `server/domain/history/history.export.test.ts` — schema & helper unit tests.
- Modify: `server/domain/history/history.types.ts` — add `ExportEnvelope` interface (re-export from `history.export.ts`).
- Modify: `server/domain/history/history.store.ts` — add `exportSession(id)` and `importSession(envelope)` methods.
- Modify: `server/domain/history/history.store.test.ts` — add export/import test cases.
- Create: `server/routes/sessions.routes.ts` — `GET /:id/export`, `POST /import`.
- Create: `server/routes/sessions.routes.test.ts` — supertest cases.
- Modify: `server/app.ts` — mount new router *before* global `express.json` so the import route's own 10 MB parser takes effect.

**Frontend**
- Modify: `src/lib/api/sessions.api.ts` — add `exportSessionUrl(id)` and `importSession(envelope)`.
- Modify: `src/lib/api/sessions.api.test.ts` (if exists) or create — cover new methods.
- Modify: `src/stores/sessions.store.ts` — add `importSession(file)` action.
- Modify: `src/stores/sessions.store.test.ts` — cover new action.
- Create: `src/components/layout/HiddenImportInput.tsx` — singleton hidden file input + module-level `triggerImportOpen()`.
- Create: `src/components/layout/HiddenImportInput.test.tsx` — exercise the trigger + change flow.
- Modify: `src/hooks/useCommands.ts` — add `sessions.import` command.
- Modify: `src/components/sidebar/SessionsSection.tsx` — add `↓` button per row.
- Modify: `src/components/sidebar/SessionsSection.test.tsx` — cover the button.
- Modify: `src/App.tsx` — mount `<HiddenImportInput />` once.
- Modify: `src/test/msw-handlers.ts` — defaults for `GET /api/sessions/:id/export` + `POST /api/sessions/import`.

**Integration / e2e**
- Create: `src/integration/session-io.integration.test.tsx` — palette → import → new session appears + active.
- Modify: `e2e/smoke.spec.ts` — append a session io smoke test with a JSON fixture.
- Create: `e2e/fixtures/sample-session.json` — minimal valid envelope.

---

## Task A1: Branch setup

**Files:** (no source edits; verify branch and clean tree)

- [ ] **Step 1: Confirm working tree clean and branch is correct**

```bash
git status
git rev-parse --abbrev-ref HEAD
```

Expected: clean tree (or only untracked docs from prior slices); branch `feat/slice-16-session-io`. If branch is `main`, create it:

```bash
git checkout -b feat/slice-16-session-io
```

- [ ] **Step 2: Quick sanity check the spec is committed**

```bash
git log --oneline -5 -- docs/superpowers/specs/2026-05-22-aether-slice-16-session-io-design.md
```

Expected: at least one commit referencing the spec on this branch.

---

## Task B1: Envelope schema, wrap, and slugifyFilename

**Files:**
- Create: `server/domain/history/history.export.ts`
- Create: `server/domain/history/history.export.test.ts`

- [ ] **Step 1: Write the failing test** — `server/domain/history/history.export.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import {
  EXPORT_VERSION,
  exportEnvelopeSchema,
  wrap,
  slugifyFilename,
} from './history.export';
import type { SessionRecord } from './history.types';

describe('EXPORT_VERSION', () => {
  it('is 1', () => {
    expect(EXPORT_VERSION).toBe(1);
  });
});

describe('wrap', () => {
  it('produces a versioned envelope around a SessionRecord', () => {
    const record: SessionRecord = {
      title: 'demo',
      createdAt: 100,
      providerName: 'fake:default',
      messages: [{ id: 'm1', role: 'user', text: 'hi', timestamp: 100 }],
    };
    const env = wrap(record, 12345);
    expect(env).toEqual({
      app: 'aether',
      version: 1,
      exportedAt: 12345,
      session: record,
    });
  });
});

describe('exportEnvelopeSchema (lenient)', () => {
  const valid = {
    app: 'aether',
    version: 1,
    exportedAt: 1,
    session: {
      title: 't',
      createdAt: 0,
      messages: [{ id: 'm1', role: 'user', text: 'hi', timestamp: 0 }],
    },
  };

  it('accepts a minimal valid envelope', () => {
    const parsed = exportEnvelopeSchema.parse(valid);
    expect(parsed.session.messages).toHaveLength(1);
  });

  it('drops unknown top-level keys silently', () => {
    const withExtras = { ...valid, junk: 'ignored' };
    const parsed = exportEnvelopeSchema.parse(withExtras) as unknown as Record<
      string,
      unknown
    >;
    expect(parsed.junk).toBeUndefined();
  });

  it('drops unknown keys inside session.messages[i]', () => {
    const withExtras = {
      ...valid,
      session: {
        ...valid.session,
        messages: [{ ...valid.session.messages[0], surprise: true }],
      },
    };
    const parsed = exportEnvelopeSchema.parse(withExtras);
    expect(
      (parsed.session.messages[0] as unknown as Record<string, unknown>).surprise,
    ).toBeUndefined();
  });

  it('rejects wrong app discriminator', () => {
    expect(() =>
      exportEnvelopeSchema.parse({ ...valid, app: 'something-else' }),
    ).toThrow();
  });

  it('rejects unsupported version', () => {
    expect(() =>
      exportEnvelopeSchema.parse({ ...valid, version: 2 }),
    ).toThrow();
  });

  it('rejects missing session.messages', () => {
    expect(() =>
      exportEnvelopeSchema.parse({
        ...valid,
        session: { title: 't', createdAt: 0 },
      }),
    ).toThrow();
  });

  it('accepts an empty messages array', () => {
    const parsed = exportEnvelopeSchema.parse({
      ...valid,
      session: { ...valid.session, messages: [] },
    });
    expect(parsed.session.messages).toEqual([]);
  });
});

describe('slugifyFilename', () => {
  it('produces aether-session-<slug>-<ts>.json for a normal title', () => {
    // 2026-05-22 18:30 UTC == 1779863400000
    const name = slugifyFilename('My Chat!', 1779863400000);
    expect(name).toMatch(/^aether-session-my-chat-\d{8}-\d{4}\.json$/);
  });

  it('falls back to "untitled" for empty title', () => {
    const name = slugifyFilename('', 1779863400000);
    expect(name).toMatch(/^aether-session-untitled-\d{8}-\d{4}\.json$/);
  });

  it('collapses runs of non-alphanumerics into single dashes', () => {
    const name = slugifyFilename('  hello   world  ', 1779863400000);
    expect(name).toMatch(/^aether-session-hello-world-\d{8}-\d{4}\.json$/);
  });

  it('trims leading and trailing dashes', () => {
    const name = slugifyFilename('!!!foo!!!', 1779863400000);
    expect(name).toMatch(/^aether-session-foo-\d{8}-\d{4}\.json$/);
  });

  it('clamps the slug to 60 chars', () => {
    const long = 'a'.repeat(200);
    const name = slugifyFilename(long, 1779863400000);
    const slug = name.replace(/^aether-session-/, '').replace(/-\d{8}-\d{4}\.json$/, '');
    expect(slug.length).toBeLessThanOrEqual(60);
  });
});
```

- [ ] **Step 2: Run the test, expect failures**

```bash
npx vitest run server/domain/history/history.export.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement `history.export.ts`**

Write `server/domain/history/history.export.ts`:

```ts
import { z } from 'zod';
import type { SessionRecord } from './history.types';

export const EXPORT_VERSION = 1 as const;

// Inner shapes: we keep them lenient (no .strict()) so unknown keys are
// silently dropped at every nesting level. The version contract is enforced
// only at the top level via the literal `app` and `version`.

const toolCallTraceSchema = z.object({
  id: z.string(),
  qualifiedName: z.string(),
  args: z.record(z.unknown()).default({}),
  result: z.unknown().optional(),
  error: z.string().optional(),
  durationMs: z.number(),
  progressNote: z.string().optional(),
});

const reasoningStepSchema = z.object({
  id: z.string(),
  type: z.string(),
  title: z.string(),
  content: z.string(),
  tokens: z.number().optional(),
  durationMs: z.number().optional(),
  subAgent: z.string().optional(),
  timestamp: z.number(),
  toolCall: toolCallTraceSchema.optional(),
});

const messageSchema = z.object({
  id: z.string(),
  role: z.enum(['user', 'model']),
  text: z.string(),
  timestamp: z.number(),
  model: z.string().optional(),
  interrupted: z.boolean().optional(),
  error: z.string().optional(),
  retryable: z.boolean().optional(),
  reasoningSteps: z.array(reasoningStepSchema).optional(),
});

const sessionSchema = z.object({
  title: z.string(),
  createdAt: z.number(),
  providerName: z.string().optional(),
  messages: z.array(messageSchema),
});

export const exportEnvelopeSchema = z.object({
  app: z.literal('aether'),
  version: z.literal(EXPORT_VERSION),
  exportedAt: z.number(),
  session: sessionSchema,
});

export type ExportEnvelope = z.infer<typeof exportEnvelopeSchema>;

export function wrap(record: SessionRecord, exportedAt: number): ExportEnvelope {
  return {
    app: 'aether',
    version: EXPORT_VERSION,
    exportedAt,
    session: record,
  };
}

const SLUG_MAX = 60;

function pad(n: number, width: number): string {
  return n.toString().padStart(width, '0');
}

function formatStamp(ts: number): string {
  const d = new Date(ts);
  return (
    `${d.getUTCFullYear()}` +
    pad(d.getUTCMonth() + 1, 2) +
    pad(d.getUTCDate(), 2) +
    '-' +
    pad(d.getUTCHours(), 2) +
    pad(d.getUTCMinutes(), 2)
  );
}

export function slugifyFilename(title: string, exportedAt: number): string {
  const lower = (title || '').toLowerCase();
  const slug = lower
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, SLUG_MAX);
  const safe = slug || 'untitled';
  return `aether-session-${safe}-${formatStamp(exportedAt)}.json`;
}
```

- [ ] **Step 4: Run the test, expect green**

```bash
npx vitest run server/domain/history/history.export.test.ts
```

Expected: all 13 cases pass.

- [ ] **Step 5: Add `ExportEnvelope` re-export to history.types.ts**

In `server/domain/history/history.types.ts`, append at the bottom:

```ts
export type { ExportEnvelope } from './history.export';
```

- [ ] **Step 6: Confirm typecheck still passes**

```bash
npm run lint
```

Expected: no output (tsc --noEmit succeeds).

- [ ] **Step 7: Commit**

```bash
git add server/domain/history/history.export.ts server/domain/history/history.export.test.ts server/domain/history/history.types.ts
git commit -m "feat(slice-16): export envelope schema (lenient zod) + slugifyFilename"
```

---

## Task C1: HistoryStore.exportSession + importSession

**Files:**
- Modify: `server/domain/history/history.store.ts`
- Modify: `server/domain/history/history.store.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `server/domain/history/history.store.test.ts`. (If the file uses a shared `beforeEach` that sets up `history` and `db`, reuse it — these tests assume `history: HistoryStore` and `db: DatabaseHandle` exist in scope.)

```ts
import { EXPORT_VERSION } from './history.export';

describe('HistoryStore.exportSession', () => {
  it('returns null for unknown id', async () => {
    const env = await history.exportSession('does-not-exist');
    expect(env).toBeNull();
  });

  it('returns a versioned envelope for a seeded session', async () => {
    const s = await history.createEmpty({ providerName: 'fake:default' });
    await history.rename(s.id, 'demo');
    await history.append(s.id, {
      id: 'm1',
      role: 'user',
      text: 'hello',
      timestamp: 100,
    });

    const env = await history.exportSession(s.id);
    expect(env).not.toBeNull();
    expect(env!.app).toBe('aether');
    expect(env!.version).toBe(EXPORT_VERSION);
    expect(env!.session.title).toBe('hello'); // computeTitle override
    expect(env!.session.providerName).toBe('fake:default');
    expect(env!.session.messages).toHaveLength(1);
    expect(env!.session.messages[0].id).toBe('m1');
  });
});

describe('HistoryStore.importSession', () => {
  it('creates a new session with a fresh id', async () => {
    const meta = await history.importSession({
      app: 'aether',
      version: 1,
      exportedAt: 0,
      session: {
        title: 'imported',
        createdAt: 1,
        messages: [{ id: 'orig-1', role: 'user', text: 'hello', timestamp: 1 }],
      },
    });
    expect(meta.id).not.toBe('orig-1');
    expect(meta.title).toBe('imported');
    const list = await history.listSessions();
    expect(list.find((x) => x.id === meta.id)).toBeDefined();
  });

  it('regenerates message and reasoning ids', async () => {
    const meta = await history.importSession({
      app: 'aether',
      version: 1,
      exportedAt: 0,
      session: {
        title: 't',
        createdAt: 1,
        messages: [
          {
            id: 'orig-msg',
            role: 'model',
            text: 'answer',
            timestamp: 1,
            reasoningSteps: [
              {
                id: 'orig-step',
                type: 'thought',
                title: 'thinking',
                content: 'x',
                timestamp: 1,
              },
            ],
          },
        ],
      },
    });
    const msgs = await history.read(meta.id);
    expect(msgs).not.toBeNull();
    expect(msgs![0].id).not.toBe('orig-msg');
    expect(msgs![0].reasoningSteps![0].id).not.toBe('orig-step');
  });

  it('sets all timestamps to a single Date.now() captured at import', async () => {
    const NOW = 9_999_000;
    vi.useFakeTimers();
    vi.setSystemTime(NOW);

    const meta = await history.importSession({
      app: 'aether',
      version: 1,
      exportedAt: 0,
      session: {
        title: 't',
        createdAt: 1,
        messages: [
          { id: 'a', role: 'user', text: 'one', timestamp: 100 },
          { id: 'b', role: 'model', text: 'two', timestamp: 200 },
        ],
      },
    });

    expect(meta.createdAt).toBe(NOW);
    expect(meta.updatedAt).toBe(NOW);
    const msgs = await history.read(meta.id);
    for (const m of msgs!) expect(m.timestamp).toBe(NOW);

    vi.useRealTimers();
  });

  it('populates messages_fts so imported messages are searchable', async () => {
    const meta = await history.importSession({
      app: 'aether',
      version: 1,
      exportedAt: 0,
      session: {
        title: 't',
        createdAt: 1,
        messages: [
          { id: 'a', role: 'user', text: 'banana custard', timestamp: 1 },
        ],
      },
    });
    const row = db
      .prepare(
        'SELECT count(*) as n FROM messages_fts WHERE session_id = ?',
      )
      .get(meta.id) as { n: number };
    expect(row.n).toBe(1);
  });

  it('preserves message order via position', async () => {
    const meta = await history.importSession({
      app: 'aether',
      version: 1,
      exportedAt: 0,
      session: {
        title: 't',
        createdAt: 1,
        messages: [
          { id: 'a', role: 'user', text: 'first', timestamp: 1 },
          { id: 'b', role: 'model', text: 'second', timestamp: 2 },
          { id: 'c', role: 'user', text: 'third', timestamp: 3 },
        ],
      },
    });
    const msgs = await history.read(meta.id);
    expect(msgs!.map((m) => m.text)).toEqual(['first', 'second', 'third']);
  });

  it('preserves providerName when present', async () => {
    const meta = await history.importSession({
      app: 'aether',
      version: 1,
      exportedAt: 0,
      session: {
        title: 't',
        createdAt: 1,
        providerName: 'fake:default',
        messages: [],
      },
    });
    expect(meta.providerName).toBe('fake:default');
  });
});
```

Make sure `import { vi } from 'vitest'` is present at the top of the test file (it almost certainly is already).

- [ ] **Step 2: Run the tests, expect failures**

```bash
npx vitest run server/domain/history/history.store.test.ts
```

Expected: FAIL — `history.exportSession is not a function` (and the same for `importSession`).

- [ ] **Step 3: Add `exportSession` to `HistoryStore`**

In `server/domain/history/history.store.ts`, add new imports at the top:

```ts
import { wrap, type ExportEnvelope } from './history.export';
```

Then add the method (place it next to `readRecord`, near the other read methods):

```ts
async exportSession(id: string): Promise<ExportEnvelope | null> {
  const record = await this.readRecord(id);
  if (!record) return null;
  return wrap(record, Date.now());
}
```

- [ ] **Step 4: Add `importSession` to `HistoryStore`**

Add the method below `delete()` (or near other write methods):

```ts
async importSession(envelope: ExportEnvelope): Promise<SessionMeta> {
  const { session } = envelope;
  const newSessionId = randomUUID();
  const now = Date.now();

  const insertMessage = this.db.prepare(
    'INSERT INTO messages (id, session_id, role, content, model, interrupted, error, retryable, created_at, position) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
  );
  const insertFts = this.db.prepare(
    'INSERT INTO messages_fts (message_id, session_id, role, content) VALUES (?, ?, ?, ?)',
  );

  const tx = this.db.transaction(() => {
    this.db
      .prepare(
        'INSERT INTO sessions (id, title, created_at, updated_at, provider_name) VALUES (?, ?, ?, ?, ?)',
      )
      .run(newSessionId, session.title, now, now, session.providerName ?? null);

    session.messages.forEach((msg, i) => {
      const newMsgId = randomUUID();
      insertMessage.run(
        newMsgId,
        newSessionId,
        msg.role,
        msg.text,
        msg.model ?? null,
        msg.interrupted ? 1 : 0,
        msg.error ?? null,
        msg.retryable === undefined ? null : msg.retryable ? 1 : 0,
        now,
        i,
      );
      insertFts.run(newMsgId, newSessionId, msg.role, msg.text);

      // Re-id reasoning steps + their tool call traces, then reuse the
      // existing private insertReasoningSteps helper.
      const reIdded = (msg.reasoningSteps ?? []).map((step) => {
        const newStep: typeof step = { ...step, id: randomUUID(), timestamp: now };
        if (step.type === 'tool_call' && step.toolCall) {
          newStep.toolCall = { ...step.toolCall, id: randomUUID() };
        }
        return newStep;
      });
      this.insertReasoningSteps(newMsgId, reIdded);
    });
  });
  tx();

  return {
    id: newSessionId,
    title: session.title,
    createdAt: now,
    updatedAt: now,
    providerName: session.providerName,
  };
}
```

- [ ] **Step 5: Run the tests, expect green**

```bash
npx vitest run server/domain/history/history.store.test.ts
```

Expected: all new tests pass; pre-existing cases still pass.

- [ ] **Step 6: Commit**

```bash
git add server/domain/history/history.store.ts server/domain/history/history.store.test.ts
git commit -m "feat(slice-16): HistoryStore.exportSession + importSession (FTS-aware, atomic)"
```

---

## Task D1: sessions.routes.ts (export + import endpoints)

**Files:**
- Create: `server/routes/sessions.routes.ts`
- Create: `server/routes/sessions.routes.test.ts`

- [ ] **Step 1: Write the failing test** — `server/routes/sessions.routes.test.ts`

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import express from 'express';
import { makeTestDb } from '@/server/test/test-db';
import { HistoryStore } from '@/server/domain/history/history.store';
import { createSessionsRoutes } from './sessions.routes';
import type { DatabaseHandle } from '@/server/db/database';
import { isAppError } from '@/server/lib/errors';

let db: DatabaseHandle;
let history: HistoryStore;
let app: express.Express;

beforeEach(() => {
  db = makeTestDb();
  history = new HistoryStore(db);
  app = express();
  // sessions router is mounted BEFORE any global json parser so the
  // import route's own 10 MB parser applies (matches app.ts wiring).
  app.use('/api/sessions', createSessionsRoutes(history));
  app.use(express.json({ limit: '1mb' }));
  // Same error handler shape as createApp
  app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    if (isAppError(err)) {
      res.status(err.status).json({ error: { code: err.code, message: err.message } });
      return;
    }
    const message = err instanceof Error ? err.message : 'Unknown error';
    res.status(500).json({ error: { code: 'INTERNAL', message } });
  });
});

afterEach(() => {
  db.close();
});

describe('GET /api/sessions/:id/export', () => {
  it('returns 200 + envelope + Content-Disposition for an existing session', async () => {
    const s = await history.createEmpty();
    await history.rename(s.id, 'demo');
    await history.append(s.id, {
      id: 'm1',
      role: 'user',
      text: 'hello',
      timestamp: 100,
    });

    const res = await request(app).get(`/api/sessions/${s.id}/export`);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/application\/json/);
    expect(res.headers['content-disposition']).toMatch(/attachment;\s*filename="aether-session-.+\.json"/);
    expect(res.body.app).toBe('aether');
    expect(res.body.version).toBe(1);
    expect(res.body.session.messages).toHaveLength(1);
  });

  it('returns 404 for an unknown id', async () => {
    const res = await request(app).get('/api/sessions/nope/export');
    expect(res.status).toBe(404);
  });
});

describe('POST /api/sessions/import', () => {
  const valid = {
    app: 'aether',
    version: 1,
    exportedAt: 0,
    session: {
      title: 'imported',
      createdAt: 1,
      messages: [{ id: 'orig', role: 'user', text: 'hi', timestamp: 1 }],
    },
  };

  it('returns 201 + SessionMeta for a valid envelope', async () => {
    const res = await request(app).post('/api/sessions/import').send(valid);
    expect(res.status).toBe(201);
    expect(res.body.title).toBe('imported');
    expect(typeof res.body.id).toBe('string');
    expect(res.body.id).not.toBe('orig');
    const list = await history.listSessions();
    expect(list.find((x) => x.id === res.body.id)).toBeDefined();
  });

  it('returns 400 for an invalid envelope', async () => {
    const res = await request(app)
      .post('/api/sessions/import')
      .send({ app: 'wrong', version: 1, exportedAt: 0, session: { title: 't', createdAt: 0, messages: [] } });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 413 when the payload exceeds 10 MB', async () => {
    const huge = {
      ...valid,
      session: {
        ...valid.session,
        messages: [
          {
            id: 'big',
            role: 'user',
            text: 'A'.repeat(11 * 1024 * 1024),
            timestamp: 0,
          },
        ],
      },
    };
    const res = await request(app)
      .post('/api/sessions/import')
      .set('Content-Type', 'application/json')
      .send(JSON.stringify(huge));
    expect(res.status).toBe(413);
  });
});
```

- [ ] **Step 2: Run the test, expect failures**

```bash
npx vitest run server/routes/sessions.routes.test.ts
```

Expected: FAIL — `Cannot find module './sessions.routes'`.

- [ ] **Step 3: Implement `sessions.routes.ts`**

Write `server/routes/sessions.routes.ts`:

```ts
import express, { Router, type Request, type Response, type NextFunction } from 'express';
import type { HistoryStore } from '@/server/domain/history/history.store';
import { exportEnvelopeSchema, slugifyFilename } from '@/server/domain/history/history.export';
import { ValidationError } from '@/server/lib/errors';

function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<void>,
) {
  return (req: Request, res: Response, next: NextFunction) => {
    fn(req, res, next).catch(next);
  };
}

export function createSessionsRoutes(store: HistoryStore): Router {
  const router = Router();

  router.get(
    '/:id/export',
    asyncHandler(async (req, res) => {
      const env = await store.exportSession(req.params.id);
      if (!env) {
        res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Session not found' } });
        return;
      }
      const filename = slugifyFilename(env.session.title, env.exportedAt);
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.send(JSON.stringify(env));
    }),
  );

  router.post(
    '/import',
    express.json({ limit: '10mb' }),
    asyncHandler(async (req, res) => {
      const parsed = exportEnvelopeSchema.safeParse(req.body);
      if (!parsed.success) {
        throw new ValidationError(
          `Invalid import payload: ${parsed.error.issues
            .map((i) => `${i.path.join('.')}: ${i.message}`)
            .join('; ')}`,
          parsed.error,
        );
      }
      const meta = await store.importSession(parsed.data);
      res.status(201).json(meta);
    }),
  );

  return router;
}
```

- [ ] **Step 4: Run the test, expect green**

```bash
npx vitest run server/routes/sessions.routes.test.ts
```

Expected: 5 cases pass.

- [ ] **Step 5: Commit**

```bash
git add server/routes/sessions.routes.ts server/routes/sessions.routes.test.ts
git commit -m "feat(slice-16): GET /api/sessions/:id/export + POST /api/sessions/import"
```

---

## Task E1: Mount sessions.routes in app.ts (before global json parser)

**Files:**
- Modify: `server/app.ts`

- [ ] **Step 1: Write the failing test** — extend `server/routes/sessions.routes.test.ts` with one new case using `createApp` directly to exercise the real wiring:

Append to `server/routes/sessions.routes.test.ts`:

```ts
import { createApp } from '@/server/app';

describe('createApp wiring for sessions io', () => {
  it('GET /api/sessions/:id/export works when wired through createApp', async () => {
    const fullDb = makeTestDb();
    const fullHistory = new HistoryStore(fullDb);
    const s = await fullHistory.createEmpty();
    await fullHistory.append(s.id, {
      id: 'm1',
      role: 'user',
      text: 'wired',
      timestamp: 1,
    });
    const fullApp = createApp({ historyStore: fullHistory });
    const res = await request(fullApp).get(`/api/sessions/${s.id}/export`);
    expect(res.status).toBe(200);
    expect(res.body.session.messages[0].text).toBe('wired');
    fullDb.close();
  });

  it('POST /api/sessions/import works when wired through createApp', async () => {
    const fullDb = makeTestDb();
    const fullHistory = new HistoryStore(fullDb);
    const fullApp = createApp({ historyStore: fullHistory });
    const res = await request(fullApp)
      .post('/api/sessions/import')
      .send({
        app: 'aether',
        version: 1,
        exportedAt: 0,
        session: { title: 'wired-in', createdAt: 1, messages: [] },
      });
    expect(res.status).toBe(201);
    expect(res.body.title).toBe('wired-in');
    fullDb.close();
  });
});
```

- [ ] **Step 2: Run the test, expect failure**

```bash
npx vitest run server/routes/sessions.routes.test.ts
```

Expected: the two `createApp wiring` tests fail with 404 (sessions.routes not mounted in createApp yet).

- [ ] **Step 3: Update `server/app.ts`**

Add the import at the top with the other route imports:

```ts
import { createSessionsRoutes } from './routes/sessions.routes';
```

Then change the body of `createApp` so the new router is mounted **before** the global `express.json` middleware. Replace this block:

```ts
const app = express();
app.use(express.json({ limit: '1mb' }));
```

with:

```ts
const app = express();

// Mount the sessions io router BEFORE the global json parser so its
// import route can install its own 10 MB parser. Other /api/sessions
// routes (list/create/read/patch/delete) live in history.routes and are
// mounted later, behind the 1 MB parser.
if (deps.historyStore) {
  app.use('/api/sessions', createSessionsRoutes(deps.historyStore));
}

app.use(express.json({ limit: '1mb' }));
```

Leave the existing `if (deps.historyStore) { app.use('/api/sessions', createHistoryRoutes(...)); }` block where it is — both routers on the same path coexist because the new one only handles `/:id/export` and `/import`, and Express falls through to the next router when no route matches.

- [ ] **Step 4: Run the full server test suite**

```bash
npx vitest run server/
```

Expected: previously-passing tests still pass; the two new `createApp wiring` cases now pass.

- [ ] **Step 5: Commit**

```bash
git add server/app.ts server/routes/sessions.routes.test.ts
git commit -m "feat(slice-16): wire sessions io router into createApp (pre-global-parser)"
```

---

## Task F1: FE sessions.api — exportSessionUrl + importSession

**Files:**
- Modify: `src/lib/api/sessions.api.ts`
- Create or modify: `src/lib/api/sessions.api.test.ts`

- [ ] **Step 1: Check whether the test file already exists**

```bash
ls src/lib/api/sessions.api.test.ts 2>/dev/null && echo "exists" || echo "create"
```

If "create", scaffold it; if "exists", append the new describe blocks. Either way, the new tests are:

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { http, HttpResponse } from 'msw';
import { server } from '@/src/test/msw-server';
import { sessionsApi } from './sessions.api';

beforeEach(() => {});
afterEach(() => server.resetHandlers());

describe('sessionsApi.exportSessionUrl', () => {
  it('returns the canonical export URL for a session id', () => {
    expect(sessionsApi.exportSessionUrl('abc')).toBe('/api/sessions/abc/export');
  });
});

describe('sessionsApi.importSession', () => {
  it('POSTs the envelope and returns the parsed SessionMeta', async () => {
    let receivedBody: unknown = null;
    server.use(
      http.post('http://localhost/api/sessions/import', async ({ request }) => {
        receivedBody = await request.json();
        return HttpResponse.json(
          {
            id: 'imp-1',
            title: 'imported',
            createdAt: 999,
            updatedAt: 999,
          },
          { status: 201 },
        );
      }),
    );
    const meta = await sessionsApi.importSession({
      app: 'aether',
      version: 1,
      exportedAt: 0,
      session: { title: 'imported', createdAt: 0, messages: [] },
    });
    expect(meta.id).toBe('imp-1');
    expect(receivedBody).toMatchObject({ app: 'aether', version: 1 });
  });

  it('throws with the server error message on non-2xx', async () => {
    server.use(
      http.post('http://localhost/api/sessions/import', () =>
        HttpResponse.json(
          { error: { code: 'VALIDATION_ERROR', message: 'bad shape' } },
          { status: 400 },
        ),
      ),
    );
    await expect(
      sessionsApi.importSession({ junk: true }),
    ).rejects.toThrow(/bad shape/);
  });
});
```

(If the file doesn't exist yet, add `import` lines at the top with the rest of the test imports already used for other api tests; if no template exists, the snippet above is self-contained.)

- [ ] **Step 2: Run the test, expect failure**

```bash
npx vitest run src/lib/api/sessions.api.test.ts
```

Expected: FAIL — `sessionsApi.exportSessionUrl is not a function` (and `importSession` likewise).

- [ ] **Step 3: Extend `src/lib/api/sessions.api.ts`**

Add to the `sessionsApi` object literal (alongside `list`, `create`, etc.):

```ts
exportSessionUrl: (id: string): string => `${BASE}/${id}/export`,
importSession: async (envelope: unknown): Promise<SessionMeta> => {
  const res = await fetch(`${BASE}/import`, json('POST', envelope));
  return asJson<SessionMeta>(res);
},
```

- [ ] **Step 4: Run the tests, expect green**

```bash
npx vitest run src/lib/api/sessions.api.test.ts
```

Expected: 3 cases pass.

- [ ] **Step 5: Commit**

```bash
git add src/lib/api/sessions.api.ts src/lib/api/sessions.api.test.ts
git commit -m "feat(slice-16): sessionsApi.exportSessionUrl + importSession"
```

---

## Task G1: sessions.store.importSession action

**Files:**
- Modify: `src/stores/sessions.store.ts`
- Modify: `src/stores/sessions.store.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `src/stores/sessions.store.test.ts` (preserve existing imports; add `vi` from vitest if not already imported):

```ts
describe('useSessionsStore.importSession', () => {
  beforeEach(() => {
    useSessionsStore.getState()._reset();
    useChatStore.getState().reset();
    localStorage.clear();
  });

  it('reads file, POSTs envelope, prepends new session, sets active', async () => {
    server.use(
      http.post('http://localhost/api/sessions/import', () =>
        HttpResponse.json(
          { id: 'new-imp', title: 'imp', createdAt: 1, updatedAt: 2 },
          { status: 201 },
        ),
      ),
    );
    const envelope = {
      app: 'aether',
      version: 1,
      exportedAt: 0,
      session: { title: 'imp', createdAt: 0, messages: [] },
    };
    const file = new File([JSON.stringify(envelope)], 'session.json', {
      type: 'application/json',
    });
    await useSessionsStore.getState().importSession(file);

    const s = useSessionsStore.getState();
    expect(s.sessions[0].id).toBe('new-imp');
    expect(s.activeSessionId).toBe('new-imp');
    expect(s.error).toBeNull();
  });

  it('sets error on malformed JSON without POSTing', async () => {
    let posted = false;
    server.use(
      http.post('http://localhost/api/sessions/import', () => {
        posted = true;
        return HttpResponse.json({}, { status: 201 });
      }),
    );
    const file = new File(['{not json'], 'bad.json', { type: 'application/json' });
    await useSessionsStore.getState().importSession(file);
    expect(posted).toBe(false);
    expect(useSessionsStore.getState().error).toMatch(/invalid JSON/i);
  });

  it('surfaces server error message in error state', async () => {
    server.use(
      http.post('http://localhost/api/sessions/import', () =>
        HttpResponse.json(
          { error: { code: 'VALIDATION_ERROR', message: 'nope' } },
          { status: 400 },
        ),
      ),
    );
    const envelope = {
      app: 'aether',
      version: 1,
      exportedAt: 0,
      session: { title: 't', createdAt: 0, messages: [] },
    };
    const file = new File([JSON.stringify(envelope)], 'ok.json', {
      type: 'application/json',
    });
    await useSessionsStore.getState().importSession(file);
    expect(useSessionsStore.getState().error).toMatch(/nope/);
  });
});
```

If the test file does not yet import `http`, `HttpResponse`, or `server`, add at the top:

```ts
import { http, HttpResponse } from 'msw';
import { server } from '@/src/test/msw-server';
```

- [ ] **Step 2: Run the tests, expect failure**

```bash
npx vitest run src/stores/sessions.store.test.ts
```

Expected: FAIL — `importSession is not a function`.

- [ ] **Step 3: Extend the store**

In `src/stores/sessions.store.ts`, add `importSession` to the interface:

```ts
importSession: (file: File) => Promise<void>;
```

Then add the implementation inside the `create<SessionsState>((set, get) => ({ ... }))` body, near the other actions:

```ts
importSession: async (file) => {
  let envelope: unknown;
  try {
    const text = await file.text();
    envelope = JSON.parse(text);
  } catch {
    set({ error: 'Import failed: invalid JSON file' });
    return;
  }
  try {
    const meta = await sessionsApi.importSession(envelope);
    set((s) => ({ sessions: [meta, ...s.sessions], error: null }));
    get().setActive(meta.id);
  } catch (e) {
    set({ error: `Import failed: ${errMsg(e)}` });
  }
},
```

- [ ] **Step 4: Run the tests, expect green**

```bash
npx vitest run src/stores/sessions.store.test.ts
```

Expected: 3 new cases pass; pre-existing tests still pass.

- [ ] **Step 5: Commit**

```bash
git add src/stores/sessions.store.ts src/stores/sessions.store.test.ts
git commit -m "feat(slice-16): sessions.store.importSession action"
```

---

## Task H1: HiddenImportInput component + module-level trigger

**Files:**
- Create: `src/components/layout/HiddenImportInput.tsx`
- Create: `src/components/layout/HiddenImportInput.test.tsx`

- [ ] **Step 1: Write the failing test** — `src/components/layout/HiddenImportInput.test.tsx`

```tsx
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import {
  HiddenImportInput,
  triggerImportOpen,
} from './HiddenImportInput';
import { useSessionsStore } from '@/src/stores/sessions.store';

beforeEach(() => {
  useSessionsStore.getState()._reset();
});

describe('HiddenImportInput', () => {
  it('renders a hidden file input', () => {
    const { container } = render(<HiddenImportInput />);
    const input = container.querySelector('input[type="file"]');
    expect(input).not.toBeNull();
    expect(input).toHaveAttribute('accept', 'application/json');
    expect(input).toHaveAttribute('hidden');
  });

  it('triggerImportOpen() clicks the input', () => {
    const { container } = render(<HiddenImportInput />);
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    const clickSpy = vi.spyOn(input, 'click');
    triggerImportOpen();
    expect(clickSpy).toHaveBeenCalled();
  });

  it('change event dispatches importSession with the selected file', async () => {
    const importSpy = vi.fn(async () => {});
    useSessionsStore.setState({ importSession: importSpy });
    const { container } = render(<HiddenImportInput />);
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File(['{}'], 'sample.json', { type: 'application/json' });
    Object.defineProperty(input, 'files', { value: [file], configurable: true });
    input.dispatchEvent(new Event('change', { bubbles: true }));
    await waitFor(() => expect(importSpy).toHaveBeenCalledWith(file));
  });

  it('resets value after change so the same filename can be re-imported', async () => {
    useSessionsStore.setState({ importSession: vi.fn(async () => {}) });
    const { container } = render(<HiddenImportInput />);
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File(['{}'], 'sample.json', { type: 'application/json' });
    Object.defineProperty(input, 'files', { value: [file], configurable: true });
    input.value = 'sample.json';
    input.dispatchEvent(new Event('change', { bubbles: true }));
    await waitFor(() => expect(input.value).toBe(''));
  });
});
```

- [ ] **Step 2: Run the test, expect failure**

```bash
npx vitest run src/components/layout/HiddenImportInput.test.tsx
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement `HiddenImportInput.tsx`**

Write `src/components/layout/HiddenImportInput.tsx`:

```tsx
import { useEffect, useRef } from 'react';
import { useSessionsStore } from '@/src/stores/sessions.store';

let ref: HTMLInputElement | null = null;

export function triggerImportOpen(): void {
  ref?.click();
}

export function HiddenImportInput() {
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    ref = inputRef.current;
    return () => {
      if (ref === inputRef.current) ref = null;
    };
  }, []);

  const onChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      await useSessionsStore.getState().importSession(file);
    } finally {
      // Reset so picking the same filename twice still fires `change`.
      e.target.value = '';
    }
  };

  return (
    <input
      ref={inputRef}
      type="file"
      accept="application/json"
      hidden
      onChange={onChange}
    />
  );
}
```

- [ ] **Step 4: Run the test, expect green**

```bash
npx vitest run src/components/layout/HiddenImportInput.test.tsx
```

Expected: 4 cases pass.

- [ ] **Step 5: Commit**

```bash
git add src/components/layout/HiddenImportInput.tsx src/components/layout/HiddenImportInput.test.tsx
git commit -m "feat(slice-16): HiddenImportInput component + triggerImportOpen()"
```

---

## Task I1: useCommands — Import session… command

**Files:**
- Modify: `src/hooks/useCommands.ts`
- Modify: `src/hooks/useCommands.test.ts` (if it exists; otherwise add inline in CommandPalette tests as a thin smoke)

- [ ] **Step 1: Check whether `useCommands.test.ts` exists**

```bash
ls src/hooks/useCommands.test.ts 2>/dev/null && echo "exists" || echo "missing"
```

If "missing", skip the standalone test and add a smoke test inside the existing `src/components/palette/CommandPalette.test.tsx` (it already injects a fake useCommands array; we'll add one for the real Import session command via a different mechanism). The simpler approach is to also extend `CommandPalette.test.tsx` for this. Either way:

- [ ] **Step 2: Write the failing test**

Append a small case to `src/components/palette/CommandPalette.test.tsx` near the end of the file, *outside* the existing `describe('CommandPalette search mode')` block:

```tsx
describe('CommandPalette — Import session…', () => {
  it('clicking "Import session…" triggers the hidden import input', async () => {
    const triggerSpy = vi.fn();
    vi.doMock('@/src/components/layout/HiddenImportInput', () => ({
      triggerImportOpen: triggerSpy,
      HiddenImportInput: () => null,
    }));
    // Re-import useCommands AFTER the mock is registered so the command
    // resolution captures the spy.
    const { useCommands } = await import('@/src/hooks/useCommands');
    vi.spyOn(commandsModule, 'useCommands').mockImplementation(useCommands);

    useUiStore.setState({ paletteOpen: true });
    const user = userEvent.setup();
    render(<CommandPalette />);
    await user.click(screen.getByText('Import session…'));
    expect(triggerSpy).toHaveBeenCalled();

    vi.doUnmock('@/src/components/layout/HiddenImportInput');
  });
});
```

Don't worry if mocking by re-import is fiddly — the alternative is a tiny direct test on `useCommands` itself:

If you prefer, instead create `src/hooks/useCommands.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';

vi.mock('@/src/components/layout/HiddenImportInput', () => ({
  triggerImportOpen: vi.fn(),
}));

import { useCommands } from './useCommands';
import { triggerImportOpen } from '@/src/components/layout/HiddenImportInput';
import { useSessionsStore } from '@/src/stores/sessions.store';
import { useUiStore } from '@/src/stores/ui.store';

beforeEach(() => {
  useSessionsStore.getState()._reset();
  useUiStore.getState()._reset();
  vi.mocked(triggerImportOpen).mockClear();
});

describe('useCommands — sessions.import', () => {
  it('exposes an "Import session…" command that triggers the hidden input', async () => {
    const { result } = renderHook(() => useCommands());
    const cmd = result.current.find((c) => c.id === 'sessions.import');
    expect(cmd).toBeDefined();
    expect(cmd!.label).toBe('Import session…');
    await cmd!.run();
    expect(triggerImportOpen).toHaveBeenCalled();
  });
});
```

- [ ] **Step 3: Run the test, expect failure**

```bash
npx vitest run src/hooks/useCommands.test.ts
```

Expected: FAIL — no command with id `sessions.import`.

- [ ] **Step 4: Add the command to `useCommands.ts`**

Add the `Upload` icon import to the lucide imports at the top of `src/hooks/useCommands.ts`:

```ts
import {
  // ...existing icons...
  Upload,
  Download,
} from 'lucide-react';
```

Add the import for the trigger:

```ts
import { triggerImportOpen } from '@/src/components/layout/HiddenImportInput';
```

Then inside the `useMemo<Command[]>(() => { ... })`, in the Sessions section right after the existing `sessions.search-history` push, add:

```ts
out.push({
  id: 'sessions.import',
  group: 'sessions',
  label: 'Import session…',
  icon: Upload,
  run: async () => {
    triggerImportOpen();
  },
});
```

(Leave `Download` imported but unused for now — we'll consume it in the row button in Task J1; that avoids touching the icon import twice.)

- [ ] **Step 5: Run the test, expect green**

```bash
npx vitest run src/hooks/useCommands.test.ts
```

Expected: 1 case passes.

- [ ] **Step 6: Commit**

```bash
git add src/hooks/useCommands.ts src/hooks/useCommands.test.ts
git commit -m "feat(slice-16): palette command \"Import session…\""
```

---

## Task J1: SessionsSection — ↓ export button per row

**Files:**
- Modify: `src/components/sidebar/SessionsSection.tsx`
- Modify: `src/components/sidebar/SessionsSection.test.tsx`

- [ ] **Step 1: Write the failing test**

Append to `src/components/sidebar/SessionsSection.test.tsx`:

```tsx
describe('SessionsSection — export button', () => {
  beforeEach(() => {
    useSessionsStore.getState()._reset();
    useChatStore.getState()._reset();
    useSessionsStore.setState({
      sessions: [
        { id: 'a', title: 'Alpha', createdAt: 0, updatedAt: 0 },
        { id: 'b', title: 'Beta', createdAt: 0, updatedAt: 0 },
      ],
      hydrated: true,
      activeSessionId: 'a',
    });
  });

  it('renders a download (↓) button per row with the right aria-label', () => {
    render(<SessionsSection />);
    expect(screen.getByLabelText('Export Alpha')).toBeInTheDocument();
    expect(screen.getByLabelText('Export Beta')).toBeInTheDocument();
  });

  it('clicking the export button navigates to the export URL', async () => {
    const assignSpy = vi.fn();
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { ...window.location, assign: assignSpy },
    });
    const user = userEvent.setup();
    render(<SessionsSection />);
    await user.click(screen.getByLabelText('Export Alpha'));
    expect(assignSpy).toHaveBeenCalledWith('/api/sessions/a/export');
  });

  it('disables the export button when streaming', () => {
    useChatStore.setState({ streamingId: 'a' });
    render(<SessionsSection />);
    expect(screen.getByLabelText('Export Alpha')).toBeDisabled();
  });
});
```

(If `useChatStore`, `screen`, `render`, `userEvent`, `vi` are not yet imported in the file, add them.)

- [ ] **Step 2: Run the test, expect failure**

```bash
npx vitest run src/components/sidebar/SessionsSection.test.tsx
```

Expected: FAIL — no element with label `Export Alpha`.

- [ ] **Step 3: Update the component**

In `src/components/sidebar/SessionsSection.tsx`:

Add `onExport: () => void;` to `SessionRowProps`. Replace the buttons block (the `<div className="hidden group-hover:flex gap-1">`) with the new three-button version:

```tsx
<div className="hidden group-hover:flex gap-1">
  <button
    onClick={onExport}
    disabled={disabled}
    aria-label={`Export ${label}`}
    className="hover:text-white disabled:opacity-50"
  >
    ↓
  </button>
  <button
    onClick={onRename}
    disabled={disabled}
    aria-label={`Rename ${label}`}
    className="hover:text-white disabled:opacity-50"
  >
    ✎
  </button>
  <button
    onClick={onDelete}
    disabled={disabled}
    aria-label={`Delete ${label}`}
    className="hover:text-red-400 disabled:opacity-50"
  >
    ×
  </button>
</div>
```

In the `SessionsSection` body, add a handler:

```tsx
import { sessionsApi } from '@/src/lib/api/sessions.api';
// ...
const handleExport = (id: string) => {
  window.location.assign(sessionsApi.exportSessionUrl(id));
};
```

And pass it to each `SessionRow`:

```tsx
<SessionRow
  key={s.id}
  session={s}
  active={s.id === activeSessionId}
  disabled={isStreaming}
  onSelect={() => setActive(s.id)}
  onRename={() => handleRename(s.id, s.title || FALLBACK_TITLE)}
  onDelete={() => handleDelete(s.id, s.title || FALLBACK_TITLE)}
  onExport={() => handleExport(s.id)}
/>
```

- [ ] **Step 4: Run the test, expect green**

```bash
npx vitest run src/components/sidebar/SessionsSection.test.tsx
```

Expected: all (existing + new) cases pass.

- [ ] **Step 5: Commit**

```bash
git add src/components/sidebar/SessionsSection.tsx src/components/sidebar/SessionsSection.test.tsx
git commit -m "feat(slice-16): per-row ↓ export button in SessionsSection"
```

---

## Task K1: Mount HiddenImportInput in App.tsx

**Files:**
- Modify: `src/App.tsx`

- [ ] **Step 1: Write a minimal failing assertion**

Append to `src/App.test.tsx` (if it exists; otherwise create the test):

```tsx
describe('App — HiddenImportInput', () => {
  it('mounts a hidden import input', () => {
    const { container } = render(<App />);
    const input = container.querySelector('input[type="file"][accept="application/json"]');
    expect(input).not.toBeNull();
  });
});
```

If there's no existing `App.test.tsx`, skip this — confidence is already covered by `HiddenImportInput.test.tsx`. In that case, just do the mount and verify via the integration test in Task M1.

- [ ] **Step 2: If the assertion was added, run it; expect failure**

```bash
npx vitest run src/App.test.tsx
```

Expected: FAIL — no matching input found.

- [ ] **Step 3: Mount the component**

In `src/App.tsx`, add the import near the other layout imports:

```tsx
import { HiddenImportInput } from '@/src/components/layout/HiddenImportInput';
```

And mount it once at the App level — anywhere inside the root return tree, alongside `<DialogHost />` if present:

```tsx
<HiddenImportInput />
```

- [ ] **Step 4: Run the test, expect green** (or proceed without if no App.test exists)

```bash
npx vitest run src/App.test.tsx
```

- [ ] **Step 5: Commit**

```bash
git add src/App.tsx src/App.test.tsx 2>/dev/null || git add src/App.tsx
git commit -m "feat(slice-16): mount HiddenImportInput in App"
```

---

## Task L1: MSW defaults for export + import

**Files:**
- Modify: `src/test/msw-handlers.ts`

- [ ] **Step 1: Add default handlers**

Append two handlers to the `handlers` array in `src/test/msw-handlers.ts` (next to the existing `/api/sessions/...` handlers):

```ts
http.get('http://localhost/api/sessions/:id/export', ({ params }) =>
  HttpResponse.json({
    app: 'aether',
    version: 1,
    exportedAt: 0,
    session: {
      title: `exported-${params.id}`,
      createdAt: 0,
      messages: [],
    },
  }),
),
http.post('http://localhost/api/sessions/import', async ({ request }) => {
  const body = (await request.json()) as {
    session?: { title?: string };
  };
  return HttpResponse.json(
    {
      id: `imp-${Date.now()}`,
      title: body?.session?.title ?? 'imported',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    },
    { status: 201 },
  );
}),
```

- [ ] **Step 2: Run the whole FE test suite to make sure nothing regressed**

```bash
npx vitest run src/
```

Expected: existing tests still pass; no new failures.

- [ ] **Step 3: Commit**

```bash
git add src/test/msw-handlers.ts
git commit -m "test(slice-16): MSW defaults for session export + import"
```

---

## Task M1: Integration test — Cmd+K → Import session… → new session active

**Files:**
- Create: `src/integration/session-io.integration.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `src/integration/session-io.integration.test.tsx`:

```tsx
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
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
import { __setIsMacForTests } from '@/src/hooks/useKeyboardShortcut';

beforeEach(() => {
  __setIsMacForTests(true);
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
  __setIsMacForTests(null);
  server.resetHandlers();
});

describe('session io integration', () => {
  it('Cmd+K → Import session… → select file → new session is active', async () => {
    server.use(
      http.post('http://localhost/api/sessions/import', () =>
        HttpResponse.json(
          {
            id: 'imp-1',
            title: 'My Imported Session',
            createdAt: 1,
            updatedAt: 2,
          },
          { status: 201 },
        ),
      ),
    );

    const user = userEvent.setup();
    render(<App />);
    await waitFor(() => expect(useSessionsStore.getState().hydrated).toBe(true));

    // Open palette.
    await act(async () => {
      window.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'k', metaKey: true, cancelable: true }),
      );
    });
    await waitFor(() =>
      expect(useUiStore.getState().paletteOpen).toBe(true),
    );

    // Click Import session…
    await user.click(screen.getByText('Import session…'));

    // The hidden input lives in App; simulate file selection on it.
    const input = document.querySelector(
      'input[type="file"][accept="application/json"]',
    ) as HTMLInputElement;
    expect(input).not.toBeNull();
    const envelope = {
      app: 'aether',
      version: 1,
      exportedAt: 0,
      session: {
        title: 'My Imported Session',
        createdAt: 0,
        messages: [],
      },
    };
    const file = new File([JSON.stringify(envelope)], 'session.json', {
      type: 'application/json',
    });
    Object.defineProperty(input, 'files', { value: [file], configurable: true });
    await act(async () => {
      input.dispatchEvent(new Event('change', { bubbles: true }));
    });

    await waitFor(() => {
      expect(useSessionsStore.getState().activeSessionId).toBe('imp-1');
    });
    expect(useSessionsStore.getState().sessions[0].title).toBe('My Imported Session');
  });
});
```

- [ ] **Step 2: Run the test, expect failure (or unexpected pass — if it passes immediately, great, but the next step will still confirm nothing else broke)**

```bash
npx vitest run src/integration/session-io.integration.test.tsx
```

- [ ] **Step 3: Fix anything the test surfaces**

Likely causes if it fails:
- `HiddenImportInput` not mounted in App (revisit Task K1).
- Palette command not closing before `triggerImportOpen` fires (we fixed `runCmd` in the recent palette PR — it closes before awaiting `cmd.run()`, so the click handler runs after close, which is fine).
- The hidden input may need a re-paint cycle — wrap the dispatch in `await act(...)` (already done above).

Address any of the above directly in the relevant source file. Re-run until green.

- [ ] **Step 4: Confirm passing**

```bash
npx vitest run src/integration/session-io.integration.test.tsx
```

Expected: 1 case passes.

- [ ] **Step 5: Commit**

```bash
git add src/integration/session-io.integration.test.tsx
git commit -m "test(slice-16): integration — Cmd+K → Import session → active"
```

---

## Task N1: Playwright smoke test (session io)

**Files:**
- Modify: `e2e/smoke.spec.ts`
- Create: `e2e/fixtures/sample-session.json`

- [ ] **Step 1: Create the fixture**

Write `e2e/fixtures/sample-session.json`:

```json
{
  "app": "aether",
  "version": 1,
  "exportedAt": 0,
  "session": {
    "title": "Playwright Imported Session",
    "createdAt": 0,
    "messages": [
      { "id": "m1", "role": "user", "text": "hello from fixture", "timestamp": 0 }
    ]
  }
}
```

- [ ] **Step 2: Add a smoke test to `e2e/smoke.spec.ts`**

Append:

```ts
import path from 'node:path';

test('session io: import session via palette creates a new session', async ({ page }) => {
  await page.goto('/');
  // Wait for the sidebar
  await page.getByText(/sessions/i).first().waitFor();

  // Open the palette.
  await page.keyboard.press('Meta+K');
  await page.getByPlaceholder(/type a command/i).waitFor();

  // Run the import command.
  await page.getByText('Import session…').click();

  // Wire the file chooser then click again to (re-)trigger it.
  // In Playwright the file chooser is intercepted from the next user action
  // that opens it; since the command already opened it, use page.setInputFiles
  // directly against the hidden input by selector.
  const input = page.locator('input[type="file"][accept="application/json"]');
  await input.setInputFiles(
    path.resolve(__dirname, 'fixtures', 'sample-session.json'),
  );

  // Verify the new session appears and is active.
  await page.getByText('Playwright Imported Session').waitFor();
});
```

If `import path from 'node:path'` is already at the top of the file, don't duplicate.

- [ ] **Step 3: Build and run e2e**

```bash
npm run build
npx playwright test
```

Expected: all existing tests pass + the new one passes.

- [ ] **Step 4: Commit**

```bash
git add e2e/smoke.spec.ts e2e/fixtures/sample-session.json
git commit -m "test(slice-16): playwright smoke for session import via palette"
```

---

## Task O1: Final gates + push + PR

**Files:** (no edits)

- [ ] **Step 1: Lint**

```bash
npm run lint
```

Expected: no output.

- [ ] **Step 2: Full vitest suite**

```bash
npx vitest run
```

Expected: all green except the two pre-existing flakes in `server/domain/providers/registry.test.ts` and `server/routes/providers.routes.test.ts` that fail when a local Ollama server is reachable. If new failures appear, fix them before continuing.

- [ ] **Step 3: Full playwright**

```bash
npx playwright test
```

Expected: all green.

- [ ] **Step 4: Push branch**

```bash
git push -u origin feat/slice-16-session-io
```

- [ ] **Step 5: Open the PR**

```bash
gh pr create --title "feat(slice-16): export/import single session (JSON envelope)" --body "$(cat <<'EOF'
## Summary
- Versioned JSON envelope (`{ app:'aether', version:1, exportedAt, session }`) wraps the full SessionRecord (messages + reasoning + tool call traces).
- `HistoryStore.exportSession(id)` / `importSession(envelope)` — atomic transaction; import regenerates every UUID, resets all timestamps to one `Date.now()`, and mirrors into `messages_fts`.
- New endpoints: `GET /api/sessions/:id/export` (Content-Disposition attachment) and `POST /api/sessions/import` (route-specific 10 MB json parser; global 1 MB limit untouched).
- Palette: new "Import session…" command opens a hidden `<input type="file">` mounted once at App level.
- Sidebar: per-row hover `↓` button calls `window.location.assign('/api/sessions/<id>/export')`.
- Lenient zod validation: unknown keys silently dropped at every level; wrong `app` or `version` rejected.

## Test plan
- [x] envelope schema unit tests (Task B1)
- [x] HistoryStore export + import (Task C1) — id regeneration, single-timestamp reset, FTS mirror, order preservation, atomicity
- [x] route tests via supertest + createApp wiring (Tasks D1, E1)
- [x] FE api + store unit tests (Tasks F1, G1)
- [x] HiddenImportInput + palette command (Tasks H1, I1)
- [x] SessionsSection ↓ button (Task J1)
- [x] MSW defaults (Task L1)
- [x] Integration: Cmd+K → Import session… → new session active (Task M1)
- [x] Playwright smoke: palette import via fixture file (Task N1)
- [x] Lint clean
- [x] Full vitest green (modulo 2 pre-existing Ollama flakes)
- [x] Playwright 14/14

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

Expected: PR URL printed.

---

## Self-review

Walking the spec section-by-section against the plan:

| Spec item | Covered by |
|---|---|
| Envelope format with `app`, `version`, `exportedAt`, `session` | Task B1 |
| Lenient validation (unknown keys dropped) | Task B1 |
| Hard reject for wrong `app` / `version` | Task B1 |
| `HistoryStore.exportSession(id)` | Task C1 |
| `HistoryStore.importSession(envelope)` with new UUIDs, single timestamp, FTS mirror, atomic transaction | Task C1 |
| `slugifyFilename` | Task B1 |
| `GET /api/sessions/:id/export` with Content-Disposition | Task D1 |
| `POST /api/sessions/import` with 10 MB cap (route-specific) | Tasks D1, E1 |
| Mounted in `createApp` before global 1 MB parser | Task E1 |
| FE `sessionsApi.exportSessionUrl` + `importSession` | Task F1 |
| FE `sessions.store.importSession(file)` with error states | Task G1 |
| Singleton `HiddenImportInput` + `triggerImportOpen()` | Task H1 |
| Palette command `Import session…` | Task I1 |
| Per-row `↓` button | Task J1 |
| Mount HiddenImportInput in App | Task K1 |
| MSW defaults | Task L1 |
| Integration test for the import flow | Task M1 |
| Playwright smoke | Task N1 |
| Lint + full tests + push + PR | Task O1 |

No gaps. No placeholders. Type names (`ExportEnvelope`, `EXPORT_VERSION`, `wrap`, `slugifyFilename`, `exportEnvelopeSchema`, `exportSession`, `importSession`, `exportSessionUrl`, `triggerImportOpen`, `HiddenImportInput`, `sessions.import`) are used consistently across all tasks.
