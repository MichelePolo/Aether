import { useRef, useState } from 'react';
import { Plus, type LucideIcon } from 'lucide-react';
import { cn } from '@/src/lib/cn';
import { useDismiss } from '@/src/hooks/useDismiss';

/**
 * One entry in the composer "+" menu. Adding a new composer capability
 * (screenshot, web search, skills, …) is just another item in the `actions`
 * array passed by MessageInput — this menu renders whatever it's given.
 */
export interface ComposerAction {
  id: string;
  label: string;
  icon: LucideIcon;
  onSelect: () => void;
  disabled?: boolean;
}

export interface ComposerPlusMenuProps {
  actions: ComposerAction[];
  disabled?: boolean;
}

export function ComposerPlusMenu({ actions, disabled }: ComposerPlusMenuProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useDismiss(ref, () => setOpen(false), open);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-label="Add to message"
        aria-haspopup="menu"
        aria-expanded={open}
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
        className={cn(
          'p-1.5 rounded-lg transition-colors disabled:opacity-50',
          open ? 'bg-surface-3 text-zinc-200' : 'text-zinc-500 hover:text-zinc-200 hover:bg-surface-3',
        )}
      >
        <Plus size={18} />
      </button>
      {open && (
        <div
          role="menu"
          className="absolute bottom-full left-0 mb-2 z-20 min-w-[220px] bg-surface-3 border border-border-subtle rounded-lg shadow-lg py-1"
        >
          {actions.map((a) => (
            <button
              key={a.id}
              type="button"
              role="menuitem"
              disabled={a.disabled}
              onClick={() => {
                setOpen(false);
                a.onSelect();
              }}
              className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-zinc-200 hover:bg-surface-4 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <a.icon size={16} className="text-zinc-400 shrink-0" />
              {a.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
