import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import { useSessionsStore } from '@/src/stores/sessions.store';

// Import the component + helper AFTER mocking
import { HiddenImportInput, triggerImportOpen } from './HiddenImportInput';

beforeEach(() => {
  useSessionsStore.getState()._reset();
});

describe('HiddenImportInput', () => {
  it('renders a hidden file input with accept="application/json"', () => {
    const { container } = render(<HiddenImportInput />);
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    expect(input).not.toBeNull();
    expect(input.accept).toBe('application/json');
    expect(input.hidden).toBe(true);
  });

  it('triggerImportOpen() calls .click() on the input', () => {
    const { container } = render(<HiddenImportInput />);
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    const clickSpy = vi.spyOn(input, 'click');
    triggerImportOpen();
    expect(clickSpy).toHaveBeenCalled();
  });

  it('change event dispatches useSessionsStore.importSession(file)', async () => {
    const importMock = vi.fn().mockResolvedValue(undefined);
    useSessionsStore.setState({ importSession: importMock });

    const { container } = render(<HiddenImportInput />);
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;

    const file = new File(['{"messages":[]}'], 'session.json', { type: 'application/json' });
    Object.defineProperty(input, 'files', { value: [file], configurable: true });
    input.dispatchEvent(new Event('change', { bubbles: true }));

    await waitFor(() => {
      expect(importMock).toHaveBeenCalledWith(file);
    });
  });

  it('resets input value to "" after change so the same file can be re-imported', async () => {
    const importMock = vi.fn().mockResolvedValue(undefined);
    useSessionsStore.setState({ importSession: importMock });

    const { container } = render(<HiddenImportInput />);
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;

    const file = new File(['{"messages":[]}'], 'session.json', { type: 'application/json' });
    Object.defineProperty(input, 'files', { value: [file], configurable: true });
    input.dispatchEvent(new Event('change', { bubbles: true }));

    await waitFor(() => {
      expect(input.value).toBe('');
    });
  });
});
