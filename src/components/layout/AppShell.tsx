import { type ReactNode } from 'react';
import { cn } from '@/src/lib/cn';
import { useUiStore } from '@/src/stores/ui.store';

export interface AppShellProps {
  sidebar: ReactNode;
  sidebarOpen: boolean;
  children: ReactNode;
}

export function AppShell({ sidebar, sidebarOpen, children }: AppShellProps) {
  // When the reasoning panel (a fixed right-edge overlay) opens, reserve its
  // width so it pushes the chat instead of covering the right-aligned bubbles.
  const reasoningOpen = useUiStore((s) => s.reasoningDrawerOpen);
  return (
    <div className="flex h-screen w-full bg-surface-1 text-zinc-300 font-sans">
      <aside
        aria-label="Sidebar"
        className={cn(
          'border-r border-border-subtle bg-surface-2 w-80 flex flex-col shrink-0 overflow-hidden',
          !sidebarOpen && 'hidden',
        )}
      >
        {sidebar}
      </aside>
      <main
        className={cn(
          'flex-1 flex flex-col min-w-0 min-h-0 bg-surface-1',
          'transition-[margin] duration-200 motion-reduce:transition-none',
          reasoningOpen && 'mr-96',
        )}
      >
        {children}
      </main>
    </div>
  );
}
