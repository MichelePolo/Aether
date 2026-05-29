export type SwarmDecision = 'approve' | 'reject';

interface Pending {
  resolve: (d: SwarmDecision) => void;
  timer: ReturnType<typeof setTimeout>;
}

export class SwarmApprovalRegistry {
  private pending = new Map<string, Pending>();

  awaitDecision(id: string, timeoutMs: number): Promise<SwarmDecision> {
    return new Promise<SwarmDecision>((resolve) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        resolve('reject');
      }, timeoutMs);
      this.pending.set(id, { resolve, timer });
    });
  }

  resolveDecision(id: string, action: SwarmDecision): void {
    const p = this.pending.get(id);
    if (!p) return;
    clearTimeout(p.timer);
    this.pending.delete(id);
    p.resolve(action);
  }
}
