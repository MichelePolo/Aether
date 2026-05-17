import type { Response } from 'express';

export interface SseEmitter {
  event(name: string, data: unknown): void;
  error(message: string): void;
  end(): void;
}

export function createSseEmitter(res: Response): SseEmitter {
  let headersSent = false;
  let closed = false;

  function ensureHeaders() {
    if (headersSent) return;
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    headersSent = true;
  }

  return {
    event(name, data) {
      if (closed) return;
      ensureHeaders();
      res.write(`event: ${name}\ndata: ${JSON.stringify(data)}\n\n`);
    },
    error(message) {
      if (closed) return;
      ensureHeaders();
      res.write(`event: error\ndata: ${JSON.stringify({ message })}\n\n`);
      closed = true;
      res.end();
    },
    end() {
      if (closed) return;
      ensureHeaders();
      closed = true;
      res.end();
    },
  };
}
