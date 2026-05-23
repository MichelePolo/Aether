import { describe, it, expect, afterEach } from 'vitest';
import { http, HttpResponse } from 'msw';
import { server } from '@/src/test/msw-server';
import { builtinMcpApi } from './builtin-mcp.api';

afterEach(() => server.resetHandlers());

describe('builtinMcpApi', () => {
  it('list() GETs /api/mcp/builtin and returns parsed payload', async () => {
    server.use(
      http.get('http://localhost/api/mcp/builtin', () => HttpResponse.json({
        builtins: [
          { transport: 'filesystem', enabled: false, fsRoot: null },
          { transport: 'terminal', enabled: false, fsRoot: null },
        ],
      })),
    );
    const got = await builtinMcpApi.list();
    expect(got).toHaveLength(2);
  });

  it('set() PUTs the patch and returns the new state', async () => {
    let receivedBody: unknown = null;
    server.use(
      http.put('http://localhost/api/mcp/builtin/filesystem', async ({ request }) => {
        receivedBody = await request.json();
        return HttpResponse.json({
          state: { transport: 'filesystem', enabled: true, fsRoot: null },
        });
      }),
    );
    const state = await builtinMcpApi.set('filesystem', { enabled: true });
    expect(state.enabled).toBe(true);
    expect(receivedBody).toEqual({ enabled: true });
  });
});
