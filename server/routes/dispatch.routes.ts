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
      sse.error(message);
    }
  });

  return router;
}
