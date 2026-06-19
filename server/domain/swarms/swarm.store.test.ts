import { describe, it, expect, beforeEach } from 'vitest';
import { makeTestDb } from '@/server/test/test-db';
import { SwarmStore } from './swarm.store';

describe('SwarmStore', () => {
  let store: SwarmStore;
  beforeEach(() => {
    store = new SwarmStore(makeTestDb());
  });

  const steps = [
    { subAgentName: 'architect', promptTemplate: 'Design:', pauseAfter: true },
    { subAgentName: 'coder', promptTemplate: '', pauseAfter: false },
  ];

  it('creates and reads a swarm with ordered steps', async () => {
    const meta = await store.create({ name: 'build', steps });
    expect(meta.stepCount).toBe(2);
    const rec = await store.read(meta.id);
    expect(rec?.name).toBe('build');
    expect(rec?.steps.map((s) => s.subAgentName)).toEqual(['architect', 'coder']);
    expect(rec?.steps[0].pauseAfter).toBe(true);
    expect(rec?.steps[0].promptTemplate).toBe('Design:');
    expect(rec?.steps[1].pauseAfter).toBe(false);
  });

  it('list returns stepCount', async () => {
    await store.create({ name: 'a', steps });
    const list = await store.list();
    expect(list[0].stepCount).toBe(2);
  });

  it('read returns null for unknown id', async () => {
    expect(await store.read('nope')).toBeNull();
  });

  it('update replaces name and steps atomically', async () => {
    const meta = await store.create({ name: 'a', steps });
    await store.update(meta.id, { name: 'b', steps: [{ subAgentName: 'qa', promptTemplate: '', pauseAfter: false }] });
    const rec = await store.read(meta.id);
    expect(rec?.name).toBe('b');
    expect(rec?.steps.map((s) => s.subAgentName)).toEqual(['qa']);
  });

  it('delete removes the swarm and cascades steps', async () => {
    const meta = await store.create({ name: 'a', steps });
    await store.delete(meta.id);
    expect(await store.read(meta.id)).toBeNull();
  });

  it('persists swarm-level and per-step workspaceId', async () => {
    const meta = await store.create({
      name: 'ws',
      workspaceId: 'w-default',
      steps: [
        { subAgentName: 'a', promptTemplate: '', pauseAfter: false, workspaceId: 'w-step' },
        { subAgentName: 'b', promptTemplate: '', pauseAfter: false },
      ],
    });
    const rec = await store.read(meta.id);
    expect(rec!.workspaceId).toBe('w-default');
    expect(rec!.steps[0].workspaceId).toBe('w-step');
    expect(rec!.steps[1].workspaceId).toBeUndefined();
  });

  it('round-trips a step providerName, omitting it when unset', async () => {
    const meta = await store.create({
      name: 'mixed',
      steps: [
        { subAgentName: 'architect', promptTemplate: '', pauseAfter: false, providerName: 'anthropic:claude-opus-4-7' },
        { subAgentName: 'coder', promptTemplate: '', pauseAfter: false },
      ],
    });
    const rec = await store.read(meta.id);
    expect(rec?.steps[0].providerName).toBe('anthropic:claude-opus-4-7');
    expect(rec?.steps[1].providerName).toBeUndefined();
  });
});
