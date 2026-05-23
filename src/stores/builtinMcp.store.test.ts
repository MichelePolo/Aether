import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { http, HttpResponse } from 'msw';
import { server } from '@/src/test/msw-server';
import { useBuiltinMcpStore } from './builtinMcp.store';
import { useMcpStore } from './mcp.store';

beforeEach(() => useBuiltinMcpStore.getState()._reset());
afterEach(() => server.resetHandlers());

describe('useBuiltinMcpStore', () => {
  it('init() populates builtins', async () => {
    server.use(
      http.get('http://localhost/api/mcp/builtin', () => HttpResponse.json({
        builtins: [
          { transport: 'filesystem', enabled: false, fsRoot: null },
          { transport: 'terminal', enabled: false, fsRoot: null },
        ],
      })),
    );
    await useBuiltinMcpStore.getState().init();
    expect(useBuiltinMcpStore.getState().builtins).toHaveLength(2);
    expect(useBuiltinMcpStore.getState().loading).toBe(false);
  });

  it('toggle() PUTs and updates the row + calls useMcpStore.refresh', async () => {
    const refreshSpy = vi.fn(async () => {});
    useMcpStore.setState({ refresh: refreshSpy });
    server.use(
      http.get('http://localhost/api/mcp/builtin', () => HttpResponse.json({
        builtins: [{ transport: 'filesystem', enabled: false, fsRoot: null }],
      })),
      http.put('http://localhost/api/mcp/builtin/filesystem', () => HttpResponse.json({
        state: { transport: 'filesystem', enabled: true, fsRoot: null },
      })),
    );
    await useBuiltinMcpStore.getState().init();
    await useBuiltinMcpStore.getState().toggle('filesystem');
    const fs = useBuiltinMcpStore.getState().builtins.find((b) => b.transport === 'filesystem');
    expect(fs?.enabled).toBe(true);
    expect(refreshSpy).toHaveBeenCalled();
  });

  it('toggle dedupes parallel calls for the same transport', async () => {
    let puts = 0;
    server.use(
      http.put('http://localhost/api/mcp/builtin/filesystem', async () => {
        puts++;
        await new Promise((r) => setTimeout(r, 30));
        return HttpResponse.json({ state: { transport: 'filesystem', enabled: true, fsRoot: null } });
      }),
    );
    useBuiltinMcpStore.setState({
      builtins: [{ transport: 'filesystem', enabled: false, fsRoot: null }],
    });
    const a = useBuiltinMcpStore.getState().toggle('filesystem');
    const b = useBuiltinMcpStore.getState().toggle('filesystem');
    await Promise.all([a, b]);
    expect(puts).toBe(1);
  });

  it('setFsRoot PUTs the new path', async () => {
    let receivedBody: unknown = null;
    server.use(
      http.put('http://localhost/api/mcp/builtin/filesystem', async ({ request }) => {
        receivedBody = await request.json();
        return HttpResponse.json({ state: { transport: 'filesystem', enabled: false, fsRoot: '/x' } });
      }),
    );
    useBuiltinMcpStore.setState({
      builtins: [{ transport: 'filesystem', enabled: false, fsRoot: null }],
    });
    await useBuiltinMcpStore.getState().setFsRoot('filesystem', '/x');
    expect(receivedBody).toEqual({ fsRoot: '/x' });
  });

  it('network failure sets error', async () => {
    server.use(
      http.get('http://localhost/api/mcp/builtin', () => HttpResponse.error()),
    );
    await useBuiltinMcpStore.getState().init();
    expect(useBuiltinMcpStore.getState().error).not.toBeNull();
  });
});
