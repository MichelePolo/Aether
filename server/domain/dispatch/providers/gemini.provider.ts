import { GoogleGenAI } from '@google/genai';
import type { AIProvider, ProviderChunk, ProviderRequest } from './provider.types';

export interface GeminiProviderOptions {
  apiKey: string;
  model?: string;
}

export class GeminiProvider implements AIProvider {
  readonly model: string;
  private ai: GoogleGenAI;

  constructor(opts: GeminiProviderOptions) {
    this.model = opts.model ?? 'gemini-2.0-flash-exp';
    this.ai = new GoogleGenAI({ apiKey: opts.apiKey });
  }

  async *stream(
    req: ProviderRequest,
    signal: AbortSignal,
  ): AsyncGenerator<ProviderChunk> {
    const contents = [
      ...req.history.map((m) => ({ role: m.role, parts: [{ text: m.text }] })),
      { role: 'user' as const, parts: [{ text: req.userMessage }] },
    ];

    const stream = await this.ai.models.generateContentStream({
      model: this.model,
      contents,
      config: {
        systemInstruction: req.systemInstruction,
      },
    });

    for await (const chunk of stream) {
      if (signal.aborted) return;
      const text = chunk.text;
      if (typeof text === 'string' && text.length > 0) {
        yield { type: 'text', text };
      }
    }
    if (!signal.aborted) yield { type: 'done' };
  }
}
