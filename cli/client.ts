import { createSseParser, type SseEvent } from './sse-consumer';

export async function createSession(baseUrl: string): Promise<string> {
  const res = await fetch(`${baseUrl}/api/sessions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
  });
  if (!res.ok) throw new Error(`create session failed: HTTP ${res.status}`);
  const meta = (await res.json()) as { id: string };
  return meta.id;
}

export interface DispatchOpts {
  baseUrl: string;
  sessionId: string;
  message: string;
  providerName?: string;
  onEvent: (e: SseEvent) => void;
  signal?: AbortSignal;
}

export async function dispatch(opts: DispatchOpts): Promise<void> {
  const res = await fetch(`${opts.baseUrl}/api/ai/dispatch`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      sessionId: opts.sessionId,
      message: opts.message,
      ...(opts.providerName ? { providerName: opts.providerName } : {}),
    }),
    signal: opts.signal,
  });
  if (!res.ok || !res.body) throw new Error(`dispatch failed: HTTP ${res.status}`);

  const feed = createSseParser(opts.onEvent);
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    feed(decoder.decode(value, { stream: true }));
  }
}

export async function rejectDecision(baseUrl: string, callId: string): Promise<void> {
  await fetch(`${baseUrl}/api/mcp/decision`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ callId, action: 'reject' }),
  }).catch(() => {
    // best-effort: gate rejection must never crash the stream
  });
}
