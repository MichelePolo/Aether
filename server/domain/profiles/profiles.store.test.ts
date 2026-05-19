import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ProfilesStore } from './profiles.store';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const validContext = {
  systemInstruction: 'sys',
  skills: [],
  tools: [],
  mcpServers: [],
};

let dir: string;
let store: ProfilesStore;
let filePath: string;

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'aether-profiles-'));
  filePath = path.join(dir, 'profiles.json');
  store = new ProfilesStore(filePath);
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('ProfilesStore', () => {
  it('listProfiles returns [] on empty file', async () => {
    expect(await store.listProfiles()).toEqual([]);
  });

  it('create generates UUID + createdAt/updatedAt = now', async () => {
    const meta = await store.create({ name: 'A', context: validContext, thinkingEnabled: false });
    expect(meta.id).toMatch(UUID_RE);
    expect(meta.name).toBe('A');
    expect(typeof meta.createdAt).toBe('number');
    expect(meta.updatedAt).toBe(meta.createdAt);
  });

  it('read returns the full record', async () => {
    const meta = await store.create({ name: 'A', context: validContext, thinkingEnabled: true });
    const rec = await store.read(meta.id);
    expect(rec).toMatchObject({ name: 'A', context: validContext, thinkingEnabled: true });
  });

  it('read returns null for unknown id', async () => {
    expect(await store.read('nope')).toBeNull();
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

  it('create suffixes name on collision: (1), (2), ...', async () => {
    const a = await store.create({ name: 'X', context: validContext, thinkingEnabled: false });
    const b = await store.create({ name: 'X', context: validContext, thinkingEnabled: false });
    const c = await store.create({ name: 'X', context: validContext, thinkingEnabled: false });
    expect(a.name).toBe('X');
    expect(b.name).toBe('X (1)');
    expect(c.name).toBe('X (2)');
  });

  it('update bumps updatedAt and patches fields', async () => {
    const meta = await store.create({ name: 'A', context: validContext, thinkingEnabled: false });
    await new Promise((r) => setTimeout(r, 5));
    const updated = await store.update(meta.id, { thinkingEnabled: true });
    expect(updated.updatedAt).toBeGreaterThan(meta.updatedAt);
    const rec = await store.read(meta.id);
    expect(rec?.thinkingEnabled).toBe(true);
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

  it('delete removes the profile; throws NotFound on missing', async () => {
    const meta = await store.create({ name: 'A', context: validContext, thinkingEnabled: false });
    await store.delete(meta.id);
    expect(await store.read(meta.id)).toBeNull();
    await expect(store.delete(meta.id)).rejects.toThrow();
  });

  it('persists across instances (file-backed)', async () => {
    const meta = await store.create({ name: 'A', context: validContext, thinkingEnabled: true });
    const store2 = new ProfilesStore(filePath);
    const rec = await store2.read(meta.id);
    expect(rec).toMatchObject({ name: 'A', thinkingEnabled: true });
  });
});
