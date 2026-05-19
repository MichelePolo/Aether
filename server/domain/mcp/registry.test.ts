import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ContextStore } from '@/server/domain/context/context.store';
import { McpRegistry } from './registry';

function newCtx(): ContextStore {
  const dir = mkdtempSync(path.join(tmpdir(), 'aether-mcp-'));
  return new ContextStore(path.join(dir, 'context.json'));
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
});
