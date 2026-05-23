import { Router, type Request, type Response, type NextFunction } from 'express';
import type { HistoryStore } from '@/server/domain/history/history.store';

function asyncHandler(fn: (req: Request, res: Response, next: NextFunction) => Promise<void>) {
  return (req: Request, res: Response, next: NextFunction) => {
    fn(req, res, next).catch(next);
  };
}

export function createAttachmentsRoutes(store: HistoryStore): Router {
  const router = Router();
  router.get(
    '/:id',
    asyncHandler(async (req, res) => {
      const row = await store.getAttachmentBytes(req.params.id);
      if (!row) {
        res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Attachment not found' } });
        return;
      }
      res.setHeader('Content-Type', row.mime);
      res.setHeader('Content-Disposition', 'inline');
      res.send(row.content);
    }),
  );
  return router;
}
