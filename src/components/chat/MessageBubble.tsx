import ReactMarkdown from 'react-markdown';
import { File as FileIcon } from 'lucide-react';
import { useChatStore } from '@/src/stores/chat.store';
import { useUiStore } from '@/src/stores/ui.store';
import { useStreamingDispatch } from '@/src/hooks/useStreamingDispatch';
import { StreamingIndicator } from './StreamingIndicator';
import { isImageMime } from '@/src/types/attachment.types';
import { cn } from '@/src/lib/cn';
import { t } from '@/src/i18n/t';

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

  const senderLabel = isUser
    ? t('messageBubble.you')
    : message.model ?? t('messageBubble.assistant');
  const time = new Date(message.timestamp).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  });

  return (
    <div className={cn('flex flex-col gap-1', isUser ? 'items-end' : 'items-start')}>
      <div className="flex items-baseline gap-2 px-1">
        <span className="font-mono text-[10px] uppercase tracking-widest text-accent/80">
          {senderLabel}
        </span>
        <span className="font-mono text-[10px] text-zinc-600">{time}</span>
      </div>
      <div
        onContextMenu={onContextMenu}
        title={tooltip}
        className={cn(
          'max-w-[68ch] rounded-2xl px-3.5 py-2.5 text-sm shadow-sm shadow-black/20',
          isUser
            ? 'bg-accent/10 border border-accent/25 text-zinc-100 rounded-tr-sm'
            : 'bg-surface-3 border border-border-subtle text-zinc-200 rounded-tl-sm',
        )}
      >
        {isUser ? (
          <span className="whitespace-pre-wrap">{message.text}</span>
        ) : message.text.length === 0 && !isStreaming ? (
          <span className="italic text-zinc-500">{t('messageBubble.emptyResponse')}</span>
        ) : isStreaming ? (
          // Streaming-perf path: render plain text instead of re-parsing markdown per chunk.
          <>
            <span className="whitespace-pre-wrap">{message.text}</span>
            <StreamingIndicator />
          </>
        ) : (
          <div className="prose prose-invert prose-sm max-w-none">
            <ReactMarkdown>{message.text}</ReactMarkdown>
          </div>
        )}

        {message.attachments && message.attachments.length > 0 && (
          <div className="flex flex-wrap gap-2 mt-2">
            {message.attachments.map((a) => (
              isImageMime(a.mime) ? (
                <button
                  key={a.id}
                  type="button"
                  onClick={() => useUiStore.getState().openLightbox(a.id)}
                  className="block"
                >
                  <img
                    src={`/api/attachments/${a.id}`}
                    alt={a.name}
                    loading="lazy"
                    className="h-24 w-24 object-cover rounded border border-border-subtle hover:opacity-80"
                  />
                </button>
              ) : (
                <div
                  key={a.id}
                  className="flex items-center gap-2 px-2 py-1 bg-surface-3 border border-border-subtle rounded text-xs text-zinc-300 font-mono"
                >
                  <FileIcon size={14} className="text-zinc-400" />
                  {a.name}
                </div>
              )
            ))}
          </div>
        )}

        {(isThinkingNow || hasReasoningSteps) && (
          <button
            type="button"
            onClick={handleReasoningClick}
            aria-label="Show reasoning"
            className="mt-2 text-[10px] text-zinc-500 hover:text-accent flex items-center gap-1"
          >
            <span aria-hidden="true">{isThinkingNow ? '💭 ' : '🧠 '}</span>
            {isThinkingNow
              ? t('messageBubble.thinkingNow')
              : t('messageBubble.stepsCount', { n: message.reasoningSteps!.length })}
          </button>
        )}

        {message.error && (
          <div className="mt-2 pt-2 border-t border-status-error/40 text-status-error text-xs flex items-center gap-2">
            <span>⚠ {t('messageBubble.streamInterrupted', { error: message.error })}</span>
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
              ⏸ {t('messageBubble.interrupted', { tokens: Math.ceil(message.text.length / 4) })}
            </span>
            {message.text.length > 0 && (
              <button
                type="button"
                onClick={() => {
                  resume(message.id).catch(() => {});
                }}
                disabled={isAnyStreaming}
                aria-label={t('messageBubble.resume')}
                className="px-2 py-0.5 text-[10px] uppercase tracking-widest font-bold rounded bg-accent/20 hover:bg-accent/30 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {t('messageBubble.resume')}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
