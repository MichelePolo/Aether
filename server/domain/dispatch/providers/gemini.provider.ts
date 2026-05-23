import { randomUUID } from 'node:crypto';
import { GoogleGenAI } from '@google/genai';
import type { AIProvider, ProviderChunk, ProviderRequest, ProviderUsage } from './provider.types';

export interface GeminiProviderOptions {
  apiKey: string;
  model?: string;
}

interface GeminiPart {
  text?: string;
  thought?: boolean;
  functionCall?: { name: string; args?: Record<string, unknown> };
}

interface GeminiCandidate {
  content?: { parts?: GeminiPart[] };
}

interface GeminiUsageMetadata {
  totalTokenCount?: number;
  promptTokenCount?: number;
  candidatesTokenCount?: number;
}

interface GeminiChunk {
  text?: string;
  candidates?: GeminiCandidate[];
  usageMetadata?: GeminiUsageMetadata;
}

export class GeminiProvider implements AIProvider {
  readonly model: string;
  readonly capabilities = { thinking: true, toolCalling: true };
  private ai: GoogleGenAI;

  constructor(opts: GeminiProviderOptions) {
    this.model = opts.model ?? 'gemini-2.0-flash-exp';
    this.ai = new GoogleGenAI({ apiKey: opts.apiKey });
  }

  async *stream(
    req: ProviderRequest,
    signal: AbortSignal,
  ): AsyncGenerator<ProviderChunk> {
    // Build functionResponse entries for any tool results from a previous turn.
    const toolResultEntries = (req.toolResults ?? []).map((r) => ({
      role: 'user' as const,
      parts: [{
        functionResponse: {
          name: r.qualifiedName.replace('.', '__'),
          response: (r.ok ? r.output : { error: r.error }) as Record<string, unknown>,
        },
      }],
    }));

    const contents = [
      ...req.history.map((m) => ({ role: m.role, parts: [{ text: m.text }] })),
      ...toolResultEntries,
      { role: 'user' as const, parts: [{ text: req.userMessage }] },
    ];

    const toolsConfig = (req.mcpTools && req.mcpTools.length > 0)
      ? [{
          functionDeclarations: req.mcpTools.map((t) => ({
            name: t.qualifiedName.replace('.', '__'),
            description: t.description,
            parameters: t.schema,
          })),
        }]
      : undefined;

    const config: Record<string, unknown> = {
      systemInstruction: req.systemInstruction,
      // Forward the AbortSignal so the underlying HTTP request to Gemini
      // is cancelled when the user presses Stop. Without this, the server
      // would keep consuming quota even after the client iteration breaks.
      abortSignal: signal,
    };
    if (req.thinking === true) {
      config.thinkingConfig = { includeThoughts: true, thinkingBudget: -1 };
    }
    if (toolsConfig) {
      config.tools = toolsConfig;
    }

    const stream = await this.ai.models.generateContentStream({
      model: this.model,
      contents,
      config,
    });

    let lastUsage: ProviderUsage | undefined;
    for await (const raw of stream) {
      if (signal.aborted) return;
      const chunk = raw as GeminiChunk;

      const um = chunk.usageMetadata;
      if (um && (um.totalTokenCount !== undefined || um.promptTokenCount !== undefined || um.candidatesTokenCount !== undefined)) {
        lastUsage = {
          ...(um.totalTokenCount !== undefined ? { totalTokens: um.totalTokenCount } : {}),
          ...(um.promptTokenCount !== undefined ? { inputTokens: um.promptTokenCount } : {}),
          ...(um.candidatesTokenCount !== undefined ? { outputTokens: um.candidatesTokenCount } : {}),
        };
      }

      const parts = chunk.candidates?.[0]?.content?.parts;
      if (parts && parts.length > 0) {
        for (const part of parts) {
          if (part.functionCall) {
            yield {
              type: 'function_call' as const,
              call: {
                callId: randomUUID(),
                qualifiedName: String(part.functionCall.name).replace('__', '.'),
                args: (part.functionCall.args ?? {}) as Record<string, unknown>,
              },
            };
            continue;
          }
          const text = part.text;
          if (typeof text !== 'string' || text.length === 0) continue;
          if (part.thought === true) yield { type: 'thinking', text };
          else yield { type: 'text', text };
        }
      } else if (typeof chunk.text === 'string' && chunk.text.length > 0) {
        yield { type: 'text', text: chunk.text };
      }
    }
    if (!signal.aborted) yield { type: 'done', usage: lastUsage };
  }
}
