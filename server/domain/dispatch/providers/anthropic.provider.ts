import { query, createSdkMcpServer } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import type {
  AIProvider,
  ProviderCapabilities,
  ProviderChunk,
  ProviderRequest,
  ProviderToolDecl,
} from './provider.types';

const AETHER_MCP_NAME = 'aether';
const AETHER_TOOL_PREFIX = `mcp__${AETHER_MCP_NAME}__`;
// Generous turn budget so the SDK can run a multi-step tool loop without hitting
// error_max_turns in normal use. The per-dispatch tool cap is still enforced by
// the dispatch layer's runToolCall (returns an error outcome past the limit).
const MAX_TURNS = 24;

export interface AnthropicProviderOpts {
  model: 'claude-opus-4-7' | 'claude-sonnet-4-6' | 'claude-haiku-4-5';
}

interface SdkContentBlock {
  type: 'text' | 'thinking' | 'tool_use' | string;
  text?: string;
  thinking?: string;
}

interface SdkEvent {
  type: 'assistant' | 'result' | string;
  error?: string;
  message?: { content?: SdkContentBlock[] };
  usage?: { input_tokens?: number; output_tokens?: number };
}

interface SdkUserMessageEnvelope {
  type: 'user';
  message: {
    role: 'user';
    content: Array<
      | { type: 'text'; text: string }
      | { type: 'image'; source: { type: 'base64'; media_type: string; data: string } }
    >;
  };
  parent_tool_use_id: null;
}

export class AnthropicProvider implements AIProvider {
  readonly capabilities: ProviderCapabilities = { thinking: true, toolCalling: true, vision: true };
  readonly model: string;

  constructor(opts: AnthropicProviderOpts) {
    this.model = opts.model;
  }

  async *stream(req: ProviderRequest, signal: AbortSignal): AsyncIterable<ProviderChunk> {
    const aborter = new AbortController();
    const onAbort = (): void => aborter.abort();
    if (signal.aborted) aborter.abort();
    else signal.addEventListener('abort', onAbort, { once: true });

    let stderrBuf = '';
    try {
      const options: Record<string, unknown> = {
        systemPrompt: req.systemInstruction,
        model: this.model,
        maxTurns: MAX_TURNS,
        abortController: aborter,
        // Surface the spawned `claude` child's stderr so a non-zero exit reports
        // WHY instead of the SDK's generic "exited with code 1".
        stderr: (data: string): void => { stderrBuf += data; },
      };
      if (req.thinking === true) {
        options.thinking = { type: 'enabled', budgetTokens: 8000 };
      }
      if (req.mcpTools && req.mcpTools.length > 0) {
        const server = createSdkMcpServer({
          name: AETHER_MCP_NAME,
          tools: req.mcpTools.map((decl) => toolDefFor(decl, req)),
        });
        options.mcpServers = { [AETHER_MCP_NAME]: server };
        // Pre-allow our tools so the SDK runs the handler directly; the handler
        // delegates to req.runToolCall which performs Aether's own approval gate.
        options.allowedTools = req.mcpTools.map((t) => AETHER_TOOL_PREFIX + t.qualifiedName);
      } else {
        options.allowedTools = [];
        options.mcpServers = {};
      }

      const iter = query({
        prompt: buildPromptStream(req),
        options,
      } as unknown as Parameters<typeof query>[0]);

      for await (const ev of iter) {
        if (signal.aborted) return;
        const e = ev as SdkEvent;
        if (e.type === 'assistant') {
          if (typeof e.error === 'string') {
            throw new Error(`Anthropic error: ${e.error}`);
          }
          for (const block of e.message?.content ?? []) {
            if (block.type === 'text' && typeof block.text === 'string') {
              yield { type: 'text', text: block.text };
            } else if (block.type === 'thinking' && typeof block.thinking === 'string') {
              if (req.thinking === true) {
                yield { type: 'thinking', text: block.thinking };
              }
            }
            // tool_use blocks are executed by the SDK via the in-process MCP
            // handler (-> req.runToolCall). We do NOT surface function_call.
          }
        } else if (e.type === 'result') {
          const input = typeof e.usage?.input_tokens === 'number' ? e.usage.input_tokens : undefined;
          const output = typeof e.usage?.output_tokens === 'number' ? e.usage.output_tokens : undefined;
          const total = (input ?? 0) + (output ?? 0);
          yield {
            type: 'done',
            usage: total > 0 ? {
              totalTokens: total,
              ...(input !== undefined ? { inputTokens: input } : {}),
              ...(output !== undefined ? { outputTokens: output } : {}),
            } : undefined,
          };
          return;
        }
      }
    } catch (err) {
      if (stderrBuf.length > 0 && err instanceof Error) {
        throw new Error(`${err.message} | claude stderr: ${stderrBuf.slice(-2000)}`);
      }
      throw err;
    } finally {
      signal.removeEventListener('abort', onAbort);
    }
  }
}

/**
 * Build an SDK in-process MCP tool. The handler delegates the actual gate +
 * execution to req.runToolCall (the dispatch layer), then maps the outcome to a
 * CallToolResult the SDK feeds back to the model.
 */
function toolDefFor(decl: ProviderToolDecl, req: ProviderRequest): {
  name: string;
  description: string;
  inputSchema: Record<string, z.ZodType>;
  handler: (args: unknown, extra: unknown) => Promise<{ content: Array<{ type: 'text'; text: string }>; isError?: boolean }>;
} {
  const shape: Record<string, z.ZodType> = {};
  for (const key of Object.keys(decl.schema.properties ?? {})) {
    shape[key] = z.unknown();
  }
  return {
    name: decl.qualifiedName,
    description: decl.description ?? '',
    inputSchema: shape,
    handler: async (args: unknown) => {
      const outcome = req.runToolCall
        ? await req.runToolCall({
            qualifiedName: decl.qualifiedName,
            args: (args ?? {}) as Record<string, unknown>,
          })
        : { ok: false, error: 'No tool executor available (req.runToolCall missing)' };
      if (outcome.ok) {
        const text = typeof outcome.output === 'string'
          ? outcome.output
          : JSON.stringify(outcome.output ?? {});
        return { content: [{ type: 'text', text }] };
      }
      return { content: [{ type: 'text', text: outcome.error ?? 'tool failed' }], isError: true };
    },
  };
}

/**
 * Render the whole turn as ONE user-role message. The Claude Agent SDK's
 * streaming input only accepts role:'user'; prior assistant turns cannot be
 * replayed structurally, so they are flattened into a text transcript.
 */
function renderConversation(req: ProviderRequest): string {
  const parts: string[] = [];
  if (req.history.length > 0) {
    parts.push('# Conversation so far');
    for (const h of req.history) {
      parts.push(`${h.role === 'model' ? 'Assistant' : 'User'}: ${h.text}`);
    }
    parts.push('');
  }
  if (req.pendingAssistantText && req.pendingAssistantText.length > 0) {
    parts.push(`Assistant (interrupted — continue this response): ${req.pendingAssistantText}`);
    parts.push('');
  }
  parts.push(req.userMessage);
  return parts.join('\n');
}

async function* buildPromptStream(req: ProviderRequest): AsyncGenerator<SdkUserMessageEnvelope> {
  const content: SdkUserMessageEnvelope['message']['content'] = [];
  for (const a of req.attachments ?? []) {
    content.push({
      type: 'image',
      source: { type: 'base64', media_type: a.mime, data: a.bytes.toString('base64') },
    });
  }
  content.push({ type: 'text', text: renderConversation(req) });
  yield { type: 'user', message: { role: 'user', content }, parent_tool_use_id: null };
}
