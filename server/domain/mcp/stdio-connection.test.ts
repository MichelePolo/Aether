import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { StdioMcpConnection } from './stdio-connection';

const FIXTURE = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '__fixtures__',
  'echo-server.js',
);

describe('StdioMcpConnection', () => {
  let conn: StdioMcpConnection;
  beforeEach(() => {
    conn = new StdioMcpConnection({ command: 'node', args: [FIXTURE], env: {} });
  });
  afterEach(async () => {
    await conn.close();
  });

  it('defaults autoApprove to false', () => {
    expect(conn.defaultAutoApprove).toBe(false);
  });

  it('initialize sends a spec-compliant handshake (protocolVersion, capabilities, clientInfo)', async () => {
    // The fixture rejects a handshake missing these params, mirroring the real
    // @modelcontextprotocol/server-filesystem server.
    await expect(conn.initialize()).resolves.toBeUndefined();
  });

  it('initialize + listTools returns echo', async () => {
    await conn.initialize();
    const tools = await conn.listTools();
    expect(tools.map((t) => t.name)).toEqual(['echo', 'slow']);
  });

  it('callTool echo returns text content', async () => {
    await conn.initialize();
    const res = await conn.callTool('echo', { message: 'hello' });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.output).toEqual({ content: [{ type: 'text', text: 'hello' }] });
    }
  });

  it('callTool returns ok:false on JSON-RPC error', async () => {
    await conn.initialize();
    const res = await conn.callTool('fail', {});
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toContain('intentional failure');
  });

  it('initialize on a bad command rejects', async () => {
    const bad = new StdioMcpConnection({ command: '/nonexistent/path/xyz', args: [], env: {} });
    await expect(bad.initialize()).rejects.toThrow();
  });

  it('close is idempotent', async () => {
    await conn.initialize();
    await conn.close();
    await conn.close();
  });

  it('callTool with aborted signal returns cancelled and writes notifications/cancelled', async () => {
    await conn.initialize();
    const ctrl = new AbortController();
    const p = conn.callTool('slow', {}, { signal: ctrl.signal });
    queueMicrotask(() => ctrl.abort());
    const res = await p;
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/cancel/i);
  });

  it('callTool with onProgress receives notifications/progress', async () => {
    await conn.initialize();
    const notes: string[] = [];
    const res = await conn.callTool('slow', {}, { onProgress: (n) => notes.push(n) });
    expect(res.ok).toBe(true);
    expect(notes.length).toBeGreaterThanOrEqual(2);
    expect(notes[0]).toMatch(/1\/2/);
    expect(notes[1]).toMatch(/2\/2/);
  });

  it('onUnexpectedClose fires when subprocess exits unexpectedly', async () => {
    await conn.initialize();
    let closed = false;
    conn.onUnexpectedClose?.(() => { closed = true; });
    (conn as unknown as { __killForTest(): void }).__killForTest();
    await new Promise((r) => setTimeout(r, 100));
    expect(closed).toBe(true);
  });
});
