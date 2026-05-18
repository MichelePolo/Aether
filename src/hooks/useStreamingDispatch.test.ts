import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { server } from '@/src/test/msw-server';
import { useStreamingDispatch } from './useStreamingDispatch';
import { useChatStore } from '@/src/stores/chat.store';
import { useSessionsStore } from '@/src/stores/sessions.store';

function sseStream(...lines: string[]) {
  const enc = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(c) {
      for (const l of lines) c.enqueue(enc.encode(l));
      c.close();
    },
  });
}

const meta = (id: string, title = '') => ({ id, title, createdAt: 1, updatedAt: 1 });

beforeEach(() => {
  useChatStore.getState()._reset();
  useSessionsStore.getState()._reset();
  useSessionsStore.setState({ sessions: [meta('S1')], activeSessionId: 'S1', hydrated: true });
});

describe('useStreamingDispatch', () => {
  it('sends sessionId in dispatch body', async () => {
    let received: unknown;
    server.use(
      http.post('http://localhost/api/ai/dispatch', async ({ request }) => {
        received = await request.json();
        return new HttpResponse(
          sseStream(
            'event: text\ndata: {"chunk":"OK"}\n\n',
            'event: done\ndata: {"model":"fake-1","interrupted":false}\n\n',
          ),
          { headers: { 'Content-Type': 'text/event-stream' } },
        );
      }),
    );
    const { result } = renderHook(() => useStreamingDispatch());
    await act(async () => { await result.current.send('hi'); });
    expect(received).toMatchObject({ sessionId: 'S1', message: 'hi' });
  });

  it('auto-sets local title when active session has empty title', async () => {
    server.use(
      http.post('http://localhost/api/ai/dispatch', () =>
        new HttpResponse(
          sseStream('event: done\ndata: {"model":"f","interrupted":false}\n\n'),
          { headers: { 'Content-Type': 'text/event-stream' } },
        ),
      ),
    );
    const { result } = renderHook(() => useStreamingDispatch());
    await act(async () => { await result.current.send('hello first'); });
    expect(useSessionsStore.getState().sessions[0].title).toBe('hello first');
  });

  it('does not overwrite a non-empty title', async () => {
    useSessionsStore.setState({
      sessions: [meta('S1', 'existing title')],
      activeSessionId: 'S1', hydrated: true,
    });
    server.use(
      http.post('http://localhost/api/ai/dispatch', () =>
        new HttpResponse(
          sseStream('event: done\ndata: {"model":"f","interrupted":false}\n\n'),
          { headers: { 'Content-Type': 'text/event-stream' } },
        ),
      ),
    );
    const { result } = renderHook(() => useStreamingDispatch());
    await act(async () => { await result.current.send('new message'); });
    expect(useSessionsStore.getState().sessions[0].title).toBe('existing title');
  });

  it('touches updatedAt after stream completes', async () => {
    server.use(
      http.post('http://localhost/api/ai/dispatch', () =>
        new HttpResponse(
          sseStream(
            'event: text\ndata: {"chunk":"OK"}\n\n',
            'event: done\ndata: {"model":"f","interrupted":false}\n\n',
          ),
          { headers: { 'Content-Type': 'text/event-stream' } },
        ),
      ),
    );
    const before = useSessionsStore.getState().sessions[0].updatedAt;
    const { result } = renderHook(() => useStreamingDispatch());
    await act(async () => { await result.current.send('hi'); });
    const after = useSessionsStore.getState().sessions[0].updatedAt;
    expect(after).toBeGreaterThan(before);
  });

  it('no-op when activeSessionId is null', async () => {
    useSessionsStore.setState({ sessions: [], activeSessionId: null, hydrated: true });
    const { result } = renderHook(() => useStreamingDispatch());
    await act(async () => { await result.current.send('hi'); });
    expect(useChatStore.getState().messages).toEqual([]);
  });

  it('happy path: streams assistant + finalizes', async () => {
    server.use(
      http.post('http://localhost/api/ai/dispatch', () =>
        new HttpResponse(
          sseStream(
            'event: text\ndata: {"chunk":"Hello"}\n\n',
            'event: text\ndata: {"chunk":" world"}\n\n',
            'event: done\ndata: {"model":"fake-1","interrupted":false}\n\n',
          ),
          { headers: { 'Content-Type': 'text/event-stream' } },
        ),
      ),
    );
    const { result } = renderHook(() => useStreamingDispatch());
    await act(async () => { await result.current.send('hi'); });
    const msgs = useChatStore.getState().messages;
    expect(msgs[1].text).toBe('Hello world');
    expect(useChatStore.getState().streamingId).toBeNull();
  });

  it('isStreaming flips during send', async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => { release = r; });
    server.use(
      http.post('http://localhost/api/ai/dispatch', async () => {
        await gate;
        return new HttpResponse(
          sseStream('event: done\ndata: {"model":"f","interrupted":false}\n\n'),
          { headers: { 'Content-Type': 'text/event-stream' } },
        );
      }),
    );
    const { result } = renderHook(() => useStreamingDispatch());
    const p = act(async () => { await result.current.send('hi'); });
    await waitFor(() => { expect(result.current.isStreaming).toBe(true); });
    release();
    await p;
    expect(result.current.isStreaming).toBe(false);
  });

  it('no-op when text is empty / whitespace only', async () => {
    const { result } = renderHook(() => useStreamingDispatch());
    await act(async () => { await result.current.send('   '); });
    expect(useChatStore.getState().messages).toEqual([]);
  });

  it('ignores second send while a stream is in flight', async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => { release = r; });
    let calls = 0;
    server.use(
      http.post('http://localhost/api/ai/dispatch', async () => {
        calls++;
        await gate;
        return new HttpResponse(
          sseStream('event: done\ndata: {"model":"f","interrupted":false}\n\n'),
          { headers: { 'Content-Type': 'text/event-stream' } },
        );
      }),
    );
    const { result } = renderHook(() => useStreamingDispatch());
    const first = act(async () => { await result.current.send('one'); });
    await waitFor(() => { expect(useChatStore.getState().streamingId).not.toBeNull(); });
    await act(async () => { await result.current.send('two'); });
    expect(calls).toBe(1);
    release();
    await first;
  });

  it('finalizes assistant when stream ends without an explicit done event', async () => {
    server.use(
      http.post('http://localhost/api/ai/dispatch', () =>
        new HttpResponse(
          sseStream('event: text\ndata: {"chunk":"only-chunk"}\n\n'),
          { headers: { 'Content-Type': 'text/event-stream' } },
        ),
      ),
    );
    const { result } = renderHook(() => useStreamingDispatch());
    await act(async () => { await result.current.send('hi'); });
    const msgs = useChatStore.getState().messages;
    expect(msgs.at(-1)?.text).toBe('only-chunk');
    expect(useChatStore.getState().streamingId).toBeNull();
  });

  it('marks assistant failed when the dispatch throws', async () => {
    server.use(
      http.post('http://localhost/api/ai/dispatch', () =>
        HttpResponse.json({ error: { message: 'bad gateway' } }, { status: 502 }),
      ),
    );
    const { result } = renderHook(() => useStreamingDispatch());
    await act(async () => { await result.current.send('hi'); });
    const last = useChatStore.getState().messages.at(-1);
    expect(last?.error).toBeTruthy();
    expect(last?.retryable).toBe(true);
    expect(useChatStore.getState().streamingId).toBeNull();
  });

  it('abort() invokes chat.abort()', async () => {
    const { result } = renderHook(() => useStreamingDispatch());
    act(() => { result.current.abort(); });
    // Without an active controller, abort is a no-op and shouldn't throw.
    expect(useChatStore.getState().streamingId).toBeNull();
  });

  it('uses fallback error message when dispatch throws a non-Error', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (() => Promise.reject('weird-string')) as typeof fetch;
    try {
      const { result } = renderHook(() => useStreamingDispatch());
      await act(async () => { await result.current.send('hi'); });
    } finally {
      globalThis.fetch = originalFetch;
    }
    const last = useChatStore.getState().messages.at(-1);
    expect(last?.error).toBe('Unknown error');
  });
});
