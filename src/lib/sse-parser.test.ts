import { describe, it, expect } from 'vitest';
import { parseSseStream, type SseEvent } from './sse-parser';

function streamFromChunks(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const c of chunks) controller.enqueue(encoder.encode(c));
      controller.close();
    },
  });
}

async function collect(stream: ReadableStream<Uint8Array>): Promise<SseEvent[]> {
  const out: SseEvent[] = [];
  for await (const ev of parseSseStream(stream)) out.push(ev);
  return out;
}

describe('parseSseStream', () => {
  it('parses a single well-formed event', async () => {
    const events = await collect(streamFromChunks([
      'event: text\ndata: {"chunk":"hello"}\n\n',
    ]));
    expect(events).toEqual([{ event: 'text', data: { chunk: 'hello' } }]);
  });

  it('defaults event name to "message" when absent', async () => {
    const events = await collect(streamFromChunks([
      'data: {"foo":1}\n\n',
    ]));
    expect(events).toEqual([{ event: 'message', data: { foo: 1 } }]);
  });

  it('parses multiple events in one chunk', async () => {
    const events = await collect(streamFromChunks([
      'event: text\ndata: {"chunk":"a"}\n\nevent: text\ndata: {"chunk":"b"}\n\n',
    ]));
    expect(events).toHaveLength(2);
    expect(events[1].data).toEqual({ chunk: 'b' });
  });

  it('handles event split across multiple chunks', async () => {
    const events = await collect(streamFromChunks([
      'event: text\nda',
      'ta: {"chunk":"hel',
      'lo"}\n\n',
    ]));
    expect(events).toEqual([{ event: 'text', data: { chunk: 'hello' } }]);
  });

  it('handles event boundary split across chunks', async () => {
    const events = await collect(streamFromChunks([
      'event: text\ndata: {"chunk":"a"}\n',
      '\nevent: text\ndata: {"chunk":"b"}\n\n',
    ]));
    expect(events).toHaveLength(2);
  });

  it('skips comments (lines starting with :)', async () => {
    const events = await collect(streamFromChunks([
      ': keep-alive\nevent: text\ndata: "ok"\n\n',
    ]));
    expect(events).toEqual([{ event: 'text', data: 'ok' }]);
  });

  it('emits error event for malformed JSON data', async () => {
    const events = await collect(streamFromChunks([
      'event: text\ndata: {not-json\n\n',
    ]));
    expect(events).toHaveLength(1);
    expect(events[0].event).toBe('parse_error');
    expect(events[0].data).toMatchObject({ raw: '{not-json' });
  });

  it('handles empty stream gracefully', async () => {
    const events = await collect(streamFromChunks([]));
    expect(events).toEqual([]);
  });

  it('ignores trailing data without terminator', async () => {
    const events = await collect(streamFromChunks([
      'event: text\ndata: {"chunk":"complete"}\n\nevent: text\ndata: {"chunk":"partial"}',
    ]));
    expect(events).toHaveLength(1);
    expect(events[0].data).toEqual({ chunk: 'complete' });
  });

  it('skips event blocks with no data line', async () => {
    const events = await collect(streamFromChunks([
      'event: text\n\nevent: text\ndata: "second"\n\n',
    ]));
    expect(events).toHaveLength(1);
    expect(events[0]).toEqual({ event: 'text', data: 'second' });
  });

  it('ignores unknown field lines', async () => {
    const events = await collect(streamFromChunks([
      'id: 42\nretry: 1000\nevent: text\ndata: "hi"\n\n',
    ]));
    expect(events).toEqual([{ event: 'text', data: 'hi' }]);
  });
});
