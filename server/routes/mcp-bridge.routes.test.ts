import { describe, it, expect, vi } from 'vitest';
import request from 'supertest';
import { createApp } from '@/server/app';
import { McpBridgeService } from '@/server/domain/mcp/bridge/bridge.service';
import type { ProviderToolDecl } from '@/server/domain/dispatch/providers/provider.types';

const decl = (qualifiedName: string): ProviderToolDecl => ({
  qualifiedName,
  description: 'reads a file',
  schema: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] },
});

function setup(runToolCall = vi.fn().mockResolvedValue({ ok: true, output: 'result!' })) {
  const service = new McpBridgeService();
  const token = service.register([decl('Filesystem.read_file')], runToolCall);
  // Minimal app with only the bridge dep — proves the optional-dep wiring.
  const app = createApp({ mcpBridgeService: service });
  return { app, token, runToolCall };
}

describe('mcp-bridge.routes', () => {
  it('404s on unknown token without leaking details', async () => {
    const { app } = setup();
    const res = await request(app)
      .post('/api/mcp-bridge/not-a-token')
      .send({ jsonrpc: '2.0', id: 1, method: 'tools/list' });
    expect(res.status).toBe(404);
  });

  it('initialize returns protocol + capabilities', async () => {
    const { app, token } = setup();
    const res = await request(app)
      .post(`/api/mcp-bridge/${token}`)
      .send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} });
    expect(res.status).toBe(200);
    expect(res.body.result.capabilities).toEqual({ tools: {} });
    expect(res.body.result.serverInfo.name).toBe('aether-bridge');
  });

  it('accepts notifications with 202', async () => {
    const { app, token } = setup();
    const res = await request(app)
      .post(`/api/mcp-bridge/${token}`)
      .send({ jsonrpc: '2.0', method: 'notifications/initialized' });
    expect(res.status).toBe(202);
  });

  it('tools/list exposes normalized names and full schemas', async () => {
    const { app, token } = setup();
    const res = await request(app)
      .post(`/api/mcp-bridge/${token}`)
      .send({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
    expect(res.body.result.tools).toEqual([
      {
        name: 'Filesystem_read_file',
        description: 'reads a file',
        inputSchema: {
          type: 'object',
          properties: { path: { type: 'string' } },
          required: ['path'],
        },
      },
    ]);
  });

  it('tools/call resolves the safe name back to the qualifiedName', async () => {
    const { app, token, runToolCall } = setup();
    const res = await request(app)
      .post(`/api/mcp-bridge/${token}`)
      .send({
        jsonrpc: '2.0',
        id: 3,
        method: 'tools/call',
        params: { name: 'Filesystem_read_file', arguments: { path: '/tmp/x' } },
      });
    expect(runToolCall).toHaveBeenCalledWith({
      qualifiedName: 'Filesystem.read_file',
      args: { path: '/tmp/x' },
    });
    expect(res.body.result.content).toEqual([{ type: 'text', text: 'result!' }]);
    expect(res.body.result.isError).toBeUndefined();
  });

  it('tools/call maps a failed outcome to isError content', async () => {
    const failing = vi.fn().mockResolvedValue({ ok: false, error: 'rejected by gate' });
    const { app, token } = setup(failing);
    const res = await request(app)
      .post(`/api/mcp-bridge/${token}`)
      .send({
        jsonrpc: '2.0',
        id: 4,
        method: 'tools/call',
        params: { name: 'Filesystem_read_file', arguments: {} },
      });
    expect(res.body.result.isError).toBe(true);
    expect(res.body.result.content[0].text).toBe('rejected by gate');
  });

  it('tools/call on unknown tool returns a JSON-RPC error', async () => {
    const { app, token } = setup();
    const res = await request(app)
      .post(`/api/mcp-bridge/${token}`)
      .send({ jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'nope' } });
    expect(res.body.error.code).toBe(-32602);
  });

  it('unsupported method returns -32601', async () => {
    const { app, token } = setup();
    const res = await request(app)
      .post(`/api/mcp-bridge/${token}`)
      .send({ jsonrpc: '2.0', id: 6, method: 'resources/list' });
    expect(res.body.error.code).toBe(-32601);
  });
});
