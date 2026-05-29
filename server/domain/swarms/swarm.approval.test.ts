import { describe, it, expect, vi } from 'vitest';
import { SwarmApprovalRegistry } from './swarm.approval';

describe('SwarmApprovalRegistry', () => {
  it('resolves with the submitted action', async () => {
    const reg = new SwarmApprovalRegistry();
    const p = reg.awaitDecision('a', 1000);
    reg.resolveDecision('a', 'approve');
    expect(await p).toBe('approve');
  });

  it('resolves to reject on timeout', async () => {
    vi.useFakeTimers();
    const reg = new SwarmApprovalRegistry();
    const p = reg.awaitDecision('b', 500);
    vi.advanceTimersByTime(500);
    await expect(p).resolves.toBe('reject');
    vi.useRealTimers();
  });

  it('resolveDecision for an unknown id is a no-op', () => {
    const reg = new SwarmApprovalRegistry();
    expect(() => reg.resolveDecision('nope', 'approve')).not.toThrow();
  });
});
