import { describe, it, expect, vi } from 'vitest';
import { AuthStatusService } from './auth-status';
import { TRANSPORT_ORDER } from './auth-status.types';

function makeService(overrides: Partial<ConstructorParameters<typeof AuthStatusService>[0]> = {}) {
  return new AuthStatusService({
    detectAnthropicAuth: async () => 'none',
    getAnthropicKey: () => undefined,
    getOpenAIKey: () => undefined,
    getGeminiKey: () => undefined,
    listOllamaEndpoints: () => [{ id: 'local', label: 'local', baseUrl: 'http://localhost:11434' }],
    fetch: vi.fn(async () => new Response(null, { status: 599 })) as unknown as typeof fetch,
    timeoutMs: 50,
    ...overrides,
  });
}

describe('AuthStatusService.probe — all-OK path', () => {
  it('returns 3 ok keyed statuses plus 1 ollama endpoint', async () => {
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
      getOpenAIKey: () => 'sk-x',
      getGeminiKey: () => 'gk-x',
      fetch: fetchMock as typeof fetch,
    });
    const report = await svc.probe();
    // statuses no longer includes ollama
    expect(report.statuses.map((s) => s.transport)).toEqual(
      TRANSPORT_ORDER.filter((t) => t !== 'ollama'),
    );
    expect(report.statuses.every((s) => s.state === 'ok')).toBe(true);
    // ollama is now in its own array
    expect(report.ollama).toHaveLength(1);
    expect(report.ollama[0].reason).toBe('2 models');
    expect(report.checkedAt).toBeGreaterThan(0);
  });
});

describe('AuthStatusService.probe — mixed', () => {
  it('handles ok / unconfigured / error / error in a single report', async () => {
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
    const report = await svc.probe();
    expect(report.statuses).toEqual([
      { transport: 'anthropic', state: 'ok', reason: 'api key set' },
      { transport: 'openai', state: 'unconfigured', reason: 'no api key' },
      expect.objectContaining({ transport: 'gemini', state: 'error', reason: '401' }),
    ]);
    // ollama error is now in the ollama array
    expect(report.ollama).toHaveLength(1);
    const ollama = report.ollama[0];
    expect(ollama.state).toBe('error');
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
    expect(report.ollama).toHaveLength(0);
  });
});

describe('AuthStatusService.probe — timeout', () => {
  it('returns state=error reason=timeout when a probe hangs past timeoutMs', async () => {
    const fetchMock = vi.fn(
      () => new Promise<Response>(() => {}), // never resolves
    );
    const svc = makeService({
      getOpenAIKey: () => 'sk-x',
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
    // 3 keyed transports (not ollama) + 1 ollama endpoint
    expect(report.statuses).toHaveLength(3);
    expect(report.statuses[0]).toEqual(
      expect.objectContaining({ transport: 'anthropic', state: 'error' }),
    );
  });
});

describe('AuthStatusService.probe — per-endpoint Ollama', () => {
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
      getAnthropicKey: () => undefined,
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
    expect(local).toMatchObject({ fixed: true, state: 'ok', reason: '1 model' });
    const gpu = report.ollama.find((e) => e.id === 'abc')!;
    expect(gpu).toMatchObject({ fixed: false, state: 'ok', reason: '2 models' });
    expect(report.statuses.some((s) => s.transport === 'ollama')).toBe(false);
  });

  it('marks an unreachable Ollama endpoint as error', async () => {
    const svc = new AuthStatusService({
      detectAnthropicAuth: async () => 'none',
      getAnthropicKey: () => undefined,
      getOpenAIKey: () => undefined,
      getGeminiKey: () => undefined,
      listOllamaEndpoints: () => [{ id: 'local', label: 'local', baseUrl: 'http://localhost:11434' }],
      fetch: vi.fn(async () => { throw new Error('connect ECONNREFUSED'); }) as unknown as typeof fetch,
      timeoutMs: 50,
    });
    const report = await svc.probe();
    expect(report.ollama[0].state).toBe('error');
  });
});

describe('AuthStatusService.probeAnthropic — apikey', () => {
  it('reports unconfigured when apikey auth is detected but no key resolves', async () => {
    const svc = makeService({
      detectAnthropicAuth: async () => 'apikey',
      getAnthropicKey: () => undefined,
      fetch: vi.fn(async () => new Response(null, { status: 200 })) as unknown as typeof fetch,
    });
    const report = await svc.probe(['anthropic']);
    expect(report.statuses[0]).toMatchObject({ transport: 'anthropic', state: 'unconfigured' });
  });

  it('reports error with the status code when /v1/models rejects the key', async () => {
    const svc = makeService({
      detectAnthropicAuth: async () => 'apikey',
      getAnthropicKey: () => 'ak-bad',
      fetch: vi.fn(async () => new Response(null, { status: 401 })) as unknown as typeof fetch,
    });
    const report = await svc.probe(['anthropic']);
    expect(report.statuses[0]).toMatchObject({
      transport: 'anthropic',
      state: 'error',
      reason: '401',
    });
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
