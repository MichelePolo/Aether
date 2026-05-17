import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useDialog, _resetDialogStore } from './useDialog';

beforeEach(() => _resetDialogStore());

describe('useDialog', () => {
  it('initially has no active dialog', () => {
    const { result } = renderHook(() => useDialog());
    expect(result.current.current).toBeNull();
  });

  it('prompt() opens a prompt dialog', async () => {
    const { result } = renderHook(() => useDialog());
    let promise!: Promise<string | null>;
    act(() => { promise = result.current.prompt({ title: 'T', label: 'L' }); });
    expect(result.current.current?.kind).toBe('prompt');
    expect(result.current.current?.title).toBe('T');

    act(() => {
      if (result.current.current?.kind === 'prompt') result.current.current.resolve('hello');
    });
    await expect(promise).resolves.toBe('hello');
  });

  it('prompt() resolves null on cancel', async () => {
    const { result } = renderHook(() => useDialog());
    let promise!: Promise<string | null>;
    act(() => { promise = result.current.prompt({ title: 'T', label: 'L' }); });
    act(() => result.current.current?.cancel());
    await expect(promise).resolves.toBeNull();
  });

  it('confirm() opens a confirm dialog', async () => {
    const { result } = renderHook(() => useDialog());
    let promise!: Promise<boolean>;
    act(() => { promise = result.current.confirm({ title: 'T', message: 'M' }); });
    expect(result.current.current?.kind).toBe('confirm');

    act(() => {
      if (result.current.current?.kind === 'confirm') result.current.current.resolve(true);
    });
    await expect(promise).resolves.toBe(true);
  });

  it('confirm() resolves false on cancel', async () => {
    const { result } = renderHook(() => useDialog());
    let promise!: Promise<boolean>;
    act(() => { promise = result.current.confirm({ title: 'T', message: 'M' }); });
    act(() => result.current.current?.cancel());
    await expect(promise).resolves.toBe(false);
  });

  it('only one dialog active at a time (FIFO queue)', async () => {
    const { result } = renderHook(() => useDialog());
    let p1!: Promise<string | null>;
    let p2!: Promise<string | null>;
    act(() => {
      p1 = result.current.prompt({ title: 'A', label: 'L' });
      p2 = result.current.prompt({ title: 'B', label: 'L' });
    });
    expect(result.current.current?.title).toBe('A');
    act(() => {
      if (result.current.current?.kind === 'prompt') result.current.current.resolve('1');
    });
    await expect(p1).resolves.toBe('1');
    expect(result.current.current?.title).toBe('B');
    act(() => {
      if (result.current.current?.kind === 'prompt') result.current.current.resolve('2');
    });
    await expect(p2).resolves.toBe('2');
  });
});
