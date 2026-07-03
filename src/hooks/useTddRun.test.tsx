import { describe, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { server } from '@/src/test/msw-server';
import { useTddRun } from './useTddRun';

function sseStream(...lines: string[]) {
  const enc = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(c) {
      for (const l of lines) c.enqueue(enc.encode(l));
      c.close();
    },
  });
}

const REQ = { command: 'npm test', subAgentName: 'tester' };

describe('useTddRun', () => {
  it('resets running to false and sets error on a non-2xx response (not stuck)', async () => {
    server.use(
      http.post('http://localhost/api/tdd/run', () =>
        HttpResponse.json({ error: { message: 'boom' } }, { status: 500 }),
      ),
    );
    const { result } = renderHook(() => useTddRun());
    await act(async () => {
      await result.current.run(REQ);
    });
    expect(result.current.state.running).toBe(false);
    expect(result.current.state.error).toBe('boom');
  });

  it('resets running to false when the stream ends without tdd_done', async () => {
    server.use(
      http.post('http://localhost/api/tdd/run', () =>
        new HttpResponse(
          sseStream('event: tdd_iteration_started\ndata: {"iteration":0}\n\n'),
          { headers: { 'Content-Type': 'text/event-stream' } },
        ),
      ),
    );
    const { result } = renderHook(() => useTddRun());
    await act(async () => {
      await result.current.run(REQ);
    });
    expect(result.current.state.running).toBe(false);
    expect(result.current.state.currentIteration).toBe(0);
  });

  it('resets running to false and sets the error on a network error', async () => {
    server.use(http.post('http://localhost/api/tdd/run', () => HttpResponse.error()));
    const { result } = renderHook(() => useTddRun());
    await act(async () => {
      await result.current.run(REQ);
    });
    expect(result.current.state.running).toBe(false);
    expect(result.current.state.error).toBeTruthy();
  });

  it('runs to completion via tdd_done', async () => {
    server.use(
      http.post('http://localhost/api/tdd/run', () =>
        new HttpResponse(sseStream('event: tdd_done\ndata: {"status":"success"}\n\n'), {
          headers: { 'Content-Type': 'text/event-stream' },
        }),
      ),
    );
    const { result } = renderHook(() => useTddRun());
    await act(async () => {
      await result.current.run(REQ);
    });
    expect(result.current.state.running).toBe(false);
    expect(result.current.state.status).toBe('success');
    expect(result.current.state.error).toBeNull();
  });

  it('does not let a superseded run clobber a newer run\'s running state', async () => {
    // Run A: an open stream we control and end manually (no tdd_done — simulates
    // the "settles after being superseded" case regardless of abort timing).
    let closeA: (() => void) | null = null;
    const streamA = new ReadableStream<Uint8Array>({
      start(c) {
        closeA = () => c.close();
      },
    });
    server.use(
      http.post('http://localhost/api/tdd/run', () =>
        new HttpResponse(streamA, { headers: { 'Content-Type': 'text/event-stream' } }),
      ),
      { once: true },
    );

    const { result } = renderHook(() => useTddRun());

    let runAPromise!: Promise<void>;
    act(() => {
      runAPromise = result.current.run(REQ);
    });
    // let run A's fetch actually get issued before starting run B
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    // Run B: a second open stream, still in flight when A settles.
    let closeB: (() => void) | null = null;
    const streamB = new ReadableStream<Uint8Array>({
      start(c) {
        closeB = () => c.close();
      },
    });
    server.use(
      http.post('http://localhost/api/tdd/run', () =>
        new HttpResponse(streamB, { headers: { 'Content-Type': 'text/event-stream' } }),
      ),
      { once: true },
    );

    let runBPromise!: Promise<void>;
    act(() => {
      // supersedes A: aborts A's controller, sets running:true for B
      runBPromise = result.current.run(REQ);
    });

    // Now let A's (superseded) request settle.
    await act(async () => {
      closeA?.();
      await runAPromise;
    });

    // B is still running — A's late settlement must not have clobbered it.
    expect(result.current.state.running).toBe(true);

    await act(async () => {
      closeB?.();
      await runBPromise;
    });
    expect(result.current.state.running).toBe(false);
  });
});
