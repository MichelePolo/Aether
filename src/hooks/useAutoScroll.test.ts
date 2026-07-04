import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useAutoScroll } from './useAutoScroll';
import { useRef, useEffect } from 'react';

// jsdom non implementa scrollTo, ma scrollTop scrittura sì.
function makeContainer({ scrollHeight = 1000, clientHeight = 200, scrollTop = 0 } = {}) {
  const el = document.createElement('div');
  Object.defineProperty(el, 'scrollHeight', { value: scrollHeight, configurable: true });
  Object.defineProperty(el, 'clientHeight', { value: clientHeight, configurable: true });
  el.scrollTop = scrollTop;
  return el;
}

function harness(initialDeps: number[]) {
  return renderHook(({ deps }: { deps: number[] }) => {
    const ref = useRef<HTMLDivElement | null>(null);
    // mountato solo una volta
    useEffect(() => {
      if (!ref.current) ref.current = makeContainer({ scrollHeight: 1000, clientHeight: 200 });
    }, []);
    useAutoScroll(ref, deps);
    return ref;
  }, { initialProps: { deps: initialDeps } });
}

// Controllable fake requestAnimationFrame/cancelAnimationFrame: lets tests
// assert scheduling/coalescing behavior deterministically instead of racing
// jsdom's real ~16ms frame timer.
type RafCallback = FrameRequestCallback;
let rafQueue: Map<number, RafCallback>;
let nextRafId: number;
let rafSpy: ReturnType<typeof vi.fn>;
let cancelSpy: ReturnType<typeof vi.fn>;

function installFakeRaf() {
  rafQueue = new Map();
  nextRafId = 0;
  rafSpy = vi.fn((cb: RafCallback) => {
    const id = ++nextRafId;
    rafQueue.set(id, cb);
    return id;
  });
  cancelSpy = vi.fn((id: number) => {
    rafQueue.delete(id);
  });
  vi.stubGlobal('requestAnimationFrame', rafSpy);
  vi.stubGlobal('cancelAnimationFrame', cancelSpy);
}

// Simulates one animation frame firing: runs whatever is queued "now".
function flushRaf(time = 0) {
  const callbacks = Array.from(rafQueue.values());
  rafQueue.clear();
  callbacks.forEach((cb) => cb(time));
}

beforeEach(() => installFakeRaf());
afterEach(() => vi.unstubAllGlobals());

describe('useAutoScroll', () => {
  it('scrolls to bottom when deps change and user is at bottom', () => {
    const { result, rerender } = harness([0]);
    const el = result.current.current!;
    // simula user al bottom (scrollTop = scrollHeight - clientHeight)
    el.scrollTop = 800;
    rerender({ deps: [1] });
    flushRaf();
    expect(el.scrollTop).toBe(1000); // scrollHeight
  });

  it('does not scroll when user has scrolled up', () => {
    const { result, rerender } = harness([0]);
    const el = result.current.current!;
    el.scrollTop = 0; // user scrolled all the way up
    // simula evento scroll che setta userScrolledUp
    el.dispatchEvent(new Event('scroll'));
    rerender({ deps: [1] });
    flushRaf();
    expect(el.scrollTop).toBe(0);
  });

  it('resumes scrolling after user scrolls back to bottom', () => {
    const { result, rerender } = harness([0]);
    const el = result.current.current!;
    // scroll up: disabilita
    el.scrollTop = 0;
    el.dispatchEvent(new Event('scroll'));
    rerender({ deps: [1] });
    flushRaf();
    expect(el.scrollTop).toBe(0);
    // ritorna entro 50px dal bottom: riabilita
    el.scrollTop = 800; // 1000 - 200 = 800, esattamente al bottom
    el.dispatchEvent(new Event('scroll'));
    act(() => {});
    rerender({ deps: [2] });
    flushRaf();
    expect(el.scrollTop).toBe(1000);
  });

  it('does not write scrollTop synchronously; schedules it via requestAnimationFrame', () => {
    const { result, rerender } = harness([0]);
    const el = result.current.current!;
    el.scrollTop = 800;
    rafSpy.mockClear();
    rerender({ deps: [1] });
    // The write must not have happened yet — only scheduled.
    expect(el.scrollTop).toBe(800);
    expect(rafSpy).toHaveBeenCalledTimes(1);
    flushRaf();
    expect(el.scrollTop).toBe(1000);
  });

  it('coalesces multiple synchronous dep changes into a single scroll write per frame', () => {
    const { result, rerender } = harness([0]);
    const el = result.current.current!;
    el.scrollTop = 800;
    rafSpy.mockClear();
    cancelSpy.mockClear();

    // Two bursty updates land before any frame fires (e.g. two SSE chunks in
    // the same tick).
    rerender({ deps: [1] });
    rerender({ deps: [2] });

    // Each dep change cancels the previous pending frame before scheduling a
    // new one (React runs the prior effect's cleanup before the next run),
    // so despite two updates, only the most recent frame is left pending.
    expect(cancelSpy).toHaveBeenCalledTimes(2);
    expect(rafQueue.size).toBe(1);
    expect(el.scrollTop).toBe(800); // still unwritten — only scheduled

    flushRaf();
    // Exactly one write occurred for the whole burst.
    expect(el.scrollTop).toBe(1000);
  });

  it('cancels the pending scroll write on unmount', () => {
    const { result, unmount } = harness([0]);
    const el = result.current.current!;
    el.scrollTop = 800;
    expect(rafQueue.size).toBe(1); // scheduled on mount

    unmount();

    expect(cancelSpy).toHaveBeenCalled();
    expect(rafQueue.size).toBe(0);
    flushRaf();
    expect(el.scrollTop).toBe(800); // never written
  });
});
