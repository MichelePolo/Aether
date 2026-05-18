import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { AIProvider, ProviderChunk } from './provider.types';

// Mock @google/genai prima dell'import del provider
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

describe('GeminiProvider', () => {
  it('streams text chunks then done', async () => {
    async function* fakeStream() {
      yield { text: 'Hello' };
      yield { text: ' world' };
    }
    generateContentStream.mockResolvedValue(fakeStream());

    const { GeminiProvider } = await import('./gemini.provider');
    const p: AIProvider = new GeminiProvider({ apiKey: 'k', model: 'gemini-test' });
    const events = await collect(
      p.stream(
        { systemInstruction: 'SYS', history: [{ role: 'user', text: 'prev' }], userMessage: 'now' },
        new AbortController().signal,
      ),
    );
    expect(events).toEqual<ProviderChunk[]>([
      { type: 'text', text: 'Hello' },
      { type: 'text', text: ' world' },
      { type: 'done' },
    ]);
  });

  it('forwards systemInstruction + history + userMessage to SDK', async () => {
    async function* empty() { yield { text: 'x' }; }
    generateContentStream.mockResolvedValue(empty());

    const { GeminiProvider } = await import('./gemini.provider');
    const p = new GeminiProvider({ apiKey: 'k', model: 'gemini-test' });
    await collect(
      p.stream(
        {
          systemInstruction: 'BE_HELPFUL',
          history: [
            { role: 'user', text: 'hi' },
            { role: 'model', text: 'hello' },
          ],
          userMessage: 'how are you',
        },
        new AbortController().signal,
      ),
    );
    const call = generateContentStream.mock.calls[0][0];
    expect(call.model).toBe('gemini-test');
    expect(call.config.systemInstruction).toBe('BE_HELPFUL');
    expect(call.contents).toEqual([
      { role: 'user', parts: [{ text: 'hi' }] },
      { role: 'model', parts: [{ text: 'hello' }] },
      { role: 'user', parts: [{ text: 'how are you' }] },
    ]);
  });

  it('skips chunks with empty text', async () => {
    async function* stream() {
      yield { text: 'A' };
      yield { text: '' };
      yield { text: undefined };
      yield { text: 'B' };
    }
    generateContentStream.mockResolvedValue(stream());
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

  it('uses default model name when not provided', async () => {
    const { GeminiProvider } = await import('./gemini.provider');
    const p = new GeminiProvider({ apiKey: 'k' });
    expect(p.model).toBe('gemini-2.0-flash-exp');
  });

  it('throws with code preserved on SDK rejection', async () => {
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
