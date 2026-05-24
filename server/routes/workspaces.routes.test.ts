import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import express from 'express';
import request from 'supertest';
import { createWorkspacesRoutes } from './workspaces.routes';
import { WorkspacesStore } from '@/server/domain/workspaces/workspaces.store';
import { FilesystemBrowserService } from '@/server/domain/workspaces/filesystem-browser.service';
import { makeTestDb } from '@/server/test/test-db';

function makeApp(opts: {
  store?: WorkspacesStore;
  browser?: FilesystemBrowserService;
  historyStore?: {
    setSessionWorkspace?: (id: string, w: string | null) => Promise<void>;
    listSessions?: () => Promise<Array<{ id: string; workspaceId?: string }>>;
  };
  builtinStore?: {
    read: () => Array<{ transport: string; enabled: boolean; fsRoot: string | null }>;
    setFsRoot: (t: string, p: string | null) => void;
  };
  mcpRegistry?: { reconnectBuiltin: (t: string) => Promise<void> };
}) {
  const app = express();
  app.use(express.json());
  app.use('/api/workspaces', createWorkspacesRoutes({
    store: opts.store!,
    browser: opts.browser ?? new FilesystemBrowserService(),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    historyStore: opts.historyStore as any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    builtinStore: opts.builtinStore as any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    mcpRegistry: opts.mcpRegistry as any,
  }));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  app.use((err: any, _req: any, res: any, _next: any) => {
    res.status(err.statusCode ?? 500).json({ error: { message: err.message } });
  });
  return app;
}

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'aether-wsroute-')); });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

describe('workspaces.routes', () => {
  it('GET /api/workspaces returns []', async () => {
    const db = makeTestDb();
    const store = new WorkspacesStore(db);
    const res = await request(makeApp({ store })).get('/api/workspaces');
    expect(res.status).toBe(200);
    expect(res.body.workspaces).toEqual([]);
  });

  it('POST /api/workspaces creates and validates path is a directory', async () => {
    const db = makeTestDb();
    const store = new WorkspacesStore(db);
    const res = await request(makeApp({ store })).post('/api/workspaces').send({ name: 'p', rootPath: dir });
    expect(res.status).toBe(201);
    expect(res.body.rootPath).toBe(dir);
  });

  it('POST /api/workspaces rejects non-existent path with 400', async () => {
    const db = makeTestDb();
    const store = new WorkspacesStore(db);
    const res = await request(makeApp({ store })).post('/api/workspaces').send({ name: 'p', rootPath: '/nope/nope' });
    expect(res.status).toBe(400);
  });

  it('POST /api/workspaces rejects duplicate rootPath with 400', async () => {
    const db = makeTestDb();
    const store = new WorkspacesStore(db);
    const app = makeApp({ store });
    await request(app).post('/api/workspaces').send({ name: 'a', rootPath: dir });
    const res = await request(app).post('/api/workspaces').send({ name: 'b', rootPath: dir });
    expect(res.status).toBe(400);
  });

  it('PATCH /api/workspaces/:id renames', async () => {
    const db = makeTestDb();
    const store = new WorkspacesStore(db);
    const created = store.create({ name: 'old', rootPath: dir });
    const res = await request(makeApp({ store })).patch(`/api/workspaces/${created.id}`).send({ name: 'new' });
    expect(res.status).toBe(200);
    expect(store.get(created.id)?.name).toBe('new');
  });

  it('DELETE /api/workspaces/:id removes', async () => {
    const db = makeTestDb();
    const store = new WorkspacesStore(db);
    const created = store.create({ name: 'a', rootPath: dir });
    const res = await request(makeApp({ store })).delete(`/api/workspaces/${created.id}`);
    expect(res.status).toBe(204);
    expect(store.get(created.id)).toBeUndefined();
  });

  it('GET /api/workspaces/browse lists subdirectories of given path', async () => {
    mkdirSync(join(dir, 'a'));
    mkdirSync(join(dir, 'b'));
    const db = makeTestDb();
    const store = new WorkspacesStore(db);
    const res = await request(makeApp({ store })).get('/api/workspaces/browse').query({ path: dir });
    expect(res.status).toBe(200);
    expect(res.body.entries.map((e: { name: string }) => e.name)).toEqual(['a', 'b']);
  });

  it('GET /api/workspaces/browse with no path uses homedir', async () => {
    const db = makeTestDb();
    const store = new WorkspacesStore(db);
    const res = await request(makeApp({ store })).get('/api/workspaces/browse');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.entries)).toBe(true);
  });

  it('GET /api/workspaces/browse with bad path returns 400', async () => {
    const db = makeTestDb();
    const store = new WorkspacesStore(db);
    const res = await request(makeApp({ store })).get('/api/workspaces/browse').query({ path: '/nope/nope' });
    expect(res.status).toBe(400);
  });

  it('POST /api/workspaces/activate-for-session reroots Filesystem MCP when needed', async () => {
    const db = makeTestDb();
    const store = new WorkspacesStore(db);
    const created = store.create({ name: 'p', rootPath: dir });
    const setFsRoot = vi.fn();
    const reconnectBuiltin = vi.fn().mockResolvedValue(undefined);
    const builtinStore = {
      read: () => [{ transport: 'filesystem', enabled: true, fsRoot: '/old' }],
      setFsRoot,
    };
    const historyStore = {
      listSessions: () => Promise.resolve([{ id: 's1', workspaceId: created.id }]),
      setSessionWorkspace: vi.fn().mockResolvedValue(undefined),
    };
    const res = await request(
      makeApp({ store, builtinStore, mcpRegistry: { reconnectBuiltin }, historyStore }),
    )
      .post('/api/workspaces/activate-for-session')
      .send({ sessionId: 's1' });
    expect(res.status).toBe(200);
    expect(res.body.rooted).toBe(dir);
    expect(setFsRoot).toHaveBeenCalledWith('filesystem', dir);
    expect(reconnectBuiltin).toHaveBeenCalledWith('filesystem');
  });

  it('POST activate-for-session skips reroot when filesystem MCP is disabled', async () => {
    const db = makeTestDb();
    const store = new WorkspacesStore(db);
    const created = store.create({ name: 'p', rootPath: dir });
    const setFsRoot = vi.fn();
    const builtinStore = {
      read: () => [{ transport: 'filesystem', enabled: false, fsRoot: null }],
      setFsRoot,
    };
    const historyStore = {
      listSessions: () => Promise.resolve([{ id: 's1', workspaceId: created.id }]),
      setSessionWorkspace: vi.fn(),
    };
    const res = await request(
      makeApp({ store, builtinStore, mcpRegistry: { reconnectBuiltin: vi.fn() }, historyStore }),
    )
      .post('/api/workspaces/activate-for-session')
      .send({ sessionId: 's1' });
    expect(res.status).toBe(200);
    expect(res.body.rooted).toBeNull();
    expect(setFsRoot).not.toHaveBeenCalled();
  });
});
