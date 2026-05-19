import { useEffect } from 'react';

export interface ShortcutBinding {
  /** Lowercase key, e.g. "k", "n", "b", "escape". */
  key: string;
  /** Cross-platform modifier: true → Cmd on Mac, Ctrl elsewhere. Default false. */
  mod?: boolean;
}

let isMac =
  typeof navigator !== 'undefined' && /mac/i.test(navigator.platform);

/** Test-only override. Pass `null` to restore. */
export function __setIsMacForTests(v: boolean | null): void {
  if (v === null) {
    isMac =
      typeof navigator !== 'undefined' && /mac/i.test(navigator.platform);
  } else {
    isMac = v;
  }
}

export function useKeyboardShortcut(
  binding: ShortcutBinding,
  handler: (e: KeyboardEvent) => void,
  enabled: boolean = true,
): void {
  useEffect(() => {
    if (!enabled) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() !== binding.key.toLowerCase()) return;
      if (binding.mod) {
        const want = isMac ? e.metaKey && !e.ctrlKey : e.ctrlKey && !e.metaKey;
        if (!want) return;
      } else if (e.metaKey || e.ctrlKey) {
        return;
      }
      e.preventDefault();
      handler(e);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [binding.key, binding.mod, enabled, handler]);
}
