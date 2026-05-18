import { parseSseStream, type SseEvent } from '@/src/lib/sse-parser';

export interface DispatchRequestBody {
  message: string;
}

export async function* createStreamingDispatch(
  body: DispatchRequestBody,
  signal: AbortSignal,
): AsyncGenerator<SseEvent> {
  const res = await fetch('/api/ai/dispatch', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
    body: JSON.stringify(body),
    signal,
  });
  if (!res.ok || !res.body) {
    throw new Error(`HTTP ${res.status}`);
  }
  for await (const ev of parseSseStream(res.body)) {
    yield ev;
  }
}
