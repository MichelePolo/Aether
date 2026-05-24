import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import type { HistoryStore } from '@/server/domain/history/history.store';
import type { WorkspacesStore } from '@/server/domain/workspaces/workspaces.store';
import { ValidationError } from '@/server/lib/errors';

const PatchBody = z
  .object({
    title: z.string().optional(),
    providerName: z.string().optional(),
    workspaceId: z.union([z.string(), z.null()]).optional(),
  })
  .refine(
    (b) => b.title !== undefined || b.providerName !== undefined || b.workspaceId !== undefined,
    { message: 'At least one field is required' },
  );

function asyncHandler(fn: (req: Request, res: Response, next: NextFunction) => Promise<void>) {
  return (req: Request, res: Response, next: NextFunction) => {
    fn(req, res, next).catch(next);
  };
}

export function createHistoryRoutes(store: HistoryStore, workspaces?: WorkspacesStore): Router {
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
      const parsed = PatchBody.safeParse(req.body);
      if (!parsed.success) throw new ValidationError('Invalid patch payload', parsed.error);
      if (parsed.data.title !== undefined) {
        await store.rename(req.params.id, parsed.data.title);
      }
      if (parsed.data.providerName !== undefined) {
        await store.setProviderName(req.params.id, parsed.data.providerName);
      }
      if (parsed.data.workspaceId !== undefined) {
        if (parsed.data.workspaceId !== null && workspaces && !workspaces.get(parsed.data.workspaceId)) {
          throw new ValidationError(`Unknown workspaceId: ${parsed.data.workspaceId}`);
        }
        await store.setSessionWorkspace(req.params.id, parsed.data.workspaceId);
      }
      const list = await store.listSessions();
      const meta = list.find((m) => m.id === req.params.id);
      if (!meta) {
        res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Session not found' } });
        return;
      }
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
