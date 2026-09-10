import { toolRounds } from './tool-transcript';
import { randomUUID } from 'node:crypto';
import type {
  AIProvider,
  ProviderRequest,
  ProviderChunk,
  ProviderToolDecl,
  ProviderCapabilities,
} from './provider.types';

interface OllamaChatChunk {
  message?: {
    role: 'assistant';
    content: string;
    tool_calls?: Array<{
      function: { name: string; arguments: Record<string, unknown> };
    }>;
  };
  done?: boolean;
  eval_count?: number;
  prompt_eval_count?: number;
}

export interface OllamaProviderOpts {
  host: string;
  model: string;
  token?: string;
  headers?: Record<string, string>;
}

export class OllamaProvider implements AIProvider {
  readonly capabilities: ProviderCapabilities = { thinking: false, toolCalling: true, vision: false };
  readonly model: string;

  constructor(private readonly opts: OllamaProviderOpts) {
    this.model = opts.model;
  }

  async *stream(req: ProviderRequest, signal: AbortSignal): AsyncIterable<ProviderChunk> {
    const url = `${this.opts.host.replace(/\/$/, '')}/api/chat`;
    const body = buildBody(this.model, req);

    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (this.opts.token) headers.Authorization = `Bearer ${this.opts.token}`;
    Object.assign(headers, this.opts.headers ?? {});

    const res = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal,
    });

    if (!res.ok) {
      let errorMessage = `Ollama HTTP ${res.status}`;
      try {
        const errBody = await res.json();
        if (typeof errBody?.error === 'string') errorMessage = errBody.error;
      } catch {
        // ignore body parse failure
      }
      throw new Error(errorMessage);
    }

    if (!res.body) {
      throw new Error('Ollama response has no body');
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = '';

    try {
    while (true) {
      if (signal.aborted) {
        try { await reader.cancel(); } catch { /* ignore */ }
        return;
      }
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let idx;
      while ((idx = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, idx).trim();
        buf = buf.slice(idx + 1);
        if (!line) continue;
        let parsed: OllamaChatChunk;
        try {
          parsed = JSON.parse(line) as OllamaChatChunk;
        } catch {
          continue;
        }

        if (parsed.message?.tool_calls) {
          for (const tc of parsed.message.tool_calls) {
            yield {
              type: 'function_call',
              call: {
                callId: randomUUID(),
                qualifiedName: tc.function.name,
                args: tc.function.arguments ?? {},
              },
            };
          }
        }

        if (typeof parsed.message?.content === 'string' && parsed.message.content.length > 0) {
          yield { type: 'text', text: parsed.message.content };
        }

        if (parsed.done) {
          const total = (parsed.prompt_eval_count ?? 0) + (parsed.eval_count ?? 0);
          yield {
            type: 'done',
            usage: total > 0 ? { totalTokens: total } : undefined,
          };
          return;
        }
      }
    }
    } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
  }
}

function toOllamaTool(t: ProviderToolDecl) {
  return {
    type: 'function' as const,
    function: {
      name: t.qualifiedName,
      description: t.description,
      parameters: t.schema,
    },
  };
}

function buildBody(model: string, req: ProviderRequest): unknown {
  const messages: Array<Record<string, unknown>> = [];
  if (req.systemInstruction.trim()) messages.push({ role: 'system', content: req.systemInstruction });
  for (const m of req.history) messages.push({ role: m.role === 'model' ? 'assistant' : 'user', content: m.text });
  if (req.userMessage) messages.push({ role: 'user', content: req.userMessage });
  if (req.pendingAssistantText) messages.push({ role: 'assistant', content: req.pendingAssistantText });
  for (const round of toolRounds(req)) {
    messages.push({ role: 'assistant', content: round.text, tool_calls: round.calls.map(c => ({ function: { name: c.qualifiedName, arguments: c.args } })) });
    for (const r of round.results) messages.push({ role: 'tool', tool_name: r.qualifiedName, content: JSON.stringify(r.ok ? r.output ?? {} : { error: r.error }) });
  }
  return { model, messages, tools: req.mcpTools?.length ? req.mcpTools.map(toOllamaTool) : undefined, stream: true };
}
