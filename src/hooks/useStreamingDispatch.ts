import { useCallback } from 'react';
import { useChatStore } from '@/src/stores/chat.store';
import { useSessionsStore } from '@/src/stores/sessions.store';
import { useProvidersStore } from '@/src/stores/providers.store';
import { useUiStore } from '@/src/stores/ui.store';
import { createStreamingDispatch, createResumingDispatch } from '@/src/lib/api/dispatch.api';
import { computeTitle } from '@/src/lib/title';
import type { ReasoningStep } from '@/src/types/reasoning.types';
import { emitToolCallRequest, type ToolCallRequestEvent } from './useToolCallDecisions';
import { useMcpStore } from '@/src/stores/mcp.store';
import type { McpConnectionState } from '@/src/types/mcp.types';
import { useProviderAuthStore } from '@/src/stores/providerAuth.store';
import type { ProviderTransport } from '@/src/types/provider-auth.types';

interface TextData { chunk: string }
interface ThinkingData { chunk: string }
interface DoneData { model?: string; interrupted?: boolean; reasoningSteps?: ReasoningStep[]; tokensIn?: number; tokensOut?: number }
interface ErrorData { message: string; retryable: boolean }
interface McpStateChangeData {
  id: string;
  state: McpConnectionState;
  error?: string;
  reconnectAttempt?: number;
  reconnectMaxAttempts?: number;
}

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : 'Unknown error';
}

const PROBED_TRANSPORTS = ['anthropic', 'openai', 'gemini', 'ollama'] as const;

function maybeRefreshAuthStatus(providerName: string | undefined): void {
  if (!providerName) return;
  const transport = providerName.split(':')[0];
  if ((PROBED_TRANSPORTS as readonly string[]).includes(transport)) {
    void useProviderAuthStore.getState().refresh(transport as ProviderTransport);
  }
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
            tokensIn: d.tokensIn,
            tokensOut: d.tokensOut,
          });
          return;
        } else if (ev.event === 'error') {
          const d = ev.data as ErrorData;
          maybeRefreshAuthStatus(activeName);
          useChatStore.getState().failAssistant(id, d.message, !!d.retryable);
          return;
        } else if (ev.event === 'tool_call_request') {
          // payload shape from backend N1: { id, qualifiedName, args }
          emitToolCallRequest(ev.data as ToolCallRequestEvent);
        } else if (ev.event === 'tool_call_started') {
          const p = ev.data as {
            callId?: string;
            id?: string;
            qualifiedName: string;
            args: Record<string, unknown>;
          };
          const callId = p.callId ?? p.id ?? '';
          if (callId) {
            useMcpStore.getState().registerInFlightCall({
              callId,
              qualifiedName: p.qualifiedName,
              args: p.args,
            });
          }
        } else if (ev.event === 'tool_call_progress') {
          const p = ev.data as { id: string; note: string };
          useMcpStore.getState().updateInFlightProgress(p.id, p.note);
        } else if (ev.event === 'tool_call_result') {
          const p = ev.data as { id?: string; callId?: string };
          const callId = p.id ?? p.callId;
          if (callId) useMcpStore.getState().clearInFlightCall(callId);
        } else if (ev.event === 'mcp:state_change') {
          const d = ev.data as McpStateChangeData;
          useMcpStore.getState().applyServerStateEvent(
            d.id,
            d.state,
            d.error,
            d.reconnectAttempt,
            d.reconnectMaxAttempts,
          );
        }
      }
      useChatStore.getState().finishAssistant(id, { interrupted: controller.signal.aborted });
    } catch (e) {
      if (controller.signal.aborted) {
        useChatStore.getState().finishAssistant(id, { interrupted: true });
      } else {
        maybeRefreshAuthStatus(activeName);
        useChatStore.getState().failAssistant(id, errMsg(e), true);
      }
    } finally {
      useSessionsStore.getState().touchUpdatedAt(activeId, Date.now());
    }
  }, []);

  const resume = useCallback(async (messageId: string) => {
    const activeId = useSessionsStore.getState().activeSessionId;
    if (!activeId) {
      console.warn('[aether] no active session');
      return;
    }
    const chat = useChatStore.getState();
    if (chat.streamingId) return;

    useUiStore.getState().setFocusedMessageId(null);

    const sessions = useSessionsStore.getState().sessions;
    const defaultProvider = useProvidersStore.getState().defaultProvider;
    const activeName =
      ((sessions.find((s) => s.id === activeId) as { providerName?: string } | undefined)
        ?.providerName ?? defaultProvider) ?? undefined;

    const { id } = chat.startAssistant();
    const controller = new AbortController();
    chat.setAbortController(controller);

    let firstThinkingSeen = false;

    try {
      for await (const ev of createResumingDispatch(
        { sessionId: activeId, messageId, ...(activeName ? { providerName: activeName } : {}) },
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
            tokensIn: d.tokensIn,
            tokensOut: d.tokensOut,
          });
          return;
        } else if (ev.event === 'error') {
          const d = ev.data as ErrorData;
          maybeRefreshAuthStatus(activeName);
          useChatStore.getState().failAssistant(id, d.message, !!d.retryable);
          return;
        } else if (ev.event === 'tool_call_request') {
          emitToolCallRequest(ev.data as ToolCallRequestEvent);
        } else if (ev.event === 'tool_call_started') {
          const p = ev.data as {
            callId?: string;
            id?: string;
            qualifiedName: string;
            args: Record<string, unknown>;
          };
          const callId = p.callId ?? p.id ?? '';
          if (callId) {
            useMcpStore.getState().registerInFlightCall({
              callId,
              qualifiedName: p.qualifiedName,
              args: p.args,
            });
          }
        } else if (ev.event === 'tool_call_progress') {
          const p = ev.data as { id: string; note: string };
          useMcpStore.getState().updateInFlightProgress(p.id, p.note);
        } else if (ev.event === 'tool_call_result') {
          const p = ev.data as { id?: string; callId?: string };
          const callId = p.id ?? p.callId;
          if (callId) useMcpStore.getState().clearInFlightCall(callId);
        } else if (ev.event === 'mcp:state_change') {
          const d = ev.data as McpStateChangeData;
          useMcpStore.getState().applyServerStateEvent(
            d.id,
            d.state,
            d.error,
            d.reconnectAttempt,
            d.reconnectMaxAttempts,
          );
        }
      }
      useChatStore.getState().finishAssistant(id, { interrupted: controller.signal.aborted });
    } catch (e) {
      if (controller.signal.aborted) {
        useChatStore.getState().finishAssistant(id, { interrupted: true });
      } else {
        maybeRefreshAuthStatus(activeName);
        useChatStore.getState().failAssistant(id, errMsg(e), true);
      }
    } finally {
      useSessionsStore.getState().touchUpdatedAt(activeId, Date.now());
    }
  }, []);

  const abort = useCallback(() => {
    useChatStore.getState().abort();
  }, []);

  return { send, abort, resume, isStreaming };
}
