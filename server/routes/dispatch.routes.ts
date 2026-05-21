import { Router, type Request, type Response } from 'express';
import { createSseEmitter } from '@/server/lib/sse';
import type { DispatchService } from '@/server/domain/dispatch/dispatch.service';

export function createDispatchRoutes(dispatcher: DispatchService): Router {
  const router = Router();

  router.post('/', async (req: Request, res: Response) => {
    const sse = createSseEmitter(res);
    const controller = new AbortController();
    // Nota: usiamo `res.on('close')` invece di `req.on('close')` perché alcuni
    // client (es. supertest) chiudono il lato lettura della request appena il
    // body è stato spedito, generando un falso "abort" prima ancora che la
    // risposta inizi. `res.on('close')` con check su `writableEnded` rileva
    // solo le disconnessioni reali del client mentre lo streaming è in corso.
    res.on('close', () => {
      if (!res.writableEnded) controller.abort();
    });
    try {
      await dispatcher.handle(req.body, sse, controller.signal);
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Internal error';
      // Route-level catch is for unexpected server bugs / config issues —
      // not transient network errors. Default to retryable=false.
      sse.error(message, false);
    }
  });

  router.post('/resume', async (req: Request, res: Response) => {
    const sse = createSseEmitter(res);
    const controller = new AbortController();
    res.on('close', () => {
      if (!res.writableEnded) controller.abort();
    });
    const body = req.body as { sessionId?: unknown; messageId?: unknown; providerName?: unknown };
    if (typeof body?.sessionId !== 'string' || typeof body?.messageId !== 'string') {
      sse.event('error', { message: 'Invalid request body', retryable: false });
      sse.end();
      return;
    }
    try {
      await dispatcher.resume(
        {
          sessionId: body.sessionId,
          messageId: body.messageId,
          providerName: typeof body.providerName === 'string' ? body.providerName : undefined,
        },
        sse,
        controller.signal,
      );
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Internal error';
      // Route-level catch is for unexpected server bugs / config issues —
      // not transient network errors. Default to retryable=false.
      sse.error(message, false);
    }
  });

  return router;
}
