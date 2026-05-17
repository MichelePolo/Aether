import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DialogHost } from './DialogHost';
import { useDialog, _resetDialogStore } from '@/src/hooks/useDialog';

function TestHarness() {
  const { prompt, confirm } = useDialog();
  return (
    <>
      <DialogHost />
      <button
        onClick={async () => {
          const r = await prompt({ title: 'Ask', label: 'Name' });
          (window as unknown as { lastResult: unknown }).lastResult = r;
        }}
      >
        Open Prompt
      </button>
      <button
        onClick={async () => {
          const r = await confirm({ title: 'OK?', message: 'sure' });
          (window as unknown as { lastResult: unknown }).lastResult = r;
        }}
      >
        Open Confirm
      </button>
    </>
  );
}

describe('DialogHost', () => {
  beforeEach(() => {
    _resetDialogStore();
    (window as unknown as { lastResult: unknown }).lastResult = undefined;
  });

  it('renders nothing when queue is empty', () => {
    render(<DialogHost />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('renders PromptDialog when prompt is queued', async () => {
    const user = userEvent.setup();
    render(<TestHarness />);
    await user.click(screen.getByText('Open Prompt'));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText('Name')).toBeInTheDocument();
  });

  it('resolves prompt with input value on confirm', async () => {
    const user = userEvent.setup();
    render(<TestHarness />);
    await user.click(screen.getByText('Open Prompt'));
    await user.type(screen.getByRole('textbox'), 'Alice');
    await user.click(screen.getByRole('button', { name: /^(confirm|ok)$/i }));
    expect((window as unknown as { lastResult: unknown }).lastResult).toBe('Alice');
  });

  it('renders ConfirmDialog when confirm is queued', async () => {
    const user = userEvent.setup();
    render(<TestHarness />);
    await user.click(screen.getByText('Open Confirm'));
    expect(screen.getByText('sure')).toBeInTheDocument();
  });

  it('resolves confirm true on Confirm click', async () => {
    const user = userEvent.setup();
    render(<TestHarness />);
    await user.click(screen.getByText('Open Confirm'));
    await user.click(screen.getByRole('button', { name: /^(confirm|ok)$/i }));
    expect((window as unknown as { lastResult: unknown }).lastResult).toBe(true);
  });
});
