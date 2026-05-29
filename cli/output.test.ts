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

  it('tool_call_result with ok:true writes "ok" to stderr', () => {
    const { w, out, err } = makeWriter();
    const r = handleEvent({ event: 'tool_call_result', data: { ok: true } }, { json: false }, w);
    expect(out).toEqual([]);
    expect(err.join('')).toContain('ok');
    expect(r).toEqual({ done: false });
  });

  it('tool_call_result with ok:false writes the error to stderr', () => {
    const { w, err } = makeWriter();
    handleEvent({ event: 'tool_call_result', data: { ok: false, error: 'nope' } }, { json: false }, w);
    expect(err.join('')).toContain('nope');
  });

  it('tool_call_started returns done:false with no output', () => {
    const { w, out, err } = makeWriter();
    const r = handleEvent({ event: 'tool_call_started', data: {} }, { json: false }, w);
    expect(out).toEqual([]);
    expect(err).toEqual([]);
    expect(r).toEqual({ done: false });
  });

  it('tool_call_progress returns done:false', () => {
    const { w } = makeWriter();
    const r = handleEvent({ event: 'tool_call_progress', data: {} }, { json: false }, w);
    expect(r).toEqual({ done: false });
  });

  it('unknown event type returns done:false with no output', () => {
    const { w, out, err } = makeWriter();
    const r = handleEvent({ event: 'mystery', data: {} }, { json: false }, w);
    expect(out).toEqual([]);
    expect(err).toEqual([]);
    expect(r).toEqual({ done: false });
  });

  it('text event with no chunk field writes empty string', () => {
    const { w, out } = makeWriter();
    handleEvent({ event: 'text', data: {} }, { json: false }, w);
    expect(out).toEqual(['']);
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

  it('error event in json mode returns done:true with error message', () => {
    const { w } = makeWriter();
    const r = handleEvent(
      { event: 'error', data: { message: 'bad stuff', retryable: false } },
      { json: true },
      w,
    );
    expect(r).toEqual({ done: true, error: 'bad stuff' });
  });
});
