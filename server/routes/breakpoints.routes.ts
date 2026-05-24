import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { ValidationError } from '@/server/lib/errors';
import type { BreakpointPolicyStore } from '@/server/domain/mcp/breakpoints/policy.store';
import type { PreviewService } from '@/server/domain/mcp/breakpoints/preview.service';
import { classifyTool } from '@/server/domain/mcp/breakpoints/classify';

function asyncHandler(fn: (req: Request, res: Response, next: NextFunction) => Promise<void>) {
  return (req: Request, res: Response, next: NextFunction) => {
    fn(req, res, next).catch(next);
  };
}

const CategoryParam = z.enum(['safe', 'dangerous', 'external']);
const ModeBody = z.object({ mode: z.enum(['auto', 'gate']) });
const PreviewBody = z.object({
  qualifiedName: z.string().min(1),
  args: z.record(z.string(), z.unknown()),
});

export interface BreakpointsRoutesDeps {
  policyStore: BreakpointPolicyStore;
  previewService: PreviewService;
}

export function createBreakpointsRoutes(deps: BreakpointsRoutesDeps): Router {
  const router = Router();

  router.get('/policy', (_req, res) => {
    res.json(deps.policyStore.read());
  });

  router.put(
    '/policy/:category',
    asyncHandler(async (req, res) => {
      const cat = CategoryParam.safeParse(req.params.category);
      if (!cat.success) throw new ValidationError('Invalid category', cat.error);
      const body = ModeBody.safeParse(req.body);
      if (!body.success) throw new ValidationError('Invalid mode', body.error);
      deps.policyStore.setCategory(cat.data, body.data.mode);
      res.json(deps.policyStore.read());
    }),
  );

  router.post(
    '/preview',
    asyncHandler(async (req, res) => {
      const parsed = PreviewBody.safeParse(req.body);
      if (!parsed.success) throw new ValidationError('Invalid preview body', parsed.error);
      const result = await deps.previewService.previewToolCall(parsed.data);
      res.json(result);
    }),
  );

  router.get(
    '/classify',
    asyncHandler(async (req, res) => {
      const qn = String(req.query.qualifiedName ?? '');
      if (!qn) throw new ValidationError('qualifiedName required');
      let args: Record<string, unknown> = {};
      const aj = req.query.argsJson;
      if (typeof aj === 'string' && aj.length > 0) {
        try {
          args = JSON.parse(aj) as Record<string, unknown>;
        } catch {
          throw new ValidationError('argsJson is not valid JSON');
        }
      }
      const result = classifyTool({ qualifiedName: qn, args });
      res.json(result);
    }),
  );

  return router;
}
