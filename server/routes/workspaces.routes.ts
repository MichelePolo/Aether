import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import fs from 'node:fs';
import os from 'node:os';
import { ValidationError } from '@/server/lib/errors';
import type { WorkspacesStore } from '@/server/domain/workspaces/workspaces.store';
import type { FilesystemBrowserService } from '@/server/domain/workspaces/filesystem-browser.service';
import type { HistoryStore } from '@/server/domain/history/history.store';
import type { BuiltinMcpStore } from '@/server/domain/mcp/builtin/builtin.store';
import type { McpRegistry } from '@/server/domain/mcp/registry';

function asyncHandler(fn: (req: Request, res: Response, next: NextFunction) => Promise<void>) {
  return (req: Request, res: Response, next: NextFunction) => {
    fn(req, res, next).catch(next);
  };
}

const CreateBody = z.object({ name: z.string().min(1), rootPath: z.string().min(1) });
const RenameBody = z.object({ name: z.string().min(1) });
const ActivateBody = z.object({ sessionId: z.string().min(1) });

export interface WorkspacesRoutesDeps {
  store: WorkspacesStore;
  browser: FilesystemBrowserService;
  historyStore: HistoryStore;
  builtinStore: BuiltinMcpStore;
  mcpRegistry: McpRegistry;
}

export function createWorkspacesRoutes(deps: WorkspacesRoutesDeps): Router {
  const router = Router();

  router.get('/', (_req, res) => {
    res.json({ workspaces: deps.store.list() });
  });

  router.post(
    '/',
    asyncHandler(async (req, res) => {
      const parsed = CreateBody.safeParse(req.body);
      if (!parsed.success) throw new ValidationError('Invalid body', parsed.error);
      // Validate path exists + is a directory before storing.
      try {
        const stat = fs.statSync(parsed.data.rootPath);
        if (!stat.isDirectory()) throw new ValidationError('rootPath must be a directory');
      } catch (e) {
        if (e instanceof ValidationError) throw e;
        throw new ValidationError(`rootPath does not exist: ${parsed.data.rootPath}`);
      }
      const w = deps.store.create(parsed.data);
      res.status(201).json(w);
    }),
  );

  router.get(
    '/browse',
    asyncHandler(async (req, res) => {
      const path = typeof req.query.path === 'string' && req.query.path.length > 0
        ? req.query.path
        : (os.homedir?.() ?? process.cwd());
      try {
        const entries = await deps.browser.browse(path);
        res.json({ entries });
      } catch (e: unknown) {
        throw new ValidationError(
          `Cannot list directory: ${(e as { message?: string }).message ?? String(e)}`,
        );
      }
    }),
  );

  router.post(
    '/activate-for-session',
    asyncHandler(async (req, res) => {
      const parsed = ActivateBody.safeParse(req.body);
      if (!parsed.success) throw new ValidationError('Invalid body', parsed.error);
      const sessions = await deps.historyStore.listSessions();
      const session = sessions.find((s) => s.id === parsed.data.sessionId);
      const workspaceId = session?.workspaceId;
      const workspace = workspaceId ? deps.store.get(workspaceId) : undefined;
      const targetRoot = workspace?.rootPath ?? null;

      const fsRow = deps.builtinStore.read().find((r) => r.transport === 'filesystem');
      if (!fsRow || !fsRow.enabled) {
        res.json({ rooted: null });
        return;
      }
      if (targetRoot === null || targetRoot === fsRow.fsRoot) {
        res.json({ rooted: targetRoot });
        return;
      }
      deps.builtinStore.setFsRoot('filesystem', targetRoot);
      await deps.mcpRegistry.reconnectBuiltin('filesystem');
      res.json({ rooted: targetRoot });
    }),
  );

  router.patch(
    '/:id',
    asyncHandler(async (req, res) => {
      const parsed = RenameBody.safeParse(req.body);
      if (!parsed.success) throw new ValidationError('Invalid body', parsed.error);
      if (!deps.store.get(req.params.id)) throw new ValidationError('Unknown workspace');
      deps.store.rename(req.params.id, parsed.data.name);
      res.json(deps.store.get(req.params.id));
    }),
  );

  router.delete(
    '/:id',
    asyncHandler(async (req, res) => {
      deps.store.delete(req.params.id);
      res.status(204).end();
    }),
  );

  return router;
}
