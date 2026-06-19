import { randomUUID } from 'node:crypto';
import { NotFoundError } from '@/server/lib/errors';
import type { DatabaseHandle } from '@/server/db/database';
import type { SwarmMeta, SwarmRecord, SwarmStep } from './swarm.types';

interface SwarmInput {
  name: string;
  workspaceId?: string;
  steps?: SwarmStep[];
}

/** Full swarm row including workspace_id, used by read() and create(). */
type SwarmRow = { id: string; name: string; workspace_id: string | null; created_at: number; updated_at: number };
/** Partial row fetched by list() and metaOf() (no workspace_id in SELECT). */
type SwarmMetaRow = { id: string; name: string; created_at: number; updated_at: number };
type StepRow = { position: number; subagent_name: string; prompt_template: string; pause_after: number; provider_name: string | null; workspace_id: string | null };

export class SwarmStore {
  constructor(private readonly db: DatabaseHandle) {}

  async list(): Promise<SwarmMeta[]> {
    const rows = this.db
      .prepare('SELECT id, name, created_at, updated_at FROM swarms ORDER BY updated_at DESC')
      .all() as SwarmMetaRow[];
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      stepCount: (
        this.db.prepare('SELECT COUNT(*) AS n FROM swarm_steps WHERE swarm_id = ?').get(r.id) as { n: number }
      ).n,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    }));
  }

  async read(id: string): Promise<SwarmRecord | null> {
    const row = this.db
      .prepare('SELECT id, name, workspace_id, created_at, updated_at FROM swarms WHERE id = ?')
      .get(id) as SwarmRow | undefined;
    if (!row) return null;
    const steps = (
      this.db
        .prepare(
          'SELECT position, subagent_name, prompt_template, pause_after, provider_name, workspace_id FROM swarm_steps WHERE swarm_id = ? ORDER BY position',
        )
        .all(id) as StepRow[]
    ).map((s): SwarmStep => ({
      subAgentName: s.subagent_name,
      promptTemplate: s.prompt_template,
      pauseAfter: s.pause_after === 1,
      ...(s.provider_name ? { providerName: s.provider_name } : {}),
      ...(s.workspace_id ? { workspaceId: s.workspace_id } : {}),
    }));
    return {
      id: row.id,
      name: row.name,
      ...(row.workspace_id ? { workspaceId: row.workspace_id } : {}),
      steps,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  async create(input: SwarmInput): Promise<SwarmMeta> {
    const id = randomUUID();
    const now = Date.now();
    const tx = this.db.transaction(() => {
      this.db
        .prepare('INSERT INTO swarms (id, name, workspace_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?)')
        .run(id, input.name, input.workspaceId ?? null, now, now);
      this.writeSteps(id, input.steps ?? []);
    });
    tx();
    return this.metaOf(id);
  }

  async update(id: string, patch: { name?: string; workspaceId?: string | null; steps?: SwarmStep[] }): Promise<SwarmMeta> {
    const tx = this.db.transaction(() => {
      const cur = this.db.prepare('SELECT name, workspace_id FROM swarms WHERE id = ?').get(id) as { name: string; workspace_id: string | null } | undefined;
      if (!cur) throw new NotFoundError(`swarm ${id}`);
      const now = Date.now();
      // null = explicit clear; undefined = leave unchanged; string = set to new value.
      const newWorkspaceId = patch.workspaceId !== undefined ? (patch.workspaceId ?? null) : cur.workspace_id;
      this.db
        .prepare('UPDATE swarms SET name = ?, workspace_id = ?, updated_at = ? WHERE id = ?')
        .run(patch.name ?? cur.name, newWorkspaceId, now, id);
      if (patch.steps) this.writeSteps(id, patch.steps);
    });
    tx();
    return this.metaOf(id);
  }

  async delete(id: string): Promise<void> {
    const info = this.db.prepare('DELETE FROM swarms WHERE id = ?').run(id);
    if (info.changes === 0) throw new NotFoundError(`swarm ${id}`);
  }

  private metaOf(id: string): SwarmMeta {
    const row = this.db
      .prepare('SELECT id, name, created_at, updated_at FROM swarms WHERE id = ?')
      .get(id) as SwarmMetaRow;
    const n = (
      this.db.prepare('SELECT COUNT(*) AS n FROM swarm_steps WHERE swarm_id = ?').get(id) as { n: number }
    ).n;
    return { id: row.id, name: row.name, stepCount: n, createdAt: row.created_at, updatedAt: row.updated_at };
  }

  private writeSteps(id: string, steps: SwarmStep[]): void {
    this.db.prepare('DELETE FROM swarm_steps WHERE swarm_id = ?').run(id);
    const insert = this.db.prepare(
      'INSERT INTO swarm_steps (id, swarm_id, position, subagent_name, prompt_template, pause_after, provider_name, workspace_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    );
    steps.forEach((s, i) =>
      insert.run(randomUUID(), id, i, s.subAgentName, s.promptTemplate ?? '', s.pauseAfter ? 1 : 0, s.providerName ?? null, s.workspaceId ?? null),
    );
  }
}
