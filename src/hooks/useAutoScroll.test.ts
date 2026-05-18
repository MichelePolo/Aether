import { describe, it, expect, beforeEach } from 'vitest';
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

beforeEach(() => { /* noop */ });

describe('useAutoScroll', () => {
  it('scrolls to bottom when deps change and user is at bottom', () => {
    const { result, rerender } = harness([0]);
    const el = result.current.current!;
    // simula user al bottom (scrollTop = scrollHeight - clientHeight)
    el.scrollTop = 800;
    rerender({ deps: [1] });
    expect(el.scrollTop).toBe(1000); // scrollHeight
  });

  it('does not scroll when user has scrolled up', () => {
    const { result, rerender } = harness([0]);
    const el = result.current.current!;
    el.scrollTop = 0; // user scrolled all the way up
    // simula evento scroll che setta userScrolledUp
    el.dispatchEvent(new Event('scroll'));
    rerender({ deps: [1] });
    expect(el.scrollTop).toBe(0);
  });

  it('resumes scrolling after user scrolls back to bottom', () => {
    const { result, rerender } = harness([0]);
    const el = result.current.current!;
    // scroll up: disabilita
    el.scrollTop = 0;
    el.dispatchEvent(new Event('scroll'));
    rerender({ deps: [1] });
    expect(el.scrollTop).toBe(0);
    // ritorna entro 50px dal bottom: riabilita
    el.scrollTop = 800; // 1000 - 200 = 800, esattamente al bottom
    el.dispatchEvent(new Event('scroll'));
    act(() => {});
    rerender({ deps: [2] });
    expect(el.scrollTop).toBe(1000);
  });
});
