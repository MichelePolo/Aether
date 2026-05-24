import { randomUUID } from 'node:crypto';
import type { DatabaseHandle } from '@/server/db/database';
import { ValidationError } from '@/server/lib/errors';
import type { Workspace } from './workspaces.types';

interface Row {
  id: string;
  name: string;
  root_path: string;
  added_at: number;
}

function rowToWorkspace(r: Row): Workspace {
  return { id: r.id, name: r.name, rootPath: r.root_path, addedAt: r.added_at };
}

export class WorkspacesStore {
  constructor(private readonly db: DatabaseHandle) {}

  list(): Workspace[] {
    const rows = this.db
      .prepare('SELECT id, name, root_path, added_at FROM workspaces ORDER BY added_at ASC')
      .all() as Row[];
    return rows.map(rowToWorkspace);
  }

  get(id: string): Workspace | undefined {
    const row = this.db
      .prepare('SELECT id, name, root_path, added_at FROM workspaces WHERE id = ?')
      .get(id) as Row | undefined;
    return row ? rowToWorkspace(row) : undefined;
  }

  create(input: { name: string; rootPath: string }): Workspace {
    const id = randomUUID();
    const addedAt = Date.now();
    try {
      this.db
        .prepare('INSERT INTO workspaces (id, name, root_path, added_at) VALUES (?, ?, ?, ?)')
        .run(id, input.name, input.rootPath, addedAt);
    } catch (e: unknown) {
      const msg = (e as { message?: string }).message ?? '';
      if (msg.includes('UNIQUE constraint failed')) {
        throw new ValidationError(`Workspace already exists for path: ${input.rootPath}`);
      }
      throw e;
    }
    return { id, name: input.name, rootPath: input.rootPath, addedAt };
  }

  rename(id: string, name: string): void {
    this.db.prepare('UPDATE workspaces SET name = ? WHERE id = ?').run(name, id);
  }

  delete(id: string): void {
    this.db.prepare('DELETE FROM workspaces WHERE id = ?').run(id);
  }
}
