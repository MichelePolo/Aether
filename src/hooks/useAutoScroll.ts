import { useEffect, useRef, type RefObject } from 'react';

const BOTTOM_THRESHOLD_PX = 50;

export function useAutoScroll<T extends HTMLElement>(
  ref: RefObject<T | null>,
  deps: ReadonlyArray<unknown>,
): void {
  const userScrolledUpRef = useRef(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onScroll = () => {
      const dist = el.scrollHeight - (el.scrollTop + el.clientHeight);
      userScrolledUpRef.current = dist > BOTTOM_THRESHOLD_PX;
    };
    el.addEventListener('scroll', onScroll);
    return () => el.removeEventListener('scroll', onScroll);
  }, [ref]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (userScrolledUpRef.current) return;
    // Coalesce writes into a single rAF so bursty updates (e.g. one per SSE
    // chunk during streaming) force at most one reflow per frame instead of
    // one per dep change.
    const raf = requestAnimationFrame(() => { el.scrollTop = el.scrollHeight; });
    return () => cancelAnimationFrame(raf);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}
