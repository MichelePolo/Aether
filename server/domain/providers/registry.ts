import type { AIProvider, ProviderCapabilities } from '@/server/domain/dispatch/providers/provider.types';
import { discoverOllama, discoverOpenAICompat, geminiHardcodedModels, anthropicHardcodedModels, openAIHardcodedModels, discoverAnthropic } from './discovery';
import type { ResolvedOpenAICompatEndpoint } from './openai-endpoints.types';

export type ProviderTransport = 'fake' | 'gemini' | 'ollama' | 'anthropic' | 'openai' | 'openai-compat' | 'codex';

export interface ProviderDescriptor {
  name: string;
  transport: ProviderTransport;
  model: string;
  capabilities: ProviderCapabilities;
  displayName: string;
}

export interface RegistryIssue {
  transport: ProviderTransport;
  reason: string;
}

export interface ProviderRegistryDeps {
  resolveKey: (transport: 'gemini' | 'openai' | 'anthropic') => string | undefined;
  detectAnthropicAuth: () => Promise<'oauth' | 'apikey' | 'none'>;
  fakeProvider: AIProvider;
  geminiBuilder: (model: string) => AIProvider;
  listOllamaEndpoints: () => Array<{ id: string; label: string; baseUrl: string; token?: string; headers?: Record<string, string> }>;
  ollamaBuilder: (baseUrl: string, model: string, token?: string, headers?: Record<string, string>) => AIProvider;
  anthropicBuilder: (model: string) => AIProvider;
  openAIBuilder: (model: string) => AIProvider;
  listOpenAICompatEndpoints: () => ResolvedOpenAICompatEndpoint[];
  openAICompatBuilder: (baseUrl: string, model: string, headers?: Record<string, string>) => AIProvider;
  /** Codex CLI (ChatGPT-subscription auth, local-only detection). All three
   *  optional so minimal test registries need no codex wiring. */
  detectCodexAuth?: () => Promise<'oauth' | 'none'>;
  codexModels?: () => string[];
  codexBuilder?: (model: string) => AIProvider;
  defaultOverride?: string;
}

// LiteLLM proxies answer `/v1/models` with 200 and a fake model literally named
// "no-default-models" when the key has no models assigned. Treating it as a
// real catalog entry would shadow the endpoint's pinned model.
const PLACEHOLDER_MODEL_IDS = new Set(['no-default-models']);

function displayNameFor(transport: ProviderTransport, model: string, label?: string): string {
  if (transport === 'fake') return 'Fake (default)';
  if (transport === 'gemini') return `Gemini / ${model}`;
  if (transport === 'anthropic') return `Anthropic / ${model}`;
  if (transport === 'openai') return `OpenAI / ${model}`;
  if (transport === 'openai-compat') return label ? `${label} / ${model}` : `OpenAI Compat / ${model}`;
  if (transport === 'codex') return `Codex CLI / ${model}`;
  return `Ollama / ${model}`;
}

export class ProviderRegistry {
  private entries = new Map<string, { provider: AIProvider; descriptor: ProviderDescriptor }>();
  private issuesList: RegistryIssue[] = [];

  constructor(private readonly deps: ProviderRegistryDeps) {}

  async refresh(): Promise<void> {
    const next = new Map<string, { provider: AIProvider; descriptor: ProviderDescriptor }>();
    const nextIssues: RegistryIssue[] = [];

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
    if (this.deps.resolveKey('gemini')) {
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
    const auth = await this.deps.detectAnthropicAuth();
    if (auth === 'apikey') {
      const key = this.deps.resolveKey('anthropic');
      const { models, error } = key
        ? await discoverAnthropic(key)
        : { models: [] as string[], error: 'no api key' };
      if (models.length > 0) {
        for (const model of models) {
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
      } else {
        nextIssues.push({ transport: 'anthropic', reason: error ?? 'no models' });
      }
    } else if (auth === 'oauth') {
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

    // OpenAI
    if (this.deps.resolveKey('openai')) {
      for (const model of openAIHardcodedModels()) {
        const provider = this.deps.openAIBuilder(model);
        next.set(`openai:${model}`, {
          provider,
          descriptor: {
            name: `openai:${model}`,
            transport: 'openai',
            model,
            capabilities: provider.capabilities,
            displayName: displayNameFor('openai', model),
          },
        });
      }
    }

    // Codex CLI — subscription auth handled entirely by the CLI itself.
    if (this.deps.detectCodexAuth && this.deps.codexBuilder) {
      const codexAuth = await this.deps.detectCodexAuth();
      if (codexAuth === 'oauth') {
        for (const model of this.deps.codexModels?.() ?? []) {
          const provider = this.deps.codexBuilder(model);
          next.set(`codex:${model}`, {
            provider,
            descriptor: {
              name: `codex:${model}`,
              transport: 'codex',
              model,
              capabilities: provider.capabilities,
              displayName: displayNameFor('codex', model),
            },
          });
        }
      }
    }

    // Ollama (per-endpoint discovery). Local endpoint keeps `ollama:<model>`
    // for backward-compatibility with sessions saved before multi-endpoint.
    const ollamaEndpoints = this.deps.listOllamaEndpoints();
    const discovered = await Promise.all(
      ollamaEndpoints.map(async (ep) => ({ ep, tags: await discoverOllama(ep.baseUrl, ep.token, ep.headers) })),
    );
    for (const { ep, tags } of discovered) {
      for (const tag of tags) {
        const provider = this.deps.ollamaBuilder(ep.baseUrl, tag, ep.token, ep.headers);
        const name = ep.id === 'local' ? `ollama:${tag}` : `ollama:${ep.id}:${tag}`;
        next.set(name, {
          provider,
          descriptor: {
            name,
            transport: 'ollama',
            model: tag,
            capabilities: provider.capabilities,
            displayName: `Ollama (${ep.label}) / ${tag}`,
          },
        });
      }
    }

    // OpenAI-compat (per-endpoint discovery). Never auto-default; manually selected only.
    const openAICompatEndpoints = this.deps.listOpenAICompatEndpoints();
    const discoveredCompat = await Promise.all(
      openAICompatEndpoints.map(async (ep) => ({
        ep,
        models: await discoverOpenAICompat(ep.baseUrl, ep.headers),
      })),
    );
    for (const { ep, models } of discoveredCompat) {
      const placeholderOnly = models.length > 0 && models.every((m) => PLACEHOLDER_MODEL_IDS.has(m));
      const discoveredModels = models.filter((m) => !PLACEHOLDER_MODEL_IDS.has(m));
      // The pinned model always wins (listed first → endpoint default), even
      // when discovery succeeds: gateways can return catalogs that omit models
      // the key is actually allowed to call.
      const tags = [...new Set([...(ep.model ? [ep.model] : []), ...discoveredModels])];
      if (tags.length === 0) {
        // Discovery found nothing and no model is pinned, so this endpoint
        // contributes zero entries. Surface it instead of vanishing silently.
        nextIssues.push({
          transport: 'openai-compat',
          reason: placeholderOnly
            ? `${ep.label}: the gateway reports no models assigned to this key — ask the gateway admin, or set the endpoint's model field`
            : `${ep.label}: no models discovered — set the endpoint's model field`,
        });
      }
      for (const model of tags) {
        const provider = this.deps.openAICompatBuilder(ep.baseUrl, model, ep.headers);
        const name = `openai-compat:${ep.id}:${model}`;
        next.set(name, {
          provider,
          descriptor: {
            name,
            transport: 'openai-compat',
            model,
            capabilities: provider.capabilities,
            displayName: displayNameFor('openai-compat', model, ep.label),
          },
        });
      }
    }

    this.entries = next;
    this.issuesList = nextIssues;
  }

  get(name: string): AIProvider | null {
    return this.entries.get(name)?.provider ?? null;
  }

  list(): ProviderDescriptor[] {
    return [...this.entries.values()].map((e) => e.descriptor);
  }

  issues(): RegistryIssue[] {
    return [...this.issuesList];
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
      if (e.descriptor.transport === 'openai') return e.descriptor.name;
    }
    for (const e of this.entries.values()) {
      if (e.descriptor.transport === 'anthropic') return e.descriptor.name;
    }
    for (const e of this.entries.values()) {
      if (e.descriptor.transport === 'ollama') return e.descriptor.name;
    }
    // Codex last among real providers: it never displaces an existing default,
    // but beats the fake fallback when it is the only transport configured.
    for (const e of this.entries.values()) {
      if (e.descriptor.transport === 'codex') return e.descriptor.name;
    }
    if (this.entries.has('fake:default')) return 'fake:default';
    return null;
  }
}
