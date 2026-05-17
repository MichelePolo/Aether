import path from 'node:path';
import express from 'express';
import { createServer as createViteServer } from 'vite';
import dotenv from 'dotenv';
import { createApp } from './app';
import { ContextStore } from './domain/context/context.store';

dotenv.config();

const DATA_DIR = process.env.AETHER_DATA_DIR ?? path.resolve(process.cwd(), 'data');
const PORT = parseInt(process.env.PORT ?? '3000', 10);

async function bootstrap() {
  const contextStore = new ContextStore(path.join(DATA_DIR, 'context.json'));

  const app = createApp({ contextStore });

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

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Aether server running on http://localhost:${PORT}`);
  });
}

bootstrap().catch((err) => {
  console.error('Bootstrap failed:', err);
  process.exit(1);
});
