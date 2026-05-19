import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useGlobalShortcuts } from './useGlobalShortcuts';
import { useUiStore } from '@/src/stores/ui.store';
import { useSessionsStore } from '@/src/stores/sessions.store';
import { __setIsMacForTests } from './useKeyboardShortcut';

function fireKey(init: KeyboardEventInit) {
  window.dispatchEvent(new KeyboardEvent('keydown', { cancelable: true, ...init }));
}

beforeEach(() => {
  __setIsMacForTests(true);
  useUiStore.getState()._reset();
  useSessionsStore.getState()._reset();
  localStorage.clear();
});
afterEach(() => __setIsMacForTests(null));

describe('useGlobalShortcuts', () => {
  it('Cmd+K toggles paletteOpen', () => {
    renderHook(() => useGlobalShortcuts());
    act(() => fireKey({ key: 'k', metaKey: true }));
    expect(useUiStore.getState().paletteOpen).toBe(true);
    act(() => fireKey({ key: 'k', metaKey: true }));
    expect(useUiStore.getState().paletteOpen).toBe(false);
  });

  it('Escape closes palette only when open', () => {
    renderHook(() => useGlobalShortcuts());
    act(() => fireKey({ key: 'Escape' }));
    expect(useUiStore.getState().paletteOpen).toBe(false);

    act(() => useUiStore.getState().openPalette());
    act(() => fireKey({ key: 'Escape' }));
    expect(useUiStore.getState().paletteOpen).toBe(false);
  });

  it('Cmd+B toggles sidebar', () => {
    renderHook(() => useGlobalShortcuts());
    expect(useUiStore.getState().sidebarOpen).toBe(true);
    act(() => fireKey({ key: 'b', metaKey: true }));
    expect(useUiStore.getState().sidebarOpen).toBe(false);
  });

  it('Cmd+N calls sessions.create', () => {
    const spy = vi.spyOn(useSessionsStore.getState(), 'create').mockResolvedValue(
      { id: 'x', title: 'untitled', createdAt: 0, updatedAt: 0 } as never,
    );
    renderHook(() => useGlobalShortcuts());
    act(() => fireKey({ key: 'n', metaKey: true }));
    expect(spy).toHaveBeenCalled();
  });
});
