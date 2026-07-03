import { computeNextRunAt } from './next-run';
import type { Schedule } from './schedules.types';

const TICK_MS = 30_000;

export interface SchedulerDeps {
  store: {
    listDue(now: number): Schedule[];
    setNextRunAt(id: string, nextRunAt: number | null): void;
    update(id: string, patch: { lastRunAt?: number }): unknown;
  };
  runner: { run(schedule: Schedule): Promise<void> };
  now: () => number;
  /** Used to guard against schedules pointing at a workspace that no longer exists —
   *  without this, a dangling workspaceId would silently fall back to the builtin
   *  filesystem root / process.cwd() when the run resolves its project root. */
  workspacesStore: { get(id: string): unknown };
}

export class SchedulerService {
  private timer: ReturnType<typeof setInterval> | null = null;
  private readonly running = new Set<string>();

  constructor(private readonly deps: SchedulerDeps) {}

  start(): void {
    if (this.timer) return;
    void this.tick(); // boot catch-up
    this.timer = setInterval(() => void this.tick(), TICK_MS);
  }

  stop(): void {
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
  }

  async tick(): Promise<void> {
    const t = this.deps.now();
    for (const s of this.deps.store.listDue(t)) {
      if (this.running.has(s.id)) continue;
      // Advance BEFORE firing so the next tick doesn't re-fire the same schedule.
      try {
        this.deps.store.setNextRunAt(s.id, computeNextRunAt(s.cadence, t));
        this.deps.store.update(s.id, { lastRunAt: t });
      } catch {
        // A broken cadence shouldn't wedge the loop; skip this schedule.
        continue;
      }
      if (s.workspaceId && !this.deps.workspacesStore.get(s.workspaceId)) {
        // The workspace was deleted after the schedule was created. Skip the run
        // rather than letting it silently fall back to the builtin fs root / cwd.
        console.warn(`[scheduler] skipping schedule ${s.id} (${s.name}): workspace ${s.workspaceId} no longer exists`);
        continue;
      }
      this.running.add(s.id);
      void this.deps.runner.run(s).catch(() => {}).finally(() => this.running.delete(s.id));
    }
  }
}
