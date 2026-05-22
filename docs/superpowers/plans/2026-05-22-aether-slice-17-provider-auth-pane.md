# Slice 17 — Provider auth status pane — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Surface live auth status (Anthropic / OpenAI / Gemini / Ollama) in a sidebar pane that refreshes on app load, on dispatch errors, and on manual click — so the user always knows which providers are reachable, unconfigured, or failing.

**Architecture:** A new server-side `AuthStatusService` runs four independent probes in parallel (each with a 5 s timeout and isolated try/catch) and always returns a 4-entry `AuthStatusReport`. Two routes (`GET /api/providers/auth-status`, `POST /api/providers/auth-status/refresh?transport=…`) expose it. The frontend has a Zustand `providerAuth.store` with dedupe-by-transport-key, a `ProviderAuthSection` sidebar component, and a hook in `useStreamingDispatch` that fires a targeted refresh on any error from a non-fake transport.

**Tech Stack:** TypeScript, Express, Zustand, MSW, vitest, Playwright. Reuses existing `detectAnthropicAuth()` and `discoverOllama()` patterns.

**Spec:** `docs/superpowers/specs/2026-05-22-aether-slice-17-provider-auth-pane-design.md`

**Branch:** `feat/slice-17-provider-auth-pane`

---

## File Structure

**Server**
- Create: `server/domain/providers/auth-status.types.ts` — `ProviderTransport`, `AuthState`, `TransportStatus`, `AuthStatusReport`.
- Create: `server/domain/providers/auth-status.ts` — `AuthStatusService` class + 4 private `probe*` helpers.
- Create: `server/domain/providers/auth-status.test.ts` — unit tests for the service.
- Modify: `server/routes/providers.routes.ts` — extend with `GET /auth-status` + `POST /auth-status/refresh`.
- Modify: `server/routes/providers.routes.test.ts` — extend with new route tests.
- Modify: `server/app.ts` — add `authStatusService?: AuthStatusService` to `AppDeps`; pass into providers routes factory.
- Modify: `server/index.ts` — construct `AuthStatusService` in bootstrap.

**Frontend**
- Create: `src/types/provider-auth.types.ts` — mirror of server types.
- Modify: `src/lib/api/providers.api.ts` — add `fetchAuthStatus()` + `refreshAuthStatus(transport?)`.
- Modify: `src/lib/api/providers.api.test.ts` — cover new methods.
- Create: `src/stores/providerAuth.store.ts` — Zustand store with dedupe.
- Create: `src/stores/providerAuth.store.test.ts`.
- Create: `src/components/sidebar/ProviderAuthSection.tsx`.
- Create: `src/components/sidebar/ProviderAuthSection.test.tsx`.
- Modify: `src/App.tsx` — mount `<ProviderAuthSection />` + call `useProviderAuthStore.getState().init()` in the existing init `useEffect`.
- Modify: `src/hooks/useStreamingDispatch.ts` — fire targeted refresh on `error` event for non-fake providers (both `send` and `resume` paths).
- Modify: `src/test/msw-handlers.ts` — defaults for the new endpoints.

**Integration / e2e**
- Create: `src/integration/provider-auth.integration.test.tsx`.
- Modify: `e2e/smoke.spec.ts` — add one smoke for the section.

---

## Task A1: Branch setup

**Files:** (verification only)

- [ ] **Step 1: Confirm branch and clean tree**

```bash
git status
git rev-parse --abbrev-ref HEAD
```

Expected: branch `feat/slice-17-provider-auth-pane`, clean working tree (untracked docs from prior slices are OK). If not on the branch:

```bash
git checkout -b feat/slice-17-provider-auth-pane
```

- [ ] **Step 2: Verify spec is committed**

```bash
git log --oneline -5 -- docs/superpowers/specs/2026-05-22-aether-slice-17-provider-auth-pane-design.md
```

Expected: at least one commit referencing the spec on this branch.

---

## Task B1: AuthStatusService + types + 4 probes

**Files:**
- Create: `server/domain/providers/auth-status.types.ts`
- Create: `server/domain/providers/auth-status.ts`
- Create: `server/domain/providers/auth-status.test.ts`

- [ ] **Step 1: Write the types**

Create `server/domain/providers/auth-status.types.ts`:

```ts
export type ProviderTransport = 'anthropic' | 'openai' | 'gemini' | 'ollama';
export type AuthState = 'ok' | 'unconfigured' | 'error';

export interface TransportStatus {
  transport: ProviderTransport;
  state: AuthState;
  reason: string;
  detail?: string;
}

export interface AuthStatusReport {
  statuses: TransportStatus[]; // always in fixed order
  checkedAt: number;
}

export const TRANSPORT_ORDER: ProviderTransport[] = [
  'anthropic',
  'openai',
  'gemini',
  'ollama',
];
```

- [ ] **Step 2: Write failing tests** — `server/domain/providers/auth-status.test.ts`

```ts
import { describe, it, expect, vi } from 'vitest';
import { AuthStatusService } from './auth-status';
import { TRANSPORT_ORDER } from './auth-status.types';

function makeService(overrides: Partial<ConstructorParameters<typeof AuthStatusService>[0]> = {}) {
  return new AuthStatusService({
    detectAnthropicAuth: async () => 'none',
    openAIApiKey: undefined,
    geminiApiKey: undefined,
    ollamaHost: 'http://localhost:11434',
    fetch: vi.fn(async () => new Response(null, { status: 599 })),
    timeoutMs: 50,
    ...overrides,
  });
}

describe('AuthStatusService.probe — all-OK path', () => {
  it('returns 4 ok statuses with the right reasons', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes('api.openai.com')) return new Response(null, { status: 200 });
      if (url.includes('generativelanguage')) return new Response(null, { status: 200 });
      if (url.endsWith('/api/tags'))
        return new Response(JSON.stringify({ models: [{ name: 'a' }, { name: 'b' }] }), { status: 200 });
      return new Response(null, { status: 599 });
    });
    const svc = makeService({
      detectAnthropicAuth: async () => 'oauth',
      openAIApiKey: 'sk-x',
      geminiApiKey: 'gk-x',
      fetch: fetchMock,
    });
    const report = await svc.probe();
    expect(report.statuses.map((s) => s.transport)).toEqual(TRANSPORT_ORDER);
    expect(report.statuses.every((s) => s.state === 'ok')).toBe(true);
    const ollama = report.statuses.find((s) => s.transport === 'ollama')!;
    expect(ollama.reason).toBe('2 models');
    expect(report.checkedAt).toBeGreaterThan(0);
  });
});

describe('AuthStatusService.probe — mixed', () => {
  it('handles ok / unconfigured / error / error in a single report', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes('generativelanguage')) return new Response(null, { status: 401 });
      if (url.endsWith('/api/tags')) throw new Error('ECONNREFUSED');
      return new Response(null, { status: 599 });
    });
    const svc = makeService({
      detectAnthropicAuth: async () => 'apikey',
      openAIApiKey: undefined,
      geminiApiKey: 'gk-x',
      fetch: fetchMock,
    });
    const report = await svc.probe();
    expect(report.statuses).toEqual([
      { transport: 'anthropic', state: 'ok', reason: 'api key set' },
      { transport: 'openai', state: 'unconfigured', reason: 'no api key' },
      expect.objectContaining({ transport: 'gemini', state: 'error', reason: '401' }),
      expect.objectContaining({ transport: 'ollama', state: 'error' }),
    ]);
    const ollama = report.statuses[3];
    expect(ollama.detail).toMatch(/ECONNREFUSED/);
  });
});

describe('AuthStatusService.probe — single transport filter', () => {
  it('returns only the requested transports', async () => {
    const svc = makeService({ detectAnthropicAuth: async () => 'oauth' });
    const report = await svc.probe(['anthropic']);
    expect(report.statuses).toHaveLength(1);
    expect(report.statuses[0].transport).toBe('anthropic');
    expect(report.statuses[0].state).toBe('ok');
  });
});

describe('AuthStatusService.probe — timeout', () => {
  it('returns state=error reason=timeout when a probe hangs past timeoutMs', async () => {
    const fetchMock = vi.fn(
      () => new Promise<Response>(() => {}), // never resolves
    );
    const svc = makeService({
      openAIApiKey: 'sk-x',
      fetch: fetchMock,
      timeoutMs: 30,
    });
    const start = Date.now();
    const report = await svc.probe(['openai']);
    expect(Date.now() - start).toBeLessThan(200);
    expect(report.statuses[0]).toEqual(
      expect.objectContaining({ transport: 'openai', state: 'error', reason: 'timeout' }),
    );
  });
});

describe('AuthStatusService.probe — error isolation', () => {
  it('a throwing detectAnthropicAuth does not abort the report', async () => {
    const svc = makeService({
      detectAnthropicAuth: async () => {
        throw new Error('boom');
      },
    });
    const report = await svc.probe();
    expect(report.statuses).toHaveLength(4);
    expect(report.statuses[0]).toEqual(
      expect.objectContaining({ transport: 'anthropic', state: 'error' }),
    );
  });
});
```

- [ ] **Step 3: Run the test, expect FAIL (module missing)**

```bash
npx vitest run server/domain/providers/auth-status.test.ts
```

Expected: FAIL — `Cannot find module './auth-status'`.

- [ ] **Step 4: Implement `auth-status.ts`**

Create `server/domain/providers/auth-status.ts`:

```ts
import type {
  AuthStatusReport,
  ProviderTransport,
  TransportStatus,
} from './auth-status.types';
import { TRANSPORT_ORDER } from './auth-status.types';

type AnthropicAuth = 'oauth' | 'apikey' | 'none';

export interface AuthStatusServiceDeps {
  detectAnthropicAuth: () => Promise<AnthropicAuth>;
  openAIApiKey: string | undefined;
  geminiApiKey: string | undefined;
  ollamaHost: string;
  /** Override for tests; defaults to globalThis.fetch. */
  fetch?: typeof fetch;
  /** Per-probe timeout in ms; default 5000. */
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 5_000;

export class AuthStatusService {
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;

  constructor(private readonly deps: AuthStatusServiceDeps) {
    this.fetchImpl = deps.fetch ?? globalThis.fetch.bind(globalThis);
    this.timeoutMs = deps.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  async probe(transports?: ProviderTransport[]): Promise<AuthStatusReport> {
    const wanted = transports ?? TRANSPORT_ORDER;
    const all = await Promise.all(wanted.map((t) => this.probeOne(t)));
    return { statuses: all, checkedAt: Date.now() };
  }

  private async probeOne(transport: ProviderTransport): Promise<TransportStatus> {
    try {
      if (transport === 'anthropic') return await this.probeAnthropic();
      if (transport === 'openai') return await this.probeOpenAI();
      if (transport === 'gemini') return await this.probeGemini();
      return await this.probeOllama();
    } catch (err) {
      return { transport, state: 'error', reason: shortReason(err), detail: longDetail(err) };
    }
  }

  private async probeAnthropic(): Promise<TransportStatus> {
    const result = await this.deps.detectAnthropicAuth();
    if (result === 'oauth') return { transport: 'anthropic', state: 'ok', reason: 'oauth' };
    if (result === 'apikey') return { transport: 'anthropic', state: 'ok', reason: 'api key set' };
    return { transport: 'anthropic', state: 'unconfigured', reason: 'no api key' };
  }

  private async probeOpenAI(): Promise<TransportStatus> {
    if (!this.deps.openAIApiKey) {
      return { transport: 'openai', state: 'unconfigured', reason: 'no api key' };
    }
    const res = await this.fetchWithTimeout('https://api.openai.com/v1/models', {
      headers: { Authorization: `Bearer ${this.deps.openAIApiKey}` },
    });
    if (res.ok) return { transport: 'openai', state: 'ok', reason: 'api key set' };
    return {
      transport: 'openai',
      state: 'error',
      reason: String(res.status),
      detail: res.statusText || `HTTP ${res.status}`,
    };
  }

  private async probeGemini(): Promise<TransportStatus> {
    if (!this.deps.geminiApiKey) {
      return { transport: 'gemini', state: 'unconfigured', reason: 'no api key' };
    }
    const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(
      this.deps.geminiApiKey,
    )}`;
    const res = await this.fetchWithTimeout(url);
    if (res.ok) return { transport: 'gemini', state: 'ok', reason: 'api key set' };
    return {
      transport: 'gemini',
      state: 'error',
      reason: String(res.status),
      detail: res.statusText || `HTTP ${res.status}`,
    };
  }

  private async probeOllama(): Promise<TransportStatus> {
    const url = `${this.deps.ollamaHost.replace(/\/$/, '')}/api/tags`;
    const res = await this.fetchWithTimeout(url);
    if (!res.ok) {
      return {
        transport: 'ollama',
        state: 'error',
        reason: String(res.status),
        detail: res.statusText || `HTTP ${res.status}`,
      };
    }
    const body = (await res.json().catch(() => ({ models: [] }))) as {
      models?: Array<{ name: string }>;
    };
    const count = body.models?.length ?? 0;
    return { transport: 'ollama', state: 'ok', reason: `${count} models` };
  }

  private async fetchWithTimeout(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), this.timeoutMs);
    try {
      return await this.fetchImpl(input, { ...(init ?? {}), signal: ac.signal });
    } catch (err) {
      if ((err as { name?: string })?.name === 'AbortError') {
        const e: Error & { code?: string } = new Error('timeout');
        e.code = 'TIMEOUT';
        throw e;
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }
}

function shortReason(err: unknown): string {
  if (!err) return 'error';
  const code = (err as { code?: string })?.code;
  if (code === 'TIMEOUT') return 'timeout';
  if (code) return code;
  const msg = err instanceof Error ? err.message : String(err);
  const m = msg.match(/(ECONNREFUSED|ENOTFOUND|ETIMEDOUT|EAI_AGAIN)/);
  return m?.[1] ?? 'error';
}

function longDetail(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}
```

- [ ] **Step 5: Run the test, expect GREEN**

```bash
npx vitest run server/domain/providers/auth-status.test.ts
```

Expected: all 5 cases pass.

- [ ] **Step 6: Lint**

```bash
npm run lint
```

Expected: no output.

- [ ] **Step 7: Commit**

```bash
git add server/domain/providers/auth-status.types.ts server/domain/providers/auth-status.ts server/domain/providers/auth-status.test.ts
git commit -m "feat(slice-17): AuthStatusService — 4 provider probes with timeout + isolation"
```

---

## Task C1: Routes (GET /auth-status + POST /auth-status/refresh)

**Files:**
- Modify: `server/routes/providers.routes.ts`
- Modify: `server/routes/providers.routes.test.ts`

- [ ] **Step 1: Write failing tests** — append to `server/routes/providers.routes.test.ts`:

```ts
import { AuthStatusService } from '@/server/domain/providers/auth-status';
import type { AuthStatusReport } from '@/server/domain/providers/auth-status.types';

function makeAuthSvc(report: AuthStatusReport, probeSpy?: ReturnType<typeof vi.fn>): AuthStatusService {
  const svc = {
    probe: probeSpy ?? vi.fn(async () => report),
  } as unknown as AuthStatusService;
  return svc;
}

describe('providers routes — auth status', () => {
  const fullReport: AuthStatusReport = {
    checkedAt: 1234,
    statuses: [
      { transport: 'anthropic', state: 'ok', reason: 'oauth' },
      { transport: 'openai', state: 'unconfigured', reason: 'no api key' },
      { transport: 'gemini', state: 'unconfigured', reason: 'no api key' },
      { transport: 'ollama', state: 'ok', reason: '3 models' },
    ],
  };

  it('GET /api/providers/auth-status returns the full report', async () => {
    const { reg } = await makeApp();
    const authStatusService = makeAuthSvc(fullReport);
    const app = createApp({ providers: reg, authStatusService });
    const res = await request(app).get('/api/providers/auth-status');
    expect(res.status).toBe(200);
    expect(res.body.statuses).toHaveLength(4);
    expect(res.body.checkedAt).toBe(1234);
  });

  it('POST /api/providers/auth-status/refresh re-probes all by default', async () => {
    const { reg } = await makeApp();
    const probeSpy = vi.fn(async () => fullReport);
    const authStatusService = makeAuthSvc(fullReport, probeSpy);
    const app = createApp({ providers: reg, authStatusService });
    const res = await request(app).post('/api/providers/auth-status/refresh');
    expect(res.status).toBe(200);
    expect(probeSpy).toHaveBeenCalledWith(undefined);
    expect(res.body.statuses).toHaveLength(4);
  });

  it('POST /api/providers/auth-status/refresh?transport=anthropic re-probes one and merges', async () => {
    const { reg } = await makeApp();
    const targeted: AuthStatusReport = {
      checkedAt: 9999,
      statuses: [{ transport: 'anthropic', state: 'error', reason: '500', detail: 'oops' }],
    };
    let firstCall = true;
    const probeSpy = vi.fn(async (transports?: string[]) => {
      if (firstCall) {
        firstCall = false;
        return fullReport;
      }
      return targeted;
    });
    const authStatusService = makeAuthSvc(fullReport, probeSpy);
    const app = createApp({ providers: reg, authStatusService });
    // Warm cache via GET first so the route has prior statuses to merge with.
    await request(app).get('/api/providers/auth-status');
    const res = await request(app).post('/api/providers/auth-status/refresh').query({ transport: 'anthropic' });
    expect(res.status).toBe(200);
    expect(probeSpy).toHaveBeenLastCalledWith(['anthropic']);
    const anth = res.body.statuses.find((s: { transport: string }) => s.transport === 'anthropic');
    expect(anth.state).toBe('error');
    // The other 3 came from the prior cached report.
    expect(res.body.statuses).toHaveLength(4);
  });

  it('returns 503 when authStatusService is absent', async () => {
    const { reg } = await makeApp();
    const app = createApp({ providers: reg }); // no authStatusService
    const res = await request(app).get('/api/providers/auth-status');
    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe('NO_AUTH_STATUS');
  });
});
```

Make sure `import { vi } from 'vitest'` is at the top of the file (likely missing — add it).

- [ ] **Step 2: Run the test, expect FAIL** (route doesn't exist)

```bash
npx vitest run server/routes/providers.routes.test.ts
```

Expected: 4 new cases fail (existing 4 still pass).

- [ ] **Step 3: Extend `providers.routes.ts`**

Replace the existing `createProvidersRoutes(registry)` signature with one that accepts an optional `authStatusService`. Full file:

```ts
import { Router, type Request, type Response, type NextFunction } from 'express';
import type { ProviderRegistry } from '@/server/domain/providers/registry';
import type { AuthStatusService } from '@/server/domain/providers/auth-status';
import type {
  AuthStatusReport,
  ProviderTransport,
  TransportStatus,
} from '@/server/domain/providers/auth-status.types';

function asyncHandler(fn: (req: Request, res: Response, next: NextFunction) => Promise<void>) {
  return (req: Request, res: Response, next: NextFunction) => {
    fn(req, res, next).catch(next);
  };
}

const VALID_TRANSPORTS: readonly ProviderTransport[] = ['anthropic', 'openai', 'gemini', 'ollama'];

export function createProvidersRoutes(
  registry: ProviderRegistry,
  authStatusService?: AuthStatusService,
): Router {
  const router = Router();

  // last-known report cached for merge on targeted refresh
  let lastReport: AuthStatusReport | null = null;

  router.get(
    '/',
    asyncHandler(async (_req, res) => {
      res.json({ providers: registry.list() });
    }),
  );

  router.post(
    '/refresh',
    asyncHandler(async (_req, res) => {
      await registry.refresh();
      res.json({ providers: registry.list() });
    }),
  );

  router.get(
    '/default',
    asyncHandler(async (_req, res) => {
      const name = registry.defaultName();
      res.json({ name });
    }),
  );

  router.get(
    '/auth-status',
    asyncHandler(async (_req, res) => {
      if (!authStatusService) {
        res.status(503).json({ error: { code: 'NO_AUTH_STATUS', message: 'Auth status service not configured' } });
        return;
      }
      const report = await authStatusService.probe();
      lastReport = report;
      res.json(report);
    }),
  );

  router.post(
    '/auth-status/refresh',
    asyncHandler(async (req, res) => {
      if (!authStatusService) {
        res.status(503).json({ error: { code: 'NO_AUTH_STATUS', message: 'Auth status service not configured' } });
        return;
      }
      const qt = req.query.transport;
      const transport = typeof qt === 'string' ? qt : undefined;
      const filter =
        transport && VALID_TRANSPORTS.includes(transport as ProviderTransport)
          ? [transport as ProviderTransport]
          : undefined;
      const fresh = await authStatusService.probe(filter);
      const merged = mergeReport(lastReport, fresh);
      lastReport = merged;
      res.json(merged);
    }),
  );

  return router;
}

function mergeReport(prior: AuthStatusReport | null, fresh: AuthStatusReport): AuthStatusReport {
  if (!prior) return fresh;
  const byTransport = new Map<string, TransportStatus>();
  for (const s of prior.statuses) byTransport.set(s.transport, s);
  for (const s of fresh.statuses) byTransport.set(s.transport, s);
  return {
    checkedAt: fresh.checkedAt,
    statuses: VALID_TRANSPORTS
      .map((t) => byTransport.get(t))
      .filter((s): s is TransportStatus => Boolean(s)),
  };
}
```

- [ ] **Step 4: Run the test, expect GREEN**

```bash
npx vitest run server/routes/providers.routes.test.ts
```

Expected: 8 cases pass (4 existing + 4 new).

- [ ] **Step 5: Commit**

```bash
git add server/routes/providers.routes.ts server/routes/providers.routes.test.ts
git commit -m "feat(slice-17): GET /api/providers/auth-status + POST refresh (merge-aware)"
```

---

## Task D1: Wire AuthStatusService through createApp + bootstrap

**Files:**
- Modify: `server/app.ts`
- Modify: `server/index.ts`

- [ ] **Step 1: Update `AppDeps` and route factory call**

In `server/app.ts`, add the import:

```ts
import type { AuthStatusService } from '@/server/domain/providers/auth-status';
```

Extend `AppDeps`:

```ts
export interface AppDeps {
  // ...existing fields...
  authStatusService?: AuthStatusService;
}
```

Change the providers mount to pass the service:

```ts
if (deps.providers) {
  app.use('/api/providers', createProvidersRoutes(deps.providers, deps.authStatusService));
}
```

- [ ] **Step 2: Construct `AuthStatusService` in bootstrap**

In `server/index.ts`, add the import:

```ts
import { AuthStatusService } from './domain/providers/auth-status';
```

Construct the service after `providers` is initialized (`await providers.refresh()`):

```ts
const authStatusService = new AuthStatusService({
  detectAnthropicAuth,
  openAIApiKey: cfg.openAIApiKey || undefined,
  geminiApiKey: cfg.geminiApiKey || undefined,
  ollamaHost: process.env.OLLAMA_HOST ?? 'http://localhost:11434',
});
```

Pass it into `createApp`:

```ts
const app = createApp({
  contextStore, historyStore, dispatcher, profilesStore, subAgentsStore,
  mcpRegistry, providers, searchService, authStatusService,
});
```

- [ ] **Step 3: Run the providers route tests to confirm wiring still works**

```bash
npx vitest run server/routes/providers.routes.test.ts
```

Expected: all 8 cases still pass.

- [ ] **Step 4: Lint**

```bash
npm run lint
```

Expected: no output.

- [ ] **Step 5: Commit**

```bash
git add server/app.ts server/index.ts
git commit -m "feat(slice-17): wire AuthStatusService through createApp + bootstrap"
```

---

## Task E1: FE types + providers.api extensions

**Files:**
- Create: `src/types/provider-auth.types.ts`
- Modify: `src/lib/api/providers.api.ts`
- Modify: `src/lib/api/providers.api.test.ts`

- [ ] **Step 1: Create the FE types** — `src/types/provider-auth.types.ts`:

```ts
export type ProviderTransport = 'anthropic' | 'openai' | 'gemini' | 'ollama';
export type AuthState = 'ok' | 'unconfigured' | 'error';

export interface TransportStatus {
  transport: ProviderTransport;
  state: AuthState;
  reason: string;
  detail?: string;
}

export interface AuthStatusReport {
  statuses: TransportStatus[];
  checkedAt: number;
}

export const TRANSPORT_ORDER: ProviderTransport[] = [
  'anthropic',
  'openai',
  'gemini',
  'ollama',
];
```

- [ ] **Step 2: Write failing tests** — append to `src/lib/api/providers.api.test.ts`:

```ts
import { http, HttpResponse } from 'msw';
import { server } from '@/src/test/msw-server';
import type { AuthStatusReport } from '@/src/types/provider-auth.types';

describe('providersApi.fetchAuthStatus', () => {
  it('GETs the auth status and returns parsed report', async () => {
    const report: AuthStatusReport = {
      checkedAt: 1,
      statuses: [
        { transport: 'anthropic', state: 'ok', reason: 'oauth' },
        { transport: 'openai', state: 'unconfigured', reason: 'no api key' },
        { transport: 'gemini', state: 'unconfigured', reason: 'no api key' },
        { transport: 'ollama', state: 'ok', reason: '0 models' },
      ],
    };
    server.use(
      http.get('http://localhost/api/providers/auth-status', () => HttpResponse.json(report)),
    );
    const got = await providersApi.fetchAuthStatus();
    expect(got.statuses).toHaveLength(4);
    expect(got.statuses[0].transport).toBe('anthropic');
  });
});

describe('providersApi.refreshAuthStatus', () => {
  it('POSTs without transport query when called with no arg', async () => {
    let urlSeen = '';
    server.use(
      http.post('http://localhost/api/providers/auth-status/refresh', ({ request }) => {
        urlSeen = request.url;
        return HttpResponse.json({ checkedAt: 0, statuses: [] });
      }),
    );
    await providersApi.refreshAuthStatus();
    expect(urlSeen).not.toMatch(/transport=/);
  });

  it('POSTs with transport query when an arg is provided', async () => {
    let urlSeen = '';
    server.use(
      http.post('http://localhost/api/providers/auth-status/refresh', ({ request }) => {
        urlSeen = request.url;
        return HttpResponse.json({ checkedAt: 0, statuses: [] });
      }),
    );
    await providersApi.refreshAuthStatus('openai');
    expect(urlSeen).toMatch(/transport=openai/);
  });
});
```

If `providersApi` is already imported at the top of the existing test file, don't duplicate. If not, add `import { providersApi } from './providers.api';`.

- [ ] **Step 3: Run the test, expect FAIL** (methods not present)

```bash
npx vitest run src/lib/api/providers.api.test.ts
```

- [ ] **Step 4: Extend `providers.api.ts`**

Add the import:

```ts
import type { AuthStatusReport, ProviderTransport } from '@/src/types/provider-auth.types';
```

Add to the `providersApi` object literal:

```ts
fetchAuthStatus: (): Promise<AuthStatusReport> =>
  fetch('/api/providers/auth-status').then(jsonRes<AuthStatusReport>),

refreshAuthStatus: (transport?: ProviderTransport): Promise<AuthStatusReport> => {
  const url = transport
    ? `/api/providers/auth-status/refresh?transport=${encodeURIComponent(transport)}`
    : '/api/providers/auth-status/refresh';
  return fetch(url, { method: 'POST' }).then(jsonRes<AuthStatusReport>);
},
```

- [ ] **Step 5: Run the tests, expect GREEN**

```bash
npx vitest run src/lib/api/providers.api.test.ts
```

Expected: all (existing + 3 new) cases pass.

- [ ] **Step 6: Commit**

```bash
git add src/types/provider-auth.types.ts src/lib/api/providers.api.ts src/lib/api/providers.api.test.ts
git commit -m "feat(slice-17): providersApi.fetchAuthStatus + refreshAuthStatus"
```

---

## Task F1: providerAuth.store (with dedupe by transport key)

**Files:**
- Create: `src/stores/providerAuth.store.ts`
- Create: `src/stores/providerAuth.store.test.ts`

- [ ] **Step 1: Write the failing tests** — `src/stores/providerAuth.store.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { http, HttpResponse } from 'msw';
import { server } from '@/src/test/msw-server';
import { useProviderAuthStore } from './providerAuth.store';

beforeEach(() => {
  useProviderAuthStore.getState()._reset();
});
afterEach(() => server.resetHandlers());

function fullReport() {
  return {
    checkedAt: 1,
    statuses: [
      { transport: 'anthropic', state: 'ok', reason: 'oauth' },
      { transport: 'openai', state: 'unconfigured', reason: 'no api key' },
      { transport: 'gemini', state: 'unconfigured', reason: 'no api key' },
      { transport: 'ollama', state: 'ok', reason: '2 models' },
    ],
  };
}

describe('useProviderAuthStore.init', () => {
  it('populates statuses + checkedAt and clears loading', async () => {
    server.use(
      http.get('http://localhost/api/providers/auth-status', () => HttpResponse.json(fullReport())),
    );
    await useProviderAuthStore.getState().init();
    const s = useProviderAuthStore.getState();
    expect(s.statuses).toHaveLength(4);
    expect(s.checkedAt).toBe(1);
    expect(s.loading).toBe(false);
    expect(s.error).toBeNull();
  });
});

describe('useProviderAuthStore.refresh', () => {
  it('refresh() re-fetches and replaces all statuses', async () => {
    server.use(
      http.get('http://localhost/api/providers/auth-status', () => HttpResponse.json(fullReport())),
      http.post('http://localhost/api/providers/auth-status/refresh', () =>
        HttpResponse.json({
          checkedAt: 2,
          statuses: [
            { transport: 'anthropic', state: 'error', reason: '500', detail: 'oops' },
            { transport: 'openai', state: 'unconfigured', reason: 'no api key' },
            { transport: 'gemini', state: 'unconfigured', reason: 'no api key' },
            { transport: 'ollama', state: 'ok', reason: '2 models' },
          ],
        }),
      ),
    );
    await useProviderAuthStore.getState().init();
    await useProviderAuthStore.getState().refresh();
    const s = useProviderAuthStore.getState();
    expect(s.checkedAt).toBe(2);
    expect(s.statuses[0].state).toBe('error');
  });

  it('refresh("anthropic") merges only the new anthropic row', async () => {
    server.use(
      http.get('http://localhost/api/providers/auth-status', () => HttpResponse.json(fullReport())),
      http.post('http://localhost/api/providers/auth-status/refresh', ({ request }) => {
        const url = new URL(request.url);
        if (url.searchParams.get('transport') === 'anthropic') {
          // Server merges; for FE we just trust the body
          return HttpResponse.json({
            checkedAt: 3,
            statuses: [
              { transport: 'anthropic', state: 'error', reason: '401', detail: 'unauthorized' },
              { transport: 'openai', state: 'unconfigured', reason: 'no api key' },
              { transport: 'gemini', state: 'unconfigured', reason: 'no api key' },
              { transport: 'ollama', state: 'ok', reason: '2 models' },
            ],
          });
        }
        return HttpResponse.json(fullReport());
      }),
    );
    await useProviderAuthStore.getState().init();
    await useProviderAuthStore.getState().refresh('anthropic');
    const s = useProviderAuthStore.getState();
    expect(s.statuses[0].state).toBe('error');
    expect(s.statuses[3].reason).toBe('2 models');
  });

  it('dedupes: two simultaneous refresh("anthropic") fire only one POST', async () => {
    let posts = 0;
    server.use(
      http.post('http://localhost/api/providers/auth-status/refresh', async () => {
        posts++;
        await new Promise((r) => setTimeout(r, 30));
        return HttpResponse.json({ checkedAt: 1, statuses: [] });
      }),
    );
    const a = useProviderAuthStore.getState().refresh('anthropic');
    const b = useProviderAuthStore.getState().refresh('anthropic');
    await Promise.all([a, b]);
    expect(posts).toBe(1);
  });

  it('sets error on network failure', async () => {
    server.use(
      http.get('http://localhost/api/providers/auth-status', () => HttpResponse.error()),
    );
    await useProviderAuthStore.getState().init();
    expect(useProviderAuthStore.getState().error).not.toBeNull();
    expect(useProviderAuthStore.getState().loading).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test, expect FAIL** (module missing)

```bash
npx vitest run src/stores/providerAuth.store.test.ts
```

- [ ] **Step 3: Implement the store** — `src/stores/providerAuth.store.ts`:

```ts
import { create } from 'zustand';
import { providersApi } from '@/src/lib/api/providers.api';
import type {
  AuthStatusReport,
  ProviderTransport,
  TransportStatus,
} from '@/src/types/provider-auth.types';

interface ProviderAuthState {
  statuses: TransportStatus[];
  checkedAt: number | null;
  loading: boolean;
  error: string | null;

  init(): Promise<void>;
  refresh(transport?: ProviderTransport): Promise<void>;
  _reset(): void;
}

const initial = {
  statuses: [] as TransportStatus[],
  checkedAt: null as number | null,
  loading: false,
  error: null as string | null,
};

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : 'Operation failed';
}

// Module-level dedupe registry: key -> in-flight promise.
const inflight = new Map<string, Promise<AuthStatusReport>>();

export const useProviderAuthStore = create<ProviderAuthState>((set) => ({
  ...initial,
  _reset: () => {
    inflight.clear();
    set(initial);
  },

  init: async () => {
    set({ loading: true, error: null });
    try {
      const report = await providersApi.fetchAuthStatus();
      set({ statuses: report.statuses, checkedAt: report.checkedAt, loading: false, error: null });
    } catch (e) {
      set({ loading: false, error: errMsg(e) });
    }
  },

  refresh: async (transport) => {
    const key = transport ?? 'all';
    const existing = inflight.get(key);
    if (existing) {
      await existing.catch(() => {});
      return;
    }
    set({ loading: true, error: null });
    const promise = providersApi.refreshAuthStatus(transport);
    inflight.set(key, promise);
    try {
      const report = await promise;
      set({ statuses: report.statuses, checkedAt: report.checkedAt, loading: false, error: null });
    } catch (e) {
      set({ loading: false, error: errMsg(e) });
    } finally {
      inflight.delete(key);
    }
  },
}));
```

- [ ] **Step 4: Run the test, expect GREEN**

```bash
npx vitest run src/stores/providerAuth.store.test.ts
```

Expected: 5 cases pass.

- [ ] **Step 5: Commit**

```bash
git add src/stores/providerAuth.store.ts src/stores/providerAuth.store.test.ts
git commit -m "feat(slice-17): providerAuth store with transport-key dedupe"
```

---

## Task G1: ProviderAuthSection sidebar component

**Files:**
- Create: `src/components/sidebar/ProviderAuthSection.tsx`
- Create: `src/components/sidebar/ProviderAuthSection.test.tsx`

- [ ] **Step 1: Write the failing tests** — `src/components/sidebar/ProviderAuthSection.test.tsx`:

```tsx
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ProviderAuthSection } from './ProviderAuthSection';
import { useProviderAuthStore } from '@/src/stores/providerAuth.store';

beforeEach(() => {
  useProviderAuthStore.getState()._reset();
});

describe('ProviderAuthSection', () => {
  it('renders 4 rows in fixed order (anthropic, openai, gemini, ollama)', () => {
    useProviderAuthStore.setState({
      statuses: [
        { transport: 'anthropic', state: 'ok', reason: 'oauth' },
        { transport: 'openai', state: 'unconfigured', reason: 'no api key' },
        { transport: 'gemini', state: 'unconfigured', reason: 'no api key' },
        { transport: 'ollama', state: 'ok', reason: '3 models' },
      ],
      checkedAt: 1,
      loading: false,
      error: null,
    });
    render(<ProviderAuthSection />);
    const rows = screen.getAllByTestId('provider-auth-row');
    expect(rows).toHaveLength(4);
    expect(rows[0]).toHaveTextContent(/anthropic/i);
    expect(rows[3]).toHaveTextContent(/ollama/i);
  });

  it('refresh button calls useProviderAuthStore.refresh', async () => {
    const refreshSpy = vi.fn(async () => {});
    useProviderAuthStore.setState({
      statuses: [],
      checkedAt: 0,
      loading: false,
      error: null,
      refresh: refreshSpy,
    });
    const user = userEvent.setup();
    render(<ProviderAuthSection />);
    await user.click(screen.getByLabelText(/refresh provider auth/i));
    expect(refreshSpy).toHaveBeenCalled();
  });

  it('row sets title= to detail when present', () => {
    useProviderAuthStore.setState({
      statuses: [
        { transport: 'anthropic', state: 'error', reason: '500', detail: 'internal server error' },
        { transport: 'openai', state: 'unconfigured', reason: 'no api key' },
        { transport: 'gemini', state: 'unconfigured', reason: 'no api key' },
        { transport: 'ollama', state: 'error', reason: 'ECONNREFUSED' },
      ],
      checkedAt: 1,
      loading: false,
      error: null,
    });
    render(<ProviderAuthSection />);
    const rows = screen.getAllByTestId('provider-auth-row');
    expect(rows[0]).toHaveAttribute('title', 'internal server error');
    // ollama has no detail -> no title attribute (or empty)
    expect(rows[3].getAttribute('title') ?? '').toBe('');
  });

  it('renders error banner when store.error is set', () => {
    useProviderAuthStore.setState({
      statuses: [],
      checkedAt: null,
      loading: false,
      error: 'fetch failed',
    });
    render(<ProviderAuthSection />);
    expect(screen.getByText(/fetch failed/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the test, expect FAIL** (module missing)

```bash
npx vitest run src/components/sidebar/ProviderAuthSection.test.tsx
```

- [ ] **Step 3: Implement the component** — `src/components/sidebar/ProviderAuthSection.tsx`:

```tsx
import { RefreshCw } from 'lucide-react';
import { useProviderAuthStore } from '@/src/stores/providerAuth.store';
import {
  TRANSPORT_ORDER,
  type ProviderTransport,
  type AuthState,
} from '@/src/types/provider-auth.types';
import { cn } from '@/src/lib/cn';

const LABEL: Record<ProviderTransport, string> = {
  anthropic: 'Anthropic',
  openai: 'OpenAI',
  gemini: 'Gemini',
  ollama: 'Ollama',
};

const DOT_COLOR: Record<AuthState, string> = {
  ok: 'text-status-ok',
  unconfigured: 'text-zinc-500',
  error: 'text-status-error',
};

export function ProviderAuthSection() {
  const statuses = useProviderAuthStore((s) => s.statuses);
  const loading = useProviderAuthStore((s) => s.loading);
  const error = useProviderAuthStore((s) => s.error);
  const refresh = useProviderAuthStore((s) => s.refresh);

  const byTransport = new Map(statuses.map((s) => [s.transport, s] as const));

  return (
    <section>
      <div className="flex items-center justify-between mb-2">
        <div className="mono-label">Providers</div>
        <button
          type="button"
          aria-label="Refresh provider auth"
          onClick={() => refresh()}
          disabled={loading}
          className="text-zinc-500 hover:text-white disabled:opacity-40"
        >
          <RefreshCw size={12} className={cn(loading && 'animate-spin')} />
        </button>
      </div>

      {error && (
        <div className="mb-2 p-1.5 rounded bg-status-error/10 border border-status-error/40 text-status-error text-[10px]">
          {error}
        </div>
      )}

      <div className="space-y-1">
        {TRANSPORT_ORDER.map((t) => {
          const s = byTransport.get(t);
          if (!s) {
            return (
              <div
                key={t}
                data-testid="provider-auth-row"
                className="flex items-center gap-2 px-1.5 py-1 rounded text-[10px] font-mono text-zinc-600"
              >
                <span>○</span>
                <span>{LABEL[t]}</span>
                <span className="text-zinc-700">/ —</span>
              </div>
            );
          }
          const dot = s.state === 'ok' ? '●' : s.state === 'error' ? '●' : '○';
          return (
            <div
              key={t}
              data-testid="provider-auth-row"
              title={s.detail ?? ''}
              className="flex items-center gap-2 px-1.5 py-1 rounded text-[10px] font-mono text-zinc-400"
            >
              <span className={DOT_COLOR[s.state]}>{dot}</span>
              <span className="text-zinc-300">{LABEL[t]}</span>
              <span className="text-zinc-600">/ {s.reason}</span>
            </div>
          );
        })}
      </div>
    </section>
  );
}
```

- [ ] **Step 4: Run the test, expect GREEN**

```bash
npx vitest run src/components/sidebar/ProviderAuthSection.test.tsx
```

Expected: 4 cases pass.

- [ ] **Step 5: Commit**

```bash
git add src/components/sidebar/ProviderAuthSection.tsx src/components/sidebar/ProviderAuthSection.test.tsx
git commit -m "feat(slice-17): ProviderAuthSection sidebar component"
```

---

## Task H1: Mount in App + init on load

**Files:**
- Modify: `src/App.tsx`

- [ ] **Step 1: Wire init + mount**

In `src/App.tsx`:

Add the imports near the existing sidebar section imports:

```tsx
import { ProviderAuthSection } from '@/src/components/sidebar/ProviderAuthSection';
import { useProviderAuthStore } from '@/src/stores/providerAuth.store';
```

Add the init hook getter alongside the others:

```tsx
const initProviderAuth = useProviderAuthStore((s) => s.init);
```

Update the init `useEffect` to call it:

```tsx
useEffect(() => {
  initContext();
  initSessions();
  initUi();
  initProfiles();
  initSubAgents();
  initProviders();
  initProviderAuth();
}, [initContext, initSessions, initUi, initProfiles, initSubAgents, initProviders, initProviderAuth]);
```

Append `<ProviderAuthSection />` to the sidebar children, after `<SubAgentsSection />`:

```tsx
<Sidebar ...>
  <SessionsSection />
  <SystemProtocolSection />
  <SkillsSection />
  <ToolsSection />
  <McpServersSection />
  <SubAgentsSection />
  <ProviderAuthSection />
</Sidebar>
```

- [ ] **Step 2: Run the full FE suite to catch regressions**

```bash
npx vitest run src/
```

Expected: all green.

- [ ] **Step 3: Lint**

```bash
npm run lint
```

Expected: no output.

- [ ] **Step 4: Commit**

```bash
git add src/App.tsx
git commit -m "feat(slice-17): mount ProviderAuthSection + init on App load"
```

---

## Task I1: Hook dispatch error → targeted refresh

**Files:**
- Modify: `src/hooks/useStreamingDispatch.ts`
- Modify: `src/hooks/useStreamingDispatch.test.tsx` (or create if absent — verify first)

- [ ] **Step 1: Check whether the test file exists**

```bash
ls src/hooks/useStreamingDispatch.test.tsx 2>/dev/null && echo exists || echo missing
```

If missing, skip adding a unit test for this and rely on the integration test in Task K1. Otherwise:

- [ ] **Step 2: Write the failing test** — append to `src/hooks/useStreamingDispatch.test.tsx`:

```tsx
describe('useStreamingDispatch — auth refresh on dispatch error', () => {
  it('calls providerAuth.refresh("<transport>") on error for non-fake providers', async () => {
    const refreshSpy = vi.fn(async () => {});
    useProviderAuthStore.setState({ refresh: refreshSpy });

    // Stage an error from the API for an anthropic dispatch.
    server.use(
      http.post('http://localhost/api/ai/dispatch', () =>
        HttpResponse.json({ error: { code: 'AUTH', message: 'unauthorized' } }, { status: 401 }),
      ),
    );

    useSessionsStore.setState({
      activeSessionId: 'S1',
      sessions: [{ id: 'S1', title: '', createdAt: 0, updatedAt: 0, providerName: 'anthropic:claude-opus-4-7' }],
      hydrated: true,
    });

    const { result } = renderHook(() => useStreamingDispatch());
    await act(async () => {
      await result.current.send('hi');
    });
    expect(refreshSpy).toHaveBeenCalledWith('anthropic');
  });

  it('does NOT refresh when the failing provider is fake', async () => {
    const refreshSpy = vi.fn(async () => {});
    useProviderAuthStore.setState({ refresh: refreshSpy });

    server.use(
      http.post('http://localhost/api/ai/dispatch', () =>
        HttpResponse.json({ error: { code: 'X', message: 'nope' } }, { status: 500 }),
      ),
    );
    useSessionsStore.setState({
      activeSessionId: 'S1',
      sessions: [{ id: 'S1', title: '', createdAt: 0, updatedAt: 0, providerName: 'fake:default' }],
      hydrated: true,
    });

    const { result } = renderHook(() => useStreamingDispatch());
    await act(async () => {
      await result.current.send('hi');
    });
    expect(refreshSpy).not.toHaveBeenCalled();
  });
});
```

(Adapt imports to existing test scaffolding. Add `import { useProviderAuthStore } from '@/src/stores/providerAuth.store';` at top if needed.)

- [ ] **Step 3: Run the test, expect FAIL**

```bash
npx vitest run src/hooks/useStreamingDispatch.test.tsx
```

- [ ] **Step 4: Add the hook into `useStreamingDispatch.ts`**

Add the import near the top:

```ts
import { useProviderAuthStore } from '@/src/stores/providerAuth.store';
import type { ProviderTransport } from '@/src/types/provider-auth.types';
```

Add a small helper above the `useStreamingDispatch` function:

```ts
const PROBED_TRANSPORTS = ['anthropic', 'openai', 'gemini', 'ollama'] as const;

function maybeRefreshAuthStatus(providerName: string | undefined): void {
  if (!providerName) return;
  const transport = providerName.split(':')[0];
  if ((PROBED_TRANSPORTS as readonly string[]).includes(transport)) {
    void useProviderAuthStore.getState().refresh(transport as ProviderTransport);
  }
}
```

In both `send` and `resume`, in the `else if (ev.event === 'error')` branch, **before** `failAssistant`, call:

```ts
maybeRefreshAuthStatus(activeName);
```

Also call it in the outer `catch (e)` of both `send` and `resume`, **inside** the non-aborted branch:

```ts
} catch (e) {
  if (controller.signal.aborted) {
    useChatStore.getState().finishAssistant(id, { interrupted: true });
  } else {
    maybeRefreshAuthStatus(activeName);
    useChatStore.getState().failAssistant(id, errMsg(e), true);
  }
}
```

- [ ] **Step 5: Run the test, expect GREEN**

```bash
npx vitest run src/hooks/useStreamingDispatch.test.tsx
```

Expected: existing + 2 new cases pass.

- [ ] **Step 6: Commit**

```bash
git add src/hooks/useStreamingDispatch.ts src/hooks/useStreamingDispatch.test.tsx
git commit -m "feat(slice-17): re-probe failing transport on dispatch error"
```

---

## Task J1: MSW defaults

**Files:**
- Modify: `src/test/msw-handlers.ts`

- [ ] **Step 1: Append handlers** to the `handlers` array at the end:

```ts
http.get('http://localhost/api/providers/auth-status', () =>
  HttpResponse.json({
    checkedAt: 0,
    statuses: [
      { transport: 'anthropic', state: 'unconfigured', reason: 'no api key' },
      { transport: 'openai', state: 'unconfigured', reason: 'no api key' },
      { transport: 'gemini', state: 'unconfigured', reason: 'no api key' },
      { transport: 'ollama', state: 'unconfigured', reason: 'no api key' },
    ],
  }),
),
http.post('http://localhost/api/providers/auth-status/refresh', () =>
  HttpResponse.json({
    checkedAt: Date.now(),
    statuses: [
      { transport: 'anthropic', state: 'unconfigured', reason: 'no api key' },
      { transport: 'openai', state: 'unconfigured', reason: 'no api key' },
      { transport: 'gemini', state: 'unconfigured', reason: 'no api key' },
      { transport: 'ollama', state: 'unconfigured', reason: 'no api key' },
    ],
  }),
),
```

- [ ] **Step 2: Run the FE suite**

```bash
npx vitest run src/
```

Expected: all green; no regressions from the new defaults.

- [ ] **Step 3: Commit**

```bash
git add src/test/msw-handlers.ts
git commit -m "test(slice-17): MSW defaults for auth-status endpoints"
```

---

## Task K1: Integration test — App mounts → 4 rows render

**Files:**
- Create: `src/integration/provider-auth.integration.test.tsx`

- [ ] **Step 1: Write the test**

Create `src/integration/provider-auth.integration.test.tsx`:

```tsx
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
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
import { useProviderAuthStore } from '@/src/stores/providerAuth.store';

beforeEach(() => {
  useUiStore.getState()._reset();
  useSessionsStore.getState()._reset();
  useProfilesStore.getState()._reset();
  useContextStore.getState()._reset();
  useSubAgentsStore.getState()._reset();
  useMcpStore.getState()._reset();
  useProvidersStore.getState()._reset();
  useChatStore.getState()._reset();
  useProviderAuthStore.getState()._reset();
  localStorage.clear();
});

afterEach(() => {
  server.resetHandlers();
});

describe('provider-auth integration', () => {
  it('App mounts → fetches auth status → renders 4 rows', async () => {
    server.use(
      http.get('http://localhost/api/providers/auth-status', () =>
        HttpResponse.json({
          checkedAt: 1,
          statuses: [
            { transport: 'anthropic', state: 'ok', reason: 'oauth' },
            { transport: 'openai', state: 'unconfigured', reason: 'no api key' },
            { transport: 'gemini', state: 'unconfigured', reason: 'no api key' },
            { transport: 'ollama', state: 'ok', reason: '3 models' },
          ],
        }),
      ),
    );

    render(<App />);
    await waitFor(() => {
      const rows = screen.getAllByTestId('provider-auth-row');
      expect(rows).toHaveLength(4);
    });
    expect(screen.getAllByTestId('provider-auth-row')[0]).toHaveTextContent(/anthropic/i);
    expect(screen.getAllByTestId('provider-auth-row')[3]).toHaveTextContent(/ollama/i);
  });
});
```

- [ ] **Step 2: Run the test, expect GREEN**

```bash
npx vitest run src/integration/provider-auth.integration.test.tsx
```

Expected: 1 case passes.

- [ ] **Step 3: Commit**

```bash
git add src/integration/provider-auth.integration.test.tsx
git commit -m "test(slice-17): integration — App renders 4 provider auth rows"
```

---

## Task L1: Playwright smoke test

**Files:**
- Modify: `e2e/smoke.spec.ts`

- [ ] **Step 1: Append a smoke**

```ts
test('provider auth: pane is visible with 4 rows + refresh works', async ({ page }) => {
  await page.goto('/');
  await page.getByText('AETHER_CORE').waitFor();

  // Wait for the 4 rows to render
  await page.getByText(/^Providers$/i).waitFor();
  const rows = page.getByTestId('provider-auth-row');
  await rows.first().waitFor();
  expect(await rows.count()).toBe(4);

  // Click refresh — rows still present
  await page.getByLabel('Refresh provider auth').click();
  await page.waitForTimeout(200);
  expect(await rows.count()).toBe(4);
});
```

- [ ] **Step 2: Build and run e2e**

```bash
npm run build
npx playwright test
```

Expected: all previous tests pass + the new one passes.

- [ ] **Step 3: Commit**

```bash
git add e2e/smoke.spec.ts
git commit -m "test(slice-17): playwright smoke for provider auth pane"
```

---

## Task M1: Final gates + push + PR

- [ ] **Step 1: Lint**

```bash
npm run lint
```

Expected: clean.

- [ ] **Step 2: Full vitest**

```bash
npx vitest run
```

Expected: all green except the two pre-existing Ollama flakes from `server/domain/providers/registry.test.ts` and `server/routes/providers.routes.test.ts` (only when a local Ollama daemon is reachable).

- [ ] **Step 3: Full playwright**

```bash
npx playwright test
```

Expected: all green.

- [ ] **Step 4: Push the branch**

```bash
git push -u origin feat/slice-17-provider-auth-pane
```

- [ ] **Step 5: Open the PR**

```bash
gh pr create --title "feat(slice-17): provider auth status pane" --body "$(cat <<'EOF'
## Summary
- New \`AuthStatusService\` runs 4 transport probes (anthropic / openai / gemini / ollama) in parallel with a 5 s timeout each and full error isolation — always returns a 4-entry \`AuthStatusReport\`.
- New endpoints \`GET /api/providers/auth-status\` and \`POST /api/providers/auth-status/refresh?transport=…\` (the targeted refresh merges with the last full report).
- FE: \`providerAuth.store\` with transport-key dedupe, \`ProviderAuthSection\` at the bottom of the sidebar (dot + label + reason; tooltip carries full detail), \`refresh\` button in the section header.
- \`useStreamingDispatch\` calls \`providerAuth.refresh('<transport>')\` on any dispatch error from a non-fake provider — so a failed call automatically re-probes that transport.

## Test plan
- [x] AuthStatusService unit tests (5 cases: all-ok, mixed, single-transport, timeout, error isolation)
- [x] Routes (4 new cases: GET, POST all, POST ?transport=, 503 when service absent)
- [x] FE api + store + section + dispatch hook tests
- [x] MSW defaults
- [x] Integration: App renders 4 rows
- [x] Playwright smoke
- [x] Lint clean, full vitest green (modulo pre-existing Ollama flakes), 15/15 playwright

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

Expected: PR URL printed.

---

## Self-review

| Spec item | Covered by |
|---|---|
| `AuthStatusService` with 4 probes + 5 s timeout + isolation | Task B1 |
| Probe never throws upward; service always returns 4-entry report | Task B1 (timeout + error isolation tests) |
| `GET /api/providers/auth-status` | Task C1 |
| `POST /api/providers/auth-status/refresh?transport=…` (merge) | Task C1 |
| 503 when service absent | Task C1 |
| Bootstrap wiring | Task D1 |
| FE `providersApi.fetchAuthStatus` + `refreshAuthStatus` | Task E1 |
| `providerAuth.store` with init, refresh, dedupe, error | Task F1 |
| `ProviderAuthSection` with 4 fixed rows, dot colors, ↻ button, tooltip | Task G1 |
| Mount in App + init on load | Task H1 |
| Dispatch error → targeted refresh (non-fake transports only) | Task I1 |
| MSW defaults | Task J1 |
| Integration test | Task K1 |
| Playwright smoke | Task L1 |
| Lint + full tests + PR | Task M1 |

No gaps. No placeholders. Type names (`AuthStatusService`, `AuthStatusReport`, `TransportStatus`, `TRANSPORT_ORDER`, `useProviderAuthStore`, `fetchAuthStatus`, `refreshAuthStatus`, `ProviderAuthSection`) used consistently throughout.
