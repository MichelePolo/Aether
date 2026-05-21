import { describe, it, expect, beforeEach } from 'vitest';
import { ContextStore } from '@/server/domain/context/context.store';
import { makeTestDb } from '@/server/test/test-db';
import { McpRegistry } from './registry';

function newCtx(): ContextStore {
  return new ContextStore(makeTestDb());
}

describe('McpRegistry', () => {
  let ctx: ContextStore;
  let reg: McpRegistry;
  beforeEach(async () => {
    ctx = newCtx();
    reg = new McpRegistry(ctx);
    await ctx.bulkOverwrite({
      systemInstruction: '',
      skills: [],
      tools: [],
      mcpServers: [
        { id: 'M1', name: 'mock', transport: 'mock', status: 'offline' },
      ],
    });
  });

  it('connect returns tools and transitions to online', async () => {
    const r = await reg.connect('M1');
    expect(r.tools.map((t) => t.name).sort()).toEqual(['current_time', 'echo', 'read_file_mock']);
    expect(reg.stateOf('M1').state).toBe('online');
  });

  it('listLiveTools returns namespaced names', async () => {
    await reg.connect('M1');
    const tools = reg.listLiveTools();
    expect(tools.map((t) => t.qualifiedName).sort()).toEqual([
      'mock.current_time', 'mock.echo', 'mock.read_file_mock',
    ]);
  });

  it('callTool routes by namespace', async () => {
    await reg.connect('M1');
    const res = await reg.callTool('mock.echo', { message: 'hi' });
    expect(res).toEqual({ ok: true, output: { message: 'hi' } });
  });

  it('callTool offline returns ok:false', async () => {
    const res = await reg.callTool('mock.echo', {});
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/offline/i);
  });

  it('policy: built-in mock default autoApprove true', async () => {
    await reg.connect('M1');
    expect(reg.policy('mock.echo')).toEqual({ autoApprove: true });
  });

  it('policy: persisted user override wins', async () => {
    await ctx.bulkOverwrite({
      systemInstruction: '',
      skills: [],
      tools: [],
      mcpServers: [
        { id: 'M1', name: 'mock', transport: 'mock', status: 'offline',
          toolPolicies: { echo: { autoApprove: false } } },
      ],
    });
    await reg.connect('M1');
    expect(reg.policy('mock.echo')).toEqual({ autoApprove: false });
  });

  it('disconnect transitions to offline; listLiveTools empties', async () => {
    await reg.connect('M1');
    await reg.disconnect('M1');
    expect(reg.stateOf('M1').state).toBe('offline');
    expect(reg.listLiveTools()).toEqual([]);
  });

  it('awaitDecision resolves when resolveDecision called', async () => {
    const p = reg.awaitDecision('CALL1', 1000);
    reg.resolveDecision('CALL1', 'approve');
    await expect(p).resolves.toBe('approve');
  });

  it('awaitDecision rejects on timeout', async () => {
    await expect(reg.awaitDecision('CALL2', 20)).rejects.toThrow(/timeout/i);
  });

  it('setToolPolicy persists to context.mcpServers[].toolPolicies', async () => {
    await reg.setToolPolicy('M1', 'echo', { autoApprove: false });
    const after = await ctx.read();
    expect(after.mcpServers[0].toolPolicies).toEqual({ echo: { autoApprove: false } });
  });

  it('refreshTools updates the live entry', async () => {
    await reg.connect('M1');
    const before = reg.listLiveTools().length;
    expect(before).toBe(3);
    const tools = await reg.refreshTools('M1');
    expect(tools.length).toBe(3);
  });

  it('refreshTools on disconnected server throws', async () => {
    await expect(reg.refreshTools('M1')).rejects.toThrow();
  });

  it('listLiveTools after refresh reflects mock tools unchanged', async () => {
    await reg.connect('M1');
    await reg.refreshTools('M1');
    expect(reg.listLiveTools().map((t) => t.tool.name).sort()).toEqual([
      'current_time', 'echo', 'read_file_mock',
    ]);
  });

  it('callTool forwards opts.signal to the connection', async () => {
    await reg.connect('M1');
    const ctrl = new AbortController();
    ctrl.abort();
    const res = await reg.callTool('mock.echo', { message: 'hi' }, { signal: ctrl.signal });
    expect(res).toEqual({ ok: false, error: 'Cancelled by user' });
  });

  it('passes onProgress through callTool (mock ignores; assert no throw)', async () => {
    await reg.connect('M1');
    const notes: string[] = [];
    const res = await reg.callTool('mock.echo', { message: 'hi' }, { onProgress: (n) => notes.push(n) });
    expect(res.ok).toBe(true);
    expect(notes).toEqual([]);
  });

  it('cancelToolCall is idempotent (no-op when controller missing)', () => {
    expect(() => reg.cancelToolCall?.('nonexistent')).not.toThrow();
  });

  it('auto-reconnect: triggers reconnecting state and returns to online', async () => {
    await reg.connect('M1');
    const promise = (reg as unknown as { __forceReconnectForTest(id: string): Promise<void> }).__forceReconnectForTest('M1');
    await promise;
    expect(reg.stateOf('M1').state).toBe('online');
  }, 10_000);
});
