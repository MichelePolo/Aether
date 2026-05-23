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

it('emits inputTokens and outputTokens when configured', async () => {
  const p = new FakeProvider({ chunks: ['x'], totalTokens: 42, inputTokens: 30, outputTokens: 12 });
  const stream = p.stream({ systemInstruction: '', history: [], userMessage: 'hi' }, new AbortController().signal);
  let done: ProviderChunk | undefined;
  for await (const ev of stream) {
    if (ev.type === 'done') done = ev;
  }
  expect(done).toEqual({ type: 'done', usage: { totalTokens: 42, inputTokens: 30, outputTokens: 12 } });
});

import type { ProviderFunctionCall } from './provider.types';

describe('FakeProvider function_call (slice 7)', () => {
  it('emits programmed function_call before text chunks (no toolResults in request)', async () => {
    const call: ProviderFunctionCall = {
      callId: 'C1',
      qualifiedName: 'mock.echo',
      args: { message: 'hi' },
    };
    const p = new FakeProvider({
      chunks: ['after-tool'],
      functionCallSequence: [call],
      model: 'fake-1',
    });
    const chunks: unknown[] = [];
    for await (const c of p.stream(
      { systemInstruction: '', history: [], userMessage: 'x' },
      new AbortController().signal,
    )) {
      chunks.push(c);
    }
    expect(chunks[0]).toEqual({ type: 'function_call', call });
    expect(chunks.find((c) => (c as { type: string }).type === 'done')).toBeTruthy();
  });

  it('on continuation call (toolResults present), skips queue and emits remaining text chunks', async () => {
    const p = new FakeProvider({
      chunks: ['after-tool'],
      functionCallSequence: [{ callId: 'C1', qualifiedName: 'mock.echo', args: {} }],
      model: 'fake-1',
    });
    const sig = new AbortController().signal;
    // First call: emits function_call + done
    for await (const _ of p.stream({ systemInstruction: '', history: [], userMessage: 'x' }, sig)) {
      /* drain */
    }
    // Continuation: toolResults present → text chunk emitted
    const chunks2: unknown[] = [];
    for await (const c of p.stream(
      {
        systemInstruction: '',
        history: [],
        userMessage: 'x',
        toolResults: [{ callId: 'C1', qualifiedName: 'mock.echo', ok: true, output: { message: 'hi' } }],
      },
      sig,
    )) {
      chunks2.push(c);
    }
    expect(chunks2[0]).toEqual({ type: 'text', text: 'after-tool' });
  });
});
