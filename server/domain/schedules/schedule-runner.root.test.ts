import { ScheduleRunner } from './schedule-runner';
import { ScheduleStore } from './schedules.store';
import { makeTestDb } from '@/server/test/test-db';
import type { DatabaseHandle } from '@/server/db/database';

// Capture the options every real DispatchService is constructed with. `vi.hoisted`
// lets the mock factory (hoisted above imports) reference this array safely.
// NB: the mock must be a real (constructible) class — `new DispatchService(...)`
// on an arrow function throws "is not a constructor".
const { ctorOpts } = vi.hoisted(() => ({ ctorOpts: [] as Array<Record<string, unknown>> }));
vi.mock('@/server/domain/dispatch/dispatch.service', () => ({
  DispatchService: class {
    handle = vi.fn(async () => {});
    constructor(opts: Record<string, unknown>) {
      ctorOpts.push(opts);
    }
  },
}));

describe('ScheduleRunner — workspace root resolution (issue #108)', () => {
  let db: DatabaseHandle;
  beforeEach(() => {
    db = makeTestDb();
    ctorOpts.length = 0;
  });
  afterEach(() => db.close());

  it('forwards projectRootFor into the per-run DispatchService so scheduled runs resolve the pinned workspace root (not cwd)', async () => {
    const store = new ScheduleStore(db);
    const historyStore = { createEmpty: async () => ({ id: 'sess-0' }) };
    const projectRootFor = (wId: string | undefined) => (wId === 'ws-a' ? '/root/a' : null);

    const runner = new ScheduleRunner({
      store,
      historyStore: historyStore as never,
      // Minimal deps buildDispatcher touches; DispatchService is mocked so their
      // shape doesn't matter. We deliberately do NOT override buildDispatcher —
      // the real one is what this fix wires projectRootFor through.
      providers: { get: () => ({}), defaultName: () => 'fake' } as never,
      contextStore: {} as never,
      projectRootFor,
    });

    const sch = store.create({
      name: 'nightly',
      cadence: { kind: 'interval', everyMs: 60_000 },
      target: { kind: 'prompt', prompt: 'do the thing' },
      workspaceId: 'ws-a',
    });
    await runner.run(sch);

    expect(ctorOpts).toHaveLength(1);
    const forwarded = ctorOpts[0].projectRootFor as ((w: string | undefined) => string | null) | undefined;
    expect(forwarded).toBeDefined();
    // The forwarded resolver must map the pinned workspace to its root — proving a
    // scheduled run will resolve `ws-a` to `/root/a` instead of falling back to cwd.
    expect(forwarded!('ws-a')).toBe('/root/a');
  });
});
