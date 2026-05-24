import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { applyMigrations } from '@/server/db/migrate';
import { BreakpointPolicyStore } from './policy.store';

let dbDir: string;
let db: ReturnType<typeof Database>;

beforeEach(() => {
  dbDir = mkdtempSync(join(tmpdir(), 'aether-bp-'));
  mkdirSync(join(dbDir, 'migrations'), { recursive: true });
  const sql = `
    CREATE TABLE breakpoint_policy (
      category TEXT PRIMARY KEY CHECK (category IN ('safe','dangerous','external')),
      mode TEXT NOT NULL CHECK (mode IN ('auto','gate'))
    );
    INSERT INTO breakpoint_policy (category, mode) VALUES ('safe', 'auto');
    INSERT INTO breakpoint_policy (category, mode) VALUES ('dangerous', 'gate');
    INSERT INTO breakpoint_policy (category, mode) VALUES ('external', 'gate');
  `;
  writeFileSync(join(dbDir, 'migrations', '001_bp.sql'), sql);
  db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  applyMigrations(db, join(dbDir, 'migrations'));
});

afterEach(() => {
  db.close();
  rmSync(dbDir, { recursive: true, force: true });
});

describe('BreakpointPolicyStore', () => {
  it('reads the three seeded rows with default modes', () => {
    const store = new BreakpointPolicyStore(db);
    expect(store.read()).toEqual({ safe: 'auto', dangerous: 'gate', external: 'gate' });
  });

  it('setCategory updates one row and read reflects it', () => {
    const store = new BreakpointPolicyStore(db);
    store.setCategory('dangerous', 'auto');
    expect(store.read()).toEqual({ safe: 'auto', dangerous: 'auto', external: 'gate' });
  });

  it('setCategory persists across new store instances on the same db', () => {
    const a = new BreakpointPolicyStore(db);
    a.setCategory('external', 'auto');
    const b = new BreakpointPolicyStore(db);
    expect(b.read().external).toBe('auto');
  });
});
