import { useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';

export interface ToolOutputBlockProps {
  name: string;
  text: string;
}

/**
 * A tool-call output in the chat transcript. Collapsed by default so the model's
 * actual response stays prominent; click the header to reveal the raw output.
 */
export function ToolOutputBlock({ name, text }: ToolOutputBlockProps) {
  const [open, setOpen] = useState(false);
  const Chevron = open ? ChevronDown : ChevronRight;

  return (
    <div className="rounded-lg border border-border-subtle bg-surface-0">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-center gap-1.5 px-3 py-1.5 font-mono text-[9px] uppercase tracking-widest text-cli/70 hover:text-cli"
      >
        <Chevron size={11} aria-hidden="true" className="shrink-0" />
        <span className="truncate">{name}</span>
      </button>
      {open && (
        <pre className="m-0 max-h-60 overflow-auto border-t border-border-subtle px-3 py-2 font-mono text-[11px] leading-relaxed text-cli whitespace-pre-wrap">
          {text}
        </pre>
      )}
    </div>
  );
}
