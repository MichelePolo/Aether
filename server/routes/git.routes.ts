import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { ValidationError } from '@/server/lib/errors';
import type { GitService } from '@/server/domain/git/git.service';

function asyncHandler(fn: (req: Request, res: Response, next: NextFunction) => Promise<void>) {
  return (req: Request, res: Response, next: NextFunction) => {
    fn(req, res, next).catch(next);
  };
}

const StatusQuery = z.object({ workspaceId: z.string().min(1) });
const LogQuery = z.object({
  workspaceId: z.string().min(1),
  maxCount: z.coerce.number().int().min(1).max(2000).optional(),
});
const DiffQuery = z.object({
  workspaceId: z.string().min(1),
  hash: z.string().min(1),
  path: z.string().min(1),
  oldPath: z.string().min(1).optional(),
});

export function createGitRoutes(svc: GitService): Router {
  const router = Router();

  router.get(
    '/status',
    asyncHandler(async (req, res) => {
      const parsed = StatusQuery.safeParse(req.query);
      if (!parsed.success) throw new ValidationError('Invalid query', parsed.error);
      res.json(await svc.status(parsed.data.workspaceId));
    }),
  );

  router.get(
    '/log',
    asyncHandler(async (req, res) => {
      const parsed = LogQuery.safeParse(req.query);
      if (!parsed.success) throw new ValidationError('Invalid query', parsed.error);
      const { workspaceId, maxCount } = parsed.data;
      res.json(await svc.log(workspaceId, maxCount ? { maxCount } : undefined));
    }),
  );

  router.get(
    '/diff',
    asyncHandler(async (req, res) => {
      const parsed = DiffQuery.safeParse(req.query);
      if (!parsed.success) throw new ValidationError('Invalid query', parsed.error);
      const { workspaceId, hash, path, oldPath } = parsed.data;
      const { unified } = await svc.diff(workspaceId, { hash, path, oldPath });
      res.type('text/plain').send(unified);
    }),
  );

  return router;
}
