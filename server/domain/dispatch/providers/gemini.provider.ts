import { toolWireName, qualifiedToolName, toolRounds } from './tool-transcript';
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
  thoughtSignature?: string;
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
  readonly capabilities = { thinking: true, toolCalling: true, vision: true };
  private ai: GoogleGenAI;

  constructor(opts: GeminiProviderOptions) {
    this.model = opts.model ?? 'gemini-2.0-flash-exp';
    this.ai = new GoogleGenAI({ apiKey: opts.apiKey });
  }

  async *stream(
    req: ProviderRequest,
    signal: AbortSignal,
  ): AsyncGenerator<ProviderChunk> {
    const partsFor = (text: string, attachments?: ProviderRequest['attachments']) => [
      ...(attachments ?? []).map(a => ({ inlineData: { mimeType: a.mime, data: a.bytes.toString('base64') } })),
      ...(text ? [{ text }] : []),
    ];
    const contents: Array<{ role: string; parts: Array<Record<string, unknown>> }> = req.history.map(m => ({ role: m.role, parts: partsFor(m.text, m.attachments) }));
    if (req.userMessage || req.attachments?.length) contents.push({ role: 'user', parts: partsFor(req.userMessage, req.attachments) });
    if (req.pendingAssistantText) contents.push({ role: 'model', parts: [{ text: req.pendingAssistantText }] });
    for (const round of toolRounds(req)) {
      contents.push({ role: 'model', parts: [
        ...(round.text ? [{ text: round.text }] : []),
        ...round.calls.map(c => ({ functionCall: { name: toolWireName(c.qualifiedName), args: c.args }, ...(c.metadata ?? {}) })),
      ] });
      contents.push({ role: 'user', parts: round.results.map(r => ({ functionResponse: { name: toolWireName(r.qualifiedName), response: r.ok ? { result: r.output ?? {} } : { error: r.error } } })) });
    }

    const toolsConfig = (req.mcpTools && req.mcpTools.length > 0)
      ? [{
          functionDeclarations: req.mcpTools.map((t) => ({
            name: toolWireName(t.qualifiedName),
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
                qualifiedName: qualifiedToolName(String(part.functionCall.name), req),
                args: (part.functionCall.args ?? {}) as Record<string, unknown>,
                ...(part.thoughtSignature ? { metadata: { thoughtSignature: part.thoughtSignature } } : {}),
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
