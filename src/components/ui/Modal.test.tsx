import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Modal } from './Modal';

beforeEach(() => {
  if (!(HTMLDialogElement.prototype as unknown as { showModal?: () => void }).showModal) {
    (HTMLDialogElement.prototype as unknown as { showModal: () => void }).showModal = function () {
      (this as HTMLDialogElement).setAttribute('open', '');
    };
    (HTMLDialogElement.prototype as unknown as { close: () => void }).close = function () {
      (this as HTMLDialogElement).removeAttribute('open');
      (this as HTMLDialogElement).dispatchEvent(new Event('close'));
    };
  }
  document.body.style.overflow = '';
});

describe('Modal', () => {
  it('does not have open attribute when closed', () => {
    const { container } = render(<Modal open={false} onClose={() => {}}>body</Modal>);
    expect(container.querySelector('dialog')?.hasAttribute('open')).toBe(false);
  });

  it('renders content when open', () => {
    render(<Modal open onClose={() => {}}>body</Modal>);
    expect(screen.getByText('body')).toBeInTheDocument();
  });

  it('renders title when provided', () => {
    render(<Modal open onClose={() => {}} title="Confirm">body</Modal>);
    expect(screen.getByText('Confirm')).toBeInTheDocument();
  });

  it('uses a <dialog> element', () => {
    const { container } = render(<Modal open onClose={() => {}}>body</Modal>);
    expect(container.querySelector('dialog')).not.toBeNull();
  });

  it('calls onClose when the dialog emits close', () => {
    const onClose = vi.fn();
    render(<Modal open onClose={onClose}>body</Modal>);
    const dialog = document.querySelector('dialog')!;
    dialog.dispatchEvent(new Event('close'));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('calls onClose when backdrop is clicked (dismissOnBackdrop default)', () => {
    const onClose = vi.fn();
    render(<Modal open onClose={onClose}>body</Modal>);
    const dialog = document.querySelector('dialog')!;
    fireEvent.mouseDown(dialog, { target: dialog });
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('does not close on backdrop when dismissOnBackdrop=false', () => {
    const onClose = vi.fn();
    render(<Modal open onClose={onClose} dismissOnBackdrop={false}>body</Modal>);
    const dialog = document.querySelector('dialog')!;
    fireEvent.mouseDown(dialog, { target: dialog });
    expect(onClose).not.toHaveBeenCalled();
  });

  it('sets body.overflow=hidden while open', () => {
    render(<Modal open onClose={() => {}}>body</Modal>);
    expect(document.body.style.overflow).toBe('hidden');
  });
});
