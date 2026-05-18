import { Router } from 'express';
import type { HistoryStore } from '@/server/domain/history/history.store';

export function createHistoryRoutes(store: HistoryStore): Router {
  const router = Router();

  router.get('/default', async (_req, res, next) => {
    try {
      const messages = await store.read();
      res.json({ messages });
    } catch (e) {
      next(e);
    }
  });

  router.delete('/default', async (_req, res, next) => {
    try {
      await store.reset();
      res.status(204).end();
    } catch (e) {
      next(e);
    }
  });

  return router;
}
