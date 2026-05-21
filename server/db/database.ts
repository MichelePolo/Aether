import Database from 'better-sqlite3';

export type DatabaseHandle = Database.Database;

/**
 * Open a SQLite database file, apply Aether's standard pragmas, and return
 * the handle. Caller owns the lifecycle (must call .close() in tests).
 *
 * Pragmas:
 *  - journal_mode = WAL: concurrent reads + serialized writes via a write-ahead log
 *  - foreign_keys = ON:  SQLite ships with FK enforcement off by default
 *  - synchronous = NORMAL: durable under WAL; faster than FULL
 */
export function openDatabase(filePath: string): DatabaseHandle {
  const db = new Database(filePath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('synchronous = NORMAL');
  return db;
}
