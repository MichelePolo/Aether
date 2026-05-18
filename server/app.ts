import express, { type Express, type NextFunction, type Request, type Response } from 'express';
import { isAppError } from './lib/errors';
import type { ContextStore } from './domain/context/context.store';
import type { HistoryStore } from './domain/history/history.store';
import type { DispatchService } from './domain/dispatch/dispatch.service';
import { createContextRoutes } from './routes/context.routes';
import { createDispatchRoutes } from './routes/dispatch.routes';

export interface AppDeps {
  contextStore?: ContextStore;
  historyStore?: HistoryStore;
  dispatcher?: DispatchService;
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

  extraRoutes?.(app);

  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (isAppError(err)) {
      res.status(err.status).json({ error: { code: err.code, message: err.message } });
      return;
    }
    const message = err instanceof Error ? err.message : 'Unknown error';
    res.status(500).json({ error: { code: 'INTERNAL', message } });
  });

  return app;
}
