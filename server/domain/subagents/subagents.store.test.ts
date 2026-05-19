import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { SubAgentsStore } from './subagents.store';

function newStore(): SubAgentsStore {
  const dir = mkdtempSync(path.join(tmpdir(), 'aether-sa-'));
  return new SubAgentsStore(path.join(dir, 'subagents.json'));
}

describe('SubAgentsStore', () => {
  let store: SubAgentsStore;
  beforeEach(() => {
    store = newStore();
  });

  it('list returns empty initially', async () => {
    expect(await store.list()).toEqual([]);
  });

  it('create + read round-trip', async () => {
    const meta = await store.create({ name: 'designer', systemInstruction: 'You design.' });
    expect(meta.name).toBe('designer');
    expect(meta.id).toBeTruthy();
    const rec = await store.read(meta.id);
    expect(rec).not.toBeNull();
    expect(rec!.name).toBe('designer');
    expect(rec!.systemInstruction).toBe('You design.');
    expect(rec!.skills).toEqual([]);
    expect(rec!.tools).toEqual([]);
  });

  it('create with colliding name suffixes (2)', async () => {
    await store.create({ name: 'designer' });
    const second = await store.create({ name: 'designer' });
    expect(second.name).toBe('designer (2)');
  });

  it('update changes value and bumps updatedAt', async () => {
    const created = await store.create({ name: 'd' });
    const before = (await store.read(created.id))!.updatedAt;
    await new Promise((r) => setTimeout(r, 10));
    await store.update(created.id, { systemInstruction: 'new' });
    const after = (await store.read(created.id))!.updatedAt;
    expect(after).toBeGreaterThan(before);
    expect((await store.read(created.id))!.systemInstruction).toBe('new');
  });

  it('delete removes the record', async () => {
    const meta = await store.create({ name: 'd' });
    await store.delete(meta.id);
    expect(await store.read(meta.id)).toBeNull();
  });

  it('list sorts by updatedAt desc', async () => {
    const a = await store.create({ name: 'a' });
    await new Promise((r) => setTimeout(r, 5));
    const b = await store.create({ name: 'b' });
    const list = await store.list();
    expect(list[0].id).toBe(b.id);
    expect(list[1].id).toBe(a.id);
  });
});
