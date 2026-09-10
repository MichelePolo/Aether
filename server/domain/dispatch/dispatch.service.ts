import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { z } from 'zod';
import type { SseEmitter } from '@/server/lib/sse';
import type { ContextStore } from '@/server/domain/context/context.store';
import type { Message, DispatchContext } from '@/server/domain/history/history.types';
import type { HistoryStore } from '@/server/domain/history/history.store';
import type {
  AIProvider,
  ProviderFunctionCall,
  ProviderToolDecl,
  ProviderToolResultMessage,
  ProviderUsage,
  ProviderRequest,
  ProviderToolRound,
} from './providers/provider.types';
import { ReasoningTracer } from '@/server/domain/reasoning/reasoning.tracer';
import type { SubAgentsStore } from '@/server/domain/subagents/subagents.store';
import type { SubAgentRecord } from '@/server/domain/subagents/subagents.types';
import { parseLeadingMention } from './subagent-parser';
import { assemble, formatAvailableWorkspaces } from './prompt-assembler';
import type { RuntimeContext } from './prompt-assembler';
import { readProjectMemory } from './project-memory';
import { formatAssembledPromptContent } from './assembled-prompt-step';
import type { McpRegistry } from '@/server/domain/mcp/registry';
import type { McpToolResult } from '@/server/domain/mcp/mcp.types';
import type { BreakpointService } from '@/server/domain/mcp/breakpoints/breakpoints.service';
import type { PreviewService } from '@/server/domain/mcp/breakpoints/preview.service';
import type { ProviderRegistry } from '@/server/domain/providers/registry';
import { classifyAttachment, normalizeAttachmentMime, MAX_ATTACHMENTS, MAX_TOTAL_BYTES } from './attachment.types';
import { AppError, ValidationError } from '@/server/lib/errors';
import { normalizeRoot } from '@/server/lib/normalize-root';

const DispatchAttachmentSchema = z.object({
  name: z.string().min(1).max(255),
  mime: z.string().max(127),
  size: z.number().int().nonnegative(),
  contentBase64: z.string(),
});

export const DispatchRequestSchema = z.object({
  sessionId: z.string().min(1),
  message: z.string().min(1),
  thinking: z.boolean().optional(),
  aetherMode: z.boolean().optional(),
  providerName: z.string().optional(),
  defaultProviderName: z.string().optional(),
  workspaceId: z.string().optional(),
  attachments: z.array(DispatchAttachmentSchema).max(MAX_ATTACHMENTS).optional(),
});
export type DispatchRequest = z.infer<typeof DispatchRequestSchema>;

export const ResumeRequestSchema = z.object({
  sessionId: z.string().min(1),
  messageId: z.string().min(1),
  providerName: z.string().optional(),
  aetherMode: z.boolean().optional(),
});
export type ResumeRequest = z.infer<typeof ResumeRequestSchema>;

function preprocessAttachments(
  raw: Array<{ name: string; mime: string; size: number; contentBase64: string }>,
): {
  text: Array<{ name: string; mime: string; bytes: Buffer }>;
  image: Array<{ name: string; mime: string; bytes: Buffer }>;
} {
  let totalBytes = 0;
  const text: Array<{ name: string; mime: string; bytes: Buffer }> = [];
  const image: Array<{ name: string; mime: string; bytes: Buffer }> = [];
  for (const a of raw) {
    a.mime = normalizeAttachmentMime(a.name, a.mime);
    const kind = classifyAttachment(a.name, a.mime);
    if (kind === null) throw new ValidationError(`Unsupported MIME: ${a.mime} for ${a.name}`);
    let bytes: Buffer;
    try {
      bytes = Buffer.from(a.contentBase64, 'base64');
    } catch {
      throw new ValidationError(`Invalid base64 for ${a.name}`);
    }
    totalBytes += bytes.length;
    if (totalBytes > MAX_TOTAL_BYTES) {
      throw new AppError('Attachments exceed 10 MB total', { status: 413, code: 'PAYLOAD_TOO_LARGE' });
    }
    if (kind === 'image') image.push({ name: a.name, mime: a.mime, bytes });
    else text.push({ name: a.name, mime: a.mime, bytes });
  }
  return { text, image };
}

function inlineTextAttachments(userMessage: string, texts: Array<{ name: string; bytes: Buffer }>): string {
  if (texts.length === 0) return userMessage;
  const blocks = texts.map((t) => '```' + t.name + '\n' + t.bytes.toString('utf-8') + '\n```').join('\n\n');
  return userMessage + '\n\n' + blocks;
}

export interface DispatchServiceDeps {
  providers: ProviderRegistry;
  historyStore: HistoryStore;
  contextStore: ContextStore;
  subAgentsStore?: SubAgentsStore;
  mcpRegistry?: McpRegistry;
  breakpointService?: BreakpointService;
  previewService?: PreviewService;
  skillsService?: { getActiveForPrompt(): import('@/server/domain/skills/skills.types').PromptMaterialSkill[] };
  /** Resolve the project root for a session's workspace; null → no project memory.
   *  The resolved root is also the one tagged `-> current` in the
   *  `# availableWorkspaces` prompt block. */
  projectRootFor?: (workspaceId: string | undefined) => string | null;
  /** List every registered workspace root path, for the `# availableWorkspaces`
   *  prompt block. Absent → the block is omitted. */
  listWorkspaceRoots?: () => string[];
  /** Max MCP tool calls executed in a single dispatch before further calls are
   *  rejected with a cap error. Defaults to {@link DEFAULT_MAX_TOOL_CALLS_PER_DISPATCH}. */
  maxToolCallsPerDispatch?: number;
}

/** Default per-dispatch tool-call cap. Aligned with the Anthropic SDK's MAX_TURNS
 *  so agentic file-reading loops are not cut short mid-task (forcing the user to
 *  type "continue"). Override via the `AETHER_MAX_TOOL_CALLS` env in the
 *  composition root. */
export const DEFAULT_MAX_TOOL_CALLS_PER_DISPATCH = 25;

interface RunDispatchLoopOpts {
  provider: AIProvider;
  systemInstruction: string;
  history: ProviderRequest['history'];
  userMessage: string;
  pendingAssistantText?: string;
  thinking: boolean | undefined;
  mcpTools: ProviderToolDecl[];
  subAgent?: string;
  attachments?: Array<{ name: string; mime: string; bytes: Buffer }>;
  currentRoot: string;
}

interface RunDispatchLoopResult {
  accumText: string;
  accumThought: string;
  thinkingStart: number | undefined;
  dispatchUsage: ProviderUsage | undefined;
  toolCallsCount: number;
  error?: { message: string; retryable: boolean };
  /** True when the loop's catch block observed a cancellation (thrown `AbortError`,
   *  or the signal was already aborted) rather than a genuine provider error — e.g.
   *  the client cancelled while the opening `fetch()` was still pending, before any
   *  chunk arrived. Callers should treat this the same as a graceful mid-stream abort
   *  (persist as `interrupted`, not `error`) so a later `resume()` is accepted. */
  aborted: boolean;
}

export class DispatchService {
  private running = new Set<Promise<void>>();
  private closing = false;
  private activeSessions = new Map<string, AbortController>();
  private inFlightControllers = new Map<string, AbortController>();

  constructor(private readonly deps: DispatchServiceDeps) {}

  async close(): Promise<void> {
    this.closing = true;
    for (const ctrl of this.activeSessions.values()) ctrl.abort();
    for (const ctrl of this.inFlightControllers.values()) ctrl.abort();
    await Promise.allSettled([...this.running]);
  }

  private async withSession(sessionId: string, sse: SseEmitter, signal: AbortSignal, run: (signal: AbortSignal) => Promise<void>): Promise<void> {
    if (this.closing) { sse.error('Server shutting down', true); return; }
    if (this.activeSessions.has(sessionId)) { sse.error('A dispatch is already running in this session', false); return; }
    const ctrl = new AbortController();
    const abort = () => ctrl.abort();
    if (signal.aborted) ctrl.abort();
    else signal.addEventListener('abort', abort, { once: true });
    this.activeSessions.set(sessionId, ctrl);
    const pending = run(ctrl.signal);
    this.running.add(pending);
    try { await pending; }
    catch (e) {
      if (isAbort(e, ctrl.signal)) { sse.event('done', { interrupted: true }); sse.end(); }
      else { const error = classifyError(e); sse.error(error.message, error.retryable); }
    }
    finally { this.running.delete(pending); signal.removeEventListener('abort', abort); this.activeSessions.delete(sessionId); }
  }

  private async providerHistory(messages: Message[], provider: AIProvider): Promise<ProviderRequest['history']> {
    return Promise.all(messages.map(async m => {
      const texts: Array<{ name: string; bytes: Buffer }> = [];
      const images: NonNullable<ProviderRequest['attachments']> = [];
      for (const a of m.attachments ?? []) {
        const stored = await this.deps.historyStore.getAttachmentBytes(a.id);
        if (!stored) continue;
        const kind = classifyAttachment(a.name, a.mime);
        if (kind === 'text') texts.push({ name: a.name, bytes: stored.content });
        else if (kind === 'image' && provider.capabilities.vision) images.push({ name: a.name, mime: a.mime, bytes: stored.content });
      }
      return { role: m.role, text: inlineTextAttachments(m.text, texts), ...(images.length ? { attachments: images } : {}) };
    }));
  }

  getInFlightController(callId: string): AbortController | undefined {
    return this.inFlightControllers.get(callId);
  }

  private buildRuntimeFacts(providerName: string): string {
    return `Current time (UTC): ${new Date().toISOString()}\nActive model: ${providerName}`;
  }

  /** Build the runtime-derived prompt blocks (`# Runtime`, `# availableWorkspaces`,
   *  `# Project memory`) for a session. Shared by `handle()` and `resume()` so the
   *  resumed turn sees the same runtime context as the initial one. */
  private resolveRuntimeContext(
    workspaceId: string | undefined,
    providerName: string,
  ): RuntimeContext {
    const currentRoot = this.deps.projectRootFor?.(workspaceId) ?? null;
    const roots = this.deps.listWorkspaceRoots?.() ?? [];
    return {
      facts: this.buildRuntimeFacts(providerName),
      projectMemory: readProjectMemory(currentRoot) ?? undefined,
      availableWorkspaces: formatAvailableWorkspaces(roots, currentRoot),
    };
  }

  private async executeToolCall(
    pendingCall: ProviderFunctionCall,
    sse: SseEmitter,
    currentRoot: string,
    signal: AbortSignal,
  ): Promise<{ result: McpToolResult; progressNote: string }> {
    signal.throwIfAborted();
    const ctrl = new AbortController();
    const abort = () => ctrl.abort();
    signal.addEventListener('abort', abort, { once: true });
    this.inFlightControllers.set(pendingCall.callId, ctrl);
    sse.event('tool_call_started', pendingCall);
    let latestProgress = '';
    try {
      // Re-ensure the rooted builtins right before executing: the root may have been
      // LRU-evicted from the pool between the top-of-dispatch ensure and this tool call
      // (especially during long gate-wait pauses). This is idempotent for a live root.
      await this.deps.mcpRegistry?.ensureRootedBuiltins?.(currentRoot);
      signal.throwIfAborted();
      const result = await this.deps.mcpRegistry!.callTool(
        pendingCall.qualifiedName,
        pendingCall.args,
        {
          root: currentRoot,
          signal: ctrl.signal,
          onProgress: (note) => {
            latestProgress = note;
            sse.event('tool_call_progress', { id: pendingCall.callId, note });
          },
        },
      );
      return { result, progressNote: latestProgress };
    } finally {
      signal.removeEventListener('abort', abort);
      this.inFlightControllers.delete(pendingCall.callId);
    }
  }

  /** Emit the approval request, resolve the gate decision, execute (or reject),
   *  emit the result, and push a reasoning-tracer step. Shared by the manual
   *  function_call loop and the agentic runToolCall path. */
  private async gateExecuteAndTrace(
    fnCall: ProviderFunctionCall,
    sse: SseEmitter,
    tracer: ReasoningTracer,
    currentRoot: string,
    signal: AbortSignal,
  ): Promise<McpToolResult> {
    // Compute the preview using the dispatch's effective root so workspace-rooted
    // contexts resolve git diffs against the correct repo, not the global gitRoot().
    const preview = this.deps.previewService
      ? await this.deps.previewService
          .previewToolCall({ qualifiedName: fnCall.qualifiedName, args: fnCall.args, root: currentRoot })
          .catch(() => ({ kind: 'plain' as const }))
      : { kind: 'plain' as const };
    signal.throwIfAborted();

    let mode: 'auto' | 'gate';
    if (this.deps.breakpointService) {
      mode = await this.deps.breakpointService.resolveDecision({
        qualifiedName: fnCall.qualifiedName,
        args: fnCall.args,
        root: currentRoot,
      });
    } else {
      const policy = this.deps.mcpRegistry?.policy(fnCall.qualifiedName, currentRoot) ?? {};
      mode = policy.autoApprove ? 'auto' : 'gate';
    }
    sse.event('tool_call_request', { ...fnCall, preview, mode });
    const decision: 'approve' | 'reject' = mode === 'auto'
      ? 'approve'
      : await (this.deps.mcpRegistry?.awaitDecision(fnCall.callId, undefined, signal) ?? Promise.resolve('reject' as const))
          .catch(() => 'reject' as const);

    signal.throwIfAborted();
    const t0 = performance.now();
    let toolResult: McpToolResult;
    let progressNote = '';
    if (decision === 'reject') {
      toolResult = { ok: false, error: 'Rejected by user' };
    } else if (!this.deps.mcpRegistry) {
      toolResult = { ok: false, error: 'No MCP registry configured' };
    } else {
      const executed = await this.executeToolCall(fnCall, sse, currentRoot, signal);
      toolResult = executed.result;
      progressNote = executed.progressNote;
    }
    const durationMs = Math.round(performance.now() - t0);

    sse.event('tool_call_result', { id: fnCall.callId, ...toolResult });
    tracer.pushExternal({
      type: 'tool_call',
      title: `Tool: ${fnCall.qualifiedName}`,
      content: toolResult.ok
        ? `executed ${fnCall.qualifiedName}`
        : `tool failed: ${toolResult.error}`,
      durationMs,
      toolCall: {
        id: fnCall.callId,
        qualifiedName: fnCall.qualifiedName,
        args: fnCall.args,
        result: toolResult.ok ? toolResult.output : undefined,
        error: toolResult.ok ? undefined : toolResult.error,
        durationMs,
        progressNote: progressNote || undefined,
      },
    });
    return toolResult;
  }

  private async runDispatchLoop(
    opts: RunDispatchLoopOpts,
    tracer: ReasoningTracer,
    sse: SseEmitter,
    signal: AbortSignal,
  ): Promise<RunDispatchLoopResult> {
    let accumText = '';
    let accumThought = '';
    let thinkingStart: number | undefined;
    let dispatchUsage: ProviderUsage | undefined;

    const MAX_TOOL_CALLS_PER_DISPATCH =
      this.deps.maxToolCallsPerDispatch ?? DEFAULT_MAX_TOOL_CALLS_PER_DISPATCH;
    const pendingToolResults: ProviderToolResultMessage[] = [];
    let toolCallsCount = 0;

    let capturedError: { message: string; retryable: boolean } | undefined;
    let capturedAbort = false;
    let budgetExceeded = false;
    const providerController = new AbortController();
    const providerSignal = AbortSignal.any([signal, providerController.signal]);

    try {
      await tracer.step({
        type: 'dispatch',
        title: `Dispatch to ${opts.provider.model}${opts.thinking ? ' (thinking)' : ''}`,
        run: async () => {
          // Shares toolCallsCount with the manual function_call loop below: the
          // cap is per-dispatch across BOTH paths (a provider uses one or the
          // other, never both, so there is no double counting).
          const runToolCall = async (
            call: { qualifiedName: string; args: Record<string, unknown> },
          ): Promise<{ ok: boolean; output?: unknown; error?: string }> => {
            if (signal.aborted) {
              // Client left before the in-process (Anthropic-style) tool call
              // ran; do not execute it.
              return { ok: false, error: 'Aborted' };
            }
            if (toolCallsCount >= MAX_TOOL_CALLS_PER_DISPATCH) {
              budgetExceeded = true;
              providerController.abort();
              return { ok: false, error: 'Max tool calls per dispatch exceeded' };
            }
            toolCallsCount += 1;
            const fnCall: ProviderFunctionCall = {
              callId: randomUUID(),
              qualifiedName: call.qualifiedName,
              args: call.args,
            };
            const r = await this.gateExecuteAndTrace(fnCall, sse, tracer, opts.currentRoot, signal);
            return r.ok ? { ok: true, output: r.output } : { ok: false, error: r.error };
          };

          const rounds: ProviderToolRound[] = [];
          while (!signal.aborted) {
            const calls: ProviderFunctionCall[] = [];
            let roundText = '';
            const it = opts.provider.stream({
              systemInstruction: opts.systemInstruction,
              history: opts.history,
              userMessage: opts.userMessage,
              thinking: opts.thinking,
              mcpTools: toolCallsCount < MAX_TOOL_CALLS_PER_DISPATCH ? opts.mcpTools : [],
              toolRounds: rounds.length ? rounds : undefined,
              toolResults: pendingToolResults.length ? [...pendingToolResults] : undefined,
              pendingAssistantText: opts.pendingAssistantText,
              attachments: opts.attachments,
              runToolCall,
            }, providerSignal);
            for await (const chunk of it) {
              if (signal.aborted) break;
              if (chunk.type === 'text') {
                accumText += chunk.text;
                roundText += chunk.text;
                sse.event('text', { chunk: chunk.text });
              } else if (chunk.type === 'thinking') {
                if (thinkingStart === undefined) thinkingStart = performance.now();
                accumThought += chunk.text;
                sse.event('thinking', { chunk: chunk.text });
              } else if (chunk.type === 'function_call') {
                calls.push(chunk.call);
              } else if (chunk.type === 'done') {
                if (chunk.usage) {
                  dispatchUsage ??= {};
                  for (const key of ['inputTokens', 'outputTokens', 'totalTokens'] as const) {
                    if (chunk.usage[key] !== undefined) dispatchUsage[key] = (dispatchUsage[key] ?? 0) + chunk.usage[key]!;
                  }
                }
                break;
              }
            }
            if (!calls.length || signal.aborted) break;
            const results: ProviderToolResultMessage[] = [];
            for (const call of calls) {
              signal.throwIfAborted();
              if (toolCallsCount >= MAX_TOOL_CALLS_PER_DISPATCH) throw new Error('Max tool calls per dispatch exceeded');
              toolCallsCount++;
              // Provider IDs belong to the transcript; approvals get globally unique IDs.
              const result = await this.gateExecuteAndTrace({ ...call, callId: randomUUID() }, sse, tracer, opts.currentRoot, signal);
              results.push({ callId: call.callId, qualifiedName: call.qualifiedName, args: call.args, ...result });
            }
            rounds.push({ text: roundText, calls, results });
            pendingToolResults.push(...results);
          }

          return {
            content: `${accumText.length} chars streamed${
              accumThought.length > 0 ? `, ${accumThought.length} chars thinking` : ''
            }${toolCallsCount > 0 ? `, ${toolCallsCount} tool calls` : ''}`,
            tokens: dispatchUsage?.totalTokens,
            subAgent: opts.subAgent ?? undefined,
            result: null,
          };
        },
      });
    } catch (e) {
      // A cancellation can surface as a thrown `AbortError` instead of the loop
      // observing `signal.aborted` mid-stream — e.g. the client cancels while the
      // provider's opening `fetch()` is still pending, before any chunk arrives.
      // Treat that the same as a graceful abort (no `error`) so the caller persists
      // the turn on the interrupted path and a later `resume()` is accepted.
      if (isAbort(e, signal)) {
        capturedAbort = true;
      } else {
        capturedError = classifyError(e);
      }
    }

    if (budgetExceeded) capturedError = { message: 'Max tool calls per dispatch exceeded', retryable: false };
    return {
      accumText,
      accumThought,
      thinkingStart,
      dispatchUsage,
      toolCallsCount,
      error: capturedError,
      aborted: capturedAbort,
    };
  }

  async handle(rawBody: unknown, sse: SseEmitter, signal: AbortSignal): Promise<void> {
    const parsed = DispatchRequestSchema.safeParse(rawBody);
    if (!parsed.success) { sse.error('Invalid request body', false); return; }
    return this.withSession(parsed.data.sessionId, sse, signal, current => this.handleTurn(parsed.data, sse, current));
  }

  private async handleTurn(
    rawBody: unknown,
    sse: SseEmitter,
    signal: AbortSignal,
  ): Promise<void> {
    const parsed = DispatchRequestSchema.safeParse(rawBody);
    if (!parsed.success) {
      sse.error('Invalid request body', false);
      return;
    }
    const { sessionId, message, thinking, aetherMode } = parsed.data;
    const { historyStore, contextStore } = this.deps;

    const sessionSummary = this.deps.historyStore.getSessionSummary(sessionId);
    const requestedName = parsed.data.providerName;
    const sessionName = sessionSummary?.providerName ?? undefined;
    const fallbackName = this.deps.providers.defaultName();

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

    // Decode and classify attachments (throws ValidationError or AppError on bad input).
    const rawAttachments = parsed.data.attachments ?? [];
    let textAtts: Array<{ name: string; mime: string; bytes: Buffer }> = [];
    let imageAtts: Array<{ name: string; mime: string; bytes: Buffer }> = [];
    try {
      const parts = preprocessAttachments(rawAttachments);
      textAtts = parts.text;
      imageAtts = parts.image;
    } catch (e) {
      if (e instanceof AppError) {
        sse.event('error', { message: e.message, retryable: false });
        sse.end();
        return;
      }
      throw e;
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

    const providerName = requestedName ?? matchedSubAgent?.model ?? sessionName ?? parsed.data.defaultProviderName ?? fallbackName;
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

    const effectiveWorkspaceId = parsed.data.workspaceId ?? sessionSummary?.workspaceId ?? undefined;
    // Normalize for the MCP tool-pool key (case-insensitive on Windows). The prompt's
    // `# availableWorkspaces -> current` marker uses the RAW path from projectRootFor()
    // via resolveRuntimeContext() because formatAvailableWorkspaces matches against the
    // raw registered-roots list; a lowercased path would miss on Windows. Same directory —
    // do NOT unify these two uses.
    const currentRoot = normalizeRoot(
      this.deps.projectRootFor?.(effectiveWorkspaceId) ?? process.cwd(),
    );
    await this.deps.mcpRegistry?.ensureRootedBuiltins?.(currentRoot);
    const liveTools = this.deps.mcpRegistry?.listLiveTools(currentRoot) ?? [];
    const mcpToolDecls = liveTools.map((t) => ({
      qualifiedName: t.qualifiedName,
      description: t.tool.description,
      schema: t.tool.inputSchema,
    }));

    // Inline text attachments as fenced code blocks into the user message.
    const effectiveStripped = inlineTextAttachments(mention.stripped, textAtts);
    const materialSkills = this.deps.skillsService?.getActiveForPrompt() ?? [];
    const runtime = this.resolveRuntimeContext(effectiveWorkspaceId, providerName);
    const assembled = assemble(
      context, matchedSubAgent, effectiveStripped, mention.name,
      mcpToolDecls, materialSkills, runtime,
    );

    if (aetherMode) {
      tracer.pushExternal({
        type: 'assembled_prompt',
        title: 'Prompt sent to model',
        content: formatAssembledPromptContent(assembled.systemInstruction, assembled.mcpTools),
      });
    }

    // Build attachment list for the provider (images only, stripped for non-vision providers).
    const providerAttachments = provider.capabilities.vision ? imageAtts : [];

    // Persist the user message with the ORIGINAL attachments (text + image).
    const attachmentsToStore = rawAttachments.length > 0
      ? rawAttachments.map((a) => ({
          id: randomUUID(),
          name: a.name,
          mime: a.mime,
          size: a.size,
          contentBase64: a.contentBase64,
        }))
      : undefined;

    const userMessageId = randomUUID();
    const modelMessageId = randomUUID();
    const dispatchContext: DispatchContext = { providerName, systemInstruction: assembled.systemInstruction, workspaceId: effectiveWorkspaceId, currentRoot, subAgent: assembled.subAgent ?? undefined, thinking };
    await historyStore.append(sessionId, {
      id: userMessageId,
      role: 'user',
      text: message,
      timestamp: Date.now(),
      attachments: attachmentsToStore,
    });

    sse.event('message_ids', { userMessageId, modelMessageId, attachments: attachmentsToStore?.map(({ contentBase64: _bytes, ...a }) => a) });

    const loopResult = await this.runDispatchLoop(
      {
        provider,
        systemInstruction: assembled.systemInstruction,
        history: await this.providerHistory(prior, provider),
        userMessage: assembled.message,
        pendingAssistantText: undefined,
        thinking,
        mcpTools: assembled.mcpTools,
        subAgent: assembled.subAgent ?? undefined,
        attachments: providerAttachments.length > 0 ? providerAttachments : undefined,
        currentRoot,
      },
      tracer,
      sse,
      signal,
    );

    const { accumText, accumThought, thinkingStart, dispatchUsage } = loopResult;

    if (loopResult.error) {
      const { message: msg, retryable } = loopResult.error;
      sse.event('error', { message: msg, retryable });
      await historyStore.append(sessionId, {
        id: modelMessageId,
        dispatchContext,
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
        title: `${provider.model} thoughts`,
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

    const interrupted = signal.aborted || loopResult.aborted;
    const reasoningSteps = tracer.finalSteps();

    await historyStore.append(sessionId, {
      id: modelMessageId,
      dispatchContext,
      role: 'model',
      text: accumText,
      timestamp: Date.now(),
      model: provider.model,
      interrupted,
      reasoningSteps,
      tokensIn: dispatchUsage?.inputTokens,
      tokensOut: dispatchUsage?.outputTokens,
    });

    sse.event('done', {
      model: provider.model,
      interrupted,
      reasoningSteps,
      tokensIn: dispatchUsage?.inputTokens,
      tokensOut: dispatchUsage?.outputTokens,
    });
    sse.end();
  }

  async resume(opts: ResumeRequest, sse: SseEmitter, signal: AbortSignal): Promise<void> {
    return this.withSession(opts.sessionId, sse, signal, current => this.resumeTurn(opts, sse, current));
  }

  private async resumeTurn(
    opts: { sessionId: string; messageId: string; providerName?: string; aetherMode?: boolean },
    sse: SseEmitter,
    signal: AbortSignal,
  ): Promise<void> {
    const { sessionId, messageId } = opts;
    const { historyStore, contextStore } = this.deps;

    const sessionRecord = await historyStore.readRecord(sessionId);
    if (!sessionRecord) {
      sse.event('error', { message: `Session ${sessionId} not found`, retryable: false });
      sse.end();
      return;
    }

    const idx = sessionRecord.messages.findIndex((m) => m.id === messageId);
    if (idx === -1) {
      sse.event('error', { message: `Message ${messageId} not found`, retryable: false });
      sse.end();
      return;
    }

    const target = sessionRecord.messages[idx];
    if (target.role !== 'model') {
      sse.event('error', { message: 'Cannot resume a user message', retryable: false });
      sse.end();
      return;
    }
    const retryFailed = !!target.error && !!target.retryable;
    if (!target.interrupted && !retryFailed) {
      sse.event('error', { message: 'Message is not interrupted', retryable: false });
      sse.end();
      return;
    }
    if (target.text.length === 0 && !retryFailed) {
      sse.event('error', { message: 'Cannot resume an empty interrupted message', retryable: false });
      sse.end();
      return;
    }

    if (idx !== sessionRecord.messages.length - 1) { sse.error('Only the latest message can be resumed; fork older turns first', false); return; }

    const requestedName = opts.providerName;
    const sessionName = sessionRecord.providerName;
    const fallbackName = this.deps.providers.defaultName();
    const providerName = requestedName ?? target.dispatchContext?.providerName ?? sessionName ?? fallbackName;
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

    // History context: everything BEFORE the interrupted message.
    const priorMessages = sessionRecord.messages.slice(0, idx);

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

    const effectiveWorkspaceId = target.dispatchContext ? target.dispatchContext.workspaceId : sessionRecord.workspaceId;
    // Validate deleted workspace IDs even when a root snapshot exists.
    const resolvedRoot = this.deps.projectRootFor?.(effectiveWorkspaceId);
    const currentRoot = normalizeRoot(target.dispatchContext?.currentRoot ?? resolvedRoot ?? process.cwd());
    await this.deps.mcpRegistry?.ensureRootedBuiltins?.(currentRoot);
    const liveTools = this.deps.mcpRegistry?.listLiveTools(currentRoot) ?? [];
    const mcpToolDecls = liveTools.map((t) => ({
      qualifiedName: t.qualifiedName,
      description: t.tool.description,
      schema: t.tool.inputSchema,
    }));

    const lastUser = [...priorMessages].reverse().find(m => m.role === 'user');
    const agents = this.deps.subAgentsStore ? await this.deps.subAgentsStore.list() : [];
    const mention = parseLeadingMention(lastUser?.text ?? '', new Set(agents.map(a => a.name)));
    const meta = agents.find(a => a.name === mention.name);
    const subAgent = meta ? await this.deps.subAgentsStore!.read(meta.id) : null;
    const resumeSystemInstruction = target.dispatchContext?.systemInstruction ?? assemble(
      context, subAgent, '', mention.name, mcpToolDecls,
      this.deps.skillsService?.getActiveForPrompt() ?? [], this.resolveRuntimeContext(effectiveWorkspaceId, providerName),
    ).systemInstruction;
    const modelMessageId = randomUUID();
    const dispatchContext: DispatchContext = { providerName, systemInstruction: resumeSystemInstruction, workspaceId: effectiveWorkspaceId, currentRoot, thinking: target.dispatchContext?.thinking, subAgent: target.dispatchContext?.subAgent ?? mention.name ?? undefined };
    sse.event('message_ids', { modelMessageId });

    if (opts.aetherMode) {
      tracer.pushExternal({
        type: 'assembled_prompt',
        title: 'Prompt sent to model',
        content: formatAssembledPromptContent(resumeSystemInstruction, mcpToolDecls),
      });
    }

    const loopResult = await this.runDispatchLoop(
      {
        provider,
        systemInstruction: resumeSystemInstruction,
        history: await this.providerHistory(priorMessages, provider),
        userMessage: '',
        pendingAssistantText: retryFailed ? undefined : target.text,
        thinking: dispatchContext.thinking,
        mcpTools: mcpToolDecls,
        currentRoot,
      },
      tracer,
      sse,
      signal,
    );

    const { accumText, accumThought, thinkingStart, dispatchUsage } = loopResult;

    if (loopResult.error) {
      const { message: msg, retryable } = loopResult.error;
      sse.event('error', { message: msg, retryable });
      await historyStore.append(sessionId, {
        id: modelMessageId,
        dispatchContext,
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
        title: 'Assistant thoughts',
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

    const interrupted = signal.aborted || loopResult.aborted;
    const reasoningSteps = tracer.finalSteps();

    await historyStore.append(sessionId, {
      id: modelMessageId,
      dispatchContext,
      role: 'model',
      text: accumText,
      timestamp: Date.now(),
      model: provider.model,
      interrupted,
      reasoningSteps,
      tokensIn: dispatchUsage?.inputTokens,
      tokensOut: dispatchUsage?.outputTokens,
    });

    sse.event('done', {
      model: provider.model,
      interrupted,
      reasoningSteps,
      tokensIn: dispatchUsage?.inputTokens,
      tokensOut: dispatchUsage?.outputTokens,
    });
    sse.end();
  }
}

/** True when `e` represents a cancellation rather than a genuine provider error:
 *  either the dispatch's signal is already aborted, or the provider threw the
 *  standard `AbortError` (e.g. from an in-flight `fetch()` whose signal fired). */
function isAbort(e: unknown, signal: AbortSignal): boolean {
  return signal.aborted || (e instanceof Error && e.name === 'AbortError');
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
