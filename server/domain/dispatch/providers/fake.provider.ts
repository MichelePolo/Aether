import type { AIProvider, ProviderChunk, ProviderRequest } from './provider.types';

export interface FakeProviderOptions {
  chunks: string[];
  chunkDelayMs?: number;
  model?: string;
}

export class FakeProvider implements AIProvider {
  readonly model: string;

  constructor(private readonly opts: FakeProviderOptions) {
    this.model = opts.model ?? 'fake-1';
  }

  async *stream(
    _req: ProviderRequest,
    signal: AbortSignal,
  ): AsyncGenerator<ProviderChunk> {
    for (const text of this.opts.chunks) {
      if (signal.aborted) return;
      if (this.opts.chunkDelayMs && this.opts.chunkDelayMs > 0) {
        await sleep(this.opts.chunkDelayMs, signal);
        if (signal.aborted) return;
      }
      yield { type: 'text', text };
    }
    if (!signal.aborted) yield { type: 'done' };
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
