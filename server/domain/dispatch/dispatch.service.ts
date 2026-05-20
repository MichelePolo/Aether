import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { z } from 'zod';
import type { SseEmitter } from '@/server/lib/sse';
import type { ContextStore } from '@/server/domain/context/context.store';
import type { HistoryStore } from '@/server/domain/history/history.store';
import type {
  ProviderFunctionCall,
  ProviderToolResultMessage,
  ProviderUsage,
} from './providers/provider.types';
import { ReasoningTracer } from '@/server/domain/reasoning/reasoning.tracer';
import type { SubAgentsStore } from '@/server/domain/subagents/subagents.store';
import type { SubAgentRecord } from '@/server/domain/subagents/subagents.types';
import { parseLeadingMention } from './subagent-parser';
import { assemble } from './prompt-assembler';
import type { McpRegistry } from '@/server/domain/mcp/registry';
import type { McpToolResult } from '@/server/domain/mcp/mcp.types';
import type { ProviderRegistry } from '@/server/domain/providers/registry';

export const DispatchRequestSchema = z.object({
  sessionId: z.string().min(1),
  message: z.string().min(1),
  thinking: z.boolean().optional(),
  providerName: z.string().optional(),
});
export type DispatchRequest = z.infer<typeof DispatchRequestSchema>;

export interface DispatchServiceDeps {
  providers: ProviderRegistry;
  historyStore: HistoryStore;
  contextStore: ContextStore;
  subAgentsStore?: SubAgentsStore;
  mcpRegistry?: McpRegistry;
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
    const { historyStore, contextStore } = this.deps;

    const sessionRecord = await this.deps.historyStore.readRecord(sessionId);
    const requestedName = parsed.data.providerName;
    const sessionName = sessionRecord?.providerName;
    const fallbackName = this.deps.providers.defaultName();
    const providerName = requestedName ?? sessionName ?? fallbackName;
    if (!providerName) {
      sse.event('error', { message: 'No provider available', retryable: false });
      sse.end();
      return;
    }
    const provider = this.deps.providers.get(providerName);
    if (!provider) {
      sse.event('error', { message: `Provider '${providerName}' not available`, retryable: false });
      sse.end();
      return;
    }

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

    const liveTools = this.deps.mcpRegistry?.listLiveTools() ?? [];
    const mcpToolDecls = liveTools.map((t) => ({
      qualifiedName: t.qualifiedName,
      description: t.tool.description,
      schema: t.tool.inputSchema,
    }));
    const assembled = assemble(context, matchedSubAgent, mention.stripped, mention.name, mcpToolDecls);

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

    const MAX_TOOL_CALLS_PER_DISPATCH = 10;
    let pendingToolResults: ProviderToolResultMessage[] = [];
    let toolCallsCount = 0;

    try {
      await tracer.step({
        type: 'dispatch',
        title: `Dispatch to ${provider.model}${thinking ? ' (thinking)' : ''}`,
        run: async () => {
          while (true) {
            const it = provider.stream(
              {
                systemInstruction: assembled.systemInstruction,
                history: prior.map((m) => ({ role: m.role, text: m.text })),
                userMessage: assembled.message,
                thinking,
                mcpTools: assembled.mcpTools,
                toolResults: pendingToolResults.length > 0 ? pendingToolResults : undefined,
                pendingAssistantText: accumText || undefined,
              },
              signal,
            );
            pendingToolResults = [];

            let pendingCall: ProviderFunctionCall | null = null;

            for await (const chunk of it) {
              if (signal.aborted) break;
              if (chunk.type === 'text') {
                accumText += chunk.text;
                sse.event('text', { chunk: chunk.text });
              } else if (chunk.type === 'thinking') {
                if (thinkingStart === undefined) thinkingStart = performance.now();
                accumThought += chunk.text;
                sse.event('thinking', { chunk: chunk.text });
              } else if (chunk.type === 'function_call') {
                pendingCall = chunk.call;
                break;
              } else if (chunk.type === 'done') {
                dispatchUsage = chunk.usage;
                break;
              }
            }

            if (!pendingCall) break;

            if (toolCallsCount >= MAX_TOOL_CALLS_PER_DISPATCH) {
              pendingToolResults = [{
                callId: pendingCall.callId,
                qualifiedName: pendingCall.qualifiedName,
                ok: false,
                error: 'Max tool calls per dispatch exceeded',
              }];
              pendingCall = null;
              continue;
            }
            toolCallsCount += 1;

            sse.event('tool_call_request', pendingCall);
            const policy = this.deps.mcpRegistry?.policy(pendingCall.qualifiedName) ?? { autoApprove: false };
            const decision: 'approve' | 'reject' = policy.autoApprove
              ? 'approve'
              : await (this.deps.mcpRegistry?.awaitDecision(pendingCall.callId, 60_000) ?? Promise.resolve('reject' as const))
                  .catch(() => 'reject' as const);

            const t0 = performance.now();
            let toolResult: McpToolResult;
            if (decision === 'reject') {
              toolResult = { ok: false, error: 'Rejected by user' };
            } else if (!this.deps.mcpRegistry) {
              toolResult = { ok: false, error: 'No MCP registry configured' };
            } else {
              toolResult = await this.deps.mcpRegistry.callTool(pendingCall.qualifiedName, pendingCall.args);
            }
            const durationMs = Math.round(performance.now() - t0);

            sse.event('tool_call_result', { id: pendingCall.callId, ...toolResult });

            tracer.pushExternal({
              type: 'tool_call',
              title: `Tool: ${pendingCall.qualifiedName}`,
              content: toolResult.ok
                ? `executed ${pendingCall.qualifiedName}`
                : `tool failed: ${toolResult.error}`,
              durationMs,
              toolCall: {
                id: pendingCall.callId,
                qualifiedName: pendingCall.qualifiedName,
                args: pendingCall.args,
                result: toolResult.ok ? toolResult.output : undefined,
                error: toolResult.ok ? undefined : toolResult.error,
                durationMs,
              },
            });

            pendingToolResults = [{
              callId: pendingCall.callId,
              qualifiedName: pendingCall.qualifiedName,
              ok: toolResult.ok,
              output: toolResult.ok ? toolResult.output : undefined,
              error: toolResult.ok ? undefined : toolResult.error,
            }];
            pendingCall = null;
          }

          return {
            content: `${accumText.length} chars streamed${
              accumThought.length > 0 ? `, ${accumThought.length} chars thinking` : ''
            }${toolCallsCount > 0 ? `, ${toolCallsCount} tool calls` : ''}`,
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
