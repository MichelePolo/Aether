# Anthropic Dynamic Model Discovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Anthropic's hardcoded model list with a live `GET /v1/models` discovery (apikey auth), keep the hardcoded list only as the OAuth source, and make a failed discovery visible in the model picker and the Settings auth status.

**Architecture:** The `ProviderRegistry` is the single source of truth for the model list; it calls a new `discoverAnthropic()` for apikey auth and records a `RegistryIssue` when discovery yields nothing. `registry.list()` (usable models) stays unchanged for dispatch; a new `registry.issues()` carries failures to the UI via `/providers`. `AuthStatusService.probeAnthropic` is aligned to validate the key against the same endpoint so Settings stays coherent.

**Tech Stack:** TypeScript, Express, better-sqlite3, Zod, Vitest (backend `node` + frontend `jsdom` projects), React 19 + Zustand, Tailwind v4, lucide-react.

**Spec:** `docs/superpowers/specs/2026-05-31-anthropic-dynamic-discovery-design.md`

**Before starting:** create a feature branch off `main`:
```bash
git checkout -b feat/anthropic-dynamic-discovery
```

---

## File Structure

- `server/domain/providers/discovery.ts` — add `discoverAnthropic()` + shared `ANTHROPIC_MODELS_URL` / `ANTHROPIC_VERSION` constants. *(Task 1)*
- `server/domain/providers/discovery.test.ts` — **exists** (tests `discoverOllama`); append `discoverAnthropic` tests. *(Task 1)*
- `server/domain/providers/registry.ts` — `RegistryIssue` type, `issues` field + getter, dynamic apikey branch / hardcoded oauth branch. *(Task 2)*
- `server/domain/providers/registry.test.ts` — update apikey test, add failure + issues tests. *(Task 2)*
- `server/domain/dispatch/providers/anthropic.provider.ts` — widen `model` to `string`. *(Task 3)*
- `server/index.ts` — drop the `as '...'` cast; wire `getAnthropicKey`. *(Task 3, Task 5)*
- `server/routes/providers.routes.ts` — return `issues` from `GET /` and `POST /refresh`. *(Task 4)*
- `server/routes/providers.routes.test.ts` — update expectations. *(Task 4)*
- `server/domain/providers/auth-status.ts` — `getAnthropicKey` dep + real apikey probe. *(Task 5)*
- `server/domain/providers/auth-status.test.ts` — add dep to all constructions, update mixed test. *(Task 5)*
- `src/types/provider.types.ts` — `RegistryIssue` type. *(Task 6)*
- `src/lib/api/providers.api.ts` — `list()`/`refresh()` return `{ providers, issues }`. *(Task 6)*
- `src/lib/api/providers.api.test.ts` — update expectations. *(Task 6)*
- `src/stores/providers.store.ts` — hold `issues`. *(Task 7)*
- `src/stores/providers.store.test.ts` — update mocks, add issues test. *(Task 7)*
- `src/components/chat/ComposerModelPill.tsx` — render disabled issue rows. *(Task 8)*
- `src/components/chat/ComposerModelPill.test.tsx` — add issue-row test. *(Task 8)*

---

## Task 1: `discoverAnthropic` + shared constants

**Files:**
- Modify: `server/domain/providers/discovery.ts`
- Test: `server/domain/providers/discovery.test.ts` (append — file already exists)

- [ ] **Step 1: Write the failing test**

`server/domain/providers/discovery.test.ts` already exists and tests `discoverOllama` (it imports `{ describe, it, expect, vi, afterEach }` and has an `afterEach(() => vi.restoreAllMocks())`). Update its import from `./discovery`:

```ts
import { discoverOllama, discoverAnthropic, ANTHROPIC_MODELS_URL } from './discovery';
```

Then append this self-contained describe block to the end of the file (it stubs the global `fetch` and unstubs it after each test):

```ts
describe('discoverAnthropic', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function stubFetch(impl: typeof fetch): void {
    vi.stubGlobal('fetch', vi.fn(impl) as unknown as typeof fetch);
  }

  it('returns ids sorted newest-first on success', async () => {
    stubFetch(async () =>
      new Response(
        JSON.stringify({
          data: [
            { id: 'claude-old', created_at: '2024-01-01T00:00:00Z' },
            { id: 'claude-new', created_at: '2026-05-01T00:00:00Z' },
            { id: 'claude-mid', created_at: '2025-03-01T00:00:00Z' },
          ],
        }),
        { status: 200 },
      ),
    );
    const out = await discoverAnthropic('sk-ant');
    expect(out).toEqual({ models: ['claude-new', 'claude-mid', 'claude-old'], error: null });
  });

  it('sends auth headers to the models endpoint', async () => {
    const spy = vi.fn(async () => new Response(JSON.stringify({ data: [] }), { status: 200 }));
    stubFetch(spy as unknown as typeof fetch);
    await discoverAnthropic('sk-secret');
    const [url, init] = spy.mock.calls[0];
    expect(String(url)).toContain(ANTHROPIC_MODELS_URL);
    expect((init as RequestInit).headers).toMatchObject({
      'x-api-key': 'sk-secret',
      'anthropic-version': '2023-06-01',
    });
  });

  it('returns the status code as error on non-2xx', async () => {
    stubFetch(async () => new Response(null, { status: 401 }));
    expect(await discoverAnthropic('sk-ant')).toEqual({ models: [], error: '401' });
  });

  it('returns a parse error on a malformed body', async () => {
    stubFetch(async () => new Response(JSON.stringify({ nope: true }), { status: 200 }));
    expect(await discoverAnthropic('sk-ant')).toEqual({ models: [], error: 'parse' });
  });

  it('returns an error reason when fetch throws', async () => {
    stubFetch(async () => {
      throw new Error('ENOTFOUND api.anthropic.com');
    });
    expect(await discoverAnthropic('sk-ant')).toEqual({ models: [], error: 'ENOTFOUND' });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run server/domain/providers/discovery.test.ts`
Expected: FAIL — `discoverAnthropic` / `ANTHROPIC_MODELS_URL` not exported.

- [ ] **Step 3: Write minimal implementation**

In `server/domain/providers/discovery.ts`, the file already begins with `import { z } from 'zod';`. Add the following (place the constants/types near the top after the existing `TagsResponse`, and the function below the existing `discoverOllama`):

```ts
export const ANTHROPIC_MODELS_URL = 'https://api.anthropic.com/v1/models';
export const ANTHROPIC_VERSION = '2023-06-01';

const AnthropicModelsResponse = z.object({
  data: z.array(z.object({ id: z.string(), created_at: z.string() })),
});

export interface AnthropicDiscovery {
  models: string[];
  error: string | null;
}

export async function discoverAnthropic(apiKey: string): Promise<AnthropicDiscovery> {
  try {
    const res = await fetch(`${ANTHROPIC_MODELS_URL}?limit=1000`, {
      headers: { 'x-api-key': apiKey, 'anthropic-version': ANTHROPIC_VERSION },
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return { models: [], error: String(res.status) };
    const body = await res.json();
    const parsed = AnthropicModelsResponse.safeParse(body);
    if (!parsed.success) return { models: [], error: 'parse' };
    const models = [...parsed.data.data]
      .sort((a, b) => b.created_at.localeCompare(a.created_at))
      .map((m) => m.id);
    return { models, error: null };
  } catch (err) {
    return { models: [], error: anthropicErrorReason(err) };
  }
}

function anthropicErrorReason(err: unknown): string {
  const name = (err as { name?: string })?.name;
  if (name === 'TimeoutError' || name === 'AbortError') return 'timeout';
  const msg = err instanceof Error ? err.message : String(err);
  const m = msg.match(/(ECONNREFUSED|ENOTFOUND|ETIMEDOUT|EAI_AGAIN)/);
  return m?.[1] ?? 'error';
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run server/domain/providers/discovery.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add server/domain/providers/discovery.ts server/domain/providers/discovery.test.ts
git commit -m "feat(providers): add discoverAnthropic /v1/models discovery

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: Registry — dynamic apikey branch + issues

**Files:**
- Modify: `server/domain/providers/registry.ts`
- Test: `server/domain/providers/registry.test.ts:40-46` (replace), add new tests

- [ ] **Step 1: Write the failing tests**

`server/domain/providers/registry.test.ts` already imports `vi`/`beforeEach`/`afterEach` and has a top-level `beforeEach` that stubs the global `fetch` to `{ ok: false, status: 503 }` (with an `afterEach` calling `vi.unstubAllGlobals()`). Replace the existing apikey test — the block titled `registers all three anthropic entries when probe returns 'apikey'` (around lines 92-96) — with the two tests below; each installs its own `fetch` stub that overrides the `beforeEach` default:

```ts
  it('registers anthropic entries from dynamic discovery when apikey', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(
          JSON.stringify({ data: [{ id: 'claude-opus-4-8', created_at: '2026-05-01T00:00:00Z' }] }),
          { status: 200 },
        ),
      ) as unknown as typeof fetch,
    );
    const reg = new ProviderRegistry(
      baseDeps({
        detectAnthropicAuth: async () => 'apikey',
        resolveKey: (t) => (t === 'anthropic' ? 'sk-ant' : undefined),
      }),
    );
    await reg.refresh();
    const d = reg.describe('anthropic:claude-opus-4-8');
    expect(d).not.toBeNull();
    expect(d?.displayName).toContain('claude-opus-4-8');
    expect(reg.issues()).toHaveLength(0);
    vi.unstubAllGlobals();
  });

  it('records an issue and registers no anthropic entries when apikey discovery fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(null, { status: 401 })) as unknown as typeof fetch,
    );
    const reg = new ProviderRegistry(
      baseDeps({
        detectAnthropicAuth: async () => 'apikey',
        resolveKey: (t) => (t === 'anthropic' ? 'sk-ant' : undefined),
      }),
    );
    await reg.refresh();
    expect(reg.get('anthropic:claude-opus-4-8')).toBeNull();
    expect(reg.issues()).toEqual([{ transport: 'anthropic', reason: '401' }]);
    vi.unstubAllGlobals();
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run server/domain/providers/registry.test.ts`
Expected: FAIL — `reg.issues` is not a function / apikey path returns hardcoded models without calling fetch.

- [ ] **Step 3: Write the implementation**

In `server/domain/providers/registry.ts`:

(a) Extend the discovery import (currently line 2) to include `discoverAnthropic`:

```ts
import { discoverOllama, geminiHardcodedModels, anthropicHardcodedModels, openAIHardcodedModels, discoverAnthropic } from './discovery';
```

(b) Add the issue type after the `ProviderDescriptor` interface (around line 12):

```ts
export interface RegistryIssue {
  transport: ProviderTransport;
  reason: string;
}
```

(c) Add a backing field next to `entries` (currently line 35):

```ts
  private issuesList: RegistryIssue[] = [];
```

(d) At the top of `refresh()`, alongside `const next = ...` (line 40), add:

```ts
    const nextIssues: RegistryIssue[] = [];
```

(e) Replace the entire Anthropic block (currently lines 74-90, the `const auth = ...` through its closing brace) with:

```ts
    // Anthropic
    const auth = await this.deps.detectAnthropicAuth();
    if (auth === 'apikey') {
      const key = this.deps.resolveKey('anthropic');
      const { models, error } = key
        ? await discoverAnthropic(key)
        : { models: [] as string[], error: 'no api key' };
      if (models.length > 0) {
        for (const model of models) {
          const provider = this.deps.anthropicBuilder(model);
          next.set(`anthropic:${model}`, {
            provider,
            descriptor: {
              name: `anthropic:${model}`,
              transport: 'anthropic',
              model,
              capabilities: provider.capabilities,
              displayName: displayNameFor('anthropic', model),
            },
          });
        }
      } else {
        nextIssues.push({ transport: 'anthropic', reason: error ?? 'no models' });
      }
    } else if (auth === 'oauth') {
      for (const model of anthropicHardcodedModels()) {
        const provider = this.deps.anthropicBuilder(model);
        next.set(`anthropic:${model}`, {
          provider,
          descriptor: {
            name: `anthropic:${model}`,
            transport: 'anthropic',
            model,
            capabilities: provider.capabilities,
            displayName: displayNameFor('anthropic', model),
          },
        });
      }
    }
```

(f) At the end of `refresh()`, where it currently does `this.entries = next;` (line 132), add the issues assignment right after:

```ts
    this.entries = next;
    this.issuesList = nextIssues;
```

(g) Add the getter next to `list()` (after the `list()` method, around line 141):

```ts
  issues(): RegistryIssue[] {
    return [...this.issuesList];
  }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run server/domain/providers/registry.test.ts`
Expected: PASS. The existing `oauth` test (registers `claude-opus-4-8` / `claude-sonnet-4-6` / `claude-haiku-4-5`) still passes because the oauth branch uses `anthropicHardcodedModels()`.

- [ ] **Step 5: Commit**

```bash
git add server/domain/providers/registry.ts server/domain/providers/registry.test.ts
git commit -m "feat(providers): registry uses dynamic anthropic discovery + issues

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Widen the Anthropic provider model type

**Files:**
- Modify: `server/domain/dispatch/providers/anthropic.provider.ts:24`
- Modify: `server/index.ts:118-121`

- [ ] **Step 1: Widen the constructor option type**

In `server/domain/dispatch/providers/anthropic.provider.ts`, change line 24 from:

```ts
  model: 'claude-opus-4-8' | 'claude-opus-4-7' | 'claude-sonnet-4-6' | 'claude-haiku-4-5';
```

to:

```ts
  model: string;
```

- [ ] **Step 2: Drop the cast at the wiring site**

In `server/index.ts`, replace the `anthropicBuilder` (currently lines 118-121):

```ts
    anthropicBuilder: (model) =>
      new AnthropicProvider({
        model: model as 'claude-opus-4-8' | 'claude-opus-4-7' | 'claude-sonnet-4-6' | 'claude-haiku-4-5',
      }),
```

with:

```ts
    anthropicBuilder: (model) => new AnthropicProvider({ model }),
```

- [ ] **Step 3: Type-check**

Run: `npm run lint`
Expected: PASS (no type errors).

- [ ] **Step 4: Commit**

```bash
git add server/domain/dispatch/providers/anthropic.provider.ts server/index.ts
git commit -m "refactor(providers): widen AnthropicProvider model to string

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: Routes return `issues`

**Files:**
- Modify: `server/routes/providers.routes.ts:71-84`
- Test: `server/routes/providers.routes.test.ts:15-28`

- [ ] **Step 1: Add the failing test**

The test file's `makeApp()` builds a **real** `ProviderRegistry` with `detectAnthropicAuth: async () => 'none'`, so `issues()` returns `[]`. The existing `GET /` and `POST /refresh` tests assert only on `res.body.providers`, so they keep passing once the route adds `issues`. Add one new test inside the `describe('providers routes', ...)` block (right after the `POST /api/providers/refresh re-runs discovery` test) to lock in the new field:

```ts
  it('GET /api/providers includes an issues array', async () => {
    const res = await request(app).get('/api/providers');
    expect(res.body.issues).toEqual([]);
  });
```

- [ ] **Step 2: Run tests to verify the new test fails**

Run: `npx vitest run server/routes/providers.routes.test.ts`
Expected: FAIL on the new test — `res.body.issues` is `undefined`.

- [ ] **Step 3: Update the routes**

In `server/routes/providers.routes.ts`, change the `GET /` handler (lines 71-76) body to:

```ts
  router.get(
    '/',
    asyncHandler(async (_req, res) => {
      res.json({ providers: registry.list(), issues: registry.issues() });
    }),
  );
```

and the `POST /refresh` handler (lines 78-84) body to:

```ts
  router.post(
    '/refresh',
    asyncHandler(async (_req, res) => {
      await registry.refresh();
      res.json({ providers: registry.list(), issues: registry.issues() });
    }),
  );
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run server/routes/providers.routes.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/routes/providers.routes.ts server/routes/providers.routes.test.ts
git commit -m "feat(providers): expose registry issues via /providers routes

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: Align `AuthStatusService.probeAnthropic`

**Files:**
- Modify: `server/domain/providers/auth-status.ts`
- Modify: `server/index.ts:144-149`
- Test: `server/domain/providers/auth-status.test.ts`

- [ ] **Step 1: Update/add the failing tests**

In `server/domain/providers/auth-status.test.ts`:

(a) Add `getAnthropicKey` to the `makeService` defaults (the object starting at line 6). After the `detectAnthropicAuth` line add:

```ts
    getAnthropicKey: () => undefined,
```

(b) In the two inline `new AuthStatusService({ ... })` constructions (around lines 127 and 141), add `getAnthropicKey: () => undefined,` after their `detectAnthropicAuth` line.

(c) Update the mixed test's `fetchMock` (lines 48-53) so the anthropic endpoint returns 200, and pass an anthropic key. Replace the `fetchMock` and `makeService` call (lines 48-59) with:

```ts
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('api.anthropic.com')) return new Response(null, { status: 200 });
      if (url.includes('generativelanguage')) return new Response(null, { status: 401 });
      if (url.endsWith('/api/tags')) throw new Error('ECONNREFUSED');
      return new Response(null, { status: 599 });
    });
    const svc = makeService({
      detectAnthropicAuth: async () => 'apikey',
      getAnthropicKey: () => 'ak-x',
      getOpenAIKey: () => undefined,
      getGeminiKey: () => 'gk-x',
      fetch: fetchMock as typeof fetch,
    });
```

(d) Add a dedicated failure test at the end of the file, before the final closing — append this new `describe`:

```ts
describe('AuthStatusService.probeAnthropic — apikey', () => {
  it('reports error with the status code when /v1/models rejects the key', async () => {
    const svc = makeService({
      detectAnthropicAuth: async () => 'apikey',
      getAnthropicKey: () => 'ak-bad',
      fetch: vi.fn(async () => new Response(null, { status: 401 })) as unknown as typeof fetch,
    });
    const report = await svc.probe(['anthropic']);
    expect(report.statuses[0]).toMatchObject({ transport: 'anthropic', state: 'error', reason: '401' });
  });

  it('reports ok when /v1/models accepts the key', async () => {
    const svc = makeService({
      detectAnthropicAuth: async () => 'apikey',
      getAnthropicKey: () => 'ak-good',
      fetch: vi.fn(async () => new Response(null, { status: 200 })) as unknown as typeof fetch,
    });
    const report = await svc.probe(['anthropic']);
    expect(report.statuses[0]).toMatchObject({ transport: 'anthropic', state: 'ok' });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run server/domain/providers/auth-status.test.ts`
Expected: FAIL — `getAnthropicKey` not part of deps type / apikey path does not fetch.

- [ ] **Step 3: Update the service**

In `server/domain/providers/auth-status.ts`:

(a) Add the constants import at the top (after the existing type imports, lines 1-7):

```ts
import { ANTHROPIC_MODELS_URL, ANTHROPIC_VERSION } from './discovery';
```

(b) Add the dep to `AuthStatusServiceDeps` (after `detectAnthropicAuth`, line 12):

```ts
  getAnthropicKey: () => string | undefined;
```

(c) Replace `probeAnthropic` (lines 53-58) with:

```ts
  private async probeAnthropic(): Promise<TransportStatus> {
    const result = await this.deps.detectAnthropicAuth();
    if (result === 'oauth') return { transport: 'anthropic', state: 'ok', reason: 'oauth' };
    if (result === 'apikey') {
      const apiKey = this.deps.getAnthropicKey();
      if (!apiKey) return { transport: 'anthropic', state: 'unconfigured', reason: 'no api key' };
      const res = await this.fetchWithTimeout(`${ANTHROPIC_MODELS_URL}?limit=1`, {
        headers: { 'x-api-key': apiKey, 'anthropic-version': ANTHROPIC_VERSION },
      });
      if (res.ok) return { transport: 'anthropic', state: 'ok', reason: 'api key set' };
      return {
        transport: 'anthropic',
        state: 'error',
        reason: String(res.status),
        detail: res.statusText || `HTTP ${res.status}`,
      };
    }
    return { transport: 'anthropic', state: 'unconfigured', reason: 'no api key' };
  }
```

- [ ] **Step 4: Wire the new dep**

In `server/index.ts`, update the `AuthStatusService` construction (lines 144-149) to add `getAnthropicKey`:

```ts
  const authStatusService = new AuthStatusService({
    detectAnthropicAuth,
    getAnthropicKey: () => resolver.get('anthropic'),
    getOpenAIKey: () => resolver.get('openai'),
    getGeminiKey: () => resolver.get('gemini'),
    listOllamaEndpoints,
  });
```

- [ ] **Step 5: Run tests + type-check to verify they pass**

Run: `npx vitest run server/domain/providers/auth-status.test.ts`
Expected: PASS.
Run: `npm run lint`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add server/domain/providers/auth-status.ts server/domain/providers/auth-status.test.ts server/index.ts
git commit -m "feat(providers): probe anthropic /v1/models for auth status

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: Frontend types + API client

**Files:**
- Modify: `src/types/provider.types.ts`
- Modify: `src/lib/api/providers.api.ts:22-31`
- Test: `src/lib/api/providers.api.test.ts:24-41`

- [ ] **Step 1: Update the failing tests**

The test file uses MSW (`server.use(http.get(...))`). Replace the `list returns descriptors` test (lines 9-25) and the `refresh re-fetches` test (lines 27-35) with:

```ts
  it('list returns providers and issues', async () => {
    server.use(
      http.get('http://localhost/api/providers', () =>
        HttpResponse.json({
          providers: [{
            name: 'fake:default', transport: 'fake', model: 'default',
            capabilities: { thinking: true, toolCalling: true }, displayName: 'Fake (default)',
          }],
          issues: [{ transport: 'anthropic', reason: '401' }],
        }),
      ),
    );
    const out = await providersApi.list();
    expect(out.providers[0].name).toBe('fake:default');
    expect(out.issues).toEqual([{ transport: 'anthropic', reason: '401' }]);
  });

  it('refresh re-fetches and returns providers + issues', async () => {
    server.use(
      http.post('http://localhost/api/providers/refresh', () =>
        HttpResponse.json({ providers: [], issues: [] }),
      ),
    );
    const r = await providersApi.refresh();
    expect(r).toEqual({ providers: [], issues: [] });
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run --project frontend src/lib/api/providers.api.test.ts`
Expected: FAIL — `out.providers` undefined (list currently returns an array).

- [ ] **Step 3: Add the types**

`src/types/provider.types.ts` re-exports the backend registry types (it currently re-exports `ProviderTransport` and `ProviderDescriptor`). Update it to also re-export `RegistryIssue` (added to the registry in Task 2) and define the response wrapper. The full file becomes:

```ts
export type {
  ProviderTransport,
  ProviderDescriptor,
  RegistryIssue,
} from '@/server/domain/providers/registry';

export type { ProviderCapabilities } from '@/server/domain/dispatch/providers/provider.types';

import type { ProviderDescriptor, RegistryIssue } from '@/server/domain/providers/registry';

export interface ProvidersResponse {
  providers: ProviderDescriptor[];
  issues: RegistryIssue[];
}
```

- [ ] **Step 4: Update the API client**

In `src/lib/api/providers.api.ts`, update the import on line 1:

```ts
import type { ProvidersResponse } from '@/src/types/provider.types';
```

(Keep the other imports.) Then replace `list` and `refresh` (lines 23-31) with:

```ts
  list: (): Promise<ProvidersResponse> =>
    fetch('/api/providers').then(jsonRes<ProvidersResponse>),

  refresh: (): Promise<ProvidersResponse> =>
    fetch('/api/providers/refresh', { method: 'POST' }).then(jsonRes<ProvidersResponse>),
```

Note: the previous `ProviderDescriptor` import is still used elsewhere in the file? It is not — remove `ProviderDescriptor` from the import if `tsc` flags it as unused (the file's `noUnusedLocals` is enforced). After editing, the import line should be exactly the `ProvidersResponse` import above plus the unchanged `AuthStatusReport`/`ProviderTransport`, key-vault, and ollama imports.

- [ ] **Step 5: Run tests + type-check to verify they pass**

Run: `npx vitest run --project frontend src/lib/api/providers.api.test.ts`
Expected: PASS.
Run: `npm run lint`
Expected: PASS (will fail here if an unused import remains — fix per the note above).

- [ ] **Step 6: Commit**

```bash
git add src/types/provider.types.ts src/lib/api/providers.api.ts src/lib/api/providers.api.test.ts
git commit -m "feat(providers): api client returns providers + issues

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 7: Providers store holds `issues`

**Files:**
- Modify: `src/stores/providers.store.ts`
- Test: `src/stores/providers.store.test.ts`

- [ ] **Step 1: Update the failing test**

The store tests use MSW and already return `{ providers: [...] }` from the mocked `GET /api/providers`; after the store change they keep passing (a missing `issues` falls back to `[]`). To lock in the new behaviour, edit the first test (`init fetches the list and defaults to the server default...`, lines 12-29): add an `issues` array to the mocked response and assert the store stored it. Change the mocked `HttpResponse.json(...)` to:

```ts
        HttpResponse.json({
          providers: [
            { name: 'fake:default', transport: 'fake', model: 'default',
              capabilities: { thinking: true, toolCalling: true, vision: false }, displayName: 'Fake' },
          ],
          issues: [{ transport: 'anthropic', reason: '401' }],
        }),
```

and append this assertion at the end of that test:

```ts
    expect(useProvidersStore.getState().issues).toEqual([{ transport: 'anthropic', reason: '401' }]);
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run --project frontend src/stores/providers.store.test.ts`
Expected: FAIL — `issues` undefined and/or `list` consumed as an array.

- [ ] **Step 3: Update the store**

In `src/stores/providers.store.ts`:

(a) Extend the import on line 3:

```ts
import type { ProviderDescriptor, ProviderCapabilities, RegistryIssue } from '@/src/types/provider.types';
```

(b) Add `issues` to the `ProvidersState` interface (after `list`, line 8):

```ts
  issues: RegistryIssue[];
```

(c) Add `issues` to `initial` (after `list`, line 21):

```ts
  issues: [] as RegistryIssue[],
```

(d) Replace the `init` body (lines 51-68) with:

```ts
  init: async () => {
    try {
      const [listRes, serverDefault] = await Promise.all([
        providersApi.list(),
        providersApi.defaultName(),
      ]);
      const list = listRes.providers;
      const issues = listRes.issues ?? [];
      const stored = readStoredDefault();
      const storedIsAvailable = stored && list.some((p) => p.name === stored);
      const defaultProvider = storedIsAvailable
        ? stored
        : serverDefault && list.some((p) => p.name === serverDefault)
          ? serverDefault
          : list[0]?.name ?? null;
      set({ list, issues, defaultProvider, hydrated: true, error: null });
    } catch (e) {
      set({ hydrated: true, error: errMsg(e) });
    }
  },
```

(e) Replace the `refresh` body (lines 70-82) with:

```ts
  refresh: async () => {
    try {
      const res = await providersApi.refresh();
      set({ list: res.providers, issues: res.issues ?? [], error: null });
      const current = get().defaultProvider;
      if (current && !res.providers.some((p) => p.name === current)) {
        const serverDefault = await providersApi.defaultName();
        set({ defaultProvider: serverDefault });
      }
    } catch (e) {
      set({ error: errMsg(e) });
    }
  },
```

- [ ] **Step 4: Run tests + type-check to verify they pass**

Run: `npx vitest run --project frontend src/stores/providers.store.test.ts`
Expected: PASS.
Run: `npm run lint`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/stores/providers.store.ts src/stores/providers.store.test.ts
git commit -m "feat(providers): providers store tracks discovery issues

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 8: Disabled issue row in the model picker

**Files:**
- Modify: `src/components/chat/ComposerModelPill.tsx`
- Test: `src/components/chat/ComposerModelPill.test.tsx`

- [ ] **Step 1: Write the failing test**

The test file resets state via `_reset()` in `beforeEach` and seeds with a `seed()` helper whose `PROVIDERS` already include an anthropic entry — not what we want here (the issue row only renders when the transport has **no** entry). Add a self-contained test inside the `describe('ComposerModelPill', ...)` block that seeds a list without anthropic plus an anthropic issue (uses the already-imported `userEvent` and `screen`):

```ts
  it('shows a disabled, non-selectable row for a discovery issue', async () => {
    useProvidersStore.setState({
      list: [
        { name: 'fake:default', transport: 'fake', model: 'default',
          capabilities: { thinking: false, toolCalling: false, vision: false }, displayName: 'Fake / default' },
      ] as never,
      defaultProvider: 'fake:default',
      hydrated: true,
      error: null,
      issues: [{ transport: 'anthropic', reason: '401' }],
    } as never);
    useSessionsStore.setState({ activeSessionId: null, sessions: [] } as never);
    render(<ComposerModelPill />);
    await userEvent.click(screen.getByRole('button', { name: /select model/i }));
    expect(
      screen.getByText(/Anthropic — impossibile recuperare i modelli \(401\)/),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('menuitemradio', { name: /impossibile recuperare/ }),
    ).toBeNull();
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run --project frontend src/components/chat/ComposerModelPill.test.tsx`
Expected: FAIL — issue text not rendered.

- [ ] **Step 3: Implement the issue rows**

In `src/components/chat/ComposerModelPill.tsx`:

(a) Add `AlertTriangle` to the lucide import (line 2):

```ts
import { ChevronDown, Check, RefreshCw, AlertTriangle } from 'lucide-react';
```

(b) Read issues from the store — after the `refresh` selector (line 21) add:

```ts
  const issues = useProvidersStore((s) => s.issues);
```

(c) Add this label helper above the `return` (after the `select` function, around line 36):

```ts
  const issueLabel = (transport: string, reason: string): string => {
    const name = transport.charAt(0).toUpperCase() + transport.slice(1);
    return `${name} — impossibile recuperare i modelli (${reason})`;
  };
```

(d) Render the issue rows right after the `list.map(...)` block closes (after line 80, before the `<div className="border-t ...">` separator on line 81):

```tsx
          {issues
            .filter((iss) => !list.some((p) => p.transport === iss.transport))
            .map((iss) => (
              <div
                key={`issue:${iss.transport}`}
                className="w-full flex items-center gap-2 px-3 py-1.5 text-xs font-mono text-zinc-500 cursor-not-allowed"
                aria-disabled="true"
              >
                <AlertTriangle size={13} className="shrink-0 text-yellow-500" aria-hidden="true" />
                <span className="truncate">{issueLabel(iss.transport, iss.reason)}</span>
              </div>
            ))}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run --project frontend src/components/chat/ComposerModelPill.test.tsx`
Expected: PASS (existing tests + the new one).

- [ ] **Step 5: Commit**

```bash
git add src/components/chat/ComposerModelPill.tsx src/components/chat/ComposerModelPill.test.tsx
git commit -m "feat(providers): show discovery failure row in model picker

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 9: Full verification

**Files:** none (verification only)

- [ ] **Step 1: Type-check**

Run: `npm run lint`
Expected: PASS (no errors).

- [ ] **Step 2: Full test suite**

Run: `npm run test:run`
Expected: PASS — all backend and frontend projects green, coverage thresholds (80% on `server/domain/**`, `server/lib/**`, `src/stores/**`, `src/lib/**`) satisfied.

- [ ] **Step 3: Manual smoke (optional but recommended)**

With a real `ANTHROPIC_API_KEY` set, run `npm run dev`, open the model picker, and confirm live models appear newest-first. Temporarily set an invalid key and confirm the greyed `Anthropic — impossibile recuperare i modelli (401)` row appears and the Settings → Provider Auth Anthropic row shows an error state.

- [ ] **Step 4: Integrate**

Use the `superpowers:finishing-a-development-branch` skill to open a PR or merge `feat/anthropic-dynamic-discovery`.

---

## Notes / Open Questions (carried from spec)

- **Alias vs. snapshot IDs.** If `/v1/models` returns dated IDs rather than the short alias `claude-opus-4-8`, the configured default `anthropic:claude-opus-4-8` won't match a registry entry and `defaultName()` falls back to its priority order. No code handles aliasing in this plan.
- The picker row text is a literal Italian string matching the component's existing literal strings (e.g. "No models available"); it is not routed through `src/i18n/`.
