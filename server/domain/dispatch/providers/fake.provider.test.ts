import { describe, it, expect } from 'vitest';
import { FakeProvider } from './fake.provider';

async function collect<T>(it: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const v of it) out.push(v);
  return out;
}

describe('FakeProvider', () => {
  it('yields configured text chunks then done', async () => {
    const p = new FakeProvider({ chunks: ['Hello', ' world'] });
    const ctrl = new AbortController();
    const all = await collect(
      p.stream(
        { systemInstruction: '', history: [], userMessage: '' },
        ctrl.signal,
      ),
    );
    expect(all).toEqual([
      { type: 'text', text: 'Hello' },
      { type: 'text', text: ' world' },
      { type: 'done' },
    ]);
  });

  it('aborts mid-stream when signal is aborted', async () => {
    const p = new FakeProvider({ chunks: ['a', 'b', 'c'], chunkDelayMs: 10 });
    const ctrl = new AbortController();
    const out: string[] = [];
    const iter = p.stream(
      { systemInstruction: '', history: [], userMessage: '' },
      ctrl.signal,
    );
    setTimeout(() => ctrl.abort(), 5);
    for await (const chunk of iter) {
      if (chunk.type === 'text') out.push(chunk.text);
    }
    expect(out.length).toBeLessThan(3);
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
});
