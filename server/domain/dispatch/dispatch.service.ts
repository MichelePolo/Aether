import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { z } from 'zod';
import type { SseEmitter } from '@/server/lib/sse';
import type { ContextStore } from '@/server/domain/context/context.store';
import type { HistoryStore } from '@/server/domain/history/history.store';
import type { AIProvider, ProviderUsage } from './providers/provider.types';
import { ReasoningTracer } from '@/server/domain/reasoning/reasoning.tracer';
import type { SubAgentsStore } from '@/server/domain/subagents/subagents.store';
import type { SubAgentRecord } from '@/server/domain/subagents/subagents.types';
import { parseLeadingMention } from './subagent-parser';
import { assemble } from './prompt-assembler';

export const DispatchRequestSchema = z.object({
  sessionId: z.string().min(1),
  message: z.string().min(1),
  thinking: z.boolean().optional(),
});
export type DispatchRequest = z.infer<typeof DispatchRequestSchema>;

export interface DispatchServiceDeps {
  provider: AIProvider;
  historyStore: HistoryStore;
  contextStore: ContextStore;
  subAgentsStore?: SubAgentsStore;
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
    const { sessionId, message, thinking } = parsed.data;
    const { provider, historyStore, contextStore } = this.deps;

    const prior = await historyStore.read(sessionId);
    if (prior === null) {
      sse.event('error', { message: 'Session not found', retryable: false });
      sse.end();
      return;
    }

    const tracer = new ReasoningTracer(sse);

    let context;
    try {
      context = await tracer.step({
        type: 'context_fetch',
        title: 'Read context',
        run: async () => {
          const ctx = await contextStore.read();
          return {
            content: `loaded systemInstruction (${ctx.systemInstruction.length} chars)`,
            result: ctx,
          };
        },
      });
    } catch {
      sse.event('error', { message: 'Context load failed', retryable: true });
      sse.end();
      return;
    }

    let knownNames: ReadonlySet<string> = new Set<string>();
    let allRecords: Array<{ name: string; record: SubAgentRecord }> = [];
    if (this.deps.subAgentsStore) {
      try {
        const metas = await this.deps.subAgentsStore.list();
        const recs = await Promise.all(
          metas.map(async (m) => {
            const record = await this.deps.subAgentsStore!.read(m.id);
            return record ? { name: m.name, record } : null;
          }),
        );
        allRecords = recs.filter((r): r is { name: string; record: SubAgentRecord } => r !== null);
        knownNames = new Set(allRecords.map((r) => r.name));
      } catch {
        // Degrade silently: knownNames stays empty.
      }
    }

    const mention = parseLeadingMention(message, knownNames);
    const matchedSubAgent =
      mention.name === null
        ? null
        : allRecords.find((r) => r.name === mention.name)?.record ?? null;

    if (matchedSubAgent && mention.name) {
      const subName = mention.name;
      const sa = matchedSubAgent;
      await tracer.step({
        type: 'resolve_subagent',
        title: `Sub-agent: ${subName}`,
        run: async () => ({
          content: `systemInstruction +${sa.systemInstruction.length} chars, +${sa.skills.length} skills, +${sa.tools.length} tools`,
          subAgent: subName,
          result: null,
        }),
      });
    }

    const assembled = assemble(context, matchedSubAgent, mention.stripped, mention.name);

    await historyStore.append(sessionId, {
      id: randomUUID(),
      role: 'user',
      text: message,
      timestamp: Date.now(),
    });

    let accumText = '';
    let accumThought = '';
    let thinkingStart: number | undefined;
    let dispatchUsage: ProviderUsage | undefined;

    try {
      await tracer.step({
        type: 'dispatch',
        title: `Dispatch to ${provider.model}${thinking ? ' (thinking)' : ''}`,
        run: async () => {
          const it = provider.stream(
            {
              systemInstruction: assembled.systemInstruction,
              history: prior.map((m) => ({ role: m.role, text: m.text })),
              userMessage: assembled.message,
              thinking,
            },
            signal,
          );
          for await (const chunk of it) {
            if (signal.aborted) break;
            if (chunk.type === 'text') {
              accumText += chunk.text;
              sse.event('text', { chunk: chunk.text });
            } else if (chunk.type === 'thinking') {
              if (thinkingStart === undefined) thinkingStart = performance.now();
              accumThought += chunk.text;
              sse.event('thinking', { chunk: chunk.text });
            } else if (chunk.type === 'done') {
              dispatchUsage = chunk.usage;
              break;
            }
          }
          return {
            content: `${accumText.length} chars streamed${
              accumThought.length > 0 ? `, ${accumThought.length} chars thinking` : ''
            }`,
            tokens: dispatchUsage?.totalTokens,
            subAgent: assembled.subAgent ?? undefined,
            result: null,
          };
        },
      });
    } catch (e) {
      const { message: msg, retryable } = classifyError(e);
      sse.event('error', { message: msg, retryable });
      await historyStore.append(sessionId, {
        id: randomUUID(),
        role: 'model',
        text: accumText,
        timestamp: Date.now(),
        model: provider.model,
        error: msg,
        retryable,
        reasoningSteps: tracer.finalSteps(),
      });
      sse.end();
      return;
    }

    if (accumThought.length > 0 && thinkingStart !== undefined) {
      tracer.pushExternal({
        type: 'thinking',
        title: 'Gemini thoughts',
        content: accumThought,
        durationMs: Math.round(performance.now() - thinkingStart),
      });
    }

    await tracer.step({
      type: 'validation',
      title: 'Validate response',
      run: async () => {
        const ok = accumText.length > 0;
        const tokens = dispatchUsage?.totalTokens;
        return {
          content: `response length ${accumText.length}${
            tokens !== undefined ? `, tokens ${tokens}` : ''
          }${ok ? '' : ' (empty)'}`,
          tokens,
          result: null,
        };
      },
    });

    const interrupted = signal.aborted;
    const reasoningSteps = tracer.finalSteps();

    await historyStore.append(sessionId, {
      id: randomUUID(),
      role: 'model',
      text: accumText,
      timestamp: Date.now(),
      model: provider.model,
      interrupted,
      reasoningSteps,
    });

    sse.event('done', { model: provider.model, interrupted, reasoningSteps });
    sse.end();
  }
}

function classifyError(e: unknown): { message: string; retryable: boolean } {
  const message = e instanceof Error ? e.message : 'Unknown error';
  const code = (e as { code?: string; status?: number }).code;
  const status = (e as { status?: number }).status;
  if (code === 'ECONNRESET' || code === 'ETIMEDOUT' || code === 'EAI_AGAIN') {
    return { message, retryable: true };
  }
  if (status === 429 || status === 503 || status === 504) {
    return { message, retryable: true };
  }
  if (status === 401 || status === 403 || /api[_ ]?key|auth|unauthor/i.test(message)) {
    return { message, retryable: false };
  }
  return { message, retryable: true };
}
