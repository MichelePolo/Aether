import * as http from 'node:http';
import type { AddressInfo } from 'node:net';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { HttpMcpConnection } from './http-connection';

function ssePayload(frames: string[]): string {
  return frames.map((f) => `data: ${f}\n\n`).join('');
}

function streamFromString(s: string): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode(s));
      controller.close();
    },
  });
}

describe('HttpMcpConnection', () => {
  beforeEach(() => { vi.stubGlobal('fetch', vi.fn()); });
  afterEach(() => { vi.unstubAllGlobals(); });

  it('defaults autoApprove to false', () => {
    const c = new HttpMcpConnection({ url: 'http://localhost:8000' });
    expect(c.defaultAutoApprove).toBe(false);
  });

  it('initialize + listTools', async () => {
    let calls = 0;
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockImplementation(async () => {
      calls += 1;
      if (calls === 1) {
        return new Response(streamFromString(ssePayload([
          JSON.stringify({ jsonrpc: '2.0', id: 1, result: {} }),
        ])), { status: 200, headers: { 'content-type': 'text/event-stream' } });
      }
      return new Response(streamFromString(ssePayload([
        JSON.stringify({ jsonrpc: '2.0', id: 2, result: { tools: [{ name: 'echo', inputSchema: { type: 'object' } }] } }),
      ])), { status: 200, headers: { 'content-type': 'text/event-stream' } });
    });

    const c = new HttpMcpConnection({ url: 'http://localhost:8000' });
    await c.initialize();
    const tools = await c.listTools();
    expect(tools.map((t) => t.name)).toEqual(['echo']);
    await c.close();
  });

  it('callTool happy path', async () => {
    let initOnce = true;
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockImplementation(async (_url: string, init?: RequestInit) => {
      if (initOnce) {
        initOnce = false;
        return new Response(streamFromString(ssePayload([
          JSON.stringify({ jsonrpc: '2.0', id: 1, result: {} }),
        ])), { status: 200, headers: { 'content-type': 'text/event-stream' } });
      }
      const body = JSON.parse(init?.body as string) as { id: number };
      return new Response(streamFromString(ssePayload([
        JSON.stringify({ jsonrpc: '2.0', id: body.id, result: { content: [{ type: 'text', text: 'pong' }] } }),
      ])), { status: 200, headers: { 'content-type': 'text/event-stream' } });
    });

    const c = new HttpMcpConnection({ url: 'http://localhost:8000' });
    await c.initialize();
    const res = await c.callTool('echo', { message: 'hi' });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.output).toEqual({ content: [{ type: 'text', text: 'pong' }] });
    await c.close();
  });

  it('callTool with pre-aborted signal returns Cancelled immediately', async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockImplementation(async () =>
      new Response(streamFromString(ssePayload([
        JSON.stringify({ jsonrpc: '2.0', id: 1, result: {} }),
      ])), { status: 200, headers: { 'content-type': 'text/event-stream' } }),
    );
    const c = new HttpMcpConnection({ url: 'http://localhost:8000' });
    await c.initialize();
    const ctrl = new AbortController();
    ctrl.abort();
    const res = await c.callTool('echo', {}, { signal: ctrl.signal });
    expect(res).toEqual({ ok: false, error: 'Cancelled by user' });
  });

  it('callTool with onProgress receives notifications/progress', async () => {
    let initOnce = true;
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockImplementation(async (_url: string, init?: RequestInit) => {
      if (initOnce) {
        initOnce = false;
        return new Response(streamFromString(ssePayload([
          JSON.stringify({ jsonrpc: '2.0', id: 1, result: {} }),
        ])), { status: 200, headers: { 'content-type': 'text/event-stream' } });
      }
      const body = JSON.parse(init?.body as string) as { id: number };
      return new Response(streamFromString(ssePayload([
        JSON.stringify({ jsonrpc: '2.0', method: 'notifications/progress', params: { progressToken: body.id, progress: 1, total: 2, message: 'half' } }),
        JSON.stringify({ jsonrpc: '2.0', id: body.id, result: { content: [{ type: 'text', text: 'done' }] } }),
      ])), { status: 200, headers: { 'content-type': 'text/event-stream' } });
    });

    const c = new HttpMcpConnection({ url: 'http://localhost:8000' });
    await c.initialize();
    const notes: string[] = [];
    const res = await c.callTool('slow', {}, { onProgress: (n) => notes.push(n) });
    expect(res.ok).toBe(true);
    expect(notes.length).toBe(1);
    expect(notes[0]).toMatch(/1\/2/);
    await c.close();
  });

  it('rejects on non-OK initialize response', async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401 }),
    );
    const c = new HttpMcpConnection({ url: 'http://localhost:8000' });
    await expect(c.initialize()).rejects.toThrow();
  });

  it('fires onUnexpectedClose on fetch network error', async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('network down'));
    const c = new HttpMcpConnection({ url: 'http://localhost:8000' });
    let fired = false;
    c.onUnexpectedClose(() => {
      fired = true;
    });
    await expect(c.initialize()).rejects.toThrow();
    expect(fired).toBe(true);
  });

  describe('socket leak on timeout (real HTTP server)', () => {
    // These tests exercise a real node:http server + real global fetch, so they
    // must undo the vi.stubGlobal('fetch', ...) from the outer beforeEach.
    let server: http.Server;
    let url: string;
    let serverSawAbort: Promise<void>;

    beforeEach(async () => {
      vi.unstubAllGlobals();
      let resolveAbort!: () => void;
      serverSawAbort = new Promise<void>((resolve) => {
        resolveAbort = resolve;
      });
      server = http.createServer((req, res) => {
        res.writeHead(200, {
          'content-type': 'text/event-stream',
          connection: 'keep-alive',
        });
        res.write(': connected\n\n'); // keep the stream open — never send a response frame, never end()
        req.on('aborted', resolveAbort);
        res.on('close', resolveAbort);
      });
      await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
      const address = server.address() as AddressInfo;
      url = `http://127.0.0.1:${address.port}`;
    });

    afterEach(async () => {
      await new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      });
    });

    it(
      'aborts the fetch/reader when the RPC times out, so the server observes the request being aborted',
      async () => {
        const c = new HttpMcpConnection({ url });

        await expect(c.initialize()).rejects.toThrow(/timeout/);

        // Bounded wait: the server-side socket must actually be torn down as a
        // result of our client-side abort — not just the client-side promise
        // rejecting while the underlying connection is left open.
        await Promise.race([
          serverSawAbort,
          new Promise<void>((_, reject) =>
            setTimeout(() => reject(new Error('server never observed the request being aborted')), 3_000),
          ),
        ]);

        await c.close();
      },
      10_000,
    );
  });
});
