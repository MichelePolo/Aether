import { Router, type Request, type Response, type NextFunction } from 'express';
import { ValidationError } from '@/server/lib/errors';
import {
  SubAgentCreateInputSchema,
  SubAgentUpdateInputSchema,
} from '@/server/domain/subagents/subagents.schema';
import type { SubAgentsStore } from '@/server/domain/subagents/subagents.store';

function asyncHandler(fn: (req: Request, res: Response, next: NextFunction) => Promise<void>) {
  return (req: Request, res: Response, next: NextFunction) => {
    fn(req, res, next).catch(next);
  };
}

export function createSubAgentsRoutes(store: SubAgentsStore): Router {
  const router = Router();

  router.get(
    '/',
    asyncHandler(async (_req, res) => {
      res.json({ subAgents: await store.list() });
    }),
  );

  router.post(
    '/',
    asyncHandler(async (req, res) => {
      const parsed = SubAgentCreateInputSchema.safeParse(req.body);
      if (!parsed.success) throw new ValidationError('Invalid subagent payload', parsed.error);
      const meta = await store.create(parsed.data);
      res.status(201).json(meta);
    }),
  );

  router.get(
    '/:id',
    asyncHandler(async (req, res) => {
      const rec = await store.read(req.params.id);
      if (!rec) {
        res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Sub-agent not found' } });
        return;
      }
      res.json({ id: req.params.id, ...rec });
    }),
  );

  router.put(
    '/:id',
    asyncHandler(async (req, res) => {
      const parsed = SubAgentUpdateInputSchema.safeParse(req.body);
      if (!parsed.success) throw new ValidationError('Invalid subagent body', parsed.error);
      const meta = await store.update(req.params.id, parsed.data);
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
