import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { makeTestDb } from '@/server/test/test-db';
import { BuiltinMcpStore } from './builtin.store';
import type { DatabaseHandle } from '@/server/db/database';

let db: DatabaseHandle;
let store: BuiltinMcpStore;

beforeEach(() => {
  db = makeTestDb();
  store = new BuiltinMcpStore(db);
});

afterEach(() => db.close());

describe('BuiltinMcpStore', () => {
  it('read() returns 2 pre-seeded rows, both disabled', () => {
    const rows = store.read();
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.transport).sort()).toEqual(['filesystem', 'terminal']);
    expect(rows.every((r) => r.enabled === false)).toBe(true);
    expect(rows.every((r) => r.fsRoot === null)).toBe(true);
  });

  it('setEnabled flips the flag', () => {
    store.setEnabled('filesystem', true);
    const fs = store.read().find((r) => r.transport === 'filesystem')!;
    expect(fs.enabled).toBe(true);
  });

  it('setFsRoot persists path; null reverts', () => {
    store.setFsRoot('filesystem', '/tmp');
    expect(store.read().find((r) => r.transport === 'filesystem')!.fsRoot).toBe('/tmp');
    store.setFsRoot('filesystem', null);
    expect(store.read().find((r) => r.transport === 'filesystem')!.fsRoot).toBeNull();
  });

  it('toConfigs() returns only enabled rows', () => {
    expect(store.toConfigs('/cwd')).toEqual([]);
    store.setEnabled('filesystem', true);
    const configs = store.toConfigs('/cwd');
    expect(configs).toHaveLength(1);
    expect(configs[0].id).toBe('builtin:filesystem');
  });

  it('toConfigs() resolves fsRoot ?? defaultCwd', () => {
    store.setEnabled('filesystem', true);
    let configs = store.toConfigs('/default');
    expect(configs[0].args).toContain('/default');
    store.setFsRoot('filesystem', '/custom');
    configs = store.toConfigs('/default');
    expect(configs[0].args).toContain('/custom');
    expect(configs[0].args).not.toContain('/default');
  });

  it('toConfigs() for terminal omits fsRoot', () => {
    store.setEnabled('terminal', true);
    const configs = store.toConfigs('/default');
    expect(configs).toHaveLength(1);
    expect(configs[0].id).toBe('builtin:terminal');
    expect(configs[0].args).not.toContain('/default');
  });
});
