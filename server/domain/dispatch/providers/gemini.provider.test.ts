import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ProviderChunk } from './provider.types';

const generateContentStream = vi.fn();
vi.mock('@google/genai', () => ({
  GoogleGenAI: vi.fn(function (this: { models: unknown }) {
    this.models = { generateContentStream };
  }),
}));

async function collect<T>(it: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const v of it) out.push(v);
  return out;
}

beforeEach(() => {
  generateContentStream.mockReset();
});

describe('GeminiProvider (without thinking)', () => {
  it('streams text + done from chunks with `text` shape', async () => {
    async function* fake() {
      yield { text: 'Hello' };
      yield { text: ' world' };
    }
    generateContentStream.mockResolvedValue(fake());
    const { GeminiProvider } = await import('./gemini.provider');
    const p = new GeminiProvider({ apiKey: 'k', model: 'gemini-test' });
    const events = await collect(
      p.stream(
        { systemInstruction: '', history: [], userMessage: 'x' },
        new AbortController().signal,
      ),
    );
    expect(events).toEqual<ProviderChunk[]>([
      { type: 'text', text: 'Hello' },
      { type: 'text', text: ' world' },
      { type: 'done', usage: undefined },
    ]);
  });

  it('does NOT include thinkingConfig when thinking is false/absent', async () => {
    async function* fake() { yield { text: 'x' }; }
    generateContentStream.mockResolvedValue(fake());
    const { GeminiProvider } = await import('./gemini.provider');
    const p = new GeminiProvider({ apiKey: 'k', model: 'm' });
    await collect(
      p.stream(
        { systemInstruction: '', history: [], userMessage: 'x' },
        new AbortController().signal,
      ),
    );
    const cfg = generateContentStream.mock.calls[0][0].config;
    expect(cfg.thinkingConfig).toBeUndefined();
  });
});

describe('GeminiProvider (with thinking)', () => {
  it('sets config.thinkingConfig with includeThoughts + thinkingBudget=-1', async () => {
    async function* fake() { yield { text: 'x' }; }
    generateContentStream.mockResolvedValue(fake());
    const { GeminiProvider } = await import('./gemini.provider');
    const p = new GeminiProvider({ apiKey: 'k', model: 'm' });
    await collect(
      p.stream(
        { systemInstruction: '', history: [], userMessage: 'x', thinking: true },
        new AbortController().signal,
      ),
    );
    const cfg = generateContentStream.mock.calls[0][0].config;
    expect(cfg.thinkingConfig).toEqual({ includeThoughts: true, thinkingBudget: -1 });
  });

  it('discriminates thought parts from answer parts', async () => {
    async function* fake() {
      yield {
        candidates: [{
          content: {
            parts: [
              { text: 'pondering', thought: true },
              { text: 'Hello' },
            ],
          },
        }],
      };
      yield {
        candidates: [{
          content: { parts: [{ text: ' world' }] },
        }],
      };
    }
    generateContentStream.mockResolvedValue(fake());
    const { GeminiProvider } = await import('./gemini.provider');
    const p = new GeminiProvider({ apiKey: 'k', model: 'm' });
    const events = await collect(
      p.stream(
        { systemInstruction: '', history: [], userMessage: 'x', thinking: true },
        new AbortController().signal,
      ),
    );
    expect(events.slice(0, 3)).toEqual([
      { type: 'thinking', text: 'pondering' },
      { type: 'text', text: 'Hello' },
      { type: 'text', text: ' world' },
    ]);
  });

  it('captures usageMetadata.totalTokenCount into done.usage', async () => {
    async function* fake() {
      yield { text: 'x', usageMetadata: { totalTokenCount: 123 } };
    }
    generateContentStream.mockResolvedValue(fake());
    const { GeminiProvider } = await import('./gemini.provider');
    const p = new GeminiProvider({ apiKey: 'k', model: 'm' });
    const events = await collect(
      p.stream(
        { systemInstruction: '', history: [], userMessage: 'x' },
        new AbortController().signal,
      ),
    );
    const done = events.at(-1);
    expect(done).toEqual({ type: 'done', usage: { totalTokens: 123 } });
  });

  it('skips empty parts', async () => {
    async function* fake() {
      yield { candidates: [{ content: { parts: [{ text: 'A' }, { text: '' }, { text: 'B' }] } }] };
    }
    generateContentStream.mockResolvedValue(fake());
    const { GeminiProvider } = await import('./gemini.provider');
    const p = new GeminiProvider({ apiKey: 'k', model: 'm' });
    const events = await collect(
      p.stream(
        { systemInstruction: '', history: [], userMessage: 'x' },
        new AbortController().signal,
      ),
    );
    expect(events.filter((e) => e.type === 'text')).toEqual([
      { type: 'text', text: 'A' },
      { type: 'text', text: 'B' },
    ]);
  });

  it('breaks the stream when aborted', async () => {
    async function* slow() {
      yield { text: 'A' };
      await new Promise((r) => setTimeout(r, 20));
      yield { text: 'B' };
    }
    generateContentStream.mockResolvedValue(slow());
    const { GeminiProvider } = await import('./gemini.provider');
    const p = new GeminiProvider({ apiKey: 'k', model: 'm' });
    const ctrl = new AbortController();
    setTimeout(() => ctrl.abort(), 5);
    const out: ProviderChunk[] = [];
    for await (const ev of p.stream(
      { systemInstruction: '', history: [], userMessage: 'x' },
      ctrl.signal,
    )) {
      out.push(ev);
    }
    expect(out.filter((e) => e.type === 'text').map((e) => e.type === 'text' && e.text)).not.toContain('B');
  });

  it('throws with status preserved on SDK rejection', async () => {
    generateContentStream.mockRejectedValue(Object.assign(new Error('Auth failed'), { status: 401 }));
    const { GeminiProvider } = await import('./gemini.provider');
    const p = new GeminiProvider({ apiKey: 'k', model: 'm' });
    await expect(
      collect(
        p.stream(
          { systemInstruction: '', history: [], userMessage: 'x' },
          new AbortController().signal,
        ),
      ),
    ).rejects.toMatchObject({ message: 'Auth failed', status: 401 });
  });
});
