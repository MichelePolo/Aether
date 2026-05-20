import type {
  AIProvider,
  ProviderCapabilities,
  ProviderChunk,
  ProviderRequest,
  ProviderToolDecl,
  ProviderToolResultMessage,
} from './provider.types';

export type OpenAIModel = 'gpt-5' | 'gpt-5-mini' | 'gpt-4.1' | 'o3';

export interface OpenAIProviderOpts {
  apiKey: string;
  model: OpenAIModel;
}

interface OpenAIToolCallFrag {
  index: number;
  id?: string;
  type?: 'function';
  function?: { name?: string; arguments?: string };
}

interface OpenAIDelta {
  content?: string;
  reasoning?: string;
  reasoning_content?: string;
  tool_calls?: OpenAIToolCallFrag[];
}

interface OpenAIChoice {
  delta?: OpenAIDelta;
  finish_reason?: 'stop' | 'tool_calls' | 'length' | 'content_filter' | null;
}

interface OpenAIChunk {
  choices?: OpenAIChoice[];
  usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
}

interface OpenAIErrorBody {
  error?: { message?: string };
}

const ENDPOINT = 'https://api.openai.com/v1/chat/completions';

export class OpenAIProvider implements AIProvider {
  readonly model: string;
  readonly capabilities: ProviderCapabilities;

  constructor(private readonly opts: OpenAIProviderOpts) {
    this.model = opts.model;
    this.capabilities = {
      thinking: opts.model === 'o3',
      toolCalling: true,
    };
  }

  async *stream(req: ProviderRequest, signal: AbortSignal): AsyncIterable<ProviderChunk> {
    const body = buildBody(this.model, req);

    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'authorization': `Bearer ${this.opts.apiKey}`,
        'accept': 'text/event-stream',
      },
      body: JSON.stringify(body),
      signal,
    });

    if (!res.ok) {
      let apiMsg = '';
      try {
        const errBody = (await res.json()) as OpenAIErrorBody;
        if (typeof errBody.error?.message === 'string') apiMsg = errBody.error.message;
      } catch {
        // ignore body parse failure
      }
      if (res.status === 401) {
        throw new Error('OpenAI auth failed — check OPENAI_API_KEY');
      }
      throw new Error(apiMsg || `OpenAI HTTP ${res.status}`);
    }

    if (!res.body) {
      throw new Error('OpenAI response has no body');
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = '';
    const toolBuffers = new Map<number, { id: string; name: string; argsBuffer: string }>();
    let totalTokens = 0;
    let sawUsage = false;
    let sawStop = false;

    try {
      while (true) {
        if (signal.aborted) return;
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });

        let sep;
        while ((sep = buf.indexOf('\n\n')) >= 0) {
          const frame = buf.slice(0, sep);
          buf = buf.slice(sep + 2);
          const dataLines: string[] = [];
          for (const line of frame.split('\n')) {
            if (line.startsWith('data:')) {
              dataLines.push(line.slice(5).trimStart());
            }
          }
          if (dataLines.length === 0) continue;
          const dataStr = dataLines.join('\n');
          if (dataStr === '[DONE]') {
            // OpenAI's terminator.
            yield {
              type: 'done',
              usage: sawUsage && totalTokens > 0 ? { totalTokens } : undefined,
            };
            return;
          }
          let parsed: OpenAIChunk;
          try {
            parsed = JSON.parse(dataStr) as OpenAIChunk;
          } catch {
            continue;
          }

          if (parsed.usage && typeof parsed.usage.total_tokens === 'number') {
            totalTokens = parsed.usage.total_tokens;
            sawUsage = true;
          }

          const choice = parsed.choices?.[0];
          if (choice) {
            const delta = choice.delta ?? {};

            if (typeof delta.content === 'string' && delta.content.length > 0) {
              yield { type: 'text', text: delta.content };
            }
            const reasoning = delta.reasoning ?? delta.reasoning_content;
            if (typeof reasoning === 'string' && reasoning.length > 0 && req.thinking === true) {
              yield { type: 'thinking', text: reasoning };
            }
            if (Array.isArray(delta.tool_calls)) {
              for (const frag of delta.tool_calls) {
                const idx = frag.index;
                const existing = toolBuffers.get(idx) ?? { id: '', name: '', argsBuffer: '' };
                if (typeof frag.id === 'string' && frag.id.length > 0) existing.id = frag.id;
                if (frag.function?.name) existing.name = frag.function.name;
                if (typeof frag.function?.arguments === 'string') {
                  existing.argsBuffer += frag.function.arguments;
                }
                toolBuffers.set(idx, existing);
              }
            }

            if (choice.finish_reason === 'tool_calls') {
              const sortedIndices = [...toolBuffers.keys()].sort((a, b) => a - b);
              for (const i of sortedIndices) {
                const entry = toolBuffers.get(i)!;
                let parsedArgs: Record<string, unknown> = {};
                if (entry.argsBuffer.length > 0) {
                  try {
                    parsedArgs = JSON.parse(entry.argsBuffer) as Record<string, unknown>;
                  } catch {
                    parsedArgs = {};
                  }
                }
                yield {
                  type: 'function_call',
                  call: {
                    callId: entry.id,
                    qualifiedName: entry.name,
                    args: parsedArgs,
                  },
                };
              }
              return;
            }
            if (choice.finish_reason === 'stop') {
              sawStop = true;
            }
          }

          if (sawStop && sawUsage) {
            yield {
              type: 'done',
              usage: totalTokens > 0 ? { totalTokens } : undefined,
            };
            return;
          }
        }
      }
    } finally {
      try { reader.releaseLock(); } catch { /* ignore */ }
    }

    // Stream ended naturally without an explicit terminator: emit a defensive done.
    yield {
      type: 'done',
      usage: sawUsage && totalTokens > 0 ? { totalTokens } : undefined,
    };
  }
}

function buildBody(model: string, req: ProviderRequest): unknown {
  const messages: Array<Record<string, unknown>> = [];
  if (req.systemInstruction.trim().length > 0) {
    messages.push({ role: 'system', content: req.systemInstruction });
  }
  for (const m of req.history) {
    messages.push({
      role: m.role === 'model' ? 'assistant' : 'user',
      content: m.text,
    });
  }
  if (req.pendingAssistantText && req.pendingAssistantText.length > 0) {
    messages.push({ role: 'assistant', content: req.pendingAssistantText });
  }
  for (const r of req.toolResults ?? []) {
    messages.push(...buildToolResultMessages(r));
  }
  messages.push({ role: 'user', content: req.userMessage });

  return {
    model,
    stream: true,
    stream_options: { include_usage: true },
    messages,
    tools: req.mcpTools && req.mcpTools.length > 0 ? req.mcpTools.map(toOpenAITool) : undefined,
  };
}

function toOpenAITool(t: ProviderToolDecl) {
  return {
    type: 'function' as const,
    function: {
      name: t.qualifiedName,
      description: t.description ?? '',
      parameters: t.schema,
    },
  };
}

function buildToolResultMessages(r: ProviderToolResultMessage): Array<Record<string, unknown>> {
  return [
    {
      role: 'assistant',
      content: null,
      tool_calls: [{
        id: r.callId,
        type: 'function',
        function: { name: r.qualifiedName, arguments: '{}' },
      }],
    },
    {
      role: 'tool',
      tool_call_id: r.callId,
      content: r.ok ? JSON.stringify(r.output ?? {}) : JSON.stringify({ error: r.error }),
    },
  ];
}
