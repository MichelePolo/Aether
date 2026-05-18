import ReactMarkdown from 'react-markdown';
import { useChatStore } from '@/src/stores/chat.store';
import { StreamingIndicator } from './StreamingIndicator';
import { cn } from '@/src/lib/cn';

export interface MessageBubbleProps {
  id: string;
  onRetry?: (id: string) => void;
}

export function MessageBubble({ id, onRetry }: MessageBubbleProps) {
  const message = useChatStore((s) => s.messages.find((m) => m.id === id));
  const isStreaming = useChatStore((s) => s.streamingId === id);

  if (!message) return null;

  const isUser = message.role === 'user';

  return (
    <div className={cn('flex', isUser ? 'justify-end' : 'justify-start')}>
      <div
        className={cn(
          'max-w-[80%] rounded-lg px-3 py-2 text-sm',
          isUser
            ? 'bg-surface-4 text-zinc-100'
            : 'bg-surface-2 border border-border-subtle text-zinc-200',
        )}
      >
        {isUser ? (
          <span className="whitespace-pre-wrap">{message.text}</span>
        ) : message.text.length === 0 && !isStreaming ? (
          <span className="italic text-zinc-500">(empty response)</span>
        ) : (
          <div className="prose prose-invert prose-sm max-w-none">
            <ReactMarkdown>{message.text}</ReactMarkdown>
            {isStreaming && <StreamingIndicator />}
          </div>
        )}

        {message.error && (
          <div className="mt-2 pt-2 border-t border-status-error/40 text-status-error text-xs flex items-center gap-2">
            <span>⚠ Stream interrotto: {message.error}</span>
            {message.retryable && onRetry && (
              <button
                type="button"
                onClick={() => onRetry(id)}
                className="ml-auto px-2 py-0.5 text-[10px] uppercase tracking-widest font-bold rounded bg-status-error/20 hover:bg-status-error/30"
              >
                Retry
              </button>
            )}
          </div>
        )}

        {!message.error && message.interrupted && (
          <div className="mt-2 pt-2 border-t border-border-subtle text-zinc-500 text-xs">
            ⏸ Interrotto dall&apos;utente
          </div>
        )}
      </div>
    </div>
  );
}
