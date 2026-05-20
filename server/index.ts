import path from 'node:path';
import express from 'express';
import { createServer as createViteServer } from 'vite';
import dotenv from 'dotenv';
import { createApp } from './app';
import { loadConfig } from './config';
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

dotenv.config();

async function bootstrap() {
  const cfg = loadConfig();

  const contextStore = new ContextStore(path.join(cfg.dataDir, 'context.json'));
  const historyStore = new HistoryStore(path.join(cfg.dataDir, 'sessions.json'));
  const profilesStore = new ProfilesStore(path.join(cfg.dataDir, 'profiles.json'));
  const subAgentsStore = new SubAgentsStore(path.join(cfg.dataDir, 'subagents.json'));

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

  const providers = new ProviderRegistry({
    ollamaHost: process.env.OLLAMA_HOST ?? 'http://localhost:11434',
    geminiApiKey: cfg.geminiApiKey || undefined,
    anthropicAuth: 'none',
    fakeProvider,
    geminiBuilder: (model) => new GeminiProvider({ apiKey: cfg.geminiApiKey, model }),
    ollamaBuilder: (model) =>
      new OllamaProvider({
        host: process.env.OLLAMA_HOST ?? 'http://localhost:11434',
        model,
      }),
    anthropicBuilder: () => {
      throw new Error('Anthropic builder not wired yet (slice 11 E2+)');
    },
    defaultOverride:
      process.env.AETHER_DEFAULT_PROVIDER ||
      (cfg.fakeProvider ? 'fake:default' : undefined),
  });

  await providers.refresh();

  const dispatcher = new DispatchService({ providers, historyStore, contextStore, subAgentsStore, mcpRegistry });

  const app = createApp({ contextStore, historyStore, dispatcher, profilesStore, subAgentsStore, mcpRegistry, providers });

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
