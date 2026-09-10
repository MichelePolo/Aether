import { create } from 'zustand';
import { newId } from '@/src/lib/ids';
import type { Message } from '@/src/types/message.types';
import type { ReasoningStep } from '@/src/types/reasoning.types';
import type { QueuedAttachment } from '@/src/types/attachment.types';

// ── Attachment helpers ────────────────────────────────────────────────────────

import { MAX_ATTACHMENTS, MAX_TOTAL_BYTES, classifyAttachment as classifyFile, normalizeAttachmentMime } from '@/src/lib/attachments';

async function readFileBase64(file: File): Promise<string> {
  const buf = await file.arrayBuffer();
  const bytes = new Uint8Array(buf);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

// ─────────────────────────────────────────────────────────────────────────────

interface CurrentReasoning {
  thinkingText: string;
  steps: ReasoningStep[];
}

interface ChatState {
  messages: Message[];
  messagesById: Record<string, Message>;
  streamingId: string | null;
  abortController: AbortController | null;
  hydrated: boolean;
  currentReasoning: CurrentReasoning;
  queuedAttachments: QueuedAttachment[];
  error: string | null;
  stickyApprovals: Set<string>;
  pendingComposerText: string | null;

  hydrate: (messages: Message[]) => void;
  reconcileMessage: (localId: string, serverId: string, attachments?: Message["attachments"]) => void;
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
  removeMessage: (id: string) => void;
  setAbortController: (c: AbortController | null) => void;
  abort: () => void;
  reset: () => void;
  _reset: () => void;
  queueAttachments: (files: File[]) => Promise<void>;
  removeQueuedAttachment: (id: string) => void;
  clearQueuedAttachments: () => void;
  addStickyApproval: (qualifiedName: string) => void;
  removeStickyApproval: (qualifiedName: string) => void;
  clearStickyApprovals: () => void;
  setPendingComposerText: (text: string | null) => void;
  clearError: () => void;
}

const emptyReasoning: CurrentReasoning = { thinkingText: '', steps: [] };

function withMessages(next: Message[]): { messages: Message[]; messagesById: Record<string, Message> } {
  const byId: Record<string, Message> = {};
  for (const m of next) byId[m.id] = m;
  return { messages: next, messagesById: byId };
}

const initial = {
  messages: [] as Message[],
  messagesById: {} as Record<string, Message>,
  streamingId: null as string | null,
  abortController: null as AbortController | null,
  hydrated: false,
  currentReasoning: emptyReasoning,
  queuedAttachments: [] as QueuedAttachment[],
  error: null as string | null,
  stickyApprovals: new Set<string>(),
  pendingComposerText: null as string | null,
};

function freshState() {
  return { ...initial, stickyApprovals: new Set<string>() };
}

export const useChatStore = create<ChatState>((set, get) => ({
  ...initial,
  _reset: () => set(freshState()),
  reset: () => set(freshState()),
  addStickyApproval: (qualifiedName) =>
    set((s) => ({ stickyApprovals: new Set(s.stickyApprovals).add(qualifiedName) })),
  removeStickyApproval: (qualifiedName) =>
    set((s) => {
      const next = new Set(s.stickyApprovals);
      next.delete(qualifiedName);
      return { stickyApprovals: next };
    }),
  clearStickyApprovals: () => set({ stickyApprovals: new Set<string>() }),

  hydrate: (messages) => set({ ...withMessages(messages), hydrated: true }),

  reconcileMessage: (localId, serverId, attachments) => set((s) => ({
    ...withMessages(s.messages.map(m => m.id === localId ? { ...m, id: serverId, persisted: true, ...(attachments ? { attachments } : {}) } : m)),
    streamingId: s.streamingId === localId ? serverId : s.streamingId,
  })),

  appendUser: (text) => {
    const msg: Message = { id: newId(), role: 'user', persisted: false, text, timestamp: Date.now() };
    set((s) => withMessages([...s.messages, msg]));
    return { id: msg.id };
  },

  startAssistant: () => {
    const msg: Message = { id: newId(), role: 'model', persisted: false, text: '', timestamp: Date.now() };
    set((s) => ({
      ...withMessages([...s.messages, msg]),
      streamingId: msg.id,
      currentReasoning: emptyReasoning,
    }));
    return { id: msg.id };
  },

  appendChunk: (id, text) =>
    set((s) => {
      const cur = s.messagesById[id];
      if (!cur) return s;
      const updated = { ...cur, text: cur.text + text };
      return {
        messages: s.messages.map((m) => (m.id === id ? updated : m)),
        messagesById: { ...s.messagesById, [id]: updated },
      };
    }),

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
      ...withMessages(
        s.messages.map((m) =>
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
      ),
      abortController: null,
      currentReasoning: emptyReasoning,
    })),

  failAssistant: (id, error, retryable) =>
    set((s) => ({
      streamingId: s.streamingId === id ? null : s.streamingId,
      ...withMessages(s.messages.map((m) => (m.id === id ? { ...m, error, retryable } : m))),
      abortController: null,
      currentReasoning: emptyReasoning,
    })),

  removeMessage: (id) => set((s) => withMessages(s.messages.filter((m) => m.id !== id))),

  setAbortController: (c) => set({ abortController: c }),

  abort: () => {
    const c = get().abortController;
    if (!c) return;
    c.abort();
    set({ abortController: null });
  },

  queueAttachments: async (files: File[]) => {
    const current = get().queuedAttachments;

    // Count guard
    if (current.length + files.length > MAX_ATTACHMENTS) {
      set({ error: `Too many attachments — maximum is ${MAX_ATTACHMENTS}.` });
      return;
    }

    // Compute current total size
    const currentTotalSize = current.reduce((acc, a) => acc + a.size, 0);

    const accepted: QueuedAttachment[] = [];
    let runningSize = currentTotalSize;

    for (const file of files) {
      // MIME check
      const kind = classifyFile(file.name, file.type);
      if (kind === null) {
        set({ error: `${file.name} is not a supported file type.` });
        return;
      }

      // Size check
      if (runningSize + file.size > MAX_TOTAL_BYTES) {
        set({ error: `${file.name} is too large — total attachments must stay under 10 MB.` });
        return;
      }
      runningSize += file.size;

      const base64 = await readFileBase64(file);
      const dataUri = `data:${normalizeAttachmentMime(file.name, file.type)};base64,${base64}`;
      accepted.push({
        id: newId(),
        name: file.name,
        mime: normalizeAttachmentMime(file.name, file.type),
        size: file.size,
        base64,
        dataUri,
      });
    }

    set((s) => {
      const combined = [...s.queuedAttachments, ...accepted];
      if (combined.length > MAX_ATTACHMENTS || combined.reduce((n, a) => n + a.size, 0) > MAX_TOTAL_BYTES) {
        return { error: 'Attachment limits exceeded.' };
      }
      return { queuedAttachments: combined, error: null };
    });
  },

  removeQueuedAttachment: (id: string) =>
    set((s) => ({
      queuedAttachments: s.queuedAttachments.filter((a) => a.id !== id),
    })),

  clearQueuedAttachments: () => set({ queuedAttachments: [] }),

  setPendingComposerText: (text) => set({ pendingComposerText: text }),

  clearError: () => set({ error: null }),
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
