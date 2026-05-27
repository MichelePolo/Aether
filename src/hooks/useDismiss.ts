import { useEffect, type RefObject } from 'react';

/**
 * Dismiss a transient surface (dropdown/menu) on Escape or an outside
 * pointer-down. No-op while `active` is false so listeners only attach when the
 * surface is open. Mirrors the MessageContextMenu dismiss behavior.
 */
export function useDismiss(
  ref: RefObject<HTMLElement | null>,
  onDismiss: () => void,
  active: boolean,
): void {
  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onDismiss();
    };
    const onDown = (e: MouseEvent): void => {
      if (ref.current && !ref.current.contains(e.target as Node)) onDismiss();
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onDown);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onDown);
    };
  }, [ref, onDismiss, active]);
}
