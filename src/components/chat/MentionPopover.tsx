import { useEffect, useRef, useState } from 'react';
import type { SubAgentMeta } from '@/src/types/subagent.types';

/** Stable id shared with the composer textarea's `aria-controls`. */
export const MENTION_LISTBOX_ID = 'mention-listbox';

/** Stable id for option `i`, shared with the composer textarea's `aria-activedescendant`. */
export function mentionOptionId(i: number): string {
  return `mention-option-${i}`;
}

export interface MentionPopoverProps {
  open: boolean;
  items: SubAgentMeta[];
  onSelect: (name: string) => void;
  onClose: () => void;
  /** Notified whenever the highlighted option changes, so the owning combobox can update aria-activedescendant. */
  onHighlightChange?: (index: number) => void;
}

export function MentionPopover({ open, items, onSelect, onClose, onHighlightChange }: MentionPopoverProps) {
  const [index, setIndex] = useState(0);
  const indexRef = useRef(0);
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const wasOpenRef = useRef(open);

  useEffect(() => {
    itemRefs.current[index]?.scrollIntoView({ block: 'nearest' });
  }, [index]);

  useEffect(() => {
    onHighlightChange?.(index);
  }, [index, onHighlightChange]);

  const updateIndex = (next: number) => {
    indexRef.current = next;
    setIndex(next);
  };

  // Reset the highlighted option only on a genuine closed->open transition, or
  // clamp it into range if the item list shrinks underneath it. Deliberately
  // does NOT depend on `items`/`onSelect`/`onClose` identity: the owning
  // composer recreates those on every render (e.g. via onHighlightChange
  // forcing a re-render), and resetting here on every reference change used
  // to fight the keyboard navigation below back to index 0 on each keypress.
  useEffect(() => {
    const wasOpen = wasOpenRef.current;
    wasOpenRef.current = open;
    if (!open) return;
    if (!wasOpen) {
      updateIndex(0);
      return;
    }
    if (indexRef.current > items.length - 1) {
      updateIndex(Math.max(items.length - 1, 0));
    }
  }, [open, items]);

  useEffect(() => {
    if (!open) return;
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
        id={MENTION_LISTBOX_ID}
        role="listbox"
        className="absolute bottom-full left-0 mb-2 w-64 bg-surface-2 border border-border-subtle rounded shadow-lg p-2 text-xs text-zinc-500 font-mono"
      >
        No sub-agents yet
      </div>
    );
  }

  return (
    <div
      id={MENTION_LISTBOX_ID}
      role="listbox"
      className="absolute bottom-full left-0 mb-2 w-64 bg-surface-2 border border-border-subtle rounded shadow-lg overflow-hidden"
    >
      {items.map((item, i) => (
        <button
          key={item.id}
          id={mentionOptionId(i)}
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
