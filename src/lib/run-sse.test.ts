import { describe, it, expect } from 'vitest';
import { consumeRun, HttpError } from '@/src/lib/run-sse';

describe('consumeRun', () => {
  it('throws HttpError on non-2xx', async () => {
    const res = new Response(JSON.stringify({ error: { message: 'bad' } }), { status: 400 });
    await expect(consumeRun(res, () => {})).rejects.toMatchObject({ name: 'HttpError', status: 400 });
  });

  it('throws HttpError with a generic message when the error body is not JSON', async () => {
    const res = new Response('not json', { status: 500 });
    await expect(consumeRun(res, () => {})).rejects.toMatchObject({
      name: 'HttpError',
      status: 500,
      message: 'HTTP 500',
    });
  });

  it('emits parsed events for a 200 stream', async () => {
    const body = new ReadableStream({
      start(c) {
        c.enqueue(new TextEncoder().encode('event: x\ndata: {"a":1}\n\n'));
        c.close();
      },
    });
    const res = new Response(body, { status: 200 });
    const seen: string[] = [];
    await consumeRun(res, (name) => seen.push(name));
    expect(seen).toEqual(['x']);
  });

  it('passes parsed data through to onEvent', async () => {
    const body = new ReadableStream({
      start(c) {
        c.enqueue(new TextEncoder().encode('event: x\ndata: {"a":1}\n\n'));
        c.close();
      },
    });
    const res = new Response(body, { status: 200 });
    const seen: unknown[] = [];
    await consumeRun(res, (_name, data) => seen.push(data));
    expect(seen).toEqual([{ a: 1 }]);
  });

  it('throws when the response has no body', async () => {
    const res = new Response(null, { status: 200 });
    await expect(consumeRun(res, () => {})).rejects.toThrow('no stream');
  });
});

describe('HttpError', () => {
  it('carries the status and is an instanceof Error', () => {
    const err = new HttpError(404, 'not found');
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe('HttpError');
    expect(err.status).toBe(404);
    expect(err.message).toBe('not found');
  });
});
