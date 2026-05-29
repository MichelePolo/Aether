import type { SseEmitter } from '@/server/lib/sse';

export interface CollectingSse extends SseEmitter {
  text(): string;
  capturedError(): { message: string; retryable: boolean } | null;
}

/** Wraps an outer SSE emitter for a single dispatch turn: accumulates `text`
 *  chunks, records any `error`, forwards every event EXCEPT `done` to the outer
 *  stream, and never ends/closes the outer stream. */
export function createCollectingSse(outer: SseEmitter): CollectingSse {
  let buffer = '';
  let err: { message: string; retryable: boolean } | null = null;

  return {
    event(name, data) {
      if (name === 'text') {
        const chunk = (data as { chunk?: unknown })?.chunk;
        if (typeof chunk === 'string') buffer += chunk;
      } else if (name === 'error') {
        const d = data as { message?: string; retryable?: boolean };
        err = { message: d?.message ?? 'error', retryable: Boolean(d?.retryable) };
      }
      if (name !== 'done') outer.event(name, data);
    },
    error(message, retryable = false) {
      err = { message, retryable };
      outer.event('error', { message, retryable });
    },
    end() {
      // no-op: the inner turn ending must not close the swarm stream
    },
    text() {
      return buffer;
    },
    capturedError() {
      return err;
    },
  };
}
