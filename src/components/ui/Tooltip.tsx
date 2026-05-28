import { cloneElement, useEffect, useRef, useState, type ReactElement } from 'react';

export interface TooltipProps {
  label: string;
  children: ReactElement;
}

let idCounter = 0;
function nextId(): string {
  idCounter += 1;
  return `tt-${idCounter}`;
}

interface TriggerProps {
  onMouseEnter?: (e: React.MouseEvent) => void;
  onMouseLeave?: (e: React.MouseEvent) => void;
  onFocus?: (e: React.FocusEvent) => void;
  onBlur?: (e: React.FocusEvent) => void;
  'aria-describedby'?: string;
}

export function Tooltip({ label, children }: TooltipProps) {
  const [open, setOpen] = useState(false);
  const [id] = useState(nextId);
  const tipRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  const triggerProps: TriggerProps = {
    onMouseEnter: () => setOpen(true),
    onMouseLeave: () => setOpen(false),
    onFocus: () => setOpen(true),
    onBlur: () => setOpen(false),
    'aria-describedby': open ? id : undefined,
  };

  return (
    <span className="relative inline-flex">
      {cloneElement(children as ReactElement<TriggerProps>, triggerProps)}
      {open && (
        <span
          ref={tipRef}
          id={id}
          role="tooltip"
          className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1 max-w-[220px] w-max whitespace-normal break-words leading-snug rounded bg-surface-3 border border-border-subtle px-2 py-1 text-[10px] font-mono text-zinc-200 shadow z-50 pointer-events-none"
        >
          {label}
        </span>
      )}
    </span>
  );
}
