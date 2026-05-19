import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useKeyboardShortcut, __setIsMacForTests } from './useKeyboardShortcut';

function fireKey(init: KeyboardEventInit) {
  const ev = new KeyboardEvent('keydown', { cancelable: true, ...init });
  window.dispatchEvent(ev);
  return ev;
}

beforeEach(() => {
  __setIsMacForTests(true);
});
afterEach(() => {
  __setIsMacForTests(null);
});

describe('useKeyboardShortcut', () => {
  it('fires handler on plain key (no mod)', () => {
    const handler = vi.fn();
    renderHook(() => useKeyboardShortcut({ key: 'escape' }, handler));
    fireKey({ key: 'Escape' });
    expect(handler).toHaveBeenCalledOnce();
  });

  it('fires on Cmd+K when isMac=true', () => {
    const handler = vi.fn();
    renderHook(() => useKeyboardShortcut({ key: 'k', mod: true }, handler));
    fireKey({ key: 'k', metaKey: true });
    expect(handler).toHaveBeenCalledOnce();
  });

  it('does NOT fire on Ctrl+K when isMac=true', () => {
    const handler = vi.fn();
    renderHook(() => useKeyboardShortcut({ key: 'k', mod: true }, handler));
    fireKey({ key: 'k', ctrlKey: true });
    expect(handler).not.toHaveBeenCalled();
  });

  it('fires on Ctrl+K when isMac=false', () => {
    __setIsMacForTests(false);
    const handler = vi.fn();
    renderHook(() => useKeyboardShortcut({ key: 'k', mod: true }, handler));
    fireKey({ key: 'k', ctrlKey: true });
    expect(handler).toHaveBeenCalledOnce();
  });

  it('calls preventDefault when it fires', () => {
    const handler = vi.fn();
    renderHook(() => useKeyboardShortcut({ key: 'k', mod: true }, handler));
    const ev = fireKey({ key: 'k', metaKey: true });
    expect(ev.defaultPrevented).toBe(true);
  });

  it('does not fire when enabled=false', () => {
    const handler = vi.fn();
    renderHook(() => useKeyboardShortcut({ key: 'escape' }, handler, false));
    fireKey({ key: 'Escape' });
    expect(handler).not.toHaveBeenCalled();
  });

  it('cleans up on unmount', () => {
    const handler = vi.fn();
    const { unmount } = renderHook(() => useKeyboardShortcut({ key: 'escape' }, handler));
    unmount();
    fireKey({ key: 'Escape' });
    expect(handler).not.toHaveBeenCalled();
  });
});
