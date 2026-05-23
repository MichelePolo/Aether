// server/routes/providers.routes.test.ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import request from 'supertest';
import { createApp } from '@/server/app';
import { ProviderRegistry } from '@/server/domain/providers/registry';
import type { AIProvider } from '@/server/domain/dispatch/providers/provider.types';
import type { AuthStatusService } from '@/server/domain/providers/auth-status';
import type { AuthStatusReport } from '@/server/domain/providers/auth-status.types';

function makeFake(model: string): AIProvider {
  return {
    model,
    capabilities: { thinking: true, toolCalling: true },
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
