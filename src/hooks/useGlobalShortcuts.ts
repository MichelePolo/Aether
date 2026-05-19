import { useCallback } from 'react';
import { useUiStore } from '@/src/stores/ui.store';
import { useSessionsStore } from '@/src/stores/sessions.store';
import { useKeyboardShortcut } from './useKeyboardShortcut';

export function useGlobalShortcuts(): void {
  const togglePalette = useUiStore((s) => s.togglePalette);
  const closePalette = useUiStore((s) => s.closePalette);
  const paletteOpen = useUiStore((s) => s.paletteOpen);
  const toggleSidebar = useUiStore((s) => s.toggleSidebar);
  const createSession = useSessionsStore((s) => s.create);

  const onCmdK = useCallback(() => togglePalette(), [togglePalette]);
  const onEscape = useCallback(() => closePalette(), [closePalette]);
  const onCmdB = useCallback(() => toggleSidebar(), [toggleSidebar]);
  const onCmdN = useCallback(() => {
    createSession().catch(() => {});
  }, [createSession]);

  useKeyboardShortcut({ key: 'k', mod: true }, onCmdK);
  useKeyboardShortcut({ key: 'escape' }, onEscape, paletteOpen);
  useKeyboardShortcut({ key: 'b', mod: true }, onCmdB);
  useKeyboardShortcut({ key: 'n', mod: true }, onCmdN);
}
