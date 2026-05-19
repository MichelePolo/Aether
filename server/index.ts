import path from 'node:path';
import express from 'express';
import { createServer as createViteServer } from 'vite';
import dotenv from 'dotenv';
import { createApp } from './app';
import { loadConfig } from './config';
import { ContextStore } from './domain/context/context.store';
import { HistoryStore } from './domain/history/history.store';
import { ProfilesStore } from './domain/profiles/profiles.store';
import { DispatchService } from './domain/dispatch/dispatch.service';
import { FakeProvider } from './domain/dispatch/providers/fake.provider';
import { GeminiProvider } from './domain/dispatch/providers/gemini.provider';
import type { AIProvider } from './domain/dispatch/providers/provider.types';

dotenv.config();

async function bootstrap() {
  const cfg = loadConfig();

  const contextStore = new ContextStore(path.join(cfg.dataDir, 'context.json'));
  const historyStore = new HistoryStore(path.join(cfg.dataDir, 'sessions.json'));
  const profilesStore = new ProfilesStore(path.join(cfg.dataDir, 'profiles.json'));

  let provider: AIProvider;
  if (cfg.fakeProvider) {
    provider = new FakeProvider({
      chunks: ['pong'],
      thoughtChunks: ['thinking about it…'],
      chunkDelayMs: 50,
      model: 'fake-1',
    });
    console.log('[aether] Using FakeProvider (AETHER_FAKE_PROVIDER=1)');
  } else {
    if (!cfg.geminiApiKey) {
      console.warn('[aether] GEMINI_API_KEY not set — falling back to FakeProvider');
      provider = new FakeProvider({ chunks: ['pong'], thoughtChunks: ['thinking about it…'], chunkDelayMs: 50 });
    } else {
      provider = new GeminiProvider({ apiKey: cfg.geminiApiKey });
    }
  }

  const dispatcher = new DispatchService({ provider, historyStore, contextStore });

  const app = createApp({ contextStore, historyStore, dispatcher, profilesStore });

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
