import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import Database from 'better-sqlite3';

export type DatabaseHandle = Database.Database;

/**
 * Open a SQLite database file, apply Aether's standard pragmas, and return
 * the handle. Caller owns the lifecycle (must call .close() in tests).
 *
 * Ensures the parent directory exists first (better-sqlite3 does not create
 * it; the previous JSON-file stores created parent dirs lazily).
 *
 * Pragmas:
 *  - journal_mode = WAL: concurrent reads + serialized writes via a write-ahead log
 *  - foreign_keys = ON:  SQLite ships with FK enforcement off by default
 *  - synchronous = NORMAL: durable under WAL; faster than FULL
 *
 * The `:memory:` sentinel skips the mkdir.
 */
export function openDatabase(filePath: string): DatabaseHandle {
  if (filePath !== ':memory:') {
    mkdirSync(dirname(filePath), { recursive: true });
  }
  const db = new Database(filePath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('synchronous = NORMAL');
  return db;
}
