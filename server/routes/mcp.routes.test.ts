// server/routes/mcp.routes.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import request from 'supertest';
import { createApp } from '@/server/app';
import { ContextStore } from '@/server/domain/context/context.store';
import { McpRegistry } from '@/server/domain/mcp/registry';

async function makeApp() {
  const dir = mkdtempSync(path.join(tmpdir(), 'aether-mcp-routes-'));
  const contextStore = new ContextStore(path.join(dir, 'context.json'));
  await contextStore.bulkOverwrite({
    systemInstruction: '',
    skills: [],
    tools: [],
    mcpServers: [
      { id: 'M1', name: 'mock', transport: 'mock', status: 'offline' },
    ],
  });
  const mcpRegistry = new McpRegistry(contextStore);
  return { app: createApp({ contextStore, mcpRegistry }), mcpRegistry };
}

describe('mcp routes', () => {
  let app: Awaited<ReturnType<typeof makeApp>>['app'];
  let reg: McpRegistry;
  beforeEach(async () => {
    ({ app, mcpRegistry: reg } = await makeApp());
  });

  it('POST /api/mcp/:id/connect → tools', async () => {
    const res = await request(app).post('/api/mcp/M1/connect');
    expect(res.status).toBe(200);
    expect(res.body.state).toBe('online');
    expect(Array.isArray(res.body.tools)).toBe(true);
  });

  it('GET /api/mcp/tools after connect lists namespaced tools', async () => {
    await request(app).post('/api/mcp/M1/connect');
    const res = await request(app).get('/api/mcp/tools');
    expect(res.status).toBe(200);
    expect(res.body.tools.map((t: { qualifiedName: string }) => t.qualifiedName).sort()).toEqual([
      'mock.current_time', 'mock.echo', 'mock.read_file_mock',
    ]);
  });

  it('POST /api/mcp/:id/disconnect → 204; subsequent /tools is empty', async () => {
    await request(app).post('/api/mcp/M1/connect');
    const dis = await request(app).post('/api/mcp/M1/disconnect');
    expect(dis.status).toBe(204);
    const list = await request(app).get('/api/mcp/tools');
    expect(list.body.tools).toEqual([]);
  });

  it('PATCH /api/mcp/:id/tools/:name persists policy', async () => {
    await request(app).post('/api/mcp/M1/connect');
    const res = await request(app)
      .patch('/api/mcp/M1/tools/echo')
      .send({ autoApprove: false });
    expect(res.status).toBe(200);
    expect(res.body.autoApprove).toBe(false);
    await request(app).post('/api/mcp/M1/disconnect');
    await request(app).post('/api/mcp/M1/connect');
    expect(reg.policy('mock.echo')).toEqual({ autoApprove: false });
  });

  it('POST /api/mcp/decision resolves a pending decision', async () => {
    const decisionP = reg.awaitDecision('CID-1', 500);
    const res = await request(app)
      .post('/api/mcp/decision')
      .send({ callId: 'CID-1', action: 'approve' });
    expect(res.status).toBe(204);
    await expect(decisionP).resolves.toBe('approve');
  });

  it('POST /connect with unknown id → 404', async () => {
    const res = await request(app).post('/api/mcp/ZZZ/connect');
    expect(res.status).toBe(404);
  });

  it('GET /api/mcp/state returns per-server snapshot', async () => {
    await request(app).post('/api/mcp/M1/connect');
    const res = await request(app).get('/api/mcp/state');
    expect(res.status).toBe(200);
    expect(res.body.servers).toEqual(expect.arrayContaining([{ id: 'M1', state: 'online' }]));
  });
});
