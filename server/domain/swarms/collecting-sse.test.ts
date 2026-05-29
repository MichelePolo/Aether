import { describe, it, expect } from 'vitest';
import type { SseEmitter } from '@/server/lib/sse';
import { createCollectingSse } from './collecting-sse';

function fakeOuter() {
  const events: { name: string; data: unknown }[] = [];
  let ended = false;
  const outer: SseEmitter = {
    event: (name, data) => events.push({ name, data }),
    error: (message, retryable) => events.push({ name: 'error', data: { message, retryable } }),
    end: () => {
      ended = true;
    },
  };
  return { outer, events, isEnded: () => ended };
}

describe('createCollectingSse', () => {
  it('accumulates text chunks', () => {
    const { outer } = fakeOuter();
    const c = createCollectingSse(outer);
    c.event('text', { chunk: 'hello ' });
    c.event('text', { chunk: 'world' });
    expect(c.text()).toBe('hello world');
  });

  it('forwards non-done events and swallows done', () => {
    const { outer, events } = fakeOuter();
    const c = createCollectingSse(outer);
    c.event('thinking', { chunk: 't' });
    c.event('done', { interrupted: false });
    expect(events.map((e) => e.name)).toEqual(['thinking']);
  });

  it('records an error event and exposes it via capturedError', () => {
    const { outer, events } = fakeOuter();
    const c = createCollectingSse(outer);
    c.event('error', { message: 'boom', retryable: false });
    expect(c.capturedError()).toEqual({ message: 'boom', retryable: false });
    expect(events.map((e) => e.name)).toEqual(['error']);
  });

  it('error() method records and forwards but does not end outer', () => {
    const { outer, isEnded } = fakeOuter();
    const c = createCollectingSse(outer);
    c.error('nope', true);
    expect(c.capturedError()).toEqual({ message: 'nope', retryable: true });
    expect(isEnded()).toBe(false);
  });

  it('end() does not close the outer stream', () => {
    const { outer, isEnded } = fakeOuter();
    const c = createCollectingSse(outer);
    c.end();
    expect(isEnded()).toBe(false);
  });
});
