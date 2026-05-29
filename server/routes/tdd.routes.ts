import { Router, type Request, type Response } from 'express';
import { createSseEmitter } from '@/server/lib/sse';
import { TddRunInputSchema } from '@/server/domain/tdd/tdd.schema';
import { runTddLoop } from '@/server/domain/tdd/tdd.runner';
import type { TddRunnerDeps } from '@/server/domain/tdd/tdd.types';

export function createTddRoutes(deps: TddRunnerDeps): Router {
  const router = Router();

  router.post('/run', async (req: Request, res: Response) => {
    const sse = createSseEmitter(res);
    const parsed = TddRunInputSchema.safeParse(req.body);
    if (!parsed.success) {
      sse.event('tdd_error', { message: 'Invalid run input' });
      sse.event('tdd_done', { status: 'error' });
      sse.end();
      return;
    }
    const controller = new AbortController();
    res.on('close', () => {
      if (!res.writableEnded) controller.abort();
    });
    try {
      await runTddLoop(deps, parsed.data, sse, controller.signal);
    } catch (e) {
      sse.event('tdd_error', { message: e instanceof Error ? e.message : 'Internal error' });
      sse.event('tdd_done', { status: 'error' });
      sse.end();
    }
  });

  return router;
}
