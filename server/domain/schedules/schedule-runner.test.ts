import { ScheduleRunner, autoRejectGatedRegistry, autoDecideApprovals, AUTO_GATE } from './schedule-runner';
import { ScheduleStore } from './schedules.store';
import { makeTestDb } from '@/server/test/test-db';
import type { DatabaseHandle } from '@/server/db/database';
import type { McpRegistry } from '@/server/domain/mcp/registry';
import type { SwarmApprovalRegistry } from '@/server/domain/swarms/swarm.approval';

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
      runSwarm: vi.fn(),
    });
    void runner.run(store.create({ name: 's', cadence: { kind: 'interval', everyMs: 60_000 }, target: { kind: 'prompt', prompt: 'x' }, autonomy: 'safe' }));
    void runner.run(store.create({ name: 't', cadence: { kind: 'interval', everyMs: 60_000 }, target: { kind: 'prompt', prompt: 'x' }, autonomy: 'trusted' }));
    expect(calls).toEqual(['safe', 'trusted']);
  });

  it('safe swarm run auto-rejects a paused step instead of stalling on a human', async () => {
    const { store, historyStore } = fakeDeps(db);
    let seenApprovals: SwarmApprovalRegistry | undefined;
    const runner = new ScheduleRunner({
      store, historyStore: historyStore as never,
      buildDispatcher: () => ({ handle: vi.fn(async () => {}) }) as never,
      // Capture the approvals registry the runner hands to runSwarm and prove it
      // resolves WITHOUT a human submitting a decision.
      runSwarm: (async (deps: { approvals: SwarmApprovalRegistry }) => { seenApprovals = deps.approvals; }) as never,
      swarmApprovals: new (await import('@/server/domain/swarms/swarm.approval')).SwarmApprovalRegistry(),
      swarmStore: {} as never, subAgentsStore: {} as never,
    });
    await runner.run(store.create({ name: 'sw', cadence: { kind: 'interval', everyMs: 60_000 }, target: { kind: 'swarm', swarmId: 'x' }, autonomy: 'safe' }));
    expect(seenApprovals).toBeDefined();
    // No resolveDecision() call — a stalling registry would never settle.
    await expect(seenApprovals!.awaitDecision('any', 9_999_999)).resolves.toBe('reject');
  });
});

describe('autonomy override primitives', () => {
  it('autoRejectGatedRegistry rejects gated calls and delegates other methods with correct `this`', async () => {
    const real = { awaitDecision: async () => 'approve', secret: 42, policy() { return (this as { secret: number }).secret; } };
    const proxied = autoRejectGatedRegistry(real as unknown as McpRegistry) as unknown as typeof real;
    await expect(proxied.awaitDecision()).resolves.toBe('reject'); // overridden
    expect(proxied.policy()).toBe(42);                              // delegated, `this` bound to real
    expect(proxied.secret).toBe(42);                                // non-function prop passes through
  });

  it('AUTO_GATE resolves every decision to auto', async () => {
    await expect((AUTO_GATE as unknown as { resolveDecision: () => Promise<string> }).resolveDecision()).resolves.toBe('auto');
  });

  it('autoDecideApprovals settles awaitDecision to the configured decision without waiting', async () => {
    const real = { awaitDecision: async () => 'approve', resolveDecision() {} };
    const trusted = autoDecideApprovals(real as unknown as SwarmApprovalRegistry, 'approve');
    const safe = autoDecideApprovals(real as unknown as SwarmApprovalRegistry, 'reject');
    await expect(trusted.awaitDecision('id', 9_999_999)).resolves.toBe('approve');
    await expect(safe.awaitDecision('id', 9_999_999)).resolves.toBe('reject');
  });
});
