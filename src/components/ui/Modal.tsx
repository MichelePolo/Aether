import { useEffect, useId, useRef, type ReactNode } from 'react';
import { cn } from '@/src/lib/cn';

// The native `closedBy` IDL attribute (HTML attribute: `closedby`) is very
// new; feature-detect it so the manual Escape/backdrop fallbacks only run in
// browsers (or test environments like jsdom) that lack native light-dismiss.
const supportsNativeClosedBy = () =>
  typeof HTMLDialogElement !== 'undefined' && 'closedBy' in HTMLDialogElement.prototype;

export interface ModalProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: ReactNode;
  dismissOnBackdrop?: boolean;
  className?: string;
}

export function Modal({
  open,
  onClose,
  title,
  children,
  dismissOnBackdrop = true,
  className,
}: ModalProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const previouslyFocusedRef = useRef<Element | null>(null);
  const titleId = useId();

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.hasAttribute('open')) {
      previouslyFocusedRef.current = document.activeElement;
      try {
        dialog.showModal();
      } catch {
        dialog.setAttribute('open', '');
      }
      document.body.style.overflow = 'hidden';
    } else if (!open && dialog.hasAttribute('open')) {
      try {
        dialog.close();
      } catch {
        dialog.removeAttribute('open');
      }
      document.body.style.overflow = '';
    }
    return () => {
      if (dialog && !dialog.hasAttribute('open')) {
        document.body.style.overflow = '';
      }
    };
  }, [open]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const handler = () => {
      onClose();
      document.body.style.overflow = '';
      const prev = previouslyFocusedRef.current;
      if (prev && 'focus' in prev) {
        (prev as HTMLElement).focus();
      }
    };
    dialog.addEventListener('close', handler);
    return () => dialog.removeEventListener('close', handler);
  }, [onClose]);

  // Manual Escape fallback: route through .close() so the single `close`
  // listener owns onClose()+focus restore (works for unmount-based dialogs too).
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        const d = dialogRef.current;
        if (d?.open && typeof d.close === 'function') d.close();
        else onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const onBackdropMouseDown = (e: React.MouseEvent<HTMLDialogElement>) => {
    if (!dismissOnBackdrop) return;
    // Browsers that support `closedby` already light-dismiss on backdrop
    // clicks natively; only run the manual fallback where that's absent.
    if (supportsNativeClosedBy()) return;
    if (e.target === e.currentTarget) {
      const d = dialogRef.current;
      if (d?.open && typeof d.close === 'function') d.close();
      else onClose();
    }
  };

  return (
    <dialog
      ref={dialogRef}
      onMouseDown={onBackdropMouseDown}
      closedby={dismissOnBackdrop ? 'any' : 'closerequest'}
      aria-labelledby={title ? titleId : undefined}
      className={cn(
        'bg-surface-1 border border-border-subtle rounded-xl shadow-2xl w-full max-w-md p-0 overflow-hidden text-zinc-300 glass flex flex-col max-h-[85vh]',
        className,
      )}
    >
      {title && (
        <div
          id={titleId}
          className="shrink-0 px-4 py-3 border-b border-border-subtle mono-label text-white"
        >
          {title}
        </div>
      )}
      <div className="p-4 overflow-y-auto">{children}</div>
    </dialog>
  );
}
