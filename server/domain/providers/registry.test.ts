import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ProviderRegistry } from './registry';
import type { AIProvider } from '@/server/domain/dispatch/providers/provider.types';
import { OpenAIProvider } from '@/server/domain/dispatch/providers/openai.provider';

function makeFake(model: string): AIProvider {
  return {
    model,
    capabilities: { thinking: true, toolCalling: true, vision: false },
    async *stream() { yield { type: 'done' as const }; },
  };
}

function baseDeps(
  overrides: Partial<ConstructorParameters<typeof ProviderRegistry>[0]> = {},
): ConstructorParameters<typeof ProviderRegistry>[0] {
  return {
    resolveKey: () => undefined,
    detectAnthropicAuth: async () => 'none' as const,
    fakeProvider: makeFake('fake-1'),
    geminiBuilder: () => makeFake('g'),
    listOllamaEndpoints: () => [{ id: 'local', label: 'local', baseUrl: 'http://localhost:11434' }],
    ollamaBuilder: (_baseUrl: string, model: string) => makeFake(model),
    anthropicBuilder: (model: string) => makeFake(model),
    openAIBuilder: (model: string) => makeFake(model),
    listOpenAICompatEndpoints: () => [],
    openAICompatBuilder: (_baseUrl: string, model: string) => makeFake(model),
    ...overrides,
  };
}

describe('ProviderRegistry', () => {
  // Default: Ollama unreachable, so live discovery can't leak a dev machine's
  // running models into provider-count / default-name assertions. Tests that
  // need Ollama models override this with their own fetch stub.
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 503 } as Response));
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('always registers fake:default', async () => {
    const reg = new ProviderRegistry(baseDeps());
    await reg.refresh();
    expect(reg.get('fake:default')).not.toBeNull();
  });

  it('registers gemini entries when API key is set', async () => {
    const reg = new ProviderRegistry(baseDeps({
      resolveKey: (t) => t === 'gemini' ? 'sk-...' : undefined,
      geminiBuilder: (model) => makeFake(model),
    }));
    await reg.refresh();
    expect(reg.get('gemini:gemini-2.0-flash-exp')).not.toBeNull();
  });

  it('skips gemini entries when no API key', async () => {
    const reg = new ProviderRegistry(baseDeps());
    await reg.refresh();
    expect(reg.list().find((d) => d.transport === 'gemini')).toBeUndefined();
  });

  it('describes returns the correct displayName', async () => {
    const reg = new ProviderRegistry(baseDeps());
    await reg.refresh();
    const d = reg.describe('fake:default');
    expect(d?.displayName).toMatch(/fake/i);
  });

  it('defaultName resolves: env override > gemini > ollama > fake', async () => {
    const reg = new ProviderRegistry(baseDeps({
      resolveKey: (t) => t === 'gemini' ? 'sk-...' : undefined,
      geminiBuilder: (model) => makeFake(model),
      defaultOverride: 'gemini:gemini-1.5-flash',
    }));
    await reg.refresh();
    expect(reg.defaultName()).toBe('gemini:gemini-1.5-flash');
  });

  it('defaultName falls back to fake when nothing else registered', async () => {
    const reg = new ProviderRegistry(baseDeps());
    await reg.refresh();
    expect(reg.defaultName()).toBe('fake:default');
  });

  it("registers all three anthropic entries when probe returns 'oauth'", async () => {
    const reg = new ProviderRegistry(baseDeps({ detectAnthropicAuth: async () => 'oauth' }));
    await reg.refresh();
    expect(reg.get('anthropic:claude-opus-4-7')).not.toBeNull();
    expect(reg.get('anthropic:claude-sonnet-4-6')).not.toBeNull();
    expect(reg.get('anthropic:claude-haiku-4-5')).not.toBeNull();
  });

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

  it("skips anthropic entries when probe returns 'none'", async () => {
    const reg = new ProviderRegistry(baseDeps({ detectAnthropicAuth: async () => 'none' }));
    await reg.refresh();
    expect(reg.list().find((d) => d.transport === 'anthropic')).toBeUndefined();
  });

  it('displayName for anthropic includes Anthropic and the model id', async () => {
    const reg = new ProviderRegistry(baseDeps({ detectAnthropicAuth: async () => 'oauth' }));
    await reg.refresh();
    const d = reg.describe('anthropic:claude-opus-4-7');
    expect(d?.displayName).toMatch(/anthropic/i);
    expect(d?.displayName).toContain('claude-opus-4-7');
  });

  it("registers all four openai entries when API key is set", async () => {
    const reg = new ProviderRegistry(baseDeps({ resolveKey: (t) => t === 'openai' ? 'sk-test' : undefined }));
    await reg.refresh();
    expect(reg.get('openai:gpt-5')).not.toBeNull();
    expect(reg.get('openai:gpt-5-mini')).not.toBeNull();
    expect(reg.get('openai:gpt-4.1')).not.toBeNull();
    expect(reg.get('openai:o3')).not.toBeNull();
  });

  it("skips openai entries when API key is absent", async () => {
    const reg = new ProviderRegistry(baseDeps({ resolveKey: () => undefined }));
    await reg.refresh();
    expect(reg.list().find((d) => d.transport === 'openai')).toBeUndefined();
  });

  it("displayName for openai includes OpenAI and the model id", async () => {
    const reg = new ProviderRegistry(baseDeps({ resolveKey: (t) => t === 'openai' ? 'sk-test' : undefined }));
    await reg.refresh();
    const d = reg.describe('openai:o3');
    expect(d?.displayName).toMatch(/openai/i);
    expect(d?.displayName).toContain('o3');
  });

  it("capabilities flow from the builder's instance (o3 thinks, others don't)", async () => {
    // The fake builder gives every model { thinking: true, toolCalling: true }.
    // For this test, swap in an openAIBuilder that returns model-specific caps.
    const reg = new ProviderRegistry(baseDeps({
      resolveKey: (t) => t === 'openai' ? 'sk-test' : undefined,
      openAIBuilder: (model: string) => ({
        model,
        capabilities: { thinking: model === 'o3', toolCalling: true, vision: true },
        async *stream() { yield { type: 'done' as const }; },
      }),
    }));
    await reg.refresh();
    expect(reg.describe('openai:gpt-5')?.capabilities).toEqual({ thinking: false, toolCalling: true, vision: true });
    expect(reg.describe('openai:o3')?.capabilities).toEqual({ thinking: true, toolCalling: true, vision: true });
  });

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

  it('NRT: senza openai-compat endpoints, le chiavi ollama e defaultName non cambiano', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true, json: () => Promise.resolve({ models: [{ name: 'llama3:latest' }] }),
    } as Response));
    const reg = new ProviderRegistry(baseDeps({
      listOpenAICompatEndpoints: () => [],
      listOllamaEndpoints: () => [{ id: 'local', label: 'local', baseUrl: 'http://localhost:11434' }],
    }));
    await reg.refresh();
    expect(reg.list().some((d) => d.transport === 'openai-compat')).toBe(false);
    expect(reg.get('ollama:llama3:latest')).not.toBeNull();
    expect(reg.defaultName()).toBe('ollama:llama3:latest');
    vi.unstubAllGlobals();
  });

  it('registra provider openai-compat per ogni model scoperto', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.endsWith('/v1/models')) return new Response(JSON.stringify({ data: [{ id: 'qwen' }] }), { status: 200 });
      return new Response('{}', { status: 200 });
    }));
    const reg = new ProviderRegistry(baseDeps({
      listOpenAICompatEndpoints: () => [{ id: 'corp', label: 'corp', baseUrl: 'https://v/v1', model: null, headers: { Authorization: 'Bearer t' } }],
      openAICompatBuilder: (baseUrl, model, headers) => new OpenAIProvider({ apiKey: '', model, baseUrl: `${baseUrl}/chat/completions`, headers }),
    }));
    await reg.refresh();
    expect(reg.list().some((d) => d.name === 'openai-compat:corp:qwen')).toBe(true);
    vi.unstubAllGlobals();
  });
});
