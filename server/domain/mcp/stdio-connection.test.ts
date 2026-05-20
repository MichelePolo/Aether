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

  it('initialize + listTools returns echo', async () => {
    await conn.initialize();
    const tools = await conn.listTools();
    expect(tools.map((t) => t.name)).toEqual(['echo']);
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
});
