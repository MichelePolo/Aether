import { Router, type Request, type Response, type NextFunction } from 'express';
import fs from 'node:fs';
import type { BuiltinMcpStore } from '@/server/domain/mcp/builtin/builtin.store';
import type { McpRegistry } from '@/server/domain/mcp/registry';
import type { BuiltinTransport } from '@/server/domain/mcp/builtin/builtin.types';
import { ValidationError } from '@/server/lib/errors';

function asyncHandler(fn: (req: Request, res: Response, next: NextFunction) => Promise<void>) {
  return (req: Request, res: Response, next: NextFunction) => {
    fn(req, res, next).catch(next);
  };
}

const VALID_TRANSPORTS: readonly BuiltinTransport[] = ['filesystem', 'terminal', 'git'];

function isValidTransport(t: string): t is BuiltinTransport {
  return (VALID_TRANSPORTS as readonly string[]).includes(t);
}

export function createBuiltinMcpRoutes(store: BuiltinMcpStore, registry: McpRegistry): Router {
  const router = Router();

  router.get(
    '/',
    asyncHandler(async (_req, res) => {
      res.json({ builtins: store.read() });
    }),
  );

  router.put(
    '/:transport',
    asyncHandler(async (req, res) => {
      const { transport } = req.params;
      if (!isValidTransport(transport)) throw new ValidationError('Unknown transport');

      const body = req.body as { enabled?: unknown; fsRoot?: unknown };
      const wasEnabled = store.read().find((r) => r.transport === transport)!.enabled;

      // fsRoot validation
      if ('fsRoot' in body) {
        if (body.fsRoot === null) {
          store.setFsRoot(transport, null);
        } else if (typeof body.fsRoot === 'string') {
          try {
            const stat = fs.statSync(body.fsRoot);
            if (!stat.isDirectory()) throw new ValidationError('fsRoot must be a directory');
          } catch (err) {
            if (err instanceof ValidationError) throw err;
            throw new ValidationError(`fsRoot does not exist: ${body.fsRoot}`);
          }
          store.setFsRoot(transport, body.fsRoot);
        } else {
          throw new ValidationError('fsRoot must be a string or null');
        }
      }

      if ('enabled' in body && typeof body.enabled === 'boolean') {
        if (body.enabled && !wasEnabled) {
          // startBuiltin reads enabled rows via toConfigs, so the flag must be
          // set first — but if the connection fails, roll it back so the DB
          // never advertises a server that isn't actually running.
          store.setEnabled(transport, true);
          try {
            await registry.startBuiltin(transport);
          } catch (err) {
            store.setEnabled(transport, false);
            throw err;
          }
        } else if (!body.enabled && wasEnabled) {
          await registry.stopBuiltin(transport);
          store.setEnabled(transport, false);
        }
      } else if ('fsRoot' in body && wasEnabled) {
        // fsRoot changed while enabled → reconnect
        await registry.reconnectBuiltin(transport);
      }

      const state = store.read().find((r) => r.transport === transport)!;
      res.json({ state });
    }),
  );

  return router;
}
