import type { SseEvent } from './sse-consumer';

export interface Writer {
  out: (s: string) => void;
  err: (s: string) => void;
}

export interface HandleResult {
  done: boolean;
  error?: string;
}

const DIM = '\x1b[2m';
const RESET = '\x1b[0m';

function dataChunk(data: unknown): string {
  return typeof data === 'object' && data !== null && 'chunk' in data
    ? String((data as { chunk: unknown }).chunk)
    : '';
}

export function handleEvent(
  ev: SseEvent,
  opts: { json: boolean },
  w: Writer,
): HandleResult {
  if (opts.json) {
    w.out(JSON.stringify(ev) + '\n');
    if (ev.event === 'done') return { done: true };
    if (ev.event === 'error') {
      const msg = (ev.data as { message?: string })?.message ?? 'error';
      return { done: true, error: msg };
    }
    return { done: false };
  }

  switch (ev.event) {
    case 'text':
      w.out(dataChunk(ev.data));
      return { done: false };
    case 'thinking':
      w.err(`${DIM}${dataChunk(ev.data)}${RESET}`);
      return { done: false };
    case 'tool_call_request': {
      const name = (ev.data as { qualifiedName?: string })?.qualifiedName ?? 'tool';
      w.err(`${DIM}→ tool: ${name}${RESET}\n`);
      return { done: false };
    }
    case 'tool_call_result': {
      const res = ev.data as { ok?: boolean; error?: string };
      const note = res?.ok ? 'ok' : `rejected/failed: ${res?.error ?? ''}`;
      w.err(`${DIM}← tool result: ${note}${RESET}\n`);
      return { done: false };
    }
    case 'tool_call_started':
    case 'tool_call_progress':
      return { done: false };
    case 'done':
      w.out('\n');
      return { done: true };
    case 'error': {
      const msg = (ev.data as { message?: string })?.message ?? 'error';
      w.err(`\naether: error: ${msg}\n`);
      return { done: true, error: msg };
    }
    default:
      return { done: false };
  }
}
