import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { DatabaseHandle } from './database';

const MIGRATIONS_TABLE_DDL =
  'CREATE TABLE IF NOT EXISTS _migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)';

const FILE_RE = /^(\d+)_.+\.sql$/;

export interface MigrationResult {
  applied: number[];
}

function splitSqlStatements(sql: string): string[] {
  // Strip line comments (-- ...), then split on ';' boundaries and trim.
  // The migration files we author do not contain semicolons inside string
  // literals, so a naive split is safe and avoids pulling in a SQL parser.
  const cleaned = sql
    .split('\n')
    .map((line) => {
      const idx = line.indexOf('--');
      return idx === -1 ? line : line.slice(0, idx);
    })
    .join('\n');
  return cleaned
    .split(';')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/**
 * Apply all unapplied .sql files in `migrationsDir` to `db`, in numeric order.
 * Each file runs inside a transaction; on failure the transaction rolls back
 * and the version is NOT recorded.
 *
 * The `_migrations` table is created here (CREATE IF NOT EXISTS) before any
 * product migration runs, so migration 001 may assume it already exists.
 */
export function applyMigrations(db: DatabaseHandle, migrationsDir: string): MigrationResult {
  db.prepare(MIGRATIONS_TABLE_DDL).run();

  const allFiles = readdirSync(migrationsDir)
    .filter((f) => FILE_RE.test(f))
    .map((f) => {
      const match = f.match(FILE_RE)!;
      return { version: Number(match[1]), file: f };
    })
    .sort((a, b) => a.version - b.version);

  const appliedRows = db
    .prepare('SELECT version FROM _migrations')
    .all() as { version: number }[];
  const appliedSet = new Set(appliedRows.map((r) => r.version));

  const newlyApplied: number[] = [];

  for (const { version, file } of allFiles) {
    if (appliedSet.has(version)) continue;
    const sql = readFileSync(join(migrationsDir, file), 'utf-8');
    const statements = splitSqlStatements(sql);
    const tx = db.transaction(() => {
      for (const stmt of statements) {
        db.prepare(stmt).run();
      }
      db.prepare('INSERT INTO _migrations (version, applied_at) VALUES (?, ?)').run(
        version,
        new Date().toISOString(),
      );
    });
    tx();
    newlyApplied.push(version);
  }

  return { applied: newlyApplied };
}
