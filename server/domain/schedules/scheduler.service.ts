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
      this.running.add(s.id);
      void this.deps.runner.run(s).catch(() => {}).finally(() => this.running.delete(s.id));
    }
  }
}
