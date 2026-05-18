import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { server } from '@/src/test/msw-server';
import { useStreamingDispatch } from './useStreamingDispatch';
import { useChatStore } from '@/src/stores/chat.store';

function sseStream(...lines: string[]) {
  const enc = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(c) {
      for (const l of lines) c.enqueue(enc.encode(l));
      c.close();
    },
  });
}

beforeEach(() => {
  useChatStore.getState()._reset();
});

describe('useStreamingDispatch', () => {
  it('happy path: appends user + streams assistant + finalizes', async () => {
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
    await act(async () => {
      await result.current.send('hi');
    });
    const msgs = useChatStore.getState().messages;
    expect(msgs).toHaveLength(2);
    expect(msgs[0]).toMatchObject({ role: 'user', text: 'hi' });
    expect(msgs[1]).toMatchObject({ role: 'model', text: 'Hello world', model: 'fake-1' });
    expect(useChatStore.getState().streamingId).toBeNull();
  });

  it('error event marks message as failed with retryable flag', async () => {
    server.use(
      http.post('http://localhost/api/ai/dispatch', () =>
        new HttpResponse(
          sseStream('event: error\ndata: {"message":"Auth failed","retryable":false}\n\n'),
          { headers: { 'Content-Type': 'text/event-stream' } },
        ),
      ),
    );
    const { result } = renderHook(() => useStreamingDispatch());
    await act(async () => {
      await result.current.send('hi');
    });
    const last = useChatStore.getState().messages.at(-1);
    expect(last?.error).toBe('Auth failed');
    expect(last?.retryable).toBe(false);
  });

  it('abort marks message interrupted', async () => {
    server.use(
      http.post('http://localhost/api/ai/dispatch', async () =>
        new HttpResponse(
          sseStream('event: text\ndata: {"chunk":"A"}\n\n'),
          { headers: { 'Content-Type': 'text/event-stream' } },
        ),
      ),
    );
    const { result } = renderHook(() => useStreamingDispatch());
    const promise = act(async () => {
      const p = result.current.send('hi');
      result.current.abort();
      await p;
    });
    await promise;
    await waitFor(() => {
      expect(useChatStore.getState().streamingId).toBeNull();
    });
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
    await waitFor(() => {
      expect(result.current.isStreaming).toBe(true);
    });
    release();
    await p;
    expect(result.current.isStreaming).toBe(false);
  });
});
