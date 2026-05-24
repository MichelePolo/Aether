import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import Database from 'better-sqlite3';
import { applyMigrations } from './migrate';

let dir: string;
let db: ReturnType<typeof Database>;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'aether-migrate-'));
  db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
});

afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

function writeMigration(filename: string, sql: string): void {
  writeFileSync(join(dir, filename), sql);
}

describe('applyMigrations', () => {
  it('creates _migrations table and applies all files on empty DB', () => {
    writeMigration('001_a.sql', 'CREATE TABLE a (id INTEGER);');
    writeMigration('002_b.sql', 'CREATE TABLE b (id INTEGER);');

    const result = applyMigrations(db, dir);

    expect(result.applied).toEqual([1, 2]);
    const tables = (db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all() as { name: string }[]).map((r) => r.name);
    expect(tables).toContain('_migrations');
    expect(tables).toContain('a');
    expect(tables).toContain('b');
    const versions = (db.prepare('SELECT version FROM _migrations ORDER BY version').all() as { version: number }[]).map((r) => r.version);
    expect(versions).toEqual([1, 2]);
  });

  it('is idempotent: second run applies nothing', () => {
    writeMigration('001_a.sql', 'CREATE TABLE a (id INTEGER);');
    applyMigrations(db, dir);
    const second = applyMigrations(db, dir);
    expect(second.applied).toEqual([]);
  });

  it('rolls back a failing migration so its version is NOT recorded', () => {
    writeMigration('001_ok.sql', 'CREATE TABLE ok (id INTEGER);');
    writeMigration('002_bad.sql', 'CREATE TABLE bad (id INTEGER); INSERT INTO bad VALUES (1); SELECT broken_function();');

    expect(() => applyMigrations(db, dir)).toThrow();

    const versions = (db.prepare('SELECT version FROM _migrations ORDER BY version').all() as { version: number }[]).map((r) => r.version);
    expect(versions).toEqual([1]); // 001 applied; 002 rolled back
    const tables = (db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name = 'bad'").all() as unknown[]).length;
    expect(tables).toBe(0); // 002 created `bad` but transaction rolled back
  });

  it('orders migrations numerically, not lexically', () => {
    writeMigration('002_b.sql', 'CREATE TABLE b (id INTEGER);');
    writeMigration('010_j.sql', 'CREATE TABLE j (id INTEGER);');
    writeMigration('001_a.sql', 'CREATE TABLE a (id INTEGER);');

    const result = applyMigrations(db, dir);

    expect(result.applied).toEqual([1, 2, 10]);
  });

  it('ignores files that do not match NNN_*.sql', () => {
    writeMigration('001_a.sql', 'CREATE TABLE a (id INTEGER);');
    writeMigration('README.md', 'not a migration');
    writeMigration('rollback.sql', 'not a migration');

    const result = applyMigrations(db, dir);
    expect(result.applied).toEqual([1]);
  });

  it('handles multi-statement files (the real schema is ~16 CREATE TABLEs)', () => {
    writeMigration(
      '001_multi.sql',
      `
      CREATE TABLE a (id INTEGER);
      CREATE TABLE b (id INTEGER);
      CREATE INDEX idx_b_id ON b(id);
      `,
    );
    const result = applyMigrations(db, dir);
    expect(result.applied).toEqual([1]);
    const tables = (db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name IN ('a','b')").all() as unknown[]).length;
    expect(tables).toBe(2);
  });

  it('applying real migrations 001+002 creates messages_fts and records both versions', async () => {
    const { makeTestDb } = await import('@/server/test/test-db');
    const fullDb = makeTestDb();
    try {
      const tables = (fullDb
        .prepare("SELECT name FROM sqlite_master WHERE name = 'messages_fts'")
        .all() as { name: string }[]).map((r) => r.name);
      expect(tables).toEqual(['messages_fts']);

      const versions = (fullDb
        .prepare('SELECT version FROM _migrations ORDER BY version')
        .all() as { version: number }[]).map((r) => r.version);
      expect(versions).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    } finally {
      fullDb.close();
    }
  });
});
