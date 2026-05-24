import { useCallback } from 'react';
import { useStreamingDispatch } from '@/src/hooks/useStreamingDispatch';
import { useChatStore } from '@/src/stores/chat.store';
import { useSessionsStore } from '@/src/stores/sessions.store';
import { MessageList } from './MessageList';
import { MessageInput } from './MessageInput';
import { AttachmentDropZone } from './AttachmentDropZone';
import { AttachmentLightbox } from './AttachmentLightbox';
import { AttachmentChips } from './AttachmentChips';
import { t } from '@/src/i18n/t';

export function ChatView() {
  const { send, abort, isStreaming } = useStreamingDispatch();
  const activeSessionId = useSessionsStore((s) => s.activeSessionId);

  const handleRetry = useCallback(
    async (failedId: string) => {
      const state = useChatStore.getState();
      const idx = state.messages.findIndex((m) => m.id === failedId);
      if (idx < 1) return;
      const prev = state.messages[idx - 1];
      if (prev.role !== 'user') return;
      useChatStore.setState((s) => ({
        messages: s.messages.filter((m) => m.id !== failedId),
      }));
      await send(prev.text);
    },
    [send],
  );

  if (!activeSessionId) {
    return (
      <div className="flex-1 flex items-center justify-center text-zinc-500 text-sm p-4 text-center">
        {t('chatView.emptyState')}
      </div>
    );
  }

  return (
    <AttachmentDropZone>
      <div className="flex-1 flex flex-col min-h-0">
        <MessageList onRetry={handleRetry} />
        <AttachmentChips />
        <MessageInput onSend={send} onStop={abort} isStreaming={isStreaming} />
        <AttachmentLightbox />
      </div>
    </AttachmentDropZone>
  );
}
