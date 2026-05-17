import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Modal } from './Modal';

describe('Modal', () => {
  it('does not render content when closed', () => {
    render(<Modal open={false} onClose={() => {}}>body</Modal>);
    expect(screen.queryByText('body')).not.toBeInTheDocument();
  });

  it('renders content when open', () => {
    render(<Modal open onClose={() => {}}>body</Modal>);
    expect(screen.getByText('body')).toBeInTheDocument();
  });

  it('renders title when provided', () => {
    render(<Modal open onClose={() => {}} title="Confirm">body</Modal>);
    expect(screen.getByText('Confirm')).toBeInTheDocument();
  });

  it('uses role="dialog" with aria-modal', () => {
    render(<Modal open onClose={() => {}}>body</Modal>);
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveAttribute('aria-modal', 'true');
  });

  it('calls onClose when Escape is pressed', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<Modal open onClose={onClose}>body</Modal>);
    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('calls onClose when backdrop is clicked', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<Modal open onClose={onClose}>body</Modal>);
    await user.click(screen.getByTestId('modal-backdrop'));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('does not call onClose when content is clicked', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<Modal open onClose={onClose}>body</Modal>);
    await user.click(screen.getByText('body'));
    expect(onClose).not.toHaveBeenCalled();
  });

  it('does not close on backdrop when dismissOnBackdrop=false', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<Modal open onClose={onClose} dismissOnBackdrop={false}>body</Modal>);
    await user.click(screen.getByTestId('modal-backdrop'));
    expect(onClose).not.toHaveBeenCalled();
  });
});
