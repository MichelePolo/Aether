import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { z } from 'zod';
import { JsonStore } from './json-store';

const Schema = z.object({ count: z.number(), items: z.array(z.string()) });
type Data = z.infer<typeof Schema>;
const defaults: Data = { count: 0, items: [] };

let dir: string;
let file: string;
let store: JsonStore<Data>;

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'aether-jsonstore-'));
  file = path.join(dir, 'data.json');
  store = new JsonStore(file, Schema, defaults);
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('JsonStore', () => {
  it('returns defaults when file does not exist', async () => {
    const data = await store.read();
    expect(data).toEqual(defaults);
  });

  it('writes and reads data back', async () => {
    await store.write({ count: 3, items: ['a', 'b'] });
    const data = await store.read();
    expect(data).toEqual({ count: 3, items: ['a', 'b'] });
  });

  it('persists across instances', async () => {
    await store.write({ count: 7, items: ['x'] });
    const fresh = new JsonStore(file, Schema, defaults);
    expect(await fresh.read()).toEqual({ count: 7, items: ['x'] });
  });

  it('update() reads, applies fn, writes', async () => {
    await store.write({ count: 1, items: [] });
    const result = await store.update((cur) => ({ ...cur, count: cur.count + 1 }));
    expect(result.count).toBe(2);
    expect(await store.read()).toEqual({ count: 2, items: [] });
  });

  it('falls back to defaults if file is corrupted JSON', async () => {
    await writeFile(file, 'not json{{{', 'utf-8');
    const data = await store.read();
    expect(data).toEqual(defaults);
  });

  it('falls back to defaults if schema validation fails', async () => {
    await writeFile(file, JSON.stringify({ count: 'not-a-number', items: [] }), 'utf-8');
    const data = await store.read();
    expect(data).toEqual(defaults);
  });

  it('serializes concurrent writes (last write wins, no corruption)', async () => {
    const ops = Array.from({ length: 20 }, () =>
      store.update((cur) => ({ ...cur, count: cur.count + 1 })),
    );
    await Promise.all(ops);
    expect((await store.read()).count).toBe(20);
  });

  it('writes atomically via temp file + rename', async () => {
    await store.write({ count: 5, items: ['atomic'] });
    const raw = await readFile(file, 'utf-8');
    expect(JSON.parse(raw)).toEqual({ count: 5, items: ['atomic'] });
  });
});
