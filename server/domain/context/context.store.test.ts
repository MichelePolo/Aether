import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ContextStore, defaultContext, DEFAULT_SYSTEM_INSTRUCTION } from './context.store';
import { makeTestDb } from '@/server/test/test-db';
import type { DatabaseHandle } from '@/server/db/database';

let db: DatabaseHandle;
let store: ContextStore;

beforeEach(() => {
  db = makeTestDb();
  store = new ContextStore(db);
});

afterEach(() => {
  db.close();
});

describe('ContextStore', () => {
  it('read() returns the default context on a fresh DB', async () => {
    const ctx = await store.read();
    expect(ctx).toEqual(defaultContext);
  });

  it('default system instruction is the official Aether prompt', async () => {
    const ctx = await store.read();
    expect(ctx.systemInstruction).toBe(DEFAULT_SYSTEM_INSTRUCTION);
    // Provider-agnostic: never names a vendor.
    expect(DEFAULT_SYSTEM_INSTRUCTION).not.toMatch(/claude|anthropic|openai|gemini|ollama/i);
    // Key section markers from the approved design.
    for (const marker of ['You are Aether', '# Voice', '# Transparency', '# Tools, agents, and skills', '# Safety', '# Workspaces']) {
      expect(DEFAULT_SYSTEM_INSTRUCTION).toContain(marker);
    }
  });

  it('default system instruction documents the multi-workspace model', async () => {
    // The runtime injects the registered roots under this exact header, so the
    // base prompt must teach the model how to read it (current marked first).
    expect(DEFAULT_SYSTEM_INSTRUCTION).toContain('# availableWorkspaces');
    expect(DEFAULT_SYSTEM_INSTRUCTION).toMatch(/-> current/);
  });

  it('applies a patch (partial update)', async () => {
    await store.patch({ systemInstruction: 'You are Aether.' });
    const ctx = await store.read();
    expect(ctx.systemInstruction).toBe('You are Aether.');
    expect(ctx.skills).toEqual(defaultContext.skills);
  });

  it('patch() merges and persists', async () => {
    await store.patch({ systemInstruction: 'You are Aether v2' });
    const ctx = await store.read();
    expect(ctx.systemInstruction).toBe('You are Aether v2');
    expect(ctx.skills).toEqual([]);
  });

  it('addSkill appends to skills', async () => {
    await store.addSkill('AnalysisV2');
    expect((await store.read()).skills).toContainEqual({ name: 'AnalysisV2', enabled: true });
  });

  it('addSkill rejects empty string', async () => {
    await expect(store.addSkill('  ')).rejects.toThrow();
  });

  it('addSkill rejects empty / whitespace', async () => {
    await expect(store.addSkill('   ')).rejects.toThrow();
  });

  it('updateSkillAt replaces by index', async () => {
    await store.patch({ skills: [{ name: 'a', enabled: true }, { name: 'b', enabled: true }, { name: 'c', enabled: true }] });
    await store.updateSkillAt(1, 'B');
    expect((await store.read()).skills).toEqual([
      { name: 'a', enabled: true },
      { name: 'B', enabled: true },
      { name: 'c', enabled: true },
    ]);
  });

  it('updateSkillAt throws on out-of-bounds', async () => {
    await store.patch({ skills: [{ name: 'a', enabled: true }] });
    await expect(store.updateSkillAt(5, 'x')).rejects.toThrow();
  });

  it('updateSkillAt rejects out-of-range index', async () => {
    await expect(store.updateSkillAt(0, 'x')).rejects.toThrow();
  });

  it('removeSkillAt removes by index', async () => {
    await store.patch({ skills: [{ name: 'a', enabled: true }, { name: 'b', enabled: true }, { name: 'c', enabled: true }] });
    await store.removeSkillAt(1);
    expect((await store.read()).skills).toEqual([
      { name: 'a', enabled: true },
      { name: 'c', enabled: true },
    ]);
  });

  it('removeSkillAt throws on out-of-bounds index', async () => {
    await store.patch({ skills: [{ name: 'a', enabled: true }] });
    await expect(store.removeSkillAt(5)).rejects.toThrow();
    await expect(store.removeSkillAt(-1)).rejects.toThrow();
  });

  it('updateSkillAt rejects empty value', async () => {
    await store.patch({ skills: [{ name: 'a', enabled: true }] });
    await expect(store.updateSkillAt(0, '   ')).rejects.toThrow();
  });

  it('addSkill / updateSkillAt / removeSkillAt preserve order', async () => {
    await store.addSkill('one');
    await store.addSkill('two');
    await store.addSkill('three');
    await store.updateSkillAt(1, 'TWO');
    await store.removeSkillAt(0);
    const ctx = await store.read();
    expect(ctx.skills).toEqual([
      { name: 'TWO', enabled: true },
      { name: 'three', enabled: true },
    ]);
  });

  it('updateTool throws on unknown id', async () => {
    await expect(store.updateTool('nope', { name: 'X' })).rejects.toThrow();
  });

  it('updateTool rejects invalid patch shape', async () => {
    const tool = await store.addTool({ name: 'X', version: '1.0', status: 'online' });
    await expect(
      store.updateTool(tool.id, { status: 'weird' as 'online' }),
    ).rejects.toThrow();
  });

  it('removeTool throws on unknown id', async () => {
    await expect(store.removeTool('missing')).rejects.toThrow();
  });

  it('removeMcpServer throws on unknown id', async () => {
    await expect(store.removeMcpServer('missing')).rejects.toThrow();
  });

  it('addTool rejects invalid shape', async () => {
    await expect(
      store.addTool({ name: 'X', version: '1.0', status: 'bogus' as 'online' }),
    ).rejects.toThrow();
  });

  it('addMcpServer rejects invalid shape', async () => {
    await expect(
      store.addMcpServer({ name: 'M', url: 'u', status: 'bogus' as 'online' }),
    ).rejects.toThrow();
  });

  it('addTool generates id and appends', async () => {
    const tool = await store.addTool({ name: 'Search', version: '1.0.0', status: 'online' });
    expect(tool.id).toMatch(/.+/);
    const ctx = await store.read();
    expect(ctx.tools).toContainEqual(tool);
  });

  it('addTool returns the new tool with a generated id', async () => {
    const t = await store.addTool({ name: 'Google', version: '1', status: 'online' });
    expect(t.id).toBeTruthy();
    expect(t.name).toBe('Google');
    const ctx = await store.read();
    expect(ctx.tools).toHaveLength(1);
    expect(ctx.tools[0].id).toBe(t.id);
  });

  it('updateTool by id replaces fields', async () => {
    const tool = await store.addTool({ name: 'Search', version: '1.0.0', status: 'online' });
    await store.updateTool(tool.id, { version: '2.0.0' });
    const updated = (await store.read()).tools.find((t) => t.id === tool.id);
    expect(updated?.version).toBe('2.0.0');
    expect(updated?.name).toBe('Search');
  });

  it('updateTool merges patch + validates', async () => {
    const t = await store.addTool({ name: 'A', version: '1', status: 'online' });
    await store.updateTool(t.id, { version: '2', status: 'offline' });
    const ctx = await store.read();
    expect(ctx.tools[0]).toEqual({ id: t.id, name: 'A', version: '2', status: 'offline' });
  });

  it('removeTool by id', async () => {
    const tool = await store.addTool({ name: 'X', version: '1.0', status: 'offline' });
    await store.removeTool(tool.id);
    expect((await store.read()).tools.find((t) => t.id === tool.id)).toBeUndefined();
  });

  it('removeTool removes the right entry; missing id throws', async () => {
    const t = await store.addTool({ name: 'A', version: '1', status: 'online' });
    await store.removeTool(t.id);
    expect((await store.read()).tools).toEqual([]);
    await expect(store.removeTool('nope')).rejects.toThrow();
  });

  it('addMcpServer generates id', async () => {
    const s = await store.addMcpServer({ name: 'mock', url: 'http://x', status: 'connecting' });
    expect(s.id).toMatch(/.+/);
  });

  it('removeMcpServer by id', async () => {
    const s = await store.addMcpServer({ name: 'mock', url: 'http://x', status: 'online' });
    await store.removeMcpServer(s.id);
    expect((await store.read()).mcpServers).toHaveLength(0);
  });

  it('addMcpServer round-trips command/args/env and stored on read', async () => {
    const srv = await store.addMcpServer({
      name: 'fs',
      transport: 'stdio',
      command: 'npx',
      args: ['@modelcontextprotocol/server-filesystem', '/tmp'],
      env: { FOO: 'bar' },
      status: 'offline',
    });
    const ctx = await store.read();
    expect(ctx.mcpServers).toHaveLength(1);
    expect(ctx.mcpServers[0]).toEqual({
      id: srv.id,
      name: 'fs',
      transport: 'stdio',
      command: 'npx',
      args: ['@modelcontextprotocol/server-filesystem', '/tmp'],
      env: { FOO: 'bar' },
      status: 'offline',
    });
  });

  it('addMcpServer with toolPolicies round-trips', async () => {
    await store.bulkOverwrite({
      systemInstruction: '',
      skills: [],
      tools: [],
      mcpServers: [{
        id: 'M1',
        name: 'mock',
        transport: 'mock',
        status: 'offline',
        toolPolicies: { echo: { autoApprove: true }, fail: { autoApprove: false } },
      }],
    });
    const ctx = await store.read();
    expect(ctx.mcpServers[0].toolPolicies).toEqual({
      echo: { autoApprove: true },
      fail: { autoApprove: false },
    });
  });

  it('removeMcpServer cascades to tool policies', async () => {
    await store.bulkOverwrite({
      systemInstruction: '',
      skills: [],
      tools: [],
      mcpServers: [{
        id: 'M1',
        name: 'mock',
        transport: 'mock',
        status: 'offline',
        toolPolicies: { echo: { autoApprove: true } },
      }],
    });
    await store.removeMcpServer('M1');
    const policies = db
      .prepare('SELECT COUNT(*) AS n FROM context_mcp_tool_policies')
      .get() as { n: number };
    expect(policies.n).toBe(0);
  });

  it('bulkOverwrite validates and replaces all fields', async () => {
    const next = {
      systemInstruction: 'Hi',
      skills: [{ name: 's1', enabled: true }],
      tools: [{ id: 't1', name: 'T', version: '1.0', status: 'online' as const }],
      mcpServers: [],
    };
    await store.bulkOverwrite(next);
    const ctx = await store.read();
    expect(ctx.systemInstruction).toBe('Hi');
    expect(ctx.skills).toEqual([{ name: 's1', enabled: true }]);
    expect(ctx.tools).toEqual(next.tools);
  });

  it('bulkOverwrite() replaces everything atomically', async () => {
    await store.bulkOverwrite({
      systemInstruction: 'new',
      skills: [{ name: 'a', enabled: true }, { name: 'b', enabled: true }],
      tools: [{ id: 't1', name: 'X', version: '1.0', status: 'online' }],
      mcpServers: [],
    });
    const ctx = await store.read();
    expect(ctx.systemInstruction).toBe('new');
    expect(ctx.skills).toEqual([{ name: 'a', enabled: true }, { name: 'b', enabled: true }]);
    expect(ctx.tools).toEqual([{ id: 't1', name: 'X', version: '1.0', status: 'online' }]);
  });

  it('bulkOverwrite rejects invalid shape', async () => {
    await expect(store.bulkOverwrite({ systemInstruction: 1 } as never)).rejects.toThrow();
  });

  it('patch rejects an invalid partial instead of writing it raw', async () => {
    await expect(store.patch({ systemInstruction: 1 } as never)).rejects.toThrow();
  });

  it('bulkOverwrite() rejects invalid payloads', async () => {
    await expect(
      store.bulkOverwrite({
        systemInstruction: 'x',
        skills: [{ name: 'a', enabled: true }],
        tools: [{ id: 't1', name: 'X', version: '1', status: 'busy' as 'online' }],
        mcpServers: [],
      }),
    ).rejects.toThrow();
  });

  it('persists across instances', async () => {
    await store.addSkill('persisted');
    const fresh = new ContextStore(db);
    expect((await fresh.read()).skills).toContainEqual({ name: 'persisted', enabled: true });
  });
});

describe('ContextStore skill enabled flag', () => {
  it('adds skills enabled by default and toggles them', async () => {
    const store = new ContextStore(makeTestDb());
    await store.addSkill('web-search');
    let ctx = await store.read();
    expect(ctx.skills).toEqual([{ name: 'web-search', enabled: true }]);

    await store.setSkillEnabledAt(0, false);
    ctx = await store.read();
    expect(ctx.skills[0]).toEqual({ name: 'web-search', enabled: false });
  });

  it('throws for an out-of-range toggle index', async () => {
    const store = new ContextStore(makeTestDb());
    await expect(store.setSkillEnabledAt(5, true)).rejects.toThrow();
  });
});
