import { query } from '@anthropic-ai/claude-agent-sdk';
import type {
  AIProvider,
  ProviderCapabilities,
  ProviderChunk,
  ProviderRequest,
} from './provider.types';

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
        allowedTools: [],
        mcpServers: {},
        abortController: aborter,
      };
      if (req.thinking === true) {
        options.thinking = { type: 'enabled', budgetTokens: 8000 };
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
              yield {
                type: 'function_call',
                call: {
                  callId: String(block.id ?? ''),
                  qualifiedName: String(block.name ?? ''),
                  args: (block.input ?? {}) as Record<string, unknown>,
                },
              };
              return;
            }
          }
        } else if (e.type === 'result') {
          const inTok = Number(e.usage?.input_tokens ?? 0);
          const outTok = Number(e.usage?.output_tokens ?? 0);
          const total = inTok + outTok;
          yield {
            type: 'done',
            usage: total > 0 ? { totalTokens: total } : undefined,
          };
          return;
        }
      }
    } finally {
      signal.removeEventListener('abort', onAbort);
    }
  }
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
