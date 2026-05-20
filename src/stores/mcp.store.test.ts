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

  it('registerInFlightCall adds to inFlightCalls', () => {
    useMcpStore.getState().registerInFlightCall({
      callId: 'C1',
      qualifiedName: 'mock.echo',
      args: { message: 'hi' },
    });
    expect(useMcpStore.getState().inFlightCalls.C1?.qualifiedName).toBe('mock.echo');
  });

  it('updateInFlightProgress sets progressNote', () => {
    useMcpStore.getState().registerInFlightCall({
      callId: 'C1',
      qualifiedName: 'mock.echo',
      args: {},
    });
    useMcpStore.getState().updateInFlightProgress('C1', '50%');
    expect(useMcpStore.getState().inFlightCalls.C1?.progressNote).toBe('50%');
  });

  it('updateInFlightProgress is a no-op for unknown callId', () => {
    useMcpStore.getState().updateInFlightProgress('missing', '50%');
    expect(useMcpStore.getState().inFlightCalls.missing).toBeUndefined();
  });

  it('clearInFlightCall removes the entry', () => {
    useMcpStore.getState().registerInFlightCall({
      callId: 'C1',
      qualifiedName: 'mock.echo',
      args: {},
    });
    useMcpStore.getState().clearInFlightCall('C1');
    expect(useMcpStore.getState().inFlightCalls.C1).toBeUndefined();
  });

  it('refreshServer calls API and replaces server tools in liveTools', async () => {
    useMcpStore.setState({
      liveTools: [
        {
          qualifiedName: 'mock.echo',
          serverId: 'M1',
          serverName: 'mock',
          tool: { name: 'echo', inputSchema: {} },
          autoApprove: true,
        },
        {
          qualifiedName: 'other.foo',
          serverId: 'M2',
          serverName: 'other',
          tool: { name: 'foo', inputSchema: {} },
          autoApprove: false,
        },
      ],
    });
    server.use(
      http.post('http://localhost/api/mcp/M1/refresh-tools', () =>
        HttpResponse.json({
          tools: [{
            qualifiedName: 'mock.current_time', serverId: 'M1', serverName: 'mock',
            tool: { name: 'current_time', inputSchema: {} }, autoApprove: true,
          }],
        }),
      ),
    );
    await useMcpStore.getState().refreshServer('M1');
    const live = useMcpStore.getState().liveTools;
    expect(live).toHaveLength(2);
    expect(live.find((t) => t.serverId === 'M1')?.tool.name).toBe('current_time');
    expect(live.find((t) => t.serverId === 'M2')?.tool.name).toBe('foo');
  });

  it('applyServerStateEvent stores reconnectInfo when state is reconnecting', () => {
    useMcpStore.getState().applyServerStateEvent('M1', 'reconnecting', undefined, 3, 5);
    expect(useMcpStore.getState().reconnectInfo.M1).toEqual({ attempt: 3, max: 5 });
  });

  it('applyServerStateEvent clears reconnectInfo on transition to online', () => {
    useMcpStore.setState({ reconnectInfo: { M1: { attempt: 2, max: 5 } } });
    useMcpStore.getState().applyServerStateEvent('M1', 'online');
    expect(useMcpStore.getState().reconnectInfo.M1).toBeUndefined();
  });

  it('applyServerStateEvent clears reconnectInfo on transition to offline', () => {
    useMcpStore.setState({ reconnectInfo: { M1: { attempt: 2, max: 5 } } });
    useMcpStore.getState().applyServerStateEvent('M1', 'offline');
    expect(useMcpStore.getState().reconnectInfo.M1).toBeUndefined();
  });

  it('refreshServer sets error on failure', async () => {
    server.use(
      http.post('http://localhost/api/mcp/M1/refresh-tools', () =>
        HttpResponse.json({ error: { message: 'Not online' } }, { status: 409 }),
      ),
    );
    await expect(useMcpStore.getState().refreshServer('M1')).rejects.toThrow();
    expect(useMcpStore.getState().errors.M1).toBe('Not online');
  });
});
