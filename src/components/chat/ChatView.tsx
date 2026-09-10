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
  const { send, resume, abort, isStreaming } = useStreamingDispatch();
  const activeSessionId = useSessionsStore((s) => s.activeSessionId);

  const handleRetry = useCallback(
    async (failedId: string) => {
      const state = useChatStore.getState();
      const idx = state.messages.findIndex((m) => m.id === failedId);
      if (idx < 1) return;
      const prev = state.messages[idx - 1];
      if (prev.role !== 'user') return;
      if (state.messages[idx].persisted !== false) {
        await resume(failedId);
      } else {
        // A pre-dispatch network failure has no server message to resume.
        useChatStore.getState().removeMessage(failedId);
        if (prev.persisted === false) useChatStore.getState().removeMessage(prev.id);
        await send(prev.text);
      }
    },
    [send, resume],
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
