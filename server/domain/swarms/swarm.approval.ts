export type SwarmDecision = 'approve' | 'reject';

interface Pending {
  resolve: (d: SwarmDecision) => void;
  timer: ReturnType<typeof setTimeout>;
}

export class SwarmApprovalRegistry {
  private pending = new Map<string, Pending>();

  /**
   * Resolve when a decision is submitted, when `timeoutMs` elapses, or when
   * `signal` aborts — the last two resolve to `'reject'`. Bounding on `signal`
   * prevents a paused run from hanging (and leaking the pending entry) for the
   * full timeout after the client disconnects.
   */
  awaitDecision(id: string, timeoutMs: number, signal?: AbortSignal): Promise<SwarmDecision> {
    return new Promise<SwarmDecision>((resolve) => {
      const settle = (d: SwarmDecision) => {
        clearTimeout(timer);
        if (onAbort) signal?.removeEventListener('abort', onAbort);
        this.pending.delete(id);
        resolve(d);
      };
      const timer = setTimeout(() => settle('reject'), timeoutMs);
      const onAbort = signal ? () => settle('reject') : undefined;
      if (signal?.aborted) {
        settle('reject');
        return;
      }
      if (onAbort) signal!.addEventListener('abort', onAbort, { once: true });
      this.pending.set(id, { resolve: settle, timer });
    });
  }

  resolveDecision(id: string, action: SwarmDecision): void {
    const p = this.pending.get(id);
    if (!p) return;
    p.resolve(action); // `settle` clears the timer, removes the abort listener, and deletes the entry
  }
}
