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

export interface AnthropicProviderOpts {
  model: 'claude-opus-4-7' | 'claude-sonnet-4-6' | 'claude-haiku-4-5';
}

interface SdkContentBlock {
  type: 'text' | 'thinking' | 'tool_use' | string;
  text?: string;
  thinking?: string;
  id?: string;
  name?: string;
  input?: unknown;
}

interface SdkEvent {
  type: 'assistant' | 'result' | string;
  error?: string;
  message?: { content?: SdkContentBlock[] };
  usage?: { input_tokens?: number; output_tokens?: number };
}

/**
 * One element of the AsyncIterable<SDKUserMessage> prompt stream the SDK
 * expects. The literal `type: 'user'` is the SDK envelope; the inner
 * `message.role` is what carries 'user' vs 'assistant'.
 */
interface SdkUserMessageEnvelope {
  type: 'user';
  message: {
    role: 'user' | 'assistant';
    content: Array<
      | { type: 'text'; text: string }
      | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
      | { type: 'tool_result'; tool_use_id: string; content: string }
    >;
  };
  parent_tool_use_id: null;
}

export class AnthropicProvider implements AIProvider {
  readonly capabilities: ProviderCapabilities = { thinking: true, toolCalling: true };
  readonly model: string;

  constructor(opts: AnthropicProviderOpts) {
    this.model = opts.model;
  }

  async *stream(req: ProviderRequest, signal: AbortSignal): AsyncIterable<ProviderChunk> {
    const aborter = new AbortController();
    const onAbort = (): void => aborter.abort();
    if (signal.aborted) aborter.abort();
    else signal.addEventListener('abort', onAbort, { once: true });

    try {
      const options: Record<string, unknown> = {
        systemPrompt: req.systemInstruction,
        model: this.model,
        maxTurns: 1,
        abortController: aborter,
      };
      if (req.thinking === true) {
        options.thinking = { type: 'enabled', budgetTokens: 8000 };
      }
      if (req.mcpTools && req.mcpTools.length > 0) {
        const server = createSdkMcpServer({
          name: AETHER_MCP_NAME,
          tools: req.mcpTools.map(toolDefFor),
        });
        options.mcpServers = { [AETHER_MCP_NAME]: server };
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
            } else if (block.type === 'tool_use') {
              const rawName = String(block.name ?? '');
              const qualifiedName = rawName.startsWith(AETHER_TOOL_PREFIX)
                ? rawName.slice(AETHER_TOOL_PREFIX.length)
                : rawName;
              yield {
                type: 'function_call',
                call: {
                  callId: String(block.id ?? ''),
                  qualifiedName,
                  args: (block.input ?? {}) as Record<string, unknown>,
                },
              };
              return;
            }
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
    } finally {
      signal.removeEventListener('abort', onAbort);
    }
  }
}

/**
 * Build an SDK tool definition that declares an Aether tool to Claude.
 *
 * The handler intentionally throws: with maxTurns:1 the SDK stops at the first
 * assistant turn (which surfaces tool_use blocks back to Aether), so the
 * handler is never invoked in normal flow. If it ever IS invoked, that means
 * our assumption about maxTurns has changed — failing loud is better than
 * silently bypassing Aether's approval+execution layer.
 */
function toolDefFor(decl: ProviderToolDecl): {
  name: string;
  description: string;
  inputSchema: Record<string, z.ZodType>;
  handler: (args: unknown, extra: unknown) => Promise<{ content: Array<{ type: 'text'; text: string }>; isError: boolean }>;
} {
  const shape: Record<string, z.ZodType> = {};
  for (const key of Object.keys(decl.schema.properties ?? {})) {
    shape[key] = z.unknown();
  }
  return {
    name: decl.qualifiedName,
    description: decl.description ?? '',
    inputSchema: shape,
    handler: async () => {
      throw new Error(
        `AnthropicProvider tool handler for '${decl.qualifiedName}' was invoked unexpectedly. ` +
          'With maxTurns:1 the SDK should surface tool_use blocks for Aether to execute, ' +
          'not call the in-process handler.',
      );
    },
  };
}

async function* buildPromptStream(req: ProviderRequest): AsyncGenerator<SdkUserMessageEnvelope> {
  for (const h of req.history) {
    yield {
      type: 'user',
      message: {
        role: h.role === 'model' ? 'assistant' : 'user',
        content: [{ type: 'text', text: h.text }],
      },
      parent_tool_use_id: null,
    };
  }
  if (req.pendingAssistantText && req.pendingAssistantText.length > 0) {
    yield {
      type: 'user',
      message: {
        role: 'assistant',
        content: [{ type: 'text', text: req.pendingAssistantText }],
      },
      parent_tool_use_id: null,
    };
  }
  for (const r of req.toolResults ?? []) {
    yield {
      type: 'user',
      message: {
        role: 'assistant',
        content: [{
          type: 'tool_use',
          id: r.callId,
          name: r.qualifiedName,
          input: {},
        }],
      },
      parent_tool_use_id: null,
    };
    yield {
      type: 'user',
      message: {
        role: 'user',
        content: [{
          type: 'tool_result',
          tool_use_id: r.callId,
          content: r.ok ? JSON.stringify(r.output ?? {}) : JSON.stringify({ error: r.error }),
        }],
      },
      parent_tool_use_id: null,
    };
  }
  yield {
    type: 'user',
    message: {
      role: 'user',
      content: [{ type: 'text', text: req.userMessage }],
    },
    parent_tool_use_id: null,
  };
}
