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
