import { describe, it, expect, vi } from 'vitest';
import type { Response } from 'express';
import { createSseEmitter } from './sse';

function fakeRes() {
  const headers = new Map<string, string>();
  const chunks: string[] = [];
  return {
    setHeader: vi.fn((k: string, v: string) => headers.set(k, v)),
    write: vi.fn((c: string) => {
      chunks.push(c);
      return true;
    }),
    end: vi.fn(),
    headers,
    chunks,
  } as unknown as Response & { headers: Map<string, string>; chunks: string[] };
}

describe('createSseEmitter', () => {
  it('sets SSE response headers on first emit', () => {
    const res = fakeRes();
    const sse = createSseEmitter(res);
    sse.event('text', { chunk: 'hi' });
    expect((res as unknown as { headers: Map<string, string> }).headers.get('Content-Type')).toBe(
      'text/event-stream',
    );
    expect((res as unknown as { headers: Map<string, string> }).headers.get('Cache-Control')).toBe(
      'no-cache',
    );
  });

  it('emits event with JSON data', () => {
    const res = fakeRes();
    const sse = createSseEmitter(res);
    sse.event('text', { chunk: 'hi' });
    expect((res as unknown as { chunks: string[] }).chunks).toContain(
      'event: text\ndata: {"chunk":"hi"}\n\n',
    );
  });

  it('emits error event then ends', () => {
    const res = fakeRes();
    const sse = createSseEmitter(res);
    sse.error('boom');
    expect(
      (res as unknown as { chunks: string[] }).chunks.some(
        (c) => c.includes('event: error') && c.includes('"message":"boom"'),
      ),
    ).toBe(true);
    expect((res as Response).end).toHaveBeenCalled();
  });

  it('end() closes the response', () => {
    const res = fakeRes();
    const sse = createSseEmitter(res);
    sse.event('text', { chunk: 'x' });
    sse.end();
    expect((res as Response).end).toHaveBeenCalled();
  });

  it('subsequent emits after end are no-ops', () => {
    const res = fakeRes();
    const sse = createSseEmitter(res);
    sse.end();
    const before = (res as unknown as { chunks: string[] }).chunks.length;
    sse.event('text', { chunk: 'lost' });
    expect((res as unknown as { chunks: string[] }).chunks.length).toBe(before);
  });

  it('error() after close is a no-op', () => {
    const res = fakeRes();
    const sse = createSseEmitter(res);
    sse.error('boom');
    const callsBefore = (res as Response).end as unknown as { mock: { calls: unknown[] } };
    const endCallsBefore = callsBefore.mock.calls.length;
    sse.error('again');
    expect(((res as Response).end as unknown as { mock: { calls: unknown[] } }).mock.calls.length).toBe(
      endCallsBefore,
    );
  });

  it('end() after close is a no-op', () => {
    const res = fakeRes();
    const sse = createSseEmitter(res);
    sse.end();
    const endCallsBefore = ((res as Response).end as unknown as { mock: { calls: unknown[] } }).mock
      .calls.length;
    sse.end();
    expect(((res as Response).end as unknown as { mock: { calls: unknown[] } }).mock.calls.length).toBe(
      endCallsBefore,
    );
  });
});
