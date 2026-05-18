import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ContextStore, defaultContext } from './context.store';

let dir: string;
let store: ContextStore;

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'aether-ctx-'));
  store = new ContextStore(path.join(dir, 'context.json'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('ContextStore', () => {
  it('returns default context when file missing', async () => {
    expect(await store.read()).toEqual(defaultContext);
  });

  it('applies a patch (partial update)', async () => {
    await store.patch({ systemInstruction: 'You are Aether.' });
    const ctx = await store.read();
    expect(ctx.systemInstruction).toBe('You are Aether.');
    expect(ctx.skills).toEqual(defaultContext.skills);
  });

  it('addSkill appends to skills', async () => {
    await store.addSkill('AnalysisV2');
    expect((await store.read()).skills).toContain('AnalysisV2');
  });

  it('addSkill rejects empty string', async () => {
    await expect(store.addSkill('  ')).rejects.toThrow();
  });

  it('updateSkillAt replaces by index', async () => {
    await store.patch({ skills: ['a', 'b', 'c'] });
    await store.updateSkillAt(1, 'B');
    expect((await store.read()).skills).toEqual(['a', 'B', 'c']);
  });

  it('updateSkillAt throws on out-of-bounds', async () => {
    await store.patch({ skills: ['a'] });
    await expect(store.updateSkillAt(5, 'x')).rejects.toThrow();
  });

  it('removeSkillAt removes by index', async () => {
    await store.patch({ skills: ['a', 'b', 'c'] });
    await store.removeSkillAt(1);
    expect((await store.read()).skills).toEqual(['a', 'c']);
  });

  it('removeSkillAt throws on out-of-bounds index', async () => {
    await store.patch({ skills: ['a'] });
    await expect(store.removeSkillAt(5)).rejects.toThrow();
    await expect(store.removeSkillAt(-1)).rejects.toThrow();
  });

  it('updateSkillAt rejects empty value', async () => {
    await store.patch({ skills: ['a'] });
    await expect(store.updateSkillAt(0, '   ')).rejects.toThrow();
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

  it('updateTool by id replaces fields', async () => {
    const tool = await store.addTool({ name: 'Search', version: '1.0.0', status: 'online' });
    await store.updateTool(tool.id, { version: '2.0.0' });
    const updated = (await store.read()).tools.find((t) => t.id === tool.id);
    expect(updated?.version).toBe('2.0.0');
    expect(updated?.name).toBe('Search');
  });

  it('removeTool by id', async () => {
    const tool = await store.addTool({ name: 'X', version: '1.0', status: 'offline' });
    await store.removeTool(tool.id);
    expect((await store.read()).tools.find((t) => t.id === tool.id)).toBeUndefined();
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

  it('bulkOverwrite validates and replaces all fields', async () => {
    const next = {
      systemInstruction: 'Hi',
      skills: ['s1'],
      tools: [{ id: 't1', name: 'T', version: '1.0', status: 'online' as const }],
      mcpServers: [],
    };
    await store.bulkOverwrite(next);
    expect(await store.read()).toEqual(next);
  });

  it('bulkOverwrite rejects invalid shape', async () => {
    await expect(store.bulkOverwrite({ systemInstruction: 1 } as never)).rejects.toThrow();
  });

  it('persists across instances', async () => {
    await store.addSkill('persisted');
    const fresh = new ContextStore(path.join(dir, 'context.json'));
    expect((await fresh.read()).skills).toContain('persisted');
  });
});
