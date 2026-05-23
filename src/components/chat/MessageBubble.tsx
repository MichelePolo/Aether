import ReactMarkdown from 'react-markdown';
import { useChatStore } from '@/src/stores/chat.store';
import { useUiStore } from '@/src/stores/ui.store';
import { useStreamingDispatch } from '@/src/hooks/useStreamingDispatch';
import { StreamingIndicator } from './StreamingIndicator';
import { cn } from '@/src/lib/cn';

export interface MessageBubbleProps {
  id: string;
  onRetry?: (id: string) => void;
}

export function MessageBubble({ id, onRetry }: MessageBubbleProps) {
  const message = useChatStore((s) => s.messages.find((m) => m.id === id));
  const isStreaming = useChatStore((s) => s.streamingId === id);
  const isAnyStreaming = useChatStore((s) => s.streamingId !== null);
  const isThinkingNow = useChatStore(
    (s) => s.streamingId === id && s.currentReasoning.thinkingText.length > 0,
  );
  const openContextMenu = useUiStore((s) => s.openMessageContextMenu);
  const { resume } = useStreamingDispatch();

  if (!message) return null;

  const isUser = message.role === 'user';
  const hasReasoningSteps = (message.reasoningSteps?.length ?? 0) > 0;

  const handleReasoningClick = () => {
    useUiStore.getState().setFocusedMessageId(id);
    useUiStore.getState().openReasoningDrawer();
  };

  const onContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    openContextMenu({ x: e.clientX, y: e.clientY, messageId: id, role: message.role });
  };

  const tooltip =
    message.role === 'model' && message.tokensIn != null && message.tokensOut != null
      ? `Prompt: ${message.tokensIn} / Reply: ${message.tokensOut} tokens`
      : undefined;

  return (
    <div className={cn('flex', isUser ? 'justify-end' : 'justify-start')}>
      <div
        onContextMenu={onContextMenu}
        title={tooltip}
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

        {(isThinkingNow || hasReasoningSteps) && (
          <button
            type="button"
            onClick={handleReasoningClick}
            aria-label="Show reasoning"
            className="mt-2 text-[10px] text-zinc-500 hover:text-accent flex items-center gap-1"
          >
            {isThinkingNow
              ? '💭 thinking…'
              : `🧠 ${message.reasoningSteps!.length} steps`}
          </button>
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
          <div className="mt-2 pt-2 border-t border-border-subtle flex items-center justify-between gap-2 text-zinc-500 text-xs">
            <span>
              ⏸ Interrotto · ~{Math.ceil(message.text.length / 4)} token
            </span>
            {message.text.length > 0 && (
              <button
                type="button"
                onClick={() => {
                  resume(message.id).catch(() => {});
                }}
                disabled={isAnyStreaming}
                aria-label="Riprendi la risposta"
                className="px-2 py-0.5 text-[10px] uppercase tracking-widest font-bold rounded bg-accent/20 hover:bg-accent/30 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Riprendi
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
