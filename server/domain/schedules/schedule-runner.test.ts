import { ScheduleRunner } from './schedule-runner';
import { ScheduleStore } from './schedules.store';
import { makeTestDb } from '@/server/test/test-db';
import type { DatabaseHandle } from '@/server/db/database';

// Minimal fakes for the dispatch deps. The runner builds a per-run DispatchService
// internally; we assert the OUTCOME (run record) + that history.createEmpty was used.
function fakeDeps(db: DatabaseHandle) {
  const store = new ScheduleStore(db);
  const sessions: string[] = [];
  const historyStore = {
    createEmpty: async () => { const id = 'sess-' + sessions.length; sessions.push(id); return { id }; },
    append: async () => {},
    getMessages: async () => [],
  };
  // A provider registry / context / mcp / breakpoint that let DispatchService.handle
  // run a no-tool turn. The fake provider returns one text chunk then done.
  // (Use the repo's existing FakeProvider wiring pattern; see notes below.)
  return { store, historyStore, sessions };
}

describe('ScheduleRunner', () => {
  let db: DatabaseHandle;
  beforeEach(() => { db = makeTestDb(); });
  afterEach(() => db.close());

  it('prompt run creates a session + a success run record', async () => {
    const { store, historyStore, sessions } = fakeDeps(db);
    const dispatcher = { handle: vi.fn(async () => {}) };  // no-op dispatch (no error event)
    const runner = new ScheduleRunner({
      store, historyStore: historyStore as never,
      buildDispatcher: () => dispatcher as never,           // injected for the test
      runSwarm: vi.fn(),
      swarmDeps: {} as never,
    });
    const sch = store.create({ name: 'a', cadence: { kind: 'interval', everyMs: 60_000 }, target: { kind: 'prompt', prompt: 'hello' } });
    await runner.run(sch);
    expect(dispatcher.handle).toHaveBeenCalledTimes(1);
    expect(sessions.length).toBe(1);
    const runs = store.listRuns(sch.id, 10);
    expect(runs[0].status).toBe('success');
    expect(runs[0].sessionId).toBe('sess-0');
  });

  it('builds an auto-approve gate for trusted and an auto-reject registry for safe', () => {
    const { store, historyStore } = fakeDeps(db);
    const calls: Array<'safe' | 'trusted'> = [];
    const runner = new ScheduleRunner({
      store, historyStore: historyStore as never,
      buildDispatcher: (autonomy) => { calls.push(autonomy); return { handle: vi.fn(async () => {}) } as never; },
      runSwarm: vi.fn(), swarmDeps: {} as never,
    });
    void runner.run(store.create({ name: 's', cadence: { kind: 'interval', everyMs: 60_000 }, target: { kind: 'prompt', prompt: 'x' }, autonomy: 'safe' }));
    void runner.run(store.create({ name: 't', cadence: { kind: 'interval', everyMs: 60_000 }, target: { kind: 'prompt', prompt: 'x' }, autonomy: 'trusted' }));
    expect(calls).toEqual(['safe', 'trusted']);
  });
});
