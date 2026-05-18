import { describe, it, expect } from 'vitest';
import { http, HttpResponse } from 'msw';
import { server } from '@/src/test/msw-server';
import { createStreamingDispatch } from './dispatch.api';

function sseChunks(...lines: string[]) {
  const enc = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(c) {
      for (const l of lines) c.enqueue(enc.encode(l));
      c.close();
    },
  });
}

async function collect<T>(it: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const v of it) out.push(v);
  return out;
}

describe('createStreamingDispatch', () => {
  it('yields parsed text + done events', async () => {
    server.use(
      http.post('http://localhost/api/ai/dispatch', () =>
        new HttpResponse(
          sseChunks(
            'event: text\ndata: {"chunk":"Hello"}\n\n',
            'event: text\ndata: {"chunk":" world"}\n\n',
            'event: done\ndata: {"model":"fake-1","interrupted":false}\n\n',
          ),
          { headers: { 'Content-Type': 'text/event-stream' } },
        ),
      ),
    );
    const events = await collect(createStreamingDispatch({ message: 'hi' }, new AbortController().signal));
    expect(events.map((e) => e.event)).toEqual(['text', 'text', 'done']);
    expect(events[2].data).toMatchObject({ model: 'fake-1', interrupted: false });
  });

  it('handles chunk boundaries inside events', async () => {
    server.use(
      http.post('http://localhost/api/ai/dispatch', () =>
        new HttpResponse(
          sseChunks(
            'event: text\nd',
            'ata: {"chunk":"A"}\n\nevent: text\ndata: {"chu',
            'nk":"B"}\n\nevent: done\ndata: {"model":"m","interrupted":false}\n\n',
          ),
          { headers: { 'Content-Type': 'text/event-stream' } },
        ),
      ),
    );
    const events = await collect(createStreamingDispatch({ message: 'hi' }, new AbortController().signal));
    expect(events.filter((e) => e.event === 'text').map((e) => (e.data as { chunk: string }).chunk))
      .toEqual(['A', 'B']);
  });

  it('throws AbortError when signal aborted before fetch resolves', async () => {
    server.use(
      http.post('http://localhost/api/ai/dispatch', async () =>
        new HttpResponse(
          sseChunks('event: text\ndata: {"chunk":"A"}\n\n'),
          { headers: { 'Content-Type': 'text/event-stream' } },
        ),
      ),
    );
    const ctrl = new AbortController();
    ctrl.abort();
    await expect(
      collect(createStreamingDispatch({ message: 'hi' }, ctrl.signal)),
    ).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('throws when response is not ok', async () => {
    server.use(
      http.post('http://localhost/api/ai/dispatch', () =>
        HttpResponse.json({ error: { message: 'bad' } }, { status: 503 }),
      ),
    );
    await expect(
      collect(createStreamingDispatch({ message: 'hi' }, new AbortController().signal)),
    ).rejects.toThrow();
  });
});
