import { create } from 'zustand';
import { newId } from '@/src/lib/ids';
import type { Message } from '@/src/types/message.types';

interface ChatState {
  messages: Message[];
  streamingId: string | null;
  abortController: AbortController | null;
  hydrated: boolean;

  hydrate: (messages: Message[]) => void;
  appendUser: (text: string) => { id: string };
  startAssistant: () => { id: string };
  appendChunk: (id: string, text: string) => void;
  finishAssistant: (id: string, opts: { model?: string; interrupted?: boolean }) => void;
  failAssistant: (id: string, error: string, retryable: boolean) => void;
  setAbortController: (c: AbortController | null) => void;
  abort: () => void;
  reset: () => void;
  _reset: () => void;
}

const initial = {
  messages: [] as Message[],
  streamingId: null as string | null,
  abortController: null as AbortController | null,
  hydrated: false,
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
    set((s) => ({ messages: [...s.messages, msg], streamingId: msg.id }));
    return { id: msg.id };
  },

  appendChunk: (id, text) =>
    set((s) => ({
      messages: s.messages.map((m) =>
        m.id === id ? { ...m, text: m.text + text } : m,
      ),
    })),

  finishAssistant: (id, opts) =>
    set((s) => ({
      streamingId: s.streamingId === id ? null : s.streamingId,
      messages: s.messages.map((m) =>
        m.id === id ? { ...m, ...opts } : m,
      ),
      abortController: null,
    })),

  failAssistant: (id, error, retryable) =>
    set((s) => ({
      streamingId: s.streamingId === id ? null : s.streamingId,
      messages: s.messages.map((m) =>
        m.id === id ? { ...m, error, retryable } : m,
      ),
      abortController: null,
    })),

  setAbortController: (c) => set({ abortController: c }),

  abort: () => {
    const c = get().abortController;
    if (!c) return;
    c.abort();
    set({ abortController: null });
  },
}));
