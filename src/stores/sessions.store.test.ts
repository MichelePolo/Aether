import { describe, it, expect, beforeEach } from 'vitest';
import { http, HttpResponse } from 'msw';
import { server } from '@/src/test/msw-server';
import { useSessionsStore } from './sessions.store';
import { useChatStore } from './chat.store';

beforeEach(() => {
  useSessionsStore.getState()._reset();
  useChatStore.getState()._reset();
  localStorage.clear();
});

const m = (id: string, title = '') => ({ id, title, createdAt: 1, updatedAt: 2 });

describe('useSessionsStore.init', () => {
  it('creates a new session when server has none', async () => {
    server.use(
      http.get('http://localhost/api/sessions', () => HttpResponse.json({ sessions: [] })),
      http.post('http://localhost/api/sessions', () =>
        HttpResponse.json(m('NEW', ''), { status: 201 }),
      ),
    );
    await useSessionsStore.getState().init();
    const s = useSessionsStore.getState();
    expect(s.activeSessionId).toBe('NEW');
    expect(s.sessions.map((x) => x.id)).toContain('NEW');
    expect(s.hydrated).toBe(true);
  });

  it('preserves activeSessionId from localStorage if still valid', async () => {
    localStorage.setItem('aether.activeSessionId', 'B');
    server.use(
      http.get('http://localhost/api/sessions', () =>
        HttpResponse.json({ sessions: [m('A'), m('B')] }),
      ),
    );
    await useSessionsStore.getState().init();
    expect(useSessionsStore.getState().activeSessionId).toBe('B');
  });

  it('falls back to sessions[0] if stored id is unknown', async () => {
    localStorage.setItem('aether.activeSessionId', 'ZZ');
    server.use(
      http.get('http://localhost/api/sessions', () =>
        HttpResponse.json({ sessions: [m('A'), m('B')] }),
      ),
    );
    await useSessionsStore.getState().init();
    expect(useSessionsStore.getState().activeSessionId).toBe('A');
  });

  it('sets error when GET /api/sessions fails', async () => {
    server.use(
      http.get('http://localhost/api/sessions', () =>
        HttpResponse.json({ error: { message: 'boom' } }, { status: 500 }),
      ),
    );
    await useSessionsStore.getState().init();
    const s = useSessionsStore.getState();
    expect(s.error).toBeTruthy();
    expect(s.hydrated).toBe(true);
  });
});

describe('useSessionsStore.create', () => {
  it('appends new session at top and sets active', async () => {
    useSessionsStore.setState({ sessions: [m('OLD')], activeSessionId: 'OLD', hydrated: true });
    server.use(
      http.post('http://localhost/api/sessions', () =>
        HttpResponse.json(m('NEW', ''), { status: 201 }),
      ),
    );
    const created = await useSessionsStore.getState().create();
    expect(created.id).toBe('NEW');
    const s = useSessionsStore.getState();
    expect(s.sessions.map((x) => x.id)).toEqual(['NEW', 'OLD']);
    expect(s.activeSessionId).toBe('NEW');
    expect(localStorage.getItem('aether.activeSessionId')).toBe('NEW');
  });

  it('sets error on failure', async () => {
    useSessionsStore.setState({ sessions: [], activeSessionId: null, hydrated: true });
    server.use(
      http.post('http://localhost/api/sessions', () =>
        HttpResponse.json({ error: { message: 'no' } }, { status: 500 }),
      ),
    );
    await expect(useSessionsStore.getState().create()).rejects.toThrow();
    expect(useSessionsStore.getState().error).toBeTruthy();
  });
});

describe('useSessionsStore.setActive', () => {
  it('updates active, localStorage, and hydrates chat', async () => {
    useSessionsStore.setState({
      sessions: [m('A'), m('B')], activeSessionId: 'A', hydrated: true,
    });
    server.use(
      http.get('http://localhost/api/sessions/B', () =>
        HttpResponse.json({ messages: [{ id: 'x', role: 'user', text: 'hi', timestamp: 1 }] }),
      ),
    );
    useSessionsStore.getState().setActive('B');
    // setActive is sync; the fetch happens after — give it a tick
    await new Promise((r) => setTimeout(r, 10));
    expect(useSessionsStore.getState().activeSessionId).toBe('B');
    expect(localStorage.getItem('aether.activeSessionId')).toBe('B');
    expect(useChatStore.getState().messages).toHaveLength(1);
  });

  it('no-op when streamingId !== null', async () => {
    useSessionsStore.setState({
      sessions: [m('A'), m('B')], activeSessionId: 'A', hydrated: true,
    });
    useChatStore.setState({ streamingId: 'STREAMING' });
    useSessionsStore.getState().setActive('B');
    expect(useSessionsStore.getState().activeSessionId).toBe('A');
  });

  it('hydration token discards stale fetch', async () => {
    useSessionsStore.setState({
      sessions: [m('A'), m('B'), m('C')], activeSessionId: 'A', hydrated: true,
    });

    let releaseB: () => void = () => {};
    const gateB = new Promise<void>((r) => { releaseB = r; });
    server.use(
      http.get('http://localhost/api/sessions/B', async () => {
        await gateB;
        return HttpResponse.json({ messages: [{ id: 'b', role: 'user', text: 'BBB', timestamp: 1 }] });
      }),
      http.get('http://localhost/api/sessions/C', () =>
        HttpResponse.json({ messages: [{ id: 'c', role: 'user', text: 'CCC', timestamp: 1 }] }),
      ),
    );
    useSessionsStore.getState().setActive('B');
    await new Promise((r) => setTimeout(r, 5));
    useSessionsStore.getState().setActive('C');
    await new Promise((r) => setTimeout(r, 30));
    releaseB();
    await new Promise((r) => setTimeout(r, 30));
    const messages = useChatStore.getState().messages;
    expect(messages.map((x) => x.text)).toEqual(['CCC']); // B's stale fetch ignored
  });
});

describe('useSessionsStore.rename', () => {
  it('optimistic update + persisted', async () => {
    useSessionsStore.setState({ sessions: [m('A', 'old')], activeSessionId: 'A', hydrated: true });
    server.use(
      http.patch('http://localhost/api/sessions/:id', ({ params }) =>
        HttpResponse.json({ id: params.id, title: 'new', createdAt: 1, updatedAt: 2 }),
      ),
    );
    await useSessionsStore.getState().rename('A', 'new');
    expect(useSessionsStore.getState().sessions[0].title).toBe('new');
  });

  it('rolls back on failure', async () => {
    useSessionsStore.setState({ sessions: [m('A', 'old')], activeSessionId: 'A', hydrated: true });
    server.use(
      http.patch('http://localhost/api/sessions/:id', () =>
        HttpResponse.json({ error: { message: 'no' } }, { status: 400 }),
      ),
    );
    await expect(useSessionsStore.getState().rename('A', 'X')).rejects.toThrow();
    expect(useSessionsStore.getState().sessions[0].title).toBe('old');
    expect(useSessionsStore.getState().error).toBeTruthy();
  });
});

describe('useSessionsStore.delete', () => {
  it('removes and auto-switches to next when active is deleted', async () => {
    useSessionsStore.setState({
      sessions: [m('A'), m('B')], activeSessionId: 'A', hydrated: true,
    });
    server.use(
      http.delete('http://localhost/api/sessions/A', () => new HttpResponse(null, { status: 204 })),
      http.get('http://localhost/api/sessions/B', () => HttpResponse.json({ messages: [] })),
    );
    await useSessionsStore.getState().delete('A');
    await new Promise((r) => setTimeout(r, 10));
    const s = useSessionsStore.getState();
    expect(s.sessions.map((x) => x.id)).toEqual(['B']);
    expect(s.activeSessionId).toBe('B');
  });

  it('auto-creates new session when last is deleted', async () => {
    useSessionsStore.setState({
      sessions: [m('A')], activeSessionId: 'A', hydrated: true,
    });
    server.use(
      http.delete('http://localhost/api/sessions/A', () => new HttpResponse(null, { status: 204 })),
      http.post('http://localhost/api/sessions', () =>
        HttpResponse.json(m('NEW'), { status: 201 }),
      ),
      http.get('http://localhost/api/sessions/NEW', () => HttpResponse.json({ messages: [] })),
    );
    await useSessionsStore.getState().delete('A');
    await new Promise((r) => setTimeout(r, 10));
    const s = useSessionsStore.getState();
    expect(s.sessions.map((x) => x.id)).toEqual(['NEW']);
    expect(s.activeSessionId).toBe('NEW');
  });

  it('sets error on failure, no removal', async () => {
    useSessionsStore.setState({ sessions: [m('A')], activeSessionId: 'A', hydrated: true });
    server.use(
      http.delete('http://localhost/api/sessions/A', () =>
        HttpResponse.json({ error: { message: 'no' } }, { status: 500 }),
      ),
    );
    await expect(useSessionsStore.getState().delete('A')).rejects.toThrow();
    expect(useSessionsStore.getState().sessions).toHaveLength(1);
    expect(useSessionsStore.getState().error).toBeTruthy();
  });
});

describe('useSessionsStore.touchUpdatedAt + setLocalTitle', () => {
  it('touchUpdatedAt bumps the session to the top', () => {
    useSessionsStore.setState({
      sessions: [
        { id: 'A', title: 'a', createdAt: 1, updatedAt: 1 },
        { id: 'B', title: 'b', createdAt: 1, updatedAt: 100 },
      ],
      activeSessionId: 'A', hydrated: true,
    });
    useSessionsStore.getState().touchUpdatedAt('A', 200);
    expect(useSessionsStore.getState().sessions[0].id).toBe('A');
  });

  it('setLocalTitle updates only the title locally', () => {
    useSessionsStore.setState({
      sessions: [{ id: 'A', title: '', createdAt: 1, updatedAt: 1 }],
      activeSessionId: 'A', hydrated: true,
    });
    useSessionsStore.getState().setLocalTitle('A', 'computed');
    expect(useSessionsStore.getState().sessions[0].title).toBe('computed');
  });
});

describe('useSessionsStore.clearError', () => {
  it('resets error to null', () => {
    useSessionsStore.setState({ sessions: [], activeSessionId: null, hydrated: true, error: 'oops' });
    useSessionsStore.getState().clearError();
    expect(useSessionsStore.getState().error).toBeNull();
  });
});

describe('useSessionsStore.forkSession', () => {
  it('success: prepends forked session and activates it', async () => {
    const existing = m('existing', 'Existing');
    useSessionsStore.setState({
      sessions: [existing],
      activeSessionId: 'existing',
      hydrated: true,
    });
    const forked = m('forked-1', 'Fork');
    server.use(
      http.post('http://localhost/api/sessions/:id/fork', () =>
        HttpResponse.json({ meta: forked }, { status: 201 }),
      ),
      http.get('http://localhost/api/sessions/forked-1', () =>
        HttpResponse.json({ messages: [] }),
      ),
    );
    await useSessionsStore.getState().forkSession('msg-42');
    const s = useSessionsStore.getState();
    expect(s.sessions[0].id).toBe('forked-1');
    expect(s.activeSessionId).toBe('forked-1');
    expect(s.error).toBeNull();
  });

  it('server failure sets error', async () => {
    useSessionsStore.setState({
      sessions: [m('existing')],
      activeSessionId: 'existing',
      hydrated: true,
    });
    server.use(
      http.post('http://localhost/api/sessions/:id/fork', () =>
        HttpResponse.json({ error: { message: 'fork error' } }, { status: 500 }),
      ),
    );
    await useSessionsStore.getState().forkSession('msg-42');
    const s = useSessionsStore.getState();
    expect(s.error).toMatch(/Fork failed/);
    expect(s.activeSessionId).toBe('existing'); // unchanged
  });

  it('no-op when no active session', async () => {
    useSessionsStore.setState({
      sessions: [],
      activeSessionId: null,
      hydrated: true,
    });
    await useSessionsStore.getState().forkSession('msg-42');
    const s = useSessionsStore.getState();
    expect(s.sessions).toHaveLength(0);
    expect(s.error).toBeNull();
  });
});

describe('useSessionsStore.setActive clears error', () => {
  it('clears error when switching sessions', () => {
    useSessionsStore.setState({
      sessions: [m('A'), m('B')], activeSessionId: 'A', hydrated: true, error: 'leftover',
    });
    server.use(
      http.get('http://localhost/api/sessions/B', () => HttpResponse.json({ messages: [] })),
    );
    useSessionsStore.getState().setActive('B');
    expect(useSessionsStore.getState().error).toBeNull();
  });
});

describe('useSessionsStore.setProviderName', () => {
  it('setProviderName updates the session optimistically and PATCHes', async () => {
    useSessionsStore.setState({
      sessions: [{ id: 'S1', title: 't', createdAt: 0, updatedAt: 0 }],
      activeSessionId: 'S1',
      hydrated: true,
    });
    let posted: unknown = null;
    server.use(
      http.patch('http://localhost/api/sessions/S1', async ({ request }) => {
        posted = await request.json();
        return HttpResponse.json({ id: 'S1', title: 't', createdAt: 0, updatedAt: 1 });
      }),
    );
    await useSessionsStore.getState().setProviderName('S1', 'ollama:llama3');
    expect(posted).toEqual({ providerName: 'ollama:llama3' });
    const after = useSessionsStore.getState().sessions.find((s) => s.id === 'S1');
    expect((after as { providerName?: string })?.providerName).toBe('ollama:llama3');
  });

  it('setProviderName rolls back on error', async () => {
    useSessionsStore.setState({
      sessions: [{ id: 'S1', title: 't', createdAt: 0, updatedAt: 0 }],
      activeSessionId: 'S1',
      hydrated: true,
    });
    server.use(
      http.patch('http://localhost/api/sessions/S1', () =>
        HttpResponse.json({ error: { message: 'Boom' } }, { status: 500 }),
      ),
    );
    await expect(useSessionsStore.getState().setProviderName('S1', 'ollama:llama3')).rejects.toThrow();
    expect(useSessionsStore.getState().error).toBeTruthy();
  });
});

describe('useSessionsStore.importSession', () => {
  it('prepends imported session, sets active, clears error on success', async () => {
    useSessionsStore.setState({
      sessions: [m('OLD')], activeSessionId: 'OLD', hydrated: true, error: 'leftover',
    });
    server.use(
      http.post('http://localhost/api/sessions/import', () =>
        HttpResponse.json(
          { id: 'new-imp', title: 'imp', createdAt: 1, updatedAt: 2 },
          { status: 201 },
        ),
      ),
      http.get('http://localhost/api/sessions/new-imp', () =>
        HttpResponse.json({ messages: [] }),
      ),
    );
    const file = new File([JSON.stringify({ version: 1 })], 'export.json', { type: 'application/json' });
    await useSessionsStore.getState().importSession(file);
    const s = useSessionsStore.getState();
    expect(s.sessions.map((x) => x.id)).toEqual(['new-imp', 'OLD']);
    expect(s.activeSessionId).toBe('new-imp');
    expect(s.error).toBeNull();
  });

  it('sets error matching /invalid JSON/ when file is not valid JSON', async () => {
    useSessionsStore.setState({ sessions: [], activeSessionId: null, hydrated: true });
    let postCalled = false;
    server.use(
      http.post('http://localhost/api/sessions/import', () => {
        postCalled = true;
        return HttpResponse.json({}, { status: 201 });
      }),
    );
    const file = new File(['NOT_JSON{{'], 'bad.json', { type: 'application/json' });
    await useSessionsStore.getState().importSession(file);
    expect(useSessionsStore.getState().error).toMatch(/invalid JSON/i);
    expect(postCalled).toBe(false);
  });

  it('sets error containing server message on server 400', async () => {
    useSessionsStore.setState({ sessions: [], activeSessionId: null, hydrated: true });
    server.use(
      http.post('http://localhost/api/sessions/import', () =>
        HttpResponse.json({ error: { message: 'nope' } }, { status: 400 }),
      ),
    );
    const file = new File([JSON.stringify({ version: 1 })], 'export.json', { type: 'application/json' });
    await useSessionsStore.getState().importSession(file);
    expect(useSessionsStore.getState().error).toMatch(/nope/);
  });
});

describe('useSessionsStore edge cases', () => {
  it('init: falls back to "Operation failed" when API throws a non-Error', async () => {
    // Force fetch to reject with a non-Error value so errMsg returns the default string.
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (() => Promise.reject('boom-string')) as typeof fetch;
    try {
      await useSessionsStore.getState().init();
    } finally {
      globalThis.fetch = originalFetch;
    }
    expect(useSessionsStore.getState().error).toBe('Operation failed');
    expect(useSessionsStore.getState().hydrated).toBe(true);
  });

  it('init: hydrates chat with [] when history fetch fails and chat is empty', async () => {
    server.use(
      http.get('http://localhost/api/sessions', () =>
        HttpResponse.json({ sessions: [m('A')] }),
      ),
      http.get('http://localhost/api/sessions/A', () =>
        HttpResponse.json({ error: { message: 'no' } }, { status: 500 }),
      ),
    );
    await useSessionsStore.getState().init();
    await new Promise((r) => setTimeout(r, 20));
    expect(useChatStore.getState().messages).toEqual([]);
  });

  it('setActive: hydrates chat with [] when fetchById fails', async () => {
    useSessionsStore.setState({
      sessions: [m('A'), m('B')], activeSessionId: 'A', hydrated: true,
    });
    useChatStore.setState({
      messages: [{ id: 'old', role: 'user', text: 'old', timestamp: 1 }],
    });
    server.use(
      http.get('http://localhost/api/sessions/B', () =>
        HttpResponse.json({ error: { message: 'no' } }, { status: 500 }),
      ),
    );
    useSessionsStore.getState().setActive('B');
    await new Promise((r) => setTimeout(r, 20));
    expect(useChatStore.getState().messages).toEqual([]);
  });

  it('setActive: no-op when the requested id is already active', async () => {
    useSessionsStore.setState({
      sessions: [m('A'), m('B')], activeSessionId: 'A', hydrated: true,
    });
    // No MSW handler installed — if setActive tried to hydrate, msw strict-mode would throw.
    useSessionsStore.getState().setActive('A');
    expect(useSessionsStore.getState().activeSessionId).toBe('A');
  });

  it('delete: removes non-active without auto-switching', async () => {
    useSessionsStore.setState({
      sessions: [m('A'), m('B')], activeSessionId: 'A', hydrated: true,
    });
    server.use(
      http.delete('http://localhost/api/sessions/B', () => new HttpResponse(null, { status: 204 })),
    );
    await useSessionsStore.getState().delete('B');
    const s = useSessionsStore.getState();
    expect(s.sessions.map((x) => x.id)).toEqual(['A']);
    expect(s.activeSessionId).toBe('A');
  });

  it('rename: leaves other sessions untouched (optimistic map else-branch)', async () => {
    useSessionsStore.setState({
      sessions: [m('A', 'a'), m('B', 'b')], activeSessionId: 'A', hydrated: true,
    });
    server.use(
      http.patch('http://localhost/api/sessions/A', () =>
        HttpResponse.json({ id: 'A', title: 'new-a', createdAt: 1, updatedAt: 2 }),
      ),
    );
    await useSessionsStore.getState().rename('A', 'new-a');
    const s = useSessionsStore.getState();
    expect(s.sessions.find((x) => x.id === 'A')?.title).toBe('new-a');
    expect(s.sessions.find((x) => x.id === 'B')?.title).toBe('b');
  });

  it('setLocalTitle: leaves other sessions untouched', () => {
    useSessionsStore.setState({
      sessions: [m('A', ''), m('B', 'b')], activeSessionId: 'A', hydrated: true,
    });
    useSessionsStore.getState().setLocalTitle('A', 'new');
    expect(useSessionsStore.getState().sessions.find((x) => x.id === 'B')?.title).toBe('b');
  });

  it('setActive does not clobber chat messages with empty hydrate', async () => {
    useSessionsStore.setState({
      sessions: [m('A'), m('B')], activeSessionId: 'A', hydrated: true,
    });
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => { release = r; });
    server.use(
      http.get('http://localhost/api/sessions/B', async () => {
        await gate;
        return HttpResponse.json({ messages: [] });
      }),
    );
    useSessionsStore.getState().setActive('B');
    await new Promise((r) => setTimeout(r, 5));
    // User types something while hydrate is pending
    useChatStore.getState().appendUser('typed during hydrate');
    release();
    await new Promise((r) => setTimeout(r, 30));
    expect(useChatStore.getState().messages.map((x) => x.text)).toEqual(['typed during hydrate']);
  });

  it('init: ignores localStorage when read throws', async () => {
    const orig = Storage.prototype.getItem;
    Storage.prototype.getItem = function () { throw new Error('blocked'); };
    server.use(
      http.get('http://localhost/api/sessions', () =>
        HttpResponse.json({ sessions: [m('A'), m('B')] }),
      ),
    );
    try {
      await useSessionsStore.getState().init();
    } finally {
      Storage.prototype.getItem = orig;
    }
    // Falls back to sessions[0] when localStorage read fails.
    expect(useSessionsStore.getState().activeSessionId).toBe('A');
  });
});
