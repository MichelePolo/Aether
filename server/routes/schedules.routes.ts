import { Router, type Request, type Response, type NextFunction } from 'express';
import { ValidationError, NotFoundError } from '@/server/lib/errors';
import { ScheduleCreateSchema, ScheduleUpdateSchema } from '@/server/domain/schedules/schedules.schema';
import { computeNextRunAt } from '@/server/domain/schedules/next-run';
import type { ScheduleStore } from '@/server/domain/schedules/schedules.store';
import type { Schedule } from '@/server/domain/schedules/schedules.types';

function asyncHandler(fn: (req: Request, res: Response, next: NextFunction) => Promise<void>) {
  return (req: Request, res: Response, next: NextFunction) => { fn(req, res, next).catch(next); };
}

/** Recompute next_run_at when a schedule is enabled (else null). */
function reschedule(store: ScheduleStore, s: Schedule): void {
  store.setNextRunAt(s.id, s.enabled ? computeNextRunAt(s.cadence, Date.now()) : null);
}

export function createScheduleRoutes(
  store: ScheduleStore,
  runner: { run(s: Schedule): Promise<void> },
): Router {
  const router = Router();

  router.get('/', asyncHandler(async (_req, res) => {
    res.json({ schedules: store.list() });
  }));

  router.post('/', asyncHandler(async (req, res) => {
    const parsed = ScheduleCreateSchema.safeParse(req.body);
    if (!parsed.success) throw new ValidationError('Invalid schedule', parsed.error);
    const s = store.create(parsed.data);
    reschedule(store, s);
    res.status(201).json(store.get(s.id));
  }));

  router.get('/:id', asyncHandler(async (req, res) => {
    const s = store.get(req.params.id);
    if (!s) throw new NotFoundError(`schedule ${req.params.id}`);
    res.json(s);
  }));

  router.put('/:id', asyncHandler(async (req, res) => {
    const parsed = ScheduleUpdateSchema.safeParse(req.body);
    if (!parsed.success) throw new ValidationError('Invalid schedule', parsed.error);
    if (!store.get(req.params.id)) throw new NotFoundError(`schedule ${req.params.id}`);
    const s = store.update(req.params.id, parsed.data);
    reschedule(store, s);
    res.json(store.get(s.id));
  }));

  router.delete('/:id', asyncHandler(async (req, res) => {
    store.delete(req.params.id);
    res.status(204).end();
  }));

  router.post('/:id/run', asyncHandler(async (req, res) => {
    const s = store.get(req.params.id);
    if (!s) throw new NotFoundError(`schedule ${req.params.id}`);
    void runner.run(s).catch(() => {}); // fire-and-record; don't block the response
    res.status(202).json({ ok: true });
  }));

  router.get('/:id/runs', asyncHandler(async (req, res) => {
    if (!store.get(req.params.id)) throw new NotFoundError(`schedule ${req.params.id}`);
    res.json({ runs: store.listRuns(req.params.id, 20) });
  }));

  return router;
}
