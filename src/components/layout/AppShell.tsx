import { type ReactNode } from 'react';
import { cn } from '@/src/lib/cn';

export interface AppShellProps {
  sidebar: ReactNode;
  sidebarOpen: boolean;
  children: ReactNode;
}

export function AppShell({ sidebar, sidebarOpen, children }: AppShellProps) {
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
      <main className="flex-1 flex flex-col min-w-0 bg-surface-1">
        {children}
      </main>
    </div>
  );
}
