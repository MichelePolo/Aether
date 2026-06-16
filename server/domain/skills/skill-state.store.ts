import type { DatabaseHandle } from '@/server/db/database';
import type { SkillStateRow } from './skills.types';

interface Row {
  slug: string;
  enabled: number;
  pinned: number;
}

/** Persists the enabled/pinned toggle state of material (filesystem) skills. */
export class SkillStateStore {
  constructor(private readonly db: DatabaseHandle) {}

  get(slug: string): SkillStateRow {
    const row = this.db
      .prepare('SELECT slug, enabled, pinned FROM skill_state WHERE slug = ?')
      .get(slug) as Row | undefined;
    if (!row) return { slug, enabled: false, pinned: false };
    return { slug, enabled: row.enabled === 1, pinned: row.pinned === 1 };
  }

  readAll(): Map<string, SkillStateRow> {
    const rows = this.db.prepare('SELECT slug, enabled, pinned FROM skill_state').all() as Row[];
    const map = new Map<string, SkillStateRow>();
    for (const r of rows) {
      map.set(r.slug, { slug: r.slug, enabled: r.enabled === 1, pinned: r.pinned === 1 });
    }
    return map;
  }

  setEnabled(slug: string, enabled: boolean): void {
    this.upsert(slug, { enabled });
  }

  setPinned(slug: string, pinned: boolean): void {
    this.upsert(slug, { pinned });
  }

  remove(slug: string): void {
    this.db.prepare('DELETE FROM skill_state WHERE slug = ?').run(slug);
  }

  private upsert(slug: string, patch: { enabled?: boolean; pinned?: boolean }): void {
    const cur = this.get(slug);
    const enabled = patch.enabled ?? cur.enabled;
    const pinned = patch.pinned ?? cur.pinned;
    this.db
      .prepare(
        `INSERT INTO skill_state (slug, enabled, pinned) VALUES (?, ?, ?)
         ON CONFLICT(slug) DO UPDATE SET enabled = excluded.enabled, pinned = excluded.pinned`,
      )
      .run(slug, enabled ? 1 : 0, pinned ? 1 : 0);
  }
}
