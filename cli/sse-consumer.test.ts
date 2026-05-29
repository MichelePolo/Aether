import { describe, it, expect } from 'vitest';
import { createSseParser, type SseEvent } from './sse-consumer';

function collect(chunks: string[]): SseEvent[] {
  const events: SseEvent[] = [];
  const feed = createSseParser((e) => events.push(e));
  for (const c of chunks) feed(c);
  return events;
}

describe('createSseParser', () => {
  it('parses a single complete event', () => {
    const events = collect(['event: text\ndata: {"chunk":"hi"}\n\n']);
    expect(events).toEqual([{ event: 'text', data: { chunk: 'hi' } }]);
  });

  it('parses multiple events in one chunk', () => {
    const events = collect([
      'event: text\ndata: {"chunk":"a"}\n\nevent: done\ndata: {"interrupted":false}\n\n',
    ]);
    expect(events.map((e) => e.event)).toEqual(['text', 'done']);
  });

  it('reassembles an event split across chunks mid-line', () => {
    const events = collect(['event: text\nda', 'ta: {"chunk":"split"}\n\n']);
    expect(events).toEqual([{ event: 'text', data: { chunk: 'split' } }]);
  });

  it('ignores blocks without a data line', () => {
    const events = collect([': keep-alive comment\n\n']);
    expect(events).toEqual([]);
  });
});
