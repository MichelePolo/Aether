import { Router, type Request, type Response, type NextFunction } from 'express';
import type { ProviderRegistry } from '@/server/domain/providers/registry';
import type { AuthStatusService } from '@/server/domain/providers/auth-status';
import type {
  AuthStatusReport,
  ProviderTransport,
  TransportStatus,
} from '@/server/domain/providers/auth-status.types';

function asyncHandler(fn: (req: Request, res: Response, next: NextFunction) => Promise<void>) {
  return (req: Request, res: Response, next: NextFunction) => {
    fn(req, res, next).catch(next);
  };
}

const VALID_TRANSPORTS: readonly ProviderTransport[] = ['anthropic', 'openai', 'gemini', 'ollama'];

export function createProvidersRoutes(
  registry: ProviderRegistry,
  authStatusService?: AuthStatusService,
): Router {
  const router = Router();

  // last-known report cached for merge on targeted refresh
  let lastReport: AuthStatusReport | null = null;

  router.get(
    '/',
    asyncHandler(async (_req, res) => {
      res.json({ providers: registry.list() });
    }),
  );

  router.post(
    '/refresh',
    asyncHandler(async (_req, res) => {
      await registry.refresh();
      res.json({ providers: registry.list() });
    }),
  );

  router.get(
    '/default',
    asyncHandler(async (_req, res) => {
      const name = registry.defaultName();
      res.json({ name });
    }),
  );

  router.get(
    '/auth-status',
    asyncHandler(async (_req, res) => {
      if (!authStatusService) {
        res.status(503).json({ error: { code: 'NO_AUTH_STATUS', message: 'Auth status service not configured' } });
        return;
      }
      const report = await authStatusService.probe();
      lastReport = report;
      res.json(report);
    }),
  );

  router.post(
    '/auth-status/refresh',
    asyncHandler(async (req, res) => {
      if (!authStatusService) {
        res.status(503).json({ error: { code: 'NO_AUTH_STATUS', message: 'Auth status service not configured' } });
        return;
      }
      const qt = req.query.transport;
      const transport = typeof qt === 'string' ? qt : undefined;
      const filter =
        transport && VALID_TRANSPORTS.includes(transport as ProviderTransport)
          ? [transport as ProviderTransport]
          : undefined;
      const fresh = await authStatusService.probe(filter);
      const merged = mergeReport(lastReport, fresh);
      lastReport = merged;
      res.json(merged);
    }),
  );

  return router;
}

function mergeReport(prior: AuthStatusReport | null, fresh: AuthStatusReport): AuthStatusReport {
  if (!prior) return fresh;
  const byTransport = new Map<string, TransportStatus>();
  for (const s of prior.statuses) byTransport.set(s.transport, s);
  for (const s of fresh.statuses) byTransport.set(s.transport, s);
  return {
    checkedAt: fresh.checkedAt,
    statuses: VALID_TRANSPORTS
      .map((t) => byTransport.get(t))
      .filter((s): s is TransportStatus => Boolean(s)),
  };
}
