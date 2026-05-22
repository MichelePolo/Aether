import express, { type Express, type NextFunction, type Request, type Response } from 'express';
import { isAppError } from './lib/errors';
import type { ContextStore } from './domain/context/context.store';
import type { HistoryStore } from './domain/history/history.store';
import type { DispatchService } from './domain/dispatch/dispatch.service';
import type { ProfilesStore } from './domain/profiles/profiles.store';
import type { SubAgentsStore } from './domain/subagents/subagents.store';
import { createContextRoutes } from './routes/context.routes';
import { createDispatchRoutes } from './routes/dispatch.routes';
import { createHistoryRoutes } from './routes/history.routes';
import { createProfilesRoutes } from './routes/profiles.routes';
import { createSubAgentsRoutes } from './routes/subagents.routes';
import { createMcpRoutes } from '@/server/routes/mcp.routes';
import type { McpRegistry } from '@/server/domain/mcp/registry';
import { createProvidersRoutes } from '@/server/routes/providers.routes';
import type { ProviderRegistry } from '@/server/domain/providers/registry';
import { createSearchRoutes } from '@/server/routes/search.routes';
import type { SearchService } from '@/server/domain/search/search.service';
import { createSessionsRoutes } from './routes/sessions.routes';

export interface AppDeps {
  contextStore?: ContextStore;
  historyStore?: HistoryStore;
  dispatcher?: DispatchService;
  profilesStore?: ProfilesStore;
  subAgentsStore?: SubAgentsStore;
  mcpRegistry?: McpRegistry;
  providers?: ProviderRegistry;
  searchService?: SearchService;
}

// In Express l'error middleware DEVE essere registrato dopo le route per
// catturare gli errori che esse generano. `extraRoutes` permette ai test
// (e in futuro a chi compone più moduli) di registrare route prima dell'error
// handler, evitando di riscrivere l'intera factory.
export function createApp(
  deps: AppDeps,
  extraRoutes?: (app: Express) => void,
): Express {
  const app = express();

  // Sessions io router mounted BEFORE global json parser so its import
  // route can install its own 10 MB parser. Other /api/sessions routes
  // (list/create/read/patch/delete) live in history.routes and use the
  // 1 MB parser below.
  if (deps.historyStore) {
    app.use('/api/sessions', createSessionsRoutes(deps.historyStore));
  }

  app.use(express.json({ limit: '1mb' }));

  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok' });
  });

  if (deps.contextStore) {
    app.use('/api/context', createContextRoutes(deps.contextStore));
  }

  if (deps.dispatcher) {
    app.use('/api/ai/dispatch', createDispatchRoutes(deps.dispatcher));
  } else {
    app.post('/api/ai/dispatch', (_req, res) => {
      res.status(503).json({ error: { code: 'NO_DISPATCHER', message: 'Dispatcher not configured' } });
    });
  }

  if (deps.historyStore) {
    app.use('/api/sessions', createHistoryRoutes(deps.historyStore));
  }

  if (deps.profilesStore) {
    app.use('/api/profiles', createProfilesRoutes(deps.profilesStore));
  }

  if (deps.subAgentsStore) {
    app.use('/api/subagents', createSubAgentsRoutes(deps.subAgentsStore));
  }

  if (deps.mcpRegistry) {
    app.use('/api/mcp', createMcpRoutes(deps.mcpRegistry, deps.dispatcher));
  }

  if (deps.providers) {
    app.use('/api/providers', createProvidersRoutes(deps.providers));
  }

  if (deps.searchService) {
    app.use('/api/search', createSearchRoutes(deps.searchService));
  }

  extraRoutes?.(app);

  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (isAppError(err)) {
      res.status(err.status).json({ error: { code: err.code, message: err.message } });
      return;
    }
    // Express HTTP errors (e.g. 413 entity.too.large) carry a numeric `status`.
    if (typeof err === 'object' && err !== null && 'status' in err && typeof (err as { status: unknown }).status === 'number') {
      const httpErr = err as { status: number; message?: string };
      res.status(httpErr.status).json({ error: { code: 'HTTP_ERROR', message: httpErr.message ?? 'HTTP error' } });
      return;
    }
    const message = err instanceof Error ? err.message : 'Unknown error';
    res.status(500).json({ error: { code: 'INTERNAL', message } });
  });

  return app;
}
