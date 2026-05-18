import type { Response } from 'supertest';
import { parseSseStream } from '@/src/lib/sse-parser';
import type { SseEmitter } from '@/server/lib/sse';

// ----- Helper #1: in-memory SseEmitter mock for unit tests -----
export interface CollectedEvent {
  event: string;
  data: unknown;
}

export function createCollectorEmitter(): {
  emitter: SseEmitter;
  events: CollectedEvent[];
  ended: boolean;
} {
  const events: CollectedEvent[] = [];
  let ended = false;
  const emitter: SseEmitter = {
    event(name, data) {
      if (ended) return;
      events.push({ event: name, data });
    },
    error(message, retryable = false) {
      if (ended) return;
      events.push({ event: 'error', data: { message, retryable } });
      ended = true;
    },
    end() {
      ended = true;
    },
  };
  return {
    emitter,
    events,
    get ended() {
      return ended;
    },
  } as { emitter: SseEmitter; events: CollectedEvent[]; ended: boolean };
}

// ----- Helper #2: parse supertest streaming body into events -----
export async function collectSseEvents(res: Response): Promise<CollectedEvent[]> {
  const text: string = (res as unknown as { text: string }).text ?? '';
  // Costruisce un ReadableStream a partire dal testo già accumulato.
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(text));
      controller.close();
    },
  });
  const out: CollectedEvent[] = [];
  for await (const ev of parseSseStream(stream)) {
    out.push({ event: ev.event, data: ev.data });
  }
  return out;
}
