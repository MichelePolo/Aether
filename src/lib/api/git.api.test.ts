import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { gitApi } from './git.api';

const fetchMock = vi.fn();

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return {
    ok,
    status,
    json: async () => body,
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
  } as unknown as Response;
}

function textResponse(body: string, ok = true, status = 200): Response {
  return { ok, status, text: async () => body } as unknown as Response;
}

describe('gitApi', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe('status', () => {
    it('hits the right URL and returns parsed JSON', async () => {
      fetchMock.mockResolvedValue(jsonResponse({ isRepo: true, root: '/r', head: 'abc' }));
      const r = await gitApi.status('w 1');
      expect(fetchMock).toHaveBeenCalledWith('/api/git/status?workspaceId=w%201');
      expect(r).toEqual({ isRepo: true, root: '/r', head: 'abc' });
    });

    it('throws on !ok', async () => {
      fetchMock.mockResolvedValue(jsonResponse({}, false, 500));
      await expect(gitApi.status('w1')).rejects.toThrow('Request failed: 500');
    });
  });

  describe('log', () => {
    it('omits maxCount when not provided and encodes workspaceId', async () => {
      fetchMock.mockResolvedValue(jsonResponse({ commits: [], truncated: false }));
      await gitApi.log('a/b');
      expect(fetchMock).toHaveBeenCalledWith('/api/git/log?workspaceId=a%2Fb');
    });

    it('includes maxCount when provided', async () => {
      fetchMock.mockResolvedValue(jsonResponse({ commits: [], truncated: true }));
      const r = await gitApi.log('w1', 25);
      expect(fetchMock).toHaveBeenCalledWith('/api/git/log?workspaceId=w1&maxCount=25');
      expect(r.truncated).toBe(true);
    });

    it('throws on !ok', async () => {
      fetchMock.mockResolvedValue(jsonResponse({}, false, 404));
      await expect(gitApi.log('w1')).rejects.toThrow('Request failed: 404');
    });
  });

  describe('diff', () => {
    it('reads text() and returns { unified }, encoding all params', async () => {
      fetchMock.mockResolvedValue(textResponse('@@ -1 +1 @@\n-a\n+b\n'));
      const r = await gitApi.diff({
        workspaceId: 'w1',
        hash: 'h ash',
        path: 'src/a b.ts',
        oldPath: 'src/old.ts',
      });
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/git/diff?workspaceId=w1&hash=h%20ash&path=src%2Fa%20b.ts&oldPath=src%2Fold.ts',
      );
      expect(r).toEqual({ unified: '@@ -1 +1 @@\n-a\n+b\n' });
    });

    it('omits oldPath when not provided', async () => {
      fetchMock.mockResolvedValue(textResponse('diff'));
      await gitApi.diff({ workspaceId: 'w1', hash: 'h1', path: 'p.ts' });
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/git/diff?workspaceId=w1&hash=h1&path=p.ts',
      );
    });

    it('throws on !ok', async () => {
      fetchMock.mockResolvedValue(textResponse('', false, 500));
      await expect(
        gitApi.diff({ workspaceId: 'w1', hash: 'h1', path: 'p.ts' }),
      ).rejects.toThrow('Request failed: 500');
    });
  });
});
