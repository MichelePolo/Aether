import { create } from 'zustand';
import { newId } from '@/src/lib/ids';
import type { Message } from '@/src/types/message.types';
import type { ReasoningStep } from '@/src/types/reasoning.types';
import type { QueuedAttachment } from '@/src/types/attachment.types';

// ── Attachment helpers ────────────────────────────────────────────────────────

const MAX_ATTACHMENTS = 5;
const MAX_TOTAL_BYTES = 10 * 1024 * 1024;

const IMAGE_MIMES = new Set<string>([
  'image/png',
  'image/jpeg',
  'image/jpg',
  'image/webp',
  'image/gif',
]);

const TEXT_EXTENSIONS = new Set<string>([
  'md', 'json', 'ts', 'tsx', 'js', 'jsx', 'py', 'yaml', 'yml',
  'toml', 'sh', 'sql', 'rb', 'go', 'rs', 'java', 'c', 'cpp', 'h',
  'html', 'css', 'csv', 'env', 'gitignore', 'txt',
]);

function classifyFile(name: string, mime: string): 'image' | 'text' | null {
  if (IMAGE_MIMES.has(mime)) return 'image';
  if (mime.startsWith('text/')) return 'text';
  const dot = name.lastIndexOf('.');
  if (dot === -1) return null;
  const ext = name.slice(dot + 1).toLowerCase();
  if (!ext) return null;
  if (TEXT_EXTENSIONS.has(ext)) return 'text';
  return null;
}

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
  streamingId: string | null;
  abortController: AbortController | null;
  hydrated: boolean;
  currentReasoning: CurrentReasoning;
  queuedAttachments: QueuedAttachment[];
  error: string | null;
  stickyApprovals: Set<string>;

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
  queueAttachments: (files: File[]) => Promise<void>;
  removeQueuedAttachment: (id: string) => void;
  clearQueuedAttachments: () => void;
  addStickyApproval: (qualifiedName: string) => void;
  clearStickyApprovals: () => void;
}

const emptyReasoning: CurrentReasoning = { thinkingText: '', steps: [] };

const initial = {
  messages: [] as Message[],
  streamingId: null as string | null,
  abortController: null as AbortController | null,
  hydrated: false,
  currentReasoning: emptyReasoning,
  queuedAttachments: [] as QueuedAttachment[],
  error: null as string | null,
  stickyApprovals: new Set<string>(),
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
  clearStickyApprovals: () => set({ stickyApprovals: new Set<string>() }),

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
      const dataUri = `data:${file.type};base64,${base64}`;
      accepted.push({
        id: newId(),
        name: file.name,
        mime: file.type,
        size: file.size,
        base64,
        dataUri,
      });
    }

    set((s) => ({
      queuedAttachments: [...s.queuedAttachments, ...accepted],
      error: null,
    }));
  },

  removeQueuedAttachment: (id: string) =>
    set((s) => ({
      queuedAttachments: s.queuedAttachments.filter((a) => a.id !== id),
    })),

  clearQueuedAttachments: () => set({ queuedAttachments: [] }),
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
