import { useCallback } from 'react';
import { useChatStore } from '@/src/stores/chat.store';
import { useSessionsStore } from '@/src/stores/sessions.store';
import { useProvidersStore } from '@/src/stores/providers.store';
import { useUiStore } from '@/src/stores/ui.store';
import { createStreamingDispatch } from '@/src/lib/api/dispatch.api';
import { computeTitle } from '@/src/lib/title';
import type { ReasoningStep } from '@/src/types/reasoning.types';
import { emitToolCallRequest, type ToolCallRequestEvent } from './useToolCallDecisions';
import { useMcpStore } from '@/src/stores/mcp.store';
import type { McpConnectionState } from '@/src/types/mcp.types';

interface TextData { chunk: string }
interface ThinkingData { chunk: string }
interface DoneData { model?: string; interrupted?: boolean; reasoningSteps?: ReasoningStep[] }
interface ErrorData { message: string; retryable: boolean }
interface McpStateChangeData { id: string; state: McpConnectionState; error?: string }

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

    const sessions = useSessionsStore.getState().sessions;
    const defaultProvider = useProvidersStore.getState().defaultProvider;
    const activeName =
      ((sessions.find((s) => s.id === activeId) as { providerName?: string } | undefined)
        ?.providerName ?? defaultProvider) ?? undefined;

    chat.appendUser(trimmed);
    const { id } = chat.startAssistant();
    const controller = new AbortController();
    chat.setAbortController(controller);

    let firstThinkingSeen = false;

    try {
      for await (const ev of createStreamingDispatch(
        { sessionId: activeId, message: trimmed, thinking, ...(activeName ? { providerName: activeName } : {}) },
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
        } else if (ev.event === 'tool_call_request') {
          // payload shape from backend N1: { id, qualifiedName, args }
          emitToolCallRequest(ev.data as ToolCallRequestEvent);
        } else if (ev.event === 'tool_call_result') {
          // No client-side action in slice 7 — the reasoning_step event that follows
          // includes the structured tool result for the drawer. This branch exists
          // so we don't fall through to "unknown event" logging.
        } else if (ev.event === 'mcp:state_change') {
          const d = ev.data as McpStateChangeData;
          useMcpStore.getState().applyServerStateEvent(d.id, d.state, d.error);
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
