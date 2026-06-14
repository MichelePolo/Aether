import { SchedulerService } from './scheduler.service';
import type { Schedule } from './schedules.types';

function sched(id: string, nextRunAt: number | null, everyMs = 60_000): Schedule {
  return {
    id, name: id, cadence: { kind: 'interval', everyMs },
    target: { kind: 'prompt', prompt: 'x' }, autonomy: 'safe',
    enabled: true, nextRunAt, createdAt: 0, updatedAt: 0,
  };
}

describe('SchedulerService.tick', () => {
  it('fires due schedules, advances nextRunAt, skips not-due', async () => {
    const due = [sched('a', 1000), sched('b', 5000)];
    const advanced: Record<string, number> = {};
    const ran: string[] = [];
    const store = {
      listDue: (now: number) => due.filter((s) => s.nextRunAt! <= now),
      setNextRunAt: (id: string, n: number | null) => { advanced[id] = n ?? -1; },
      update: () => {},
    };
    const runner = { run: async (s: Schedule) => { ran.push(s.id); } };
    const svc = new SchedulerService({ store: store as never, runner, now: () => 3000 });
    await svc.tick();
    expect(ran).toEqual(['a']);          // only 'a' is due at now=3000
    expect(advanced['a']).toBe(3000 + 60_000);
    expect(advanced['b']).toBeUndefined();
  });

  it('does not re-fire an already-running schedule', async () => {
    const s = sched('a', 1000);
    const ran: string[] = [];
    let release!: () => void;
    const store = { listDue: () => [s], setNextRunAt: () => {}, update: () => {} };
    const runner = { run: (sc: Schedule) => new Promise<void>((r) => { ran.push(sc.id); release = r; }) };
    const svc = new SchedulerService({ store: store as never, runner, now: () => 3000 });
    await svc.tick();   // starts 'a' (still running)
    await svc.tick();   // 'a' running → skipped
    expect(ran).toEqual(['a']);
    release();
  });
});
