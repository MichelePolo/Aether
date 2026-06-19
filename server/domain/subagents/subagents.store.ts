import { randomUUID } from 'node:crypto';
import { NotFoundError } from '@/server/lib/errors';
import type { SubAgentMeta, SubAgentRecord } from './subagents.types';
import type { Tool } from '@/server/domain/context/context.types';
import type { DatabaseHandle } from '@/server/db/database';

interface CreateInput {
  name: string;
  systemInstruction?: string;
  skills?: string[];
  tools?: Tool[];
  model?: string;
}

type SubAgentRow = {
  id: string;
  name: string;
  system_instruction: string;
  model: string | null;
  created_at: number;
  updated_at: number;
};

type SubAgentToolRow = {
  position: number;
  name: string;
  version: string;
  status: string;
};

export class SubAgentsStore {
  constructor(private readonly db: DatabaseHandle) {}

  async list(): Promise<SubAgentMeta[]> {
    const rows = this.db
      .prepare('SELECT id, name, model, created_at, updated_at FROM subagents ORDER BY updated_at DESC')
      .all() as { id: string; name: string; model: string | null; created_at: number; updated_at: number }[];
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      ...(r.model ? { model: r.model } : {}),
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    }));
  }

  async read(id: string): Promise<SubAgentRecord | null> {
    const row = this.db
      .prepare(
        'SELECT id, name, system_instruction, model, created_at, updated_at FROM subagents WHERE id = ?',
      )
      .get(id) as SubAgentRow | undefined;
    if (!row) return null;

    const skills = (
      this.db
        .prepare('SELECT name FROM subagent_skills WHERE subagent_id = ? ORDER BY position')
        .all(id) as { name: string }[]
    ).map((r) => r.name);

    const tools = (
      this.db
        .prepare(
          'SELECT position, name, version, status FROM subagent_tools WHERE subagent_id = ? ORDER BY position',
        )
        .all(id) as SubAgentToolRow[]
    ).map(
      (t, i): Tool => ({
        id: `${id}-${i}`,
        name: t.name,
        version: t.version,
        status: t.status as 'online' | 'offline',
      }),
    );

    return {
      name: row.name,
      systemInstruction: row.system_instruction,
      skills,
      tools,
      ...(row.model ? { model: row.model } : {}),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  async create(input: CreateInput): Promise<SubAgentMeta> {
    const id = randomUUID();
    const now = Date.now();
    const tx = this.db.transaction(() => {
      const uniqueName = this.findUniqueName(input.name);
      this.db
        .prepare(
          'INSERT INTO subagents (id, name, system_instruction, model, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
        )
        .run(id, uniqueName, input.systemInstruction ?? '', input.model ? input.model : null, now, now);
      this.writeChildren(id, input.skills ?? [], input.tools ?? []);
    });
    tx();
    return this.metaOf(id);
  }

  async update(
    id: string,
    patch: Partial<Omit<SubAgentRecord, 'createdAt'>>,
  ): Promise<SubAgentMeta> {
    const tx = this.db.transaction(() => {
      const exists = this.db.prepare('SELECT id FROM subagents WHERE id = ?').get(id);
      if (!exists) throw new NotFoundError(`subagent ${id}`);
      const now = Date.now();

      const cur = this.db
        .prepare('SELECT name, system_instruction, model FROM subagents WHERE id = ?')
        .get(id) as { name: string; system_instruction: string; model: string | null };

      this.db
        .prepare(
          'UPDATE subagents SET name = ?, system_instruction = ?, model = ?, updated_at = ? WHERE id = ?',
        )
        .run(
          patch.name ?? cur.name,
          patch.systemInstruction ?? cur.system_instruction,
          patch.model !== undefined ? (patch.model || null) : cur.model,
          now,
          id,
        );

      if (patch.skills || patch.tools) {
        const existingSkills = (
          this.db
            .prepare('SELECT name FROM subagent_skills WHERE subagent_id = ? ORDER BY position')
            .all(id) as { name: string }[]
        ).map((r) => r.name);
        const existingTools = (
          this.db
            .prepare(
              'SELECT name, version, status FROM subagent_tools WHERE subagent_id = ? ORDER BY position',
            )
            .all(id) as { name: string; version: string; status: string }[]
        ).map((t, i): Tool => ({
          id: `${id}-${i}`,
          name: t.name,
          version: t.version,
          status: t.status as 'online' | 'offline',
        }));
        const nextSkills = patch.skills ?? existingSkills;
        const nextTools = patch.tools ?? existingTools;
        this.writeChildren(id, nextSkills, nextTools);
      }
    });
    tx();
    return this.metaOf(id);
  }

  async delete(id: string): Promise<void> {
    const info = this.db.prepare('DELETE FROM subagents WHERE id = ?').run(id);
    if (info.changes === 0) throw new NotFoundError(`subagent ${id}`);
  }

  // ---- private helpers ----

  private metaOf(id: string): SubAgentMeta {
    const row = this.db
      .prepare('SELECT id, name, model, created_at, updated_at FROM subagents WHERE id = ?')
      .get(id) as { id: string; name: string; model: string | null; created_at: number; updated_at: number };
    return {
      id: row.id,
      name: row.name,
      ...(row.model ? { model: row.model } : {}),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  private findUniqueName(desired: string): string {
    const existing = new Set(
      (this.db.prepare('SELECT name FROM subagents').all() as { name: string }[]).map((r) => r.name),
    );
    if (!existing.has(desired)) return desired;
    let n = 2;
    while (existing.has(`${desired} (${n})`)) n++;
    return `${desired} (${n})`;
  }

  private writeChildren(id: string, skills: string[], tools: Tool[]): void {
    this.db.prepare('DELETE FROM subagent_skills WHERE subagent_id = ?').run(id);
    const insertSkill = this.db.prepare(
      'INSERT INTO subagent_skills (subagent_id, position, name) VALUES (?, ?, ?)',
    );
    skills.forEach((s, i) => insertSkill.run(id, i, s));

    this.db.prepare('DELETE FROM subagent_tools WHERE subagent_id = ?').run(id);
    const insertTool = this.db.prepare(
      'INSERT INTO subagent_tools (subagent_id, position, name, version, status) VALUES (?, ?, ?, ?, ?)',
    );
    tools.forEach((t, i) => insertTool.run(id, i, t.name, t.version, t.status));
  }
}
