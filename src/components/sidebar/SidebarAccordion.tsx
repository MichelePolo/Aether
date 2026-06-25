import { type ReactNode } from 'react';
import { ChevronDown, ChevronRight, type LucideIcon } from 'lucide-react';

export interface SidebarAccordionProps {
  icon: LucideIcon;
  title: string;
  open: boolean;
  onToggle: () => void;
  actions?: ReactNode;
  children: ReactNode;
}

export function SidebarAccordion({
  icon: Icon,
  title,
  open,
  onToggle,
  actions,
  children,
}: SidebarAccordionProps) {
  const Chevron = open ? ChevronDown : ChevronRight;
  const bodyId = `sidebar-group-${title.replace(/\s+/g, '-').toLowerCase()}`;

  return (
    <section className="rounded bg-surface-3 border border-border-subtle">
      <div className="flex items-center gap-2 p-2">
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={open}
          aria-controls={bodyId}
          className="flex items-center gap-2 flex-1 min-w-0 text-left"
        >
          <Icon size={12} aria-hidden="true" className="shrink-0 text-zinc-500" />
          <span className="mono-label truncate">{title}</span>
        </button>
        {actions && <div className="shrink-0 flex items-center gap-1">{actions}</div>}
        <button
          type="button"
          onClick={onToggle}
          aria-label={open ? 'Collapse' : 'Expand'}
          className="shrink-0 text-zinc-500 hover:text-zinc-300"
        >
          <Chevron size={12} aria-hidden="true" />
        </button>
      </div>
      {open && (
        <div id={bodyId} className="px-2 pb-2">
          {children}
        </div>
      )}
    </section>
  );
}
