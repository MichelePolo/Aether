import { describe, it, expect, beforeEach } from 'vitest';
import { http, HttpResponse } from 'msw';
import { server } from '@/src/test/msw-server';
import { useMcpStore } from './mcp.store';

beforeEach(() => {
  useMcpStore.getState()._reset();
});

describe('useMcpStore', () => {
  it('connect populates liveTools by serverId', async () => {
    server.use(
      http.post('http://localhost/api/mcp/M1/connect', () =>
        HttpResponse.json({
          state: 'online',
          tools: [{ name: 'echo', inputSchema: {} }],
        }),
      ),
      http.get('http://localhost/api/mcp/tools', () =>
        HttpResponse.json({
          tools: [{
            qualifiedName: 'mock.echo', serverId: 'M1', serverName: 'mock',
            tool: { name: 'echo', inputSchema: {} }, autoApprove: true,
          }],
        }),
      ),
    );
    await useMcpStore.getState().connect('M1');
    expect(useMcpStore.getState().connectStates.M1).toBe('online');
    expect(useMcpStore.getState().liveTools).toHaveLength(1);
  });

  it('disconnect clears server tools', async () => {
    useMcpStore.setState({
      liveTools: [{ qualifiedName: 'mock.echo', serverId: 'M1', serverName: 'mock', tool: { name: 'echo', inputSchema: {} }, autoApprove: true }],
      connectStates: { M1: 'online' },
      errors: {},
    });
    server.use(
      http.post('http://localhost/api/mcp/M1/disconnect', () => new HttpResponse(null, { status: 204 })),
      http.get('http://localhost/api/mcp/tools', () => HttpResponse.json({ tools: [] })),
    );
    await useMcpStore.getState().disconnect('M1');
    expect(useMcpStore.getState().connectStates.M1).toBe('offline');
    expect(useMcpStore.getState().liveTools).toEqual([]);
  });

  it('togglePolicy updates the liveTools entry optimistically', async () => {
    useMcpStore.setState({
      liveTools: [{ qualifiedName: 'mock.echo', serverId: 'M1', serverName: 'mock', tool: { name: 'echo', inputSchema: {} }, autoApprove: true }],
      connectStates: { M1: 'online' },
      errors: {},
    });
    server.use(
      http.patch('http://localhost/api/mcp/M1/tools/echo', () => HttpResponse.json({ autoApprove: false })),
    );
    await useMcpStore.getState().togglePolicy('M1', 'echo', false);
    expect(useMcpStore.getState().liveTools[0].autoApprove).toBe(false);
  });

  it('sets error on connect failure', async () => {
    server.use(
      http.post('http://localhost/api/mcp/Mbad/connect', () =>
        HttpResponse.json({ error: { message: 'Boom' } }, { status: 500 }),
      ),
    );
    await expect(useMcpStore.getState().connect('Mbad')).rejects.toThrow();
    expect(useMcpStore.getState().connectStates.Mbad).toBe('error');
    expect(useMcpStore.getState().errors.Mbad).toBe('Boom');
  });
});
