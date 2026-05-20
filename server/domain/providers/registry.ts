import type { AIProvider, ProviderCapabilities } from '@/server/domain/dispatch/providers/provider.types';
import { discoverOllama, geminiHardcodedModels, anthropicHardcodedModels } from './discovery';

export type ProviderTransport = 'fake' | 'gemini' | 'ollama' | 'anthropic';

export interface ProviderDescriptor {
  name: string;
  transport: ProviderTransport;
  model: string;
  capabilities: ProviderCapabilities;
  displayName: string;
}

export interface ProviderRegistryDeps {
  ollamaHost: string;
  geminiApiKey: string | undefined;
  anthropicAuth: 'oauth' | 'apikey' | 'none';
  fakeProvider: AIProvider;
  geminiBuilder: (model: string) => AIProvider;
  ollamaBuilder: (model: string) => AIProvider;
  anthropicBuilder: (model: string) => AIProvider;
  defaultOverride?: string;
}

function displayNameFor(transport: ProviderTransport, model: string): string {
  if (transport === 'fake') return 'Fake (default)';
  if (transport === 'gemini') return `Gemini / ${model}`;
  if (transport === 'anthropic') return `Anthropic / ${model}`;
  return `Ollama / ${model}`;
}

export class ProviderRegistry {
  private entries = new Map<string, { provider: AIProvider; descriptor: ProviderDescriptor }>();

  constructor(private readonly deps: ProviderRegistryDeps) {}

  async refresh(): Promise<void> {
    const next = new Map<string, { provider: AIProvider; descriptor: ProviderDescriptor }>();

    // Always: fake
    {
      const name = 'fake:default';
      next.set(name, {
        provider: this.deps.fakeProvider,
        descriptor: {
          name,
          transport: 'fake',
          model: 'default',
          capabilities: this.deps.fakeProvider.capabilities,
          displayName: displayNameFor('fake', 'default'),
        },
      });
    }

    // Gemini
    if (this.deps.geminiApiKey) {
      for (const model of geminiHardcodedModels()) {
        const provider = this.deps.geminiBuilder(model);
        next.set(`gemini:${model}`, {
          provider,
          descriptor: {
            name: `gemini:${model}`,
            transport: 'gemini',
            model,
            capabilities: provider.capabilities,
            displayName: displayNameFor('gemini', model),
          },
        });
      }
    }

    // Anthropic
    if (this.deps.anthropicAuth !== 'none') {
      for (const model of anthropicHardcodedModels()) {
        const provider = this.deps.anthropicBuilder(model);
        next.set(`anthropic:${model}`, {
          provider,
          descriptor: {
            name: `anthropic:${model}`,
            transport: 'anthropic',
            model,
            capabilities: provider.capabilities,
            displayName: displayNameFor('anthropic', model),
          },
        });
      }
    }

    // Ollama (discovery)
    const tags = await discoverOllama(this.deps.ollamaHost);
    for (const tag of tags) {
      const provider = this.deps.ollamaBuilder(tag);
      next.set(`ollama:${tag}`, {
        provider,
        descriptor: {
          name: `ollama:${tag}`,
          transport: 'ollama',
          model: tag,
          capabilities: provider.capabilities,
          displayName: displayNameFor('ollama', tag),
        },
      });
    }

    this.entries = next;
  }

  get(name: string): AIProvider | null {
    return this.entries.get(name)?.provider ?? null;
  }

  list(): ProviderDescriptor[] {
    return [...this.entries.values()].map((e) => e.descriptor);
  }

  describe(name: string): ProviderDescriptor | null {
    return this.entries.get(name)?.descriptor ?? null;
  }

  defaultName(): string | null {
    if (this.deps.defaultOverride && this.entries.has(this.deps.defaultOverride)) {
      return this.deps.defaultOverride;
    }
    for (const e of this.entries.values()) {
      if (e.descriptor.transport === 'gemini') return e.descriptor.name;
    }
    for (const e of this.entries.values()) {
      if (e.descriptor.transport === 'anthropic') return e.descriptor.name;
    }
    for (const e of this.entries.values()) {
      if (e.descriptor.transport === 'ollama') return e.descriptor.name;
    }
    if (this.entries.has('fake:default')) return 'fake:default';
    return null;
  }
}
