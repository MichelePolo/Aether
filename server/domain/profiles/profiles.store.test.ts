import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ProfilesStore } from './profiles.store';
import { makeTestDb } from '@/server/test/test-db';
import type { DatabaseHandle } from '@/server/db/database';
import type { AetherContext } from '@/server/domain/context/context.types';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const validContext: AetherContext = {
  systemInstruction: 'sys',
  skills: [],
  tools: [],
  mcpServers: [],
};

const richContext: AetherContext = {
  systemInstruction: 'You are Aether',
  skills: [{ name: 's1', enabled: true }, { name: 's2', enabled: true }],
  tools: [{ id: 't1', name: 'X', version: '1', status: 'online' }],
  mcpServers: [
    {
      id: 'M1',
      name: 'mock',
      transport: 'mock',
      status: 'offline',
      toolPolicies: { echo: { autoApprove: true } },
    },
  ],
};

let db: DatabaseHandle;
let store: ProfilesStore;

beforeEach(() => {
  db = makeTestDb();
  store = new ProfilesStore(db);
});

afterEach(() => {
  db.close();
});

describe('ProfilesStore', () => {
  it('listProfiles returns [] on a fresh DB', async () => {
    expect(await store.listProfiles()).toEqual([]);
  });

  it('create generates UUID + createdAt/updatedAt = now', async () => {
    const meta = await store.create({ name: 'A', context: validContext, thinkingEnabled: false });
    expect(meta.id).toMatch(UUID_RE);
    expect(meta.name).toBe('A');
    expect(typeof meta.createdAt).toBe('number');
    expect(meta.updatedAt).toBe(meta.createdAt);
  });

  it('create() inserts a profile and returns its meta', async () => {
    const meta = await store.create({ name: 'p1', context: richContext, thinkingEnabled: true });
    expect(meta.name).toBe('p1');
    expect(meta.id).toBeTruthy();
  });

  it('read returns the full record', async () => {
    const meta = await store.create({ name: 'A', context: validContext, thinkingEnabled: true });
    const rec = await store.read(meta.id);
    expect(rec).toMatchObject({ name: 'A', context: validContext, thinkingEnabled: true });
  });

  it('read returns null for unknown id', async () => {
    expect(await store.read('nope')).toBeNull();
  });

  it('read() round-trips the full context including skills, tools, mcp servers, policies', async () => {
    const meta = await store.create({ name: 'p1', context: richContext, thinkingEnabled: true });
    const rec = await store.read(meta.id);
    expect(rec).not.toBeNull();
    expect(rec!.thinkingEnabled).toBe(true);
    expect(rec!.context.skills).toEqual([{ name: 's1', enabled: true }, { name: 's2', enabled: true }]);
    expect(rec!.context.tools).toEqual([{ id: 't1', name: 'X', version: '1', status: 'online' }]);
    expect(rec!.context.mcpServers[0].toolPolicies).toEqual({ echo: { autoApprove: true } });
  });

  it('listProfiles orders by updatedAt desc', async () => {
    const a = await store.create({ name: 'A', context: validContext, thinkingEnabled: false });
    await new Promise((r) => setTimeout(r, 5));
    const b = await store.create({ name: 'B', context: validContext, thinkingEnabled: false });
    await new Promise((r) => setTimeout(r, 5));
    // touch A by update
    await store.update(a.id, { name: 'A2' });
    const list = await store.listProfiles();
    expect(list[0].id).toBe(a.id); // updated last
    expect(list[1].id).toBe(b.id);
  });

  it('listProfiles() sorts by updated_at DESC for newly created profiles', async () => {
    const a = await store.create({ name: 'A', context: validContext, thinkingEnabled: false });
    await new Promise((r) => setTimeout(r, 5));
    const b = await store.create({ name: 'B', context: validContext, thinkingEnabled: false });
    const list = await store.listProfiles();
    expect(list[0].id).toBe(b.id);
    expect(list[1].id).toBe(a.id);
  });

  it('create suffixes name on collision: (1), (2), ...', async () => {
    const a = await store.create({ name: 'X', context: validContext, thinkingEnabled: false });
    const b = await store.create({ name: 'X', context: validContext, thinkingEnabled: false });
    const c = await store.create({ name: 'X', context: validContext, thinkingEnabled: false });
    expect(a.name).toBe('X');
    expect(b.name).toBe('X (1)');
    expect(c.name).toBe('X (2)');
  });

  it('create() rejects empty/oversized names', async () => {
    await expect(
      store.create({ name: '', context: validContext, thinkingEnabled: false }),
    ).rejects.toThrow();
    await expect(
      store.create({ name: 'x'.repeat(101), context: validContext, thinkingEnabled: false }),
    ).rejects.toThrow();
  });

  it('update bumps updatedAt and patches fields', async () => {
    const meta = await store.create({ name: 'A', context: validContext, thinkingEnabled: false });
    await new Promise((r) => setTimeout(r, 5));
    const updated = await store.update(meta.id, { thinkingEnabled: true });
    expect(updated.updatedAt).toBeGreaterThan(meta.updatedAt);
    const rec = await store.read(meta.id);
    expect(rec?.thinkingEnabled).toBe(true);
  });

  it('update() merges patch and bumps updatedAt (name + thinkingEnabled)', async () => {
    const meta = await store.create({ name: 'p1', context: validContext, thinkingEnabled: false });
    await new Promise((r) => setTimeout(r, 5));
    const updated = await store.update(meta.id, { name: 'renamed', thinkingEnabled: true });
    expect(updated.name).toBe('renamed');
    expect(updated.updatedAt).toBeGreaterThan(meta.updatedAt);
    const rec = await store.read(meta.id);
    expect(rec!.thinkingEnabled).toBe(true);
  });

  it('update() with new context replaces all child rows atomically', async () => {
    const meta = await store.create({ name: 'p1', context: richContext, thinkingEnabled: false });
    const newCtx: AetherContext = {
      systemInstruction: 'replaced',
      skills: [{ name: 'only', enabled: true }],
      tools: [],
      mcpServers: [],
    };
    await store.update(meta.id, { context: newCtx });
    const rec = await store.read(meta.id);
    expect(rec!.context.systemInstruction).toBe('replaced');
    expect(rec!.context.skills).toEqual([{ name: 'only', enabled: true }]);
    expect(rec!.context.tools).toEqual([]);
    expect(rec!.context.mcpServers).toEqual([]);
  });

  it('update throws NotFound for missing id', async () => {
    await expect(store.update('nope', { name: 'x' })).rejects.toThrow();
  });

  it('update rejects empty name', async () => {
    const meta = await store.create({ name: 'A', context: validContext, thinkingEnabled: false });
    await expect(store.update(meta.id, { name: '' })).rejects.toThrow();
    await expect(store.update(meta.id, { name: '   ' })).rejects.toThrow();
  });

  it('update rejects name > 100 chars', async () => {
    const meta = await store.create({ name: 'A', context: validContext, thinkingEnabled: false });
    await expect(store.update(meta.id, { name: 'a'.repeat(101) })).rejects.toThrow();
  });

  it('rename is shortcut to update({name})', async () => {
    const meta = await store.create({ name: 'A', context: validContext, thinkingEnabled: false });
    const renamed = await store.rename(meta.id, 'B');
    expect(renamed.name).toBe('B');
  });

  it('rename() rejects unknown id', async () => {
    await expect(store.rename('nope', 'x')).rejects.toThrow();
  });

  it('delete removes the profile; throws NotFound on missing', async () => {
    const meta = await store.create({ name: 'A', context: validContext, thinkingEnabled: false });
    await store.delete(meta.id);
    expect(await store.read(meta.id)).toBeNull();
    await expect(store.delete(meta.id)).rejects.toThrow();
  });

  it('delete() cascades to all child tables', async () => {
    const meta = await store.create({ name: 'p1', context: richContext, thinkingEnabled: false });
    await store.delete(meta.id);
    expect(
      (db.prepare('SELECT COUNT(*) AS n FROM profile_skills').get() as { n: number }).n,
    ).toBe(0);
    expect(
      (db.prepare('SELECT COUNT(*) AS n FROM profile_tools').get() as { n: number }).n,
    ).toBe(0);
    expect(
      (db.prepare('SELECT COUNT(*) AS n FROM profile_mcp_servers').get() as { n: number }).n,
    ).toBe(0);
    expect(
      (db.prepare('SELECT COUNT(*) AS n FROM profile_mcp_tool_policies').get() as { n: number }).n,
    ).toBe(0);
  });

  it('persists across store instances on the same DB handle', async () => {
    const meta = await store.create({ name: 'A', context: validContext, thinkingEnabled: true });
    const store2 = new ProfilesStore(db);
    const rec = await store2.read(meta.id);
    expect(rec).toMatchObject({ name: 'A', thinkingEnabled: true });
  });
});

describe('ProfilesStore skills shape', () => {
  it('round-trips context skills as enabled Skill objects', async () => {
    const created = await store.create({
      name: 'p1',
      context: {
        systemInstruction: 's',
        skills: [{ name: 'web-search', enabled: true }],
        tools: [],
        mcpServers: [],
      },
      thinkingEnabled: false,
    });
    const read = await store.read(created.id);
    expect(read?.context.skills).toEqual([{ name: 'web-search', enabled: true }]);
  });
});
