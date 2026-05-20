import { describe, it, expect } from 'vitest';
import { http, HttpResponse } from 'msw';
import { server } from '@/src/test/msw-server';
import { mcpApi } from './mcp.api';

describe('mcpApi', () => {
  it('connect returns tools', async () => {
    server.use(
      http.post('http://localhost/api/mcp/M1/connect', () =>
        HttpResponse.json({ state: 'online', tools: [{ name: 'echo', inputSchema: {} }] }),
      ),
    );
    const r = await mcpApi.connect('M1');
    expect(r.tools).toHaveLength(1);
  });

  it('disconnect returns void', async () => {
    server.use(
      http.post('http://localhost/api/mcp/M1/disconnect', () => new HttpResponse(null, { status: 204 })),
    );
    await expect(mcpApi.disconnect('M1')).resolves.toBeUndefined();
  });

  it('listTools returns array', async () => {
    server.use(
      http.get('http://localhost/api/mcp/tools', () =>
        HttpResponse.json({ tools: [{ qualifiedName: 'mock.echo', serverId: 'M1', serverName: 'mock', tool: { name: 'echo', inputSchema: {} }, autoApprove: true }] }),
      ),
    );
    const tools = await mcpApi.listTools();
    expect(tools[0].qualifiedName).toBe('mock.echo');
  });

  it('togglePolicy PATCHes and returns the new policy', async () => {
    server.use(
      http.patch('http://localhost/api/mcp/M1/tools/echo', () => HttpResponse.json({ autoApprove: false })),
    );
    const r = await mcpApi.togglePolicy('M1', 'echo', { autoApprove: false });
    expect(r.autoApprove).toBe(false);
  });

  it('decide POSTs the action', async () => {
    server.use(
      http.post('http://localhost/api/mcp/decision', () => new HttpResponse(null, { status: 204 })),
    );
    await expect(mcpApi.decide('CID', 'approve')).resolves.toBeUndefined();
  });

  it('refreshTools POSTs and returns the new tools list', async () => {
    server.use(
      http.post('http://localhost/api/mcp/M1/refresh-tools', () =>
        HttpResponse.json({
          tools: [{
            qualifiedName: 'mock.echo', serverId: 'M1', serverName: 'mock',
            tool: { name: 'echo', inputSchema: {} }, autoApprove: true,
          }],
        }),
      ),
    );
    const tools = await mcpApi.refreshTools('M1');
    expect(tools[0].qualifiedName).toBe('mock.echo');
  });

  it('cancelCall POSTs to /cancel-call with callId', async () => {
    let posted: unknown = null;
    server.use(
      http.post('http://localhost/api/mcp/cancel-call', async ({ request }) => {
        posted = await request.json();
        return new HttpResponse(null, { status: 204 });
      }),
    );
    await mcpApi.cancelCall('CALL-1');
    expect(posted).toEqual({ callId: 'CALL-1' });
  });
});
