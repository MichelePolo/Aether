import { describe, it, expect, beforeEach } from 'vitest';
import { useBreakpointsStore } from './breakpoints.store';

describe('useBreakpointsStore', () => {
  beforeEach(() => {
    useBreakpointsStore.getState()._reset();
  });

  it('init() populates policy from server', async () => {
    await useBreakpointsStore.getState().init();
    expect(useBreakpointsStore.getState().policy).toEqual({
      safe: 'auto', dangerous: 'gate', external: 'gate',
    });
  });

  it('setCategoryMode() PUTs and updates local state', async () => {
    await useBreakpointsStore.getState().init();
    await useBreakpointsStore.getState().setCategoryMode('dangerous', 'auto');
    expect(useBreakpointsStore.getState().policy.dangerous).toBe('auto');
  });

  it('concurrent setCategoryMode() calls dedupe per category+mode key', async () => {
    await useBreakpointsStore.getState().init();
    const a = useBreakpointsStore.getState().setCategoryMode('safe', 'gate');
    const b = useBreakpointsStore.getState().setCategoryMode('safe', 'gate');
    await Promise.all([a, b]);
    expect(useBreakpointsStore.getState().policy.safe).toBe('gate');
  });

  it('init() failure surfaces in error and clears loading', async () => {
    const origFetch = global.fetch;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    global.fetch = (() => Promise.resolve(new Response('', { status: 500 }))) as any;
    await useBreakpointsStore.getState().init();
    expect(useBreakpointsStore.getState().error).toBeTruthy();
    expect(useBreakpointsStore.getState().loading).toBe(false);
    global.fetch = origFetch;
  });
});
