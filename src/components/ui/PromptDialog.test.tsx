import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PromptDialog } from './PromptDialog';

describe('PromptDialog', () => {
  it('renders label and input', () => {
    render(<PromptDialog open title="T" label="Name" onConfirm={() => {}} onCancel={() => {}} />);
    expect(screen.getByText('Name')).toBeInTheDocument();
    expect(screen.getByRole('textbox')).toBeInTheDocument();
  });

  it('shows default value in input', () => {
    render(<PromptDialog open title="T" label="L" defaultValue="hello" onConfirm={() => {}} onCancel={() => {}} />);
    expect(screen.getByRole('textbox')).toHaveValue('hello');
  });

  it('calls onConfirm with current value when Confirm is clicked', async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    render(<PromptDialog open title="T" label="L" onConfirm={onConfirm} onCancel={() => {}} />);
    await user.type(screen.getByRole('textbox'), 'world');
    await user.click(screen.getByRole('button', { name: /confirm|ok/i }));
    expect(onConfirm).toHaveBeenCalledWith('world');
  });

  it('calls onCancel when Cancel is clicked', async () => {
    const user = userEvent.setup();
    const onCancel = vi.fn();
    render(<PromptDialog open title="T" label="L" onConfirm={() => {}} onCancel={onCancel} />);
    await user.click(screen.getByRole('button', { name: /cancel/i }));
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it('confirms on Enter key', async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    render(<PromptDialog open title="T" label="L" onConfirm={onConfirm} onCancel={() => {}} />);
    await user.type(screen.getByRole('textbox'), 'go{Enter}');
    expect(onConfirm).toHaveBeenCalledWith('go');
  });

  it('does not render when closed', () => {
    render(<PromptDialog open={false} title="T" label="L" onConfirm={() => {}} onCancel={() => {}} />);
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  });

  it('disables confirm when input is empty and required', () => {
    render(<PromptDialog open required title="T" label="L" onConfirm={() => {}} onCancel={() => {}} />);
    expect(screen.getByRole('button', { name: /confirm|ok/i })).toBeDisabled();
  });

  it('renders a textarea when multiline=true', () => {
    render(
      <PromptDialog
        open
        title="T"
        label="L"
        multiline
        onConfirm={() => {}}
        onCancel={() => {}}
      />,
    );
    const ta = screen.getByLabelText('L');
    expect(ta.tagName).toBe('TEXTAREA');
  });

  it('submits via the form button in multiline mode (Enter inserts newline)', async () => {
    const onConfirm = vi.fn();
    const user = userEvent.setup();
    render(
      <PromptDialog
        open
        title="T"
        label="L"
        multiline
        onConfirm={onConfirm}
        onCancel={() => {}}
      />,
    );
    const ta = screen.getByLabelText('L');
    await user.type(ta, 'line1{Enter}line2');
    await user.click(screen.getByRole('button', { name: /confirm/i }));
    expect(onConfirm).toHaveBeenCalledWith('line1\nline2');
  });
});
