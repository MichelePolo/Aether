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

describe('ProviderRegistry', () => {
  it('always registers fake:default', async () => {
    const reg = new ProviderRegistry({
      ollamaHost: 'http://localhost:11434',
      geminiApiKey: undefined,
      fakeProvider: makeFake('fake-1'),
      geminiBuilder: () => makeFake('g'),
      ollamaBuilder: () => makeFake('o'),
    });
    await reg.refresh();
    expect(reg.get('fake:default')).not.toBeNull();
  });

  it('registers gemini entries when API key is set', async () => {
    const reg = new ProviderRegistry({
      ollamaHost: 'http://localhost:11434',
      geminiApiKey: 'sk-...',
      fakeProvider: makeFake('fake-1'),
      geminiBuilder: (model) => makeFake(model),
      ollamaBuilder: () => makeFake('o'),
    });
    await reg.refresh();
    expect(reg.get('gemini:gemini-2.0-flash-exp')).not.toBeNull();
  });

  it('skips gemini entries when no API key', async () => {
    const reg = new ProviderRegistry({
      ollamaHost: 'http://localhost:11434',
      geminiApiKey: undefined,
      fakeProvider: makeFake('fake-1'),
      geminiBuilder: () => makeFake('g'),
      ollamaBuilder: () => makeFake('o'),
    });
    await reg.refresh();
    expect(reg.list().find((d) => d.transport === 'gemini')).toBeUndefined();
  });

  it('describes returns the correct displayName', async () => {
    const reg = new ProviderRegistry({
      ollamaHost: 'http://localhost:11434',
      geminiApiKey: undefined,
      fakeProvider: makeFake('fake-1'),
      geminiBuilder: () => makeFake('g'),
      ollamaBuilder: () => makeFake('o'),
    });
    await reg.refresh();
    const d = reg.describe('fake:default');
    expect(d?.displayName).toMatch(/fake/i);
  });

  it('defaultName resolves: env override > gemini > ollama > fake', async () => {
    const reg = new ProviderRegistry({
      ollamaHost: 'http://localhost:11434',
      geminiApiKey: 'sk-...',
      fakeProvider: makeFake('fake-1'),
      geminiBuilder: (model) => makeFake(model),
      ollamaBuilder: () => makeFake('o'),
      defaultOverride: 'gemini:gemini-1.5-flash',
    });
    await reg.refresh();
    expect(reg.defaultName()).toBe('gemini:gemini-1.5-flash');
  });

  it('defaultName falls back to fake when nothing else registered', async () => {
    const reg = new ProviderRegistry({
      ollamaHost: 'http://localhost:11434',
      geminiApiKey: undefined,
      fakeProvider: makeFake('fake-1'),
      geminiBuilder: () => makeFake('g'),
      ollamaBuilder: () => makeFake('o'),
    });
    await reg.refresh();
    expect(reg.defaultName()).toBe('fake:default');
  });
});
