import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import request from 'supertest';
import express from 'express';
import { makeTestDb } from '@/server/test/test-db';
import { BuiltinMcpStore } from '@/server/domain/mcp/builtin/builtin.store';
import { McpRegistry } from '@/server/domain/mcp/registry';
import { ContextStore } from '@/server/domain/context/context.store';
import { createBuiltinMcpRoutes } from './builtin-mcp.routes';
import type { DatabaseHandle } from '@/server/db/database';
import { isAppError } from '@/server/lib/errors';

let db: DatabaseHandle;
let store: BuiltinMcpStore;
let registry: McpRegistry;
let app: express.Express;

beforeEach(() => {
  db = makeTestDb();
  store = new BuiltinMcpStore(db);
  const ctx = new ContextStore(db);
  registry = new McpRegistry(ctx, store);
  // Stub registry methods we don't want to actually connect subprocesses
  vi.spyOn(registry, 'startBuiltin').mockResolvedValue(undefined);
  vi.spyOn(registry, 'stopBuiltin').mockResolvedValue(undefined);
  vi.spyOn(registry, 'reconnectBuiltin').mockResolvedValue(undefined);
  app = express();
  app.use(express.json());
  app.use('/api/mcp/builtin', createBuiltinMcpRoutes(store, registry));
  app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    if (isAppError(err)) {
      res.status(err.status).json({ error: { code: err.code, message: err.message } });
      return;
    }
    const message = err instanceof Error ? err.message : 'Unknown error';
    res.status(500).json({ error: { code: 'INTERNAL', message } });
  });
});

afterEach(() => db.close());

describe('builtin MCP routes', () => {
  it('GET /api/mcp/builtin returns 2 disabled rows', async () => {
    const res = await request(app).get('/api/mcp/builtin');
    expect(res.status).toBe(200);
    expect(res.body.builtins).toHaveLength(2);
    expect(res.body.builtins.every((b: { enabled: boolean }) => !b.enabled)).toBe(true);
  });

  it('PUT enables and triggers startBuiltin', async () => {
    const res = await request(app).put('/api/mcp/builtin/filesystem').send({ enabled: true });
    expect(res.status).toBe(200);
    expect(res.body.state.enabled).toBe(true);
    expect(registry.startBuiltin).toHaveBeenCalledWith('filesystem');
  });

  it('rolls back enabled when startBuiltin fails so the DB never claims a dead server is on', async () => {
    vi.mocked(registry.startBuiltin).mockRejectedValueOnce(new Error('handshake failed'));
    const res = await request(app).put('/api/mcp/builtin/filesystem').send({ enabled: true });
    expect(res.status).toBe(500);
    expect(store.read().find((r) => r.transport === 'filesystem')?.enabled).toBe(false);
  });

  it('PUT disable triggers stopBuiltin then writes DB', async () => {
    store.setEnabled('terminal', true);
    const res = await request(app).put('/api/mcp/builtin/terminal').send({ enabled: false });
    expect(res.status).toBe(200);
    expect(res.body.state.enabled).toBe(false);
    expect(registry.stopBuiltin).toHaveBeenCalledWith('terminal');
  });

  it('PUT fsRoot while enabled triggers reconnect', async () => {
    store.setEnabled('filesystem', true);
    const res = await request(app).put('/api/mcp/builtin/filesystem').send({ fsRoot: '/tmp' });
    expect(res.status).toBe(200);
    expect(res.body.state.fsRoot).toBe('/tmp');
    expect(registry.reconnectBuiltin).toHaveBeenCalledWith('filesystem');
  });

  it('PUT with invalid fsRoot returns 400', async () => {
    const res = await request(app).put('/api/mcp/builtin/filesystem').send({ fsRoot: '/no/such/dir/here' });
    expect(res.status).toBe(400);
  });

  it('PUT with null fsRoot reverts to default', async () => {
    store.setFsRoot('filesystem', '/tmp');
    const res = await request(app).put('/api/mcp/builtin/filesystem').send({ fsRoot: null });
    expect(res.status).toBe(200);
    expect(res.body.state.fsRoot).toBeNull();
  });

  it('PUT with invalid transport returns 400', async () => {
    const res = await request(app).put('/api/mcp/builtin/nope').send({ enabled: true });
    expect(res.status).toBe(400);
  });
});
