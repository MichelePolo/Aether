import { useCallback } from 'react';
import { useStreamingDispatch } from '@/src/hooks/useStreamingDispatch';
import { useChatStore } from '@/src/stores/chat.store';
import { MessageList } from './MessageList';
import { MessageInput } from './MessageInput';

export function ChatView() {
  const { send, abort, isStreaming } = useStreamingDispatch();

  const handleRetry = useCallback(
    async (failedId: string) => {
      const state = useChatStore.getState();
      const idx = state.messages.findIndex((m) => m.id === failedId);
      if (idx < 1) return;
      const prev = state.messages[idx - 1];
      if (prev.role !== 'user') return;
      // rimuove il bubble fallito
      useChatStore.setState((s) => ({
        messages: s.messages.filter((m) => m.id !== failedId),
      }));
      await send(prev.text);
    },
    [send],
  );

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <MessageList onRetry={handleRetry} />
      <MessageInput onSend={send} onStop={abort} isStreaming={isStreaming} />
    </div>
  );
}
