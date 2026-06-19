import { Router, type Request, type Response, type NextFunction } from 'express';
import { createSseEmitter } from '@/server/lib/sse';
import { ValidationError } from '@/server/lib/errors';
import {
  SwarmCreateInputSchema,
  SwarmUpdateInputSchema,
  SwarmRunInputSchema,
  SwarmDecisionSchema,
} from '@/server/domain/swarms/swarm.schema';
import type { SwarmStore } from '@/server/domain/swarms/swarm.store';
import type { SwarmApprovalRegistry } from '@/server/domain/swarms/swarm.approval';
import { runSwarm, type SwarmOrchestratorDeps } from '@/server/domain/swarms/swarm.orchestrator';
import type { WorkspacesStore } from '@/server/domain/workspaces/workspaces.store';

function asyncHandler(fn: (req: Request, res: Response, next: NextFunction) => Promise<void>) {
  return (req: Request, res: Response, next: NextFunction) => {
    fn(req, res, next).catch(next);
  };
}

function validateWorkspaceIds(
  workspacesStore: WorkspacesStore | undefined,
  ids: Array<string | null | undefined>,
): void {
  if (!workspacesStore) return;
  for (const id of ids) {
    // null means "clear" — skip validation; only non-empty strings are checked.
    if (id && !workspacesStore.get(id)) {
      throw new ValidationError(`Unknown workspaceId: ${id}`);
    }
  }
}

export function createSwarmRoutes(
  store: SwarmStore,
  orchestratorDeps: SwarmOrchestratorDeps,
  approvals: SwarmApprovalRegistry,
  workspacesStore?: WorkspacesStore,
): Router {
  const router = Router();

  router.get('/', asyncHandler(async (_req, res) => {
    res.json({ swarms: await store.list() });
  }));

  router.post('/', asyncHandler(async (req, res) => {
    const parsed = SwarmCreateInputSchema.safeParse(req.body);
    if (!parsed.success) throw new ValidationError('Invalid swarm payload', parsed.error);
    validateWorkspaceIds(workspacesStore, [
      parsed.data.workspaceId,
      ...parsed.data.steps.map((s) => s.workspaceId),
    ]);
    res.status(201).json(await store.create(parsed.data));
  }));

  // NOTE: keep `/decision` registered BEFORE the `/:id` routes — otherwise the
  // `:id` wildcard would swallow `POST /decision`.
  router.post('/decision', asyncHandler(async (req, res) => {
    const parsed = SwarmDecisionSchema.safeParse(req.body);
    if (!parsed.success) throw new ValidationError('Invalid decision', parsed.error);
    approvals.resolveDecision(parsed.data.approvalId, parsed.data.action);
    res.json({ ok: true });
  }));

  router.get('/:id', asyncHandler(async (req, res) => {
    const rec = await store.read(req.params.id);
    if (!rec) {
      res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Swarm not found' } });
      return;
    }
    res.json(rec);
  }));

  router.put('/:id', asyncHandler(async (req, res) => {
    const parsed = SwarmUpdateInputSchema.safeParse(req.body);
    if (!parsed.success) throw new ValidationError('Invalid swarm body', parsed.error);
    validateWorkspaceIds(workspacesStore, [
      parsed.data.workspaceId,
      ...(parsed.data.steps ?? []).map((s) => s.workspaceId),
    ]);
    res.json(await store.update(req.params.id, parsed.data));
  }));

  router.delete('/:id', asyncHandler(async (req, res) => {
    await store.delete(req.params.id);
    res.status(204).end();
  }));

  router.post('/:id/run', async (req: Request, res: Response) => {
    const parsed = SwarmRunInputSchema.safeParse(req.body);
    const sse = createSseEmitter(res);
    if (!parsed.success) {
      sse.event('swarm_error', { message: 'Invalid run input' });
      sse.event('swarm_done', { status: 'error' });
      sse.end();
      return;
    }
    const controller = new AbortController();
    res.on('close', () => {
      if (!res.writableEnded) controller.abort();
    });
    try {
      await runSwarm(
        orchestratorDeps,
        { swarmId: req.params.id, input: parsed.data.input },
        sse,
        controller.signal,
      );
    } catch (e) {
      sse.event('swarm_error', { message: e instanceof Error ? e.message : 'Internal error' });
      sse.event('swarm_done', { status: 'error' });
      sse.end();
    }
  });

  return router;
}
