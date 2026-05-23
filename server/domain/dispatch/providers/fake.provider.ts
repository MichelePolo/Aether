import type { AIProvider, ProviderChunk, ProviderFunctionCall, ProviderRequest, ProviderUsage } from './provider.types';

export interface FakeProviderOptions {
  chunks: string[];
  thoughtChunks?: string[];
  chunkDelayMs?: number;
  model?: string;
  totalTokens?: number;
  inputTokens?: number;
  outputTokens?: number;
  functionCallSequence?: ProviderFunctionCall[];
}

export class FakeProvider implements AIProvider {
  readonly model: string;
  readonly capabilities = { thinking: true, toolCalling: true };
  lastRequest: ProviderRequest | undefined;
  private functionCallQueue: ProviderFunctionCall[];

  constructor(private readonly opts: FakeProviderOptions) {
    this.model = opts.model ?? 'fake-1';
    this.functionCallQueue = [...(opts.functionCallSequence ?? [])];
  }

  async *stream(
    req: ProviderRequest,
    signal: AbortSignal,
  ): AsyncGenerator<ProviderChunk> {
    this.lastRequest = req;
    // If there's a queued function_call AND we are NOT in a continuation call,
    // emit it and finish this stream.
    if (this.functionCallQueue.length > 0 && (!req.toolResults || req.toolResults.length === 0)) {
      const call = this.functionCallQueue.shift()!;
      yield { type: 'function_call', call };
      yield { type: 'done' };
      return;
    }
    // Thought chunks emitted FIRST, only when req.thinking === true.
    if (req.thinking === true && this.opts.thoughtChunks) {
      for (const text of this.opts.thoughtChunks) {
        if (signal.aborted) return;
        if (this.opts.chunkDelayMs && this.opts.chunkDelayMs > 0) {
          await sleep(this.opts.chunkDelayMs, signal);
          if (signal.aborted) return;
        }
        yield { type: 'thinking', text };
      }
    }
    for (const text of this.opts.chunks) {
      if (signal.aborted) return;
      if (this.opts.chunkDelayMs && this.opts.chunkDelayMs > 0) {
        await sleep(this.opts.chunkDelayMs, signal);
        if (signal.aborted) return;
      }
      yield { type: 'text', text };
    }
    if (!signal.aborted) {
      const usageParts: ProviderUsage = {};
      if (this.opts.totalTokens !== undefined) usageParts.totalTokens = this.opts.totalTokens;
      if (this.opts.inputTokens !== undefined) usageParts.inputTokens = this.opts.inputTokens;
      if (this.opts.outputTokens !== undefined) usageParts.outputTokens = this.opts.outputTokens;
      yield {
        type: 'done',
        usage: Object.keys(usageParts).length > 0 ? usageParts : undefined,
      };
    }
  }
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) return resolve();
    const t = setTimeout(resolve, ms);
    signal.addEventListener('abort', () => {
      clearTimeout(t);
      resolve();
    }, { once: true });
  });
}
