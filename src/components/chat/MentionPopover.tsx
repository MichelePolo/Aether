import { useEffect, useRef, useState } from 'react';
import type { SubAgentMeta } from '@/src/types/subagent.types';

export interface MentionPopoverProps {
  open: boolean;
  items: SubAgentMeta[];
  onSelect: (name: string) => void;
  onClose: () => void;
}

export function MentionPopover({ open, items, onSelect, onClose }: MentionPopoverProps) {
  const [index, setIndex] = useState(0);
  const indexRef = useRef(0);
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);

  useEffect(() => {
    itemRefs.current[index]?.scrollIntoView({ block: 'nearest' });
  }, [index]);

  const updateIndex = (next: number) => {
    indexRef.current = next;
    setIndex(next);
  };

  useEffect(() => {
    if (!open) return;
    updateIndex(0);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        updateIndex(Math.min(indexRef.current + 1, items.length - 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        updateIndex(Math.max(indexRef.current - 1, 0));
      } else if (e.key === 'Enter' || e.key === 'Tab') {
        if (items.length === 0) return;
        e.preventDefault();
        onSelect(items[indexRef.current]?.name ?? items[0].name);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, items, onSelect, onClose]);

  if (!open) return null;

  if (items.length === 0) {
    return (
      <div
        role="listbox"
        className="absolute bottom-full left-0 mb-2 w-64 bg-surface-2 border border-border-subtle rounded shadow-lg p-2 text-xs text-zinc-500 font-mono"
      >
        No sub-agents yet
      </div>
    );
  }

  return (
    <div
      role="listbox"
      className="absolute bottom-full left-0 mb-2 w-64 bg-surface-2 border border-border-subtle rounded shadow-lg overflow-hidden"
    >
      {items.map((item, i) => (
        <button
          key={item.id}
          ref={(el) => { itemRefs.current[i] = el; }}
          type="button"
          role="option"
          aria-selected={i === index}
          data-selected={i === index}
          onClick={() => onSelect(item.name)}
          onMouseEnter={() => setIndex(i)}
          className={`w-full text-left px-2 py-1.5 text-xs font-mono ${
            i === index ? 'bg-surface-3 text-white' : 'text-zinc-300'
          }`}
        >
          {item.name}
        </button>
      ))}
    </div>
  );
}
