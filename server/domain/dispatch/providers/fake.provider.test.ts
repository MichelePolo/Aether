import { describe, it, expect } from 'vitest';
import { FakeProvider } from './fake.provider';
import type { ProviderChunk } from './provider.types';

async function collect<T>(it: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const v of it) out.push(v);
  return out;
}

describe('FakeProvider', () => {
  it('yields configured text chunks then done', async () => {
    const p = new FakeProvider({ chunks: ['Hello', ' world'] });
    const out = await collect(
      p.stream(
        { systemInstruction: '', history: [], userMessage: '' },
        new AbortController().signal,
      ),
    );
    expect(out).toEqual<ProviderChunk[]>([
      { type: 'text', text: 'Hello' },
      { type: 'text', text: ' world' },
      { type: 'done' },
    ]);
  });

  it('aborts mid-stream when signal is aborted', async () => {
    const p = new FakeProvider({ chunks: ['a', 'b', 'c'], chunkDelayMs: 10 });
    const ctrl = new AbortController();
    const iter = p.stream(
      { systemInstruction: '', history: [], userMessage: '' },
      ctrl.signal,
    );
    setTimeout(() => ctrl.abort(), 5);
    const out: ProviderChunk[] = [];
    for await (const c of iter) out.push(c);
    expect(out.filter((c) => c.type === 'text').length).toBeLessThan(3);
  });

  it('does not yield text after abort', async () => {
    const p = new FakeProvider({ chunks: ['a'] });
    const ctrl = new AbortController();
    ctrl.abort();
    const out = await collect(
      p.stream(
        { systemInstruction: '', history: [], userMessage: '' },
        ctrl.signal,
      ),
    );
    expect(out.filter((c) => c.type === 'text')).toHaveLength(0);
  });

  it('exposes model property', () => {
    const p = new FakeProvider({ chunks: ['x'] });
    expect(p.model).toBe('fake-1');
  });

  it('accepts custom model name', () => {
    const p = new FakeProvider({ chunks: ['x'], model: 'fake-echo' });
    expect(p.model).toBe('fake-echo');
  });

  it('yields thoughtChunks BEFORE text chunks when req.thinking=true', async () => {
    const p = new FakeProvider({ chunks: ['hello'], thoughtChunks: ['pondering', ' more'] });
    const out = await collect(
      p.stream(
        { systemInstruction: '', history: [], userMessage: 'x', thinking: true },
        new AbortController().signal,
      ),
    );
    expect(out).toEqual<ProviderChunk[]>([
      { type: 'thinking', text: 'pondering' },
      { type: 'thinking', text: ' more' },
      { type: 'text', text: 'hello' },
      { type: 'done' },
    ]);
  });

  it('omits thoughtChunks when req.thinking is not true', async () => {
    const p = new FakeProvider({ chunks: ['hello'], thoughtChunks: ['pondering'] });
    const out = await collect(
      p.stream(
        { systemInstruction: '', history: [], userMessage: 'x' },
        new AbortController().signal,
      ),
    );
    expect(out.filter((c) => c.type === 'thinking')).toHaveLength(0);
  });

  it('includes usage in done when totalTokens configured', async () => {
    const p = new FakeProvider({ chunks: ['x'], totalTokens: 42 });
    const out = await collect(
      p.stream(
        { systemInstruction: '', history: [], userMessage: 'x' },
        new AbortController().signal,
      ),
    );
    const done = out.at(-1);
    expect(done).toEqual({ type: 'done', usage: { totalTokens: 42 } });
  });
});
