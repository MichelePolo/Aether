import { type ReactNode } from 'react';

export interface SidebarProps {
  header: ReactNode;
  footer?: ReactNode;
  children: ReactNode;
}

export function Sidebar({ header, footer, children }: SidebarProps) {
  return (
    <div className="flex flex-col h-full">
      <div className="h-12 px-4 flex items-center border-b border-border-subtle bg-surface-3 shrink-0 glass">{header}</div>
      <div className="flex-1 overflow-y-auto overflow-x-hidden p-4 space-y-6 sidebar-scroll">{children}</div>
      {footer && (
        <div className="p-4 border-t border-border-subtle text-[10px] font-mono text-zinc-600">
          {footer}
        </div>
      )}
    </div>
  );
}
