import { Router, type Request, type Response } from 'express';
import type { SearchService } from '@/server/domain/search/search.service';

export function createSearchRoutes(svc: SearchService): Router {
  const router = Router();

  router.get('/', async (req: Request, res: Response) => {
    if (req.query.q === undefined) {
      res.status(400).json({
        error: { code: 'MISSING_QUERY', message: 'Query parameter q is required' },
      });
      return;
    }

    const q = typeof req.query.q === 'string' ? req.query.q : '';

    let limit = 100;
    if (typeof req.query.limit === 'string') {
      const parsed = parseInt(req.query.limit, 10);
      if (Number.isFinite(parsed)) {
        limit = Math.min(Math.max(parsed, 1), 500);
      }
    }

    const results = await svc.search(q, { limit });
    res.json({ results });
  });

  return router;
}
