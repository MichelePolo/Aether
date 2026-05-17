# Aether Slice 1: Context CRUD + Persistenza — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Sostituire il prototipo App.tsx con la prima feature reale — sidebar funzionante che permette di editare system instruction, skills, tools, MCP server, con persistenza su `data/context.json` validata via zod.

**Architecture:** Backend con `context.store` (JsonStore + zod schema) + route Express CRUD via `createApp({ contextStore })`. Frontend con store Zustand + API typed + sidebar componibile (AppShell → Sidebar → SystemProtocolSection/SkillsSection/ToolsSection/McpServersSection) + nuovo `App.tsx` che sostituisce il legacy. Chiamate ai dialog vanno via `useDialog` (slice 0).

**Tech stack:** zustand (nuovo), zod (esistente da slice 0), JsonStore + createApp (da slice 0), useDialog/Modal/Button/IconButton/Panel/StatusDot/Badge primitives (da slice 0).

**Reference spec:** `docs/superpowers/specs/2026-05-17-aether-rewrite-design.md`

---

## File structure creato/modificato

```
package.json                                       # add zustand
server/domain/context/context.types.ts             # NEW
server/domain/context/context.schema.ts            # NEW
server/domain/context/context.schema.test.ts       # NEW
server/domain/context/context.store.ts             # NEW
server/domain/context/context.store.test.ts       # NEW
server/routes/context.routes.ts                    # NEW
server/routes/context.routes.test.ts               # NEW
server/app.ts                                      # MODIFY: wire context routes via deps
server/app.test.ts                                 # MODIFY: pass contextStore in tests
server/index.ts                                    # NEW: bootstrap (replaces server.ts)
server.ts                                          # DELETE (replaced by server/index.ts)
src/types/context.types.ts                         # NEW (re-export server types for FE)
src/lib/api/context.api.ts                         # NEW
src/lib/api/context.api.test.ts                    # NEW (via MSW)
src/stores/context.store.ts                        # NEW (zustand)
src/stores/context.store.test.ts                   # NEW
src/components/layout/AppShell.tsx                 # NEW
src/components/layout/AppShell.test.tsx            # NEW
src/components/layout/TopBar.tsx                   # NEW
src/components/layout/TopBar.test.tsx              # NEW
src/components/layout/Sidebar.tsx                  # NEW
src/components/layout/Sidebar.test.tsx             # NEW
src/components/sidebar/SystemProtocolSection.tsx   # NEW
src/components/sidebar/SystemProtocolSection.test.tsx # NEW
src/components/sidebar/SkillsSection.tsx           # NEW
src/components/sidebar/SkillsSection.test.tsx      # NEW
src/components/sidebar/ToolsSection.tsx            # NEW
src/components/sidebar/ToolsSection.test.tsx       # NEW
src/components/sidebar/McpServersSection.tsx       # NEW
src/components/sidebar/McpServersSection.test.tsx  # NEW
src/components/sidebar/ConnectionFooter.tsx        # NEW
src/components/sidebar/ConnectionFooter.test.tsx   # NEW
src/App.tsx                                        # REWRITE (delete legacy, new shell)
src/main.tsx                                       # MODIFY: remove @ts-nocheck
src/test/msw-handlers.ts                           # MODIFY: add /api/context handlers
e2e/smoke.spec.ts                                  # MODIFY: assert new UI elements
```

---

## Phase A: Install zustand + add types

### Task A1: Install zustand

```bash
npm install zustand
```

### Task A2: Define context types (shared)

Create `server/domain/context/context.types.ts`:

```ts
export interface Tool {
  id: string;
  name: string;
  version: string;
  status: 'online' | 'offline';
}

export interface McpServerConfig {
  id: string;
  name: string;
  url: string;
  status: 'online' | 'offline' | 'connecting';
}

export interface AetherContext {
  systemInstruction: string;
  skills: string[];
  tools: Tool[];
  mcpServers: McpServerConfig[];
}
```

Create `src/types/context.types.ts`:

```ts
export type { Tool, McpServerConfig, AetherContext } from '@/server/domain/context/context.types';
```

**Commit:** `chore(slice-1): install zustand + define AetherContext types`

---

## Phase B: Backend context schema + store (TDD)

### Task B1: zod schemas

**Files:** `server/domain/context/context.schema.ts`, `server/domain/context/context.schema.test.ts`

**Tests (RED):**

```ts
import { describe, it, expect } from 'vitest';
import { ToolSchema, McpServerSchema, AetherContextSchema, AetherContextPatchSchema } from './context.schema';

describe('context schemas', () => {
  it('Tool parses valid input', () => {
    const t = { id: '1', name: 'GoogleSearch', version: '1.2.0', status: 'online' as const };
    expect(ToolSchema.parse(t)).toEqual(t);
  });

  it('Tool rejects invalid status', () => {
    expect(() => ToolSchema.parse({ id: '1', name: 'X', version: '1', status: 'busy' })).toThrow();
  });

  it('McpServer parses with valid status', () => {
    const s = { id: 'a', name: 'srv', url: 'http://x', status: 'connecting' as const };
    expect(McpServerSchema.parse(s)).toEqual(s);
  });

  it('AetherContext rejects skills with non-string items', () => {
    expect(() => AetherContextSchema.parse({
      systemInstruction: 'x', skills: [1, 2], tools: [], mcpServers: [],
    })).toThrow();
  });

  it('AetherContext accepts empty arrays', () => {
    const ctx = { systemInstruction: '', skills: [], tools: [], mcpServers: [] };
    expect(AetherContextSchema.parse(ctx)).toEqual(ctx);
  });

  it('AetherContextPatch makes all fields optional', () => {
    expect(AetherContextPatchSchema.parse({})).toEqual({});
    expect(AetherContextPatchSchema.parse({ skills: ['a'] })).toEqual({ skills: ['a'] });
  });

  it('AetherContextPatch rejects unknown fields', () => {
    expect(() => AetherContextPatchSchema.parse({ badField: 1 })).toThrow();
  });
});
```

**Implementation (GREEN):**

```ts
import { z } from 'zod';

export const ToolSchema = z.object({
  id: z.string(),
  name: z.string(),
  version: z.string(),
  status: z.enum(['online', 'offline']),
});

export const McpServerSchema = z.object({
  id: z.string(),
  name: z.string(),
  url: z.string(),
  status: z.enum(['online', 'offline', 'connecting']),
});

export const AetherContextSchema = z.object({
  systemInstruction: z.string(),
  skills: z.array(z.string()),
  tools: z.array(ToolSchema),
  mcpServers: z.array(McpServerSchema),
});

export const AetherContextPatchSchema = AetherContextSchema.partial().strict();
```

**Commit:** `feat(slice-1): add zod schemas for AetherContext + Tool + McpServer`

---

### Task B2: ContextStore (TDD)

**Files:** `server/domain/context/context.store.ts`, `server/domain/context/context.store.test.ts`

The store wraps JsonStore + offers domain operations (addSkill, removeSkill, addTool, ecc.).

**Tests (RED):** Use a tmpdir + path per test. Cover: defaults on empty, full read/write, patch (partial update), addSkill, removeSkillByIndex, addTool (generates id), updateTool, removeTool, addMcpServer, removeMcpServer, bulkOverwrite (validates), persistence across instances.

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ContextStore, defaultContext } from './context.store';

let dir: string;
let store: ContextStore;

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'aether-ctx-'));
  store = new ContextStore(path.join(dir, 'context.json'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('ContextStore', () => {
  it('returns default context when file missing', async () => {
    expect(await store.read()).toEqual(defaultContext);
  });

  it('applies a patch (partial update)', async () => {
    await store.patch({ systemInstruction: 'You are Aether.' });
    const ctx = await store.read();
    expect(ctx.systemInstruction).toBe('You are Aether.');
    expect(ctx.skills).toEqual(defaultContext.skills);
  });

  it('addSkill appends to skills', async () => {
    await store.addSkill('AnalysisV2');
    expect((await store.read()).skills).toContain('AnalysisV2');
  });

  it('addSkill rejects empty string', async () => {
    await expect(store.addSkill('  ')).rejects.toThrow();
  });

  it('updateSkillAt replaces by index', async () => {
    await store.patch({ skills: ['a', 'b', 'c'] });
    await store.updateSkillAt(1, 'B');
    expect((await store.read()).skills).toEqual(['a', 'B', 'c']);
  });

  it('updateSkillAt throws on out-of-bounds', async () => {
    await store.patch({ skills: ['a'] });
    await expect(store.updateSkillAt(5, 'x')).rejects.toThrow();
  });

  it('removeSkillAt removes by index', async () => {
    await store.patch({ skills: ['a', 'b', 'c'] });
    await store.removeSkillAt(1);
    expect((await store.read()).skills).toEqual(['a', 'c']);
  });

  it('addTool generates id and appends', async () => {
    const tool = await store.addTool({ name: 'Search', version: '1.0.0', status: 'online' });
    expect(tool.id).toMatch(/.+/);
    const ctx = await store.read();
    expect(ctx.tools).toContainEqual(tool);
  });

  it('updateTool by id replaces fields', async () => {
    const tool = await store.addTool({ name: 'Search', version: '1.0.0', status: 'online' });
    await store.updateTool(tool.id, { version: '2.0.0' });
    const updated = (await store.read()).tools.find((t) => t.id === tool.id);
    expect(updated?.version).toBe('2.0.0');
    expect(updated?.name).toBe('Search');
  });

  it('removeTool by id', async () => {
    const tool = await store.addTool({ name: 'X', version: '1.0', status: 'offline' });
    await store.removeTool(tool.id);
    expect((await store.read()).tools.find((t) => t.id === tool.id)).toBeUndefined();
  });

  it('addMcpServer generates id', async () => {
    const s = await store.addMcpServer({ name: 'mock', url: 'http://x', status: 'connecting' });
    expect(s.id).toMatch(/.+/);
  });

  it('removeMcpServer by id', async () => {
    const s = await store.addMcpServer({ name: 'mock', url: 'http://x', status: 'online' });
    await store.removeMcpServer(s.id);
    expect((await store.read()).mcpServers).toHaveLength(0);
  });

  it('bulkOverwrite validates and replaces all fields', async () => {
    const next = {
      systemInstruction: 'Hi',
      skills: ['s1'],
      tools: [{ id: 't1', name: 'T', version: '1.0', status: 'online' as const }],
      mcpServers: [],
    };
    await store.bulkOverwrite(next);
    expect(await store.read()).toEqual(next);
  });

  it('bulkOverwrite rejects invalid shape', async () => {
    await expect(store.bulkOverwrite({ systemInstruction: 1 } as never)).rejects.toThrow();
  });

  it('persists across instances', async () => {
    await store.addSkill('persisted');
    const fresh = new ContextStore(path.join(dir, 'context.json'));
    expect((await fresh.read()).skills).toContain('persisted');
  });
});
```

**Implementation (GREEN):**

```ts
import { JsonStore } from '@/server/lib/json-store';
import { ValidationError, NotFoundError } from '@/server/lib/errors';
import {
  AetherContextSchema,
  ToolSchema,
  McpServerSchema,
} from './context.schema';
import type { AetherContext, Tool, McpServerConfig } from './context.types';
import { randomUUID } from 'node:crypto';

export const defaultContext: AetherContext = {
  systemInstruction:
    'You are Aether, an advanced AI development agent. You provide transparent reasoning and can dispatch sub-agents.',
  skills: [],
  tools: [],
  mcpServers: [],
};

export class ContextStore {
  private json: JsonStore<AetherContext>;

  constructor(filePath: string) {
    this.json = new JsonStore(filePath, AetherContextSchema, defaultContext);
  }

  read(): Promise<AetherContext> {
    return this.json.read();
  }

  async patch(partial: Partial<AetherContext>): Promise<AetherContext> {
    return this.json.update((cur) => ({ ...cur, ...partial }));
  }

  async bulkOverwrite(next: AetherContext): Promise<AetherContext> {
    const parsed = AetherContextSchema.safeParse(next);
    if (!parsed.success) throw new ValidationError('Invalid context payload', parsed.error);
    return this.json.update(() => parsed.data);
  }

  async addSkill(name: string): Promise<void> {
    if (!name.trim()) throw new ValidationError('Skill name cannot be empty');
    await this.json.update((cur) => ({ ...cur, skills: [...cur.skills, name.trim()] }));
  }

  async updateSkillAt(index: number, value: string): Promise<void> {
    if (!value.trim()) throw new ValidationError('Skill name cannot be empty');
    await this.json.update((cur) => {
      if (index < 0 || index >= cur.skills.length) {
        throw new NotFoundError(`skill index ${index}`);
      }
      const next = [...cur.skills];
      next[index] = value.trim();
      return { ...cur, skills: next };
    });
  }

  async removeSkillAt(index: number): Promise<void> {
    await this.json.update((cur) => {
      if (index < 0 || index >= cur.skills.length) {
        throw new NotFoundError(`skill index ${index}`);
      }
      return { ...cur, skills: cur.skills.filter((_, i) => i !== index) };
    });
  }

  async addTool(input: Omit<Tool, 'id'>): Promise<Tool> {
    const parsed = ToolSchema.omit({ id: true }).safeParse(input);
    if (!parsed.success) throw new ValidationError('Invalid tool', parsed.error);
    const tool: Tool = { ...parsed.data, id: randomUUID() };
    await this.json.update((cur) => ({ ...cur, tools: [...cur.tools, tool] }));
    return tool;
  }

  async updateTool(id: string, patch: Partial<Omit<Tool, 'id'>>): Promise<void> {
    await this.json.update((cur) => {
      const idx = cur.tools.findIndex((t) => t.id === id);
      if (idx === -1) throw new NotFoundError(`tool ${id}`);
      const merged = { ...cur.tools[idx], ...patch };
      const validated = ToolSchema.safeParse(merged);
      if (!validated.success) throw new ValidationError('Invalid tool patch', validated.error);
      const tools = [...cur.tools];
      tools[idx] = validated.data;
      return { ...cur, tools };
    });
  }

  async removeTool(id: string): Promise<void> {
    await this.json.update((cur) => {
      if (!cur.tools.some((t) => t.id === id)) throw new NotFoundError(`tool ${id}`);
      return { ...cur, tools: cur.tools.filter((t) => t.id !== id) };
    });
  }

  async addMcpServer(input: Omit<McpServerConfig, 'id'>): Promise<McpServerConfig> {
    const parsed = McpServerSchema.omit({ id: true }).safeParse(input);
    if (!parsed.success) throw new ValidationError('Invalid MCP server', parsed.error);
    const srv: McpServerConfig = { ...parsed.data, id: randomUUID() };
    await this.json.update((cur) => ({ ...cur, mcpServers: [...cur.mcpServers, srv] }));
    return srv;
  }

  async removeMcpServer(id: string): Promise<void> {
    await this.json.update((cur) => {
      if (!cur.mcpServers.some((s) => s.id === id)) throw new NotFoundError(`mcp server ${id}`);
      return { ...cur, mcpServers: cur.mcpServers.filter((s) => s.id !== id) };
    });
  }
}
```

**Commit:** `feat(slice-1): add ContextStore with CRUD + zod validation`

---

## Phase C: Context routes + wire createApp (TDD)

### Task C1: Express routes (TDD)

**Files:** `server/routes/context.routes.ts`, `server/routes/context.routes.test.ts`

Endpoint design:
- `GET /api/context` → `AetherContext`
- `PATCH /api/context` body `Partial<AetherContext>` → updated `AetherContext`
- `PUT /api/context` body `AetherContext` → overwrite (validated)
- `POST /api/context/skills` body `{ name }` → 201
- `PATCH /api/context/skills/:index` body `{ value }` → 200
- `DELETE /api/context/skills/:index` → 204
- `POST /api/context/tools` body `Tool minus id` → 201 with tool
- `PATCH /api/context/tools/:id` body `Partial<Tool>` → 200
- `DELETE /api/context/tools/:id` → 204
- `POST /api/context/mcp-servers` body `McpServer minus id` → 201
- `DELETE /api/context/mcp-servers/:id` → 204

**Tests:** supertest contro `createApp({ contextStore })` con un `ContextStore` su tmpdir. Coverage: 200 happy paths, 400 su body invalido, 404 su id/index inesistente.

**Implementation (GREEN):** Express router che chiama lo store, gestisce zod-thrown ValidationError → 400, NotFoundError → 404 (via error middleware esistente).

Skeleton implementation:

```ts
import { Router, type Request, type Response, type NextFunction } from 'express';
import type { ContextStore } from '@/server/domain/context/context.store';
import { AetherContextPatchSchema, AetherContextSchema, ToolSchema, McpServerSchema } from '@/server/domain/context/context.schema';
import { ValidationError } from '@/server/lib/errors';
import { z } from 'zod';

export function createContextRoutes(store: ContextStore): Router {
  const router = Router();

  router.get('/', async (_req, res, next) => {
    try { res.json(await store.read()); } catch (e) { next(e); }
  });

  router.patch('/', async (req, res, next) => {
    try {
      const parsed = AetherContextPatchSchema.safeParse(req.body);
      if (!parsed.success) throw new ValidationError('Invalid patch', parsed.error);
      res.json(await store.patch(parsed.data));
    } catch (e) { next(e); }
  });

  router.put('/', async (req, res, next) => {
    try {
      const parsed = AetherContextSchema.safeParse(req.body);
      if (!parsed.success) throw new ValidationError('Invalid context', parsed.error);
      res.json(await store.bulkOverwrite(parsed.data));
    } catch (e) { next(e); }
  });

  const SkillBody = z.object({ name: z.string().min(1) });
  router.post('/skills', async (req, res, next) => {
    try {
      const { name } = SkillBody.parse(req.body);
      await store.addSkill(name);
      res.status(201).json({ status: 'ok' });
    } catch (e) { next(e); }
  });

  const SkillUpdateBody = z.object({ value: z.string().min(1) });
  router.patch('/skills/:index', async (req, res, next) => {
    try {
      const index = parseInt(req.params.index, 10);
      if (Number.isNaN(index)) throw new ValidationError('Invalid index');
      const { value } = SkillUpdateBody.parse(req.body);
      await store.updateSkillAt(index, value);
      res.json({ status: 'ok' });
    } catch (e) { next(e); }
  });

  router.delete('/skills/:index', async (req, res, next) => {
    try {
      const index = parseInt(req.params.index, 10);
      if (Number.isNaN(index)) throw new ValidationError('Invalid index');
      await store.removeSkillAt(index);
      res.status(204).end();
    } catch (e) { next(e); }
  });

  router.post('/tools', async (req, res, next) => {
    try {
      const parsed = ToolSchema.omit({ id: true }).safeParse(req.body);
      if (!parsed.success) throw new ValidationError('Invalid tool', parsed.error);
      const tool = await store.addTool(parsed.data);
      res.status(201).json(tool);
    } catch (e) { next(e); }
  });

  router.patch('/tools/:id', async (req, res, next) => {
    try {
      const parsed = ToolSchema.omit({ id: true }).partial().safeParse(req.body);
      if (!parsed.success) throw new ValidationError('Invalid tool patch', parsed.error);
      await store.updateTool(req.params.id, parsed.data);
      res.json({ status: 'ok' });
    } catch (e) { next(e); }
  });

  router.delete('/tools/:id', async (req, res, next) => {
    try {
      await store.removeTool(req.params.id);
      res.status(204).end();
    } catch (e) { next(e); }
  });

  router.post('/mcp-servers', async (req, res, next) => {
    try {
      const parsed = McpServerSchema.omit({ id: true }).safeParse(req.body);
      if (!parsed.success) throw new ValidationError('Invalid mcp server', parsed.error);
      const srv = await store.addMcpServer(parsed.data);
      res.status(201).json(srv);
    } catch (e) { next(e); }
  });

  router.delete('/mcp-servers/:id', async (req, res, next) => {
    try {
      await store.removeMcpServer(req.params.id);
      res.status(204).end();
    } catch (e) { next(e); }
  });

  return router;
}
```

**Commit:** `feat(slice-1): add /api/context routes with CRUD + validation`

---

### Task C2: Wire createApp with contextStore + write bootstrap

**Files:** `server/app.ts` (modify), `server/app.test.ts` (modify), `server/index.ts` (NEW), delete `server.ts`

#### Modify server/app.ts

```ts
import express, { type Express, type NextFunction, type Request, type Response } from 'express';
import { isAppError } from './lib/errors';
import type { ContextStore } from './domain/context/context.store';
import { createContextRoutes } from './routes/context.routes';

export interface AppDeps {
  contextStore?: ContextStore;
}

export function createApp(deps: AppDeps, extraRoutes?: (app: Express) => void): Express {
  const app = express();
  app.use(express.json({ limit: '1mb' }));

  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok' });
  });

  if (deps.contextStore) {
    app.use('/api/context', createContextRoutes(deps.contextStore));
  }

  extraRoutes?.(app);

  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (isAppError(err)) {
      res.status(err.status).json({ error: { code: err.code, message: err.message } });
      return;
    }
    const message = err instanceof Error ? err.message : 'Unknown error';
    res.status(500).json({ error: { code: 'INTERNAL', message } });
  });

  return app;
}
```

#### Modify server/app.test.ts

Existing tests still pass with `createApp({})`. Add a test that verifies routes are mounted when contextStore is passed.

#### Create server/index.ts (bootstrap)

```ts
import { ContextStore } from './domain/context/context.store';
import { createApp } from './app';
import path from 'node:path';
import { createServer as createViteServer } from 'vite';

const DATA_DIR = process.env.AETHER_DATA_DIR ?? path.resolve(process.cwd(), 'data');
const PORT = parseInt(process.env.PORT ?? '3000', 10);

async function bootstrap() {
  const contextStore = new ContextStore(path.join(DATA_DIR, 'context.json'));

  const app = createApp({ contextStore });

  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const express = (await import('express')).default;
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Aether server running on http://localhost:${PORT}`);
  });
}

bootstrap().catch((err) => {
  console.error('Bootstrap failed:', err);
  process.exit(1);
});
```

#### Delete server.ts (legacy)

```bash
rm server.ts
```

#### Update package.json scripts (point dev to new bootstrap)

In `package.json`, change `"dev": "tsx server.ts"` to `"dev": "tsx server/index.ts"`. Same for build: `esbuild server/index.ts` instead of `server.ts`. Clean script update too.

**Commit:** `feat(slice-1): wire createApp with context routes + new bootstrap at server/index.ts (drops legacy server.ts)`

---

## Phase D: Frontend API layer (TDD)

### Task D1: Context API client

**Files:** `src/lib/api/context.api.ts`, `src/lib/api/context.api.test.ts`

Wraps typed `fetch` calls. Tests use MSW handlers.

**Tests:**

```ts
import { describe, it, expect } from 'vitest';
import { http, HttpResponse } from 'msw';
import { server } from '@/src/test/msw-server';
import { contextApi } from './context.api';

describe('contextApi', () => {
  it('fetches context', async () => {
    server.use(
      http.get('http://localhost/api/context', () =>
        HttpResponse.json({
          systemInstruction: 'Hi',
          skills: ['a'],
          tools: [],
          mcpServers: [],
        }),
      ),
    );
    const ctx = await contextApi.get();
    expect(ctx.systemInstruction).toBe('Hi');
  });

  it('patches context', async () => {
    server.use(
      http.patch('http://localhost/api/context', async ({ request }) => {
        const body = await request.json() as { systemInstruction: string };
        return HttpResponse.json({ systemInstruction: body.systemInstruction, skills: [], tools: [], mcpServers: [] });
      }),
    );
    const ctx = await contextApi.patch({ systemInstruction: 'Updated' });
    expect(ctx.systemInstruction).toBe('Updated');
  });

  it('adds a skill', async () => {
    server.use(
      http.post('http://localhost/api/context/skills', () => HttpResponse.json({ status: 'ok' }, { status: 201 })),
    );
    await expect(contextApi.addSkill('Skill1')).resolves.toBeUndefined();
  });

  it('throws on 400', async () => {
    server.use(
      http.post('http://localhost/api/context/skills', () =>
        HttpResponse.json({ error: { code: 'VALIDATION_ERROR', message: 'Empty' } }, { status: 400 }),
      ),
    );
    await expect(contextApi.addSkill('')).rejects.toThrow(/Empty/);
  });

  it('removes a tool', async () => {
    server.use(
      http.delete('http://localhost/api/context/tools/abc', () => new HttpResponse(null, { status: 204 })),
    );
    await expect(contextApi.removeTool('abc')).resolves.toBeUndefined();
  });
});
```

**Implementation:**

```ts
import type { AetherContext, Tool, McpServerConfig } from '@/src/types/context.types';

const BASE = 'http://localhost/api/context';

async function asJson<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: { message: `HTTP ${res.status}` } }));
    throw new Error(body?.error?.message ?? `HTTP ${res.status}`);
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

async function noContent(res: Response): Promise<void> {
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: { message: `HTTP ${res.status}` } }));
    throw new Error(body?.error?.message ?? `HTTP ${res.status}`);
  }
}

export const contextApi = {
  get: () => fetch(BASE).then((r) => asJson<AetherContext>(r)),
  patch: (patch: Partial<AetherContext>) =>
    fetch(BASE, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    }).then((r) => asJson<AetherContext>(r)),
  bulkOverwrite: (ctx: AetherContext) =>
    fetch(BASE, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(ctx),
    }).then((r) => asJson<AetherContext>(r)),

  addSkill: (name: string) =>
    fetch(`${BASE}/skills`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    }).then(noContent),
  updateSkillAt: (index: number, value: string) =>
    fetch(`${BASE}/skills/${index}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ value }),
    }).then(noContent),
  removeSkillAt: (index: number) =>
    fetch(`${BASE}/skills/${index}`, { method: 'DELETE' }).then(noContent),

  addTool: (input: Omit<Tool, 'id'>) =>
    fetch(`${BASE}/tools`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    }).then((r) => asJson<Tool>(r)),
  updateTool: (id: string, patch: Partial<Omit<Tool, 'id'>>) =>
    fetch(`${BASE}/tools/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    }).then(noContent),
  removeTool: (id: string) =>
    fetch(`${BASE}/tools/${id}`, { method: 'DELETE' }).then(noContent),

  addMcpServer: (input: Omit<McpServerConfig, 'id'>) =>
    fetch(`${BASE}/mcp-servers`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    }).then((r) => asJson<McpServerConfig>(r)),
  removeMcpServer: (id: string) =>
    fetch(`${BASE}/mcp-servers/${id}`, { method: 'DELETE' }).then(noContent),
};
```

**Commit:** `feat(slice-1): add context API client with typed fetch wrappers`

---

## Phase E: Frontend Zustand store (TDD)

### Task E1: useContextStore

**Files:** `src/stores/context.store.ts`, `src/stores/context.store.test.ts`

Zustand store with optimistic updates. State + actions.

**State:**
```ts
interface ContextState {
  context: AetherContext | null;
  isLoading: boolean;
  error: string | null;
  init: () => Promise<void>;
  setSystemInstruction: (v: string) => Promise<void>;
  addSkill: (name: string) => Promise<void>;
  updateSkillAt: (i: number, v: string) => Promise<void>;
  removeSkillAt: (i: number) => Promise<void>;
  addTool: (input: Omit<Tool, 'id'>) => Promise<void>;
  updateTool: (id: string, patch: Partial<Omit<Tool, 'id'>>) => Promise<void>;
  removeTool: (id: string) => Promise<void>;
  addMcpServer: (input: Omit<McpServerConfig, 'id'>) => Promise<void>;
  removeMcpServer: (id: string) => Promise<void>;
  _reset: () => void; // test only
}
```

**Tests:** use MSW handlers + zustand. Cover: init populates state, addSkill calls API + appends, error sets error state, removeSkillAt removes by index.

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { http, HttpResponse } from 'msw';
import { server } from '@/src/test/msw-server';
import { useContextStore } from './context.store';

const fixture = {
  systemInstruction: 'You are X',
  skills: ['s1', 's2'],
  tools: [],
  mcpServers: [],
};

beforeEach(() => {
  useContextStore.getState()._reset();
});

describe('useContextStore', () => {
  it('init fetches context', async () => {
    server.use(http.get('http://localhost/api/context', () => HttpResponse.json(fixture)));
    await useContextStore.getState().init();
    expect(useContextStore.getState().context).toEqual(fixture);
    expect(useContextStore.getState().isLoading).toBe(false);
  });

  it('addSkill appends optimistically', async () => {
    server.use(
      http.get('http://localhost/api/context', () => HttpResponse.json(fixture)),
      http.post('http://localhost/api/context/skills', () => HttpResponse.json({ status: 'ok' }, { status: 201 })),
    );
    await useContextStore.getState().init();
    await useContextStore.getState().addSkill('s3');
    expect(useContextStore.getState().context?.skills).toEqual(['s1', 's2', 's3']);
  });

  it('addSkill rollbacks on error', async () => {
    server.use(
      http.get('http://localhost/api/context', () => HttpResponse.json(fixture)),
      http.post('http://localhost/api/context/skills', () =>
        HttpResponse.json({ error: { message: 'bad' } }, { status: 400 }),
      ),
    );
    await useContextStore.getState().init();
    await expect(useContextStore.getState().addSkill('s3')).rejects.toThrow();
    expect(useContextStore.getState().context?.skills).toEqual(['s1', 's2']);
    expect(useContextStore.getState().error).toMatch(/bad/);
  });

  it('removeSkillAt removes optimistically', async () => {
    server.use(
      http.get('http://localhost/api/context', () => HttpResponse.json(fixture)),
      http.delete('http://localhost/api/context/skills/0', () => new HttpResponse(null, { status: 204 })),
    );
    await useContextStore.getState().init();
    await useContextStore.getState().removeSkillAt(0);
    expect(useContextStore.getState().context?.skills).toEqual(['s2']);
  });

  it('addTool adds with returned id', async () => {
    const tool = { id: 't-1', name: 'Search', version: '1.0', status: 'online' as const };
    server.use(
      http.get('http://localhost/api/context', () => HttpResponse.json(fixture)),
      http.post('http://localhost/api/context/tools', () => HttpResponse.json(tool, { status: 201 })),
    );
    await useContextStore.getState().init();
    await useContextStore.getState().addTool({ name: 'Search', version: '1.0', status: 'online' });
    expect(useContextStore.getState().context?.tools).toContainEqual(tool);
  });
});
```

**Implementation:**

```ts
import { create } from 'zustand';
import { contextApi } from '@/src/lib/api/context.api';
import type { AetherContext, Tool, McpServerConfig } from '@/src/types/context.types';

interface ContextState {
  context: AetherContext | null;
  isLoading: boolean;
  error: string | null;
  init: () => Promise<void>;
  setSystemInstruction: (v: string) => Promise<void>;
  addSkill: (name: string) => Promise<void>;
  updateSkillAt: (i: number, v: string) => Promise<void>;
  removeSkillAt: (i: number) => Promise<void>;
  addTool: (input: Omit<Tool, 'id'>) => Promise<void>;
  updateTool: (id: string, patch: Partial<Omit<Tool, 'id'>>) => Promise<void>;
  removeTool: (id: string) => Promise<void>;
  addMcpServer: (input: Omit<McpServerConfig, 'id'>) => Promise<void>;
  removeMcpServer: (id: string) => Promise<void>;
  _reset: () => void;
}

const initial = { context: null, isLoading: false, error: null };

export const useContextStore = create<ContextState>((set, get) => ({
  ...initial,

  _reset: () => set(initial),

  init: async () => {
    set({ isLoading: true, error: null });
    try {
      const context = await contextApi.get();
      set({ context, isLoading: false });
    } catch (e) {
      set({ isLoading: false, error: e instanceof Error ? e.message : 'Failed to load' });
    }
  },

  setSystemInstruction: async (v) => {
    const prev = get().context;
    if (!prev) return;
    set({ context: { ...prev, systemInstruction: v } });
    try {
      const fresh = await contextApi.patch({ systemInstruction: v });
      set({ context: fresh });
    } catch (e) {
      set({ context: prev, error: e instanceof Error ? e.message : 'Failed' });
      throw e;
    }
  },

  addSkill: async (name) => {
    const prev = get().context;
    if (!prev) return;
    set({ context: { ...prev, skills: [...prev.skills, name] } });
    try {
      await contextApi.addSkill(name);
    } catch (e) {
      set({ context: prev, error: e instanceof Error ? e.message : 'Failed' });
      throw e;
    }
  },

  updateSkillAt: async (i, v) => {
    const prev = get().context;
    if (!prev) return;
    const next = [...prev.skills];
    next[i] = v;
    set({ context: { ...prev, skills: next } });
    try {
      await contextApi.updateSkillAt(i, v);
    } catch (e) {
      set({ context: prev, error: e instanceof Error ? e.message : 'Failed' });
      throw e;
    }
  },

  removeSkillAt: async (i) => {
    const prev = get().context;
    if (!prev) return;
    set({ context: { ...prev, skills: prev.skills.filter((_, idx) => idx !== i) } });
    try {
      await contextApi.removeSkillAt(i);
    } catch (e) {
      set({ context: prev, error: e instanceof Error ? e.message : 'Failed' });
      throw e;
    }
  },

  addTool: async (input) => {
    const prev = get().context;
    if (!prev) return;
    try {
      const tool = await contextApi.addTool(input);
      const cur = get().context;
      if (cur) set({ context: { ...cur, tools: [...cur.tools, tool] } });
    } catch (e) {
      set({ error: e instanceof Error ? e.message : 'Failed' });
      throw e;
    }
  },

  updateTool: async (id, patch) => {
    const prev = get().context;
    if (!prev) return;
    const next = prev.tools.map((t) => (t.id === id ? { ...t, ...patch } : t));
    set({ context: { ...prev, tools: next } });
    try {
      await contextApi.updateTool(id, patch);
    } catch (e) {
      set({ context: prev, error: e instanceof Error ? e.message : 'Failed' });
      throw e;
    }
  },

  removeTool: async (id) => {
    const prev = get().context;
    if (!prev) return;
    set({ context: { ...prev, tools: prev.tools.filter((t) => t.id !== id) } });
    try {
      await contextApi.removeTool(id);
    } catch (e) {
      set({ context: prev, error: e instanceof Error ? e.message : 'Failed' });
      throw e;
    }
  },

  addMcpServer: async (input) => {
    const prev = get().context;
    if (!prev) return;
    try {
      const srv = await contextApi.addMcpServer(input);
      const cur = get().context;
      if (cur) set({ context: { ...cur, mcpServers: [...cur.mcpServers, srv] } });
    } catch (e) {
      set({ error: e instanceof Error ? e.message : 'Failed' });
      throw e;
    }
  },

  removeMcpServer: async (id) => {
    const prev = get().context;
    if (!prev) return;
    set({ context: { ...prev, mcpServers: prev.mcpServers.filter((s) => s.id !== id) } });
    try {
      await contextApi.removeMcpServer(id);
    } catch (e) {
      set({ context: prev, error: e instanceof Error ? e.message : 'Failed' });
      throw e;
    }
  },
}));
```

**Commit:** `feat(slice-1): add useContextStore zustand with optimistic updates`

---

## Phase F: Layout components (TDD)

### Task F1: AppShell (TDD)

`src/components/layout/AppShell.tsx`: flex row, left sidebar + right main. Props: `sidebar`, `children`, `sidebarOpen`.

**Tests:** renders both regions when open. When closed, sidebar region absent.

```tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { AppShell } from './AppShell';

describe('AppShell', () => {
  it('renders sidebar and main when open', () => {
    render(<AppShell sidebarOpen sidebar={<div>SIDE</div>}><div>MAIN</div></AppShell>);
    expect(screen.getByText('SIDE')).toBeInTheDocument();
    expect(screen.getByText('MAIN')).toBeInTheDocument();
  });

  it('omits sidebar when closed', () => {
    render(<AppShell sidebarOpen={false} sidebar={<div>SIDE</div>}><div>MAIN</div></AppShell>);
    expect(screen.queryByText('SIDE')).not.toBeInTheDocument();
    expect(screen.getByText('MAIN')).toBeInTheDocument();
  });

  it('renders main region with landmark role', () => {
    render(<AppShell sidebarOpen sidebar={<div />}><div>main content</div></AppShell>);
    expect(screen.getByRole('main')).toBeInTheDocument();
  });
});
```

**Implementation:**

```tsx
import { type ReactNode } from 'react';

export interface AppShellProps {
  sidebar: ReactNode;
  sidebarOpen: boolean;
  children: ReactNode;
}

export function AppShell({ sidebar, sidebarOpen, children }: AppShellProps) {
  return (
    <div className="flex h-screen w-full bg-surface-1 text-zinc-300 font-sans">
      {sidebarOpen && (
        <aside className="border-r border-border-subtle bg-surface-2 w-80 flex flex-col shrink-0 overflow-hidden">
          {sidebar}
        </aside>
      )}
      <main role="main" className="flex-1 flex flex-col min-w-0 bg-surface-1">
        {children}
      </main>
    </div>
  );
}
```

**Commit:** `feat(slice-1): add AppShell layout component`

---

### Task F2: TopBar (TDD)

`src/components/layout/TopBar.tsx`: header with toggle sidebar button + title. For slice-1, just the toggle + title.

**Tests:**

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TopBar } from './TopBar';

describe('TopBar', () => {
  it('renders title', () => {
    render(<TopBar title="AETHER" onToggleSidebar={() => {}} sidebarOpen />);
    expect(screen.getByText('AETHER')).toBeInTheDocument();
  });

  it('calls onToggleSidebar when toggle clicked', async () => {
    const user = userEvent.setup();
    const onToggle = vi.fn();
    render(<TopBar title="X" onToggleSidebar={onToggle} sidebarOpen />);
    await user.click(screen.getByRole('button', { name: /toggle sidebar/i }));
    expect(onToggle).toHaveBeenCalledOnce();
  });
});
```

**Implementation:**

```tsx
import { IconButton } from '@/src/components/ui/IconButton';

export interface TopBarProps {
  title: string;
  sidebarOpen: boolean;
  onToggleSidebar: () => void;
}

export function TopBar({ title, sidebarOpen, onToggleSidebar }: TopBarProps) {
  return (
    <header className="h-12 border-b border-border-subtle flex items-center px-4 bg-surface-2 sticky top-0 z-10">
      <IconButton
        label="Toggle sidebar"
        onClick={onToggleSidebar}
        variant={sidebarOpen ? 'active' : 'default'}
      >
        <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><rect x="2" y="3" width="12" height="2" /><rect x="2" y="7" width="12" height="2" /><rect x="2" y="11" width="12" height="2" /></svg>
      </IconButton>
      <span className="ml-3 font-mono text-sm tracking-tight text-white font-bold">{title}</span>
    </header>
  );
}
```

**Commit:** `feat(slice-1): add TopBar with sidebar toggle`

---

### Task F3: Sidebar container (TDD)

`src/components/layout/Sidebar.tsx`: just a flex column with header and slot for children + footer. Pure presentation, no business logic.

**Tests:**

```tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Sidebar } from './Sidebar';

describe('Sidebar', () => {
  it('renders header brand + children + footer', () => {
    render(
      <Sidebar header={<div>HDR</div>} footer={<div>FOOT</div>}>
        <div>BODY</div>
      </Sidebar>
    );
    expect(screen.getByText('HDR')).toBeInTheDocument();
    expect(screen.getByText('BODY')).toBeInTheDocument();
    expect(screen.getByText('FOOT')).toBeInTheDocument();
  });
});
```

**Implementation:**

```tsx
import { type ReactNode } from 'react';

export interface SidebarProps {
  header: ReactNode;
  footer?: ReactNode;
  children: ReactNode;
}

export function Sidebar({ header, footer, children }: SidebarProps) {
  return (
    <div className="flex flex-col h-full">
      <div className="p-4 border-b border-border-subtle bg-surface-3">{header}</div>
      <div className="flex-1 overflow-y-auto p-4 space-y-6 scrollbar-hide">{children}</div>
      {footer && <div className="p-4 border-t border-border-subtle text-[10px] font-mono text-zinc-600">{footer}</div>}
    </div>
  );
}
```

**Commit:** `feat(slice-1): add Sidebar layout container`

---

## Phase G: Sidebar feature sections (TDD)

Each section reads context from `useContextStore`, calls actions, uses `useDialog` for prompt/confirm. They follow the same pattern.

### Task G1: SystemProtocolSection

`src/components/sidebar/SystemProtocolSection.tsx`: textarea bound to context.systemInstruction, debounce save on blur.

**Tests:** render shows textarea with current value, change + blur calls `setSystemInstruction`.

```tsx
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SystemProtocolSection } from './SystemProtocolSection';
import { useContextStore } from '@/src/stores/context.store';

beforeEach(() => {
  useContextStore.setState({
    context: { systemInstruction: 'initial', skills: [], tools: [], mcpServers: [] },
    isLoading: false,
    error: null,
  });
});

describe('SystemProtocolSection', () => {
  it('shows current system instruction', () => {
    render(<SystemProtocolSection />);
    expect(screen.getByDisplayValue('initial')).toBeInTheDocument();
  });

  it('saves on blur', async () => {
    const user = userEvent.setup();
    useContextStore.setState({ setSystemInstruction: async (v: string) => {
      useContextStore.setState((s) => ({ context: s.context ? { ...s.context, systemInstruction: v } : null }));
    }});
    render(<SystemProtocolSection />);
    const ta = screen.getByDisplayValue('initial');
    await user.clear(ta);
    await user.type(ta, 'Updated');
    await user.tab();  // blur
    expect(useContextStore.getState().context?.systemInstruction).toBe('Updated');
  });
});
```

**Implementation:**

```tsx
import { useState, useEffect } from 'react';
import { useContextStore } from '@/src/stores/context.store';

export function SystemProtocolSection() {
  const systemInstruction = useContextStore((s) => s.context?.systemInstruction ?? '');
  const setSystemInstruction = useContextStore((s) => s.setSystemInstruction);

  const [local, setLocal] = useState(systemInstruction);

  useEffect(() => setLocal(systemInstruction), [systemInstruction]);

  return (
    <section>
      <div className="mono-label mb-2">System Protocol</div>
      <textarea
        className="w-full bg-zinc-900/50 border border-border-subtle rounded p-2 text-xs font-mono text-zinc-400 focus:border-accent outline-none min-h-[120px] resize-none"
        value={local}
        onChange={(e) => setLocal(e.target.value)}
        onBlur={() => {
          if (local !== systemInstruction) setSystemInstruction(local).catch(() => {});
        }}
      />
    </section>
  );
}
```

**Commit:** `feat(slice-1): add SystemProtocolSection (textarea bound to context)`

---

### Task G2: SkillsSection

List of skills with add/edit/remove via `useDialog`.

**Tests:** render list, click "add" opens prompt dialog, edit triggers prompt, remove triggers confirm dialog. Use `userEvent` + state set on `useContextStore`.

```tsx
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SkillsSection } from './SkillsSection';
import { useContextStore } from '@/src/stores/context.store';
import { DialogHost } from '@/src/components/layout/DialogHost';
import { _resetDialogStore } from '@/src/hooks/useDialog';

beforeEach(() => {
  _resetDialogStore();
  useContextStore.setState({
    context: { systemInstruction: '', skills: ['Alpha', 'Beta'], tools: [], mcpServers: [] },
    isLoading: false,
    error: null,
    addSkill: async (name: string) => {
      useContextStore.setState((s) => ({
        context: s.context ? { ...s.context, skills: [...s.context.skills, name] } : null,
      }));
    },
    removeSkillAt: async (i: number) => {
      useContextStore.setState((s) => ({
        context: s.context ? { ...s.context, skills: s.context.skills.filter((_, idx) => idx !== i) } : null,
      }));
    },
  });
});

describe('SkillsSection', () => {
  it('lists skills', () => {
    render(<><DialogHost /><SkillsSection /></>);
    expect(screen.getByText('Alpha')).toBeInTheDocument();
    expect(screen.getByText('Beta')).toBeInTheDocument();
  });

  it('clicking add opens prompt dialog and adds new skill', async () => {
    const user = userEvent.setup();
    render(<><DialogHost /><SkillsSection /></>);
    await user.click(screen.getByRole('button', { name: /add skill|deploy/i }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    await user.type(screen.getByRole('textbox'), 'Gamma');
    await user.click(screen.getByRole('button', { name: /^(confirm|ok)$/i }));
    expect(useContextStore.getState().context?.skills).toContain('Gamma');
  });

  it('removing a skill confirms then removes', async () => {
    const user = userEvent.setup();
    render(<><DialogHost /><SkillsSection /></>);
    await user.click(screen.getByRole('button', { name: /remove alpha/i }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /^(confirm|ok)$/i }));
    expect(useContextStore.getState().context?.skills).toEqual(['Beta']);
  });
});
```

**Implementation:**

```tsx
import { useContextStore } from '@/src/stores/context.store';
import { useDialog } from '@/src/hooks/useDialog';

export function SkillsSection() {
  const skills = useContextStore((s) => s.context?.skills ?? []);
  const addSkill = useContextStore((s) => s.addSkill);
  const updateSkillAt = useContextStore((s) => s.updateSkillAt);
  const removeSkillAt = useContextStore((s) => s.removeSkillAt);
  const dialog = useDialog();

  const handleAdd = async () => {
    const name = await dialog.prompt({ title: 'Add Skill', label: 'Skill name', required: true });
    if (name) await addSkill(name).catch(() => {});
  };

  const handleEdit = async (index: number, current: string) => {
    const name = await dialog.prompt({
      title: 'Edit Skill',
      label: 'Skill name',
      defaultValue: current,
      required: true,
    });
    if (name) await updateSkillAt(index, name).catch(() => {});
  };

  const handleRemove = async (index: number, current: string) => {
    const ok = await dialog.confirm({
      title: 'Remove skill',
      message: `Remove "${current}"?`,
      destructive: true,
    });
    if (ok) await removeSkillAt(index).catch(() => {});
  };

  return (
    <section>
      <div className="flex items-center justify-between mb-2">
        <div className="mono-label">Active Skills</div>
        <span className="text-[10px] text-zinc-600">[{skills.length}]</span>
      </div>
      <div className="space-y-1">
        {skills.map((skill, i) => (
          <div
            key={i}
            className="group flex items-center justify-between p-1.5 rounded bg-zinc-900 border border-border-subtle text-[10px] font-mono text-zinc-400"
          >
            <span className="truncate">{skill}</span>
            <div className="hidden group-hover:flex gap-1">
              <button
                onClick={() => handleEdit(i, skill)}
                aria-label={`Edit ${skill}`}
                className="hover:text-white"
              >
                ✎
              </button>
              <button
                onClick={() => handleRemove(i, skill)}
                aria-label={`Remove ${skill}`}
                className="hover:text-red-400"
              >
                ×
              </button>
            </div>
          </div>
        ))}
        <button
          onClick={handleAdd}
          aria-label="Add skill"
          className="w-full p-1 border border-dashed border-border-subtle rounded text-[10px] text-zinc-600 hover:text-zinc-400 transition-colors mt-2"
        >
          + Deploy New Skill
        </button>
      </div>
    </section>
  );
}
```

**Commit:** `feat(slice-1): add SkillsSection with add/edit/remove via useDialog`

---

### Task G3: ToolsSection

Same pattern as SkillsSection but Tool fields are name/version/status. The prompt dialog asks 3 fields — implement as 3 sequential prompts, or use a custom small "tool editor" Modal. For simplicity use 3 prompts (name → version → status).

**Tests:** list tools, add tool through 3-step prompt cycle, remove via confirm.

```tsx
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ToolsSection } from './ToolsSection';
import { useContextStore } from '@/src/stores/context.store';
import { DialogHost } from '@/src/components/layout/DialogHost';
import { _resetDialogStore } from '@/src/hooks/useDialog';

beforeEach(() => {
  _resetDialogStore();
  useContextStore.setState({
    context: {
      systemInstruction: '',
      skills: [],
      tools: [{ id: 't1', name: 'GoogleSearch', version: '1.2.0', status: 'online' }],
      mcpServers: [],
    },
    isLoading: false,
    error: null,
    addTool: async (input) => {
      useContextStore.setState((s) => ({
        context: s.context
          ? { ...s.context, tools: [...s.context.tools, { ...input, id: 'new-id' }] }
          : null,
      }));
    },
    removeTool: async (id) => {
      useContextStore.setState((s) => ({
        context: s.context ? { ...s.context, tools: s.context.tools.filter((t) => t.id !== id) } : null,
      }));
    },
  });
});

describe('ToolsSection', () => {
  it('lists tools with version and status', () => {
    render(<><DialogHost /><ToolsSection /></>);
    expect(screen.getByText(/GoogleSearch/)).toBeInTheDocument();
    expect(screen.getByText(/1\.2\.0/)).toBeInTheDocument();
  });

  it('adds a tool via 3-step prompt', async () => {
    const user = userEvent.setup();
    render(<><DialogHost /><ToolsSection /></>);
    await user.click(screen.getByRole('button', { name: /register tool/i }));
    // step 1: name
    await user.type(screen.getByRole('textbox'), 'MyTool');
    await user.click(screen.getByRole('button', { name: /^(confirm|ok)$/i }));
    // step 2: version
    await user.type(screen.getByRole('textbox'), '1.0.0');
    await user.click(screen.getByRole('button', { name: /^(confirm|ok)$/i }));
    // step 3: status confirm (online)
    await user.click(screen.getByRole('button', { name: /^(confirm|ok)$/i }));
    expect(useContextStore.getState().context?.tools).toContainEqual(
      expect.objectContaining({ name: 'MyTool', version: '1.0.0', status: 'online' })
    );
  });

  it('removes a tool with confirm', async () => {
    const user = userEvent.setup();
    render(<><DialogHost /><ToolsSection /></>);
    await user.click(screen.getByRole('button', { name: /remove GoogleSearch/i }));
    await user.click(screen.getByRole('button', { name: /^(confirm|ok)$/i }));
    expect(useContextStore.getState().context?.tools).toHaveLength(0);
  });
});
```

**Implementation:**

```tsx
import { useContextStore } from '@/src/stores/context.store';
import { useDialog } from '@/src/hooks/useDialog';
import { StatusDot } from '@/src/components/ui/StatusDot';

export function ToolsSection() {
  const tools = useContextStore((s) => s.context?.tools ?? []);
  const addTool = useContextStore((s) => s.addTool);
  const removeTool = useContextStore((s) => s.removeTool);
  const dialog = useDialog();

  const handleAdd = async () => {
    const name = await dialog.prompt({ title: 'Register Tool', label: 'Name', required: true });
    if (!name) return;
    const version = await dialog.prompt({ title: 'Register Tool', label: 'Version', defaultValue: '1.0.0', required: true });
    if (!version) return;
    const isOnline = await dialog.confirm({
      title: 'Register Tool',
      message: `Set status of ${name} to ONLINE? (Cancel = offline)`,
      confirmLabel: 'Online',
      cancelLabel: 'Offline',
    });
    await addTool({ name, version, status: isOnline ? 'online' : 'offline' }).catch(() => {});
  };

  const handleRemove = async (id: string, name: string) => {
    const ok = await dialog.confirm({ title: 'Remove tool', message: `Remove "${name}"?`, destructive: true });
    if (ok) await removeTool(id).catch(() => {});
  };

  return (
    <section>
      <div className="mono-label mb-2">Tool Registry</div>
      <div className="space-y-2">
        {tools.map((tool) => (
          <div
            key={tool.id}
            className="group p-2 rounded bg-zinc-900/30 border border-border-subtle/50 flex items-center justify-between"
          >
            <span className="text-[10px] font-mono text-zinc-500">
              {tool.name} <span className="opacity-50 mx-1">v{tool.version}</span>
            </span>
            <div className="flex items-center gap-2">
              <button
                onClick={() => handleRemove(tool.id, tool.name)}
                aria-label={`Remove ${tool.name}`}
                className="hidden group-hover:inline hover:text-red-400 text-zinc-500"
              >
                ×
              </button>
              <StatusDot status={tool.status} label={tool.name} />
            </div>
          </div>
        ))}
        <button
          onClick={handleAdd}
          aria-label="Register tool"
          className="w-full p-1 border border-dashed border-border-subtle rounded text-[10px] text-zinc-600 hover:text-zinc-400 transition-colors mt-2"
        >
          + Register Tool
        </button>
      </div>
    </section>
  );
}
```

**Commit:** `feat(slice-1): add ToolsSection with multi-step prompt`

---

### Task G4: McpServersSection

Same pattern as ToolsSection. Fields: name, url, status (online/offline/connecting). Use 3 prompts.

Tests + implementation follow ToolsSection pattern. Use `StatusDot` with 3 statuses.

**Commit:** `feat(slice-1): add McpServersSection with multi-step prompt`

---

### Task G5: ConnectionFooter

Static-ish indicator at sidebar bottom: shows online status (always green for now), latency placeholder.

```tsx
import { StatusDot } from '@/src/components/ui/StatusDot';

export function ConnectionFooter() {
  return (
    <div className="flex items-center justify-between">
      <span>LATENCY: —</span>
      <div className="flex items-center gap-2">
        <StatusDot status="online" label="Server" />
        <span>ONLINE</span>
      </div>
    </div>
  );
}
```

Test: renders the StatusDot online.

**Commit:** `feat(slice-1): add ConnectionFooter`

---

## Phase H: New App.tsx (DEMOLITION)

### Task H1: Rewrite App.tsx

DELETE the old App.tsx content (1125 lines). Replace with:

```tsx
import { useEffect, useState } from 'react';
import { AppShell } from '@/src/components/layout/AppShell';
import { TopBar } from '@/src/components/layout/TopBar';
import { Sidebar } from '@/src/components/layout/Sidebar';
import { DialogHost } from '@/src/components/layout/DialogHost';
import { SystemProtocolSection } from '@/src/components/sidebar/SystemProtocolSection';
import { SkillsSection } from '@/src/components/sidebar/SkillsSection';
import { ToolsSection } from '@/src/components/sidebar/ToolsSection';
import { McpServersSection } from '@/src/components/sidebar/McpServersSection';
import { ConnectionFooter } from '@/src/components/sidebar/ConnectionFooter';
import { useContextStore } from '@/src/stores/context.store';

export default function App() {
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const init = useContextStore((s) => s.init);

  useEffect(() => {
    init();
  }, [init]);

  return (
    <>
      <DialogHost />
      <AppShell
        sidebarOpen={sidebarOpen}
        sidebar={
          <Sidebar
            header={<span className="font-mono text-sm tracking-tight text-white font-bold">AETHER_CORE</span>}
            footer={<ConnectionFooter />}
          >
            <SystemProtocolSection />
            <SkillsSection />
            <ToolsSection />
            <McpServersSection />
          </Sidebar>
        }
      >
        <TopBar title="Aether Dev Studio" sidebarOpen={sidebarOpen} onToggleSidebar={() => setSidebarOpen((v) => !v)} />
        <div className="flex-1 flex items-center justify-center text-zinc-600">
          <div className="text-center opacity-50">
            <div className="font-mono text-xs uppercase tracking-widest text-accent mb-2">
              Aether OS — Slice 1
            </div>
            <div className="text-[10px]">Chat verrà aggiunta in Slice 2</div>
          </div>
        </div>
      </AppShell>
    </>
  );
}
```

### Task H2: Remove @ts-nocheck

- Remove `// @ts-nocheck` from `src/App.tsx` (no longer needed).
- For `src/main.tsx`: install `@types/react-dom` and remove nocheck.

```bash
npm install -D @types/react-dom
```

Then remove the first line of `src/main.tsx`.

**Commit:** `feat(slice-1): replace legacy App.tsx with new component-based UI`

---

## Phase I: Wire MSW default handlers + E2E smoke

### Task I1: Add /api/context default handlers to MSW

Modify `src/test/msw-handlers.ts` to add a default GET handler returning a fixture context so component tests that mount App don't need to opt-in.

```ts
import { http, HttpResponse } from 'msw';
import type { AetherContext } from '@/src/types/context.types';

const defaultFixture: AetherContext = {
  systemInstruction: 'You are Aether',
  skills: [],
  tools: [],
  mcpServers: [],
};

export const handlers = [
  http.get('http://localhost/api/__health', () => HttpResponse.json({ ok: true })),
  http.get('http://localhost/api/context', () => HttpResponse.json(defaultFixture)),
];
```

### Task I2: Update Playwright smoke

`e2e/smoke.spec.ts`:

```ts
import { test, expect } from '@playwright/test';

test('app shell loads with new sidebar', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByText('AETHER_CORE')).toBeVisible();
  await expect(page.getByText('System Protocol')).toBeVisible();
  await expect(page.getByText('Active Skills')).toBeVisible();
  await expect(page.getByText('Tool Registry')).toBeVisible();
  await expect(page.getByRole('main')).toBeVisible();
});
```

### Task I3: Run full suite

```bash
npm run test:run          # tutti i test unit/integration verdi
npm run lint              # tsc --noEmit pulito
npm run test:e2e          # Playwright smoke verde
npm run dev               # smoke manuale: sidebar funzionante, add skill funziona
```

**Commit:** `chore(slice-1): update MSW handlers + E2E for new UI`

---

## Phase J: Push + PR

```bash
git push -u origin feat/slice-1-context-crud
gh pr create --title "feat(slice-1): context CRUD + persistenza JSON + demolizione App.tsx legacy" --body "..."
```

---

## Definition of Done (Slice 1)

- [ ] All 27+ task above complete
- [ ] All previous tests (112 from slice 0) still pass
- [ ] ~60-80 new tests added
- [ ] `npm run lint` exit 0
- [ ] `npm run dev` shows new UI (sidebar with 4 sections functioning)
- [ ] Edit system instruction → persisted on disk in `data/context.json`
- [ ] Add/edit/remove skill → persisted
- [ ] Add/remove tool → persisted
- [ ] Add/remove MCP server → persisted
- [ ] `npm run test:e2e` smoke green on new UI
- [ ] PR open

## Notes

- The 3-step prompt pattern for tool/server add is intentionally simple; slice 2+ might introduce a dedicated multi-field form Modal.
- `useContextStore` uses optimistic updates with rollback on error — same pattern for all CRUD actions.
- Old `server.ts` is deleted; bootstrap is now in `server/index.ts`.
- `src/main.tsx` no longer needs `@ts-nocheck` once `@types/react-dom` is installed.
