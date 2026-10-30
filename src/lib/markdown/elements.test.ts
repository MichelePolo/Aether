import { renderHook, waitFor } from '@testing-library/react';

describe('markdown elements', () => {
  beforeEach(() => {
    vi.resetModules();
  });
  afterEach(() => {
    vi.doUnmock('mdlib-pure/element');
  });

  it('defines <mdlib-editor> once and reports it through the hook', async () => {
    const { ensureMarkdownElements, useMarkdownElements } = await import('./elements');
    const { result } = renderHook(() => useMarkdownElements());
    await waitFor(() => expect(result.current).toBe(true));
    expect(customElements.get('mdlib-editor')).toBeDefined();
    expect(ensureMarkdownElements()).toBe(ensureMarkdownElements());
  });

  it('forgets a failed load so the next call retries', async () => {
    const defineElements = vi.fn();
    let fail = true;
    vi.doMock('mdlib-pure/element', () => {
      if (fail) throw new Error('chunk failed');
      return { defineElements };
    });
    const { ensureMarkdownElements } = await import('./elements');
    await expect(ensureMarkdownElements()).rejects.toThrow();
    fail = false;
    vi.resetModules();
    await expect(ensureMarkdownElements()).resolves.toBeUndefined();
    expect(defineElements).toHaveBeenCalledWith({ configs: { aether: { attributes: expect.any(Function) } } });
  });
});
