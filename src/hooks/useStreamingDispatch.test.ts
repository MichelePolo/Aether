import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { server } from '@/src/test/msw-server';
import { useStreamingDispatch } from './useStreamingDispatch';
import { useChatStore } from '@/src/stores/chat.store';
import { useSessionsStore } from '@/src/stores/sessions.store';
import { useUiStore } from '@/src/stores/ui.store';

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
  useUiStore.getState()._reset();
  useSessionsStore.setState({ sessions: [meta('S1')], activeSessionId: 'S1', hydrated: true });
  localStorage.clear();
});

describe('useStreamingDispatch', () => {
  it('sends sessionId + thinking (false by default)', async () => {
    let received: unknown;
    server.use(
      http.post('http://localhost/api/ai/dispatch', async ({ request }) => {
        received = await request.json();
        return new HttpResponse(
          sseStream('event: done\ndata: {"model":"f","interrupted":false}\n\n'),
          { headers: { 'Content-Type': 'text/event-stream' } },
        );
      }),
    );
    const { result } = renderHook(() => useStreamingDispatch());
    await act(async () => { await result.current.send('hi'); });
    expect(received).toMatchObject({ sessionId: 'S1', message: 'hi', thinking: false });
  });

  it('sends thinking=true when useUiStore.thinkingEnabled is true', async () => {
    useUiStore.getState().setThinkingEnabled(true);
    let received: unknown;
    server.use(
      http.post('http://localhost/api/ai/dispatch', async ({ request }) => {
        received = await request.json();
        return new HttpResponse(
          sseStream('event: done\ndata: {"model":"f","interrupted":false}\n\n'),
          { headers: { 'Content-Type': 'text/event-stream' } },
        );
      }),
    );
    const { result } = renderHook(() => useStreamingDispatch());
    await act(async () => { await result.current.send('hi'); });
    expect((received as { thinking?: boolean }).thinking).toBe(true);
  });

  it('event:thinking opens drawer + accumulates thinkingText', async () => {
    server.use(
      http.post('http://localhost/api/ai/dispatch', () =>
        new HttpResponse(
          sseStream(
            'event: thinking\ndata: {"chunk":"pondering"}\n\n',
            'event: thinking\ndata: {"chunk":" more"}\n\n',
            'event: done\ndata: {"model":"f","interrupted":false}\n\n',
          ),
          { headers: { 'Content-Type': 'text/event-stream' } },
        ),
      ),
    );
    expect(useUiStore.getState().reasoningDrawerOpen).toBe(false);
    const { result } = renderHook(() => useStreamingDispatch());
    await act(async () => { await result.current.send('hi'); });
    // drawer auto-opened
    expect(useUiStore.getState().reasoningDrawerOpen).toBe(true);
  });

  it('event:reasoning_step accumulates in currentReasoning (during stream)', async () => {
    server.use(
      http.post('http://localhost/api/ai/dispatch', () =>
        new HttpResponse(
          sseStream(
            'event: reasoning_step\ndata: {"id":"a","type":"context_fetch","title":"Read","content":"ok","timestamp":1}\n\n',
            'event: text\ndata: {"chunk":"hello"}\n\n',
            'event: done\ndata: {"model":"f","interrupted":false,"reasoningSteps":[{"id":"a","type":"context_fetch","title":"Read","content":"ok","timestamp":1}]}\n\n',
          ),
          { headers: { 'Content-Type': 'text/event-stream' } },
        ),
      ),
    );
    const { result } = renderHook(() => useStreamingDispatch());
    await act(async () => { await result.current.send('hi'); });
    const last = useChatStore.getState().messages.at(-1);
    expect(last?.reasoningSteps).toHaveLength(1);
  });

  it('done.reasoningSteps attached to message', async () => {
    server.use(
      http.post('http://localhost/api/ai/dispatch', () =>
        new HttpResponse(
          sseStream(
            'event: text\ndata: {"chunk":"OK"}\n\n',
            'event: done\ndata: {"model":"f","interrupted":false,"reasoningSteps":[{"id":"a","type":"validation","title":"V","content":"ok","timestamp":1}]}\n\n',
          ),
          { headers: { 'Content-Type': 'text/event-stream' } },
        ),
      ),
    );
    const { result } = renderHook(() => useStreamingDispatch());
    await act(async () => { await result.current.send('hi'); });
    expect(useChatStore.getState().messages.at(-1)?.reasoningSteps).toEqual([
      { id: 'a', type: 'validation', title: 'V', content: 'ok', timestamp: 1 },
    ]);
  });

  it('no-op when activeSessionId is null', async () => {
    useSessionsStore.setState({ sessions: [], activeSessionId: null, hydrated: true });
    const { result } = renderHook(() => useStreamingDispatch());
    await act(async () => { await result.current.send('hi'); });
    expect(useChatStore.getState().messages).toEqual([]);
  });

  it('clears focusedMessageId at start of send', async () => {
    useUiStore.getState().setFocusedMessageId('m-old');
    server.use(
      http.post('http://localhost/api/ai/dispatch', () =>
        new HttpResponse(
          sseStream('event: done\ndata: {"model":"f","interrupted":false}\n\n'),
          { headers: { 'Content-Type': 'text/event-stream' } },
        ),
      ),
    );
    const { result } = renderHook(() => useStreamingDispatch());
    await act(async () => { await result.current.send('hi'); });
    expect(useUiStore.getState().focusedMessageId).toBeNull();
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
});
