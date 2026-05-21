import { join } from 'node:path';
import Database from 'better-sqlite3';
import { applyMigrations } from '@/server/db/migrate';
import type { DatabaseHandle } from '@/server/db/database';

const MIGRATIONS_DIR = join(__dirname, '..', 'db', 'migrations');

/**
 * Open an in-memory SQLite database with Aether's pragmas + full schema
 * applied. Each call returns a fresh, isolated handle. Caller must .close().
 */
export function makeTestDb(): DatabaseHandle {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  applyMigrations(db, MIGRATIONS_DIR);
  return db;
}
