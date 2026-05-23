import { useEffect, useRef } from 'react';
import { useUiStore } from '@/src/stores/ui.store';
import { useSessionsStore } from '@/src/stores/sessions.store';

export function MessageContextMenu() {
  const menu = useUiStore((s) => s.messageContextMenu);
  const closeMenu = useUiStore((s) => s.closeMessageContextMenu);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menu) return;

    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') closeMenu();
    }

    function handleMouseDown(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        closeMenu();
      }
    }

    document.addEventListener('keydown', handleKeyDown);
    document.addEventListener('mousedown', handleMouseDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.removeEventListener('mousedown', handleMouseDown);
    };
  }, [menu, closeMenu]);

  if (!menu) return null;

  const label =
    menu.role === 'user' ? 'Branch from here' : 'Branch from previous user message';

  function handleClick() {
    closeMenu();
    useSessionsStore.getState().forkSession(menu!.messageId).catch(() => {});
  }

  return (
    <div
      ref={menuRef}
      style={{ position: 'fixed', left: menu.x, top: menu.y, zIndex: 60 }}
      className="bg-surface-3 border border-border-subtle rounded shadow-lg py-1 min-w-[180px]"
    >
      <button
        type="button"
        onClick={handleClick}
        className="w-full text-left px-3 py-1.5 text-sm text-zinc-200 hover:bg-surface-4 hover:text-white"
      >
        {label}
      </button>
    </div>
  );
}
