import { useEffect, useRef, useState } from 'react';
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
  const streamingId = useChatStore((s) => s.streamingId);

  useAutoScroll(containerRef, [count, totalLen]);

  // Emit exactly one polite SR announcement per completed response, instead of
  // letting the log's live region re-announce every streamed token/chunk.
  // The trailing zero-width space alternates so consecutive completions with
  // identical text still register as a DOM change (and thus get announced).
  const [completionCount, setCompletionCount] = useState(0);
  const wasStreamingRef = useRef(false);
  useEffect(() => {
    if (wasStreamingRef.current && streamingId === null) {
      setCompletionCount((n) => n + 1);
    }
    wasStreamingRef.current = streamingId !== null;
  }, [streamingId]);

  if (count === 0) {
    return <EmptyState />;
  }

  return (
    <>
      <div
        ref={containerRef}
        role="log"
        aria-label="Conversation"
        className="chat-scroll flex-1 overflow-y-auto p-4 flex flex-col gap-4"
      >
        {ids.map((id) => (
          <div
            key={id}
            aria-live={id === streamingId ? 'off' : undefined}
            style={{ contentVisibility: 'auto', containIntrinsicSize: 'auto 200px' } as React.CSSProperties}
          >
            <MessageBubble id={id} onRetry={onRetry} />
          </div>
        ))}
      </div>
      <span role="status" className="sr-only">
        {completionCount > 0 ? `Response complete${'​'.repeat(completionCount % 2)}` : ''}
      </span>
    </>
  );
}
