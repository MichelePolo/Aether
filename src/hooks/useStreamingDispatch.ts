import { useCallback } from 'react';
import { useChatStore } from '@/src/stores/chat.store';
import { createStreamingDispatch } from '@/src/lib/api/dispatch.api';

interface TextData { chunk: string }
interface DoneData { model?: string; interrupted?: boolean }
interface ErrorData { message: string; retryable: boolean }

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : 'Unknown error';
}

export function useStreamingDispatch() {
  const isStreaming = useChatStore((s) => s.streamingId !== null);

  const send = useCallback(async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    const store = useChatStore.getState();
    if (store.streamingId) return; // guard against double-send

    store.appendUser(trimmed);
    const { id } = store.startAssistant();
    const controller = new AbortController();
    store.setAbortController(controller);

    try {
      for await (const ev of createStreamingDispatch({ message: trimmed }, controller.signal)) {
        if (ev.event === 'text') {
          useChatStore.getState().appendChunk(id, (ev.data as TextData).chunk);
        } else if (ev.event === 'done') {
          const d = ev.data as DoneData;
          useChatStore.getState().finishAssistant(id, { model: d.model, interrupted: !!d.interrupted });
          return;
        } else if (ev.event === 'error') {
          const d = ev.data as ErrorData;
          useChatStore.getState().failAssistant(id, d.message, !!d.retryable);
          return;
        }
      }
      // stream esaurito senza event:done → trattiamolo come done
      useChatStore.getState().finishAssistant(id, { interrupted: controller.signal.aborted });
    } catch (e) {
      if (controller.signal.aborted) {
        useChatStore.getState().finishAssistant(id, { interrupted: true });
      } else {
        useChatStore.getState().failAssistant(id, errMsg(e), true);
      }
    }
  }, []);

  const abort = useCallback(() => {
    useChatStore.getState().abort();
  }, []);

  return { send, abort, isStreaming };
}
