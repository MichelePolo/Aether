import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { skillsApi } from './skills.api';

const fetchMock = vi.fn();

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return {
    ok,
    status,
    statusText: ok ? 'OK' : 'Error',
    json: async () => body,
  } as unknown as Response;
}

describe('skillsApi', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockReset();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('list hits GET /api/skills and returns parsed JSON', async () => {
    const payload = { skills: [{ name: 'a', enabled: false, pinned: false }], drafts: [] };
    fetchMock.mockResolvedValue(jsonResponse(payload));
    const r = await skillsApi.list();
    expect(fetchMock).toHaveBeenCalledWith('/api/skills');
    expect(r).toEqual(payload);
  });

  it('list throws the server error message on !ok', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ error: { message: 'boom' } }, false, 500));
    await expect(skillsApi.list()).rejects.toThrow('boom');
  });

  it('setEnabled PATCHes the encoded slug with the enabled body', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ status: 'ok' }));
    await skillsApi.setEnabled('my skill', true);
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/skills/my%20skill/enabled',
      expect.objectContaining({ method: 'PATCH', body: JSON.stringify({ enabled: true }) }),
    );
  });

  it('setPinned PATCHes the pinned endpoint', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ status: 'ok' }));
    await skillsApi.setPinned('alpha', false);
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/skills/alpha/pinned',
      expect.objectContaining({ method: 'PATCH', body: JSON.stringify({ pinned: false }) }),
    );
  });

  it('promote POSTs the slug to /api/skills/promote', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ status: 'ok' }));
    await skillsApi.promote('wip');
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/skills/promote',
      expect.objectContaining({ method: 'POST', body: JSON.stringify({ slug: 'wip' }) }),
    );
  });

  it('remove DELETEs the encoded slug', async () => {
    fetchMock.mockResolvedValue(jsonResponse(null, true, 204));
    await skillsApi.remove('alpha');
    expect(fetchMock).toHaveBeenCalledWith('/api/skills/alpha', { method: 'DELETE' });
  });

  it('remove throws on !ok', async () => {
    fetchMock.mockResolvedValue(jsonResponse(null, false, 404));
    await expect(skillsApi.remove('ghost')).rejects.toThrow();
  });
});
