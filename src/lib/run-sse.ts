import { parseSseStream } from '@/src/lib/sse-parser';

export class HttpError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

/**
 * Consumes a fetch Response as an SSE run stream: throws HttpError on non-2xx,
 * otherwise iterates parsed SSE events via the shared parser and invokes onEvent
 * for each. Callers are responsible for resetting any "running" state in a
 * finally block, since a stream can end without emitting its terminal event.
 */
export async function consumeRun(
  res: Response,
  onEvent: (name: string, data: unknown) => void,
): Promise<void> {
  if (!res.ok) {
    let message = `HTTP ${res.status}`;
    try {
      const body = await res.json();
      message = (body?.error?.message as string) ?? message;
    } catch {
      // non-JSON or empty body — keep the generic HTTP status message
    }
    throw new HttpError(res.status, message);
  }
  if (!res.body) throw new Error('no stream');
  for await (const ev of parseSseStream(res.body)) {
    onEvent(ev.event, ev.data);
  }
}
