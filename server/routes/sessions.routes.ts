import express, { Router, type Request, type Response, type NextFunction } from 'express';
import type { HistoryStore } from '@/server/domain/history/history.store';
import { exportEnvelopeSchema, slugifyFilename } from '@/server/domain/history/history.export';
import { ValidationError } from '@/server/lib/errors';

function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<void>,
) {
  return (req: Request, res: Response, next: NextFunction) => {
    fn(req, res, next).catch(next);
  };
}

export function createSessionsRoutes(store: HistoryStore): Router {
  const router = Router();

  router.get(
    '/:id/export',
    asyncHandler(async (req, res) => {
      const env = await store.exportSession(req.params.id);
      if (!env) {
        res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Session not found' } });
        return;
      }
      const filename = slugifyFilename(env.session.title, env.exportedAt);
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.send(JSON.stringify(env));
    }),
  );

  router.post(
    '/import',
    express.json({ limit: '10mb' }),
    asyncHandler(async (req, res) => {
      const parsed = exportEnvelopeSchema.safeParse(req.body);
      if (!parsed.success) {
        throw new ValidationError(
          `Invalid import payload: ${parsed.error.issues
            .map((i) => `${i.path.join('.')}: ${i.message}`)
            .join('; ')}`,
          parsed.error,
        );
      }
      const meta = await store.importSession(parsed.data);
      res.status(201).json(meta);
    }),
  );

  router.post(
    '/:id/fork',
    express.json({ limit: '1mb' }),
    asyncHandler(async (req, res) => {
      const fromMessageId = req.body?.fromMessageId;
      if (typeof fromMessageId !== 'string' || fromMessageId.length === 0) {
        throw new ValidationError('fromMessageId required');
      }
      const meta = await store.forkSession(req.params.id, fromMessageId);
      res.status(201).json({ meta });
    }),
  );

  return router;
}
