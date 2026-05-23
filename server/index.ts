import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { createServer as createViteServer } from 'vite';
import dotenv from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
import { createApp } from './app';
import { loadConfig } from './config';
import { openDatabase } from './db/database';
import { applyMigrations } from './db/migrate';
import { ContextStore } from './domain/context/context.store';
import { HistoryStore } from './domain/history/history.store';
import { ProfilesStore } from './domain/profiles/profiles.store';
import { SubAgentsStore } from './domain/subagents/subagents.store';
import { DispatchService } from './domain/dispatch/dispatch.service';
import { FakeProvider } from './domain/dispatch/providers/fake.provider';
import { GeminiProvider } from './domain/dispatch/providers/gemini.provider';
import { McpRegistry } from './domain/mcp/registry';
import { ProviderRegistry } from './domain/providers/registry';
import { OllamaProvider } from './domain/dispatch/providers/ollama.provider';
import { AnthropicProvider } from './domain/dispatch/providers/anthropic.provider';
import { OpenAIProvider } from './domain/dispatch/providers/openai.provider';
import { detectAnthropicAuth } from './lib/anthropic-auth';
import { SearchService } from './domain/search/search.service';
import { AuthStatusService } from './domain/providers/auth-status';
import { KeyVaultService } from './domain/providers/key-vault';
import { KeyResolver } from './domain/providers/key-resolver';

dotenv.config();

async function bootstrap() {
  const cfg = loadConfig();

  const db = openDatabase(path.join(cfg.dataDir, 'aether.sqlite'));
  const migrated = applyMigrations(db, path.join(__dirname, 'db', 'migrations'));
  if (migrated.applied.length > 0) {
    console.log(`[db] applied migrations: ${migrated.applied.join(', ')}`);
  }

  const contextStore = new ContextStore(db);
  const historyStore = new HistoryStore(db);
  const profilesStore = new ProfilesStore(db);
  const subAgentsStore = new SubAgentsStore(db);
  const searchService = new SearchService(db);

  const mcpRegistry = new McpRegistry(contextStore);

  const fakeProvider = new FakeProvider({
    chunks: ['pong'],
    thoughtChunks: ['thinking about it…'],
    chunkDelayMs: 50,
    model: 'fake-1',
  });

  if (cfg.fakeProvider) {
    console.log('[aether] Using FakeProvider (AETHER_FAKE_PROVIDER=1)');
  }

  const keyVault = new KeyVaultService(db);

  // Cold-start anthropic env priming: if vault has an anthropic key and env doesn't,
  // set process.env.ANTHROPIC_API_KEY BEFORE detectAnthropicAuth() runs so the SDK sees it.
  if (!process.env.ANTHROPIC_API_KEY) {
    const stored = keyVault.getKey('anthropic');
    if (stored) process.env.ANTHROPIC_API_KEY = stored;
  }

  const resolver = new KeyResolver({
    vault: keyVault,
    env: {
      ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
      OPENAI_API_KEY: cfg.openAIApiKey || undefined,
      GEMINI_API_KEY: cfg.geminiApiKey || undefined,
    },
  });

  const ollamaHost = process.env.OLLAMA_HOST ?? 'http://localhost:11434';

  const providers = new ProviderRegistry({
    ollamaHost,
    resolveKey: (t) => resolver.get(t),
    detectAnthropicAuth,
    fakeProvider,
    geminiBuilder: (model) => new GeminiProvider({ apiKey: resolver.get('gemini') ?? '', model }),
    ollamaBuilder: (model) => new OllamaProvider({ host: ollamaHost, model }),
    anthropicBuilder: (model) =>
      new AnthropicProvider({
        model: model as 'claude-opus-4-7' | 'claude-sonnet-4-6' | 'claude-haiku-4-5',
      }),
    openAIBuilder: (model) =>
      new OpenAIProvider({
        apiKey: resolver.get('openai') ?? '',
        model: model as 'gpt-5' | 'gpt-5-mini' | 'gpt-4.1' | 'o3',
      }),
    defaultOverride:
      process.env.AETHER_DEFAULT_PROVIDER ||
      (cfg.fakeProvider ? 'fake:default' : undefined),
  });

  await providers.refresh();

  const authStatusService = new AuthStatusService({
    detectAnthropicAuth,
    getOpenAIKey: () => resolver.get('openai'),
    getGeminiKey: () => resolver.get('gemini'),
    ollamaHost,
  });

  // Detect whether the claude CLI is present (for the info row label).
  // We re-use the existing detector — if it returns anything other than 'none', the CLI is reachable.
  const anthropicAuth = await detectAnthropicAuth();
  const anthropicCliPresent = anthropicAuth !== 'none';
  console.log(`[providers] anthropic: ${anthropicAuth}`);

  const buildInfoRowsCtx = { anthropicCliPresent, ollamaHost };

  const keyVaultHooks = {
    setAnthropicEnv: (key: string | null) => {
      if (key) process.env.ANTHROPIC_API_KEY = key;
      else delete process.env.ANTHROPIC_API_KEY;
    },
  };

  const dispatcher = new DispatchService({ providers, historyStore, contextStore, subAgentsStore, mcpRegistry });

  const app = createApp({
    contextStore,
    historyStore,
    dispatcher,
    profilesStore,
    subAgentsStore,
    mcpRegistry,
    providers,
    searchService,
    authStatusService,
    keyVault,
    keyVaultHooks,
    buildInfoRowsCtx,
  });

  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(cfg.port, '0.0.0.0', () => {
    console.log(`Aether server running on http://localhost:${cfg.port}`);
  });
}

bootstrap().catch((err) => {
  console.error('Bootstrap failed:', err);
  process.exit(1);
});
