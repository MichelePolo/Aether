import { describe, it, expect, beforeEach, vi } from 'vitest';
import { http, HttpResponse } from 'msw';
import { server } from '@/src/test/msw-server';
import { useProfilesStore } from './profiles.store';
import { useContextStore } from './context.store';
import { useUiStore } from './ui.store';

const ctx = {
  systemInstruction: 'sys',
  skills: [],
  tools: [],
  mcpServers: [],
};
const meta = (id: string, name = 'P', updatedAt = 2) => ({
  id, name, createdAt: 1, updatedAt,
});

beforeEach(() => {
  useProfilesStore.getState()._reset();
  useContextStore.getState()._reset();
  useUiStore.getState()._reset();
  localStorage.clear();
  useContextStore.setState({ context: ctx });
  globalThis.URL.createObjectURL = vi.fn(() => 'blob:mock');
  globalThis.URL.revokeObjectURL = vi.fn();
});

describe('useProfilesStore.init', () => {
  it('hydrates empty when server has none', async () => {
    server.use(
      http.get('http://localhost/api/profiles', () => HttpResponse.json({ profiles: [] })),
    );
    await useProfilesStore.getState().init();
    const s = useProfilesStore.getState();
    expect(s.profiles).toEqual([]);
    expect(s.activeProfileId).toBeNull();
    expect(s.hydrated).toBe(true);
  });

  it('preserves activeProfileId from localStorage if still valid', async () => {
    localStorage.setItem('aether.activeProfileId', 'B');
    server.use(
      http.get('http://localhost/api/profiles', () =>
        HttpResponse.json({ profiles: [meta('A'), meta('B')] }),
      ),
    );
    await useProfilesStore.getState().init();
    expect(useProfilesStore.getState().activeProfileId).toBe('B');
  });

  it('clears stale activeProfileId when id no longer exists', async () => {
    localStorage.setItem('aether.activeProfileId', 'ZZ');
    server.use(
      http.get('http://localhost/api/profiles', () =>
        HttpResponse.json({ profiles: [meta('A')] }),
      ),
    );
    await useProfilesStore.getState().init();
    expect(useProfilesStore.getState().activeProfileId).toBeNull();
    expect(localStorage.getItem('aether.activeProfileId')).toBeNull();
  });

  it('sets error on GET failure', async () => {
    server.use(
      http.get('http://localhost/api/profiles', () =>
        HttpResponse.json({ error: { message: 'boom' } }, { status: 500 }),
      ),
    );
    await useProfilesStore.getState().init();
    expect(useProfilesStore.getState().error).toBeTruthy();
    expect(useProfilesStore.getState().hydrated).toBe(true);
  });
});

describe('useProfilesStore.saveCurrent', () => {
  it('reads context + thinkingEnabled and POSTs', async () => {
    useUiStore.setState({ thinkingEnabled: true });
    let received: unknown;
    server.use(
      http.post('http://localhost/api/profiles', async ({ request }) => {
        received = await request.json();
        return HttpResponse.json(meta('NEW', 'My setup'), { status: 201 });
      }),
    );
    const created = await useProfilesStore.getState().saveCurrent('My setup');
    expect(created.id).toBe('NEW');
    expect(received).toMatchObject({ name: 'My setup', context: ctx, thinkingEnabled: true });
    expect(useProfilesStore.getState().profiles[0].id).toBe('NEW');
  });

  it('throws + sets error when context is not hydrated', async () => {
    useContextStore.setState({ context: null });
    await expect(useProfilesStore.getState().saveCurrent('X')).rejects.toThrow();
    expect(useProfilesStore.getState().error).toBeTruthy();
  });

  it('sets error on POST failure', async () => {
    server.use(
      http.post('http://localhost/api/profiles', () =>
        HttpResponse.json({ error: { message: 'bad' } }, { status: 400 }),
      ),
    );
    await expect(useProfilesStore.getState().saveCurrent('x')).rejects.toThrow();
    expect(useProfilesStore.getState().error).toBeTruthy();
  });
});

describe('useProfilesStore.apply', () => {
  it('GETs profile, bulkOverwrites context, setThinkingEnabled, sets active + localStorage', async () => {
    const newCtx = { systemInstruction: 'profile sys', skills: ['s'], tools: [], mcpServers: [] };
    server.use(
      http.get('http://localhost/api/profiles/P1', () =>
        HttpResponse.json({
          name: 'P1', createdAt: 1, updatedAt: 1,
          context: newCtx, thinkingEnabled: true,
        }),
      ),
      http.put('http://localhost/api/context', () => HttpResponse.json(newCtx)),
    );
    useProfilesStore.setState({ profiles: [meta('P1')], hydrated: true });
    await useProfilesStore.getState().apply('P1');
    const s = useProfilesStore.getState();
    expect(s.activeProfileId).toBe('P1');
    expect(localStorage.getItem('aether.activeProfileId')).toBe('P1');
    expect(useContextStore.getState().context).toEqual(newCtx);
    expect(useUiStore.getState().thinkingEnabled).toBe(true);
  });

  it('on 404 clears active + refreshes list', async () => {
    server.use(
      http.get('http://localhost/api/profiles/P_GONE', () =>
        HttpResponse.json({ error: { message: 'not found' } }, { status: 404 }),
      ),
      http.get('http://localhost/api/profiles', () => HttpResponse.json({ profiles: [] })),
    );
    useProfilesStore.setState({
      profiles: [meta('P_GONE')], activeProfileId: 'P_GONE', hydrated: true,
    });
    localStorage.setItem('aether.activeProfileId', 'P_GONE');
    await expect(useProfilesStore.getState().apply('P_GONE')).rejects.toThrow();
    expect(useProfilesStore.getState().activeProfileId).toBeNull();
    expect(localStorage.getItem('aether.activeProfileId')).toBeNull();
  });
});

describe('useProfilesStore.saveCurrentToActive', () => {
  it('PUTs current state to active profile', async () => {
    let received: unknown;
    server.use(
      http.put('http://localhost/api/profiles/A1', async ({ request }) => {
        received = await request.json();
        return HttpResponse.json(meta('A1', 'A', 999));
      }),
    );
    useProfilesStore.setState({
      profiles: [meta('A1', 'A')], activeProfileId: 'A1', hydrated: true,
    });
    useUiStore.setState({ thinkingEnabled: true });
    await useProfilesStore.getState().saveCurrentToActive();
    expect(received).toMatchObject({ name: 'A', context: ctx, thinkingEnabled: true });
    expect(useProfilesStore.getState().profiles[0].updatedAt).toBe(999);
  });

  it('throws when no active profile', async () => {
    useProfilesStore.setState({ profiles: [], activeProfileId: null, hydrated: true });
    await expect(useProfilesStore.getState().saveCurrentToActive()).rejects.toThrow();
    expect(useProfilesStore.getState().error).toBeTruthy();
  });
});

describe('useProfilesStore.rename', () => {
  it('optimistic update then PATCH', async () => {
    useProfilesStore.setState({ profiles: [meta('A1', 'old')], hydrated: true });
    server.use(
      http.patch('http://localhost/api/profiles/:id', ({ params }) =>
        HttpResponse.json(meta(params.id as string, 'new')),
      ),
    );
    await useProfilesStore.getState().rename('A1', 'new');
    expect(useProfilesStore.getState().profiles[0].name).toBe('new');
  });

  it('rolls back on failure', async () => {
    useProfilesStore.setState({ profiles: [meta('A1', 'old')], hydrated: true });
    server.use(
      http.patch('http://localhost/api/profiles/:id', () =>
        HttpResponse.json({ error: { message: 'bad' } }, { status: 400 }),
      ),
    );
    await expect(useProfilesStore.getState().rename('A1', '')).rejects.toThrow();
    expect(useProfilesStore.getState().profiles[0].name).toBe('old');
    expect(useProfilesStore.getState().error).toBeTruthy();
  });
});

describe('useProfilesStore.delete', () => {
  it('removes and clears active if matched', async () => {
    useProfilesStore.setState({
      profiles: [meta('A1'), meta('A2')], activeProfileId: 'A1', hydrated: true,
    });
    localStorage.setItem('aether.activeProfileId', 'A1');
    server.use(
      http.delete('http://localhost/api/profiles/A1', () => new HttpResponse(null, { status: 204 })),
    );
    await useProfilesStore.getState().delete('A1');
    const s = useProfilesStore.getState();
    expect(s.profiles.map((p) => p.id)).toEqual(['A2']);
    expect(s.activeProfileId).toBeNull();
    expect(localStorage.getItem('aether.activeProfileId')).toBeNull();
  });

  it('removes without clearing active if id does not match', async () => {
    useProfilesStore.setState({
      profiles: [meta('A1'), meta('A2')], activeProfileId: 'A2', hydrated: true,
    });
    server.use(
      http.delete('http://localhost/api/profiles/A1', () => new HttpResponse(null, { status: 204 })),
    );
    await useProfilesStore.getState().delete('A1');
    expect(useProfilesStore.getState().activeProfileId).toBe('A2');
  });

  it('sets error and does not remove on failure', async () => {
    useProfilesStore.setState({ profiles: [meta('A1')], activeProfileId: 'A1', hydrated: true });
    server.use(
      http.delete('http://localhost/api/profiles/A1', () =>
        HttpResponse.json({ error: { message: 'no' } }, { status: 500 }),
      ),
    );
    await expect(useProfilesStore.getState().delete('A1')).rejects.toThrow();
    expect(useProfilesStore.getState().profiles).toHaveLength(1);
    expect(useProfilesStore.getState().error).toBeTruthy();
  });
});

describe('useProfilesStore.exportProfile', () => {
  it('fetches and sanitizes filename', async () => {
    useProfilesStore.setState({ profiles: [meta('P1', 'My/Profile')], hydrated: true });
    let downloadFilename = '';
    const origCreate = document.createElement.bind(document);
    const spy = vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
      const el = origCreate(tag);
      if (tag === 'a') {
        Object.defineProperty(el, 'click', {
          value() {
            downloadFilename = (this as HTMLAnchorElement).download;
          },
        });
      }
      return el;
    });
    server.use(
      http.get('http://localhost/api/profiles/P1', () =>
        HttpResponse.json({
          name: 'My/Profile', createdAt: 1, updatedAt: 1, context: ctx, thinkingEnabled: false,
        }),
      ),
    );
    await useProfilesStore.getState().exportProfile('P1');
    expect(downloadFilename).not.toContain('/');
    expect(downloadFilename).toContain('My_Profile');
    spy.mockRestore();
  });
});

describe('useProfilesStore.importFile', () => {
  it('reads file, parses JSON, POSTs /import, prepends to list', async () => {
    const file = new File(
      [JSON.stringify({ name: 'X', context: ctx, thinkingEnabled: true })],
      'x.json',
      { type: 'application/json' },
    );
    server.use(
      http.post('http://localhost/api/profiles/import', () =>
        HttpResponse.json(meta('IMP', 'X'), { status: 201 }),
      ),
    );
    const created = await useProfilesStore.getState().importFile(file);
    expect(created.id).toBe('IMP');
    expect(useProfilesStore.getState().profiles[0].id).toBe('IMP');
  });

  it('rejects invalid JSON client-side without server call', async () => {
    const file = new File(['not json'], 'bad.json');
    await expect(useProfilesStore.getState().importFile(file)).rejects.toThrow();
    expect(useProfilesStore.getState().error).toMatch(/json/i);
  });

  it('rejects files > 5MB', async () => {
    const big = new File([new ArrayBuffer(5 * 1024 * 1024 + 1)], 'big.json');
    await expect(useProfilesStore.getState().importFile(big)).rejects.toThrow();
    expect(useProfilesStore.getState().error).toMatch(/too large/i);
  });
});

describe('useProfilesStore.clearError', () => {
  it('resets error to null', () => {
    useProfilesStore.setState({ error: 'boom' });
    useProfilesStore.getState().clearError();
    expect(useProfilesStore.getState().error).toBeNull();
  });
});
