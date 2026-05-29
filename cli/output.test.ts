import { describe, it, expect } from 'vitest';
import { handleEvent, type Writer } from './output';

function makeWriter() {
  const out: string[] = [];
  const err: string[] = [];
  const w: Writer = { out: (s) => out.push(s), err: (s) => err.push(s) };
  return { w, out, err };
}

describe('handleEvent (text mode)', () => {
  it('writes text chunks to stdout', () => {
    const { w, out, err } = makeWriter();
    const r = handleEvent({ event: 'text', data: { chunk: 'hello' } }, { json: false }, w);
    expect(out.join('')).toBe('hello');
    expect(err).toEqual([]);
    expect(r.done).toBe(false);
  });

  it('writes thinking to stderr, not stdout', () => {
    const { w, out, err } = makeWriter();
    handleEvent({ event: 'thinking', data: { chunk: 'pondering' } }, { json: false }, w);
    expect(out).toEqual([]);
    expect(err.join('')).toContain('pondering');
  });

  it('routes tool_call_request to stderr', () => {
    const { w, out, err } = makeWriter();
    handleEvent(
      { event: 'tool_call_request', data: { qualifiedName: 'fs.read', callId: 'c1' } },
      { json: false },
      w,
    );
    expect(out).toEqual([]);
    expect(err.join('')).toContain('fs.read');
  });

  it('signals done', () => {
    const { w } = makeWriter();
    const r = handleEvent({ event: 'done', data: { interrupted: false } }, { json: false }, w);
    expect(r.done).toBe(true);
  });

  it('signals done with error message', () => {
    const { w, err } = makeWriter();
    const r = handleEvent(
      { event: 'error', data: { message: 'boom', retryable: false } },
      { json: false },
      w,
    );
    expect(r.done).toBe(true);
    expect(r.error).toBe('boom');
    expect(err.join('')).toContain('boom');
  });
});

describe('handleEvent (json mode)', () => {
  it('emits one JSON line per event on stdout', () => {
    const { w, out } = makeWriter();
    handleEvent({ event: 'text', data: { chunk: 'x' } }, { json: true }, w);
    expect(out).toEqual(['{"event":"text","data":{"chunk":"x"}}\n']);
  });

  it('still signals done in json mode', () => {
    const { w } = makeWriter();
    const r = handleEvent({ event: 'done', data: {} }, { json: true }, w);
    expect(r.done).toBe(true);
  });
});
