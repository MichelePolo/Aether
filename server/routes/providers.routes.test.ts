// server/routes/providers.routes.test.ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
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
    ollamaHost: 'http://localhost:11434',
    resolveKey: () => undefined,
    detectAnthropicAuth: async () => 'none',
    fakeProvider: makeFake('fake-1'),
    geminiBuilder: () => makeFake('g'),
    ollamaBuilder: () => makeFake('o'),
    anthropicBuilder: (model) => makeFake(model),
    openAIBuilder: (model) => makeFake(model),
  });
  await reg.refresh();
  return { app: createApp({ providers: reg }), reg };
}

describe('providers routes', () => {
  let app: Awaited<ReturnType<typeof makeApp>>['app'];
  beforeEach(async () => {
    ({ app } = await makeApp());
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
    expect(fake.capabilities).toEqual({ thinking: true, toolCalling: true });
    expect(fake.displayName).toMatch(/fake/i);
  });

  it('POST /api/providers/refresh re-runs discovery', async () => {
    const res = await request(app).post('/api/providers/refresh');
    expect(res.status).toBe(200);
    expect(res.body.providers).toEqual(expect.any(Array));
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
