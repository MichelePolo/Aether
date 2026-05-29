import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { createSession, dispatch, rejectDecision } from './client';
import type { SseEvent } from './sse-consumer';

let server: http.Server;
let baseUrl: string;
const seen: { method: string; url: string; body: string }[] = [];

function start(handler: http.RequestListener): Promise<void> {
  server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      seen.push({ method: req.method ?? '', url: req.url ?? '', body });
      handler(req, res);
    });
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
      resolve();
    });
  });
}

beforeEach(() => {
  seen.length = 0;
});
afterEach(() => {
  server?.close();
});

describe('createSession', () => {
  it('POSTs /api/sessions and returns the new id', async () => {
    await start((_req, res) => {
      res.writeHead(201, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ id: 'sess-1' }));
    });
    const id = await createSession(baseUrl);
    expect(id).toBe('sess-1');
    expect(seen[0]).toMatchObject({ method: 'POST', url: '/api/sessions' });
  });
});

describe('dispatch', () => {
  it('streams SSE events to onEvent', async () => {
    await start((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      res.write('event: text\ndata: {"chunk":"hi"}\n\n');
      res.write('event: done\ndata: {"interrupted":false}\n\n');
      res.end();
    });
    const events: SseEvent[] = [];
    await dispatch({
      baseUrl,
      sessionId: 'sess-1',
      message: 'hello',
      onEvent: (e) => events.push(e),
    });
    expect(events.map((e) => e.event)).toEqual(['text', 'done']);
    expect(seen[0]).toMatchObject({ method: 'POST', url: '/api/ai/dispatch' });
    expect(JSON.parse(seen[0].body)).toMatchObject({ sessionId: 'sess-1', message: 'hello' });
  });
});

describe('rejectDecision', () => {
  it('POSTs a reject decision for the callId', async () => {
    await start((_req, res) => {
      res.writeHead(200);
      res.end('{}');
    });
    await rejectDecision(baseUrl, 'call-9');
    expect(seen[0]).toMatchObject({ method: 'POST', url: '/api/mcp/decision' });
    expect(JSON.parse(seen[0].body)).toEqual({ callId: 'call-9', action: 'reject' });
  });
});
