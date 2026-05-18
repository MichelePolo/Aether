import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import type { HistoryStore } from '@/server/domain/history/history.store';
import { ValidationError } from '@/server/lib/errors';

const RenameBody = z.object({ title: z.string() });

function asyncHandler(fn: (req: Request, res: Response, next: NextFunction) => Promise<void>) {
  return (req: Request, res: Response, next: NextFunction) => {
    fn(req, res, next).catch(next);
  };
}

export function createHistoryRoutes(store: HistoryStore): Router {
  const router = Router();

  router.get(
    '/',
    asyncHandler(async (_req, res) => {
      res.json({ sessions: await store.listSessions() });
    }),
  );

  router.post(
    '/',
    asyncHandler(async (_req, res) => {
      const meta = await store.createEmpty();
      res.status(201).json(meta);
    }),
  );

  router.get(
    '/:id',
    asyncHandler(async (req, res) => {
      const msgs = await store.read(req.params.id);
      if (!msgs) {
        res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Session not found' } });
        return;
      }
      res.json({ messages: msgs });
    }),
  );

  router.patch(
    '/:id',
    asyncHandler(async (req, res) => {
      const parsed = RenameBody.safeParse(req.body);
      if (!parsed.success) throw new ValidationError('Invalid rename payload', parsed.error);
      const meta = await store.rename(req.params.id, parsed.data.title);
      res.json(meta);
    }),
  );

  router.delete(
    '/:id',
    asyncHandler(async (req, res) => {
      await store.delete(req.params.id);
      res.status(204).end();
    }),
  );

  return router;
}
