import { useRef } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useChatStore } from '@/src/stores/chat.store';
import { useAutoScroll } from '@/src/hooks/useAutoScroll';
import { MessageBubble } from './MessageBubble';
import { EmptyState } from './EmptyState';

export interface MessageListProps {
  onRetry: (id: string) => void;
}

export function MessageList({ onRetry }: MessageListProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  // dep: total text length, così ogni chunk in streaming triggera lo scroll-effect
  const totalLen = useChatStore((s) =>
    s.messages.reduce((acc, m) => acc + m.text.length, 0),
  );
  const count = useChatStore((s) => s.messages.length);
  // useShallow: l'array di id cambia per riferimento ad ogni set() (anche per chunk),
  // ma con shallow-equality React si re-rendera solo quando la sequenza di id cambia.
  const ids = useChatStore(useShallow((s) => s.messages.map((m) => m.id)));

  useAutoScroll(containerRef, [count, totalLen]);

  if (count === 0) {
    return <EmptyState />;
  }

  return (
    <div
      ref={containerRef}
      role="log"
      aria-live="polite"
      aria-label="Conversation"
      className="flex-1 overflow-y-auto p-4 flex flex-col gap-3"
    >
      {ids.map((id) => (
        <div
          key={id}
          style={{ contentVisibility: 'auto', containIntrinsicSize: 'auto 200px' } as React.CSSProperties}
        >
          <MessageBubble id={id} onRetry={onRetry} />
        </div>
      ))}
    </div>
  );
}
