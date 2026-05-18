import { useCallback } from 'react';
import { useChatStore } from '@/src/stores/chat.store';
import { useSessionsStore } from '@/src/stores/sessions.store';
import { useUiStore } from '@/src/stores/ui.store';
import { createStreamingDispatch } from '@/src/lib/api/dispatch.api';
import { computeTitle } from '@/src/lib/title';
import type { ReasoningStep } from '@/src/types/reasoning.types';

interface TextData { chunk: string }
interface ThinkingData { chunk: string }
interface DoneData { model?: string; interrupted?: boolean; reasoningSteps?: ReasoningStep[] }
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

    // Clear focus so the drawer naturally targets the new streamingId.
    useUiStore.getState().setFocusedMessageId(null);

    // Local auto-title (slice 2b).
    const active = useSessionsStore.getState().sessions.find((s) => s.id === activeId);
    if (active && !active.title) {
      useSessionsStore.getState().setLocalTitle(activeId, computeTitle(trimmed));
    }

    const thinking = useUiStore.getState().thinkingEnabled;

    chat.appendUser(trimmed);
    const { id } = chat.startAssistant();
    const controller = new AbortController();
    chat.setAbortController(controller);

    let firstThinkingSeen = false;

    try {
      for await (const ev of createStreamingDispatch(
        { sessionId: activeId, message: trimmed, thinking },
        controller.signal,
      )) {
        if (ev.event === 'text') {
          useChatStore.getState().appendChunk(id, (ev.data as TextData).chunk);
        } else if (ev.event === 'thinking') {
          useChatStore.getState().appendThinkingChunk((ev.data as ThinkingData).chunk);
          if (!firstThinkingSeen) {
            firstThinkingSeen = true;
            useUiStore.getState().openReasoningDrawer();
          }
        } else if (ev.event === 'reasoning_step') {
          useChatStore.getState().appendReasoningStep(ev.data as ReasoningStep);
        } else if (ev.event === 'done') {
          const d = ev.data as DoneData;
          useChatStore.getState().finishAssistant(id, {
            model: d.model,
            interrupted: !!d.interrupted,
            reasoningSteps: d.reasoningSteps,
          });
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
