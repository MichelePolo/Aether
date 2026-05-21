import { ProviderRegistry } from '@/server/domain/providers/registry';
import type { AIProvider } from '@/server/domain/dispatch/providers/provider.types';

/**
 * Build a minimal ProviderRegistry that exposes a single provider as `fake:default`.
 * Used in tests that previously constructed DispatchService with `provider: someFake`.
 */
export async function buildSingleProviderRegistry(provider: AIProvider): Promise<ProviderRegistry> {
  const reg = new ProviderRegistry({
    ollamaHost: 'http://localhost:11434',
    geminiApiKey: undefined,
    anthropicAuth: 'none',
    openAIApiKey: undefined,
    fakeProvider: provider,
    geminiBuilder: () => provider,
    ollamaBuilder: () => provider,
    anthropicBuilder: () => provider,
    openAIBuilder: () => provider,
  });
  await reg.refresh();
  return reg;
}
