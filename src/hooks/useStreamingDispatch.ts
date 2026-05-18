import { useCallback } from 'react';
import { useChatStore } from '@/src/stores/chat.store';
import { useSessionsStore } from '@/src/stores/sessions.store';
import { createStreamingDispatch } from '@/src/lib/api/dispatch.api';
import { computeTitle } from '@/src/lib/title';

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
    const activeId = useSessionsStore.getState().activeSessionId;
    if (!activeId) {
      console.warn('[aether] no active session');
      return;
    }
    const chat = useChatStore.getState();
    if (chat.streamingId) return;

    // Local auto-title for instant UX feedback (server is the eventual source of truth).
    const active = useSessionsStore.getState().sessions.find((s) => s.id === activeId);
    if (active && !active.title) {
      useSessionsStore.getState().setLocalTitle(activeId, computeTitle(trimmed));
    }

    chat.appendUser(trimmed);
    const { id } = chat.startAssistant();
    const controller = new AbortController();
    chat.setAbortController(controller);

    try {
      for await (const ev of createStreamingDispatch({ sessionId: activeId, message: trimmed }, controller.signal)) {
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
      useChatStore.getState().finishAssistant(id, { interrupted: controller.signal.aborted });
    } catch (e) {
      if (controller.signal.aborted) {
        useChatStore.getState().finishAssistant(id, { interrupted: true });
      } else {
        useChatStore.getState().failAssistant(id, errMsg(e), true);
      }
    } finally {
      useSessionsStore.getState().touchUpdatedAt(activeId, Date.now());
    }
  }, []);

  const abort = useCallback(() => {
    useChatStore.getState().abort();
  }, []);

  return { send, abort, isStreaming };
}
