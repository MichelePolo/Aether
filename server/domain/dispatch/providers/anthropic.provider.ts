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

interface SdkInputMessage {
  role: 'user' | 'assistant';
  content: Array<
    | { type: 'text'; text: string }
    | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
    | { type: 'tool_result'; tool_use_id: string; content: string }
  >;
}

export class AnthropicProvider implements AIProvider {
  readonly capabilities: ProviderCapabilities = { thinking: true, toolCalling: true };
  readonly model: string;

  constructor(opts: AnthropicProviderOpts) {
    this.model = opts.model;
  }

  async *stream(req: ProviderRequest, signal: AbortSignal): AsyncIterable<ProviderChunk> {
    // SDK wants AbortController; bridge from the incoming signal.
    const aborter = new AbortController();
    if (signal.aborted) aborter.abort();
    else signal.addEventListener('abort', () => aborter.abort(), { once: true });

    const prompt = buildPrompt(req);
    const options: Record<string, unknown> = {
      systemPrompt: req.systemInstruction,
      model: this.model,
      maxTurns: 1,
      allowedTools: [],
      mcpServers: {},
      abortController: aborter,
    };
    if (req.thinking === true) {
      options.thinking = { type: 'enabled', budget_tokens: 8000 };
    }
    if (req.mcpTools && req.mcpTools.length > 0) {
      options.tools = req.mcpTools.map((t) => ({
        name: t.qualifiedName,
        description: t.description ?? '',
        input_schema: t.schema,
      }));
    }

    const iter = query({ prompt, options } as unknown as Parameters<typeof query>[0]);

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
  }
}

function buildPrompt(req: ProviderRequest): SdkInputMessage[] {
  const out: SdkInputMessage[] = [];
  for (const h of req.history) {
    out.push({
      role: h.role === 'model' ? 'assistant' : 'user',
      content: [{ type: 'text', text: h.text }],
    });
  }
  if (req.pendingAssistantText && req.pendingAssistantText.length > 0) {
    out.push({
      role: 'assistant',
      content: [{ type: 'text', text: req.pendingAssistantText }],
    });
  }
  for (const r of req.toolResults ?? []) {
    out.push({
      role: 'assistant',
      content: [{
        type: 'tool_use',
        id: r.callId,
        name: r.qualifiedName,
        input: {},
      }],
    });
    out.push({
      role: 'user',
      content: [{
        type: 'tool_result',
        tool_use_id: r.callId,
        content: r.ok ? JSON.stringify(r.output ?? {}) : JSON.stringify({ error: r.error }),
      }],
    });
  }
  out.push({
    role: 'user',
    content: [{ type: 'text', text: req.userMessage }],
  });
  return out;
}
