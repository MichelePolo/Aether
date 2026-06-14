import { randomUUID } from 'node:crypto';
import type { DatabaseHandle } from '@/server/db/database';
import type {
  Cadence, Schedule, ScheduleInput, ScheduleRun, RunStatus, Target,
} from './schedules.types';

interface Row {
  id: string; name: string; cadence_json: string; target_json: string;
  autonomy: string; provider_name: string | null; workspace_id: string | null;
  enabled: number; next_run_at: number | null; last_run_at: number | null;
  created_at: number; updated_at: number;
}
interface RunRow {
  id: string; schedule_id: string; session_id: string | null;
  started_at: number; finished_at: number | null; status: string; error: string | null;
}

function rowToSchedule(r: Row): Schedule {
  return {
    id: r.id, name: r.name,
    cadence: JSON.parse(r.cadence_json) as Cadence,
    target: JSON.parse(r.target_json) as Target,
    autonomy: r.autonomy === 'trusted' ? 'trusted' : 'safe',
    providerName: r.provider_name ?? undefined,
    workspaceId: r.workspace_id ?? undefined,
    enabled: r.enabled === 1,
    nextRunAt: r.next_run_at,
    lastRunAt: r.last_run_at ?? undefined,
    createdAt: r.created_at, updatedAt: r.updated_at,
  };
}
function rowToRun(r: RunRow): ScheduleRun {
  return {
    id: r.id, scheduleId: r.schedule_id, sessionId: r.session_id,
    startedAt: r.started_at, finishedAt: r.finished_at ?? undefined,
    status: r.status as RunStatus, error: r.error ?? undefined,
  };
}

export class ScheduleStore {
  constructor(private readonly db: DatabaseHandle) {}

  list(): Schedule[] {
    return (this.db.prepare('SELECT * FROM schedules ORDER BY updated_at DESC').all() as Row[]).map(rowToSchedule);
  }

  get(id: string): Schedule | undefined {
    const r = this.db.prepare('SELECT * FROM schedules WHERE id = ?').get(id) as Row | undefined;
    return r ? rowToSchedule(r) : undefined;
  }

  create(input: ScheduleInput): Schedule {
    const id = randomUUID();
    const now = Date.now();
    this.db.prepare(
      `INSERT INTO schedules (id, name, cadence_json, target_json, autonomy, provider_name, workspace_id, enabled, next_run_at, last_run_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)`,
    ).run(
      id, input.name, JSON.stringify(input.cadence), JSON.stringify(input.target),
      input.autonomy ?? 'safe', input.providerName ?? null, input.workspaceId ?? null,
      input.enabled === false ? 0 : 1, null, now, now,
    );
    return this.get(id)!;
  }

  update(id: string, patch: Partial<ScheduleInput> & { lastRunAt?: number }): Schedule {
    const cur = this.get(id);
    if (!cur) throw new Error(`schedule ${id} not found`);
    const next: Schedule = {
      ...cur,
      name: patch.name ?? cur.name,
      cadence: patch.cadence ?? cur.cadence,
      target: patch.target ?? cur.target,
      autonomy: patch.autonomy ?? cur.autonomy,
      providerName: patch.providerName ?? cur.providerName,
      workspaceId: patch.workspaceId ?? cur.workspaceId,
      enabled: patch.enabled ?? cur.enabled,
      lastRunAt: patch.lastRunAt ?? cur.lastRunAt,
      updatedAt: Date.now(),
    };
    this.db.prepare(
      `UPDATE schedules SET name=?, cadence_json=?, target_json=?, autonomy=?, provider_name=?, workspace_id=?, enabled=?, last_run_at=?, updated_at=? WHERE id=?`,
    ).run(
      next.name, JSON.stringify(next.cadence), JSON.stringify(next.target), next.autonomy,
      next.providerName ?? null, next.workspaceId ?? null, next.enabled ? 1 : 0,
      next.lastRunAt ?? null, next.updatedAt, id,
    );
    return this.get(id)!;
  }

  delete(id: string): void {
    this.db.prepare('DELETE FROM schedules WHERE id = ?').run(id);
  }

  setNextRunAt(id: string, nextRunAt: number | null): void {
    this.db.prepare('UPDATE schedules SET next_run_at = ? WHERE id = ?').run(nextRunAt, id);
  }

  listDue(now: number): Schedule[] {
    return (this.db
      .prepare('SELECT * FROM schedules WHERE enabled = 1 AND next_run_at IS NOT NULL AND next_run_at <= ? ORDER BY next_run_at ASC')
      .all(now) as Row[]).map(rowToSchedule);
  }

  createRun(scheduleId: string): string {
    const id = randomUUID();
    this.db.prepare(
      `INSERT INTO schedule_runs (id, schedule_id, session_id, started_at, finished_at, status, error) VALUES (?, ?, NULL, ?, NULL, 'running', NULL)`,
    ).run(id, scheduleId, Date.now());
    return id;
  }

  setRunSession(runId: string, sessionId: string): void {
    this.db.prepare('UPDATE schedule_runs SET session_id = ? WHERE id = ?').run(sessionId, runId);
  }

  finishRun(runId: string, status: RunStatus, error?: string): void {
    this.db.prepare('UPDATE schedule_runs SET status = ?, error = ?, finished_at = ? WHERE id = ?')
      .run(status, error ?? null, Date.now(), runId);
  }

  listRuns(scheduleId: string, limit: number): ScheduleRun[] {
    return (this.db
      .prepare('SELECT * FROM schedule_runs WHERE schedule_id = ? ORDER BY started_at DESC LIMIT ?')
      .all(scheduleId, limit) as RunRow[]).map(rowToRun);
  }
}
