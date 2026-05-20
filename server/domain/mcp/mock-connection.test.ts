import { describe, it, expect } from 'vitest';
import { MockMcpConnection } from './mock-connection';

describe('MockMcpConnection', () => {
  it('defaults autoApprove to true', () => {
    expect(new MockMcpConnection().defaultAutoApprove).toBe(true);
  });

  it('initialize is a no-op (idempotent)', async () => {
    const c = new MockMcpConnection();
    await c.initialize();
    await c.initialize();
  });

  it('listTools returns echo + current_time + read_file_mock', async () => {
    const c = new MockMcpConnection();
    const tools = await c.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(['current_time', 'echo', 'read_file_mock']);
  });

  it('echo returns the input message', async () => {
    const c = new MockMcpConnection();
    expect(await c.callTool('echo', { message: 'hi' })).toEqual({ ok: true, output: { message: 'hi' } });
  });

  it('current_time returns iso + unix', async () => {
    const c = new MockMcpConnection();
    const res = await c.callTool('current_time', {});
    expect(res.ok).toBe(true);
    if (res.ok) {
      const out = res.output as { iso: string; unix: number };
      expect(typeof out.iso).toBe('string');
      expect(typeof out.unix).toBe('number');
    }
  });

  it('read_file_mock echoes back synthetic content', async () => {
    const c = new MockMcpConnection();
    const res = await c.callTool('read_file_mock', { path: '/foo.txt' });
    expect(res).toEqual({ ok: true, output: { content: 'mocked content of /foo.txt' } });
  });

  it('unknown tool returns ok:false', async () => {
    const c = new MockMcpConnection();
    const res = await c.callTool('nope', {});
    expect(res.ok).toBe(false);
  });

  it('close is a no-op (idempotent)', async () => {
    const c = new MockMcpConnection();
    await c.close();
    await c.close();
  });
});
