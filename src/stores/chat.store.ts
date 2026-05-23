import { create } from 'zustand';
import { newId } from '@/src/lib/ids';
import type { Message } from '@/src/types/message.types';
import type { ReasoningStep } from '@/src/types/reasoning.types';

interface CurrentReasoning {
  thinkingText: string;
  steps: ReasoningStep[];
}

interface ChatState {
  messages: Message[];
  streamingId: string | null;
  abortController: AbortController | null;
  hydrated: boolean;
  currentReasoning: CurrentReasoning;

  hydrate: (messages: Message[]) => void;
  appendUser: (text: string) => { id: string };
  startAssistant: () => { id: string };
  appendChunk: (id: string, text: string) => void;
  appendThinkingChunk: (text: string) => void;
  appendReasoningStep: (step: ReasoningStep) => void;
  finishAssistant: (
    id: string,
    opts: { model?: string; interrupted?: boolean; reasoningSteps?: ReasoningStep[]; tokensIn?: number; tokensOut?: number },
  ) => void;
  failAssistant: (id: string, error: string, retryable: boolean) => void;
  setAbortController: (c: AbortController | null) => void;
  abort: () => void;
  reset: () => void;
  _reset: () => void;
}

const emptyReasoning: CurrentReasoning = { thinkingText: '', steps: [] };

const initial = {
  messages: [] as Message[],
  streamingId: null as string | null,
  abortController: null as AbortController | null,
  hydrated: false,
  currentReasoning: emptyReasoning,
};

export const useChatStore = create<ChatState>((set, get) => ({
  ...initial,
  _reset: () => set(initial),
  reset: () => set(initial),

  hydrate: (messages) => set({ messages, hydrated: true }),

  appendUser: (text) => {
    const msg: Message = { id: newId(), role: 'user', text, timestamp: Date.now() };
    set((s) => ({ messages: [...s.messages, msg] }));
    return { id: msg.id };
  },

  startAssistant: () => {
    const msg: Message = { id: newId(), role: 'model', text: '', timestamp: Date.now() };
    set((s) => ({
      messages: [...s.messages, msg],
      streamingId: msg.id,
      currentReasoning: emptyReasoning,
    }));
    return { id: msg.id };
  },

  appendChunk: (id, text) =>
    set((s) => ({
      messages: s.messages.map((m) =>
        m.id === id ? { ...m, text: m.text + text } : m,
      ),
    })),

  appendThinkingChunk: (text) =>
    set((s) => ({
      currentReasoning: {
        ...s.currentReasoning,
        thinkingText: s.currentReasoning.thinkingText + text,
      },
    })),

  appendReasoningStep: (step) =>
    set((s) => ({
      currentReasoning: {
        ...s.currentReasoning,
        steps: [...s.currentReasoning.steps, step],
      },
    })),

  finishAssistant: (id, opts) =>
    set((s) => ({
      streamingId: s.streamingId === id ? null : s.streamingId,
      messages: s.messages.map((m) =>
        m.id === id
          ? {
              ...m,
              model: opts.model,
              interrupted: opts.interrupted,
              reasoningSteps: opts.reasoningSteps ?? m.reasoningSteps,
              ...(opts.tokensIn != null ? { tokensIn: opts.tokensIn } : {}),
              ...(opts.tokensOut != null ? { tokensOut: opts.tokensOut } : {}),
            }
          : m,
      ),
      abortController: null,
      currentReasoning: emptyReasoning,
    })),

  failAssistant: (id, error, retryable) =>
    set((s) => ({
      streamingId: s.streamingId === id ? null : s.streamingId,
      messages: s.messages.map((m) =>
        m.id === id ? { ...m, error, retryable } : m,
      ),
      abortController: null,
      currentReasoning: emptyReasoning,
    })),

  setAbortController: (c) => set({ abortController: c }),

  abort: () => {
    const c = get().abortController;
    if (!c) return;
    c.abort();
    set({ abortController: null });
  },
}));

export function contextSizeOfActive(state: ChatState): {
  total: number;
  prompt: number;
  reply: number;
} | null {
  const lastAssistant = [...state.messages].reverse().find((m) => m.role === 'model');
  if (!lastAssistant || lastAssistant.tokensIn == null || lastAssistant.tokensOut == null) return null;
  return {
    prompt: lastAssistant.tokensIn,
    reply: lastAssistant.tokensOut,
    total: lastAssistant.tokensIn + lastAssistant.tokensOut,
  };
}
