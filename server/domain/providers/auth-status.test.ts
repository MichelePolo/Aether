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
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
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
      fetch: fetchMock as typeof fetch,
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
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('generativelanguage')) return new Response(null, { status: 401 });
      if (url.endsWith('/api/tags')) throw new Error('ECONNREFUSED');
      return new Response(null, { status: 599 });
    });
    const svc = makeService({
      detectAnthropicAuth: async () => 'apikey',
      openAIApiKey: undefined,
      geminiApiKey: 'gk-x',
      fetch: fetchMock as typeof fetch,
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
