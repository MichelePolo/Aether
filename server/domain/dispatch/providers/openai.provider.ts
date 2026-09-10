import { toolWireName, qualifiedToolName, toolRounds } from './tool-transcript';
import type {
  AIProvider,
  ProviderCapabilities,
  ProviderChunk,
  ProviderRequest,
  ProviderToolDecl,
} from './provider.types';

export type OpenAIModel = 'gpt-5' | 'gpt-5-mini' | 'gpt-4.1' | 'o3';

export interface OpenAIProviderOpts {
  apiKey: string;
  model: string;
  baseUrl?: string;
  headers?: Record<string, string>;
  capabilities?: ProviderCapabilities;
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

export const DEFAULT_OPENAI_ENDPOINT = 'https://api.openai.com/v1/chat/completions';

export class OpenAIProvider implements AIProvider {
  readonly model: string;
  readonly capabilities: ProviderCapabilities;

  constructor(private readonly opts: OpenAIProviderOpts) {
    this.model = opts.model;
    this.capabilities = opts.capabilities ?? {
      thinking: opts.model === 'o3',
      toolCalling: true,
      vision: true,
    };
  }

  async *stream(req: ProviderRequest, signal: AbortSignal): AsyncIterable<ProviderChunk> {
    const body = buildBody(this.model, req);

    const url = this.opts.baseUrl ?? DEFAULT_OPENAI_ENDPOINT;
    const headers: Record<string, string> = {
      'content-type': 'application/json',
      'accept': 'text/event-stream',
      ...(this.opts.headers ?? { 'authorization': `Bearer ${this.opts.apiKey}` }),
    };

    const res = await fetch(url, {
      method: 'POST',
      headers,
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
    let lastUsage: { totalTokens?: number; inputTokens?: number; outputTokens?: number } | undefined;
    let sawUsage = false;
    let sawStop = false;

    try {
      while (true) {
        if (signal.aborted) return;
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        buf = buf.replace(/\r\n/g, '\n');

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
              usage: sawUsage ? lastUsage : undefined,
            };
            return;
          }
          let parsed: OpenAIChunk;
          try {
            parsed = JSON.parse(dataStr) as OpenAIChunk;
          } catch {
            continue;
          }

          if (parsed.usage) {
            const u = parsed.usage;
            if (u.total_tokens !== undefined || u.prompt_tokens !== undefined || u.completion_tokens !== undefined) {
              lastUsage = {
                ...(u.total_tokens !== undefined ? { totalTokens: u.total_tokens } : {}),
                ...(u.prompt_tokens !== undefined ? { inputTokens: u.prompt_tokens } : {}),
                ...(u.completion_tokens !== undefined ? { outputTokens: u.completion_tokens } : {}),
              };
              sawUsage = true;
            }
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
                    qualifiedName: qualifiedToolName(entry.name, req),
                    args: parsedArgs,
                  },
                };
              }
              toolBuffers.clear();
              sawStop = true;
            }
            if (choice.finish_reason === 'stop') {
              sawStop = true;
            }
          }

          if (sawStop && sawUsage) {
            yield {
              type: 'done',
              usage: lastUsage,
            };
            return;
          }
        }
      }
    } finally {
      try { await reader.cancel(); reader.releaseLock(); } catch { /* ignore */ }
    }

    // Stream ended naturally without an explicit terminator: emit a defensive done.
    yield {
      type: 'done',
      usage: sawUsage ? lastUsage : undefined,
    };
  }
}

function userContent(text: string, attachments?: ProviderRequest['attachments']): unknown {
  if (!attachments?.length) return text;
  return [{ type: 'text', text }, ...attachments.map(a => ({ type: 'image_url', image_url: { url: `data:${a.mime};base64,${a.bytes.toString('base64')}` } }))];
}

function buildBody(model: string, req: ProviderRequest): unknown {
  const messages: Array<Record<string, unknown>> = [];
  if (req.systemInstruction.trim()) messages.push({ role: 'system', content: req.systemInstruction });
  for (const m of req.history) messages.push({ role: m.role === 'model' ? 'assistant' : 'user', content: userContent(m.text, m.attachments) });
  if (req.userMessage || req.attachments?.length) messages.push({ role: 'user', content: userContent(req.userMessage, req.attachments) });
  if (req.pendingAssistantText) messages.push({ role: 'assistant', content: req.pendingAssistantText });
  for (const round of toolRounds(req)) {
    messages.push({ role: 'assistant', content: round.text || null, tool_calls: round.calls.map(c => ({ id: c.callId, type: 'function', function: { name: toolWireName(c.qualifiedName), arguments: JSON.stringify(c.args) } })) });
    for (const r of round.results) messages.push({ role: 'tool', tool_call_id: r.callId, content: JSON.stringify(r.ok ? r.output ?? {} : { error: r.error }) });
  }
  return { model, stream: true, stream_options: { include_usage: true }, messages,
    tools: req.mcpTools?.length ? req.mcpTools.map(toOpenAITool) : undefined };
}

function toOpenAITool(t: ProviderToolDecl) {
  return {
    type: 'function' as const,
    function: {
      name: toolWireName(t.qualifiedName),
      description: t.description ?? '',
      parameters: t.schema,
    },
  };
}
