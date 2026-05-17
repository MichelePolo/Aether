import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ConfirmDialog } from './ConfirmDialog';

describe('ConfirmDialog', () => {
  it('renders message and buttons', () => {
    render(<ConfirmDialog open title="Sure?" message="This deletes data." onConfirm={() => {}} onCancel={() => {}} />);
    expect(screen.getByText('Sure?')).toBeInTheDocument();
    expect(screen.getByText('This deletes data.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /confirm|ok/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /cancel/i })).toBeInTheDocument();
  });

  it('calls onConfirm when Confirm is clicked', async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    render(<ConfirmDialog open title="T" message="M" onConfirm={onConfirm} onCancel={() => {}} />);
    await user.click(screen.getByRole('button', { name: /confirm|ok/i }));
    expect(onConfirm).toHaveBeenCalledOnce();
  });

  it('calls onCancel when Cancel is clicked', async () => {
    const user = userEvent.setup();
    const onCancel = vi.fn();
    render(<ConfirmDialog open title="T" message="M" onConfirm={() => {}} onCancel={onCancel} />);
    await user.click(screen.getByRole('button', { name: /cancel/i }));
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it('confirm button uses danger variant when destructive=true', () => {
    render(<ConfirmDialog open destructive title="T" message="M" onConfirm={() => {}} onCancel={() => {}} />);
    const confirm = screen.getByRole('button', { name: /confirm|ok|delete/i });
    expect(confirm.className).toMatch(/red/);
  });
});
