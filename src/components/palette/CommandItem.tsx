import type { ComponentType, SVGProps } from 'react';

export interface CommandItemProps {
  label: string;
  shortcut?: string;
  icon?: ComponentType<SVGProps<SVGSVGElement>>;
}

export function CommandItem({ label, shortcut, icon: Icon }: CommandItemProps) {
  return (
    <div className="flex items-center gap-2 w-full text-xs">
      {Icon && <Icon className="w-3 h-3 text-zinc-500 shrink-0" aria-hidden />}
      <span className="flex-1 truncate text-zinc-200">{label}</span>
      {shortcut && (
        <span
          data-testid="command-item-shortcut"
          className="ml-2 inline-flex gap-1"
        >
          {shortcut.split('+').map((k, i) => (
            <kbd
              key={i}
              className="px-1 py-0.5 text-[9px] font-mono bg-zinc-800 border border-border-subtle rounded text-zinc-400"
            >
              {k}
            </kbd>
          ))}
        </span>
      )}
    </div>
  );
}
