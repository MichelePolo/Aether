import { makeTestDb } from '@/server/test/test-db';
import { ScheduleStore } from './schedules.store';
import type { DatabaseHandle } from '@/server/db/database';

let db: DatabaseHandle;
let store: ScheduleStore;

beforeEach(() => {
  db = makeTestDb();
  store = new ScheduleStore(db);
});
afterEach(() => db.close());

describe('ScheduleStore', () => {
  it('create round-trips cadence/target and defaults', () => {
    const s = store.create({
      name: 'nightly', cadence: { kind: 'cron', expr: '0 3 * * *' },
      target: { kind: 'prompt', prompt: 'check the repo' },
    });
    expect(s.autonomy).toBe('safe');
    expect(s.enabled).toBe(true);
    expect(s.cadence).toEqual({ kind: 'cron', expr: '0 3 * * *' });
    expect(s.target).toEqual({ kind: 'prompt', prompt: 'check the repo' });
    expect(store.get(s.id)?.name).toBe('nightly');
  });

  it('listDue returns enabled schedules whose next_run_at <= now', () => {
    const a = store.create({ name: 'a', cadence: { kind: 'interval', everyMs: 60_000 }, target: { kind: 'prompt', prompt: 'x' } });
    store.setNextRunAt(a.id, 1000);
    const b = store.create({ name: 'b', cadence: { kind: 'interval', everyMs: 60_000 }, target: { kind: 'prompt', prompt: 'y' } });
    store.setNextRunAt(b.id, 9_999_999_999_999);
    const c = store.create({ name: 'c', cadence: { kind: 'interval', everyMs: 60_000 }, target: { kind: 'prompt', prompt: 'z' }, enabled: false });
    store.setNextRunAt(c.id, 1000);
    const due = store.listDue(5000).map((s) => s.id);
    expect(due).toContain(a.id);
    expect(due).not.toContain(b.id);
    expect(due).not.toContain(c.id);
  });

  it('run records: create (session null), setRunSession, finish, list', () => {
    const s = store.create({ name: 'a', cadence: { kind: 'interval', everyMs: 60_000 }, target: { kind: 'prompt', prompt: 'x' } });
    const runId = store.createRun(s.id);
    store.setRunSession(runId, 'sess-1');
    store.finishRun(runId, 'success');
    const runs = store.listRuns(s.id, 10);
    expect(runs[0]).toMatchObject({ id: runId, sessionId: 'sess-1', status: 'success' });
  });
});
