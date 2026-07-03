import { describe, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { server } from '@/src/test/msw-server';
import { useSwarmRun } from './useSwarmRun';

function sseStream(...lines: string[]) {
  const enc = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(c) {
      for (const l of lines) c.enqueue(enc.encode(l));
      c.close();
    },
  });
}

describe('useSwarmRun', () => {
  it('resets running to false and sets error on a non-2xx response (not stuck)', async () => {
    server.use(
      http.post('http://localhost/api/swarms/:id/run', () =>
        HttpResponse.json({ error: { message: 'boom' } }, { status: 500 }),
      ),
    );
    const { result } = renderHook(() => useSwarmRun());
    await act(async () => {
      await result.current.run('s1', 'do it');
    });
    expect(result.current.state.running).toBe(false);
    expect(result.current.state.error).toBe('boom');
  });

  it('resets running to false when the stream ends without swarm_done', async () => {
    server.use(
      http.post('http://localhost/api/swarms/:id/run', () =>
        new HttpResponse(
          sseStream('event: swarm_step_started\ndata: {"position":0,"subAgent":"a"}\n\n'),
          { headers: { 'Content-Type': 'text/event-stream' } },
        ),
      ),
    );
    const { result } = renderHook(() => useSwarmRun());
    await act(async () => {
      await result.current.run('s1', 'do it');
    });
    expect(result.current.state.running).toBe(false);
    expect(result.current.state.steps).toHaveLength(1);
  });

  it('resets running to false and clears the error on a network error', async () => {
    server.use(
      http.post('http://localhost/api/swarms/:id/run', () => HttpResponse.error()),
    );
    const { result } = renderHook(() => useSwarmRun());
    await act(async () => {
      await result.current.run('s1', 'do it');
    });
    expect(result.current.state.running).toBe(false);
    expect(result.current.state.error).toBeTruthy();
  });

  it('runs to completion via swarm_done', async () => {
    server.use(
      http.post('http://localhost/api/swarms/:id/run', () =>
        new HttpResponse(sseStream('event: swarm_done\ndata: {"status":"completed"}\n\n'), {
          headers: { 'Content-Type': 'text/event-stream' },
        }),
      ),
    );
    const { result } = renderHook(() => useSwarmRun());
    await act(async () => {
      await result.current.run('s1', 'do it');
    });
    expect(result.current.state.running).toBe(false);
    expect(result.current.state.status).toBe('completed');
    expect(result.current.state.error).toBeNull();
  });
});
