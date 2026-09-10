import type { SseEvent } from '@/src/lib/sse-parser';
import { useCallback } from 'react';
import { useChatStore } from '@/src/stores/chat.store';
import { useSessionsStore } from '@/src/stores/sessions.store';
import { useProvidersStore } from '@/src/stores/providers.store';
import { useUiStore } from '@/src/stores/ui.store';
import { createStreamingDispatch, createResumingDispatch } from '@/src/lib/api/dispatch.api';
import { computeTitle } from '@/src/lib/title';
import type { ReasoningStep } from '@/src/types/reasoning.types';
import { createToolEventConsumer } from '@/src/lib/tool-events';
import type { Message } from '@/src/types/message.types';
import { useProviderAuthStore } from '@/src/stores/providerAuth.store';
import type { ProviderTransport } from '@/src/types/provider-auth.types';

interface TextData { chunk: string }
interface ThinkingData { chunk: string }
interface DoneData { model?: string; interrupted?: boolean; reasoningSteps?: ReasoningStep[]; tokensIn?: number; tokensOut?: number }
interface ErrorData { message: string; retryable: boolean }
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

async function consumeChatStream(stream: AsyncIterable<SseEvent>, opts: { id: string; userId?: string; controller: AbortController; activeId: string; activeName?: string }): Promise<void> {
  let { id } = opts;
  const { userId, controller, activeId, activeName } = opts;
  let firstThinkingSeen = false;
  const toolEvents = createToolEventConsumer();
  try {
    for await (const ev of stream) {
      if (ev.event === 'message_ids') {
        const d = ev.data as { modelMessageId: string; userMessageId?: string; attachments?: Message['attachments'] };
        if (userId && d.userMessageId) useChatStore.getState().reconcileMessage(userId, d.userMessageId, d.attachments);
        useChatStore.getState().reconcileMessage(id, d.modelMessageId);
        id = d.modelMessageId;
      } else if (ev.event === 'text') {
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
        if (userId) useChatStore.getState().clearQueuedAttachments();
        return;
      } else if (ev.event === 'error') {
        const d = ev.data as ErrorData;
        maybeRefreshAuthStatus(activeName);
        useChatStore.getState().failAssistant(id, d.message, !!d.retryable);
        return;
      } else {
        toolEvents.consume(ev.event, ev.data);
      }
    }
    // A closed stream without a terminal event is incomplete, including network EOF.
    useChatStore.getState().finishAssistant(id, { interrupted: true });
  } catch (e) {
    if (controller.signal.aborted) useChatStore.getState().finishAssistant(id, { interrupted: true });
    else {
      maybeRefreshAuthStatus(activeName);
      useChatStore.getState().failAssistant(id, errMsg(e), true);
    }
  } finally {
    toolEvents.close();
    useSessionsStore.getState().touchUpdatedAt(activeId, Date.now());
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
    const aetherMode = useUiStore.getState().aetherMode;

    const sessions = useSessionsStore.getState().sessions;
    const defaultProvider = useProvidersStore.getState().defaultProvider;
    const activeName =
      ((sessions.find((s) => s.id === activeId) as { providerName?: string } | undefined)
        ?.providerName ?? defaultProvider) ?? undefined;

    const queuedAttachments = useChatStore.getState().queuedAttachments;
    const attachments = queuedAttachments.length > 0
      ? queuedAttachments.map((a) => ({
          name: a.name,
          mime: a.mime,
          size: a.size,
          contentBase64: a.base64,
        }))
      : undefined;

    const { id: userId } = chat.appendUser(trimmed);
    const { id } = chat.startAssistant();
    const controller = new AbortController();
    chat.setAbortController(controller);

    await consumeChatStream(createStreamingDispatch({
      sessionId: activeId, message: trimmed, thinking, aetherMode,
      ...(defaultProvider ? { defaultProviderName: defaultProvider } : {}),
      ...(attachments ? { attachments } : {}),
    }, controller.signal), { id, userId, controller, activeId, activeName });
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

    const aetherMode = useUiStore.getState().aetherMode;
    await consumeChatStream(createResumingDispatch({ sessionId: activeId, messageId, aetherMode }, controller.signal),
      { id, controller, activeId, activeName });
  }, []);

  const abort = useCallback(() => {
    useChatStore.getState().abort();
  }, []);

  return { send, abort, resume, isStreaming };
}
