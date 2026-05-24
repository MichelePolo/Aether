import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { ValidationError } from '@/server/lib/errors';
import type { McpRegistry } from '@/server/domain/mcp/registry';
import type { DispatchService } from '@/server/domain/dispatch/dispatch.service';

function asyncHandler(fn: (req: Request, res: Response, next: NextFunction) => Promise<void>) {
  return (req: Request, res: Response, next: NextFunction) => {
    fn(req, res, next).catch(next);
  };
}

const PolicyBody = z.object({
  autoApprove: z.boolean().optional(),
  category: z.enum(['safe', 'dangerous', 'external']).optional(),
}).refine(
  (v) => v.autoApprove !== undefined || v.category !== undefined,
  { message: 'must provide at least one of autoApprove or category' },
);
const DecisionBody = z.object({
  callId: z.string().min(1),
  action: z.enum(['approve', 'reject']),
});

export function createMcpRoutes(registry: McpRegistry, dispatcher?: DispatchService): Router {
  const router = Router();

  router.post(
    '/:id/connect',
    asyncHandler(async (req, res) => {
      try {
        const r = await registry.connect(req.params.id);
        res.json({ state: registry.stateOf(req.params.id).state, tools: r.tools });
      } catch (e) {
        if (e instanceof Error && /Unknown MCP server/.test(e.message)) {
          res.status(404).json({ error: { code: 'NOT_FOUND', message: e.message } });
          return;
        }
        throw e;
      }
    }),
  );

  router.post(
    '/:id/refresh-tools',
    asyncHandler(async (req, res) => {
      try {
        const tools = await registry.refreshTools(req.params.id);
        res.json({ tools });
      } catch (e) {
        if (e instanceof Error && /is not connected/.test(e.message)) {
          res.status(409).json({ error: { code: 'NOT_ONLINE', message: e.message } });
          return;
        }
        throw e;
      }
    }),
  );

  router.post(
    '/cancel-call',
    asyncHandler(async (req, res) => {
      const callId = (req.body as { callId?: string })?.callId;
      if (typeof callId !== 'string' || callId.length === 0) {
        throw new ValidationError('callId required', null);
      }
      if (dispatcher) {
        const ctrl = dispatcher.getInFlightController(callId);
        if (ctrl) ctrl.abort();
      }
      res.status(204).end();
    }),
  );

  router.post(
    '/:id/disconnect',
    asyncHandler(async (req, res) => {
      await registry.disconnect(req.params.id);
      res.status(204).end();
    }),
  );

  router.get(
    '/tools',
    asyncHandler(async (_req, res) => {
      res.json({ tools: registry.listLiveTools() });
    }),
  );

  router.patch(
    '/:id/tools/:name',
    asyncHandler(async (req, res) => {
      const parsed = PolicyBody.safeParse(req.body);
      if (!parsed.success) throw new ValidationError('Invalid policy body', parsed.error);
      await registry.setToolPolicy(req.params.id, req.params.name, parsed.data);
      res.json(parsed.data);
    }),
  );

  router.post(
    '/decision',
    asyncHandler(async (req, res) => {
      const parsed = DecisionBody.safeParse(req.body);
      if (!parsed.success) throw new ValidationError('Invalid decision body', parsed.error);
      registry.resolveDecision(parsed.data.callId, parsed.data.action);
      res.status(204).end();
    }),
  );

  router.get(
    '/state',
    asyncHandler(async (_req, res) => {
      // We need the list of server ids known to the context. Reuse the registry's
      // contextStore reference via a temporary cast — the cleaner path (a public
      // method on the registry) is acceptable too. Implementer may refactor.
      const r = registry as unknown as {
        contextStore: { read(): Promise<{ mcpServers: { id: string }[] }> };
      };
      const ctx = await r.contextStore.read();
      const servers = ctx.mcpServers.map((s) => ({ id: s.id, ...registry.stateOf(s.id) }));
      res.json({ servers });
    }),
  );

  return router;
}
