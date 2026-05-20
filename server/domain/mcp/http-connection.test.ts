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
});
