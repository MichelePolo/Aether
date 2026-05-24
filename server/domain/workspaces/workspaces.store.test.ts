import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { applyMigrations } from '@/server/db/migrate';
import { WorkspacesStore } from './workspaces.store';

let dir: string;
let db: ReturnType<typeof Database>;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'aether-ws-'));
  mkdirSync(join(dir, 'migrations'), { recursive: true });
  const sql = `
    CREATE TABLE sessions (id TEXT PRIMARY KEY);
    CREATE TABLE workspaces (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      root_path TEXT NOT NULL,
      added_at INTEGER NOT NULL
    );
    CREATE UNIQUE INDEX idx_workspaces_root_path ON workspaces(root_path);
    ALTER TABLE sessions ADD COLUMN workspace_id TEXT
      REFERENCES workspaces(id) ON DELETE SET NULL;
  `;
  writeFileSync(join(dir, 'migrations', '001_ws.sql'), sql);
  db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  applyMigrations(db, join(dir, 'migrations'));
});

afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

describe('WorkspacesStore', () => {
  it('create() persists a workspace and returns it', () => {
    const store = new WorkspacesStore(db);
    const w = store.create({ name: 'proj', rootPath: dir });
    expect(w.name).toBe('proj');
    expect(w.rootPath).toBe(dir);
    expect(typeof w.id).toBe('string');
    expect(typeof w.addedAt).toBe('number');
  });

  it('list() returns all workspaces sorted by addedAt', () => {
    const store = new WorkspacesStore(db);
    const a = store.create({ name: 'a', rootPath: dir + '/a-' + Date.now() });
    const b = store.create({ name: 'b', rootPath: dir + '/b-' + Date.now() });
    const list = store.list();
    expect(list.map((w) => w.id)).toEqual([a.id, b.id]);
  });

  it('rename() updates the name', () => {
    const store = new WorkspacesStore(db);
    const w = store.create({ name: 'old', rootPath: dir });
    store.rename(w.id, 'new');
    expect(store.get(w.id)?.name).toBe('new');
  });

  it('delete() removes the workspace and SET NULLs sessions.workspace_id', () => {
    const store = new WorkspacesStore(db);
    const w = store.create({ name: 'a', rootPath: dir });
    db.prepare('INSERT INTO sessions (id, workspace_id) VALUES (?, ?)').run('s1', w.id);
    store.delete(w.id);
    expect(store.get(w.id)).toBeUndefined();
    const row = db.prepare('SELECT workspace_id FROM sessions WHERE id = ?').get('s1') as { workspace_id: string | null };
    expect(row.workspace_id).toBeNull();
  });

  it('create() with duplicate rootPath throws a clean error', () => {
    const store = new WorkspacesStore(db);
    store.create({ name: 'a', rootPath: dir });
    expect(() => store.create({ name: 'b', rootPath: dir })).toThrow(/already/i);
  });

  it('get() returns undefined for unknown id', () => {
    const store = new WorkspacesStore(db);
    expect(store.get('nope')).toBeUndefined();
  });
});
