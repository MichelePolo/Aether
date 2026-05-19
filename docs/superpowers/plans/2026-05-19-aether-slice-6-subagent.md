# Aether Slice 6 — Sub-agent Dispatch Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add named sub-agents stored server-side, invoked from chat via leading `@name`, with their own system-instruction overlay and skills/tools that union into the active context for that turn. Surface the persona in the reasoning trace via a new `resolve_subagent` step and a `subAgent` field on the dispatch step.

**Architecture:** Backend `SubAgentsStore` (`JsonStore`-backed) + 5 REST endpoints, two new pure modules (`subagent-parser` + `prompt-assembler`) wired into `dispatch.service`. Frontend: Zustand store, sidebar section for CRUD, mention autocomplete popover above `MessageInput`, badge in `ReasoningStepCard`. The leading `@name` token is stripped before reaching the model; the original message is preserved in chat history.

**Tech Stack:** Zustand 5, zod 4, MSW 2, Vitest 4.1.6, RTL, Playwright. `JsonStore` from slice 0. `useDialog` from slice 0. `Modal` + multiline `PromptDialog` from slice 0/5. Pattern collaudati da slice 1/2/3/4.

**Reference spec:** `docs/superpowers/specs/2026-05-19-aether-slice-6-subagent-design.md`

**Branch:** `feat/slice-6-subagent` (already checked out; spec already committed)

**Lavora con un solo branch dall'inizio alla fine; ogni Task termina con un commit verde su questo branch.**

---

## File structure (NEW unless marked MODIFY)

```
server/
  domain/subagents/
    subagents.types.ts                          # NEW
    subagents.schema.ts                         # NEW
    subagents.schema.test.ts                    # NEW
    subagents.store.ts                          # NEW
    subagents.store.test.ts                     # NEW
  domain/dispatch/
    subagent-parser.ts                          # NEW
    subagent-parser.test.ts                     # NEW
    prompt-assembler.ts                         # NEW
    prompt-assembler.test.ts                    # NEW
    dispatch.service.ts                         # MODIFY
    dispatch.service.test.ts                    # MODIFY (if present)
  domain/reasoning/
    reasoning.types.ts                          # MODIFY
    reasoning.schema.ts                         # MODIFY
    reasoning.tracer.ts                         # MODIFY
  routes/
    subagents.routes.ts                         # NEW
    subagents.routes.test.ts                    # NEW
    dispatch.routes.test.ts                     # MODIFY
  app.ts                                        # MODIFY
  index.ts                                      # MODIFY

src/
  types/
    subagent.types.ts                           # NEW
    reasoning.types.ts                          # MODIFY (if union duplicated)
  lib/api/
    subagents.api.ts                            # NEW
    subagents.api.test.ts                       # NEW
  stores/
    subagents.store.ts                          # NEW
    subagents.store.test.ts                     # NEW
  test/
    msw-handlers.ts                             # MODIFY
  hooks/
    useMentionAutocomplete.ts                   # NEW
    useMentionAutocomplete.test.ts              # NEW
  components/chat/
    MentionPopover.tsx                          # NEW
    MentionPopover.test.tsx                     # NEW
    MessageInput.tsx                            # MODIFY
    MessageInput.test.tsx                       # MODIFY
  components/sidebar/
    SubAgentsSection.tsx                        # NEW
    SubAgentsSection.test.tsx                   # NEW
  components/reasoning/
    ReasoningStepCard.tsx                       # MODIFY
    ReasoningStepCard.test.tsx                  # MODIFY
  App.tsx                                       # MODIFY
  App.test.tsx                                  # MODIFY
  integration/
    subagent.integration.test.tsx               # NEW

e2e/
  smoke.spec.ts                                 # MODIFY
```

---

## Phase A — Pre-flight

### Task A1: Verify branch and clean working tree

- [ ] **Step 1: Confirm branch + clean tree**

```bash
git rev-parse --abbrev-ref HEAD
git status --porcelain
```

Expected: branch is `feat/slice-6-subagent`; second command outputs nothing.

No commit in this task.

---

## Phase B — Reasoning tracer extension

### Task B1: `resolve_subagent` step type + tracer forwards `subAgent`

**Files:**
- Modify: `server/domain/reasoning/reasoning.types.ts`
- Modify: `server/domain/reasoning/reasoning.schema.ts`
- Modify: `server/domain/reasoning/reasoning.tracer.ts`
- Modify: `src/types/reasoning.types.ts` (FE mirror, only if it duplicates the union)

The existing `tracer.step({ run })` returns `{ content, tokens?, result }`. To populate `subAgent` on a step, we extend the return type to also accept `subAgent?: string` and the tracer forwards it to the emitted step.

- [ ] **Step 1: Extend `server/domain/reasoning/reasoning.types.ts`**

Replace the file contents with:

```ts
export type ReasoningStepType =
  | 'context_fetch'
  | 'mcp_query'
  | 'dispatch'
  | 'thinking'
  | 'validation'
  | 'logic'
  | 'resolve_subagent';

export interface ReasoningStep {
  id: string;
  type: ReasoningStepType;
  title: string;
  content: string;
  tokens?: number;
  durationMs?: number;
  subAgent?: string;
  timestamp: number;
}
```

- [ ] **Step 2: Update `server/domain/reasoning/reasoning.schema.ts`**

```ts
import { z } from 'zod';

export const ReasoningStepTypeSchema = z.enum([
  'context_fetch',
  'mcp_query',
  'dispatch',
  'thinking',
  'validation',
  'logic',
  'resolve_subagent',
]);

export const ReasoningStepSchema = z.object({
  id: z.string(),
  type: ReasoningStepTypeSchema,
  title: z.string(),
  content: z.string(),
  tokens: z.number().optional(),
  durationMs: z.number().optional(),
  subAgent: z.string().optional(),
  timestamp: z.number(),
});
```

- [ ] **Step 3: Update `server/domain/reasoning/reasoning.tracer.ts`**

```ts
import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import type { SseEmitter } from '@/server/lib/sse';
import type { ReasoningStep, ReasoningStepType } from './reasoning.types';

export interface TracerStepOpts<T> {
  type: ReasoningStepType;
  title: string;
  run: () => Promise<{ content: string; tokens?: number; subAgent?: string; result: T }>;
}

export class ReasoningTracer {
  private readonly steps: ReasoningStep[] = [];

  constructor(private readonly sse: SseEmitter) {}

  async step<T>(opts: TracerStepOpts<T>): Promise<T> {
    const t0 = performance.now();
    const { content, tokens, subAgent, result } = await opts.run();
    const t1 = performance.now();
    const step: ReasoningStep = {
      id: randomUUID(),
      type: opts.type,
      title: opts.title,
      content,
      tokens,
      subAgent,
      durationMs: Math.round(t1 - t0),
      timestamp: Date.now(),
    };
    this.steps.push(step);
    this.sse.event('reasoning_step', step);
    return result;
  }

  pushExternal(partial: Omit<ReasoningStep, 'id' | 'timestamp'>): void {
    const step: ReasoningStep = {
      id: randomUUID(),
      timestamp: Date.now(),
      ...partial,
    };
    this.steps.push(step);
    this.sse.event('reasoning_step', step);
  }

  finalSteps(): ReasoningStep[] {
    return [...this.steps];
  }
}
```

- [ ] **Step 4: Mirror the type union in `src/types/reasoning.types.ts` if duplicated**

Run `grep -n "ReasoningStepType" src/types/reasoning.types.ts`. If it re-exports from `@/server/...`, skip. If it duplicates the union, add `'resolve_subagent'` to it.

- [ ] **Step 5: Run server reasoning tests**

```bash
npx vitest run server/domain/reasoning
```

Expected: PASS (the new field is optional; existing tests unchanged).

- [ ] **Step 6: Lint + commit**

```bash
npm run lint
git add server/domain/reasoning/reasoning.types.ts server/domain/reasoning/reasoning.schema.ts server/domain/reasoning/reasoning.tracer.ts src/types/reasoning.types.ts
git commit -m "feat(slice-6): reasoning +resolve_subagent type; tracer forwards subAgent"
```

---

## Phase C — Backend storage

### Task C1: `SubAgent` types + zod schemas

**Files:**
- Create: `server/domain/subagents/subagents.types.ts`
- Create: `server/domain/subagents/subagents.schema.ts`
- Create: `server/domain/subagents/subagents.schema.test.ts`

- [ ] **Step 1: Write failing schema tests**

```ts
// server/domain/subagents/subagents.schema.test.ts
import { describe, it, expect } from 'vitest';
import { SubAgentNameSchema, SubAgentRecordSchema, SubAgentCreateInputSchema } from './subagents.schema';

describe('SubAgentNameSchema', () => {
  it.each([
    'designer',
    'd',
    'Designer',
    'design-3r',
    'design_er',
    'A1B2',
    'a'.repeat(64),
  ])('accepts %s', (name) => {
    expect(SubAgentNameSchema.safeParse(name).success).toBe(true);
  });

  it.each([
    '',
    ' designer',
    '1designer',
    '-designer',
    'design er',
    'design@er',
    'a'.repeat(65),
  ])('rejects %s', (name) => {
    expect(SubAgentNameSchema.safeParse(name).success).toBe(false);
  });
});

describe('SubAgentRecordSchema', () => {
  const valid = {
    name: 'designer',
    systemInstruction: 'You design.',
    skills: ['layout', 'color'],
    tools: [{ id: 't1', name: 'figma', version: '1.0.0', status: 'online' as const }],
    createdAt: 1,
    updatedAt: 2,
  };

  it('accepts a valid record', () => {
    expect(SubAgentRecordSchema.safeParse(valid).success).toBe(true);
  });

  it('rejects when systemInstruction is over 8000 chars', () => {
    expect(
      SubAgentRecordSchema.safeParse({ ...valid, systemInstruction: 'x'.repeat(8001) }).success,
    ).toBe(false);
  });
});

describe('SubAgentCreateInputSchema', () => {
  it('applies defaults for optional fields', () => {
    const parsed = SubAgentCreateInputSchema.parse({ name: 'designer' });
    expect(parsed).toEqual({
      name: 'designer',
      systemInstruction: '',
      skills: [],
      tools: [],
    });
  });
});
```

- [ ] **Step 2: Run, expect FAIL**

```bash
npx vitest run server/domain/subagents/subagents.schema.test.ts
```

- [ ] **Step 3: Implement `server/domain/subagents/subagents.types.ts`**

```ts
import type { Tool } from '@/server/domain/context/context.types';

export interface SubAgentRecord {
  name: string;
  systemInstruction: string;
  skills: string[];
  tools: Tool[];
  createdAt: number;
  updatedAt: number;
}

export interface SubAgentMeta {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
}

export type SubAgentsFile = Record<string, SubAgentRecord>;
```

- [ ] **Step 4: Implement `server/domain/subagents/subagents.schema.ts`**

```ts
import { z } from 'zod';
import { ToolSchema } from '@/server/domain/context/context.schema';

export const SubAgentNameSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[A-Za-z][A-Za-z0-9_-]*$/);

export const SubAgentRecordSchema = z.object({
  name: SubAgentNameSchema,
  systemInstruction: z.string().max(8000),
  skills: z.array(z.string()).max(50),
  tools: z.array(ToolSchema).max(50),
  createdAt: z.number(),
  updatedAt: z.number(),
});

export const SubAgentsFileSchema = z.record(z.string(), SubAgentRecordSchema);

export const SubAgentCreateInputSchema = z.object({
  name: SubAgentNameSchema,
  systemInstruction: z.string().max(8000).default(''),
  skills: z.array(z.string()).max(50).default([]),
  tools: z.array(ToolSchema).max(50).default([]),
});

export const SubAgentUpdateInputSchema = SubAgentCreateInputSchema.partial();
```

- [ ] **Step 5: Run, expect PASS**

```bash
npx vitest run server/domain/subagents/subagents.schema.test.ts
```

- [ ] **Step 6: Lint + commit**

```bash
npm run lint
git add server/domain/subagents/
git commit -m "feat(slice-6): add SubAgent types + zod schemas"
```

---

### Task C2: `SubAgentsStore` CRUD with name-collision suffixing

**Files:**
- Create: `server/domain/subagents/subagents.store.ts`
- Create: `server/domain/subagents/subagents.store.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
// server/domain/subagents/subagents.store.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { SubAgentsStore } from './subagents.store';

function newStore(): SubAgentsStore {
  const dir = mkdtempSync(path.join(tmpdir(), 'aether-sa-'));
  return new SubAgentsStore(path.join(dir, 'subagents.json'));
}

describe('SubAgentsStore', () => {
  let store: SubAgentsStore;
  beforeEach(() => {
    store = newStore();
  });

  it('list returns empty initially', async () => {
    expect(await store.list()).toEqual([]);
  });

  it('create + read round-trip', async () => {
    const meta = await store.create({ name: 'designer', systemInstruction: 'You design.' });
    expect(meta.name).toBe('designer');
    expect(meta.id).toBeTruthy();
    const rec = await store.read(meta.id);
    expect(rec).not.toBeNull();
    expect(rec!.name).toBe('designer');
    expect(rec!.systemInstruction).toBe('You design.');
    expect(rec!.skills).toEqual([]);
    expect(rec!.tools).toEqual([]);
  });

  it('create with colliding name suffixes (2)', async () => {
    await store.create({ name: 'designer' });
    const second = await store.create({ name: 'designer' });
    expect(second.name).toBe('designer (2)');
  });

  it('update changes value and bumps updatedAt', async () => {
    const created = await store.create({ name: 'd' });
    const before = (await store.read(created.id))!.updatedAt;
    await new Promise((r) => setTimeout(r, 10));
    await store.update(created.id, { systemInstruction: 'new' });
    const after = (await store.read(created.id))!.updatedAt;
    expect(after).toBeGreaterThan(before);
    expect((await store.read(created.id))!.systemInstruction).toBe('new');
  });

  it('delete removes the record', async () => {
    const meta = await store.create({ name: 'd' });
    await store.delete(meta.id);
    expect(await store.read(meta.id)).toBeNull();
  });

  it('list sorts by updatedAt desc', async () => {
    const a = await store.create({ name: 'a' });
    await new Promise((r) => setTimeout(r, 5));
    const b = await store.create({ name: 'b' });
    const list = await store.list();
    expect(list[0].id).toBe(b.id);
    expect(list[1].id).toBe(a.id);
  });
});
```

- [ ] **Step 2: Run, expect FAIL**

```bash
npx vitest run server/domain/subagents/subagents.store.test.ts
```

- [ ] **Step 3: Implement `server/domain/subagents/subagents.store.ts`**

```ts
import { randomUUID } from 'node:crypto';
import { JsonStore } from '@/server/lib/json-store';
import { NotFoundError } from '@/server/lib/errors';
import { SubAgentsFileSchema } from './subagents.schema';
import type {
  SubAgentMeta,
  SubAgentRecord,
  SubAgentsFile,
} from './subagents.types';
import type { Tool } from '@/server/domain/context/context.types';

interface CreateInput {
  name: string;
  systemInstruction?: string;
  skills?: string[];
  tools?: Tool[];
}

function findUniqueName(file: SubAgentsFile, desired: string): string {
  const existing = new Set(Object.values(file).map((r) => r.name));
  if (!existing.has(desired)) return desired;
  let n = 2;
  while (existing.has(`${desired} (${n})`)) n++;
  return `${desired} (${n})`;
}

export class SubAgentsStore {
  private json: JsonStore<SubAgentsFile>;

  constructor(filePath: string) {
    this.json = new JsonStore<SubAgentsFile>(filePath, SubAgentsFileSchema, {});
  }

  async list(): Promise<SubAgentMeta[]> {
    const file = await this.json.read();
    const metas: SubAgentMeta[] = Object.entries(file).map(([id, rec]) => ({
      id,
      name: rec.name,
      createdAt: rec.createdAt,
      updatedAt: rec.updatedAt,
    }));
    metas.sort((a, b) => b.updatedAt - a.updatedAt);
    return metas;
  }

  async read(id: string): Promise<SubAgentRecord | null> {
    const file = await this.json.read();
    return file[id] ?? null;
  }

  async create(input: CreateInput): Promise<SubAgentMeta> {
    const id = randomUUID();
    const now = Date.now();
    const updated = await this.json.update((cur) => {
      const uniqueName = findUniqueName(cur, input.name);
      const rec: SubAgentRecord = {
        name: uniqueName,
        systemInstruction: input.systemInstruction ?? '',
        skills: input.skills ?? [],
        tools: input.tools ?? [],
        createdAt: now,
        updatedAt: now,
      };
      return { ...cur, [id]: rec };
    });
    const rec = updated[id];
    return { id, name: rec.name, createdAt: rec.createdAt, updatedAt: rec.updatedAt };
  }

  async update(
    id: string,
    patch: Partial<Omit<SubAgentRecord, 'createdAt'>>,
  ): Promise<SubAgentMeta> {
    const updated = await this.json.update((cur) => {
      const r = cur[id];
      if (!r) throw new NotFoundError(`subagent ${id}`);
      const next: SubAgentRecord = {
        ...r,
        ...patch,
        createdAt: r.createdAt,
        updatedAt: Date.now(),
      };
      return { ...cur, [id]: next };
    });
    const rec = updated[id];
    return { id, name: rec.name, createdAt: rec.createdAt, updatedAt: rec.updatedAt };
  }

  async delete(id: string): Promise<void> {
    await this.json.update((cur) => {
      if (!cur[id]) throw new NotFoundError(`subagent ${id}`);
      const next: SubAgentsFile = { ...cur };
      delete next[id];
      return next;
    });
  }
}
```

- [ ] **Step 4: Run, expect PASS**

```bash
npx vitest run server/domain/subagents/subagents.store.test.ts
```

- [ ] **Step 5: Lint + commit**

```bash
npm run lint
git add server/domain/subagents/subagents.store.ts server/domain/subagents/subagents.store.test.ts
git commit -m "feat(slice-6): add SubAgentsStore (CRUD + name collision suffix)"
```

---

### Task C3: `/api/subagents` routes

**Files:**
- Create: `server/routes/subagents.routes.ts`
- Create: `server/routes/subagents.routes.test.ts`

- [ ] **Step 1: Write failing route tests**

```ts
// server/routes/subagents.routes.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import request from 'supertest';
import { createApp } from '@/server/app';
import { SubAgentsStore } from '@/server/domain/subagents/subagents.store';

function makeApp() {
  const dir = mkdtempSync(path.join(tmpdir(), 'aether-sa-routes-'));
  const subAgentsStore = new SubAgentsStore(path.join(dir, 'subagents.json'));
  return createApp({ subAgentsStore });
}

describe('subagents routes', () => {
  let app: ReturnType<typeof makeApp>;
  beforeEach(() => {
    app = makeApp();
  });

  it('GET /api/subagents returns empty list initially', async () => {
    const res = await request(app).get('/api/subagents');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ subAgents: [] });
  });

  it('POST creates with default fields', async () => {
    const res = await request(app)
      .post('/api/subagents')
      .send({ name: 'designer' });
    expect(res.status).toBe(201);
    expect(res.body.name).toBe('designer');
    expect(res.body.id).toBeTruthy();
  });

  it('POST with colliding name returns suffixed name', async () => {
    await request(app).post('/api/subagents').send({ name: 'designer' });
    const second = await request(app).post('/api/subagents').send({ name: 'designer' });
    expect(second.status).toBe(201);
    expect(second.body.name).toBe('designer (2)');
  });

  it('GET /:id returns full record', async () => {
    const created = await request(app)
      .post('/api/subagents')
      .send({ name: 'designer', systemInstruction: 'You design.' });
    const res = await request(app).get(`/api/subagents/${created.body.id}`);
    expect(res.status).toBe(200);
    expect(res.body.name).toBe('designer');
    expect(res.body.systemInstruction).toBe('You design.');
  });

  it('GET /:id 404 on unknown id', async () => {
    const res = await request(app).get('/api/subagents/does-not-exist');
    expect(res.status).toBe(404);
  });

  it('PUT updates fields', async () => {
    const created = await request(app)
      .post('/api/subagents')
      .send({ name: 'designer' });
    const res = await request(app)
      .put(`/api/subagents/${created.body.id}`)
      .send({ name: 'designer', systemInstruction: 'New.', skills: ['a'], tools: [] });
    expect(res.status).toBe(200);
    expect(res.body.name).toBe('designer');
  });

  it('PUT 400 on invalid body', async () => {
    const created = await request(app).post('/api/subagents').send({ name: 'designer' });
    const res = await request(app)
      .put(`/api/subagents/${created.body.id}`)
      .send({ name: '1invalid' });
    expect(res.status).toBe(400);
  });

  it('DELETE then GET 404', async () => {
    const created = await request(app).post('/api/subagents').send({ name: 'd' });
    const del = await request(app).delete(`/api/subagents/${created.body.id}`);
    expect(del.status).toBe(204);
    const get = await request(app).get(`/api/subagents/${created.body.id}`);
    expect(get.status).toBe(404);
  });

  it('POST 400 on invalid slug', async () => {
    const res = await request(app).post('/api/subagents').send({ name: '1designer' });
    expect(res.status).toBe(400);
  });
});
```

- [ ] **Step 2: Run, expect FAIL**

```bash
npx vitest run server/routes/subagents.routes.test.ts
```

- [ ] **Step 3: Implement `server/routes/subagents.routes.ts`**

```ts
import { Router, type Request, type Response, type NextFunction } from 'express';
import { ValidationError } from '@/server/lib/errors';
import {
  SubAgentCreateInputSchema,
  SubAgentUpdateInputSchema,
} from '@/server/domain/subagents/subagents.schema';
import type { SubAgentsStore } from '@/server/domain/subagents/subagents.store';

function asyncHandler(fn: (req: Request, res: Response, next: NextFunction) => Promise<void>) {
  return (req: Request, res: Response, next: NextFunction) => {
    fn(req, res, next).catch(next);
  };
}

export function createSubAgentsRoutes(store: SubAgentsStore): Router {
  const router = Router();

  router.get(
    '/',
    asyncHandler(async (_req, res) => {
      res.json({ subAgents: await store.list() });
    }),
  );

  router.post(
    '/',
    asyncHandler(async (req, res) => {
      const parsed = SubAgentCreateInputSchema.safeParse(req.body);
      if (!parsed.success) throw new ValidationError('Invalid subagent payload', parsed.error);
      const meta = await store.create(parsed.data);
      res.status(201).json(meta);
    }),
  );

  router.get(
    '/:id',
    asyncHandler(async (req, res) => {
      const rec = await store.read(req.params.id);
      if (!rec) {
        res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Sub-agent not found' } });
        return;
      }
      res.json({ id: req.params.id, ...rec });
    }),
  );

  router.put(
    '/:id',
    asyncHandler(async (req, res) => {
      const parsed = SubAgentUpdateInputSchema.safeParse(req.body);
      if (!parsed.success) throw new ValidationError('Invalid subagent body', parsed.error);
      const meta = await store.update(req.params.id, parsed.data);
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

- [ ] **Step 4: Tests will still fail until C4 wires the store into `createApp`. Skip to C4.**

- [ ] **Step 5: Commit the routes module**

```bash
git add server/routes/subagents.routes.ts server/routes/subagents.routes.test.ts
git commit -m "feat(slice-6): add /api/subagents routes module"
```

---

### Task C4: Wire `SubAgentsStore` + routes into `app.ts` + `index.ts`

**Files:**
- Modify: `server/app.ts`
- Modify: `server/index.ts`

- [ ] **Step 1: Read `server/app.ts` and follow the `profilesStore` pattern**

At the top:

```ts
import { createSubAgentsRoutes } from '@/server/routes/subagents.routes';
import type { SubAgentsStore } from '@/server/domain/subagents/subagents.store';
```

In the `AppDeps` interface, add:

```ts
  subAgentsStore?: SubAgentsStore;
```

In `createApp`, near the existing profiles mount, add:

```ts
  if (deps.subAgentsStore) {
    app.use('/api/subagents', createSubAgentsRoutes(deps.subAgentsStore));
  }
```

- [ ] **Step 2: Modify `server/index.ts`**

Find where `profilesStore` is instantiated and add directly below:

```ts
import { SubAgentsStore } from '@/server/domain/subagents/subagents.store';
// ...
const subAgentsStore = new SubAgentsStore(path.join(cfg.dataDir, 'subagents.json'));
// ...
const app = createApp({ /* ...existing deps... */, subAgentsStore });
```

- [ ] **Step 3: Run, expect PASS**

```bash
npx vitest run server/routes/subagents.routes.test.ts
```

Expected: 9 route tests PASS.

- [ ] **Step 4: Run full server suite**

```bash
npx vitest run server
```

Expected: ALL PASS.

- [ ] **Step 5: Lint + commit**

```bash
npm run lint
git add server/app.ts server/index.ts
git commit -m "feat(slice-6): wire SubAgentsStore + routes in app + bootstrap"
```

---

## Phase D — Parser + assembler (pure)

### Task D1: `subagent-parser`

**Files:**
- Create: `server/domain/dispatch/subagent-parser.ts`
- Create: `server/domain/dispatch/subagent-parser.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
// server/domain/dispatch/subagent-parser.test.ts
import { describe, it, expect } from 'vitest';
import { parseLeadingMention } from './subagent-parser';

const KNOWN = new Set(['designer', 'coder', 'a_b-c']);

describe('parseLeadingMention', () => {
  it('matches leading @name with whitespace', () => {
    expect(parseLeadingMention('@designer hello', KNOWN)).toEqual({
      name: 'designer',
      stripped: 'hello',
    });
  });

  it('matches when message is just @name', () => {
    expect(parseLeadingMention('@designer', KNOWN)).toEqual({
      name: 'designer',
      stripped: '',
    });
  });

  it('returns null name when there is no leading @', () => {
    expect(parseLeadingMention('hello @designer', KNOWN)).toEqual({
      name: null,
      stripped: 'hello @designer',
    });
  });

  it('returns null name for unknown name (preserves original)', () => {
    expect(parseLeadingMention('@unknown hello', KNOWN)).toEqual({
      name: null,
      stripped: '@unknown hello',
    });
  });

  it('accepts underscore + dash names', () => {
    expect(parseLeadingMention('@a_b-c make it', KNOWN)).toEqual({
      name: 'a_b-c',
      stripped: 'make it',
    });
  });

  it('rejects name starting with digit', () => {
    expect(parseLeadingMention('@1designer hello', new Set(['1designer']))).toEqual({
      name: null,
      stripped: '@1designer hello',
    });
  });

  it('rejects @ followed by non-letter', () => {
    expect(parseLeadingMention('@-foo bar', new Set())).toEqual({
      name: null,
      stripped: '@-foo bar',
    });
  });

  it('returns empty stripped for empty message', () => {
    expect(parseLeadingMention('', KNOWN)).toEqual({ name: null, stripped: '' });
  });

  it('consumes multiple spaces after name', () => {
    expect(parseLeadingMention('@designer   hello', KNOWN)).toEqual({
      name: 'designer',
      stripped: 'hello',
    });
  });
});
```

- [ ] **Step 2: Run, expect FAIL**

```bash
npx vitest run server/domain/dispatch/subagent-parser.test.ts
```

- [ ] **Step 3: Implement `server/domain/dispatch/subagent-parser.ts`**

```ts
const LEADING_MENTION = /^@([A-Za-z][A-Za-z0-9_-]*)(\s+|$)/;

export interface ParsedMention {
  name: string | null;
  stripped: string;
}

export function parseLeadingMention(
  message: string,
  knownNames: ReadonlySet<string>,
): ParsedMention {
  const m = message.match(LEADING_MENTION);
  if (!m) return { name: null, stripped: message };
  const name = m[1];
  if (!knownNames.has(name)) return { name: null, stripped: message };
  return { name, stripped: message.slice(m[0].length) };
}
```

- [ ] **Step 4: Run, expect PASS (9 tests)**

```bash
npx vitest run server/domain/dispatch/subagent-parser.test.ts
```

- [ ] **Step 5: Lint + commit**

```bash
npm run lint
git add server/domain/dispatch/subagent-parser.ts server/domain/dispatch/subagent-parser.test.ts
git commit -m "feat(slice-6): add subagent-parser (leading @name)"
```

---

### Task D2: `prompt-assembler`

**Files:**
- Create: `server/domain/dispatch/prompt-assembler.ts`
- Create: `server/domain/dispatch/prompt-assembler.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
// server/domain/dispatch/prompt-assembler.test.ts
import { describe, it, expect } from 'vitest';
import { assemble } from './prompt-assembler';
import type { AetherContext } from '@/server/domain/context/context.types';
import type { SubAgentRecord } from '@/server/domain/subagents/subagents.types';

const ctx: AetherContext = {
  systemInstruction: 'Base.',
  skills: ['core'],
  tools: [{ id: 't1', name: 'tool1', version: '1', status: 'online' }],
  mcpServers: [],
};

const sub: SubAgentRecord = {
  name: 'designer',
  systemInstruction: 'Design.',
  skills: ['design', 'core'],
  tools: [
    { id: 't1', name: 'tool1', version: '2', status: 'online' },
    { id: 't2', name: 'tool2', version: '1', status: 'online' },
  ],
  createdAt: 0,
  updatedAt: 0,
};

describe('assemble', () => {
  it('returns base context when subAgent is null', () => {
    const out = assemble(ctx, null, 'hello', null);
    expect(out).toEqual({
      systemInstruction: 'Base.',
      skills: ['core'],
      tools: ctx.tools,
      message: 'hello',
      subAgent: null,
    });
  });

  it('concatenates system instructions with header', () => {
    const out = assemble(ctx, sub, 'hello', 'designer');
    expect(out.systemInstruction).toBe('Base.\n\n# Sub-agent: designer\n\nDesign.');
  });

  it('dedups skills, context wins ordering', () => {
    const out = assemble(ctx, sub, 'hello', 'designer');
    expect(out.skills).toEqual(['core', 'design']);
  });

  it('dedups tools by id, context wins on conflict', () => {
    const out = assemble(ctx, sub, 'hello', 'designer');
    expect(out.tools).toHaveLength(2);
    expect(out.tools.find((t) => t.id === 't1')!.version).toBe('1');
    expect(out.tools.find((t) => t.id === 't2')!.version).toBe('1');
  });

  it('handles empty base systemInstruction', () => {
    const out = assemble({ ...ctx, systemInstruction: '' }, sub, 'm', 'designer');
    expect(out.systemInstruction).toBe('# Sub-agent: designer\n\nDesign.');
  });

  it('forwards parsed message + subAgent name', () => {
    const out = assemble(ctx, sub, 'parsed-msg', 'designer');
    expect(out.message).toBe('parsed-msg');
    expect(out.subAgent).toBe('designer');
  });
});
```

- [ ] **Step 2: Run, expect FAIL**

```bash
npx vitest run server/domain/dispatch/prompt-assembler.test.ts
```

- [ ] **Step 3: Implement `server/domain/dispatch/prompt-assembler.ts`**

```ts
import type { AetherContext, Tool } from '@/server/domain/context/context.types';
import type { SubAgentRecord } from '@/server/domain/subagents/subagents.types';

export interface AssembledPrompt {
  systemInstruction: string;
  skills: string[];
  tools: Tool[];
  message: string;
  subAgent: string | null;
}

function dedupStrings(arr: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const s of arr) {
    if (seen.has(s)) continue;
    seen.add(s);
    out.push(s);
  }
  return out;
}

function dedupToolsById(arr: Tool[]): Tool[] {
  const seen = new Set<string>();
  const out: Tool[] = [];
  for (const t of arr) {
    if (seen.has(t.id)) continue;
    seen.add(t.id);
    out.push(t);
  }
  return out;
}

export function assemble(
  ctx: AetherContext,
  subAgent: SubAgentRecord | null,
  parsedMessage: string,
  resolvedName: string | null,
): AssembledPrompt {
  if (!subAgent) {
    return {
      systemInstruction: ctx.systemInstruction,
      skills: ctx.skills,
      tools: ctx.tools,
      message: parsedMessage,
      subAgent: null,
    };
  }
  const sys = [
    ctx.systemInstruction.trim(),
    `# Sub-agent: ${subAgent.name}`,
    subAgent.systemInstruction.trim(),
  ]
    .filter(Boolean)
    .join('\n\n');
  const skills = dedupStrings([...ctx.skills, ...subAgent.skills]);
  const tools = dedupToolsById([...ctx.tools, ...subAgent.tools]);
  return { systemInstruction: sys, skills, tools, message: parsedMessage, subAgent: resolvedName };
}
```

- [ ] **Step 4: Run, expect PASS (6 tests)**

```bash
npx vitest run server/domain/dispatch/prompt-assembler.test.ts
```

- [ ] **Step 5: Lint + commit**

```bash
npm run lint
git add server/domain/dispatch/prompt-assembler.ts server/domain/dispatch/prompt-assembler.test.ts
git commit -m "feat(slice-6): add prompt-assembler (append + dedup union)"
```

---

## Phase E — Dispatch service integration

### Task E1: Wire parser + assembler + `resolve_subagent` tracer step

**Files:**
- Modify: `server/domain/dispatch/dispatch.service.ts`
- Modify: `server/routes/dispatch.routes.test.ts`

- [ ] **Step 1: Read existing `dispatch.service.ts`**

Locate the `context_fetch` step and the dispatch step. Identify the existing `DispatchServiceDeps` interface.

- [ ] **Step 2: Read existing `dispatch.routes.test.ts`**

Find the test harness pattern: how it constructs the app, how it captures SSE events, and how it stubs FakeProvider. Use the same pattern for the new tests.

- [ ] **Step 3: Append failing tests to `server/routes/dispatch.routes.test.ts`**

At the end of the file, append a new `describe` block (adapt to the existing test harness — the snippet below assumes the file already exposes helpers like `setupApp` and `collectEvents`; if not, replicate the slice-2a pattern in the same file):

```ts
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { SubAgentsStore } from '@/server/domain/subagents/subagents.store';

describe('dispatch with @subagent', () => {
  it('emits resolve_subagent step and tags dispatch step', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'aether-dispatch-sa-'));
    const subAgentsStore = new SubAgentsStore(path.join(dir, 'subagents.json'));
    await subAgentsStore.create({ name: 'designer', systemInstruction: 'Design.' });

    // Reuse the same app-construction helper that other tests in this file use,
    // adding subAgentsStore to the deps. Reference: the existing test that
    // exercises the context_fetch + dispatch flow.

    // Send POST /api/dispatch with @designer ping and collect SSE events.
    // Then assert:
    //   - some event has type 'reasoning_step' with payload type 'resolve_subagent' and subAgent 'designer'
    //   - some event has type 'reasoning_step' with payload type 'dispatch' and subAgent 'designer'
    //   - the captured systemInstruction passed to FakeProvider contains '# Sub-agent: designer'
    //   - the captured userMessage passed to FakeProvider equals 'ping' (stripped)
    //   - the persisted user-message in history equals '@designer ping' (original)
  });

  it('with unknown @name: no resolve_subagent; userMessage unstripped', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'aether-dispatch-sa-2-'));
    const subAgentsStore = new SubAgentsStore(path.join(dir, 'subagents.json'));
    // Do not create any sub-agent named 'unknown'.
    // Build app with subAgentsStore.
    // Send '@unknown hello'.
    // Assert: no reasoning_step event has type 'resolve_subagent'.
    // Assert: FakeProvider received userMessage === '@unknown hello'.
  });
});
```

The comments inside the test bodies describe exactly the assertions to make. The implementer must mirror the existing dispatch.routes.test.ts harness (FakeProvider stub + SSE event collection) — those helpers are already in the file from slice 2a.

- [ ] **Step 4: Run, expect FAIL**

```bash
npx vitest run server/routes/dispatch.routes.test.ts
```

- [ ] **Step 5: Modify `server/domain/dispatch/dispatch.service.ts`**

Add imports at the top:

```ts
import type { SubAgentsStore } from '@/server/domain/subagents/subagents.store';
import type { SubAgentRecord } from '@/server/domain/subagents/subagents.types';
import { parseLeadingMention } from './subagent-parser';
import { assemble } from './prompt-assembler';
```

Extend `DispatchServiceDeps`:

```ts
export interface DispatchServiceDeps {
  provider: AIProvider;
  historyStore: HistoryStore;
  contextStore: ContextStore;
  subAgentsStore?: SubAgentsStore;
}
```

Inside `handle()`, after the existing `context_fetch` step (the one that yields `context`), insert this block:

```ts
    // Resolve sub-agent (optional dep — gracefully absent in legacy tests).
    let knownNames: ReadonlySet<string> = new Set<string>();
    let allRecords: Array<{ name: string; record: SubAgentRecord }> = [];
    if (this.deps.subAgentsStore) {
      try {
        const metas = await this.deps.subAgentsStore.list();
        const recs = await Promise.all(
          metas.map(async (m) => {
            const record = await this.deps.subAgentsStore!.read(m.id);
            return record ? { name: m.name, record } : null;
          }),
        );
        allRecords = recs.filter((r): r is { name: string; record: SubAgentRecord } => r !== null);
        knownNames = new Set(allRecords.map((r) => r.name));
      } catch {
        // Degrade silently: knownNames stays empty.
      }
    }

    const parsed = parseLeadingMention(message, knownNames);
    const matchedSubAgent =
      parsed.name === null
        ? null
        : allRecords.find((r) => r.name === parsed.name)?.record ?? null;

    if (matchedSubAgent && parsed.name) {
      const subName = parsed.name;
      const sa = matchedSubAgent;
      await tracer.step({
        type: 'resolve_subagent',
        title: `Sub-agent: ${subName}`,
        run: async () => ({
          content: `systemInstruction +${sa.systemInstruction.length} chars, +${sa.skills.length} skills, +${sa.tools.length} tools`,
          subAgent: subName,
          result: null,
        }),
      });
    }

    const assembled = assemble(context, matchedSubAgent, parsed.stripped, parsed.name);
```

The existing user-message history append already uses `message` (the original); no change needed there.

In the dispatch step, replace the call to `provider.stream({ systemInstruction: context.systemInstruction, ..., userMessage: message })` with `assembled.systemInstruction` and `userMessage: assembled.message`. Also add `subAgent: assembled.subAgent ?? undefined` to the return object of `run`:

```ts
      await tracer.step({
        type: 'dispatch',
        title: `Dispatch to ${provider.model}${thinking ? ' (thinking)' : ''}`,
        run: async () => {
          const it = provider.stream(
            {
              systemInstruction: assembled.systemInstruction,
              history: prior.map((m) => ({ role: m.role, text: m.text })),
              userMessage: assembled.message,
              thinking,
            },
            signal,
          );
          // ...existing chunk loop unchanged...
          return {
            content: `${accumText.length} chars streamed${
              accumThought.length > 0 ? `, ${accumThought.length} chars thinking` : ''
            }`,
            tokens: dispatchUsage?.totalTokens,
            subAgent: assembled.subAgent ?? undefined,
            result: null,
          };
        },
      });
```

Keep all other steps (`validation`, history append for model message) unchanged.

- [ ] **Step 6: Run dispatch + reasoning tests**

```bash
npx vitest run server/routes/dispatch.routes.test.ts server/domain/dispatch server/domain/reasoning
```

Expected: PASS (including the two new tests).

- [ ] **Step 7: Run full server suite**

```bash
npx vitest run server
```

Expected: ALL PASS.

- [ ] **Step 8: Lint + commit**

```bash
npm run lint
git add server/domain/dispatch/dispatch.service.ts server/routes/dispatch.routes.test.ts
git commit -m "feat(slice-6): wire subagent parser+assembler into dispatch.service"
```

---

## Phase F — Frontend types + API + store

### Task F1: FE types re-export

**Files:**
- Create: `src/types/subagent.types.ts`

- [ ] **Step 1: Create the re-export**

```ts
export type {
  SubAgentRecord,
  SubAgentMeta,
} from '@/server/domain/subagents/subagents.types';
```

- [ ] **Step 2: Lint + commit**

```bash
npm run lint
git add src/types/subagent.types.ts
git commit -m "feat(slice-6): re-export SubAgent types to frontend"
```

---

### Task F2: API client + MSW default handlers

**Files:**
- Create: `src/lib/api/subagents.api.ts`
- Create: `src/lib/api/subagents.api.test.ts`
- Modify: `src/test/msw-handlers.ts`

- [ ] **Step 1: Write failing API client tests**

```ts
// src/lib/api/subagents.api.test.ts
import { describe, it, expect } from 'vitest';
import { http, HttpResponse } from 'msw';
import { server } from '@/src/test/msw-server';
import { subagentsApi } from './subagents.api';

describe('subagentsApi', () => {
  it('list returns array', async () => {
    server.use(
      http.get('http://localhost/api/subagents', () =>
        HttpResponse.json({ subAgents: [{ id: 's1', name: 'designer', createdAt: 1, updatedAt: 2 }] }),
      ),
    );
    expect(await subagentsApi.list()).toEqual([
      { id: 's1', name: 'designer', createdAt: 1, updatedAt: 2 },
    ]);
  });

  it('get returns record', async () => {
    server.use(
      http.get('http://localhost/api/subagents/s1', () =>
        HttpResponse.json({
          id: 's1',
          name: 'designer',
          systemInstruction: 'Design.',
          skills: [],
          tools: [],
          createdAt: 1,
          updatedAt: 2,
        }),
      ),
    );
    const rec = await subagentsApi.get('s1');
    expect(rec.name).toBe('designer');
  });

  it('create posts payload and returns meta', async () => {
    let captured: unknown = null;
    server.use(
      http.post('http://localhost/api/subagents', async ({ request }) => {
        captured = await request.json();
        return HttpResponse.json(
          { id: 'sX', name: 'designer', createdAt: 1, updatedAt: 1 },
          { status: 201 },
        );
      }),
    );
    const meta = await subagentsApi.create({
      name: 'designer',
      systemInstruction: 'Design.',
      skills: [],
      tools: [],
    });
    expect(meta.id).toBe('sX');
    expect(captured).toEqual({ name: 'designer', systemInstruction: 'Design.', skills: [], tools: [] });
  });

  it('update PUTs and returns meta', async () => {
    server.use(
      http.put('http://localhost/api/subagents/s1', () =>
        HttpResponse.json({ id: 's1', name: 'designer', createdAt: 1, updatedAt: 5 }),
      ),
    );
    const meta = await subagentsApi.update('s1', { systemInstruction: 'new' });
    expect(meta.updatedAt).toBe(5);
  });

  it('delete returns void on 204', async () => {
    server.use(
      http.delete('http://localhost/api/subagents/s1', () => new HttpResponse(null, { status: 204 })),
    );
    await expect(subagentsApi.delete('s1')).resolves.toBeUndefined();
  });

  it('throws on non-OK', async () => {
    server.use(
      http.post('http://localhost/api/subagents', () =>
        HttpResponse.json({ error: { message: 'bad' } }, { status: 400 }),
      ),
    );
    await expect(subagentsApi.create({ name: '1bad' })).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run, expect FAIL**

```bash
npx vitest run src/lib/api/subagents.api.test.ts
```

- [ ] **Step 3: Implement `src/lib/api/subagents.api.ts`**

```ts
import type { SubAgentMeta, SubAgentRecord } from '@/src/types/subagent.types';
import type { Tool } from '@/src/types/context.types';

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const msg = (body as { error?: { message?: string } }).error?.message ?? res.statusText;
    throw new Error(msg);
  }
  return (await res.json()) as T;
}

export interface SubAgentCreateInput {
  name: string;
  systemInstruction?: string;
  skills?: string[];
  tools?: Tool[];
}

export type SubAgentUpdateInput = Partial<SubAgentCreateInput>;

export const subagentsApi = {
  list: async (): Promise<SubAgentMeta[]> => {
    const res = await fetch('/api/subagents');
    const body = await json<{ subAgents: SubAgentMeta[] }>(res);
    return body.subAgents;
  },
  get: async (id: string): Promise<SubAgentRecord & { id: string }> => {
    return json<SubAgentRecord & { id: string }>(await fetch(`/api/subagents/${id}`));
  },
  create: async (input: SubAgentCreateInput): Promise<SubAgentMeta> => {
    const res = await fetch('/api/subagents', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(input),
    });
    return json<SubAgentMeta>(res);
  },
  update: async (id: string, input: SubAgentUpdateInput): Promise<SubAgentMeta> => {
    const res = await fetch(`/api/subagents/${id}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(input),
    });
    return json<SubAgentMeta>(res);
  },
  delete: async (id: string): Promise<void> => {
    const res = await fetch(`/api/subagents/${id}`, { method: 'DELETE' });
    if (!res.ok) throw new Error(res.statusText);
  },
};
```

- [ ] **Step 4: Add default MSW handlers in `src/test/msw-handlers.ts`**

Append these handlers to the existing `handlers` array:

```ts
  http.get('http://localhost/api/subagents', () => HttpResponse.json({ subAgents: [] })),
  http.post('http://localhost/api/subagents', async ({ request }) => {
    const body = (await request.json()) as { name: string };
    return HttpResponse.json(
      { id: `sa-${Date.now()}`, name: body.name, createdAt: Date.now(), updatedAt: Date.now() },
      { status: 201 },
    );
  }),
  http.get('http://localhost/api/subagents/:id', ({ params }) =>
    HttpResponse.json({
      id: params.id,
      name: 'default',
      systemInstruction: '',
      skills: [],
      tools: [],
      createdAt: 1,
      updatedAt: 1,
    }),
  ),
  http.put('http://localhost/api/subagents/:id', ({ params }) =>
    HttpResponse.json({
      id: params.id,
      name: 'updated',
      createdAt: 1,
      updatedAt: Date.now(),
    }),
  ),
  http.delete('http://localhost/api/subagents/:id', () => new HttpResponse(null, { status: 204 })),
```

- [ ] **Step 5: Run, expect PASS**

```bash
npx vitest run src/lib/api/subagents.api.test.ts
```

- [ ] **Step 6: Lint + commit**

```bash
npm run lint
git add src/lib/api/subagents.api.ts src/lib/api/subagents.api.test.ts src/test/msw-handlers.ts
git commit -m "feat(slice-6): add subagents.api + MSW default handlers"
```

---

### Task F3: Frontend `useSubAgentsStore`

**Files:**
- Create: `src/stores/subagents.store.ts`
- Create: `src/stores/subagents.store.test.ts`

- [ ] **Step 1: Write failing store tests**

```ts
// src/stores/subagents.store.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { http, HttpResponse } from 'msw';
import { server } from '@/src/test/msw-server';
import { useSubAgentsStore } from './subagents.store';

beforeEach(() => {
  useSubAgentsStore.getState()._reset();
});

describe('useSubAgentsStore', () => {
  it('init populates list from API', async () => {
    server.use(
      http.get('http://localhost/api/subagents', () =>
        HttpResponse.json({ subAgents: [{ id: 's1', name: 'd', createdAt: 1, updatedAt: 1 }] }),
      ),
    );
    await useSubAgentsStore.getState().init();
    expect(useSubAgentsStore.getState().list).toHaveLength(1);
    expect(useSubAgentsStore.getState().hydrated).toBe(true);
  });

  it('create appends to list', async () => {
    server.use(
      http.post('http://localhost/api/subagents', () =>
        HttpResponse.json({ id: 'sX', name: 'designer', createdAt: 1, updatedAt: 1 }, { status: 201 }),
      ),
    );
    await useSubAgentsStore.getState().create({ name: 'designer', systemInstruction: 'D.' });
    expect(useSubAgentsStore.getState().list).toHaveLength(1);
    expect(useSubAgentsStore.getState().list[0].name).toBe('designer');
  });

  it('delete removes from list', async () => {
    useSubAgentsStore.setState({
      list: [{ id: 's1', name: 'd', createdAt: 0, updatedAt: 0 }],
      hydrated: true,
    });
    server.use(
      http.delete('http://localhost/api/subagents/s1', () => new HttpResponse(null, { status: 204 })),
    );
    await useSubAgentsStore.getState().delete('s1');
    expect(useSubAgentsStore.getState().list).toHaveLength(0);
  });

  it('sets error on API failure', async () => {
    server.use(
      http.post('http://localhost/api/subagents', () =>
        HttpResponse.json({ error: { message: 'Boom' } }, { status: 400 }),
      ),
    );
    await expect(useSubAgentsStore.getState().create({ name: '1bad' })).rejects.toThrow();
    expect(useSubAgentsStore.getState().error).toBe('Boom');
  });

  it('clearError resets error', () => {
    useSubAgentsStore.setState({ error: 'x' });
    useSubAgentsStore.getState().clearError();
    expect(useSubAgentsStore.getState().error).toBeNull();
  });
});
```

- [ ] **Step 2: Run, expect FAIL**

```bash
npx vitest run src/stores/subagents.store.test.ts
```

- [ ] **Step 3: Implement `src/stores/subagents.store.ts`**

```ts
import { create } from 'zustand';
import { subagentsApi, type SubAgentCreateInput, type SubAgentUpdateInput } from '@/src/lib/api/subagents.api';
import type { SubAgentMeta } from '@/src/types/subagent.types';

interface SubAgentsState {
  list: SubAgentMeta[];
  hydrated: boolean;
  error: string | null;

  init: () => Promise<void>;
  create: (input: SubAgentCreateInput) => Promise<SubAgentMeta>;
  update: (id: string, input: SubAgentUpdateInput) => Promise<void>;
  delete: (id: string) => Promise<void>;
  clearError: () => void;
  _reset: () => void;
}

const initial = {
  list: [] as SubAgentMeta[],
  hydrated: false,
  error: null as string | null,
};

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : 'Operation failed';
}

export const useSubAgentsStore = create<SubAgentsState>((set) => ({
  ...initial,
  _reset: () => set(initial),

  init: async () => {
    try {
      const list = await subagentsApi.list();
      set({ list, hydrated: true, error: null });
    } catch (e) {
      set({ list: [], hydrated: true, error: errMsg(e) });
    }
  },

  create: async (input) => {
    try {
      const meta = await subagentsApi.create(input);
      set((s) => ({ list: [meta, ...s.list], error: null }));
      return meta;
    } catch (e) {
      set({ error: errMsg(e) });
      throw e;
    }
  },

  update: async (id, input) => {
    try {
      const meta = await subagentsApi.update(id, input);
      set((s) => ({
        list: s.list.map((m) => (m.id === id ? meta : m)),
        error: null,
      }));
    } catch (e) {
      set({ error: errMsg(e) });
      throw e;
    }
  },

  delete: async (id) => {
    try {
      await subagentsApi.delete(id);
      set((s) => ({ list: s.list.filter((m) => m.id !== id), error: null }));
    } catch (e) {
      set({ error: errMsg(e) });
      throw e;
    }
  },

  clearError: () => set({ error: null }),
}));
```

- [ ] **Step 4: Run, expect PASS**

```bash
npx vitest run src/stores/subagents.store.test.ts
```

- [ ] **Step 5: Lint + commit**

```bash
npm run lint
git add src/stores/subagents.store.ts src/stores/subagents.store.test.ts
git commit -m "feat(slice-6): add useSubAgentsStore"
```

---

## Phase G — Mention autocomplete logic

### Task G1: `useMentionAutocomplete` pure hook

**Files:**
- Create: `src/hooks/useMentionAutocomplete.ts`
- Create: `src/hooks/useMentionAutocomplete.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
// src/hooks/useMentionAutocomplete.test.ts
import { describe, it, expect } from 'vitest';
import { computeMentionState } from './useMentionAutocomplete';

describe('computeMentionState', () => {
  it('closed when no @', () => {
    const s = computeMentionState('hello', 5);
    expect(s.open).toBe(false);
  });

  it('open at @ alone, caret right after', () => {
    const s = computeMentionState('@', 1);
    expect(s).toEqual({ open: true, query: '', replaceRange: [0, 1] });
  });

  it('open after @des', () => {
    const s = computeMentionState('@des', 4);
    expect(s).toEqual({ open: true, query: 'des', replaceRange: [0, 4] });
  });

  it('open after whitespace-anchored @des', () => {
    const s = computeMentionState('hello @des', 10);
    expect(s).toEqual({ open: true, query: 'des', replaceRange: [6, 10] });
  });

  it('closed when @ follows non-whitespace (e.g. email)', () => {
    const s = computeMentionState('mail @user@domain', 17);
    expect(s.open).toBe(false);
  });

  it('closed when there is a space after the name', () => {
    const s = computeMentionState('@designer ', 10);
    expect(s.open).toBe(false);
  });

  it('uses the caret position to slice query', () => {
    const s = computeMentionState('@designer', 4);
    expect(s).toEqual({ open: true, query: 'des', replaceRange: [0, 4] });
  });

  it('closed when there is no @ before the caret', () => {
    const s = computeMentionState('designer', 4);
    expect(s.open).toBe(false);
  });
});
```

- [ ] **Step 2: Run, expect FAIL**

```bash
npx vitest run src/hooks/useMentionAutocomplete.test.ts
```

- [ ] **Step 3: Implement `src/hooks/useMentionAutocomplete.ts`**

```ts
export interface MentionState {
  open: boolean;
  query: string;
  replaceRange: [number, number];
}

const CLOSED: MentionState = { open: false, query: '', replaceRange: [0, 0] };

export function computeMentionState(text: string, caret: number): MentionState {
  if (caret <= 0 || caret > text.length) return CLOSED;
  let i = caret - 1;
  while (i >= 0) {
    const ch = text[i];
    if (ch === '@') {
      const before = i === 0 ? null : text[i - 1];
      if (before !== null && !/\s/.test(before)) return CLOSED;
      const query = text.slice(i + 1, caret);
      if (query.length > 0 && !/^[A-Za-z][A-Za-z0-9_-]*$/.test(query)) return CLOSED;
      return { open: true, query, replaceRange: [i, caret] };
    }
    if (!/[A-Za-z0-9_-]/.test(ch)) return CLOSED;
    i--;
  }
  return CLOSED;
}
```

- [ ] **Step 4: Run, expect PASS (8 tests)**

```bash
npx vitest run src/hooks/useMentionAutocomplete.test.ts
```

- [ ] **Step 5: Lint + commit**

```bash
npm run lint
git add src/hooks/useMentionAutocomplete.ts src/hooks/useMentionAutocomplete.test.ts
git commit -m "feat(slice-6): add useMentionAutocomplete caret-state parser"
```

---

## Phase H — Frontend components

### Task H1: `MentionPopover`

**Files:**
- Create: `src/components/chat/MentionPopover.tsx`
- Create: `src/components/chat/MentionPopover.test.tsx`

- [ ] **Step 1: Write failing tests**

```tsx
// src/components/chat/MentionPopover.test.tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MentionPopover } from './MentionPopover';
import type { SubAgentMeta } from '@/src/types/subagent.types';

const items: SubAgentMeta[] = [
  { id: 'a', name: 'designer', createdAt: 1, updatedAt: 1 },
  { id: 'b', name: 'coder', createdAt: 1, updatedAt: 1 },
];

describe('MentionPopover', () => {
  it('renders nothing when open=false', () => {
    const { container } = render(
      <MentionPopover open={false} items={items} onSelect={() => {}} onClose={() => {}} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it('renders item names when open', () => {
    render(<MentionPopover open items={items} onSelect={() => {}} onClose={() => {}} />);
    expect(screen.getByText('designer')).toBeInTheDocument();
    expect(screen.getByText('coder')).toBeInTheDocument();
  });

  it('Enter on highlighted item calls onSelect', async () => {
    const onSelect = vi.fn();
    const user = userEvent.setup();
    render(<MentionPopover open items={items} onSelect={onSelect} onClose={() => {}} />);
    await user.keyboard('{Enter}');
    expect(onSelect).toHaveBeenCalledWith('designer');
  });

  it('ArrowDown then Enter selects second item', async () => {
    const onSelect = vi.fn();
    const user = userEvent.setup();
    render(<MentionPopover open items={items} onSelect={onSelect} onClose={() => {}} />);
    await user.keyboard('{ArrowDown}{Enter}');
    expect(onSelect).toHaveBeenCalledWith('coder');
  });

  it('Escape calls onClose', async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(<MentionPopover open items={items} onSelect={() => {}} onClose={onClose} />);
    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalled();
  });

  it('empty items shows placeholder', () => {
    render(<MentionPopover open items={[]} onSelect={() => {}} onClose={() => {}} />);
    expect(screen.getByText(/no sub-agents/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run, expect FAIL**

```bash
npx vitest run src/components/chat/MentionPopover.test.tsx
```

- [ ] **Step 3: Implement `src/components/chat/MentionPopover.tsx`**

```tsx
import { useEffect, useState } from 'react';
import type { SubAgentMeta } from '@/src/types/subagent.types';

export interface MentionPopoverProps {
  open: boolean;
  items: SubAgentMeta[];
  onSelect: (name: string) => void;
  onClose: () => void;
}

export function MentionPopover({ open, items, onSelect, onClose }: MentionPopoverProps) {
  const [index, setIndex] = useState(0);

  useEffect(() => {
    if (!open) return;
    setIndex(0);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setIndex((i) => Math.min(i + 1, items.length - 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setIndex((i) => Math.max(i - 1, 0));
      } else if (e.key === 'Enter' || e.key === 'Tab') {
        if (items.length === 0) return;
        e.preventDefault();
        onSelect(items[index]?.name ?? items[0].name);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, items, index, onSelect, onClose]);

  if (!open) return null;

  if (items.length === 0) {
    return (
      <div
        role="listbox"
        className="absolute bottom-full left-0 mb-2 w-64 bg-surface-2 border border-border-subtle rounded shadow-lg p-2 text-xs text-zinc-500 font-mono"
      >
        No sub-agents yet
      </div>
    );
  }

  return (
    <div
      role="listbox"
      className="absolute bottom-full left-0 mb-2 w-64 bg-surface-2 border border-border-subtle rounded shadow-lg overflow-hidden"
    >
      {items.map((item, i) => (
        <button
          key={item.id}
          type="button"
          role="option"
          aria-selected={i === index}
          data-selected={i === index}
          onClick={() => onSelect(item.name)}
          onMouseEnter={() => setIndex(i)}
          className={`w-full text-left px-2 py-1.5 text-xs font-mono ${
            i === index ? 'bg-surface-3 text-white' : 'text-zinc-300'
          }`}
        >
          {item.name}
        </button>
      ))}
    </div>
  );
}
```

- [ ] **Step 4: Run, expect PASS**

```bash
npx vitest run src/components/chat/MentionPopover.test.tsx
```

- [ ] **Step 5: Lint + commit**

```bash
npm run lint
git add src/components/chat/MentionPopover.tsx src/components/chat/MentionPopover.test.tsx
git commit -m "feat(slice-6): add MentionPopover (keyboard-driven dropdown)"
```

---

### Task H2: `MessageInput` integration

**Files:**
- Modify: `src/components/chat/MessageInput.tsx`
- Modify: `src/components/chat/MessageInput.test.tsx`

- [ ] **Step 1: Append failing tests**

```tsx
// Inside src/components/chat/MessageInput.test.tsx, in the existing describe block, append:
import { useSubAgentsStore } from '@/src/stores/subagents.store';

beforeEach(() => {
  useSubAgentsStore.getState()._reset();
});

it('opens mention popover when typing @', async () => {
  useSubAgentsStore.setState({
    list: [{ id: 'a', name: 'designer', createdAt: 1, updatedAt: 1 }],
    hydrated: true,
  });
  const user = userEvent.setup();
  render(<MessageInput onSend={() => {}} onStop={() => {}} isStreaming={false} />);
  const ta = screen.getByPlaceholderText(/scrivi un messaggio/i);
  await user.click(ta);
  await user.keyboard('@d');
  expect(screen.getByText('designer')).toBeInTheDocument();
});

it('selecting from popover inserts @name<space>', async () => {
  useSubAgentsStore.setState({
    list: [{ id: 'a', name: 'designer', createdAt: 1, updatedAt: 1 }],
    hydrated: true,
  });
  const user = userEvent.setup();
  render(<MessageInput onSend={() => {}} onStop={() => {}} isStreaming={false} />);
  const ta = screen.getByPlaceholderText(/scrivi un messaggio/i) as HTMLTextAreaElement;
  await user.click(ta);
  await user.keyboard('@des');
  await user.keyboard('{Enter}');
  expect(ta.value).toBe('@designer ');
});
```

- [ ] **Step 2: Run, expect FAIL**

```bash
npx vitest run src/components/chat/MessageInput.test.tsx
```

- [ ] **Step 3: Modify `src/components/chat/MessageInput.tsx`**

Replace the file with:

```tsx
import { useRef, useState, type KeyboardEvent, type ChangeEvent } from 'react';
import { Send, Square, Brain } from 'lucide-react';
import { useUiStore } from '@/src/stores/ui.store';
import { useSubAgentsStore } from '@/src/stores/subagents.store';
import { cn } from '@/src/lib/cn';
import { computeMentionState, type MentionState } from '@/src/hooks/useMentionAutocomplete';
import { MentionPopover } from './MentionPopover';

export interface MessageInputProps {
  onSend: (text: string) => void;
  onStop: () => void;
  isStreaming: boolean;
}

export function MessageInput({ onSend, onStop, isStreaming }: MessageInputProps) {
  const [value, setValue] = useState('');
  const [mention, setMention] = useState<MentionState>({ open: false, query: '', replaceRange: [0, 0] });
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const thinkingEnabled = useUiStore((s) => s.thinkingEnabled);
  const setThinkingEnabled = useUiStore((s) => s.setThinkingEnabled);
  const subAgents = useSubAgentsStore((s) => s.list);

  const onChange = (e: ChangeEvent<HTMLTextAreaElement>) => {
    setValue(e.target.value);
    const caret = e.target.selectionStart ?? e.target.value.length;
    setMention(computeMentionState(e.target.value, caret));
  };

  const submit = () => {
    const trimmed = value.trim();
    if (!trimmed) return;
    onSend(trimmed);
    setValue('');
    setMention({ open: false, query: '', replaceRange: [0, 0] });
  };

  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (mention.open) {
      return; // MentionPopover owns Enter/Tab/Esc/Arrow keys.
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  };

  const filteredItems = mention.open
    ? subAgents.filter((s) =>
        s.name.toLowerCase().startsWith(mention.query.toLowerCase()),
      )
    : [];

  const handleMentionSelect = (name: string) => {
    const [start, end] = mention.replaceRange;
    const next = `${value.slice(0, start)}@${name} ${value.slice(end)}`;
    setValue(next);
    setMention({ open: false, query: '', replaceRange: [0, 0] });
    setTimeout(() => {
      const ta = textareaRef.current;
      if (ta) {
        const caret = start + name.length + 2;
        ta.focus();
        ta.setSelectionRange(caret, caret);
      }
    }, 0);
  };

  const handleMentionClose = () =>
    setMention({ open: false, query: '', replaceRange: [0, 0] });

  return (
    <div className="border-t border-border-subtle bg-surface-2 p-3">
      <div className="flex items-end gap-2 relative">
        <button
          type="button"
          aria-label="Toggle thinking mode"
          aria-pressed={thinkingEnabled}
          onClick={() => setThinkingEnabled(!thinkingEnabled)}
          title={
            thinkingEnabled
              ? 'Thinking enabled (slower, shows reasoning)'
              : 'Thinking disabled'
          }
          className={cn(
            'p-2 rounded transition-colors',
            thinkingEnabled
              ? 'bg-accent/20 text-accent border border-accent/40'
              : 'bg-surface-1 text-zinc-500 border border-border-subtle hover:text-zinc-300',
          )}
        >
          <Brain size={16} />
        </button>
        <div className="flex-1 relative">
          <textarea
            ref={textareaRef}
            value={value}
            onChange={onChange}
            onKeyDown={onKey}
            disabled={isStreaming}
            placeholder={
              isStreaming
                ? 'Streaming…'
                : 'Scrivi un messaggio. Enter per inviare, Shift+Enter per a capo.'
            }
            rows={2}
            className="w-full bg-surface-1 border border-border-subtle rounded text-sm p-2 resize-none focus:outline-none focus:ring-1 focus:ring-accent disabled:opacity-50"
          />
          <MentionPopover
            open={mention.open}
            items={filteredItems}
            onSelect={handleMentionSelect}
            onClose={handleMentionClose}
          />
        </div>
        {isStreaming ? (
          <button
            type="button"
            aria-label="Stop"
            onClick={onStop}
            className="p-2 rounded bg-status-error/20 hover:bg-status-error/30 text-status-error"
          >
            <Square size={16} />
          </button>
        ) : (
          <button
            type="button"
            aria-label="Send"
            onClick={submit}
            className="p-2 rounded bg-accent/20 hover:bg-accent/30 text-accent disabled:opacity-30"
            disabled={!value.trim()}
          >
            <Send size={16} />
          </button>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run, expect PASS**

```bash
npx vitest run src/components/chat/MessageInput.test.tsx
```

- [ ] **Step 5: Lint + commit**

```bash
npm run lint
git add src/components/chat/MessageInput.tsx src/components/chat/MessageInput.test.tsx
git commit -m "feat(slice-6): MessageInput integrates mention autocomplete"
```

---

### Task H3: `SubAgentsSection` sidebar

**Files:**
- Create: `src/components/sidebar/SubAgentsSection.tsx`
- Create: `src/components/sidebar/SubAgentsSection.test.tsx`

- [ ] **Step 1: Write failing tests**

```tsx
// src/components/sidebar/SubAgentsSection.test.tsx
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { server } from '@/src/test/msw-server';
import { SubAgentsSection } from './SubAgentsSection';
import { DialogHost } from '@/src/components/layout/DialogHost';
import { useSubAgentsStore } from '@/src/stores/subagents.store';

beforeEach(() => {
  useSubAgentsStore.getState()._reset();
});

function renderSection() {
  return render(
    <>
      <DialogHost />
      <SubAgentsSection />
    </>,
  );
}

describe('SubAgentsSection', () => {
  it('renders empty state initially', () => {
    renderSection();
    expect(screen.getByText(/no sub-agents/i)).toBeInTheDocument();
  });

  it('renders existing sub-agents', () => {
    useSubAgentsStore.setState({
      list: [
        { id: 's1', name: 'designer', createdAt: 1, updatedAt: 1 },
        { id: 's2', name: 'coder', createdAt: 1, updatedAt: 1 },
      ],
      hydrated: true,
    });
    renderSection();
    expect(screen.getByText('designer')).toBeInTheDocument();
    expect(screen.getByText('coder')).toBeInTheDocument();
  });

  it('+ New sub-agent opens prompt chain and calls API', async () => {
    let captured: unknown = null;
    server.use(
      http.post('http://localhost/api/subagents', async ({ request }) => {
        captured = await request.json();
        return HttpResponse.json(
          { id: 'sX', name: 'designer', createdAt: 1, updatedAt: 1 },
          { status: 201 },
        );
      }),
    );
    renderSection();
    await userEvent.click(screen.getByRole('button', { name: /new sub-agent/i }));
    const nameInput = await screen.findByLabelText(/name/i);
    await userEvent.type(nameInput, 'designer');
    await userEvent.click(screen.getByRole('button', { name: /confirm/i }));
    const sysInput = await screen.findByLabelText(/system instruction/i);
    await userEvent.type(sysInput, 'Design things.');
    await userEvent.click(screen.getByRole('button', { name: /confirm/i }));
    await screen.findByText('designer');
    expect((captured as { name?: string }).name).toBe('designer');
  });

  it('Delete button calls API + removes row', async () => {
    useSubAgentsStore.setState({
      list: [{ id: 's1', name: 'designer', createdAt: 1, updatedAt: 1 }],
      hydrated: true,
    });
    server.use(
      http.delete('http://localhost/api/subagents/s1', () => new HttpResponse(null, { status: 204 })),
    );
    renderSection();
    await userEvent.hover(screen.getByText('designer'));
    await userEvent.click(screen.getByRole('button', { name: /delete designer/i }));
    await userEvent.click(screen.getByRole('button', { name: /confirm/i }));
    expect(useSubAgentsStore.getState().list).toHaveLength(0);
  });

  it('shows error pill when store.error is set', () => {
    useSubAgentsStore.setState({ list: [], hydrated: true, error: 'Boom' });
    renderSection();
    expect(screen.getByText(/Boom/)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run, expect FAIL**

```bash
npx vitest run src/components/sidebar/SubAgentsSection.test.tsx
```

- [ ] **Step 3: Implement `src/components/sidebar/SubAgentsSection.tsx`**

```tsx
import { useSubAgentsStore } from '@/src/stores/subagents.store';
import { useDialog } from '@/src/hooks/useDialog';

export function SubAgentsSection() {
  const list = useSubAgentsStore((s) => s.list);
  const error = useSubAgentsStore((s) => s.error);
  const create = useSubAgentsStore((s) => s.create);
  const remove = useSubAgentsStore((s) => s.delete);
  const clearError = useSubAgentsStore((s) => s.clearError);
  const dialog = useDialog();

  const handleAdd = async () => {
    const name = await dialog.prompt({
      title: 'New sub-agent',
      label: 'Name',
      required: true,
    });
    if (!name) return;
    const systemInstruction = await dialog.prompt({
      title: 'New sub-agent',
      label: 'System instruction',
      multiline: true,
    });
    if (systemInstruction === null) return;
    await create({ name, systemInstruction }).catch(() => {});
  };

  const handleDelete = async (id: string, name: string) => {
    const ok = await dialog.confirm({
      title: 'Delete sub-agent',
      message: `Delete "${name}"?`,
      destructive: true,
    });
    if (ok) await remove(id).catch(() => {});
  };

  return (
    <section>
      <div className="flex items-center justify-between mb-2">
        <div className="mono-label">Sub-agents</div>
        <span className="text-[10px] text-zinc-600">[{list.length}]</span>
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
        {list.length === 0 ? (
          <div className="text-[10px] text-zinc-600 font-mono italic">
            No sub-agents defined.
          </div>
        ) : (
          list.map((sa) => (
            <div
              key={sa.id}
              className="group flex items-center justify-between p-1.5 rounded bg-zinc-900 border border-border-subtle text-[10px] font-mono text-zinc-400"
            >
              <span className="truncate">{sa.name}</span>
              <div className="hidden group-hover:flex gap-1">
                <button
                  type="button"
                  onClick={() => handleDelete(sa.id, sa.name)}
                  aria-label={`Delete ${sa.name}`}
                  className="hover:text-red-400"
                >
                  ×
                </button>
              </div>
            </div>
          ))
        )}
        <button
          type="button"
          onClick={handleAdd}
          aria-label="New sub-agent"
          className="w-full p-1 border border-dashed border-border-subtle rounded text-[10px] text-zinc-600 hover:text-zinc-400 transition-colors mt-2"
        >
          + New sub-agent
        </button>
      </div>
    </section>
  );
}
```

- [ ] **Step 4: Run, expect PASS**

```bash
npx vitest run src/components/sidebar/SubAgentsSection.test.tsx
```

- [ ] **Step 5: Lint + commit**

```bash
npm run lint
git add src/components/sidebar/SubAgentsSection.tsx src/components/sidebar/SubAgentsSection.test.tsx
git commit -m "feat(slice-6): add SubAgentsSection (sidebar CRUD)"
```

---

### Task H4: `ReasoningStepCard` labels + colors for `resolve_subagent`

**Files:**
- Modify: `src/components/reasoning/ReasoningStepCard.tsx`
- Modify: `src/components/reasoning/ReasoningStepCard.test.tsx`

- [ ] **Step 1: Append a failing test**

```tsx
// Inside src/components/reasoning/ReasoningStepCard.test.tsx, append:
it('renders resolve_subagent step with badge label and subAgent name', () => {
  render(
    <ReasoningStepCard
      step={{
        id: '1',
        type: 'resolve_subagent',
        title: 'Sub-agent: designer',
        content: 'systemInstruction +12 chars, +1 skills, +0 tools',
        subAgent: 'designer',
        timestamp: 0,
      }}
    />,
  );
  expect(screen.getByText(/subagent/i)).toBeInTheDocument();
  expect(screen.getByText('designer')).toBeInTheDocument();
  expect(screen.getByText('Sub-agent: designer')).toBeInTheDocument();
});
```

- [ ] **Step 2: Run, expect FAIL**

```bash
npx vitest run src/components/reasoning/ReasoningStepCard.test.tsx
```

- [ ] **Step 3: Modify `src/components/reasoning/ReasoningStepCard.tsx`**

Add the new variant to both `TYPE_LABELS` and `TYPE_COLORS`:

```tsx
const TYPE_LABELS: Record<ReasoningStepType, string> = {
  context_fetch: 'context',
  mcp_query: 'mcp',
  dispatch: 'dispatch',
  thinking: 'thinking',
  validation: 'validation',
  logic: 'logic',
  resolve_subagent: 'subagent',
};

const TYPE_COLORS: Record<ReasoningStepType, string> = {
  context_fetch: 'bg-blue-500/10 text-blue-400',
  mcp_query: 'bg-cyan-500/10 text-cyan-400',
  dispatch: 'bg-purple-500/10 text-purple-400',
  thinking: 'bg-purple-500/10 text-purple-300',
  validation: 'bg-green-500/10 text-green-400',
  logic: 'bg-zinc-800 text-zinc-400',
  resolve_subagent: 'bg-amber-500/10 text-amber-300',
};
```

No other change is needed — the existing `<DispatchBranch subAgent={step.subAgent} />` already renders the persona badge.

- [ ] **Step 4: Run, expect PASS**

```bash
npx vitest run src/components/reasoning/ReasoningStepCard.test.tsx
```

- [ ] **Step 5: Lint + commit**

```bash
npm run lint
git add src/components/reasoning/ReasoningStepCard.tsx src/components/reasoning/ReasoningStepCard.test.tsx
git commit -m "feat(slice-6): ReasoningStepCard +resolve_subagent badge"
```

---

## Phase I — App integration

### Task I1: Wire `useSubAgentsStore` + `SubAgentsSection` into `App.tsx`

**Files:**
- Modify: `src/App.tsx`
- Modify: `src/App.test.tsx`

- [ ] **Step 1: Append failing test in `src/App.test.tsx`**

Add to the existing `describe('App', ...)` block:

```tsx
import { useSubAgentsStore } from '@/src/stores/subagents.store';

it('mounts SubAgentsSection in sidebar', () => {
  render(<App />);
  expect(screen.getByText(/sub-agents/i)).toBeInTheDocument();
});
```

Also add `useSubAgentsStore.getState()._reset();` to the existing `beforeEach` block.

- [ ] **Step 2: Run, expect FAIL**

```bash
npx vitest run src/App.test.tsx
```

- [ ] **Step 3: Modify `src/App.tsx`**

Add imports next to the other sidebar section imports:

```tsx
import { SubAgentsSection } from '@/src/components/sidebar/SubAgentsSection';
import { useSubAgentsStore } from '@/src/stores/subagents.store';
```

Add the init action selector and call:

```tsx
  const initSubAgents = useSubAgentsStore((s) => s.init);
  // ...
  useEffect(() => {
    initContext();
    initSessions();
    initUi();
    initProfiles();
    initSubAgents();
  }, [initContext, initSessions, initUi, initProfiles, initSubAgents]);
```

Mount the section in the sidebar, after `<McpServersSection />`:

```tsx
            <SessionsSection />
            <SystemProtocolSection />
            <SkillsSection />
            <ToolsSection />
            <McpServersSection />
            <SubAgentsSection />
```

- [ ] **Step 4: Run, expect PASS**

```bash
npx vitest run src/App.test.tsx
```

- [ ] **Step 5: Run full frontend suite**

```bash
npx vitest run src
```

Expected: ALL PASS.

- [ ] **Step 6: Lint + commit**

```bash
npm run lint
git add src/App.tsx src/App.test.tsx
git commit -m "feat(slice-6): App.tsx mounts SubAgentsSection + initSubAgents"
```

---

## Phase J — Integration test

### Task J1: App-level mention flow

**Files:**
- Create: `src/integration/subagent.integration.test.tsx`

- [ ] **Step 1: Write the test**

```tsx
// src/integration/subagent.integration.test.tsx
import { describe, it, expect, beforeEach } from 'vitest';
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

beforeEach(() => {
  useUiStore.getState()._reset();
  useSessionsStore.getState()._reset();
  useProfilesStore.getState()._reset();
  useContextStore.getState()._reset();
  useSubAgentsStore.getState()._reset();
  localStorage.clear();
});

describe('subagent integration', () => {
  it('FE sends the original @name message to the backend', async () => {
    server.use(
      http.get('http://localhost/api/subagents', () =>
        HttpResponse.json({
          subAgents: [{ id: 's1', name: 'designer', createdAt: 1, updatedAt: 1 }],
        }),
      ),
    );

    let capturedBody: unknown = null;
    server.use(
      http.post('http://localhost/api/dispatch', async ({ request }) => {
        capturedBody = await request.json();
        return new HttpResponse(
          'event: done\ndata: {"model":"fake","interrupted":false,"reasoningSteps":[]}\n\n',
          {
            status: 200,
            headers: { 'content-type': 'text/event-stream' },
          },
        );
      }),
    );

    const user = userEvent.setup();
    render(<App />);

    await waitFor(() =>
      expect(useSubAgentsStore.getState().hydrated).toBe(true),
    );

    const ta = screen.getByPlaceholderText(/scrivi un messaggio/i);
    await user.click(ta);
    await user.type(ta, '@designer ciao');
    await user.keyboard('{Enter}');

    await waitFor(() => {
      expect((capturedBody as { message?: string })?.message).toBe('@designer ciao');
    });
  });
});
```

- [ ] **Step 2: Run, expect PASS**

```bash
npx vitest run src/integration/subagent.integration.test.tsx
```

- [ ] **Step 3: Lint + commit**

```bash
npm run lint
git add src/integration/subagent.integration.test.tsx
git commit -m "test(slice-6): integration — FE sends original @name message"
```

---

## Phase K — E2E

### Task K1: Playwright test (write only — port 3000 blocked locally)

**Files:**
- Modify: `e2e/smoke.spec.ts`

- [ ] **Step 1: Append the test**

Append inside `e2e/smoke.spec.ts` after the `palette: ⌘K → new session via palette` test:

```ts
test('subagent: create + invoke + reasoning badge', async ({ page, request }) => {
  const list = await request.get('/api/subagents').then((r) => r.json());
  for (const s of list.subAgents as { id: string }[]) {
    await request.delete(`/api/subagents/${s.id}`);
  }

  await page.goto('/');
  await expect(page.getByText('AETHER_CORE')).toBeVisible();

  const sidebar = page.getByRole('complementary', { name: /sidebar/i });
  await sidebar.getByRole('button', { name: /new sub-agent/i }).click();

  const nameDialog = page.getByRole('dialog');
  await nameDialog.getByRole('textbox').fill('designer');
  await nameDialog.getByRole('button', { name: /confirm/i }).click();

  const sysDialog = page.getByRole('dialog');
  await sysDialog.getByRole('textbox').fill('You are a designer.');
  await sysDialog.getByRole('button', { name: /confirm/i }).click();

  await expect(sidebar.getByText('designer')).toBeVisible({ timeout: 5000 });

  const ta = page.getByPlaceholder(/scrivi un messaggio/i);
  await ta.fill('@designer ping');
  await ta.press('Enter');

  await expect(page.getByText('pong').first()).toBeVisible({ timeout: 5000 });

  await page.getByRole('button', { name: /toggle reasoning/i }).click();
  const drawer = page.getByRole('complementary', { name: /reasoning/i });
  await expect(drawer.getByText(/sub-agent: designer/i)).toBeVisible({ timeout: 5000 });
});
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npm run lint
```

Expected: clean.

- [ ] **Step 3: Commit (do NOT run Playwright locally)**

```bash
git add e2e/smoke.spec.ts
git commit -m "test(slice-6): playwright — create + invoke sub-agent end-to-end"
```

---

## Phase L — Final verification + PR

### Task L1: lint + full vitest + push + open PR

- [ ] **Step 1: Lint**

```bash
npm run lint
```

Expected: PASS.

- [ ] **Step 2: Vitest full**

```bash
npm run test:run
```

Expected: ALL PASS.

- [ ] **Step 3: Coverage spot-check**

```bash
npm run test:coverage
```

Expected: ≥80% lines on `subagent-parser.ts`, `prompt-assembler.ts`, `subagents.store.ts` (BE + FE), `subagents.routes.ts`, `useMentionAutocomplete.ts`, `MentionPopover.tsx`, `subagents.api.ts`.

- [ ] **Step 4: Push branch**

```bash
git push -u origin feat/slice-6-subagent
```

- [ ] **Step 5: Open PR**

```bash
gh pr create --base main --title "feat(slice-6): sub-agent dispatch" --body "$(cat <<'EOF'
## Summary
- New sub-agents stored at `/api/subagents` + `data/subagents.json` (`SubAgentsStore`).
- Chat messages starting with `@name` resolve to a sub-agent: its system instruction is appended to the active context and its skills/tools union into the assembled prompt. The `@name` token is stripped before reaching the model.
- New reasoning step type `resolve_subagent` + `subAgent` field on the dispatch step.
- Sidebar `SubAgentsSection` for CRUD; inline `MentionPopover` autocomplete on `@` in `MessageInput`.

## Test plan
- [x] `npm run lint` clean
- [x] `npm run test:run` all green
- [x] `npm run test:coverage` — ≥80% on new files
- [ ] Playwright `subagent: create + invoke + reasoning badge` committed; not run locally (port 3000 blocked)

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

Expected: PR URL printed.

---

## Definition of Done

- All new BE + FE unit / component / integration tests green.
- `npm run lint` clean.
- Coverage ≥80% on new files listed above.
- Sidebar `SubAgentsSection` lets the user create / delete a sub-agent.
- Chatting `@<name> hello` in `MessageInput` strips the leading mention server-side and surfaces `Sub-agent: <name>` in the reasoning drawer.
- One PR on `feat/slice-6-subagent` against `main`.
