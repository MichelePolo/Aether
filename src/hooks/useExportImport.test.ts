import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useExportImport } from './useExportImport';

beforeEach(() => {
  globalThis.URL.createObjectURL = vi.fn(() => 'blob:mock');
  globalThis.URL.revokeObjectURL = vi.fn();
});

describe('useExportImport.triggerDownload', () => {
  it('creates a blob URL and clicks an anchor', () => {
    const { result } = renderHook(() => useExportImport());
    let clicked = false;
    const origCreate = document.createElement.bind(document);
    const spyCreate = vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
      const el = origCreate(tag);
      if (tag === 'a') {
        Object.defineProperty(el, 'click', {
          value: () => { clicked = true; },
        });
      }
      return el;
    });
    act(() => {
      result.current.triggerDownload('file.json', '{}');
    });
    expect(globalThis.URL.createObjectURL).toHaveBeenCalled();
    expect(globalThis.URL.revokeObjectURL).toHaveBeenCalled();
    expect(clicked).toBe(true);
    spyCreate.mockRestore();
  });
});

describe('useExportImport.pickFile', () => {
  it('resolves with the picked File via change event', async () => {
    const { result } = renderHook(() => useExportImport());
    const file = new File(['{}'], 'p.json', { type: 'application/json' });

    const origCreate = document.createElement.bind(document);
    let createdInput: HTMLInputElement | null = null;
    const spy = vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
      const el = origCreate(tag);
      if (tag === 'input') {
        createdInput = el as HTMLInputElement;
        Object.defineProperty(el, 'click', { value: () => {} });
      }
      return el;
    });

    const promise = result.current.pickFile('.json');
    expect(createdInput).not.toBeNull();
    Object.defineProperty(createdInput!, 'files', {
      value: [file],
      configurable: true,
    });
    createdInput!.dispatchEvent(new Event('change'));
    const picked = await promise;
    expect(picked).toBe(file);
    spy.mockRestore();
  });
});
