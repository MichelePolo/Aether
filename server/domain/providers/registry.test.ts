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
    fakeProvider: makeFake('fake-1'),
    geminiBuilder: () => makeFake('g'),
    ollamaBuilder: () => makeFake('o'),
    anthropicBuilder: (model: string) => makeFake(model),
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
});
