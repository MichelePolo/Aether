# Multi-endpoint Ollama Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users configure multiple remote Ollama endpoints at runtime (label + URL + optional Bearer token), keep the env-driven local endpoint fixed, and surface each endpoint's status in the provider panel.

**Architecture:** A new persisted `OllamaEndpoint` domain entity (SQLite table + `OllamaEndpointStore`). The local endpoint stays synthetic (from `OLLAMA_HOST`, `id="local"`). The `ProviderRegistry` and `AuthStatusService` consume an injected `listOllamaEndpoints()` (local prepended to the DB list). Discovery and the provider gain an optional `Authorization: Bearer` header. New REST CRUD routes trigger `registry.refresh()` + re-probe (the Key Vault pattern). Frontend gets a dedicated `OllamaEndpointsModal` plus per-endpoint rows in `ProviderAuthSection`.

**Tech Stack:** TypeScript (strict), Express, better-sqlite3, Vitest (backend `node` project), React 19 + Zustand, Vitest (frontend `jsdom` project), Testing Library.

**Branch:** `feat/slice-27-ollama-multi-endpoint` (already created; spec at `docs/superpowers/specs/2026-05-25-aether-ollama-multi-endpoint-design.md`).

**Conventions reminder:**
- Run one backend test file: `npx vitest run --project backend <path>`; by name: add `-t "<name>"`.
- Run one frontend test file: `npx vitest run --project frontend <path>`.
- Type-check (the "lint"): `npm run lint`.
- Tests are colocated `*.test.ts(x)`; `describe/it/expect` are global (no import needed). Keep the explicit imports the existing files use — match the neighbouring file.
- `@/*` aliases the repo root.

---

## File Structure

**Backend — new:**
- `server/db/migrations/010_ollama_endpoints.sql` — schema.
- `server/domain/providers/ollama-endpoints.types.ts` — record/input types.
- `server/domain/providers/ollama-endpoints.store.ts` (+ `.test.ts`) — CRUD + token crypto.

**Backend — modified:**
- `server/domain/providers/discovery.ts` (+ `.test.ts`) — optional token header.
- `server/domain/dispatch/providers/ollama.provider.ts` (+ `.test.ts`) — optional token header.
- `server/domain/providers/registry.ts` (+ `.test.ts`) — multi-endpoint iteration + naming.
- `server/domain/providers/auth-status.types.ts` — `OllamaEndpointStatus`, report shape.
- `server/domain/providers/auth-status.ts` (+ `.test.ts`) — per-endpoint probing.
- `server/routes/providers.routes.ts` (+ `.test.ts`) — CRUD routes + merge update.
- `server/app.ts` — wire `ollamaEndpointStore` into `createProvidersRoutes`.
- `server/index.ts` — construct store, `listOllamaEndpoints`, new builder signatures.

**Frontend — new:**
- `src/types/ollama-endpoints.types.ts` — client types.
- `src/stores/ollamaEndpoints.store.ts` (+ `.test.ts`) — optimistic CRUD.
- `src/components/providers/OllamaEndpointsModal.tsx` (+ `.test.tsx`) — management UI.

**Frontend — modified:**
- `src/lib/api/providers.api.ts` — endpoint CRUD client methods.
- `src/types/provider-auth.types.ts` — `OllamaEndpointStatus`, report shape.
- `src/stores/providerAuth.store.ts` — carry `ollama` array.
- `src/stores/ui.store.ts` — `openOllamaEndpoints`/`closeOllamaEndpoints`.
- `src/components/sidebar/ProviderAuthSection.tsx` (+ `.test.tsx`) — Ollama sub-block.
- `src/App.tsx` — mount the modal.
- `src/i18n/en.ts` (+ other locale files present) — strings.

---

## Task 1: Migration + OllamaEndpointStore

**Files:**
- Create: `server/db/migrations/010_ollama_endpoints.sql`
- Create: `server/domain/providers/ollama-endpoints.types.ts`
- Create: `server/domain/providers/ollama-endpoints.store.ts`
- Test: `server/domain/providers/ollama-endpoints.store.test.ts`

- [ ] **Step 1: Write the migration**

Create `server/db/migrations/010_ollama_endpoints.sql`:

```sql
-- Slice 27: multiple remote Ollama endpoints, configurable at runtime.
-- The local endpoint is NOT stored here; it is synthetic, derived from OLLAMA_HOST.
CREATE TABLE ollama_endpoints (
  id               TEXT PRIMARY KEY,
  label            TEXT NOT NULL UNIQUE,
  base_url         TEXT NOT NULL,
  token_ciphertext BLOB,
  token_iv         BLOB,
  token_auth_tag   BLOB,
  created_at       INTEGER NOT NULL,
  updated_at       INTEGER NOT NULL
);
```

- [ ] **Step 2: Write the types**

Create `server/domain/providers/ollama-endpoints.types.ts`:

```ts
/** Public shape returned over HTTP — token is never sent in plaintext. */
export interface OllamaEndpointRecord {
  id: string;
  label: string;
  baseUrl: string;
  hasToken: boolean;
  tokenMasked: string | null;
  fixed: boolean;            // true only for the synthetic local endpoint
  createdAt: number | null;
  updatedAt: number | null;
}

/** Internal shape with decrypted token, for the registry / probing only. */
export interface ResolvedOllamaEndpoint {
  id: string;
  label: string;
  baseUrl: string;
  token?: string;
}

export interface CreateOllamaEndpointInput {
  label: string;
  baseUrl: string;
  token?: string;
}

export interface UpdateOllamaEndpointInput {
  label?: string;
  baseUrl?: string;
  token?: string | null;     // null or '' clears the token; undefined leaves it
}
```

- [ ] **Step 3: Write the failing store test**

Create `server/domain/providers/ollama-endpoints.store.test.ts`:

```ts
import { describe, it, expect, afterEach } from 'vitest';
import { makeTestDb } from '@/server/test/test-db';
import type { DatabaseHandle } from '@/server/db/database';
import { OllamaEndpointStore } from './ollama-endpoints.store';

let db: DatabaseHandle;
afterEach(() => db?.close());

describe('OllamaEndpointStore', () => {
  it('creates an endpoint and lists it (no token)', () => {
    db = makeTestDb();
    const store = new OllamaEndpointStore(db);
    const created = store.create({ label: 'lab', baseUrl: 'http://gpu.lan:11434' });
    expect(created.id).toMatch(/[0-9a-f-]{36}/);
    expect(created.hasToken).toBe(false);
    expect(created.tokenMasked).toBeNull();
    expect(created.fixed).toBe(false);
    const all = store.list();
    expect(all).toHaveLength(1);
    expect(all[0].label).toBe('lab');
  });

  it('encrypts a token and exposes only a masked form via list()', () => {
    db = makeTestDb();
    const store = new OllamaEndpointStore(db);
    const created = store.create({ label: 'secure', baseUrl: 'https://ollama.example', token: 'tok-abcdef123456' });
    expect(created.hasToken).toBe(true);
    expect(created.tokenMasked).toBe('tok…3456');
    expect(created.tokenMasked).not.toContain('abcdef');
  });

  it('listResolved() returns the decrypted token for internal use', () => {
    db = makeTestDb();
    const store = new OllamaEndpointStore(db);
    const c = store.create({ label: 'secure', baseUrl: 'https://x', token: 'tok-abcdef123456' });
    const resolved = store.listResolved().find((e) => e.id === c.id)!;
    expect(resolved.token).toBe('tok-abcdef123456');
  });

  it('update() changes label/url and can clear the token with null', () => {
    db = makeTestDb();
    const store = new OllamaEndpointStore(db);
    const c = store.create({ label: 'a', baseUrl: 'http://a', token: 'tok-12345678' });
    const u = store.update(c.id, { label: 'b', baseUrl: 'http://b', token: null });
    expect(u.label).toBe('b');
    expect(u.baseUrl).toBe('http://b');
    expect(u.hasToken).toBe(false);
  });

  it('update() leaves the token untouched when token is undefined', () => {
    db = makeTestDb();
    const store = new OllamaEndpointStore(db);
    const c = store.create({ label: 'a', baseUrl: 'http://a', token: 'tok-12345678' });
    store.update(c.id, { label: 'a2' });
    expect(store.listResolved().find((e) => e.id === c.id)!.token).toBe('tok-12345678');
  });

  it('remove() deletes the endpoint', () => {
    db = makeTestDb();
    const store = new OllamaEndpointStore(db);
    const c = store.create({ label: 'a', baseUrl: 'http://a' });
    store.remove(c.id);
    expect(store.list()).toHaveLength(0);
  });

  it('throws on duplicate label (UNIQUE constraint)', () => {
    db = makeTestDb();
    const store = new OllamaEndpointStore(db);
    store.create({ label: 'dup', baseUrl: 'http://a' });
    expect(() => store.create({ label: 'dup', baseUrl: 'http://b' })).toThrow();
  });
});
```

- [ ] **Step 4: Run the test, verify it fails**

Run: `npx vitest run --project backend server/domain/providers/ollama-endpoints.store.test.ts`
Expected: FAIL — cannot find module `./ollama-endpoints.store`.

- [ ] **Step 5: Implement the store**

Create `server/domain/providers/ollama-endpoints.store.ts`:

```ts
import { randomUUID } from 'node:crypto';
import type { DatabaseHandle } from '@/server/db/database';
import { encrypt, decrypt } from '@/server/lib/key-crypto';
import { mask } from './key-vault.types';
import type {
  OllamaEndpointRecord,
  ResolvedOllamaEndpoint,
  CreateOllamaEndpointInput,
  UpdateOllamaEndpointInput,
} from './ollama-endpoints.types';

interface Row {
  id: string;
  label: string;
  base_url: string;
  token_ciphertext: Buffer | null;
  token_iv: Buffer | null;
  token_auth_tag: Buffer | null;
  created_at: number;
  updated_at: number;
}

export class OllamaEndpointStore {
  constructor(private readonly db: DatabaseHandle) {}

  list(): OllamaEndpointRecord[] {
    return this.db
      .prepare<[], Row>(`SELECT * FROM ollama_endpoints ORDER BY created_at ASC`)
      .all()
      .map((r) => this.toRecord(r));
  }

  listResolved(): ResolvedOllamaEndpoint[] {
    return this.db
      .prepare<[], Row>(`SELECT * FROM ollama_endpoints ORDER BY created_at ASC`)
      .all()
      .map((r) => ({
        id: r.id,
        label: r.label,
        baseUrl: r.base_url,
        token: this.decryptToken(r) ?? undefined,
      }));
  }

  get(id: string): OllamaEndpointRecord | null {
    const r = this.db
      .prepare<[string], Row>(`SELECT * FROM ollama_endpoints WHERE id = ?`)
      .get(id);
    return r ? this.toRecord(r) : null;
  }

  create(input: CreateOllamaEndpointInput): OllamaEndpointRecord {
    const id = randomUUID();
    const now = Date.now();
    const tok = input.token ? encrypt(input.token) : null;
    this.db
      .prepare(
        `INSERT INTO ollama_endpoints
           (id, label, base_url, token_ciphertext, token_iv, token_auth_tag, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        input.label,
        input.baseUrl,
        tok?.ciphertext ?? null,
        tok?.iv ?? null,
        tok?.authTag ?? null,
        now,
        now,
      );
    return this.get(id)!;
  }

  update(id: string, patch: UpdateOllamaEndpointInput): OllamaEndpointRecord {
    const existing = this.db
      .prepare<[string], Row>(`SELECT * FROM ollama_endpoints WHERE id = ?`)
      .get(id);
    if (!existing) throw new Error(`[ollama-endpoints] not found: ${id}`);

    const label = patch.label ?? existing.label;
    const baseUrl = patch.baseUrl ?? existing.base_url;

    let cipher = existing.token_ciphertext;
    let iv = existing.token_iv;
    let tag = existing.token_auth_tag;
    if (patch.token !== undefined) {
      if (patch.token === null || patch.token === '') {
        cipher = null;
        iv = null;
        tag = null;
      } else {
        const blob = encrypt(patch.token);
        cipher = blob.ciphertext;
        iv = blob.iv;
        tag = blob.authTag;
      }
    }

    this.db
      .prepare(
        `UPDATE ollama_endpoints
           SET label = ?, base_url = ?, token_ciphertext = ?, token_iv = ?, token_auth_tag = ?, updated_at = ?
         WHERE id = ?`,
      )
      .run(label, baseUrl, cipher, iv, tag, Date.now(), id);

    return this.get(id)!;
  }

  remove(id: string): void {
    this.db.prepare(`DELETE FROM ollama_endpoints WHERE id = ?`).run(id);
  }

  private decryptToken(r: Row): string | null {
    if (!r.token_ciphertext || !r.token_iv || !r.token_auth_tag) return null;
    try {
      return decrypt({ ciphertext: r.token_ciphertext, iv: r.token_iv, authTag: r.token_auth_tag });
    } catch {
      console.warn(`[ollama-endpoints] decrypt failed for ${r.id}: auth-tag mismatch`);
      return null;
    }
  }

  private toRecord(r: Row): OllamaEndpointRecord {
    const token = this.decryptToken(r);
    return {
      id: r.id,
      label: r.label,
      baseUrl: r.base_url,
      hasToken: token !== null,
      tokenMasked: token !== null ? mask(token) : null,
      fixed: false,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    };
  }
}
```

- [ ] **Step 6: Run the test, verify it passes**

Run: `npx vitest run --project backend server/domain/providers/ollama-endpoints.store.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 7: Commit**

```bash
git add server/db/migrations/010_ollama_endpoints.sql \
        server/domain/providers/ollama-endpoints.types.ts \
        server/domain/providers/ollama-endpoints.store.ts \
        server/domain/providers/ollama-endpoints.store.test.ts
git commit -m "feat(ollama): persisted OllamaEndpointStore + migration 010"
```

---

## Task 2: Optional Bearer token in discovery + provider

**Files:**
- Modify: `server/domain/providers/discovery.ts`
- Test: `server/domain/providers/discovery.test.ts`
- Modify: `server/domain/dispatch/providers/ollama.provider.ts`
- Test: `server/domain/dispatch/providers/ollama.provider.test.ts`

- [ ] **Step 1: Add failing discovery test for the token header**

Append to `server/domain/providers/discovery.test.ts` (inside `describe('discoverOllama', ...)`):

```ts
  it('sends an Authorization: Bearer header when a token is given', async () => {
    const fetchMock = globalThis.fetch as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ models: [{ name: 'llama3:latest' }] }),
    } as Response);
    await discoverOllama('http://gpu.lan:11434', 'tok-123');
    expect(fetchMock).toHaveBeenCalledWith(
      'http://gpu.lan:11434/api/tags',
      { headers: { Authorization: 'Bearer tok-123' } },
    );
  });

  it('sends no auth header when token is absent', async () => {
    const fetchMock = globalThis.fetch as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ models: [] }),
    } as Response);
    await discoverOllama('http://localhost:11434');
    expect(fetchMock).toHaveBeenCalledWith('http://localhost:11434/api/tags', { headers: {} });
  });
```

- [ ] **Step 2: Run discovery test, verify it fails**

Run: `npx vitest run --project backend server/domain/providers/discovery.test.ts`
Expected: FAIL — current call has no second `fetch` arg / no headers.

- [ ] **Step 3: Implement token header in discovery**

In `server/domain/providers/discovery.ts`, replace the `discoverOllama` function with:

```ts
export async function discoverOllama(host: string, token?: string): Promise<string[]> {
  try {
    const headers: Record<string, string> = {};
    if (token) headers.Authorization = `Bearer ${token}`;
    const res = await fetch(`${host.replace(/\/$/, '')}/api/tags`, { headers });
    if (!res.ok) return [];
    const body = await res.json();
    const parsed = TagsResponse.safeParse(body);
    if (!parsed.success) return [];
    return parsed.data.models.map((m) => m.name);
  } catch {
    return [];
  }
}
```

- [ ] **Step 4: Run discovery test, verify it passes**

Run: `npx vitest run --project backend server/domain/providers/discovery.test.ts`
Expected: PASS.

- [ ] **Step 5: Add failing provider test for the token header**

Append to `server/domain/dispatch/providers/ollama.provider.test.ts` (inside the `describe`):

```ts
  it('adds Authorization: Bearer header to /api/chat when token is set', async () => {
    const fetchMock = globalThis.fetch as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValue({
      ok: true,
      body: { getReader: () => ({ read: async () => ({ done: true, value: undefined }) }) },
    } as unknown as Response);

    const p = new OllamaProvider({ host: 'http://gpu.lan:11434', model: 'llama3', token: 'tok-123' });
    for await (const _ of p.stream(
      { systemInstruction: '', history: [], userMessage: 'hi' },
      new AbortController().signal,
    )) { /* drain */ }

    const [, init] = fetchMock.mock.calls[0];
    expect((init as RequestInit).headers).toMatchObject({ Authorization: 'Bearer tok-123' });
  });
```

> Note: match the exact `ProviderRequest` shape the other tests in this file use (check the file's existing `stream(...)` calls and copy their argument object — fields like `mcpTools`/`toolResults` may be required).

- [ ] **Step 6: Run provider test, verify it fails**

Run: `npx vitest run --project backend server/domain/dispatch/providers/ollama.provider.test.ts`
Expected: FAIL — `token` not on `OllamaProviderOpts` (type error) / header missing.

- [ ] **Step 7: Implement token in the provider**

In `server/domain/dispatch/providers/ollama.provider.ts`:

Change the opts interface:

```ts
export interface OllamaProviderOpts {
  host: string;
  model: string;
  token?: string;
}
```

In `stream()`, replace the `headers` of the `fetch` call:

```ts
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (this.opts.token) headers.Authorization = `Bearer ${this.opts.token}`;

    const res = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal,
    });
```

- [ ] **Step 8: Run provider test, verify it passes**

Run: `npx vitest run --project backend server/domain/dispatch/providers/ollama.provider.test.ts`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add server/domain/providers/discovery.ts server/domain/providers/discovery.test.ts \
        server/domain/dispatch/providers/ollama.provider.ts server/domain/dispatch/providers/ollama.provider.test.ts
git commit -m "feat(ollama): optional Bearer token in discovery + provider"
```

---

## Task 3: Multi-endpoint ProviderRegistry

**Files:**
- Modify: `server/domain/providers/registry.ts`
- Test: `server/domain/providers/registry.test.ts`
- Modify: `server/routes/providers.routes.test.ts` (registry deps in `makeApp`)
- Modify: `server/test/registry.test-helper.ts` (registry deps)
- Modify: `server/domain/providers/registry.test.ts` (deps factory)

- [ ] **Step 1: Update the registry deps interface + refresh logic**

In `server/domain/providers/registry.ts`:

Replace `ProviderRegistryDeps` Ollama-related fields:

```ts
export interface ProviderRegistryDeps {
  resolveKey: (transport: 'gemini' | 'openai' | 'anthropic') => string | undefined;
  detectAnthropicAuth: () => Promise<'oauth' | 'apikey' | 'none'>;
  fakeProvider: AIProvider;
  geminiBuilder: (model: string) => AIProvider;
  listOllamaEndpoints: () => Array<{ id: string; label: string; baseUrl: string; token?: string }>;
  ollamaBuilder: (baseUrl: string, model: string, token?: string) => AIProvider;
  anthropicBuilder: (model: string) => AIProvider;
  openAIBuilder: (model: string) => AIProvider;
  defaultOverride?: string;
}
```

(`ollamaHost: string` is removed.)

Replace the `// Ollama (discovery)` block in `refresh()` with:

```ts
    // Ollama (per-endpoint discovery). Local endpoint keeps `ollama:<model>`
    // for backward-compatibility with sessions saved before multi-endpoint.
    for (const ep of this.deps.listOllamaEndpoints()) {
      const tags = await discoverOllama(ep.baseUrl, ep.token);
      for (const tag of tags) {
        const provider = this.deps.ollamaBuilder(ep.baseUrl, tag, ep.token);
        const name = ep.id === 'local' ? `ollama:${tag}` : `ollama:${ep.id}:${tag}`;
        next.set(name, {
          provider,
          descriptor: {
            name,
            transport: 'ollama',
            model: tag,
            capabilities: provider.capabilities,
            displayName: `Ollama (${ep.label}) / ${tag}`,
          },
        });
      }
    }
```

(The `displayNameFor` helper's `'ollama'` fallthrough branch is now unused by this block but stays as the function's default return — leave it.)

- [ ] **Step 2: Update the registry test deps factory + add failing tests**

This file's deps factory is `baseDeps(overrides)` (line ~13) and it has a `makeFake(model)` helper; `vi` must be imported (add `vi` to the `vitest` import on line 1 — currently `{ describe, it, expect }`).

In `baseDeps()` (line ~17), remove `ollamaHost: 'http://localhost:11434',` and replace `ollamaBuilder: () => makeFake('o'),` with:

```ts
    listOllamaEndpoints: () => [{ id: 'local', label: 'local', baseUrl: 'http://localhost:11434' }],
    ollamaBuilder: (_baseUrl: string, model: string) => makeFake(model),
```

Add these tests to `server/domain/providers/registry.test.ts` (note: `baseDeps` takes an overrides object, so no mutation needed):

```ts
  it('registers local Ollama models as ollama:<model> (backward compatible)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true, json: () => Promise.resolve({ models: [{ name: 'llama3:latest' }] }),
    } as Response));
    const reg = new ProviderRegistry(baseDeps());
    await reg.refresh();
    expect(reg.describe('ollama:llama3:latest')?.displayName).toBe('Ollama (local) / llama3:latest');
    vi.unstubAllGlobals();
  });

  it('namespaces remote endpoint models as ollama:<id>:<model> with no collision', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true, json: () => Promise.resolve({ models: [{ name: 'llama3' }] }),
    } as Response));
    const reg = new ProviderRegistry(baseDeps({
      listOllamaEndpoints: () => [
        { id: 'local', label: 'local', baseUrl: 'http://localhost:11434' },
        { id: 'abc', label: 'gpu', baseUrl: 'http://gpu.lan:11434', token: 'tok' },
      ],
    }));
    await reg.refresh();
    expect(reg.get('ollama:llama3')).not.toBeNull();
    expect(reg.get('ollama:abc:llama3')).not.toBeNull();
    expect(reg.describe('ollama:abc:llama3')?.displayName).toBe('Ollama (gpu) / llama3');
    vi.unstubAllGlobals();
  });
```

- [ ] **Step 3: Fix the other two registry-construction call sites**

Both files build a `ProviderRegistry` and have a local `makeFake(model)` helper. In each, remove `ollamaHost: 'http://localhost:11434',` and replace the `ollamaBuilder: () => makeFake('o'),` line (in `providers.routes.test.ts` `makeApp()` line ~26) / the equivalent in `server/test/registry.test-helper.ts` (line ~10) with:

```ts
    listOllamaEndpoints: () => [{ id: 'local', label: 'local', baseUrl: 'http://localhost:11434' }],
    ollamaBuilder: (_baseUrl: string, model: string) => makeFake(model),
```

> If `registry.test-helper.ts` has no `makeFake`, use the fake-provider value it already passes to its other builders.

- [ ] **Step 4: Run the registry tests, verify pass**

Run: `npx vitest run --project backend server/domain/providers/registry.test.ts`
Expected: PASS (existing + 2 new).

- [ ] **Step 5: Type-check the touched call sites**

Run: `npm run lint`
Expected: PASS (no `ollamaHost`/old-`ollamaBuilder` type errors). `server/index.ts` will still error here — that is fixed in Task 5; if so, note it and continue, OR do Task 5 before re-running lint.

- [ ] **Step 6: Commit**

```bash
git add server/domain/providers/registry.ts server/domain/providers/registry.test.ts \
        server/test/registry.test-helper.ts server/routes/providers.routes.test.ts
git commit -m "feat(ollama): registry iterates multiple endpoints with namespaced names"
```

---

## Task 4: Per-endpoint status probing

**Files:**
- Modify: `server/domain/providers/auth-status.types.ts`
- Modify: `server/domain/providers/auth-status.ts`
- Test: `server/domain/providers/auth-status.test.ts`

- [ ] **Step 1: Extend the report types**

In `server/domain/providers/auth-status.types.ts`, add below `TransportStatus`:

```ts
export interface OllamaEndpointStatus {
  id: string;
  label: string;
  fixed: boolean;
  state: AuthState;
  reason?: string;
  detail?: string;
}
```

And change `AuthStatusReport` to:

```ts
export interface AuthStatusReport {
  statuses: TransportStatus[]; // anthropic, openai, gemini (keyed, fixed order)
  ollama: OllamaEndpointStatus[];
  checkedAt: number;
}
```

- [ ] **Step 2: Add failing auth-status tests**

In `server/domain/providers/auth-status.test.ts`, update the deps used by the suite: replace `ollamaHost: 'http://localhost:11434',` with

```ts
    listOllamaEndpoints: () => [{ id: 'local', label: 'local', baseUrl: 'http://localhost:11434' }],
```

Add:

```ts
  it('probes each Ollama endpoint and returns a per-endpoint list', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('gpu.lan')) {
        return new Response(JSON.stringify({ models: [{ name: 'a' }, { name: 'b' }] }), { status: 200 });
      }
      return new Response(JSON.stringify({ models: [{ name: 'a' }] }), { status: 200 });
    }) as unknown as typeof fetch;

    const svc = new AuthStatusService({
      detectAnthropicAuth: async () => 'none',
      getOpenAIKey: () => undefined,
      getGeminiKey: () => undefined,
      listOllamaEndpoints: () => [
        { id: 'local', label: 'local', baseUrl: 'http://localhost:11434' },
        { id: 'abc', label: 'gpu', baseUrl: 'http://gpu.lan:11434', token: 'tok' },
      ],
      fetch: fetchMock,
      timeoutMs: 50,
    });

    const report = await svc.probe();
    expect(report.ollama).toHaveLength(2);
    const local = report.ollama.find((e) => e.id === 'local')!;
    expect(local).toMatchObject({ fixed: true, state: 'ok', reason: '1 models' });
    const gpu = report.ollama.find((e) => e.id === 'abc')!;
    expect(gpu).toMatchObject({ fixed: false, state: 'ok', reason: '2 models' });
    // keyed transports never include ollama
    expect(report.statuses.some((s) => s.transport === 'ollama')).toBe(false);
  });

  it('marks an unreachable Ollama endpoint as error', async () => {
    const svc = new AuthStatusService({
      detectAnthropicAuth: async () => 'none',
      getOpenAIKey: () => undefined,
      getGeminiKey: () => undefined,
      listOllamaEndpoints: () => [{ id: 'local', label: 'local', baseUrl: 'http://localhost:11434' }],
      fetch: vi.fn(async () => { const e = new Error('connect ECONNREFUSED'); throw e; }) as unknown as typeof fetch,
      timeoutMs: 50,
    });
    const report = await svc.probe();
    expect(report.ollama[0].state).toBe('error');
  });
```

> Adjust the suite's pre-existing default-deps object (the one shared at the top of the file) the same way — it must no longer reference `ollamaHost`.

- [ ] **Step 3: Run, verify it fails**

Run: `npx vitest run --project backend server/domain/providers/auth-status.test.ts`
Expected: FAIL — `listOllamaEndpoints` not on deps / `report.ollama` undefined.

- [ ] **Step 4: Implement per-endpoint probing**

In `server/domain/providers/auth-status.ts`:

Update imports to include the new type:

```ts
import type {
  AuthStatusReport,
  ProviderTransport,
  TransportStatus,
  OllamaEndpointStatus,
} from './auth-status.types';
```

Change `AuthStatusServiceDeps`: replace `ollamaHost: string;` with

```ts
  listOllamaEndpoints: () => Array<{ id: string; label: string; baseUrl: string; token?: string }>;
```

Replace `probe()` with:

```ts
  async probe(transports?: ProviderTransport[]): Promise<AuthStatusReport> {
    const wanted = transports ?? TRANSPORT_ORDER;
    const keyed = wanted.filter((t): t is Exclude<ProviderTransport, 'ollama'> => t !== 'ollama');
    const statuses = await Promise.all(keyed.map((t) => this.probeOne(t)));
    const ollama = wanted.includes('ollama') ? await this.probeOllamaEndpoints() : [];
    return { statuses, ollama, checkedAt: Date.now() };
  }
```

Change `probeOne` to only handle the three keyed transports (remove the trailing `return await this.probeOllama();` else-branch):

```ts
  private async probeOne(
    transport: Exclude<ProviderTransport, 'ollama'>,
  ): Promise<TransportStatus> {
    try {
      if (transport === 'anthropic') return await this.probeAnthropic();
      if (transport === 'openai') return await this.probeOpenAI();
      return await this.probeGemini();
    } catch (err) {
      return { transport, state: 'error', reason: shortReason(err), detail: longDetail(err) };
    }
  }
```

Replace `probeOllama()` with the per-endpoint version:

```ts
  private async probeOllamaEndpoints(): Promise<OllamaEndpointStatus[]> {
    const eps = this.deps.listOllamaEndpoints();
    return Promise.all(eps.map((ep) => this.probeOneOllama(ep)));
  }

  private async probeOneOllama(ep: {
    id: string;
    label: string;
    baseUrl: string;
    token?: string;
  }): Promise<OllamaEndpointStatus> {
    const base = { id: ep.id, label: ep.label, fixed: ep.id === 'local' };
    try {
      const headers: Record<string, string> = {};
      if (ep.token) headers.Authorization = `Bearer ${ep.token}`;
      const url = `${ep.baseUrl.replace(/\/$/, '')}/api/tags`;
      const res = await this.fetchWithTimeout(url, { headers });
      if (!res.ok) {
        return { ...base, state: 'error', reason: String(res.status), detail: res.statusText || `HTTP ${res.status}` };
      }
      const body = (await res.json().catch(() => ({ models: [] }))) as { models?: Array<{ name: string }> };
      const count = body.models?.length ?? 0;
      return { ...base, state: 'ok', reason: `${count} models` };
    } catch (err) {
      return { ...base, state: 'error', reason: shortReason(err), detail: longDetail(err) };
    }
  }
```

- [ ] **Step 5: Run, verify it passes**

Run: `npx vitest run --project backend server/domain/providers/auth-status.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add server/domain/providers/auth-status.ts server/domain/providers/auth-status.types.ts server/domain/providers/auth-status.test.ts
git commit -m "feat(ollama): per-endpoint status probing in AuthStatusService"
```

---

## Task 5: CRUD routes + server wiring

**Files:**
- Modify: `server/routes/providers.routes.ts`
- Test: `server/routes/providers.routes.test.ts`
- Modify: `server/app.ts`
- Modify: `server/index.ts`

- [ ] **Step 1: Wire the store through app.ts**

In `server/app.ts`:

Add an import:

```ts
import type { OllamaEndpointStore } from '@/server/domain/providers/ollama-endpoints.store';
```

Add to `AppDeps` (near `keyVault?`):

```ts
  ollamaEndpointStore?: OllamaEndpointStore;
```

Update the `createProvidersRoutes(...)` call to pass it as the 6th argument:

```ts
      createProvidersRoutes(
        deps.providers,
        deps.authStatusService,
        deps.keyVault,
        deps.keyVaultHooks,
        deps.buildInfoRowsCtx,
        deps.ollamaEndpointStore,
      ),
```

- [ ] **Step 2: Construct + inject the store in index.ts**

In `server/index.ts`, after `const ollamaHost = ...` (line ~97) and after `db` is available, add:

```ts
  const ollamaEndpointStore = new OllamaEndpointStore(db);
  const listOllamaEndpoints = () => [
    { id: 'local', label: 'local', baseUrl: ollamaHost },
    ...ollamaEndpointStore.listResolved(),
  ];
```

Add the import near the other domain imports:

```ts
import { OllamaEndpointStore } from './domain/providers/ollama-endpoints.store';
```

Replace the registry Ollama deps (`ollamaHost`, `ollamaBuilder`) with:

```ts
    listOllamaEndpoints,
    ollamaBuilder: (baseUrl, model, token) => new OllamaProvider({ host: baseUrl, model, token }),
```

(Remove the now-unused `ollamaHost` field from the `ProviderRegistry` constructor object; keep the `ollamaHost` const — it is still used for `AuthStatusService`, `buildInfoRowsCtx`, and `listOllamaEndpoints`.)

Replace the `AuthStatusService` `ollamaHost` dep with:

```ts
    listOllamaEndpoints,
```

Add `ollamaEndpointStore` to the `createApp({ ... })` deps object.

- [ ] **Step 3: Add failing route tests**

This file already imports `request` from `supertest` and `makeTestDb` (line 12), and `makeApp()` calls `createApp({ providers: reg })` (line 36). Add the store import at the top:

```ts
import { OllamaEndpointStore } from '@/server/domain/providers/ollama-endpoints.store';
```

In `makeApp()`, before the `return`, create the store and pass it through `createApp`:

```ts
  const db = makeTestDb();
  const ollamaEndpointStore = new OllamaEndpointStore(db);
  return {
    app: createApp({
      providers: reg,
      ollamaEndpointStore,
      buildInfoRowsCtx: { anthropicCliPresent: false, ollamaHost: 'http://localhost:11434' },
    }),
    reg,
  };
```

(No `authStatusService` is wired here, so `status` in POST/PUT responses is `null` — the tests below assert only on `endpoint`.)

Add this describe block (`request(app)` is the existing supertest pattern; `makeApp()` is async, hence `await`):

```ts
describe('ollama-endpoints routes', () => {
  it('GET returns the fixed local endpoint first', async () => {
    const { app } = await makeApp();
    const res = await request(app).get('/api/providers/ollama-endpoints');
    expect(res.status).toBe(200);
    expect(res.body.endpoints[0]).toMatchObject({ id: 'local', fixed: true });
  });

  it('POST creates a remote endpoint', async () => {
    const { app } = await makeApp();
    const res = await request(app)
      .post('/api/providers/ollama-endpoints')
      .send({ label: 'gpu', baseUrl: 'http://gpu.lan:11434' });
    expect(res.status).toBe(200);
    expect(res.body.endpoint).toMatchObject({ label: 'gpu', fixed: false, hasToken: false });
  });

  it('POST rejects an invalid base URL', async () => {
    const { app } = await makeApp();
    const res = await request(app)
      .post('/api/providers/ollama-endpoints')
      .send({ label: 'bad', baseUrl: 'not-a-url' });
    expect(res.status).toBe(400);
  });

  it('POST rejects a duplicate label', async () => {
    const { app } = await makeApp();
    await request(app).post('/api/providers/ollama-endpoints').send({ label: 'dup', baseUrl: 'http://a' });
    const res = await request(app).post('/api/providers/ollama-endpoints').send({ label: 'dup', baseUrl: 'http://b' });
    expect(res.status).toBe(400);
  });

  it('PUT and DELETE reject the fixed local id', async () => {
    const { app } = await makeApp();
    const put = await request(app).put('/api/providers/ollama-endpoints/local').send({ label: 'x' });
    expect(put.status).toBe(400);
    const del = await request(app).delete('/api/providers/ollama-endpoints/local');
    expect(del.status).toBe(400);
  });

  it('DELETE removes a created endpoint', async () => {
    const { app } = await makeApp();
    const created = await request(app).post('/api/providers/ollama-endpoints').send({ label: 'tmp', baseUrl: 'http://a' });
    const id = created.body.endpoint.id;
    const del = await request(app).delete(`/api/providers/ollama-endpoints/${id}`);
    expect(del.status).toBe(200);
  });
});
```

> Use the file's existing HTTP-test mechanism. If it imports `request` from `supertest`, keep that; if it calls routes another way, mirror that. Have `makeApp()` return whatever shape the existing tests destructure.

- [ ] **Step 4: Run, verify it fails**

Run: `npx vitest run --project backend server/routes/providers.routes.test.ts`
Expected: FAIL — routes/`/ollama-endpoints` 404.

- [ ] **Step 5: Implement the routes**

In `server/routes/providers.routes.ts`:

Add imports:

```ts
import type { OllamaEndpointStore } from '@/server/domain/providers/ollama-endpoints.store';
import type { OllamaEndpointRecord } from '@/server/domain/providers/ollama-endpoints.types';
```

Add the store as the 6th parameter of `createProvidersRoutes`:

```ts
export function createProvidersRoutes(
  registry: ProviderRegistry,
  authStatusService?: AuthStatusService,
  keyVault?: KeyVaultService,
  hooks?: KeyVaultHooks,
  buildInfoRowsCtx?: { anthropicCliPresent: boolean; ollamaHost: string },
  ollamaEndpointStore?: OllamaEndpointStore,
): Router {
```

Add a URL validator and a SQLite-unique guard near the top of the function body:

```ts
  const isHttpUrl = (v: unknown): v is string => {
    if (typeof v !== 'string' || v.trim() === '') return false;
    try {
      const u = new URL(v);
      return u.protocol === 'http:' || u.protocol === 'https:';
    } catch {
      return false;
    }
  };

  const localRow = (): OllamaEndpointRecord => ({
    id: 'local',
    label: 'local',
    baseUrl: buildInfoRowsCtx?.ollamaHost ?? 'http://localhost:11434',
    hasToken: false,
    tokenMasked: null,
    fixed: true,
    createdAt: null,
    updatedAt: null,
  });

  const ollamaStatusFor = async (id: string) => {
    if (!authStatusService) return null;
    const report = await authStatusService.probe(['ollama']);
    return report.ollama.find((e) => e.id === id) ?? null;
  };

  const isUniqueViolation = (err: unknown): boolean =>
    typeof (err as { code?: string })?.code === 'string' &&
    (err as { code: string }).code.startsWith('SQLITE_CONSTRAINT');
```

Add the route handlers (before `return router;`):

```ts
  router.get(
    '/ollama-endpoints',
    asyncHandler(async (_req, res) => {
      if (!ollamaEndpointStore) {
        res.status(503).json({ error: { code: 'NO_OLLAMA_STORE', message: 'Ollama endpoint store not configured' } });
        return;
      }
      res.json({ endpoints: [localRow(), ...ollamaEndpointStore.list()] });
    }),
  );

  router.post(
    '/ollama-endpoints',
    asyncHandler(async (req, res) => {
      if (!ollamaEndpointStore) {
        res.status(503).json({ error: { code: 'NO_OLLAMA_STORE', message: 'Ollama endpoint store not configured' } });
        return;
      }
      const label = typeof req.body?.label === 'string' ? req.body.label.trim() : '';
      const baseUrl = req.body?.baseUrl;
      const token = typeof req.body?.token === 'string' && req.body.token.trim() !== '' ? req.body.token.trim() : undefined;
      if (!label) throw new ValidationError('label required');
      if (!isHttpUrl(baseUrl)) throw new ValidationError('baseUrl must be a valid http(s) URL');
      let endpoint: OllamaEndpointRecord;
      try {
        endpoint = ollamaEndpointStore.create({ label, baseUrl, token });
      } catch (err) {
        if (isUniqueViolation(err)) throw new ValidationError(`An endpoint named "${label}" already exists`);
        throw err;
      }
      await registry.refresh();
      const status = await ollamaStatusFor(endpoint.id);
      res.json({ endpoint, status });
    }),
  );

  router.put(
    '/ollama-endpoints/:id',
    asyncHandler(async (req, res) => {
      if (!ollamaEndpointStore) {
        res.status(503).json({ error: { code: 'NO_OLLAMA_STORE', message: 'Ollama endpoint store not configured' } });
        return;
      }
      const { id } = req.params;
      if (id === 'local') throw new ValidationError('The local endpoint is fixed and cannot be edited');
      if (!ollamaEndpointStore.get(id)) {
        res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Endpoint not found' } });
        return;
      }
      const patch: { label?: string; baseUrl?: string; token?: string | null } = {};
      if (typeof req.body?.label === 'string') {
        const l = req.body.label.trim();
        if (!l) throw new ValidationError('label must not be empty');
        patch.label = l;
      }
      if (req.body?.baseUrl !== undefined) {
        if (!isHttpUrl(req.body.baseUrl)) throw new ValidationError('baseUrl must be a valid http(s) URL');
        patch.baseUrl = req.body.baseUrl;
      }
      if (req.body?.token !== undefined) {
        patch.token = req.body.token === null || req.body.token === '' ? null : String(req.body.token).trim();
      }
      let endpoint: OllamaEndpointRecord;
      try {
        endpoint = ollamaEndpointStore.update(id, patch);
      } catch (err) {
        if (isUniqueViolation(err)) throw new ValidationError(`An endpoint with that name already exists`);
        throw err;
      }
      await registry.refresh();
      const status = await ollamaStatusFor(id);
      res.json({ endpoint, status });
    }),
  );

  router.delete(
    '/ollama-endpoints/:id',
    asyncHandler(async (req, res) => {
      if (!ollamaEndpointStore) {
        res.status(503).json({ error: { code: 'NO_OLLAMA_STORE', message: 'Ollama endpoint store not configured' } });
        return;
      }
      const { id } = req.params;
      if (id === 'local') throw new ValidationError('The local endpoint is fixed and cannot be deleted');
      ollamaEndpointStore.remove(id);
      await registry.refresh();
      res.json({ ok: true });
    }),
  );
```

Then update `mergeReport` (bottom of the file) — `AuthStatusReport` now requires an `ollama` field, so the current return won't compile. Replace the whole function with:

```ts
const KEYED_TRANSPORTS: readonly ProviderTransport[] = ['anthropic', 'openai', 'gemini'];

function mergeReport(prior: AuthStatusReport | null, fresh: AuthStatusReport): AuthStatusReport {
  if (!prior) return fresh;
  const byTransport = new Map<string, TransportStatus>();
  for (const s of prior.statuses) byTransport.set(s.transport, s);
  for (const s of fresh.statuses) byTransport.set(s.transport, s);
  return {
    checkedAt: fresh.checkedAt,
    statuses: KEYED_TRANSPORTS
      .map((t) => byTransport.get(t))
      .filter((s): s is TransportStatus => Boolean(s)),
    // A targeted refresh that didn't touch Ollama returns ollama:[]; keep the prior list then.
    ollama: fresh.ollama.length > 0 ? fresh.ollama : prior.ollama,
  };
}
```

Also add `AuthStatusReport` to the imports from `auth-status.types` in this file if not already present.

> Existing auth-status tests in this file (and any other test that builds an `AuthStatusReport` literal) must add `ollama: []` — TypeScript will flag each missing field. Fix them as the compiler reports them.

- [ ] **Step 6: Run the route tests + full backend, verify pass**

Run: `npx vitest run --project backend server/routes/providers.routes.test.ts`
Expected: PASS.

Run: `npx vitest run --project backend`
Expected: PASS (whole backend project green).

- [ ] **Step 7: Type-check**

Run: `npm run lint`
Expected: PASS (server/index.ts now compiles with new deps).

- [ ] **Step 8: Commit**

```bash
git add server/routes/providers.routes.ts server/routes/providers.routes.test.ts server/app.ts server/index.ts
git commit -m "feat(ollama): CRUD routes for endpoints + server wiring"
```

---

## Task 6: Frontend types + API client + store

**Files:**
- Create: `src/types/ollama-endpoints.types.ts`
- Modify: `src/types/provider-auth.types.ts`
- Modify: `src/lib/api/providers.api.ts`
- Create: `src/stores/ollamaEndpoints.store.ts`
- Test: `src/stores/ollamaEndpoints.store.test.ts`

- [ ] **Step 1: Add the client types**

Create `src/types/ollama-endpoints.types.ts`:

```ts
export interface OllamaEndpoint {
  id: string;
  label: string;
  baseUrl: string;
  hasToken: boolean;
  tokenMasked: string | null;
  fixed: boolean;
  createdAt: number | null;
  updatedAt: number | null;
}

export interface OllamaEndpointStatus {
  id: string;
  label: string;
  fixed: boolean;
  state: 'ok' | 'unconfigured' | 'error';
  reason?: string;
  detail?: string;
}

export interface SaveOllamaEndpointResponse {
  endpoint: OllamaEndpoint;
  status: OllamaEndpointStatus | null;
}
```

Update `src/types/provider-auth.types.ts` to add the per-endpoint status to the report:

```ts
import type { OllamaEndpointStatus } from './ollama-endpoints.types';

// ... keep ProviderTransport, AuthState, TransportStatus, TRANSPORT_ORDER ...

export interface AuthStatusReport {
  statuses: TransportStatus[];
  ollama: OllamaEndpointStatus[];
  checkedAt: number;
}
```

> Re-export `OllamaEndpointStatus` from here too if convenient, but the import above is enough.

- [ ] **Step 2: Add API client methods**

In `src/lib/api/providers.api.ts`, add imports:

```ts
import type {
  OllamaEndpoint,
  SaveOllamaEndpointResponse,
} from '@/src/types/ollama-endpoints.types';
```

Add to the `providersApi` object:

```ts
  listOllamaEndpoints: (): Promise<OllamaEndpoint[]> =>
    fetch('/api/providers/ollama-endpoints')
      .then(jsonRes<{ endpoints: OllamaEndpoint[] }>)
      .then((b) => b.endpoints),

  createOllamaEndpoint: (input: { label: string; baseUrl: string; token?: string }): Promise<SaveOllamaEndpointResponse> =>
    fetch('/api/providers/ollama-endpoints', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    }).then(jsonRes<SaveOllamaEndpointResponse>),

  updateOllamaEndpoint: (
    id: string,
    patch: { label?: string; baseUrl?: string; token?: string | null },
  ): Promise<SaveOllamaEndpointResponse> =>
    fetch(`/api/providers/ollama-endpoints/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    }).then(jsonRes<SaveOllamaEndpointResponse>),

  deleteOllamaEndpoint: (id: string): Promise<{ ok: boolean }> =>
    fetch(`/api/providers/ollama-endpoints/${id}`, { method: 'DELETE' })
      .then(jsonRes<{ ok: boolean }>),
```

- [ ] **Step 3: Write the failing store test**

Create `src/stores/ollamaEndpoints.store.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { useOllamaEndpointsStore } from './ollamaEndpoints.store';
import { providersApi } from '@/src/lib/api/providers.api';
import type { OllamaEndpoint } from '@/src/types/ollama-endpoints.types';

const local: OllamaEndpoint = {
  id: 'local', label: 'local', baseUrl: 'http://localhost:11434',
  hasToken: false, tokenMasked: null, fixed: true, createdAt: null, updatedAt: null,
};
const gpu: OllamaEndpoint = {
  id: 'abc', label: 'gpu', baseUrl: 'http://gpu.lan:11434',
  hasToken: false, tokenMasked: null, fixed: false, createdAt: 1, updatedAt: 1,
};

beforeEach(() => {
  useOllamaEndpointsStore.getState()._reset();
  vi.restoreAllMocks();
});
afterEach(() => vi.restoreAllMocks());

describe('useOllamaEndpointsStore', () => {
  it('init() loads endpoints', async () => {
    vi.spyOn(providersApi, 'listOllamaEndpoints').mockResolvedValue([local, gpu]);
    await useOllamaEndpointsStore.getState().init();
    expect(useOllamaEndpointsStore.getState().endpoints).toHaveLength(2);
  });

  it('create() appends the new endpoint on success', async () => {
    vi.spyOn(providersApi, 'listOllamaEndpoints').mockResolvedValue([local]);
    vi.spyOn(providersApi, 'createOllamaEndpoint').mockResolvedValue({ endpoint: gpu, status: null });
    await useOllamaEndpointsStore.getState().init();
    await useOllamaEndpointsStore.getState().create({ label: 'gpu', baseUrl: 'http://gpu.lan:11434' });
    expect(useOllamaEndpointsStore.getState().endpoints.map((e) => e.id)).toContain('abc');
  });

  it('create() surfaces an error and does not append', async () => {
    vi.spyOn(providersApi, 'listOllamaEndpoints').mockResolvedValue([local]);
    vi.spyOn(providersApi, 'createOllamaEndpoint').mockRejectedValue(new Error('already exists'));
    await useOllamaEndpointsStore.getState().init();
    await useOllamaEndpointsStore.getState().create({ label: 'dup', baseUrl: 'http://x' });
    expect(useOllamaEndpointsStore.getState().error).toBe('already exists');
    expect(useOllamaEndpointsStore.getState().endpoints).toHaveLength(1);
  });

  it('remove() optimistically drops the row then rolls back on error', async () => {
    vi.spyOn(providersApi, 'listOllamaEndpoints').mockResolvedValue([local, gpu]);
    vi.spyOn(providersApi, 'deleteOllamaEndpoint').mockRejectedValue(new Error('boom'));
    await useOllamaEndpointsStore.getState().init();
    await useOllamaEndpointsStore.getState().remove('abc');
    expect(useOllamaEndpointsStore.getState().endpoints.map((e) => e.id)).toContain('abc'); // rolled back
    expect(useOllamaEndpointsStore.getState().error).toBe('boom');
  });
});
```

- [ ] **Step 4: Run, verify it fails**

Run: `npx vitest run --project frontend src/stores/ollamaEndpoints.store.test.ts`
Expected: FAIL — cannot find module `./ollamaEndpoints.store`.

- [ ] **Step 5: Implement the store**

Create `src/stores/ollamaEndpoints.store.ts`:

```ts
import { create } from 'zustand';
import { providersApi } from '@/src/lib/api/providers.api';
import type { OllamaEndpoint } from '@/src/types/ollama-endpoints.types';
import { useProvidersStore } from './providers.store';
import { useProviderAuthStore } from './providerAuth.store';

interface OllamaEndpointsState {
  endpoints: OllamaEndpoint[];
  loading: boolean;
  error: string | null;
  init(): Promise<void>;
  create(input: { label: string; baseUrl: string; token?: string }): Promise<void>;
  update(id: string, patch: { label?: string; baseUrl?: string; token?: string | null }): Promise<void>;
  remove(id: string): Promise<void>;
  _reset(): void;
}

const initial = {
  endpoints: [] as OllamaEndpoint[],
  loading: false,
  error: null as string | null,
};

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : 'Operation failed';
}

function syncProviders(): void {
  void useProvidersStore.getState().init();
  void useProviderAuthStore.getState().refresh('ollama');
}

export const useOllamaEndpointsStore = create<OllamaEndpointsState>((set, get) => ({
  ...initial,

  _reset: () => set(initial),

  init: async () => {
    set({ loading: true, error: null });
    try {
      const endpoints = await providersApi.listOllamaEndpoints();
      set({ endpoints, loading: false, error: null });
    } catch (e) {
      set({ loading: false, error: errMsg(e) });
    }
  },

  create: async (input) => {
    set({ loading: true, error: null });
    try {
      const { endpoint } = await providersApi.createOllamaEndpoint(input);
      set((s) => ({ endpoints: [...s.endpoints, endpoint], loading: false, error: null }));
      syncProviders();
    } catch (e) {
      set({ loading: false, error: errMsg(e) });
    }
  },

  update: async (id, patch) => {
    const prev = get().endpoints;
    set({ loading: true, error: null });
    try {
      const { endpoint } = await providersApi.updateOllamaEndpoint(id, patch);
      set((s) => ({
        endpoints: s.endpoints.map((e) => (e.id === id ? endpoint : e)),
        loading: false,
        error: null,
      }));
      syncProviders();
    } catch (e) {
      set({ endpoints: prev, loading: false, error: errMsg(e) });
    }
  },

  remove: async (id) => {
    const prev = get().endpoints;
    // optimistic drop
    set((s) => ({ endpoints: s.endpoints.filter((e) => e.id !== id), error: null }));
    try {
      await providersApi.deleteOllamaEndpoint(id);
      syncProviders();
    } catch (e) {
      set({ endpoints: prev, error: errMsg(e) }); // rollback
    }
  },
}));
```

- [ ] **Step 6: Run, verify it passes**

Run: `npx vitest run --project frontend src/stores/ollamaEndpoints.store.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/types/ollama-endpoints.types.ts src/types/provider-auth.types.ts \
        src/lib/api/providers.api.ts src/stores/ollamaEndpoints.store.ts src/stores/ollamaEndpoints.store.test.ts
git commit -m "feat(ollama): client types, API methods, optimistic endpoints store"
```

---

## Task 7: providerAuth store carries the ollama array

**Files:**
- Modify: `src/stores/providerAuth.store.ts`
- Test: `src/stores/providerAuth.store.test.ts` (existing — update fixtures)

- [ ] **Step 1: Update the store to hold `ollama`**

In `src/stores/providerAuth.store.ts`:

Add to imports:

```ts
import type { OllamaEndpointStatus } from '@/src/types/ollama-endpoints.types';
```

Add `ollama` to state interface and initial:

```ts
interface ProviderAuthState {
  statuses: TransportStatus[];
  ollama: OllamaEndpointStatus[];
  checkedAt: number | null;
  loading: boolean;
  error: string | null;
  init(): Promise<void>;
  refresh(transport?: ProviderTransport): Promise<void>;
  _reset(): void;
}

const initial = {
  statuses: [] as TransportStatus[],
  ollama: [] as OllamaEndpointStatus[],
  checkedAt: null as number | null,
  loading: false,
  error: null as string | null,
};
```

In both `init()` and `refresh()`, include `ollama` when setting from the report:

```ts
      set({ statuses: report.statuses, ollama: report.ollama, checkedAt: report.checkedAt, loading: false, error: null });
```

- [ ] **Step 2: Update existing store test fixtures + add an assertion**

In `src/stores/providerAuth.store.test.ts`, any mocked `AuthStatusReport` must now include `ollama: []` (or a sample array). Add one test:

```ts
  it('stores the ollama endpoint statuses from the report', async () => {
    vi.spyOn(providersApi, 'fetchAuthStatus').mockResolvedValue({
      statuses: [],
      ollama: [{ id: 'local', label: 'local', fixed: true, state: 'ok', reason: '2 models' }],
      checkedAt: 1,
    });
    await useProviderAuthStore.getState().init();
    expect(useProviderAuthStore.getState().ollama).toHaveLength(1);
  });
```

> Match the file's existing import names (`providersApi`, `useProviderAuthStore`) and mocking style. Update every pre-existing mocked report in this file to add `ollama: []`.

- [ ] **Step 3: Run, verify pass**

Run: `npx vitest run --project frontend src/stores/providerAuth.store.test.ts`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/stores/providerAuth.store.ts src/stores/providerAuth.store.test.ts
git commit -m "feat(ollama): providerAuth store carries per-endpoint status"
```

---

## Task 8: ui.store toggle + OllamaEndpointsModal

**Files:**
- Modify: `src/stores/ui.store.ts`
- Create: `src/components/providers/OllamaEndpointsModal.tsx`
- Test: `src/components/providers/OllamaEndpointsModal.test.tsx`
- Modify: `src/App.tsx`

- [ ] **Step 1: Add the modal toggle to ui.store**

In `src/stores/ui.store.ts`:

Add to the `UiState` interface (near `keyVaultOpen`):

```ts
  ollamaEndpointsOpen: boolean;
  openOllamaEndpoints(): void;
  closeOllamaEndpoints(): void;
```

Add to `initial`:

```ts
  ollamaEndpointsOpen: false,
```

Add the actions in the store body (near `openKeyVault`):

```ts
  openOllamaEndpoints: () => set({ ollamaEndpointsOpen: true }),
  closeOllamaEndpoints: () => set({ ollamaEndpointsOpen: false }),
```

- [ ] **Step 2: Write the failing modal test**

Create `src/components/providers/OllamaEndpointsModal.test.tsx`:

```tsx
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { OllamaEndpointsModal } from './OllamaEndpointsModal';
import { useUiStore } from '@/src/stores/ui.store';
import { useOllamaEndpointsStore } from '@/src/stores/ollamaEndpoints.store';
import { providersApi } from '@/src/lib/api/providers.api';
import type { OllamaEndpoint } from '@/src/types/ollama-endpoints.types';

const local: OllamaEndpoint = {
  id: 'local', label: 'local', baseUrl: 'http://localhost:11434',
  hasToken: false, tokenMasked: null, fixed: true, createdAt: null, updatedAt: null,
};
const gpu: OllamaEndpoint = {
  id: 'abc', label: 'gpu', baseUrl: 'http://gpu.lan:11434',
  hasToken: false, tokenMasked: null, fixed: false, createdAt: 1, updatedAt: 1,
};

beforeEach(() => {
  useOllamaEndpointsStore.getState()._reset();
  useUiStore.getState().openOllamaEndpoints();
  vi.spyOn(providersApi, 'listOllamaEndpoints').mockResolvedValue([local, gpu]);
});
afterEach(() => { vi.restoreAllMocks(); useUiStore.getState().closeOllamaEndpoints(); });

describe('OllamaEndpointsModal', () => {
  it('lists endpoints and marks the local one as fixed (no delete)', async () => {
    render(<OllamaEndpointsModal />);
    expect(await screen.findByText('gpu')).toBeInTheDocument();
    // local row has no delete button
    expect(screen.queryByLabelText('Delete local')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Delete gpu')).toBeInTheDocument();
  });

  it('creates an endpoint from the add form', async () => {
    const createSpy = vi.spyOn(providersApi, 'createOllamaEndpoint').mockResolvedValue({ endpoint: gpu, status: null });
    render(<OllamaEndpointsModal />);
    await screen.findByText('local');
    fireEvent.change(screen.getByLabelText('Endpoint label'), { target: { value: 'gpu' } });
    fireEvent.change(screen.getByLabelText('Endpoint URL'), { target: { value: 'http://gpu.lan:11434' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add endpoint' }));
    await waitFor(() => expect(createSpy).toHaveBeenCalledWith({ label: 'gpu', baseUrl: 'http://gpu.lan:11434', token: undefined }));
  });

  it('deletes a remote endpoint after confirm', async () => {
    const delSpy = vi.spyOn(providersApi, 'deleteOllamaEndpoint').mockResolvedValue({ ok: true });
    render(<OllamaEndpointsModal />);
    await screen.findByText('gpu');
    fireEvent.click(screen.getByLabelText('Delete gpu')); // arm confirm
    fireEvent.click(screen.getByLabelText('Delete gpu')); // confirm
    await waitFor(() => expect(delSpy).toHaveBeenCalledWith('abc'));
  });
});
```

- [ ] **Step 3: Run, verify it fails**

Run: `npx vitest run --project frontend src/components/providers/OllamaEndpointsModal.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 4: Implement the modal**

Create `src/components/providers/OllamaEndpointsModal.tsx`:

```tsx
import { useEffect, useState } from 'react';
import { Trash2, Pencil } from 'lucide-react';
import { useUiStore } from '@/src/stores/ui.store';
import { useOllamaEndpointsStore } from '@/src/stores/ollamaEndpoints.store';
import { useProviderAuthStore } from '@/src/stores/providerAuth.store';
import { Modal } from '@/src/components/ui/Modal';
import { cn } from '@/src/lib/cn';
import type { OllamaEndpoint } from '@/src/types/ollama-endpoints.types';

function dotStateClass(state: string | undefined): string {
  if (state === 'ok') return 'bg-status-ok';
  if (state === 'error') return 'bg-status-error';
  return 'bg-zinc-500';
}

function EndpointRow({ ep }: { ep: OllamaEndpoint }) {
  const remove = useOllamaEndpointsStore((s) => s.remove);
  const update = useOllamaEndpointsStore((s) => s.update);
  const status = useProviderAuthStore((s) => s.ollama.find((e) => e.id === ep.id));
  const [confirm, setConfirm] = useState(false);
  const [editing, setEditing] = useState(false);
  const [label, setLabel] = useState(ep.label);
  const [baseUrl, setBaseUrl] = useState(ep.baseUrl);
  const [token, setToken] = useState('');

  useEffect(() => {
    if (!confirm) return;
    const t = setTimeout(() => setConfirm(false), 4000);
    return () => clearTimeout(t);
  }, [confirm]);

  const handleDelete = () => {
    if (!confirm) { setConfirm(true); return; }
    setConfirm(false);
    void remove(ep.id);
  };

  const handleSaveEdit = async () => {
    await update(ep.id, {
      label: label.trim(),
      baseUrl: baseUrl.trim(),
      token: token === '' ? undefined : token.trim(),
    });
    setEditing(false);
    setToken('');
  };

  return (
    <div data-testid="ollama-endpoint-row" className="flex flex-col gap-1 py-2">
      <div className="flex items-center gap-2">
        <span
          data-testid="status-dot"
          data-state={status?.state ?? 'unknown'}
          className={cn('w-2 h-2 rounded-full flex-shrink-0', dotStateClass(status?.state))}
        />
        <span className="mono-label text-zinc-300">{ep.label}</span>
        {ep.fixed && <span className="text-[10px] font-mono text-zinc-600">fixed</span>}
        {status?.reason && <span className="text-[10px] font-mono text-zinc-500 ml-auto">{status.reason}</span>}
        {!ep.fixed && (
          <div className={cn('flex items-center gap-1', !status?.reason && 'ml-auto')}>
            <button type="button" aria-label={`Edit ${ep.label}`} onClick={() => setEditing((v) => !v)}
              className="px-1.5 py-1 rounded text-zinc-400 hover:text-white border border-border-subtle">
              <Pencil size={12} aria-hidden="true" />
            </button>
            <button type="button" aria-label={`Delete ${ep.label}`} onClick={handleDelete}
              className={cn('px-1.5 py-1 rounded border',
                confirm ? 'bg-status-error/15 text-status-error border-status-error/40'
                        : 'text-zinc-400 hover:text-white border-border-subtle')}>
              <Trash2 size={12} aria-hidden="true" />
            </button>
          </div>
        )}
      </div>
      <div className="text-[10px] font-mono text-zinc-600 pl-4">{ep.baseUrl}{ep.hasToken && ' · token set'}</div>

      {editing && (
        <div className="flex flex-col gap-1.5 pl-4 pt-1">
          <input aria-label={`Edit label ${ep.label}`} value={label} onChange={(e) => setLabel(e.target.value)}
            className="bg-surface-2 border border-border-subtle rounded px-2 py-1 text-[11px] font-mono text-zinc-200" />
          <input aria-label={`Edit URL ${ep.label}`} value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)}
            className="bg-surface-2 border border-border-subtle rounded px-2 py-1 text-[11px] font-mono text-zinc-200" />
          <input aria-label={`Edit token ${ep.label}`} type="password" value={token} onChange={(e) => setToken(e.target.value)}
            placeholder={ep.hasToken ? 'token set — type to replace' : 'no auth'}
            className="bg-surface-2 border border-border-subtle rounded px-2 py-1 text-[11px] font-mono text-zinc-200 placeholder:text-zinc-600" />
          <div className="flex gap-1.5">
            <button type="button" onClick={handleSaveEdit}
              className="px-2 py-1 rounded text-[10px] font-mono bg-accent/15 text-accent hover:bg-accent/25">Save</button>
            <button type="button" onClick={() => { setEditing(false); setToken(''); }}
              className="px-2 py-1 rounded text-[10px] font-mono bg-surface-2 text-zinc-400 border border-border-subtle">Cancel</button>
          </div>
        </div>
      )}
    </div>
  );
}

function AddForm() {
  const create = useOllamaEndpointsStore((s) => s.create);
  const [label, setLabel] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState(false);

  const canSubmit = label.trim() !== '' && baseUrl.trim() !== '' && !busy;

  const handleAdd = async () => {
    if (!canSubmit) return;
    setBusy(true);
    try {
      await create({ label: label.trim(), baseUrl: baseUrl.trim(), token: token.trim() === '' ? undefined : token.trim() });
      setLabel(''); setBaseUrl(''); setToken('');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-1.5 pt-3">
      <div className="mono-label text-zinc-400">Add endpoint</div>
      <input aria-label="Endpoint label" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="label (e.g. workstation)"
        className="bg-surface-2 border border-border-subtle rounded px-2 py-1 text-[11px] font-mono text-zinc-200 placeholder:text-zinc-600" />
      <input aria-label="Endpoint URL" value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="http://host:11434"
        className="bg-surface-2 border border-border-subtle rounded px-2 py-1 text-[11px] font-mono text-zinc-200 placeholder:text-zinc-600" />
      <input aria-label="Endpoint token" type="password" value={token} onChange={(e) => setToken(e.target.value)} placeholder="Bearer token (leave empty for no auth)"
        className="bg-surface-2 border border-border-subtle rounded px-2 py-1 text-[11px] font-mono text-zinc-200 placeholder:text-zinc-600" />
      <button type="button" onClick={handleAdd} disabled={!canSubmit} aria-busy={busy}
        className="self-start px-2 py-1 rounded text-[10px] font-mono bg-accent/15 text-accent hover:bg-accent/25 disabled:opacity-40 disabled:cursor-not-allowed">
        Add endpoint
      </button>
    </div>
  );
}

export function OllamaEndpointsModal() {
  const open = useUiStore((s) => s.ollamaEndpointsOpen);
  const close = useUiStore((s) => s.closeOllamaEndpoints);
  const init = useOllamaEndpointsStore((s) => s.init);
  const endpoints = useOllamaEndpointsStore((s) => s.endpoints);
  const error = useOllamaEndpointsStore((s) => s.error);

  useEffect(() => {
    if (open) init().catch(() => {});
  }, [open, init]);

  if (!open) return null;

  return (
    <Modal open={open} onClose={close} title="Ollama Endpoints" className="max-w-lg">
      <div className="flex flex-col">
        {error && (
          <div className="mb-3 text-[10px] font-mono text-status-error bg-status-error/10 rounded px-2 py-1">{error}</div>
        )}
        <div className="flex flex-col divide-y divide-border-subtle">
          {endpoints.map((ep) => <EndpointRow key={ep.id} ep={ep} />)}
        </div>
        <AddForm />
      </div>
    </Modal>
  );
}
```

> Confirm the `Modal` component's prop names (`open`, `onClose`, `title`, `className`) match `src/components/ui/Modal.tsx` — copy them exactly as `KeyVaultModal` uses them.

- [ ] **Step 5: Mount the modal in App.tsx**

In `src/App.tsx`, import and render `<OllamaEndpointsModal />` next to where `<KeyVaultModal />` is rendered (find that line and add the new component beside it).

- [ ] **Step 6: Run, verify pass**

Run: `npx vitest run --project frontend src/components/providers/OllamaEndpointsModal.test.tsx`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/stores/ui.store.ts src/components/providers/OllamaEndpointsModal.tsx \
        src/components/providers/OllamaEndpointsModal.test.tsx src/App.tsx
git commit -m "feat(ollama): dedicated endpoints management modal"
```

---

## Task 9: Provider panel Ollama sub-block

**Files:**
- Modify: `src/components/sidebar/ProviderAuthSection.tsx`
- Test: `src/components/sidebar/ProviderAuthSection.test.tsx`

- [ ] **Step 1: Update the now-stale existing test**

The existing test `renders 4 rows in TRANSPORT_ORDER (...)` asserts `toHaveLength(4)` and `rows[3]` contains `'Ollama'`. After this task, Ollama leaves the keyed loop, so there are only **3** `provider-auth-row` elements. Update that test:

```tsx
  it('renders 3 keyed rows in order (anthropic, openai, gemini)', () => {
    useProviderAuthStore.setState({ statuses: allStatuses });
    render(<ProviderAuthSection />);
    const rows = screen.getAllByTestId('provider-auth-row');
    expect(rows).toHaveLength(3);
    expect(rows[0].textContent).toContain('Anthropic');
    expect(rows[1].textContent).toContain('OpenAI');
    expect(rows[2].textContent).toContain('Gemini');
  });
```

Also scan the rest of this file for any assertion indexing `rows[3]` or expecting an Ollama `provider-auth-row`, and adjust (Ollama now renders as `ollama-status-row`, fed by the store's `ollama` array, not `statuses`).

- [ ] **Step 2: Write the failing panel test (new behaviour)**

`userEvent` is already imported here; spy on the action by overriding it via `setState` (the file's pattern for `refresh`). Add:

```tsx
  it('renders one row per Ollama endpoint and opens the modal via the manage button', async () => {
    const openSpy = vi.fn();
    useUiStore.setState({ openOllamaEndpoints: openSpy });
    useProviderAuthStore.setState({
      statuses: [],
      ollama: [
        { id: 'local', label: 'local', fixed: true, state: 'ok', reason: '2 models' },
        { id: 'abc', label: 'gpu', fixed: false, state: 'error', reason: '401' },
      ],
    });
    const user = userEvent.setup();
    render(<ProviderAuthSection />);
    expect(screen.getByText('local')).toBeInTheDocument();
    expect(screen.getByText('gpu')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /manage ollama endpoints/i }));
    expect(openSpy).toHaveBeenCalled();
  });
```

- [ ] **Step 3: Run, verify the new test fails**

Run: `npx vitest run --project frontend src/components/sidebar/ProviderAuthSection.test.tsx`
Expected: FAIL — no per-endpoint rows / no "manage ollama endpoints" button.

- [ ] **Step 4: Implement the Ollama sub-block**

In `src/components/sidebar/ProviderAuthSection.tsx`:

- Add imports:

```ts
import { Settings2 } from 'lucide-react';
import type { OllamaEndpointStatus } from '@/src/types/ollama-endpoints.types';
```

- Read the new state + action:

```ts
  const ollama = useProviderAuthStore((s) => s.ollama);
  const openOllamaEndpoints = useUiStore((s) => s.openOllamaEndpoints);
```

- Change the transports loop so Ollama is NOT rendered from `TRANSPORT_ORDER` (it now has its own block). Replace `TRANSPORT_ORDER` mapping with a filtered list:

```ts
        {TRANSPORT_ORDER.filter((t) => t !== 'ollama').map((transport) => {
          /* ...unchanged row rendering for anthropic/openai/gemini... */
        })}
```

- After that mapping, add the Ollama sub-block:

```tsx
        <div className="pt-1">
          <button
            type="button"
            aria-label="Manage Ollama endpoints"
            onClick={openOllamaEndpoints}
            className="flex items-center gap-1.5 w-full text-[10px] font-mono px-1 py-1 rounded text-zinc-400 hover:text-white hover:bg-surface-3"
          >
            <Settings2 size={10} />
            <span>Ollama</span>
          </button>
          {ollama.map((ep: OllamaEndpointStatus) => (
            <div
              key={ep.id}
              data-testid="ollama-status-row"
              title={ep.detail ?? ''}
              className="flex items-center gap-1.5 text-[10px] font-mono px-1 py-1 pl-3 rounded"
            >
              <span
                role="img"
                aria-label={`Ollama ${ep.label} status: ${ep.state}`}
                className={cn('w-1.5 h-1.5 rounded-full flex-shrink-0', {
                  'bg-status-ok': ep.state === 'ok',
                  'bg-status-error': ep.state === 'error',
                  'bg-zinc-500': ep.state === 'unconfigured',
                })}
              />
              <span className="flex-shrink-0 text-zinc-300">{ep.label}</span>
              {ep.fixed && <span className="text-zinc-600">/ local</span>}
              {ep.reason && <span className="text-zinc-600 truncate">/ {ep.reason}</span>}
            </div>
          ))}
        </div>
```

> `cn`, `useUiStore`, `useProviderAuthStore` are already imported in this file. Keep the three keyed transports rendering exactly as before.

- [ ] **Step 5: Run, verify pass**

Run: `npx vitest run --project frontend src/components/sidebar/ProviderAuthSection.test.tsx`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/components/sidebar/ProviderAuthSection.tsx src/components/sidebar/ProviderAuthSection.test.tsx
git commit -m "feat(ollama): per-endpoint status rows + manage button in provider panel"
```

---

## Task 10: i18n strings + full verification

**Files:**
- Modify: `src/i18n/en.ts` (and any sibling locale files in `src/i18n/`)
- Verify: full suite + manual smoke test

- [ ] **Step 1: Locate i18n usage and add strings if used**

Check whether the new components hard-code English or should use `t(...)`. The plan above hard-codes English labels to keep tasks self-contained. If the repo lints for missing i18n keys, OR the team prefers `t()`, add keys mirroring the `keyVault.*` namespace, e.g. in `src/i18n/en.ts`:

```ts
  ollamaEndpoints: {
    title: 'Ollama Endpoints',
    add: 'Add endpoint',
    labelPlaceholder: 'label (e.g. workstation)',
    urlPlaceholder: 'http://host:11434',
    tokenPlaceholder: 'Bearer token (leave empty for no auth)',
    fixed: 'fixed',
    manage: 'Ollama',
  },
```

…and replace the literals in `OllamaEndpointsModal.tsx` / `ProviderAuthSection.tsx` with `t('ollamaEndpoints.x')`. Add the same keys to every other locale file present in `src/i18n/`. If the project has no lint enforcing this and uses literals elsewhere, this step is optional — confirm by grepping `src/i18n/` for the structure first.

- [ ] **Step 2: Run the full test suite**

Run: `npm run test:run`
Expected: PASS (all backend + frontend projects).

- [ ] **Step 3: Type-check + coverage on the touched domains**

Run: `npm run lint`
Expected: PASS.

Run: `npm run test:coverage`
Expected: PASS — thresholds (80%) hold for `server/domain/**`, `src/stores/**`, `src/lib/**`.

- [ ] **Step 4: Manual smoke test (Fake provider not needed; uses real Ollama discovery)**

Run: `npm run dev`
Then:
1. Open the provider panel (bottom-left). Confirm an "Ollama" sub-block with a "local" row.
2. Click "Ollama" → modal opens. Add an endpoint (label `test`, URL pointing to a reachable Ollama, optional token). Confirm it appears, the registry refreshes, and its models show in the TopBar provider selector as `Ollama (test) / <model>`.
3. Add an endpoint with a bad URL → inline error, no row added.
4. Delete the endpoint → row disappears; its models leave the selector.
5. Confirm the local endpoint has no edit/delete controls.

- [ ] **Step 5: Final commit**

```bash
git add -A
git commit -m "feat(ollama): i18n strings + final wiring for multi-endpoint Ollama"
```

---

## Notes for the implementer

- **Backward compatibility is load-bearing:** the local endpoint MUST keep the `ollama:<model>` provider name. Do not "tidy" it to `ollama:local:<model>` — existing saved sessions reference the bare form.
- **Token is never returned in plaintext** over HTTP — there is intentionally no `reveal` route for endpoint tokens (unlike API keys). `tokenMasked` (first3…last4) is the only exposed form.
- **The `id="local"` value is reserved.** Mutations targeting it return 400. The label `"local"` is also taken (UNIQUE), so a user cannot shadow it.
- **`registry.refresh()` is synchronous-ish but does network I/O** (discovery per endpoint). A dead remote just yields `[]` models — it never blocks the others (each `discoverOllama` has its own try/catch; probing uses `fetchWithTimeout`).
- If `npm run lint` flags `displayNameFor`'s now-unused `'ollama'` branch as dead, leave it — it is the function's fallthrough `return`, not an unused binding.
