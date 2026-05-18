# Aether Slice 2b — Multi-Session Chat Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Trasformare la chat single-session di Slice 2a in un sistema multi-sessione con `SessionsSection` in sidebar, `HistoryStore` parametrizzata per `sessionId`, CRUD routes `/api/sessions[/:id]`, e migrazione one-shot della chiave legacy `'default'`.

**Architecture:** Backend `HistoryStore` riscritta con API parametrizzata (`listSessions`, `read(id)`, `createEmpty`, `rename`, `append`, `delete`), migrate-on-load idempotente per il legacy `'default'`. Routes CRUD complete + dispatch modificato per richiedere `sessionId` nel body. Frontend nuovo `useSessionsStore` (Zustand + localStorage per `activeSessionId`), `useChatStore` invariato come single-session resettato + idratato al cambio. `SessionsSection` nuova in sidebar, con confirm-dialog per delete e prompt-dialog per rename. Hydration token contro fetch obsoleti su switch rapidi.

**Tech Stack:** Zustand 5 (con `useShallow`), zod 4, MSW 2, React 19, `useDialog` da slice 0, react-markdown da slice 2a. Backend: Express + `JsonStore` + `node:crypto` randomUUID. Test: Vitest 4.1.6 + RTL + supertest + Playwright (con `AETHER_DATA_DIR` scratch).

**Reference spec:** `docs/superpowers/specs/2026-05-18-aether-slice-2b-multi-session-design.md`

**Branch:** `feat/slice-2b-multi-session`

**Lavora con un solo branch dall'inizio alla fine; ogni Task termina con un commit verde su questo branch.**

---

## File structure (NEW unless marked MODIFY)

```
server/
  domain/history/
    title.ts                                  # NEW (computeTitle utility)
    title.test.ts                             # NEW
    history.types.ts                          # MODIFY (V2 types)
    history.schema.ts                         # MODIFY (V2 schemas)
    history.schema.test.ts                    # MODIFY
    history.migrate.ts                        # NEW
    history.migrate.test.ts                   # NEW
    history.store.ts                          # REWRITE
    history.store.test.ts                     # REWRITE
  domain/dispatch/
    dispatch.service.ts                       # MODIFY (sessionId)
    dispatch.service.test.ts                  # MODIFY
  routes/
    history.routes.ts                         # REWRITE
    history.routes.test.ts                    # REWRITE
    dispatch.routes.ts                        # MODIFY (only if needed — service does validation)
    dispatch.routes.test.ts                   # MODIFY

src/
  lib/
    title.ts                                  # NEW (identical to server title.ts)
    title.test.ts                             # NEW (same canonical inputs as server)
  types/
    session.types.ts                          # NEW
  lib/api/
    sessions.api.ts                           # NEW
    sessions.api.test.ts                      # NEW
    history.api.ts                            # REWRITE
    history.api.test.ts                       # REWRITE
    dispatch.api.ts                           # MODIFY
    dispatch.api.test.ts                      # MODIFY
  stores/
    sessions.store.ts                         # NEW
    sessions.store.test.ts                    # NEW
  hooks/
    useStreamingDispatch.ts                   # MODIFY
    useStreamingDispatch.test.ts              # MODIFY
  components/
    sidebar/
      SessionsSection.tsx                     # NEW
      SessionsSection.test.tsx                # NEW
    chat/
      ChatView.tsx                            # MODIFY (guard for null activeSessionId)
      ChatView.test.tsx                       # MODIFY
  App.tsx                                     # MODIFY (sessionsStore.init)
  App.test.tsx                                # MODIFY
  test/
    msw-handlers.ts                           # MODIFY (sessions handlers)

e2e/
  smoke.spec.ts                               # MODIFY
playwright.config.ts                          # MODIFY (AETHER_DATA_DIR scratch)
```

---

## Phase A — Branch + utilities

### Task A1: Crea il branch

- [ ] **Step 1: Crea e checkout**

```bash
git checkout main
git pull --ff-only
git checkout -b feat/slice-2b-multi-session
```

Expected: `Switched to a new branch 'feat/slice-2b-multi-session'`.

- [ ] **Step 2: Verify clean state**

```bash
git status
```

Expected: `nothing to commit, working tree clean`.

---

### Task A2: `computeTitle` utility (backend + frontend)

**Files:**
- Create: `server/domain/history/title.ts`
- Create: `server/domain/history/title.test.ts`
- Create: `src/lib/title.ts`
- Create: `src/lib/title.test.ts`

Two identical implementations on purpose: the backend uses it during `append` auto-title, the frontend pre-computes it locally for instant UI. The tests assert identical output on canonical inputs.

- [ ] **Step 1: Write the backend test**

`server/domain/history/title.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { computeTitle } from './title';

describe('computeTitle (server)', () => {
  it('returns "Nuova sessione" for empty input', () => {
    expect(computeTitle('')).toBe('Nuova sessione');
    expect(computeTitle('   ')).toBe('Nuova sessione');
  });

  it('returns text as-is when short', () => {
    expect(computeTitle('hello')).toBe('hello');
    expect(computeTitle('hi there')).toBe('hi there');
  });

  it('truncates to 40 chars with ellipsis', () => {
    const long = 'a'.repeat(60);
    const out = computeTitle(long);
    expect(out.length).toBeLessThanOrEqual(41); // 40 + ellipsis
    expect(out.endsWith('…')).toBe(true);
  });

  it('collapses whitespace', () => {
    expect(computeTitle('foo   bar\n\nbaz')).toBe('foo bar baz');
  });

  it('trims trailing whitespace before ellipsis', () => {
    const input = 'a'.repeat(38) + '  bcdef';
    const out = computeTitle(input);
    expect(out).not.toMatch(/\s…$/);
  });
});
```

- [ ] **Step 2: Run backend test — expect FAIL**

```bash
npx vitest run server/domain/history/title.test.ts
```

Expected: FAIL (module not found).

- [ ] **Step 3: Write backend implementation**

`server/domain/history/title.ts`:
```ts
const MAX_LEN = 40;

export function computeTitle(text: string): string {
  const collapsed = text.trim().replace(/\s+/g, ' ');
  if (!collapsed) return 'Nuova sessione';
  if (collapsed.length <= MAX_LEN) return collapsed;
  return collapsed.slice(0, MAX_LEN).trimEnd() + '…';
}
```

- [ ] **Step 4: Run backend test — expect PASS**

```bash
npx vitest run server/domain/history/title.test.ts
```

Expected: PASS (5 tests).

- [ ] **Step 5: Write the frontend test (identical)**

`src/lib/title.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { computeTitle } from './title';

describe('computeTitle (client)', () => {
  it('returns "Nuova sessione" for empty input', () => {
    expect(computeTitle('')).toBe('Nuova sessione');
    expect(computeTitle('   ')).toBe('Nuova sessione');
  });

  it('returns text as-is when short', () => {
    expect(computeTitle('hello')).toBe('hello');
    expect(computeTitle('hi there')).toBe('hi there');
  });

  it('truncates to 40 chars with ellipsis', () => {
    const long = 'a'.repeat(60);
    const out = computeTitle(long);
    expect(out.length).toBeLessThanOrEqual(41);
    expect(out.endsWith('…')).toBe(true);
  });

  it('collapses whitespace', () => {
    expect(computeTitle('foo   bar\n\nbaz')).toBe('foo bar baz');
  });

  it('trims trailing whitespace before ellipsis', () => {
    const input = 'a'.repeat(38) + '  bcdef';
    const out = computeTitle(input);
    expect(out).not.toMatch(/\s…$/);
  });
});
```

- [ ] **Step 6: Write frontend implementation**

`src/lib/title.ts`:
```ts
const MAX_LEN = 40;

export function computeTitle(text: string): string {
  const collapsed = text.trim().replace(/\s+/g, ' ');
  if (!collapsed) return 'Nuova sessione';
  if (collapsed.length <= MAX_LEN) return collapsed;
  return collapsed.slice(0, MAX_LEN).trimEnd() + '…';
}
```

- [ ] **Step 7: Run frontend test — expect PASS**

```bash
npx vitest run src/lib/title.test.ts
```

Expected: PASS (5 tests).

- [ ] **Step 8: Commit**

```bash
git add server/domain/history/title.ts server/domain/history/title.test.ts src/lib/title.ts src/lib/title.test.ts
git commit -m "feat(slice-2b): add computeTitle utility (server + client, identical impl)"
```

---

## Phase B — Backend types + schema + migration

### Task B1: V2 types

**Files:**
- Modify: `server/domain/history/history.types.ts`

`Message` rimane invariato. Aggiungiamo `SessionRecord`, `SessionMeta`, e rifacciamo `SessionsFile` come V2.

- [ ] **Step 1: Replace types**

`server/domain/history/history.types.ts`:
```ts
export interface Message {
  id: string;
  role: 'user' | 'model';
  text: string;
  timestamp: number;
  model?: string;
  interrupted?: boolean;
  error?: string;
  retryable?: boolean;
}

export interface SessionRecord {
  title: string;
  createdAt: number;
  messages: Message[];
}

export interface SessionMeta {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
}

export type SessionsFile = Record<string, SessionRecord>;
```

- [ ] **Step 2: Verify lint passes**

```bash
npm run lint
```

Expected: PASS (errors are fine in dependent files — they'll be updated in next tasks).

Actually `lint` may fail now because `history.store.ts` and `history.routes.ts` use the old shape. Let's verify the errors are confined to those files and proceed.

If `npm run lint` fails with errors only in `history.store.ts`, `history.routes.ts`, `dispatch.service.ts`, that's expected. Note the failures and continue — they'll be fixed in subsequent tasks.

If lint fails in unexpected files, STOP and report BLOCKED.

- [ ] **Step 3: Commit (red state for dependent files is acceptable mid-refactor)**

Skip the commit at this step — we'll commit after Task B2 when the schema also lines up. Continue to Task B2.

---

### Task B2: V2 schema

**Files:**
- Modify: `server/domain/history/history.schema.ts`
- Modify: `server/domain/history/history.schema.test.ts`

- [ ] **Step 1: Replace the test**

`server/domain/history/history.schema.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { MessageSchema, SessionRecordSchema, SessionsFileSchema } from './history.schema';

describe('MessageSchema', () => {
  it('parses minimal user message', () => {
    const msg = { id: 'a', role: 'user' as const, text: 'hi', timestamp: 1 };
    expect(MessageSchema.parse(msg)).toEqual(msg);
  });

  it('parses model message with optional fields', () => {
    const msg = {
      id: 'b',
      role: 'model' as const,
      text: 'hello',
      timestamp: 2,
      model: 'gemini-test',
      interrupted: false,
    };
    expect(MessageSchema.parse(msg).model).toBe('gemini-test');
  });

  it('rejects invalid role', () => {
    expect(() =>
      MessageSchema.parse({ id: 'x', role: 'admin', text: 't', timestamp: 1 }),
    ).toThrow();
  });
});

describe('SessionRecordSchema', () => {
  it('parses valid record', () => {
    const rec = { title: 'My chat', createdAt: 1, messages: [] };
    expect(SessionRecordSchema.parse(rec)).toEqual(rec);
  });

  it('accepts empty title', () => {
    expect(SessionRecordSchema.parse({ title: '', createdAt: 1, messages: [] })).toEqual({
      title: '',
      createdAt: 1,
      messages: [],
    });
  });

  it('rejects record without createdAt', () => {
    expect(() =>
      SessionRecordSchema.parse({ title: 't', messages: [] } as unknown),
    ).toThrow();
  });
});

describe('SessionsFileSchema', () => {
  it('parses populated file', () => {
    const file = {
      '11111111-1111-1111-1111-111111111111': {
        title: 'first',
        createdAt: 1,
        messages: [{ id: 'a', role: 'user' as const, text: 'hi', timestamp: 1 }],
      },
    };
    expect(SessionsFileSchema.parse(file)).toEqual(file);
  });

  it('accepts empty', () => {
    expect(SessionsFileSchema.parse({})).toEqual({});
  });

  it('rejects record values that are arrays (legacy V1 shape)', () => {
    expect(() =>
      SessionsFileSchema.parse({ default: [{ id: 'a', role: 'user', text: 'hi', timestamp: 1 }] }),
    ).toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run server/domain/history/history.schema.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Replace the schema**

`server/domain/history/history.schema.ts`:
```ts
import { z } from 'zod';

export const MessageSchema = z.object({
  id: z.string(),
  role: z.enum(['user', 'model']),
  text: z.string(),
  timestamp: z.number(),
  model: z.string().optional(),
  interrupted: z.boolean().optional(),
  error: z.string().optional(),
  retryable: z.boolean().optional(),
});

export const SessionRecordSchema = z.object({
  title: z.string(),
  createdAt: z.number(),
  messages: z.array(MessageSchema),
});

export const SessionsFileSchema = z.record(z.string(), SessionRecordSchema);
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run server/domain/history/history.schema.test.ts
```

Expected: PASS (9 tests).

- [ ] **Step 5: Commit**

The dependent files (`history.store`, `history.routes`, `dispatch.service`) will be red but we commit the schema+types together to keep the repository moving forward atomically.

```bash
git add server/domain/history/history.types.ts server/domain/history/history.schema.ts server/domain/history/history.schema.test.ts
git commit -m "feat(slice-2b): V2 history types + schema (SessionRecord, SessionsFile)"
```

After this commit `npm run lint` will fail in `history.store.ts` etc. — that's expected. Subsequent tasks fix them.

---

### Task B3: `migrateLegacyDefault`

**Files:**
- Create: `server/domain/history/history.migrate.ts`
- Create: `server/domain/history/history.migrate.test.ts`

- [ ] **Step 1: Write the failing test**

`server/domain/history/history.migrate.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { migrateLegacyDefault } from './history.migrate';
import type { Message } from './history.types';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

describe('migrateLegacyDefault', () => {
  it('returns same shape when no legacy default key present', () => {
    const file = {};
    expect(migrateLegacyDefault(file)).toEqual({});
  });

  it('preserves already-V2 sessions untouched', () => {
    const file = {
      'abc12345-abcd-abcd-abcd-abcdef123456': { title: 'kept', createdAt: 1, messages: [] },
    };
    const out = migrateLegacyDefault(file);
    expect(out).toEqual(file);
  });

  it('converts legacy default with messages to V2 record', () => {
    const userMsg: Message = { id: 'u1', role: 'user', text: 'first prompt here', timestamp: 100 };
    const modelMsg: Message = { id: 'm1', role: 'model', text: 'response', timestamp: 200 };
    const file = { default: [userMsg, modelMsg] };
    const out = migrateLegacyDefault(file);
    expect(Object.keys(out)).toHaveLength(1);
    const [id] = Object.keys(out);
    expect(id).toMatch(UUID_RE);
    expect(out[id].title).toBe('first prompt here');
    expect(out[id].createdAt).toBe(100);
    expect(out[id].messages).toEqual([userMsg, modelMsg]);
  });

  it('converts empty legacy default to placeholder session', () => {
    const file = { default: [] as Message[] };
    const out = migrateLegacyDefault(file);
    expect(Object.keys(out)).toHaveLength(1);
    const [id] = Object.keys(out);
    expect(id).toMatch(UUID_RE);
    expect(out[id].title).toBe('Sessione importata');
    expect(typeof out[id].createdAt).toBe('number');
    expect(out[id].messages).toEqual([]);
  });

  it('uses model-only first message to fall back to placeholder title', () => {
    const modelMsg: Message = { id: 'm1', role: 'model', text: 'orphan', timestamp: 1 };
    const file = { default: [modelMsg] };
    const out = migrateLegacyDefault(file);
    const [id] = Object.keys(out);
    expect(out[id].title).toBe('Sessione importata');
  });

  it('is idempotent: re-running on migrated output yields same result (modulo ID stability)', () => {
    const file = { default: [{ id: 'u1', role: 'user' as const, text: 'a', timestamp: 1 }] };
    const first = migrateLegacyDefault(file);
    const second = migrateLegacyDefault(first);
    expect(second).toEqual(first);
  });

  it('preserves other V2 keys when migrating default', () => {
    const file = {
      'xyz12345-abcd-abcd-abcd-abcdef123456': { title: 'kept', createdAt: 1, messages: [] },
      default: [{ id: 'u1', role: 'user' as const, text: 'a', timestamp: 1 }],
    };
    const out = migrateLegacyDefault(file);
    expect(Object.keys(out)).toHaveLength(2);
    expect(out['xyz12345-abcd-abcd-abcd-abcdef123456']).toEqual({
      title: 'kept', createdAt: 1, messages: [],
    });
    expect(out.default).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run server/domain/history/history.migrate.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Write the implementation**

`server/domain/history/history.migrate.ts`:
```ts
import { randomUUID } from 'node:crypto';
import { computeTitle } from './title';
import type { Message, SessionRecord, SessionsFile } from './history.types';

const DEFAULT_KEY = 'default';

function isMessageArray(v: unknown): v is Message[] {
  return Array.isArray(v) && v.every((m) =>
    m != null && typeof m === 'object' && 'role' in m && 'text' in m,
  );
}

function isSessionRecord(v: unknown): v is SessionRecord {
  return v != null && typeof v === 'object'
    && 'title' in v && 'createdAt' in v && 'messages' in v;
}

export function migrateLegacyDefault(file: Record<string, unknown>): SessionsFile {
  const legacy = file[DEFAULT_KEY];
  if (legacy === undefined) {
    // Nessuna migrazione necessaria. Filtra solo le voci valide V2.
    const out: SessionsFile = {};
    for (const [k, v] of Object.entries(file)) {
      if (isSessionRecord(v)) out[k] = v;
    }
    return out;
  }

  const out: SessionsFile = {};
  for (const [k, v] of Object.entries(file)) {
    if (k === DEFAULT_KEY) continue;
    if (isSessionRecord(v)) out[k] = v;
  }

  if (!isMessageArray(legacy)) {
    // Caso inatteso: 'default' presente ma non Message[] e non SessionRecord.
    // Salta silenziosamente per non perdere altre sessioni.
    return out;
  }

  const messages = legacy;
  const firstUser = messages.find((m) => m.role === 'user');
  const title = firstUser ? computeTitle(firstUser.text) : 'Sessione importata';
  const createdAt = messages[0]?.timestamp ?? Date.now();

  const newId = randomUUID();
  out[newId] = { title, createdAt, messages };
  return out;
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run server/domain/history/history.migrate.test.ts
```

Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add server/domain/history/history.migrate.ts server/domain/history/history.migrate.test.ts
git commit -m "feat(slice-2b): add migrateLegacyDefault (idempotent, preserves V2 keys)"
```

---

## Phase C — HistoryStore rewrite

### Task C1: `HistoryStore` new API + migrate-on-load

**Files:**
- Modify: `server/domain/history/history.store.ts`
- Modify: `server/domain/history/history.store.test.ts`

- [ ] **Step 1: Replace the test**

`server/domain/history/history.store.test.ts`:
```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { HistoryStore } from './history.store';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

let dir: string;
let store: HistoryStore;
let filePath: string;

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'aether-history-'));
  filePath = path.join(dir, 'sessions.json');
  store = new HistoryStore(filePath);
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('HistoryStore', () => {
  it('listSessions returns [] on empty file', async () => {
    expect(await store.listSessions()).toEqual([]);
  });

  it('createEmpty produces a meta with UUID + 0 messages', async () => {
    const meta = await store.createEmpty();
    expect(meta.id).toMatch(UUID_RE);
    expect(meta.title).toBe('');
    expect(typeof meta.createdAt).toBe('number');
    expect(meta.updatedAt).toBe(meta.createdAt);
    const list = await store.listSessions();
    expect(list.map((s) => s.id)).toContain(meta.id);
  });

  it('read returns null for unknown session', async () => {
    expect(await store.read('nope')).toBeNull();
  });

  it('read returns the messages of a populated session', async () => {
    const meta = await store.createEmpty();
    await store.append(meta.id, { id: 'a', role: 'user', text: 'hi', timestamp: 1 });
    const msgs = await store.read(meta.id);
    expect(msgs).toEqual([{ id: 'a', role: 'user', text: 'hi', timestamp: 1 }]);
  });

  it('append auto-titles when session is empty and message is user', async () => {
    const meta = await store.createEmpty();
    await store.append(meta.id, { id: 'a', role: 'user', text: 'ciao mondo', timestamp: 1 });
    const list = await store.listSessions();
    const s = list.find((x) => x.id === meta.id)!;
    expect(s.title).toBe('ciao mondo');
  });

  it('append does NOT re-title after first message', async () => {
    const meta = await store.createEmpty();
    await store.append(meta.id, { id: 'a', role: 'user', text: 'first', timestamp: 1 });
    await store.append(meta.id, { id: 'b', role: 'model', text: 'reply', timestamp: 2 });
    await store.append(meta.id, { id: 'c', role: 'user', text: 'second', timestamp: 3 });
    const list = await store.listSessions();
    expect(list.find((x) => x.id === meta.id)!.title).toBe('first');
  });

  it('append does NOT auto-title when first message is model role', async () => {
    const meta = await store.createEmpty();
    await store.append(meta.id, { id: 'm', role: 'model', text: 'orphan', timestamp: 1 });
    const list = await store.listSessions();
    expect(list.find((x) => x.id === meta.id)!.title).toBe('');
  });

  it('append throws NotFoundError for unknown sessionId', async () => {
    await expect(
      store.append('nope', { id: 'a', role: 'user', text: 'hi', timestamp: 1 }),
    ).rejects.toThrow();
  });

  it('rename updates title; throws NotFound for missing id', async () => {
    const meta = await store.createEmpty();
    const updated = await store.rename(meta.id, 'My chat');
    expect(updated.title).toBe('My chat');
    await expect(store.rename('nope', 'x')).rejects.toThrow();
  });

  it('rename rejects empty title', async () => {
    const meta = await store.createEmpty();
    await expect(store.rename(meta.id, '')).rejects.toThrow();
    await expect(store.rename(meta.id, '   ')).rejects.toThrow();
  });

  it('rename rejects title over 200 chars', async () => {
    const meta = await store.createEmpty();
    await expect(store.rename(meta.id, 'a'.repeat(201))).rejects.toThrow();
  });

  it('delete removes the session; throws NotFound for missing id', async () => {
    const meta = await store.createEmpty();
    await store.delete(meta.id);
    expect(await store.read(meta.id)).toBeNull();
    await expect(store.delete(meta.id)).rejects.toThrow();
  });

  it('listSessions orders by updatedAt desc', async () => {
    const a = await store.createEmpty();
    await new Promise((r) => setTimeout(r, 5));
    const b = await store.createEmpty();
    await new Promise((r) => setTimeout(r, 5));
    // touch a by appending message
    await store.append(a.id, { id: 'x', role: 'user', text: 'touch a', timestamp: Date.now() + 1000 });
    const list = await store.listSessions();
    expect(list[0].id).toBe(a.id);   // updated last
    expect(list[1].id).toBe(b.id);
  });

  it('migrate-on-load idempotently converts legacy default key', async () => {
    // Pre-populate disk with legacy V1 shape
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(
      filePath,
      JSON.stringify({ default: [{ id: 'a', role: 'user', text: 'legacy', timestamp: 1 }] }),
    );
    const list = await store.listSessions();
    expect(list).toHaveLength(1);
    expect(list[0].id).toMatch(UUID_RE);
    expect(list[0].title).toBe('legacy');
    // Second call should still return the same session (idempotent)
    const list2 = await store.listSessions();
    expect(list2).toEqual(list);
  });

  it('persists across instances (file-backed)', async () => {
    const meta = await store.createEmpty();
    await store.append(meta.id, { id: 'p', role: 'user', text: 'persist', timestamp: 1 });
    const store2 = new HistoryStore(filePath);
    const msgs = await store2.read(meta.id);
    expect(msgs).toEqual([{ id: 'p', role: 'user', text: 'persist', timestamp: 1 }]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run server/domain/history/history.store.test.ts
```

Expected: FAIL (most tests).

- [ ] **Step 3: Replace the implementation**

`server/domain/history/history.store.ts`:
```ts
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { JsonStore } from '@/server/lib/json-store';
import { ValidationError, NotFoundError } from '@/server/lib/errors';
import { SessionsFileSchema } from './history.schema';
import { migrateLegacyDefault } from './history.migrate';
import { computeTitle } from './title';
import type { Message, SessionMeta, SessionRecord, SessionsFile } from './history.types';

const TITLE_MAX = 200;

export class HistoryStore {
  private json: JsonStore<SessionsFile>;
  private migrationApplied = false;

  constructor(private readonly filePath: string) {
    this.json = new JsonStore<SessionsFile>(filePath, SessionsFileSchema, {});
  }

  private async ensureMigrated(): Promise<SessionsFile> {
    if (this.migrationApplied) return this.json.read();

    // Bypass schema validation: JsonStore.read() returns the default {}
    // for files that fail zod parsing (e.g. legacy V1 shape with Message[]
    // values). To detect and migrate, we read the raw JSON ourselves.
    let raw: Record<string, unknown> = {};
    try {
      const text = await readFile(this.filePath, 'utf-8');
      raw = JSON.parse(text) as Record<string, unknown>;
    } catch {
      raw = {};
    }
    const migrated = migrateLegacyDefault(raw);

    // Persist only if the shape actually changed (idempotent on V2 data).
    if (JSON.stringify(migrated) !== JSON.stringify(raw)) {
      await this.json.write(migrated);
    }
    this.migrationApplied = true;
    return migrated;
  }

  async listSessions(): Promise<SessionMeta[]> {
    const file = await this.ensureMigrated();
    const metas: SessionMeta[] = Object.entries(file).map(([id, rec]) => ({
      id,
      title: rec.title,
      createdAt: rec.createdAt,
      updatedAt: rec.messages.at(-1)?.timestamp ?? rec.createdAt,
    }));
    metas.sort((a, b) => b.updatedAt - a.updatedAt);
    return metas;
  }

  async read(sessionId: string): Promise<Message[] | null> {
    const file = await this.ensureMigrated();
    return file[sessionId]?.messages ?? null;
  }

  async createEmpty(): Promise<SessionMeta> {
    await this.ensureMigrated();
    const id = randomUUID();
    const now = Date.now();
    const rec: SessionRecord = { title: '', createdAt: now, messages: [] };
    await this.json.update((cur) => ({ ...cur, [id]: rec }));
    return { id, title: '', createdAt: now, updatedAt: now };
  }

  async append(sessionId: string, message: Message): Promise<void> {
    await this.ensureMigrated();
    await this.json.update((cur) => {
      const rec = cur[sessionId];
      if (!rec) throw new NotFoundError(`session ${sessionId}`);
      const isFirst = rec.messages.length === 0;
      const nextTitle =
        isFirst && message.role === 'user' && rec.title === ''
          ? computeTitle(message.text)
          : rec.title;
      return {
        ...cur,
        [sessionId]: {
          ...rec,
          title: nextTitle,
          messages: [...rec.messages, message],
        },
      };
    });
  }

  async rename(sessionId: string, title: string): Promise<SessionMeta> {
    if (!title.trim()) throw new ValidationError('Title cannot be empty');
    if (title.length > TITLE_MAX) throw new ValidationError(`Title too long (max ${TITLE_MAX})`);
    await this.ensureMigrated();
    let rec: SessionRecord | undefined;
    await this.json.update((cur) => {
      const r = cur[sessionId];
      if (!r) throw new NotFoundError(`session ${sessionId}`);
      rec = { ...r, title };
      return { ...cur, [sessionId]: rec };
    });
    const updatedRec = rec!;
    return {
      id: sessionId,
      title: updatedRec.title,
      createdAt: updatedRec.createdAt,
      updatedAt: updatedRec.messages.at(-1)?.timestamp ?? updatedRec.createdAt,
    };
  }

  async delete(sessionId: string): Promise<void> {
    await this.ensureMigrated();
    await this.json.update((cur) => {
      if (!cur[sessionId]) throw new NotFoundError(`session ${sessionId}`);
      const next: SessionsFile = { ...cur };
      delete next[sessionId];
      return next;
    });
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run server/domain/history/history.store.test.ts
```

Expected: PASS (15 tests).

- [ ] **Step 5: Verify backend lint still has expected errors only**

```bash
npm run lint 2>&1 | head -40
```

Expected errors in: `server/domain/dispatch/dispatch.service.ts` (uses old `read()` signature without sessionId), `server/routes/history.routes.ts` (uses `read()` and `reset()`), `server/routes/dispatch.routes.test.ts` if any reference. These will be fixed in Phase D.

- [ ] **Step 6: Commit**

```bash
git add server/domain/history/history.store.ts server/domain/history/history.store.test.ts
git commit -m "feat(slice-2b): rewrite HistoryStore with per-session API + migrate-on-load"
```

(Repository state is mid-refactor — lint fails. Fix in Phase D.)

---

## Phase D — Routes + dispatch service

### Task D1: Rewrite history.routes

**Files:**
- Modify: `server/routes/history.routes.ts`
- Modify: `server/routes/history.routes.test.ts`

- [ ] **Step 1: Replace the test**

`server/routes/history.routes.test.ts`:
```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createApp } from '@/server/app';
import { ContextStore } from '@/server/domain/context/context.store';
import { HistoryStore } from '@/server/domain/history/history.store';

let dir: string;
let contextStore: ContextStore;
let historyStore: HistoryStore;
let app: ReturnType<typeof createApp>;

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'aether-hist-routes-'));
  contextStore = new ContextStore(path.join(dir, 'context.json'));
  historyStore = new HistoryStore(path.join(dir, 'sessions.json'));
  app = createApp({ contextStore, historyStore });
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('/api/sessions', () => {
  it('GET returns empty list initially', async () => {
    const res = await request(app).get('/api/sessions');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ sessions: [] });
  });

  it('POST creates an empty session', async () => {
    const res = await request(app).post('/api/sessions');
    expect(res.status).toBe(201);
    expect(res.body.id).toMatch(/[0-9a-f-]{36}/);
    expect(res.body.title).toBe('');
    expect(typeof res.body.createdAt).toBe('number');
  });

  it('GET lists created sessions', async () => {
    const a = await historyStore.createEmpty();
    const b = await historyStore.createEmpty();
    const res = await request(app).get('/api/sessions');
    expect(res.body.sessions).toHaveLength(2);
    expect(res.body.sessions.map((s: { id: string }) => s.id)).toEqual(
      expect.arrayContaining([a.id, b.id]),
    );
  });

  it('GET /:id returns messages of the session', async () => {
    const meta = await historyStore.createEmpty();
    await historyStore.append(meta.id, { id: 'a', role: 'user', text: 'hi', timestamp: 1 });
    const res = await request(app).get(`/api/sessions/${meta.id}`);
    expect(res.status).toBe(200);
    expect(res.body.messages).toHaveLength(1);
    expect(res.body.messages[0]).toMatchObject({ id: 'a', role: 'user' });
  });

  it('GET /:id returns 404 for unknown session', async () => {
    const res = await request(app).get('/api/sessions/nope');
    expect(res.status).toBe(404);
  });

  it('PATCH /:id renames the session', async () => {
    const meta = await historyStore.createEmpty();
    const res = await request(app)
      .patch(`/api/sessions/${meta.id}`)
      .send({ title: 'My chat' });
    expect(res.status).toBe(200);
    expect(res.body.title).toBe('My chat');
  });

  it('PATCH /:id rejects empty title', async () => {
    const meta = await historyStore.createEmpty();
    const res = await request(app)
      .patch(`/api/sessions/${meta.id}`)
      .send({ title: '' });
    expect(res.status).toBe(400);
  });

  it('PATCH /:id returns 404 for unknown session', async () => {
    const res = await request(app).patch('/api/sessions/nope').send({ title: 'x' });
    expect(res.status).toBe(404);
  });

  it('DELETE /:id removes the session', async () => {
    const meta = await historyStore.createEmpty();
    const res = await request(app).delete(`/api/sessions/${meta.id}`);
    expect(res.status).toBe(204);
    expect(await historyStore.read(meta.id)).toBeNull();
  });

  it('DELETE /:id returns 404 for unknown session', async () => {
    const res = await request(app).delete('/api/sessions/nope');
    expect(res.status).toBe(404);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run server/routes/history.routes.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Replace the route**

`server/routes/history.routes.ts`:
```ts
import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import type { HistoryStore } from '@/server/domain/history/history.store';
import { ValidationError } from '@/server/lib/errors';

const RenameBody = z.object({ title: z.string() });

function asyncHandler(fn: (req: Request, res: Response, next: NextFunction) => Promise<void>) {
  return (req: Request, res: Response, next: NextFunction) => {
    fn(req, res, next).catch(next);
  };
}

export function createHistoryRoutes(store: HistoryStore): Router {
  const router = Router();

  router.get(
    '/',
    asyncHandler(async (_req, res) => {
      res.json({ sessions: await store.listSessions() });
    }),
  );

  router.post(
    '/',
    asyncHandler(async (_req, res) => {
      const meta = await store.createEmpty();
      res.status(201).json(meta);
    }),
  );

  router.get(
    '/:id',
    asyncHandler(async (req, res) => {
      const msgs = await store.read(req.params.id);
      if (!msgs) {
        res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Session not found' } });
        return;
      }
      res.json({ messages: msgs });
    }),
  );

  router.patch(
    '/:id',
    asyncHandler(async (req, res) => {
      const parsed = RenameBody.safeParse(req.body);
      if (!parsed.success) throw new ValidationError('Invalid rename payload', parsed.error);
      const meta = await store.rename(req.params.id, parsed.data.title);
      res.json(meta);
    }),
  );

  router.delete(
    '/:id',
    asyncHandler(async (req, res) => {
      await store.delete(req.params.id);
      res.status(204).end();
    }),
  );

  return router;
}
```

`app.ts` already routes `/api/sessions` to `createHistoryRoutes(deps.historyStore)` (from slice 2a) — no change needed in app.ts.

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run server/routes/history.routes.test.ts
```

Expected: PASS (10 tests).

- [ ] **Step 5: Commit**

```bash
git add server/routes/history.routes.ts server/routes/history.routes.test.ts
git commit -m "feat(slice-2b): rewrite history.routes for CRUD /api/sessions[/:id]"
```

---

### Task D2: dispatch.service sessionId

**Files:**
- Modify: `server/domain/dispatch/dispatch.service.ts`
- Modify: `server/domain/dispatch/dispatch.service.test.ts`

- [ ] **Step 1: Replace the dispatch test**

`server/domain/dispatch/dispatch.service.test.ts`:
```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DispatchService } from './dispatch.service';
import { FakeProvider } from './providers/fake.provider';
import { HistoryStore } from '@/server/domain/history/history.store';
import { ContextStore } from '@/server/domain/context/context.store';
import { createCollectorEmitter } from '@/server/test/sse-collector';

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'aether-dispatch-'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('DispatchService', () => {
  async function makeService(opts: { chunks: string[]; chunkDelayMs?: number }) {
    const provider = new FakeProvider({ chunks: opts.chunks, chunkDelayMs: opts.chunkDelayMs, model: 'fake-1' });
    const historyStore = new HistoryStore(path.join(dir, 'sessions.json'));
    const contextStore = new ContextStore(path.join(dir, 'context.json'));
    const service = new DispatchService({ provider, historyStore, contextStore });
    const session = await historyStore.createEmpty();
    return { service, historyStore, contextStore, sessionId: session.id };
  }

  it('emits text events then done', async () => {
    const { service, sessionId } = await makeService({ chunks: ['Hello', ' world'] });
    const { emitter, events } = createCollectorEmitter();
    const ctrl = new AbortController();
    await service.handle({ sessionId, message: 'hi' }, emitter, ctrl.signal);
    expect(events.map((e) => e.event)).toEqual(['text', 'text', 'done']);
    expect(events[2].data).toMatchObject({ model: 'fake-1', interrupted: false });
  });

  it('persists user + model messages to the specified session', async () => {
    const { service, historyStore, sessionId } = await makeService({ chunks: ['pong'] });
    const { emitter } = createCollectorEmitter();
    await service.handle({ sessionId, message: 'ping' }, emitter, new AbortController().signal);
    const msgs = await historyStore.read(sessionId);
    expect(msgs!.map((m) => `${m.role}:${m.text}`)).toEqual(['user:ping', 'model:pong']);
  });

  it('does not touch other sessions', async () => {
    const { service, historyStore, sessionId } = await makeService({ chunks: ['pong'] });
    const other = await historyStore.createEmpty();
    const { emitter } = createCollectorEmitter();
    await service.handle({ sessionId, message: 'ping' }, emitter, new AbortController().signal);
    const otherMsgs = await historyStore.read(other.id);
    expect(otherMsgs).toEqual([]);
  });

  it('emits Session not found when sessionId does not exist', async () => {
    const { service } = await makeService({ chunks: ['x'] });
    const { emitter, events } = createCollectorEmitter();
    await service.handle(
      { sessionId: 'no-such-session', message: 'hi' },
      emitter,
      new AbortController().signal,
    );
    const err = events.find((e) => e.event === 'error');
    expect(err).toBeDefined();
    expect((err!.data as { message: string }).message).toBe('Session not found');
    expect((err!.data as { retryable: boolean }).retryable).toBe(false);
  });

  it('emits Invalid request body for missing sessionId', async () => {
    const { service } = await makeService({ chunks: ['x'] });
    const { emitter, events } = createCollectorEmitter();
    await service.handle({ message: 'hi' }, emitter, new AbortController().signal);
    expect(events.find((e) => e.event === 'error')).toBeDefined();
  });

  it('passes history + systemInstruction to provider', async () => {
    const historyStore = new HistoryStore(path.join(dir, 'sessions.json'));
    const contextStore = new ContextStore(path.join(dir, 'context.json'));
    await contextStore.patch({ systemInstruction: 'YOU_ARE_AETHER' });
    const session = await historyStore.createEmpty();
    await historyStore.append(session.id, { id: 'p1', role: 'user', text: 'first', timestamp: 1 });
    await historyStore.append(session.id, { id: 'p2', role: 'model', text: 'reply', timestamp: 2 });

    let captured: unknown;
    class CapturingProvider {
      readonly model = 'cap';
      async *stream(req: unknown) {
        captured = req;
        yield { type: 'text' as const, text: 'x' };
        yield { type: 'done' as const };
      }
    }
    const svc = new DispatchService({
      provider: new CapturingProvider(),
      historyStore,
      contextStore,
    });
    const { emitter } = createCollectorEmitter();
    await svc.handle(
      { sessionId: session.id, message: 'second' },
      emitter,
      new AbortController().signal,
    );
    expect(captured).toMatchObject({
      systemInstruction: 'YOU_ARE_AETHER',
      history: [
        { role: 'user', text: 'first' },
        { role: 'model', text: 'reply' },
      ],
      userMessage: 'second',
    });
  });

  it('saves partial + interrupted=true when aborted', async () => {
    const { service, historyStore, sessionId } = await makeService({ chunks: ['a', 'b', 'c'], chunkDelayMs: 20 });
    const { emitter, events } = createCollectorEmitter();
    const ctrl = new AbortController();
    setTimeout(() => ctrl.abort(), 10);
    await service.handle({ sessionId, message: 'ping' }, emitter, ctrl.signal);
    const last = events.at(-1);
    expect(last?.event).toBe('done');
    expect((last?.data as { interrupted: boolean }).interrupted).toBe(true);
    const msgs = await historyStore.read(sessionId);
    const model = msgs!.find((m) => m.role === 'model')!;
    expect(model.interrupted).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run server/domain/dispatch/dispatch.service.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Modify the implementation**

`server/domain/dispatch/dispatch.service.ts`:
```ts
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { SseEmitter } from '@/server/lib/sse';
import type { ContextStore } from '@/server/domain/context/context.store';
import type { HistoryStore } from '@/server/domain/history/history.store';
import type { AIProvider } from './providers/provider.types';

export const DispatchRequestSchema = z.object({
  sessionId: z.string().min(1),
  message: z.string().min(1),
});
export type DispatchRequest = z.infer<typeof DispatchRequestSchema>;

export interface DispatchServiceDeps {
  provider: AIProvider;
  historyStore: HistoryStore;
  contextStore: ContextStore;
}

export class DispatchService {
  constructor(private readonly deps: DispatchServiceDeps) {}

  async handle(
    rawBody: unknown,
    sse: SseEmitter,
    signal: AbortSignal,
  ): Promise<void> {
    const parsed = DispatchRequestSchema.safeParse(rawBody);
    if (!parsed.success) {
      sse.error('Invalid request body', false);
      return;
    }
    const { sessionId, message } = parsed.data;
    const { provider, historyStore, contextStore } = this.deps;

    // Confirm session exists before doing anything else.
    const prior = await historyStore.read(sessionId);
    if (prior === null) {
      sse.event('error', { message: 'Session not found', retryable: false });
      sse.end();
      return;
    }

    let context;
    try {
      context = await contextStore.read();
    } catch {
      sse.event('error', { message: 'Context load failed', retryable: true });
      sse.end();
      return;
    }

    await historyStore.append(sessionId, {
      id: randomUUID(),
      role: 'user',
      text: message,
      timestamp: Date.now(),
    });

    let accumulated = '';
    try {
      const it = provider.stream(
        {
          systemInstruction: context.systemInstruction,
          history: prior.map((m) => ({ role: m.role, text: m.text })),
          userMessage: message,
        },
        signal,
      );
      for await (const chunk of it) {
        if (signal.aborted) break;
        if (chunk.type === 'text') {
          accumulated += chunk.text;
          sse.event('text', { chunk: chunk.text });
        } else if (chunk.type === 'done') {
          break;
        }
      }
    } catch (e) {
      const { message: msg, retryable } = classifyError(e);
      sse.event('error', { message: msg, retryable });
      await historyStore.append(sessionId, {
        id: randomUUID(),
        role: 'model',
        text: accumulated,
        timestamp: Date.now(),
        model: provider.model,
        error: msg,
        retryable,
      });
      sse.end();
      return;
    }

    const interrupted = signal.aborted;
    await historyStore.append(sessionId, {
      id: randomUUID(),
      role: 'model',
      text: accumulated,
      timestamp: Date.now(),
      model: provider.model,
      interrupted,
    });

    sse.event('done', { model: provider.model, interrupted });
    sse.end();
  }
}

function classifyError(e: unknown): { message: string; retryable: boolean } {
  const message = e instanceof Error ? e.message : 'Unknown error';
  const code = (e as { code?: string; status?: number }).code;
  const status = (e as { status?: number }).status;
  if (code === 'ECONNRESET' || code === 'ETIMEDOUT' || code === 'EAI_AGAIN') {
    return { message, retryable: true };
  }
  if (status === 429 || status === 503 || status === 504) {
    return { message, retryable: true };
  }
  if (status === 401 || status === 403 || /api[_ ]?key|auth|unauthor/i.test(message)) {
    return { message, retryable: false };
  }
  return { message, retryable: true };
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run server/domain/dispatch/dispatch.service.test.ts
```

Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add server/domain/dispatch/dispatch.service.ts server/domain/dispatch/dispatch.service.test.ts
git commit -m "feat(slice-2b): dispatch.service accepts sessionId + emits Session not found"
```

---

### Task D3: dispatch.routes test update

**Files:**
- Modify: `server/routes/dispatch.routes.test.ts`

The route file itself doesn't change (it forwards body to service), but the test file references the old body shape `{message}` — update to `{sessionId, message}`.

- [ ] **Step 1: Replace the route test**

`server/routes/dispatch.routes.test.ts`:
```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createApp } from '@/server/app';
import { ContextStore } from '@/server/domain/context/context.store';
import { HistoryStore } from '@/server/domain/history/history.store';
import { DispatchService } from '@/server/domain/dispatch/dispatch.service';
import { FakeProvider } from '@/server/domain/dispatch/providers/fake.provider';
import { collectSseEvents } from '@/server/test/sse-collector';

let dir: string;
let contextStore: ContextStore;
let historyStore: HistoryStore;

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'aether-disp-routes-'));
  contextStore = new ContextStore(path.join(dir, 'context.json'));
  historyStore = new HistoryStore(path.join(dir, 'sessions.json'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

async function appWith(chunks: string[]) {
  const provider = new FakeProvider({ chunks });
  const dispatcher = new DispatchService({ provider, historyStore, contextStore });
  const app = createApp({ contextStore, historyStore, dispatcher });
  const session = await historyStore.createEmpty();
  return { app, sessionId: session.id };
}

describe('/api/ai/dispatch', () => {
  it('streams text + done events', async () => {
    const { app, sessionId } = await appWith(['Hello', ' world']);
    const res = await request(app)
      .post('/api/ai/dispatch')
      .set('Accept', 'text/event-stream')
      .send({ sessionId, message: 'hi' });
    expect(res.status).toBe(200);
    const events = await collectSseEvents(res);
    expect(events.map((e) => e.event)).toEqual(['text', 'text', 'done']);
  });

  it('persists messages to the right session', async () => {
    const { app, sessionId } = await appWith(['pong']);
    await request(app).post('/api/ai/dispatch').send({ sessionId, message: 'ping' });
    const msgs = await historyStore.read(sessionId);
    expect(msgs!.map((m) => `${m.role}:${m.text}`)).toEqual(['user:ping', 'model:pong']);
  });

  it('emits error event for invalid body', async () => {
    const { app } = await appWith(['x']);
    const res = await request(app).post('/api/ai/dispatch').send({});
    const events = await collectSseEvents(res);
    expect(events.find((e) => e.event === 'error')).toBeDefined();
  });

  it('emits Session not found for unknown sessionId', async () => {
    const { app } = await appWith(['x']);
    const res = await request(app)
      .post('/api/ai/dispatch')
      .send({ sessionId: 'nope', message: 'hi' });
    const events = await collectSseEvents(res);
    const err = events.find((e) => e.event === 'error');
    expect(err).toBeDefined();
    expect((err!.data as { message: string }).message).toBe('Session not found');
  });

  it('returns 503 when dispatcher is not configured', async () => {
    const app = createApp({ contextStore, historyStore });
    const res = await request(app).post('/api/ai/dispatch').send({ sessionId: 'x', message: 'x' });
    expect(res.status).toBe(503);
  });
});
```

- [ ] **Step 2: Run test**

```bash
npx vitest run server/routes/dispatch.routes.test.ts
```

Expected: PASS (5 tests).

- [ ] **Step 3: Run all backend tests for regression**

```bash
npx vitest run server
```

Expected: ALL PASS (and `npm run lint` should now be clean).

- [ ] **Step 4: Lint check**

```bash
npm run lint
```

Expected: PASS (clean).

- [ ] **Step 5: Commit**

```bash
git add server/routes/dispatch.routes.test.ts
git commit -m "test(slice-2b): update dispatch.routes test for sessionId body"
```

---

## Phase E — Frontend types + API clients

### Task E1: session.types FE

**Files:**
- Create: `src/types/session.types.ts`

- [ ] **Step 1: Create**

`src/types/session.types.ts`:
```ts
export type { SessionMeta, SessionRecord } from '@/server/domain/history/history.types';
```

- [ ] **Step 2: Verify lint**

```bash
npm run lint
```

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/types/session.types.ts
git commit -m "feat(slice-2b): re-export SessionMeta + SessionRecord types"
```

---

### Task E2: sessions.api FE

**Files:**
- Create: `src/lib/api/sessions.api.ts`
- Create: `src/lib/api/sessions.api.test.ts`
- Modify: `src/test/msw-handlers.ts`

- [ ] **Step 1: Add default MSW handlers**

Replace `src/test/msw-handlers.ts`:
```ts
import { http, HttpResponse } from 'msw';
import type { AetherContext } from '@/src/types/context.types';

const defaultContext: AetherContext = {
  systemInstruction: 'You are Aether',
  skills: [],
  tools: [],
  mcpServers: [],
};

export const handlers = [
  http.get('http://localhost/api/__health', () => HttpResponse.json({ ok: true })),
  http.get('http://localhost/api/context', () => HttpResponse.json(defaultContext)),
  http.get('http://localhost/api/sessions', () => HttpResponse.json({ sessions: [] })),
  http.post('http://localhost/api/sessions', () =>
    HttpResponse.json(
      { id: 'msw-session-1', title: '', createdAt: 0, updatedAt: 0 },
      { status: 201 },
    ),
  ),
  http.get('http://localhost/api/sessions/:id', () => HttpResponse.json({ messages: [] })),
  http.patch('http://localhost/api/sessions/:id', ({ params }) =>
    HttpResponse.json({ id: params.id, title: 'renamed', createdAt: 0, updatedAt: 0 }),
  ),
  http.delete('http://localhost/api/sessions/:id', () => new HttpResponse(null, { status: 204 })),
];
```

- [ ] **Step 2: Write the failing test**

`src/lib/api/sessions.api.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { http, HttpResponse } from 'msw';
import { server } from '@/src/test/msw-server';
import { sessionsApi } from './sessions.api';

describe('sessionsApi', () => {
  it('list returns sessions array', async () => {
    server.use(
      http.get('http://localhost/api/sessions', () =>
        HttpResponse.json({
          sessions: [{ id: 'a', title: 'first', createdAt: 1, updatedAt: 2 }],
        }),
      ),
    );
    const out = await sessionsApi.list();
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ id: 'a', title: 'first' });
  });

  it('list returns empty from default handler', async () => {
    const out = await sessionsApi.list();
    expect(out).toEqual([]);
  });

  it('create POSTs and returns new session', async () => {
    server.use(
      http.post('http://localhost/api/sessions', () =>
        HttpResponse.json(
          { id: 'NEW', title: '', createdAt: 100, updatedAt: 100 },
          { status: 201 },
        ),
      ),
    );
    const out = await sessionsApi.create();
    expect(out.id).toBe('NEW');
  });

  it('rename PATCHes and returns updated session', async () => {
    server.use(
      http.patch('http://localhost/api/sessions/:id', ({ params }) =>
        HttpResponse.json({ id: params.id, title: 'X', createdAt: 1, updatedAt: 2 }),
      ),
    );
    const out = await sessionsApi.rename('abc', 'X');
    expect(out.title).toBe('X');
  });

  it('rename throws on 400', async () => {
    server.use(
      http.patch('http://localhost/api/sessions/:id', () =>
        HttpResponse.json({ error: { message: 'bad' } }, { status: 400 }),
      ),
    );
    await expect(sessionsApi.rename('abc', '')).rejects.toThrow(/bad/);
  });

  it('delete hits DELETE 204', async () => {
    let called = false;
    server.use(
      http.delete('http://localhost/api/sessions/:id', () => {
        called = true;
        return new HttpResponse(null, { status: 204 });
      }),
    );
    await sessionsApi.delete('abc');
    expect(called).toBe(true);
  });

  it('delete throws on 404', async () => {
    server.use(
      http.delete('http://localhost/api/sessions/:id', () =>
        HttpResponse.json({ error: { message: 'not found' } }, { status: 404 }),
      ),
    );
    await expect(sessionsApi.delete('nope')).rejects.toThrow();
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

```bash
npx vitest run src/lib/api/sessions.api.test.ts
```

Expected: FAIL.

- [ ] **Step 4: Write the implementation**

`src/lib/api/sessions.api.ts`:
```ts
import type { SessionMeta } from '@/src/types/session.types';

const BASE = '/api/sessions';

interface ErrorBody { error?: { message?: string } }

async function asJson<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as ErrorBody;
    throw new Error(body?.error?.message ?? `HTTP ${res.status}`);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

const json = (method: string, body?: unknown): RequestInit => ({
  method,
  headers: { 'Content-Type': 'application/json' },
  body: body !== undefined ? JSON.stringify(body) : undefined,
});

export const sessionsApi = {
  list: async (): Promise<SessionMeta[]> => {
    const res = await fetch(BASE);
    const body = await asJson<{ sessions: SessionMeta[] }>(res);
    return body.sessions;
  },
  create: async (): Promise<SessionMeta> => {
    const res = await fetch(BASE, json('POST'));
    return asJson<SessionMeta>(res);
  },
  rename: async (id: string, title: string): Promise<SessionMeta> => {
    const res = await fetch(`${BASE}/${id}`, json('PATCH', { title }));
    return asJson<SessionMeta>(res);
  },
  delete: async (id: string): Promise<void> => {
    const res = await fetch(`${BASE}/${id}`, { method: 'DELETE' });
    await asJson<void>(res);
  },
};
```

- [ ] **Step 5: Run test to verify it passes**

```bash
npx vitest run src/lib/api/sessions.api.test.ts
```

Expected: PASS (7 tests).

- [ ] **Step 6: Commit**

```bash
git add src/lib/api/sessions.api.ts src/lib/api/sessions.api.test.ts src/test/msw-handlers.ts
git commit -m "feat(slice-2b): add sessionsApi client + MSW handlers"
```

---

### Task E3: history.api rewrite

**Files:**
- Modify: `src/lib/api/history.api.ts`
- Modify: `src/lib/api/history.api.test.ts`

`fetchDefault()` viene rimossa e sostituita da `fetchById(id)`. `clearDefault()` viene rimossa (la cancellazione passa per `sessionsApi.delete`).

- [ ] **Step 1: Replace the test**

`src/lib/api/history.api.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { http, HttpResponse } from 'msw';
import { server } from '@/src/test/msw-server';
import { historyApi } from './history.api';

describe('historyApi', () => {
  it('fetchById returns messages from default handler', async () => {
    const out = await historyApi.fetchById('msw-session-1');
    expect(out).toEqual([]);
  });

  it('fetchById returns populated messages', async () => {
    server.use(
      http.get('http://localhost/api/sessions/:id', () =>
        HttpResponse.json({
          messages: [{ id: 'a', role: 'user', text: 'hi', timestamp: 1 }],
        }),
      ),
    );
    const out = await historyApi.fetchById('any');
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ id: 'a', role: 'user' });
  });

  it('fetchById throws on 404', async () => {
    server.use(
      http.get('http://localhost/api/sessions/:id', () =>
        HttpResponse.json({ error: { message: 'not found' } }, { status: 404 }),
      ),
    );
    await expect(historyApi.fetchById('nope')).rejects.toThrow();
  });

  it('fetchById throws on 500', async () => {
    server.use(
      http.get('http://localhost/api/sessions/:id', () =>
        HttpResponse.json({ error: { message: 'boom' } }, { status: 500 }),
      ),
    );
    await expect(historyApi.fetchById('any')).rejects.toThrow(/boom/);
  });
});
```

- [ ] **Step 2: Run test (it should fail because old impl exposes `fetchDefault`)**

```bash
npx vitest run src/lib/api/history.api.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Replace the implementation**

`src/lib/api/history.api.ts`:
```ts
import type { Message } from '@/src/types/message.types';

const BASE = '/api/sessions';

interface ErrorBody { error?: { message?: string } }

async function asJson<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as ErrorBody;
    throw new Error(body?.error?.message ?? `HTTP ${res.status}`);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export const historyApi = {
  fetchById: async (id: string): Promise<Message[]> => {
    const res = await fetch(`${BASE}/${id}`);
    const body = await asJson<{ messages: Message[] }>(res);
    return body.messages;
  },
};
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run src/lib/api/history.api.test.ts
```

Expected: PASS (4 tests).

- [ ] **Step 5: Commit (other files will be red until App.tsx is updated)**

```bash
git add src/lib/api/history.api.ts src/lib/api/history.api.test.ts
git commit -m "feat(slice-2b): historyApi.fetchById replaces fetchDefault"
```

---

### Task E4: dispatch.api FE — body include sessionId

**Files:**
- Modify: `src/lib/api/dispatch.api.ts`
- Modify: `src/lib/api/dispatch.api.test.ts`

- [ ] **Step 1: Update the test**

`src/lib/api/dispatch.api.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { http, HttpResponse } from 'msw';
import { server } from '@/src/test/msw-server';
import { createStreamingDispatch } from './dispatch.api';

function sseChunks(...lines: string[]) {
  const enc = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(c) {
      for (const l of lines) c.enqueue(enc.encode(l));
      c.close();
    },
  });
}

async function collect<T>(it: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const v of it) out.push(v);
  return out;
}

describe('createStreamingDispatch', () => {
  it('sends sessionId + message in body', async () => {
    let received: unknown;
    server.use(
      http.post('http://localhost/api/ai/dispatch', async ({ request }) => {
        received = await request.json();
        return new HttpResponse(
          sseChunks('event: done\ndata: {"model":"f","interrupted":false}\n\n'),
          { headers: { 'Content-Type': 'text/event-stream' } },
        );
      }),
    );
    await collect(createStreamingDispatch({ sessionId: 'S1', message: 'hi' }, new AbortController().signal));
    expect(received).toEqual({ sessionId: 'S1', message: 'hi' });
  });

  it('yields parsed text + done events', async () => {
    server.use(
      http.post('http://localhost/api/ai/dispatch', () =>
        new HttpResponse(
          sseChunks(
            'event: text\ndata: {"chunk":"Hello"}\n\n',
            'event: done\ndata: {"model":"fake-1","interrupted":false}\n\n',
          ),
          { headers: { 'Content-Type': 'text/event-stream' } },
        ),
      ),
    );
    const events = await collect(createStreamingDispatch({ sessionId: 'S', message: 'hi' }, new AbortController().signal));
    expect(events.map((e) => e.event)).toEqual(['text', 'done']);
  });

  it('throws AbortError when signal aborted before fetch resolves', async () => {
    server.use(
      http.post('http://localhost/api/ai/dispatch', () =>
        new HttpResponse(sseChunks('event: text\ndata: {"chunk":"A"}\n\n'), {
          headers: { 'Content-Type': 'text/event-stream' },
        }),
      ),
    );
    const ctrl = new AbortController();
    ctrl.abort();
    await expect(
      collect(createStreamingDispatch({ sessionId: 'S', message: 'hi' }, ctrl.signal)),
    ).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('throws when response is not ok', async () => {
    server.use(
      http.post('http://localhost/api/ai/dispatch', () =>
        HttpResponse.json({ error: { message: 'bad' } }, { status: 503 }),
      ),
    );
    await expect(
      collect(createStreamingDispatch({ sessionId: 'S', message: 'hi' }, new AbortController().signal)),
    ).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run src/lib/api/dispatch.api.test.ts
```

Expected: FAIL (types mismatch).

- [ ] **Step 3: Update the implementation**

`src/lib/api/dispatch.api.ts`:
```ts
import { parseSseStream, type SseEvent } from '@/src/lib/sse-parser';

export interface DispatchRequestBody {
  sessionId: string;
  message: string;
}

export async function* createStreamingDispatch(
  body: DispatchRequestBody,
  signal: AbortSignal,
): AsyncGenerator<SseEvent> {
  const res = await fetch('/api/ai/dispatch', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
    body: JSON.stringify(body),
    signal,
  });
  if (!res.ok || !res.body) {
    throw new Error(`HTTP ${res.status}`);
  }
  for await (const ev of parseSseStream(res.body)) {
    yield ev;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run src/lib/api/dispatch.api.test.ts
```

Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/api/dispatch.api.ts src/lib/api/dispatch.api.test.ts
git commit -m "feat(slice-2b): dispatch.api body includes sessionId"
```

After this commit `useStreamingDispatch` will be red — fix in Phase F.

---

## Phase F — Frontend state + hook

### Task F1: useSessionsStore

**Files:**
- Create: `src/stores/sessions.store.ts`
- Create: `src/stores/sessions.store.test.ts`

This is the largest store: init, create, setActive (with hydration token), rename (optimistic + rollback), delete (auto-switch / auto-create), setLocalTitle, touchUpdatedAt, clearError.

- [ ] **Step 1: Write the failing test**

`src/stores/sessions.store.test.ts`:
```ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { http, HttpResponse } from 'msw';
import { server } from '@/src/test/msw-server';
import { useSessionsStore } from './sessions.store';
import { useChatStore } from './chat.store';

beforeEach(() => {
  useSessionsStore.getState()._reset();
  useChatStore.getState()._reset();
  localStorage.clear();
});

const m = (id: string, title = '') => ({ id, title, createdAt: 1, updatedAt: 2 });

describe('useSessionsStore.init', () => {
  it('creates a new session when server has none', async () => {
    server.use(
      http.get('http://localhost/api/sessions', () => HttpResponse.json({ sessions: [] })),
      http.post('http://localhost/api/sessions', () =>
        HttpResponse.json(m('NEW', ''), { status: 201 }),
      ),
    );
    await useSessionsStore.getState().init();
    const s = useSessionsStore.getState();
    expect(s.activeSessionId).toBe('NEW');
    expect(s.sessions.map((x) => x.id)).toContain('NEW');
    expect(s.hydrated).toBe(true);
  });

  it('preserves activeSessionId from localStorage if still valid', async () => {
    localStorage.setItem('aether.activeSessionId', 'B');
    server.use(
      http.get('http://localhost/api/sessions', () =>
        HttpResponse.json({ sessions: [m('A'), m('B')] }),
      ),
    );
    await useSessionsStore.getState().init();
    expect(useSessionsStore.getState().activeSessionId).toBe('B');
  });

  it('falls back to sessions[0] if stored id is unknown', async () => {
    localStorage.setItem('aether.activeSessionId', 'ZZ');
    server.use(
      http.get('http://localhost/api/sessions', () =>
        HttpResponse.json({ sessions: [m('A'), m('B')] }),
      ),
    );
    await useSessionsStore.getState().init();
    expect(useSessionsStore.getState().activeSessionId).toBe('A');
  });

  it('sets error when GET /api/sessions fails', async () => {
    server.use(
      http.get('http://localhost/api/sessions', () =>
        HttpResponse.json({ error: { message: 'boom' } }, { status: 500 }),
      ),
    );
    await useSessionsStore.getState().init();
    const s = useSessionsStore.getState();
    expect(s.error).toBeTruthy();
    expect(s.hydrated).toBe(true);
  });
});

describe('useSessionsStore.create', () => {
  it('appends new session at top and sets active', async () => {
    useSessionsStore.setState({ sessions: [m('OLD')], activeSessionId: 'OLD', hydrated: true });
    server.use(
      http.post('http://localhost/api/sessions', () =>
        HttpResponse.json(m('NEW', ''), { status: 201 }),
      ),
    );
    const created = await useSessionsStore.getState().create();
    expect(created.id).toBe('NEW');
    const s = useSessionsStore.getState();
    expect(s.sessions.map((x) => x.id)).toEqual(['NEW', 'OLD']);
    expect(s.activeSessionId).toBe('NEW');
    expect(localStorage.getItem('aether.activeSessionId')).toBe('NEW');
  });

  it('sets error on failure', async () => {
    useSessionsStore.setState({ sessions: [], activeSessionId: null, hydrated: true });
    server.use(
      http.post('http://localhost/api/sessions', () =>
        HttpResponse.json({ error: { message: 'no' } }, { status: 500 }),
      ),
    );
    await expect(useSessionsStore.getState().create()).rejects.toThrow();
    expect(useSessionsStore.getState().error).toBeTruthy();
  });
});

describe('useSessionsStore.setActive', () => {
  it('updates active, localStorage, and hydrates chat', async () => {
    useSessionsStore.setState({
      sessions: [m('A'), m('B')], activeSessionId: 'A', hydrated: true,
    });
    server.use(
      http.get('http://localhost/api/sessions/B', () =>
        HttpResponse.json({ messages: [{ id: 'x', role: 'user', text: 'hi', timestamp: 1 }] }),
      ),
    );
    useSessionsStore.getState().setActive('B');
    // setActive is sync; the fetch happens after — give it a tick
    await new Promise((r) => setTimeout(r, 10));
    expect(useSessionsStore.getState().activeSessionId).toBe('B');
    expect(localStorage.getItem('aether.activeSessionId')).toBe('B');
    expect(useChatStore.getState().messages).toHaveLength(1);
  });

  it('no-op when streamingId !== null', async () => {
    useSessionsStore.setState({
      sessions: [m('A'), m('B')], activeSessionId: 'A', hydrated: true,
    });
    useChatStore.setState({ streamingId: 'STREAMING' });
    useSessionsStore.getState().setActive('B');
    expect(useSessionsStore.getState().activeSessionId).toBe('A');
  });

  it('hydration token discards stale fetch', async () => {
    useSessionsStore.setState({
      sessions: [m('A'), m('B'), m('C')], activeSessionId: 'A', hydrated: true,
    });

    let releaseB: () => void = () => {};
    const gateB = new Promise<void>((r) => { releaseB = r; });
    server.use(
      http.get('http://localhost/api/sessions/B', async () => {
        await gateB;
        return HttpResponse.json({ messages: [{ id: 'b', role: 'user', text: 'BBB', timestamp: 1 }] });
      }),
      http.get('http://localhost/api/sessions/C', () =>
        HttpResponse.json({ messages: [{ id: 'c', role: 'user', text: 'CCC', timestamp: 1 }] }),
      ),
    );
    useSessionsStore.getState().setActive('B');
    await new Promise((r) => setTimeout(r, 5));
    useSessionsStore.getState().setActive('C');
    await new Promise((r) => setTimeout(r, 30));
    releaseB();
    await new Promise((r) => setTimeout(r, 30));
    const messages = useChatStore.getState().messages;
    expect(messages.map((x) => x.text)).toEqual(['CCC']); // B's stale fetch ignored
  });
});

describe('useSessionsStore.rename', () => {
  it('optimistic update + persisted', async () => {
    useSessionsStore.setState({ sessions: [m('A', 'old')], activeSessionId: 'A', hydrated: true });
    server.use(
      http.patch('http://localhost/api/sessions/:id', ({ params }) =>
        HttpResponse.json({ id: params.id, title: 'new', createdAt: 1, updatedAt: 2 }),
      ),
    );
    await useSessionsStore.getState().rename('A', 'new');
    expect(useSessionsStore.getState().sessions[0].title).toBe('new');
  });

  it('rolls back on failure', async () => {
    useSessionsStore.setState({ sessions: [m('A', 'old')], activeSessionId: 'A', hydrated: true });
    server.use(
      http.patch('http://localhost/api/sessions/:id', () =>
        HttpResponse.json({ error: { message: 'no' } }, { status: 400 }),
      ),
    );
    await expect(useSessionsStore.getState().rename('A', 'X')).rejects.toThrow();
    expect(useSessionsStore.getState().sessions[0].title).toBe('old');
    expect(useSessionsStore.getState().error).toBeTruthy();
  });
});

describe('useSessionsStore.delete', () => {
  it('removes and auto-switches to next when active is deleted', async () => {
    useSessionsStore.setState({
      sessions: [m('A'), m('B')], activeSessionId: 'A', hydrated: true,
    });
    server.use(
      http.delete('http://localhost/api/sessions/A', () => new HttpResponse(null, { status: 204 })),
      http.get('http://localhost/api/sessions/B', () => HttpResponse.json({ messages: [] })),
    );
    await useSessionsStore.getState().delete('A');
    await new Promise((r) => setTimeout(r, 10));
    const s = useSessionsStore.getState();
    expect(s.sessions.map((x) => x.id)).toEqual(['B']);
    expect(s.activeSessionId).toBe('B');
  });

  it('auto-creates new session when last is deleted', async () => {
    useSessionsStore.setState({
      sessions: [m('A')], activeSessionId: 'A', hydrated: true,
    });
    server.use(
      http.delete('http://localhost/api/sessions/A', () => new HttpResponse(null, { status: 204 })),
      http.post('http://localhost/api/sessions', () =>
        HttpResponse.json(m('NEW'), { status: 201 }),
      ),
      http.get('http://localhost/api/sessions/NEW', () => HttpResponse.json({ messages: [] })),
    );
    await useSessionsStore.getState().delete('A');
    await new Promise((r) => setTimeout(r, 10));
    const s = useSessionsStore.getState();
    expect(s.sessions.map((x) => x.id)).toEqual(['NEW']);
    expect(s.activeSessionId).toBe('NEW');
  });

  it('sets error on failure, no removal', async () => {
    useSessionsStore.setState({ sessions: [m('A')], activeSessionId: 'A', hydrated: true });
    server.use(
      http.delete('http://localhost/api/sessions/A', () =>
        HttpResponse.json({ error: { message: 'no' } }, { status: 500 }),
      ),
    );
    await expect(useSessionsStore.getState().delete('A')).rejects.toThrow();
    expect(useSessionsStore.getState().sessions).toHaveLength(1);
    expect(useSessionsStore.getState().error).toBeTruthy();
  });
});

describe('useSessionsStore.touchUpdatedAt + setLocalTitle', () => {
  it('touchUpdatedAt bumps the session to the top', () => {
    useSessionsStore.setState({
      sessions: [
        { id: 'A', title: 'a', createdAt: 1, updatedAt: 1 },
        { id: 'B', title: 'b', createdAt: 1, updatedAt: 100 },
      ],
      activeSessionId: 'A', hydrated: true,
    });
    useSessionsStore.getState().touchUpdatedAt('A', 200);
    expect(useSessionsStore.getState().sessions[0].id).toBe('A');
  });

  it('setLocalTitle updates only the title locally', () => {
    useSessionsStore.setState({
      sessions: [{ id: 'A', title: '', createdAt: 1, updatedAt: 1 }],
      activeSessionId: 'A', hydrated: true,
    });
    useSessionsStore.getState().setLocalTitle('A', 'computed');
    expect(useSessionsStore.getState().sessions[0].title).toBe('computed');
  });
});

describe('useSessionsStore.clearError', () => {
  it('resets error to null', () => {
    useSessionsStore.setState({ sessions: [], activeSessionId: null, hydrated: true, error: 'oops' });
    useSessionsStore.getState().clearError();
    expect(useSessionsStore.getState().error).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run src/stores/sessions.store.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Write the implementation**

`src/stores/sessions.store.ts`:
```ts
import { create } from 'zustand';
import { sessionsApi } from '@/src/lib/api/sessions.api';
import { historyApi } from '@/src/lib/api/history.api';
import { useChatStore } from '@/src/stores/chat.store';
import type { SessionMeta } from '@/src/types/session.types';

const STORAGE_KEY = 'aether.activeSessionId';

interface SessionsState {
  sessions: SessionMeta[];
  activeSessionId: string | null;
  hydrated: boolean;
  error: string | null;

  init: () => Promise<void>;
  create: () => Promise<SessionMeta>;
  rename: (id: string, title: string) => Promise<void>;
  delete: (id: string) => Promise<void>;
  setActive: (id: string) => void;
  setLocalTitle: (id: string, title: string) => void;
  touchUpdatedAt: (id: string, ts: number) => void;
  clearError: () => void;
  _reset: () => void;
}

const initial = {
  sessions: [] as SessionMeta[],
  activeSessionId: null as string | null,
  hydrated: false,
  error: null as string | null,
};

let hydrationToken = 0;

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : 'Operation failed';
}

function persistActive(id: string | null): void {
  try {
    if (id === null) localStorage.removeItem(STORAGE_KEY);
    else localStorage.setItem(STORAGE_KEY, id);
  } catch {
    // ignore localStorage failures
  }
}

function readStoredActive(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

function sortByUpdatedDesc(sessions: SessionMeta[]): SessionMeta[] {
  return [...sessions].sort((a, b) => b.updatedAt - a.updatedAt);
}

export const useSessionsStore = create<SessionsState>((set, get) => ({
  ...initial,
  _reset: () => set(initial),
  clearError: () => set({ error: null }),

  init: async () => {
    try {
      const list = await sessionsApi.list();
      const sessions = sortByUpdatedDesc(list);
      const stored = readStoredActive();
      let activeId: string | null;
      if (stored && sessions.some((s) => s.id === stored)) {
        activeId = stored;
      } else if (sessions.length > 0) {
        activeId = sessions[0].id;
      } else {
        const created = await sessionsApi.create();
        sessions.unshift(created);
        activeId = created.id;
      }
      persistActive(activeId);
      set({ sessions, activeSessionId: activeId, hydrated: true, error: null });
      // Hydrate chat for the chosen active session.
      const token = ++hydrationToken;
      historyApi
        .fetchById(activeId)
        .then((msgs) => {
          if (token === hydrationToken) useChatStore.getState().hydrate(msgs);
        })
        .catch(() => {
          if (token === hydrationToken) useChatStore.getState().hydrate([]);
        });
    } catch (e) {
      set({ sessions: [], activeSessionId: null, hydrated: true, error: errMsg(e) });
    }
  },

  create: async () => {
    try {
      const meta = await sessionsApi.create();
      set((s) => ({ sessions: [meta, ...s.sessions], error: null }));
      get().setActive(meta.id);
      return meta;
    } catch (e) {
      set({ error: errMsg(e) });
      throw e;
    }
  },

  rename: async (id, title) => {
    const prev = get().sessions;
    const optimistic = prev.map((s) => (s.id === id ? { ...s, title } : s));
    set({ sessions: optimistic, error: null });
    try {
      await sessionsApi.rename(id, title);
    } catch (e) {
      set({ sessions: prev, error: errMsg(e) });
      throw e;
    }
  },

  delete: async (id) => {
    try {
      await sessionsApi.delete(id);
    } catch (e) {
      set({ error: errMsg(e) });
      throw e;
    }
    const wasActive = get().activeSessionId === id;
    set((s) => ({ sessions: s.sessions.filter((x) => x.id !== id), error: null }));
    if (wasActive) {
      const remaining = get().sessions;
      if (remaining.length > 0) {
        get().setActive(remaining[0].id);
      } else {
        await get().create();
      }
    }
  },

  setActive: (id) => {
    if (useChatStore.getState().streamingId !== null) return;
    if (get().activeSessionId === id) return;
    persistActive(id);
    set({ activeSessionId: id });
    useChatStore.getState().reset();
    const token = ++hydrationToken;
    historyApi
      .fetchById(id)
      .then((msgs) => {
        if (token === hydrationToken) useChatStore.getState().hydrate(msgs);
      })
      .catch(() => {
        if (token === hydrationToken) useChatStore.getState().hydrate([]);
      });
  },

  setLocalTitle: (id, title) =>
    set((s) => ({
      sessions: s.sessions.map((x) => (x.id === id ? { ...x, title } : x)),
    })),

  touchUpdatedAt: (id, ts) =>
    set((s) => ({
      sessions: sortByUpdatedDesc(
        s.sessions.map((x) => (x.id === id ? { ...x, updatedAt: ts } : x)),
      ),
    })),
}));
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run src/stores/sessions.store.test.ts
```

Expected: PASS (15 tests).

- [ ] **Step 5: Commit**

```bash
git add src/stores/sessions.store.ts src/stores/sessions.store.test.ts
git commit -m "feat(slice-2b): add useSessionsStore (init/create/setActive with hydration token)"
```

---

### Task F2: useStreamingDispatch modify (sessionId + auto-title local)

**Files:**
- Modify: `src/hooks/useStreamingDispatch.ts`
- Modify: `src/hooks/useStreamingDispatch.test.ts`

- [ ] **Step 1: Update the test**

`src/hooks/useStreamingDispatch.test.ts`:
```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { server } from '@/src/test/msw-server';
import { useStreamingDispatch } from './useStreamingDispatch';
import { useChatStore } from '@/src/stores/chat.store';
import { useSessionsStore } from '@/src/stores/sessions.store';

function sseStream(...lines: string[]) {
  const enc = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(c) {
      for (const l of lines) c.enqueue(enc.encode(l));
      c.close();
    },
  });
}

const meta = (id: string, title = '') => ({ id, title, createdAt: 1, updatedAt: 1 });

beforeEach(() => {
  useChatStore.getState()._reset();
  useSessionsStore.getState()._reset();
  useSessionsStore.setState({ sessions: [meta('S1')], activeSessionId: 'S1', hydrated: true });
});

describe('useStreamingDispatch', () => {
  it('sends sessionId in dispatch body', async () => {
    let received: unknown;
    server.use(
      http.post('http://localhost/api/ai/dispatch', async ({ request }) => {
        received = await request.json();
        return new HttpResponse(
          sseStream(
            'event: text\ndata: {"chunk":"OK"}\n\n',
            'event: done\ndata: {"model":"fake-1","interrupted":false}\n\n',
          ),
          { headers: { 'Content-Type': 'text/event-stream' } },
        );
      }),
    );
    const { result } = renderHook(() => useStreamingDispatch());
    await act(async () => { await result.current.send('hi'); });
    expect(received).toMatchObject({ sessionId: 'S1', message: 'hi' });
  });

  it('auto-sets local title when active session has empty title', async () => {
    server.use(
      http.post('http://localhost/api/ai/dispatch', () =>
        new HttpResponse(
          sseStream('event: done\ndata: {"model":"f","interrupted":false}\n\n'),
          { headers: { 'Content-Type': 'text/event-stream' } },
        ),
      ),
    );
    const { result } = renderHook(() => useStreamingDispatch());
    await act(async () => { await result.current.send('hello first'); });
    expect(useSessionsStore.getState().sessions[0].title).toBe('hello first');
  });

  it('does not overwrite a non-empty title', async () => {
    useSessionsStore.setState({
      sessions: [meta('S1', 'existing title')],
      activeSessionId: 'S1', hydrated: true,
    });
    server.use(
      http.post('http://localhost/api/ai/dispatch', () =>
        new HttpResponse(
          sseStream('event: done\ndata: {"model":"f","interrupted":false}\n\n'),
          { headers: { 'Content-Type': 'text/event-stream' } },
        ),
      ),
    );
    const { result } = renderHook(() => useStreamingDispatch());
    await act(async () => { await result.current.send('new message'); });
    expect(useSessionsStore.getState().sessions[0].title).toBe('existing title');
  });

  it('touches updatedAt after stream completes', async () => {
    server.use(
      http.post('http://localhost/api/ai/dispatch', () =>
        new HttpResponse(
          sseStream(
            'event: text\ndata: {"chunk":"OK"}\n\n',
            'event: done\ndata: {"model":"f","interrupted":false}\n\n',
          ),
          { headers: { 'Content-Type': 'text/event-stream' } },
        ),
      ),
    );
    const before = useSessionsStore.getState().sessions[0].updatedAt;
    const { result } = renderHook(() => useStreamingDispatch());
    await act(async () => { await result.current.send('hi'); });
    const after = useSessionsStore.getState().sessions[0].updatedAt;
    expect(after).toBeGreaterThan(before);
  });

  it('no-op when activeSessionId is null', async () => {
    useSessionsStore.setState({ sessions: [], activeSessionId: null, hydrated: true });
    const { result } = renderHook(() => useStreamingDispatch());
    await act(async () => { await result.current.send('hi'); });
    expect(useChatStore.getState().messages).toEqual([]);
  });

  it('happy path: streams assistant + finalizes', async () => {
    server.use(
      http.post('http://localhost/api/ai/dispatch', () =>
        new HttpResponse(
          sseStream(
            'event: text\ndata: {"chunk":"Hello"}\n\n',
            'event: text\ndata: {"chunk":" world"}\n\n',
            'event: done\ndata: {"model":"fake-1","interrupted":false}\n\n',
          ),
          { headers: { 'Content-Type': 'text/event-stream' } },
        ),
      ),
    );
    const { result } = renderHook(() => useStreamingDispatch());
    await act(async () => { await result.current.send('hi'); });
    const msgs = useChatStore.getState().messages;
    expect(msgs[1].text).toBe('Hello world');
    expect(useChatStore.getState().streamingId).toBeNull();
  });

  it('isStreaming flips during send', async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => { release = r; });
    server.use(
      http.post('http://localhost/api/ai/dispatch', async () => {
        await gate;
        return new HttpResponse(
          sseStream('event: done\ndata: {"model":"f","interrupted":false}\n\n'),
          { headers: { 'Content-Type': 'text/event-stream' } },
        );
      }),
    );
    const { result } = renderHook(() => useStreamingDispatch());
    const p = act(async () => { await result.current.send('hi'); });
    await waitFor(() => { expect(result.current.isStreaming).toBe(true); });
    release();
    await p;
    expect(result.current.isStreaming).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run src/hooks/useStreamingDispatch.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Update the hook**

`src/hooks/useStreamingDispatch.ts`:
```ts
import { useCallback } from 'react';
import { useChatStore } from '@/src/stores/chat.store';
import { useSessionsStore } from '@/src/stores/sessions.store';
import { createStreamingDispatch } from '@/src/lib/api/dispatch.api';
import { computeTitle } from '@/src/lib/title';

interface TextData { chunk: string }
interface DoneData { model?: string; interrupted?: boolean }
interface ErrorData { message: string; retryable: boolean }

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : 'Unknown error';
}

export function useStreamingDispatch() {
  const isStreaming = useChatStore((s) => s.streamingId !== null);

  const send = useCallback(async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    const activeId = useSessionsStore.getState().activeSessionId;
    if (!activeId) {
      console.warn('[aether] no active session');
      return;
    }
    const chat = useChatStore.getState();
    if (chat.streamingId) return;

    // Local auto-title for instant UX feedback (server is the eventual source of truth).
    const active = useSessionsStore.getState().sessions.find((s) => s.id === activeId);
    if (active && !active.title) {
      useSessionsStore.getState().setLocalTitle(activeId, computeTitle(trimmed));
    }

    chat.appendUser(trimmed);
    const { id } = chat.startAssistant();
    const controller = new AbortController();
    chat.setAbortController(controller);

    try {
      for await (const ev of createStreamingDispatch({ sessionId: activeId, message: trimmed }, controller.signal)) {
        if (ev.event === 'text') {
          useChatStore.getState().appendChunk(id, (ev.data as TextData).chunk);
        } else if (ev.event === 'done') {
          const d = ev.data as DoneData;
          useChatStore.getState().finishAssistant(id, { model: d.model, interrupted: !!d.interrupted });
          return;
        } else if (ev.event === 'error') {
          const d = ev.data as ErrorData;
          useChatStore.getState().failAssistant(id, d.message, !!d.retryable);
          return;
        }
      }
      useChatStore.getState().finishAssistant(id, { interrupted: controller.signal.aborted });
    } catch (e) {
      if (controller.signal.aborted) {
        useChatStore.getState().finishAssistant(id, { interrupted: true });
      } else {
        useChatStore.getState().failAssistant(id, errMsg(e), true);
      }
    } finally {
      useSessionsStore.getState().touchUpdatedAt(activeId, Date.now());
    }
  }, []);

  const abort = useCallback(() => {
    useChatStore.getState().abort();
  }, []);

  return { send, abort, isStreaming };
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run src/hooks/useStreamingDispatch.test.ts
```

Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add src/hooks/useStreamingDispatch.ts src/hooks/useStreamingDispatch.test.ts
git commit -m "feat(slice-2b): useStreamingDispatch includes sessionId + local auto-title"
```

---

## Phase G — UI components

### Task G1: SessionsSection

**Files:**
- Create: `src/components/sidebar/SessionsSection.tsx`
- Create: `src/components/sidebar/SessionsSection.test.tsx`

- [ ] **Step 1: Write the failing test**

`src/components/sidebar/SessionsSection.test.tsx`:
```tsx
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SessionsSection } from './SessionsSection';
import { useSessionsStore } from '@/src/stores/sessions.store';
import { useChatStore } from '@/src/stores/chat.store';
import { DialogHost } from '@/src/components/layout/DialogHost';

const meta = (id: string, title = '', updatedAt = 0) => ({ id, title, createdAt: 0, updatedAt });

beforeEach(() => {
  useSessionsStore.getState()._reset();
  useChatStore.getState()._reset();
});

function renderWithDialog() {
  return render(
    <>
      <DialogHost />
      <SessionsSection />
    </>,
  );
}

describe('SessionsSection', () => {
  it('renders empty state-aware list', () => {
    useSessionsStore.setState({ sessions: [], activeSessionId: null, hydrated: true });
    renderWithDialog();
    expect(screen.getByText(/Sessions/i)).toBeInTheDocument();
    expect(screen.getByText('[0]')).toBeInTheDocument();
  });

  it('renders one row per session, highlights active', () => {
    useSessionsStore.setState({
      sessions: [meta('A', 'first', 1), meta('B', 'second', 2)],
      activeSessionId: 'B', hydrated: true,
    });
    renderWithDialog();
    expect(screen.getByText('first')).toBeInTheDocument();
    expect(screen.getByText('second')).toBeInTheDocument();
  });

  it('falls back to "Nuova sessione" when title is empty', () => {
    useSessionsStore.setState({
      sessions: [meta('A', '', 1)], activeSessionId: 'A', hydrated: true,
    });
    renderWithDialog();
    expect(screen.getByText('Nuova sessione')).toBeInTheDocument();
  });

  it('clicking a row calls setActive', async () => {
    useSessionsStore.setState({
      sessions: [meta('A', 'first', 1), meta('B', 'second', 2)],
      activeSessionId: 'B', hydrated: true,
    });
    const spy = vi.spyOn(useSessionsStore.getState(), 'setActive');
    renderWithDialog();
    await userEvent.click(screen.getByText('first'));
    expect(spy).toHaveBeenCalledWith('A');
  });

  it('clicking + New Session calls create()', async () => {
    useSessionsStore.setState({
      sessions: [meta('A', 'x', 1)], activeSessionId: 'A', hydrated: true,
    });
    const spy = vi
      .spyOn(useSessionsStore.getState(), 'create')
      .mockResolvedValue(meta('NEW'));
    renderWithDialog();
    await userEvent.click(screen.getByRole('button', { name: /new session/i }));
    expect(spy).toHaveBeenCalled();
  });

  it('disables rows + new button while streaming', () => {
    useSessionsStore.setState({
      sessions: [meta('A', 'x', 1)], activeSessionId: 'A', hydrated: true,
    });
    useChatStore.setState({ streamingId: 'STREAMING' });
    renderWithDialog();
    const newBtn = screen.getByRole('button', { name: /new session/i });
    expect(newBtn).toBeDisabled();
  });

  it('shows error pill when error is set; clearError dismisses it', async () => {
    useSessionsStore.setState({
      sessions: [], activeSessionId: null, hydrated: true, error: 'Boom',
    });
    renderWithDialog();
    expect(screen.getByText(/Boom/i)).toBeInTheDocument();
    const dismiss = screen.getByRole('button', { name: /dismiss error/i });
    await userEvent.click(dismiss);
    expect(useSessionsStore.getState().error).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run src/components/sidebar/SessionsSection.test.tsx
```

Expected: FAIL.

- [ ] **Step 3: Write the implementation**

`src/components/sidebar/SessionsSection.tsx`:
```tsx
import { useSessionsStore } from '@/src/stores/sessions.store';
import { useChatStore } from '@/src/stores/chat.store';
import { useDialog } from '@/src/hooks/useDialog';
import type { SessionMeta } from '@/src/types/session.types';
import { cn } from '@/src/lib/cn';

const FALLBACK_TITLE = 'Nuova sessione';

interface SessionRowProps {
  session: SessionMeta;
  active: boolean;
  disabled: boolean;
  onSelect: () => void;
  onRename: () => void;
  onDelete: () => void;
}

function SessionRow({ session, active, disabled, onSelect, onRename, onDelete }: SessionRowProps) {
  const label = session.title || FALLBACK_TITLE;
  return (
    <div
      className={cn(
        'group flex items-center justify-between p-1.5 rounded text-[10px] font-mono border transition-colors',
        active
          ? 'bg-accent/10 border-accent/40 text-accent'
          : 'bg-zinc-900 border-border-subtle text-zinc-400 hover:text-zinc-200',
        disabled && 'opacity-40 cursor-not-allowed',
      )}
    >
      <button
        type="button"
        onClick={disabled ? undefined : onSelect}
        disabled={disabled}
        className="flex-1 text-left truncate disabled:cursor-not-allowed"
      >
        {label}
      </button>
      <div className="hidden group-hover:flex gap-1">
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
    </div>
  );
}

export function SessionsSection() {
  const sessions = useSessionsStore((s) => s.sessions);
  const activeSessionId = useSessionsStore((s) => s.activeSessionId);
  const error = useSessionsStore((s) => s.error);
  const setActive = useSessionsStore((s) => s.setActive);
  const create = useSessionsStore((s) => s.create);
  const rename = useSessionsStore((s) => s.rename);
  const remove = useSessionsStore((s) => s.delete);
  const clearError = useSessionsStore((s) => s.clearError);
  const isStreaming = useChatStore((s) => s.streamingId !== null);
  const dialog = useDialog();

  const handleNew = async () => {
    await create().catch(() => {});
  };

  const handleRename = async (id: string, current: string) => {
    const next = await dialog.prompt({
      title: 'Rename session',
      label: 'Title',
      defaultValue: current,
      required: true,
    });
    if (next) await rename(id, next).catch(() => {});
  };

  const handleDelete = async (id: string, label: string) => {
    const ok = await dialog.confirm({
      title: 'Delete session',
      message: `Delete "${label}"?`,
      destructive: true,
    });
    if (ok) await remove(id).catch(() => {});
  };

  return (
    <section>
      <div className="flex items-center justify-between mb-2">
        <div className="mono-label">Sessions</div>
        <span className="text-[10px] text-zinc-600">[{sessions.length}]</span>
      </div>

      {error && (
        <div className="mb-2 p-1.5 rounded bg-status-error/10 border border-status-error/40 text-status-error text-[10px] flex items-center gap-2">
          <span className="flex-1">⚠ {error}</span>
          <button
            type="button"
            aria-label="Dismiss error"
            onClick={clearError}
            className="hover:text-white"
          >
            ×
          </button>
        </div>
      )}

      <div className="space-y-1">
        {sessions.map((s) => (
          <SessionRow
            key={s.id}
            session={s}
            active={s.id === activeSessionId}
            disabled={isStreaming}
            onSelect={() => setActive(s.id)}
            onRename={() => handleRename(s.id, s.title || FALLBACK_TITLE)}
            onDelete={() => handleDelete(s.id, s.title || FALLBACK_TITLE)}
          />
        ))}
        <button
          onClick={handleNew}
          aria-label="New session"
          disabled={isStreaming}
          className="w-full p-1 border border-dashed border-border-subtle rounded text-[10px] text-zinc-600 hover:text-zinc-400 transition-colors mt-2 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          + New Session
        </button>
      </div>
    </section>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run src/components/sidebar/SessionsSection.test.tsx
```

Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add src/components/sidebar/SessionsSection.tsx src/components/sidebar/SessionsSection.test.tsx
git commit -m "feat(slice-2b): add SessionsSection with rename/delete dialogs"
```

---

### Task G2: ChatView guard for activeSessionId

**Files:**
- Modify: `src/components/chat/ChatView.tsx`
- Modify: `src/components/chat/ChatView.test.tsx`

- [ ] **Step 1: Update the test**

Append to `src/components/chat/ChatView.test.tsx` (inside the existing `describe('ChatView', ...)` block):

```tsx
import { useSessionsStore } from '@/src/stores/sessions.store';

// In beforeEach, also reset sessionsStore:
beforeEach(() => {
  useChatStore.getState()._reset();
  useSessionsStore.getState()._reset();
  useSessionsStore.setState({
    sessions: [{ id: 'S1', title: '', createdAt: 0, updatedAt: 0 }],
    activeSessionId: 'S1',
    hydrated: true,
  });
});

// New test inside describe:
it('shows fallback message when no active session', () => {
  useSessionsStore.setState({ sessions: [], activeSessionId: null, hydrated: true });
  render(<ChatView />);
  expect(screen.getByText(/Nessuna sessione attiva/i)).toBeInTheDocument();
});
```

Reorganize the existing test file so the `beforeEach` properly resets sessionsStore. Easiest: rewrite the whole file.

Full new content of `src/components/chat/ChatView.test.tsx`:
```tsx
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { server } from '@/src/test/msw-server';
import { ChatView } from './ChatView';
import { useChatStore } from '@/src/stores/chat.store';
import { useSessionsStore } from '@/src/stores/sessions.store';

beforeEach(() => {
  useChatStore.getState()._reset();
  useSessionsStore.getState()._reset();
  useSessionsStore.setState({
    sessions: [{ id: 'S1', title: '', createdAt: 0, updatedAt: 0 }],
    activeSessionId: 'S1',
    hydrated: true,
  });
});

function sse(...lines: string[]) {
  const enc = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(c) {
      for (const l of lines) c.enqueue(enc.encode(l));
      c.close();
    },
  });
}

describe('ChatView', () => {
  it('happy path: send a message and receive streamed reply', async () => {
    server.use(
      http.post('http://localhost/api/ai/dispatch', () =>
        new HttpResponse(
          sse(
            'event: text\ndata: {"chunk":"Hello"}\n\n',
            'event: text\ndata: {"chunk":" Aether"}\n\n',
            'event: done\ndata: {"model":"fake-1","interrupted":false}\n\n',
          ),
          { headers: { 'Content-Type': 'text/event-stream' } },
        ),
      ),
    );
    render(<ChatView />);
    await userEvent.type(screen.getByRole('textbox'), 'hi{Enter}');
    await waitFor(() => {
      expect(screen.getByText(/Hello Aether/)).toBeInTheDocument();
    });
    expect(screen.getByText('hi')).toBeInTheDocument();
  });

  it('Retry resends the last user message', async () => {
    server.use(
      http.post('http://localhost/api/ai/dispatch', () =>
        new HttpResponse(
          sse('event: error\ndata: {"message":"Network","retryable":true}\n\n'),
          { headers: { 'Content-Type': 'text/event-stream' } },
        ),
      ),
    );
    render(<ChatView />);
    await userEvent.type(screen.getByRole('textbox'), 'first{Enter}');
    const retryBtn = await screen.findByRole('button', { name: /retry/i });
    server.use(
      http.post('http://localhost/api/ai/dispatch', () =>
        new HttpResponse(
          sse(
            'event: text\ndata: {"chunk":"OK"}\n\n',
            'event: done\ndata: {"model":"f","interrupted":false}\n\n',
          ),
          { headers: { 'Content-Type': 'text/event-stream' } },
        ),
      ),
    );
    await userEvent.click(retryBtn);
    await waitFor(() => {
      expect(screen.getByText('OK')).toBeInTheDocument();
    });
  });

  it('shows fallback message when no active session', () => {
    useSessionsStore.setState({ sessions: [], activeSessionId: null, hydrated: true });
    render(<ChatView />);
    expect(screen.getByText(/Nessuna sessione attiva/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails (3rd test fails for now)**

```bash
npx vitest run src/components/chat/ChatView.test.tsx
```

Expected: FAIL on the 3rd test.

- [ ] **Step 3: Update ChatView**

`src/components/chat/ChatView.tsx`:
```tsx
import { useCallback } from 'react';
import { useStreamingDispatch } from '@/src/hooks/useStreamingDispatch';
import { useChatStore } from '@/src/stores/chat.store';
import { useSessionsStore } from '@/src/stores/sessions.store';
import { MessageList } from './MessageList';
import { MessageInput } from './MessageInput';

export function ChatView() {
  const { send, abort, isStreaming } = useStreamingDispatch();
  const activeSessionId = useSessionsStore((s) => s.activeSessionId);

  const handleRetry = useCallback(
    async (failedId: string) => {
      const state = useChatStore.getState();
      const idx = state.messages.findIndex((m) => m.id === failedId);
      if (idx < 1) return;
      const prev = state.messages[idx - 1];
      if (prev.role !== 'user') return;
      useChatStore.setState((s) => ({
        messages: s.messages.filter((m) => m.id !== failedId),
      }));
      await send(prev.text);
    },
    [send],
  );

  if (!activeSessionId) {
    return (
      <div className="flex-1 flex items-center justify-center text-zinc-500 text-sm p-4 text-center">
        Nessuna sessione attiva. Crea una nuova sessione dalla sidebar.
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <MessageList onRetry={handleRetry} />
      <MessageInput onSend={send} onStop={abort} isStreaming={isStreaming} />
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run src/components/chat/ChatView.test.tsx
```

Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/components/chat/ChatView.tsx src/components/chat/ChatView.test.tsx
git commit -m "feat(slice-2b): ChatView shows fallback when no active session"
```

---

### Task G3: App.tsx wire sessions

**Files:**
- Modify: `src/App.tsx`
- Modify: `src/App.test.tsx`

- [ ] **Step 1: Update App.tsx**

`src/App.tsx`:
```tsx
import { useEffect, useState } from 'react';
import { AppShell } from '@/src/components/layout/AppShell';
import { TopBar } from '@/src/components/layout/TopBar';
import { Sidebar } from '@/src/components/layout/Sidebar';
import { DialogHost } from '@/src/components/layout/DialogHost';
import { SessionsSection } from '@/src/components/sidebar/SessionsSection';
import { SystemProtocolSection } from '@/src/components/sidebar/SystemProtocolSection';
import { SkillsSection } from '@/src/components/sidebar/SkillsSection';
import { ToolsSection } from '@/src/components/sidebar/ToolsSection';
import { McpServersSection } from '@/src/components/sidebar/McpServersSection';
import { ConnectionFooter } from '@/src/components/sidebar/ConnectionFooter';
import { ChatView } from '@/src/components/chat/ChatView';
import { useContextStore } from '@/src/stores/context.store';
import { useSessionsStore } from '@/src/stores/sessions.store';

export default function App() {
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const initContext = useContextStore((s) => s.init);
  const initSessions = useSessionsStore((s) => s.init);

  useEffect(() => {
    initContext();
    initSessions();
  }, [initContext, initSessions]);

  return (
    <>
      <DialogHost />
      <AppShell
        sidebarOpen={sidebarOpen}
        sidebar={
          <Sidebar
            header={
              <span className="font-mono text-sm tracking-tight text-white font-bold">
                AETHER_CORE
              </span>
            }
            footer={<ConnectionFooter />}
          >
            <SessionsSection />
            <SystemProtocolSection />
            <SkillsSection />
            <ToolsSection />
            <McpServersSection />
          </Sidebar>
        }
      >
        <TopBar
          title="Aether Dev Studio"
          sidebarOpen={sidebarOpen}
          onToggleSidebar={() => setSidebarOpen((v) => !v)}
        />
        <ChatView />
      </AppShell>
    </>
  );
}
```

- [ ] **Step 2: Update App.test.tsx**

`src/App.test.tsx`:
```tsx
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import App from './App';
import { useChatStore } from '@/src/stores/chat.store';
import { useContextStore } from '@/src/stores/context.store';
import { useSessionsStore } from '@/src/stores/sessions.store';

beforeEach(() => {
  useChatStore.getState()._reset();
  useContextStore.getState()._reset();
  useSessionsStore.getState()._reset();
  localStorage.clear();
});

describe('App', () => {
  it('renders sidebar with SessionsSection, ChatView present after init', async () => {
    render(<App />);
    expect(screen.getByText('AETHER_CORE')).toBeInTheDocument();
    expect(screen.getByText(/Sessions/i)).toBeInTheDocument();
    await waitFor(() => {
      // Default MSW handlers create one session via POST → input visible
      expect(screen.getByPlaceholderText(/Scrivi un messaggio/i)).toBeInTheDocument();
    });
  });
});
```

- [ ] **Step 3: Run test to verify it passes**

```bash
npx vitest run src/App.test.tsx
```

Expected: PASS (1 test).

- [ ] **Step 4: Run full frontend suite for regression check**

```bash
npx vitest run src
```

Expected: ALL PASS.

- [ ] **Step 5: Run full backend suite**

```bash
npx vitest run server
```

Expected: ALL PASS.

- [ ] **Step 6: Lint**

```bash
npm run lint
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/App.tsx src/App.test.tsx
git commit -m "feat(slice-2b): wire SessionsSection + sessions init in App.tsx"
```

---

## Phase H — E2E

### Task H1: AETHER_DATA_DIR scratch + new E2E tests

**Files:**
- Modify: `playwright.config.ts`
- Modify: `e2e/smoke.spec.ts`

- [ ] **Step 1: Update playwright config**

`playwright.config.ts`:
```ts
import { defineConfig, devices } from '@playwright/test';
import path from 'node:path';
import os from 'node:os';

// Scratch data dir, unique per run, isolates from the developer's data/sessions.json
const E2E_DATA_DIR = path.join(os.tmpdir(), `aether-e2e-${Date.now()}`);

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: 'http://localhost:3000',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:3000',
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
    env: {
      AETHER_FAKE_PROVIDER: '1',
      AETHER_DATA_DIR: E2E_DATA_DIR,
    },
  },
});
```

- [ ] **Step 2: Rewrite the smoke spec**

`e2e/smoke.spec.ts`:
```ts
import { test, expect } from '@playwright/test';

test('app shell loads with new sidebar', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByText('AETHER_CORE')).toBeVisible();
  await expect(page.getByText('Sessions')).toBeVisible();
  await expect(page.getByText('System Protocol')).toBeVisible();
  await expect(page.getByRole('main')).toBeVisible();
});

test('toggle sidebar hides the panel', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByText('AETHER_CORE')).toBeVisible();
  await page.getByRole('button', { name: /toggle sidebar/i }).click();
  await expect(page.getByText('AETHER_CORE')).not.toBeVisible();
});

test('chat: send message and receive FakeProvider reply', async ({ page }) => {
  await page.goto('/');
  const input = page.getByPlaceholder(/Scrivi un messaggio/i);
  await input.fill('ping');
  await input.press('Enter');
  // user bubble visible (scoped to the chat area to avoid sidebar collisions)
  await expect(page.getByText('pong')).toBeVisible({ timeout: 5000 });
  await expect(page.getByRole('button', { name: /send/i })).toBeVisible({ timeout: 5000 });
});

test('chat: creating a second session shows it as active', async ({ page }) => {
  await page.goto('/');
  // First session: send "first"
  const input = page.getByPlaceholder(/Scrivi un messaggio/i);
  await input.fill('first');
  await input.press('Enter');
  await expect(page.getByText('pong').first()).toBeVisible({ timeout: 5000 });

  // Open a new session
  await page.getByRole('button', { name: /new session/i }).click();
  // Wait for the chat area to clear (new session has no messages)
  await expect(input).toBeEnabled();

  // Send "second"
  await input.fill('second');
  await input.press('Enter');
  await expect(page.getByText('pong').first()).toBeVisible({ timeout: 5000 });

  // SessionsSection should now show two sessions
  await expect(page.getByText('first')).toBeVisible();
  await expect(page.getByText('second')).toBeVisible();
});

test('chat: delete a session removes it from the list', async ({ page }) => {
  await page.goto('/');
  const input = page.getByPlaceholder(/Scrivi un messaggio/i);
  await input.fill('to-delete');
  await input.press('Enter');
  await expect(page.getByText('pong').first()).toBeVisible({ timeout: 5000 });

  // Hover the row to reveal action buttons
  const row = page.getByText('to-delete');
  await row.hover();
  await page.getByRole('button', { name: /delete to-delete/i }).click();

  // Confirm dialog
  await page.getByRole('button', { name: /confirm|delete|ok/i }).click();

  // Row gone
  await expect(page.getByText('to-delete')).toHaveCount(0);
});
```

- [ ] **Step 3: Run Playwright**

```bash
npx playwright test
```

Expected: PASS (5 tests).

If the test "delete a session" fails due to ambiguity in the confirm-dialog button name, inspect the ConfirmDialog component (slice 0) to identify the actual button label. Adjust the selector accordingly. If multiple buttons match `/confirm|delete|ok/i`, scope to the dialog: `page.getByRole('dialog').getByRole('button', { name: /confirm|delete/i })`.

- [ ] **Step 4: Commit**

```bash
git add e2e/smoke.spec.ts playwright.config.ts
git commit -m "test(slice-2b): playwright multi-session + delete + AETHER_DATA_DIR scratch"
```

---

## Phase I — Final verification + PR

### Task I1: Verify all green + push + PR

- [ ] **Step 1: Lint**

```bash
npm run lint
```

Expected: PASS.

- [ ] **Step 2: Vitest full**

```bash
npm run test:run
```

Expected: ALL PASS. Report file + test count.

- [ ] **Step 3: Coverage**

```bash
npm run test:coverage
```

Expected: PASS, all 80% thresholds met. If any threshold fails, identify which folder/file and add targeted tests, similar to the slice 2a final-fix pass. Common offenders to watch:
- `src/stores/sessions.store.ts` error branches (init failure, delete failure, etc.)
- `server/domain/history/history.store.ts` rename validation paths
- `src/lib/api/sessions.api.ts` error paths

- [ ] **Step 4: Playwright**

```bash
npx playwright test
```

Expected: PASS.

- [ ] **Step 5: Show commit summary**

```bash
git log main..HEAD --oneline
```

- [ ] **Step 6: Push**

```bash
git push -u origin feat/slice-2b-multi-session
```

- [ ] **Step 7: Open PR**

```bash
gh pr create --title "feat(slice-2b): multi-session chat" --body "$(cat <<'EOF'
## Summary

Slice 2b aggiunge sessioni multiple alla chat di Slice 2a:
- **Backend** — `HistoryStore` parametrizzata per `sessionId`, schema V2 `{[id]: {title, createdAt, messages}}`, CRUD routes `/api/sessions[/:id]` (GET list, POST create, GET/PATCH/DELETE per id).
- **Migrazione one-shot** — `migrateLegacyDefault` idempotente trasforma la chiave legacy `'default'` di Slice 2a in una sessione con UUID + auto-title dal primo messaggio user, preservando le altre eventuali sessioni V2 già presenti.
- **Dispatch** — `POST /api/ai/dispatch` body include `sessionId` obbligatorio; service emette `'Session not found'` (retryable=false) se l'id non esiste.
- **Frontend** — Nuovo `useSessionsStore` (Zustand) con `init`, `create`, `setActive` (con hydration token contro fetch obsoleti), `rename` ottimistico, `delete` con auto-switch / auto-create se ultima. `activeSessionId` persistito su localStorage.
- **UI** — `SessionsSection` in sidebar sopra alle altre sezioni: lista ordinata by updatedAt desc, highlight della attiva, hover ✎/×, "+ New Session". Disabilitato durante streamingId !== null.
- **Auto-title** — Server-side (dentro `HistoryStore.append`) + client-side (dentro `useStreamingDispatch.send`) usano la stessa funzione `computeTitle` (test verifica parità su input canonici).
- **Errori CRUD** — Mostrati inline via `useSessionsStore.error` + pill in `SessionsSection` (no toast system).

## Deviazioni dal plan (intenzionali)

- (Documentare qui qualunque deviazione emersa in implementazione.)

## Numeri attesi

- ~25 commit TDD su `feat/slice-2b-multi-session`
- Coverage: tutte le soglie 80% per folder rispettate
- Playwright: 5 test verdi (3 esistenti + 2 nuovi multi-session/delete)

## Out-of-scope

- Multi-tab activeSessionId sync (BroadcastChannel)
- Session search/filter/pinning/folders
- Concurrent streaming su più sessioni
- Title regenerate via AI

## Test plan

- [x] Backend unit (history.store, history.migrate, history.routes, dispatch.service)
- [x] Frontend unit (sessions.store, sessions.api, history.api fetchById, useStreamingDispatch)
- [x] Integration ChatView + App (con MSW)
- [x] Playwright multi-session/delete con `AETHER_DATA_DIR` scratch
- [x] Manual: refresh preserva sessione attiva via localStorage
- [x] Manual: migrazione 2a→2b al primo boot (testa con `data/sessions.json` legacy)

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

Expected: PR URL printed.

---

## Riepilogo task → commit

| # | Task | Commit message prefix |
|---|---|---|
| A1 | Branch | (no commit) |
| A2 | computeTitle utility | `feat(slice-2b): add computeTitle utility...` |
| B1+B2 | V2 types + schema | `feat(slice-2b): V2 history types + schema...` |
| B3 | Migration | `feat(slice-2b): add migrateLegacyDefault...` |
| C1 | HistoryStore rewrite | `feat(slice-2b): rewrite HistoryStore...` |
| D1 | history.routes CRUD | `feat(slice-2b): rewrite history.routes...` |
| D2 | dispatch.service sessionId | `feat(slice-2b): dispatch.service accepts sessionId...` |
| D3 | dispatch.routes test update | `test(slice-2b): update dispatch.routes test...` |
| E1 | session.types | `feat(slice-2b): re-export SessionMeta...` |
| E2 | sessions.api + MSW | `feat(slice-2b): add sessionsApi client + MSW handlers` |
| E3 | history.api rewrite | `feat(slice-2b): historyApi.fetchById...` |
| E4 | dispatch.api sessionId | `feat(slice-2b): dispatch.api body includes sessionId` |
| F1 | sessions.store | `feat(slice-2b): add useSessionsStore...` |
| F2 | useStreamingDispatch update | `feat(slice-2b): useStreamingDispatch includes sessionId...` |
| G1 | SessionsSection | `feat(slice-2b): add SessionsSection...` |
| G2 | ChatView guard | `feat(slice-2b): ChatView shows fallback...` |
| G3 | App.tsx wire | `feat(slice-2b): wire SessionsSection + sessions init...` |
| H1 | Playwright | `test(slice-2b): playwright multi-session + delete...` |
| I1 | PR | (no commit) |

Totale: ~18 commit di feature + eventuali fix-up coverage in I1.

---

## Note operative

- **Mid-refactor red state**: dopo Task B2 il backend non compila (history.store ancora vecchio). Tasks B3 → C1 → D1 → D2 → D3 ripristinano il verde. NON tentare di lintare ogni commit individualmente; aspetta la fine di Phase D per la prima lint-clean.
- **`SessionsFileSchema`**: rifiuta esplicitamente la legacy V1 shape (array values). Per questo `HistoryStore.ensureMigrated()` bypassa il parser zod e legge il file raw via `node:fs/promises.readFile` + `JSON.parse` (vedi Task C1 Step 3). Se il parser di `JsonStore.read()` rejecta il file legacy, ritorna `{}` come default — e la migrate non vedrebbe mai i dati originali. Il bypass risolve questo, eseguendo la migrate sulla forma raw e riscrivendo via `json.write()`.

- **`vi.spyOn(useStore.getState(), 'method')`** funziona finché lo store espone l'action come property (Zustand lo fa). Per scrupolo, in `SessionsSection.test.tsx` Test "clicking + New Session", verifica che il `vi.spyOn(...).mockResolvedValue(...)` non infranga assertions di subsequent test (resetta in afterEach se serve).

- **`useShallow` in SessionsSection**: il componente subscribe a 4 valori dello store (sessions, activeSessionId, error, e azioni). Le azioni sono stabili. `sessions` è un array fresco ad ogni cambio — accettabile (la SessionsSection si re-renderizza intenzionalmente quando la lista cambia). NON serve `useShallow` qui a meno di osservare loop.

- **`localStorage.clear()` nei test**: il setup test di Slice 2a non lo fa. Lo aggiungiamo nei beforeEach per `sessions.store.test.ts` e `App.test.tsx`. NON modifichiamo il setup globale per non creare regressioni in slice 0/1.

- **AETHER_DATA_DIR univoco per run**: `path.join(os.tmpdir(), 'aether-e2e-' + Date.now())`. Con `reuseExistingServer: !process.env.CI`, in dev locale il primo Playwright run crea la dir, le run successive la riusano (timestamp identico nel cache). Se vuoi pulizia totale, killare il webServer prima di rilanciare. Per CI il timestamp è sempre fresh.
