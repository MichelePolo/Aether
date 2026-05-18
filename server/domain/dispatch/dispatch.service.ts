import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { SseEmitter } from '@/server/lib/sse';
import type { ContextStore } from '@/server/domain/context/context.store';
import type { HistoryStore } from '@/server/domain/history/history.store';
import type { AIProvider } from './providers/provider.types';

export const DispatchRequestSchema = z.object({
  message: z.string().min(1),
});
export type DispatchRequest = z.infer<typeof DispatchRequestSchema>;

export interface DispatchServiceDeps {
  provider: AIProvider;
  historyStore: HistoryStore;
  contextStore: ContextStore;
}

export class DispatchService {
  constructor(private readonly deps: DispatchServiceDeps) {}

  async handle(
    rawBody: unknown,
    sse: SseEmitter,
    signal: AbortSignal,
  ): Promise<void> {
    const parsed = DispatchRequestSchema.safeParse(rawBody);
    if (!parsed.success) {
      sse.error('Invalid request body', false);
      return;
    }
    const { message } = parsed.data;
    const { provider, historyStore, contextStore } = this.deps;

    let context;
    try {
      context = await contextStore.read();
    } catch {
      sse.event('error', { message: 'Context load failed', retryable: true });
      sse.end();
      return;
    }

    const priorHistory = await historyStore.read();
    const now = Date.now();
    await historyStore.append({
      id: randomUUID(),
      role: 'user',
      text: message,
      timestamp: now,
    });

    let accumulated = '';
    try {
      const it = provider.stream(
        {
          systemInstruction: context.systemInstruction,
          history: priorHistory.map((m) => ({ role: m.role, text: m.text })),
          userMessage: message,
        },
        signal,
      );
      for await (const chunk of it) {
        if (signal.aborted) break;
        if (chunk.type === 'text') {
          accumulated += chunk.text;
          sse.event('text', { chunk: chunk.text });
        } else if (chunk.type === 'done') {
          break;
        }
      }
    } catch (e) {
      const { message: msg, retryable } = classifyError(e);
      sse.event('error', { message: msg, retryable });
      // salva il partial comunque per coerenza UX
      await historyStore.append({
        id: randomUUID(),
        role: 'model',
        text: accumulated,
        timestamp: Date.now(),
        model: provider.model,
        error: msg,
        retryable,
      });
      sse.end();
      return;
    }

    const interrupted = signal.aborted;
    await historyStore.append({
      id: randomUUID(),
      role: 'model',
      text: accumulated,
      timestamp: Date.now(),
      model: provider.model,
      interrupted,
    });

    sse.event('done', { model: provider.model, interrupted });
    sse.end();
  }
}

function classifyError(e: unknown): { message: string; retryable: boolean } {
  const message = e instanceof Error ? e.message : 'Unknown error';
  const code = (e as { code?: string; status?: number }).code;
  const status = (e as { status?: number }).status;
  // Retryable: network/transient/rate-limit
  if (code === 'ECONNRESET' || code === 'ETIMEDOUT' || code === 'EAI_AGAIN') {
    return { message, retryable: true };
  }
  if (status === 429 || status === 503 || status === 504) {
    return { message, retryable: true };
  }
  // Non-retryable: auth/config
  if (status === 401 || status === 403 || /api[_ ]?key|auth|unauthor/i.test(message)) {
    return { message, retryable: false };
  }
  // Default: retryable=true (conservativo per network blips)
  return { message, retryable: true };
}
