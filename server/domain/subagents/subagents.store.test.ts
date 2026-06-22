import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SubAgentsStore } from './subagents.store';
import { SubAgentUpdateInputSchema } from './subagents.schema';
import { makeTestDb } from '@/server/test/test-db';
import type { DatabaseHandle } from '@/server/db/database';

let db: DatabaseHandle;
let store: SubAgentsStore;

beforeEach(() => {
  db = makeTestDb();
  store = new SubAgentsStore(db);
});

afterEach(() => {
  db.close();
});

describe('SubAgentsStore', () => {
  it('list() returns [] on a fresh DB', async () => {
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

  it('create() inserts with defaults', async () => {
    const meta = await store.create({ name: 'designer' });
    expect(meta.name).toBe('designer');
    const rec = await store.read(meta.id);
    expect(rec).toEqual({
      name: 'designer',
      systemInstruction: '',
      skills: [],
      tools: [],
      createdAt: meta.createdAt,
      updatedAt: meta.updatedAt,
    });
  });

  it('create() generates a unique name when colliding (starts at suffix 2)', async () => {
    await store.create({ name: 'designer' });
    const second = await store.create({ name: 'designer' });
    expect(second.name).toBe('designer (2)');
  });

  it('create() persists skills + tools', async () => {
    const meta = await store.create({
      name: 'sculptor',
      skills: ['clay', 'kiln'],
      tools: [{ id: 'ignored', name: 'X', version: '1', status: 'online' }],
    });
    const rec = await store.read(meta.id);
    expect(rec!.skills).toEqual(['clay', 'kiln']);
    expect(rec!.tools).toHaveLength(1);
    expect(rec!.tools[0].name).toBe('X');
    expect(rec!.tools[0].version).toBe('1');
    expect(rec!.tools[0].status).toBe('online');
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

  it('update() merges name + systemInstruction without touching skills', async () => {
    const meta = await store.create({ name: 'a', skills: ['s1'] });
    await new Promise((r) => setTimeout(r, 5));
    const updated = await store.update(meta.id, { name: 'b', systemInstruction: 'sys' });
    expect(updated.name).toBe('b');
    expect(updated.updatedAt).toBeGreaterThan(meta.updatedAt);
    const rec = await store.read(meta.id);
    expect(rec!.skills).toEqual(['s1']); // untouched
    expect(rec!.systemInstruction).toBe('sys');
  });

  it('update() through the update schema (model only) preserves systemInstruction, skills, tools', async () => {
    const meta = await store.create({
      name: 'sm',
      systemInstruction: 'KEEP ME',
      skills: ['s1'],
      tools: [{ id: 'x', name: 'X', version: '1', status: 'online' }],
    });
    // Mirror the route: a partial PATCH carrying only `model` runs through the schema.
    const patch = SubAgentUpdateInputSchema.parse({ model: 'anthropic:claude-opus-4-8' });
    await store.update(meta.id, patch);
    const rec = await store.read(meta.id);
    expect(rec!.systemInstruction).toBe('KEEP ME');
    expect(rec!.skills).toEqual(['s1']);
    expect(rec!.tools.map((t) => t.name)).toEqual(['X']);
    expect(rec!.model).toBe('anthropic:claude-opus-4-8');
  });

  it('update() replaces skills atomically when provided', async () => {
    const meta = await store.create({ name: 'a', skills: ['s1', 's2'] });
    await store.update(meta.id, { skills: ['only'] });
    const rec = await store.read(meta.id);
    expect(rec!.skills).toEqual(['only']);
  });

  it('delete removes the record', async () => {
    const meta = await store.create({ name: 'd' });
    await store.delete(meta.id);
    expect(await store.read(meta.id)).toBeNull();
  });

  it('delete() cascades to subagent_skills + subagent_tools', async () => {
    const meta = await store.create({
      name: 'a',
      skills: ['s1'],
      tools: [{ id: 'x', name: 'X', version: '1', status: 'online' }],
    });
    await store.delete(meta.id);
    expect(
      (db.prepare('SELECT COUNT(*) AS n FROM subagent_skills').get() as { n: number }).n,
    ).toBe(0);
    expect(
      (db.prepare('SELECT COUNT(*) AS n FROM subagent_tools').get() as { n: number }).n,
    ).toBe(0);
  });

  it('list() sorts by updated_at DESC', async () => {
    const a = await store.create({ name: 'A' });
    await new Promise((r) => setTimeout(r, 5));
    const b = await store.create({ name: 'B' });
    const list = await store.list();
    expect(list[0].id).toBe(b.id);
    expect(list[1].id).toBe(a.id);
  });

  it('delete() throws on unknown id', async () => {
    await expect(store.delete('nope')).rejects.toThrow();
  });

  it('read() returns null for unknown id', async () => {
    expect(await store.read('nope')).toBeNull();
  });

  it('round-trips a sub-agent model and exposes it via list()', async () => {
    const meta = await store.create({ name: 'planner', model: 'gemini:gemini-1.5-pro' });
    expect(meta.model).toBe('gemini:gemini-1.5-pro');

    const rec = await store.read(meta.id);
    expect(rec?.model).toBe('gemini:gemini-1.5-pro');

    const listed = (await store.list()).find((m) => m.id === meta.id);
    expect(listed?.model).toBe('gemini:gemini-1.5-pro');

    const noModel = await store.create({ name: 'plain' });
    expect((await store.read(noModel.id))?.model).toBeUndefined();
  });

  it('create() stores empty string model as NULL (no model)', async () => {
    const meta = await store.create({ name: 'no-model', model: '' });
    expect(meta.model).toBeUndefined();
    const rec = await store.read(meta.id);
    expect(rec?.model).toBeUndefined();
  });

  it('update() with model="" clears a previously-saved model', async () => {
    const meta = await store.create({ name: 'agent', model: 'gemini:gemini-1.5-pro' });
    expect(meta.model).toBe('gemini:gemini-1.5-pro');

    await store.update(meta.id, { model: '' });
    const rec = await store.read(meta.id);
    expect(rec?.model).toBeUndefined();

    const listed = (await store.list()).find((m) => m.id === meta.id);
    expect(listed?.model).toBeUndefined();

    // Assert raw DB column is SQL NULL (not empty string)
    const raw = db.prepare('SELECT model FROM subagents WHERE id = ?').get(meta.id) as { model: string | null };
    expect(raw.model).toBeNull();
  });

  it('update() without model field preserves the existing model', async () => {
    const meta = await store.create({ name: 'keeper', model: 'gemini:gemini-1.5-pro' });
    await store.update(meta.id, { systemInstruction: 'updated' });
    const rec = await store.read(meta.id);
    expect(rec?.model).toBe('gemini:gemini-1.5-pro');
    expect(rec?.systemInstruction).toBe('updated');
  });
});
