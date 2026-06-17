import { parseSseStream, type SseEvent } from '@/src/lib/sse-parser';

export interface DispatchRequestBody {
  sessionId: string;
  message: string;
  thinking?: boolean;
  aetherMode?: boolean;
  providerName?: string;
  attachments?: Array<{
    name: string;
    mime: string;
    size: number;
    contentBase64: string;
  }>;
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

export interface ResumeRequestBody {
  sessionId: string;
  messageId: string;
  providerName?: string;
  aetherMode?: boolean;
}

export async function* createResumingDispatch(
  body: ResumeRequestBody,
  signal: AbortSignal,
): AsyncGenerator<SseEvent> {
  const res = await fetch('/api/ai/dispatch/resume', {
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
