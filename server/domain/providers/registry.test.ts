import { describe, it, expect } from 'vitest';
import { ProviderRegistry } from './registry';
import type { AIProvider } from '@/server/domain/dispatch/providers/provider.types';

function makeFake(model: string): AIProvider {
  return {
    model,
    capabilities: { thinking: true, toolCalling: true },
    async *stream() { yield { type: 'done' as const }; },
  };
}

function baseDeps(
  overrides: Partial<ConstructorParameters<typeof ProviderRegistry>[0]> = {},
): ConstructorParameters<typeof ProviderRegistry>[0] {
  return {
    ollamaHost: 'http://localhost:11434',
    geminiApiKey: undefined,
    anthropicAuth: 'none',
    openAIApiKey: undefined,
    fakeProvider: makeFake('fake-1'),
    geminiBuilder: () => makeFake('g'),
    ollamaBuilder: () => makeFake('o'),
    anthropicBuilder: (model: string) => makeFake(model),
    openAIBuilder: (model: string) => makeFake(model),
    ...overrides,
  };
}

describe('ProviderRegistry', () => {
  it('always registers fake:default', async () => {
    const reg = new ProviderRegistry(baseDeps());
    await reg.refresh();
    expect(reg.get('fake:default')).not.toBeNull();
  });

  it('registers gemini entries when API key is set', async () => {
    const reg = new ProviderRegistry(baseDeps({
      geminiApiKey: 'sk-...',
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
      geminiApiKey: 'sk-...',
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
    const reg = new ProviderRegistry(baseDeps({ anthropicAuth: 'oauth' }));
    await reg.refresh();
    expect(reg.get('anthropic:claude-opus-4-7')).not.toBeNull();
    expect(reg.get('anthropic:claude-sonnet-4-6')).not.toBeNull();
    expect(reg.get('anthropic:claude-haiku-4-5')).not.toBeNull();
  });

  it("registers all three anthropic entries when probe returns 'apikey'", async () => {
    const reg = new ProviderRegistry(baseDeps({ anthropicAuth: 'apikey' }));
    await reg.refresh();
    expect(reg.list().filter((d) => d.transport === 'anthropic')).toHaveLength(3);
  });

  it("skips anthropic entries when probe returns 'none'", async () => {
    const reg = new ProviderRegistry(baseDeps({ anthropicAuth: 'none' }));
    await reg.refresh();
    expect(reg.list().find((d) => d.transport === 'anthropic')).toBeUndefined();
  });

  it('displayName for anthropic includes Anthropic and the model id', async () => {
    const reg = new ProviderRegistry(baseDeps({ anthropicAuth: 'oauth' }));
    await reg.refresh();
    const d = reg.describe('anthropic:claude-opus-4-7');
    expect(d?.displayName).toMatch(/anthropic/i);
    expect(d?.displayName).toContain('claude-opus-4-7');
  });

  it("registers all four openai entries when API key is set", async () => {
    const reg = new ProviderRegistry(baseDeps({ openAIApiKey: 'sk-test' }));
    await reg.refresh();
    expect(reg.get('openai:gpt-5')).not.toBeNull();
    expect(reg.get('openai:gpt-5-mini')).not.toBeNull();
    expect(reg.get('openai:gpt-4.1')).not.toBeNull();
    expect(reg.get('openai:o3')).not.toBeNull();
  });

  it("skips openai entries when API key is absent", async () => {
    const reg = new ProviderRegistry(baseDeps({ openAIApiKey: undefined }));
    await reg.refresh();
    expect(reg.list().find((d) => d.transport === 'openai')).toBeUndefined();
  });

  it("displayName for openai includes OpenAI and the model id", async () => {
    const reg = new ProviderRegistry(baseDeps({ openAIApiKey: 'sk-test' }));
    await reg.refresh();
    const d = reg.describe('openai:o3');
    expect(d?.displayName).toMatch(/openai/i);
    expect(d?.displayName).toContain('o3');
  });

  it("capabilities flow from the builder's instance (o3 thinks, others don't)", async () => {
    // The fake builder gives every model { thinking: true, toolCalling: true }.
    // For this test, swap in an openAIBuilder that returns model-specific caps.
    const reg = new ProviderRegistry(baseDeps({
      openAIApiKey: 'sk-test',
      openAIBuilder: (model: string) => ({
        model,
        capabilities: { thinking: model === 'o3', toolCalling: true },
        async *stream() { yield { type: 'done' as const }; },
      }),
    }));
    await reg.refresh();
    expect(reg.describe('openai:gpt-5')?.capabilities).toEqual({ thinking: false, toolCalling: true });
    expect(reg.describe('openai:o3')?.capabilities).toEqual({ thinking: true, toolCalling: true });
  });
});
