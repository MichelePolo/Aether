// server/routes/providers.routes.test.ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import request from 'supertest';
import express from 'express';
import { createApp } from '@/server/app';
import { ProviderRegistry } from '@/server/domain/providers/registry';
import type { AIProvider } from '@/server/domain/dispatch/providers/provider.types';
import type { AuthStatusService } from '@/server/domain/providers/auth-status';
import type { AuthStatusReport } from '@/server/domain/providers/auth-status.types';
import { KeyVaultService } from '@/server/domain/providers/key-vault';
import type { TransportStatus } from '@/server/domain/providers/auth-status.types';
import { makeTestDb } from '@/server/test/test-db';
import { OllamaEndpointStore } from '@/server/domain/providers/ollama-endpoints.store';
import { OpenAICompatEndpointStore } from '@/server/domain/providers/openai-endpoints.store';
import { isAppError } from '@/server/lib/errors';
import { createProvidersRoutes } from './providers.routes';

function makeFake(model: string): AIProvider {
  return {
    model,
    capabilities: { thinking: true, toolCalling: true, vision: false },
    async *stream() { yield { type: 'done' as const }; },
  };
}

async function makeApp() {
  const reg = new ProviderRegistry({
    resolveKey: () => undefined,
    detectAnthropicAuth: async () => 'none',
    fakeProvider: makeFake('fake-1'),
    geminiBuilder: () => makeFake('g'),
    listOllamaEndpoints: () => [{ id: 'local', label: 'local', baseUrl: 'http://localhost:11434' }],
    ollamaBuilder: (_baseUrl: string, model: string) => makeFake(model),
    anthropicBuilder: (model) => makeFake(model),
    openAIBuilder: (model) => makeFake(model),
    listOpenAICompatEndpoints: () => [],
    openAICompatBuilder: (_baseUrl: string, model: string) => makeFake(model),
  });
  await reg.refresh();
  const db = makeTestDb();
  const ollamaEndpointStore = new OllamaEndpointStore(db);
  const openaiEndpointStore = new OpenAICompatEndpointStore(db);
  return {
    app: createApp({
      providers: reg,
      ollamaEndpointStore,
      openaiEndpointStore,
      buildInfoRowsCtx: { anthropicCliPresent: false, ollamaHost: 'http://localhost:11434' },
    }),
    reg,
  };
}

describe('providers routes', () => {
  let app: Awaited<ReturnType<typeof makeApp>>['app'];
  beforeEach(async () => {
    // Ollama unreachable so registry discovery is deterministic regardless of
    // whether a real Ollama daemon is running on the dev machine.
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 503 } as Response));
    ({ app } = await makeApp());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('GET /api/providers returns at least fake:default', async () => {
    const res = await request(app).get('/api/providers');
    expect(res.status).toBe(200);
    const names = res.body.providers.map((p: { name: string }) => p.name);
    expect(names).toContain('fake:default');
  });

  it('GET /api/providers includes capabilities + displayName', async () => {
    const res = await request(app).get('/api/providers');
    const fake = res.body.providers.find((p: { name: string }) => p.name === 'fake:default');
    expect(fake.capabilities).toEqual({ thinking: true, toolCalling: true, vision: false });
    expect(fake.displayName).toMatch(/fake/i);
  });

  it('POST /api/providers/refresh re-runs discovery', async () => {
    const res = await request(app).post('/api/providers/refresh');
    expect(res.status).toBe(200);
    expect(res.body.providers).toEqual(expect.any(Array));
  });

  it('GET /api/providers includes an issues array', async () => {
    const res = await request(app).get('/api/providers');
    expect(res.body.issues).toEqual([]);
  });

  it('GET /api/providers/default returns the registry default name', async () => {
    const res = await request(app).get('/api/providers/default');
    expect(res.status).toBe(200);
    expect(res.body.name).toBe('fake:default');
  });
});

function makeAuthSvc(report: AuthStatusReport, probeSpy?: ReturnType<typeof vi.fn>): AuthStatusService {
  return { probe: probeSpy ?? vi.fn(async () => report) } as unknown as AuthStatusService;
}

describe('providers routes — auth status', () => {
  const fullReport: AuthStatusReport = {
    checkedAt: 1234,
    statuses: [
      { transport: 'anthropic', state: 'ok', reason: 'oauth' },
      { transport: 'openai', state: 'unconfigured', reason: 'no api key' },
      { transport: 'gemini', state: 'unconfigured', reason: 'no api key' },
    ],
    ollama: [{ id: 'local', label: 'local', fixed: true, state: 'ok', reason: '3 models' }],
    openaiCompat: [],
  };

  it('GET /api/providers/auth-status returns the full report', async () => {
    const { reg } = await makeApp();
    const authStatusService = makeAuthSvc(fullReport);
    const app = createApp({ providers: reg, authStatusService });
    const res = await request(app).get('/api/providers/auth-status');
    expect(res.status).toBe(200);
    expect(res.body.statuses).toHaveLength(3);
    expect(res.body.ollama).toHaveLength(1);
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
    expect(res.body.statuses).toHaveLength(3);
  });

  it('POST /api/providers/auth-status/refresh?transport=anthropic re-probes one and merges', async () => {
    const { reg } = await makeApp();
    const targeted: AuthStatusReport = {
      checkedAt: 9999,
      statuses: [{ transport: 'anthropic', state: 'error', reason: '500', detail: 'oops' }],
      ollama: [],
      openaiCompat: [],
    };
    let firstCall = true;
    const probeSpy = vi.fn(async (_transports?: string[]) => {
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
    // The other 2 keyed transports came from the prior cached report.
    expect(res.body.statuses).toHaveLength(3);
  });

  it('returns 503 when authStatusService is absent', async () => {
    const { reg } = await makeApp();
    const app = createApp({ providers: reg }); // no authStatusService
    const res = await request(app).get('/api/providers/auth-status');
    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe('NO_AUTH_STATUS');
  });

  it('GET /api/providers/auth-status refreshes the registry when Anthropic is authed but absent', async () => {
    // Registry built at boot while auth was still 'none' (cold-start probe
    // failed): no anthropic models registered. Auth later flips to 'oauth'.
    let authMode: 'none' | 'oauth' = 'none';
    const reg = new ProviderRegistry({
      resolveKey: () => undefined,
      detectAnthropicAuth: async () => authMode,
      fakeProvider: makeFake('fake-1'),
      geminiBuilder: () => makeFake('g'),
      listOllamaEndpoints: () => [{ id: 'local', label: 'local', baseUrl: 'http://localhost:11434' }],
      ollamaBuilder: (_b: string, model: string) => makeFake(model),
      anthropicBuilder: (model) => makeFake(model),
      openAIBuilder: (model) => makeFake(model),
      listOpenAICompatEndpoints: () => [],
      openAICompatBuilder: (_baseUrl: string, model: string) => makeFake(model),
    });
    await reg.refresh();
    expect(reg.list().some((p) => p.transport === 'anthropic')).toBe(false);

    authMode = 'oauth';
    const report: AuthStatusReport = {
      checkedAt: 1,
      statuses: [{ transport: 'anthropic', state: 'ok', reason: 'oauth' }],
      ollama: [],
      openaiCompat: [],
    };
    const app = createApp({ providers: reg, authStatusService: makeAuthSvc(report) });

    const res = await request(app).get('/api/providers/auth-status');
    expect(res.status).toBe(200);
    expect(reg.list().some((p) => p.transport === 'anthropic')).toBe(true);
  });

  it('GET /api/providers/auth-status does not refresh when Anthropic already present', async () => {
    const reg = new ProviderRegistry({
      resolveKey: () => undefined,
      detectAnthropicAuth: async () => 'oauth',
      fakeProvider: makeFake('fake-1'),
      geminiBuilder: () => makeFake('g'),
      listOllamaEndpoints: () => [{ id: 'local', label: 'local', baseUrl: 'http://localhost:11434' }],
      ollamaBuilder: (_b: string, model: string) => makeFake(model),
      anthropicBuilder: (model) => makeFake(model),
      openAIBuilder: (model) => makeFake(model),
      listOpenAICompatEndpoints: () => [],
      openAICompatBuilder: (_baseUrl: string, model: string) => makeFake(model),
    });
    await reg.refresh();
    const refreshSpy = vi.spyOn(reg, 'refresh');
    const report: AuthStatusReport = {
      checkedAt: 1,
      statuses: [{ transport: 'anthropic', state: 'ok', reason: 'oauth' }],
      ollama: [],
      openaiCompat: [],
    };
    const app = createApp({ providers: reg, authStatusService: makeAuthSvc(report) });

    await request(app).get('/api/providers/auth-status');
    expect(refreshSpy).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Key Vault routes
// ---------------------------------------------------------------------------

function makeAppWithVault(opts?: { probeOk?: boolean }) {
  const db = makeTestDb();
  const vault = new KeyVaultService(db);
  const refreshSpy = vi.fn(async () => {});
  const probeSpy = vi.fn(async (transports?: string[]) => ({
    statuses: [{
      transport: (transports?.[0] ?? 'openai') as TransportStatus['transport'],
      state: opts?.probeOk === false ? 'unconfigured' : 'ok',
      reason: opts?.probeOk === false ? 'no api key' : 'api key set',
    }],
    ollama: [],
    openaiCompat: [],
    checkedAt: Date.now(),
  }));
  const registry = { list: () => [], refresh: refreshSpy, defaultName: () => null } as unknown as Parameters<typeof createProvidersRoutes>[0];
  const authStatusService = { probe: probeSpy } as unknown as Parameters<typeof createProvidersRoutes>[1];
  const app = express();
  app.use(express.json());
  app.use('/api/providers', createProvidersRoutes(registry, authStatusService, vault, { setAnthropicEnv: () => {} }));
  // Mount error handler matching createApp
  app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    if (isAppError(err)) {
      res.status(err.status).json({ error: { code: err.code, message: err.message } });
      return;
    }
    const message = err instanceof Error ? err.message : 'Unknown error';
    res.status(500).json({ error: { code: 'INTERNAL', message } });
  });
  return { app, vault, refreshSpy, probeSpy, db };
}

describe('providers routes — key vault', () => {
  it('GET /api/providers/keys returns 3 vault rows + 2 info rows', async () => {
    const { app } = makeAppWithVault();
    const res = await request(app).get('/api/providers/keys');
    expect(res.status).toBe(200);
    expect(res.body.vault).toHaveLength(3);
    expect(res.body.info).toHaveLength(2);
  });

  it('PUT /api/providers/keys/openai stores key, triggers refresh + probe, returns masked row + ok status', async () => {
    const { app, refreshSpy, probeSpy } = makeAppWithVault({ probeOk: true });
    const res = await request(app)
      .put('/api/providers/keys/openai')
      .send({ key: 'sk-test-1234567890' });
    expect(res.status).toBe(200);
    expect(refreshSpy).toHaveBeenCalledOnce();
    expect(probeSpy).toHaveBeenCalledWith(['openai']);
    expect(res.body.row).toBeDefined();
    expect(res.body.row.transport).toBe('openai');
    expect(res.body.row.hasKey).toBe(true);
    expect(res.body.status).toBeDefined();
    expect(res.body.status.state).toBe('ok');
  });

  it('PUT /api/providers/keys/openai with empty body returns 400', async () => {
    const { app } = makeAppWithVault();
    const res = await request(app)
      .put('/api/providers/keys/openai')
      .send({ key: '' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('PUT /api/providers/keys/invalid returns 400', async () => {
    const { app } = makeAppWithVault();
    const res = await request(app)
      .put('/api/providers/keys/invalid')
      .send({ key: 'somekey' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('DELETE /api/providers/keys/openai clears + re-probes (probeOk=false fixture)', async () => {
    const { app, vault, refreshSpy, probeSpy } = makeAppWithVault({ probeOk: false });
    // Pre-set a key so we have something to delete
    vault.setKey('openai', 'sk-test-existing');
    const res = await request(app).delete('/api/providers/keys/openai');
    expect(res.status).toBe(200);
    expect(refreshSpy).toHaveBeenCalledOnce();
    expect(probeSpy).toHaveBeenCalledWith(['openai']);
    expect(res.body.status.state).toBe('unconfigured');
  });

  it('GET /api/providers/keys/openai?reveal=1 returns plaintext after set', async () => {
    const { app, vault } = makeAppWithVault();
    vault.setKey('openai', 'sk-plaintext-key');
    const res = await request(app).get('/api/providers/keys/openai?reveal=1');
    expect(res.status).toBe(200);
    expect(res.body.plaintext).toBe('sk-plaintext-key');
  });

  it('GET /api/providers/keys/openai?reveal=1 returns 404 when not set', async () => {
    const { app } = makeAppWithVault();
    const res = await request(app).get('/api/providers/keys/openai?reveal=1');
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  it('GET /api/providers/keys/openai without reveal=1 returns 400', async () => {
    const { app } = makeAppWithVault();
    const res = await request(app).get('/api/providers/keys/openai');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('all 4 vault routes return 503 when keyVault is absent', async () => {
    const registry = { list: () => [], refresh: vi.fn(async () => {}), defaultName: () => null } as unknown as Parameters<typeof createProvidersRoutes>[0];
    const app = express();
    app.use(express.json());
    app.use('/api/providers', createProvidersRoutes(registry));
    app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
      if (isAppError(err)) {
        res.status(err.status).json({ error: { code: err.code, message: err.message } });
        return;
      }
      const message = err instanceof Error ? err.message : 'Unknown error';
      res.status(500).json({ error: { code: 'INTERNAL', message } });
    });

    const getKeys = await request(app).get('/api/providers/keys');
    expect(getKeys.status).toBe(503);

    const putKey = await request(app).put('/api/providers/keys/openai').send({ key: 'test' });
    expect(putKey.status).toBe(503);

    const deleteKey = await request(app).delete('/api/providers/keys/openai');
    expect(deleteKey.status).toBe(503);

    const revealKey = await request(app).get('/api/providers/keys/openai?reveal=1');
    expect(revealKey.status).toBe(503);
  });
});

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
    expect(res.status).toBe(201);
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

  it('PUT returns 404 for a non-existent id', async () => {
    const { app } = await makeApp();
    const res = await request(app)
      .put('/api/providers/ollama-endpoints/00000000-0000-0000-0000-000000000000')
      .send({ label: 'x' });
    expect(res.status).toBe(404);
  });

  it('POST with headers stores them and returns headerKeys (no values)', async () => {
    const { app } = await makeApp();
    const res = await request(app)
      .post('/api/providers/ollama-endpoints')
      .send({ label: 'hdr', baseUrl: 'http://hdr.lan:11434', headers: { Authorization: 'Bearer tok' } });
    expect(res.status).toBe(201);
    expect(res.body.endpoint.headerKeys).toEqual(['Authorization']);
    expect(JSON.stringify(res.body)).not.toContain('Bearer tok');
  });

  it('POST with headers=non-object returns 400', async () => {
    const { app } = await makeApp();
    const res = await request(app)
      .post('/api/providers/ollama-endpoints')
      .send({ label: 'bad', baseUrl: 'http://a.lan', headers: 'not-an-object' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('POST with headers value not a string returns 400', async () => {
    const { app } = await makeApp();
    const res = await request(app)
      .post('/api/providers/ollama-endpoints')
      .send({ label: 'bad2', baseUrl: 'http://a.lan', headers: { X: 42 } });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });
});

// ---------------------------------------------------------------------------
// openai-endpoints routes
// ---------------------------------------------------------------------------

describe('openai-endpoints routes', () => {
  it('GET returns empty list initially', async () => {
    const { app } = await makeApp();
    const res = await request(app).get('/api/providers/openai-endpoints');
    expect(res.status).toBe(200);
    expect(res.body.endpoints).toEqual([]);
  });

  it('POST creates an endpoint and returns masked record (201)', async () => {
    const { app } = await makeApp();
    const res = await request(app)
      .post('/api/providers/openai-endpoints')
      .send({ label: 'vllm', baseUrl: 'http://vllm.lan:8000', model: 'mistral-7b' });
    expect(res.status).toBe(201);
    expect(res.body.endpoint).toMatchObject({ label: 'vllm', baseUrl: 'http://vllm.lan:8000', model: 'mistral-7b' });
    expect(res.body.endpoint.headerKeys).toEqual([]);
  });

  it('POST with headers stores them and returns headerKeys (no values)', async () => {
    const { app } = await makeApp();
    const res = await request(app)
      .post('/api/providers/openai-endpoints')
      .send({ label: 'auth-ep', baseUrl: 'http://vllm.lan:8000', headers: { Authorization: 'Bearer secret' } });
    expect(res.status).toBe(201);
    expect(res.body.endpoint.headerKeys).toEqual(['Authorization']);
    expect(JSON.stringify(res.body)).not.toContain('Bearer secret');
  });

  it('POST with headers=non-object returns 400 ValidationError', async () => {
    const { app } = await makeApp();
    const res = await request(app)
      .post('/api/providers/openai-endpoints')
      .send({ label: 'bad', baseUrl: 'http://vllm.lan:8000', headers: 'not-an-object' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('POST with headers value not a string returns 400 ValidationError', async () => {
    const { app } = await makeApp();
    const res = await request(app)
      .post('/api/providers/openai-endpoints')
      .send({ label: 'bad2', baseUrl: 'http://vllm.lan:8000', headers: { X: 42 } });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('POST rejects an invalid base URL', async () => {
    const { app } = await makeApp();
    const res = await request(app)
      .post('/api/providers/openai-endpoints')
      .send({ label: 'bad', baseUrl: 'not-a-url' });
    expect(res.status).toBe(400);
  });

  it('POST rejects missing label', async () => {
    const { app } = await makeApp();
    const res = await request(app)
      .post('/api/providers/openai-endpoints')
      .send({ baseUrl: 'http://vllm.lan:8000' });
    expect(res.status).toBe(400);
  });

  it('GET list includes newly created endpoint', async () => {
    const { app } = await makeApp();
    await request(app)
      .post('/api/providers/openai-endpoints')
      .send({ label: 'ep1', baseUrl: 'http://ep1.lan' });
    const res = await request(app).get('/api/providers/openai-endpoints');
    expect(res.status).toBe(200);
    expect(res.body.endpoints).toHaveLength(1);
    expect(res.body.endpoints[0]).toMatchObject({ label: 'ep1' });
  });

  it('POST rejects a duplicate label', async () => {
    const { app } = await makeApp();
    await request(app).post('/api/providers/openai-endpoints').send({ label: 'dup', baseUrl: 'http://a' });
    const res = await request(app).post('/api/providers/openai-endpoints').send({ label: 'dup', baseUrl: 'http://b' });
    expect(res.status).toBe(400);
  });

  it('PUT updates an endpoint', async () => {
    const { app } = await makeApp();
    const created = await request(app)
      .post('/api/providers/openai-endpoints')
      .send({ label: 'ep-put', baseUrl: 'http://ep-put.lan' });
    const id = created.body.endpoint.id as string;
    const res = await request(app)
      .put(`/api/providers/openai-endpoints/${id}`)
      .send({ label: 'ep-put-renamed' });
    expect(res.status).toBe(200);
    expect(res.body.endpoint.label).toBe('ep-put-renamed');
  });

  it('PUT returns 404 for a non-existent id', async () => {
    const { app } = await makeApp();
    const res = await request(app)
      .put('/api/providers/openai-endpoints/00000000-0000-0000-0000-000000000000')
      .send({ label: 'x' });
    expect(res.status).toBe(404);
  });

  it('DELETE removes an endpoint', async () => {
    const { app } = await makeApp();
    const created = await request(app)
      .post('/api/providers/openai-endpoints')
      .send({ label: 'tmp', baseUrl: 'http://tmp.lan' });
    const id = created.body.endpoint.id as string;
    const del = await request(app).delete(`/api/providers/openai-endpoints/${id}`);
    expect(del.status).toBe(200);
    expect(del.body.ok).toBe(true);
  });

  it('returns 503 when openaiEndpointStore is absent', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 503 } as Response));
    const { reg } = await makeApp();
    const app = createApp({ providers: reg }); // no openaiEndpointStore
    const res = await request(app).get('/api/providers/openai-endpoints');
    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe('NO_OPENAI_COMPAT_STORE');
    vi.unstubAllGlobals();
  });
});
