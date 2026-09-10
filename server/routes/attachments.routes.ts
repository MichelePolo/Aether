import { asyncHandler } from '@/server/lib/async-handler';
import { IMAGE_MIMES } from '@/server/domain/dispatch/attachment.types';
import { Router } from 'express';
import type { HistoryStore } from '@/server/domain/history/history.store';

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
      const inline = IMAGE_MIMES.has(row.mime);
      res.setHeader('Content-Type', inline ? row.mime : 'application/octet-stream');
      res.setHeader('Content-Disposition', inline ? 'inline' : 'attachment');
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Content-Security-Policy', "sandbox; default-src 'none'");
      res.send(row.content);
    }),
  );
  return router;
}
