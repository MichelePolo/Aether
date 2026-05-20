// server/routes/providers.routes.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { createApp } from '@/server/app';
import { ProviderRegistry } from '@/server/domain/providers/registry';
import type { AIProvider } from '@/server/domain/dispatch/providers/provider.types';

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
    geminiApiKey: undefined,
    anthropicAuth: 'none',
    fakeProvider: makeFake('fake-1'),
    geminiBuilder: () => makeFake('g'),
    ollamaBuilder: () => makeFake('o'),
    anthropicBuilder: (model) => makeFake(model),
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
