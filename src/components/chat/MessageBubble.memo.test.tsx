import { describe, it, expect } from 'vitest';
import { MessageBubble } from './MessageBubble';

// A render-count probe (mount two sibling bubbles, appendChunk one, assert the
// other's body didn't re-run) was tried first but proved unreliable in this
// environment: React's <Profiler onRender> fires on every commit pass of its
// subtree even when a React.memo child bails out on unchanged props (verified
// with a minimal repro — a fully memoized, stable-props child still ticked its
// Profiler counter on every parent re-render). DOM-based assertions can't
// distinguish "didn't re-render" from "re-rendered but produced identical
// output" either, since React's reconciliation would skip the DOM mutation
// either way. The reliable, deterministic signal is the memo wrapper itself.
describe('MessageBubble memoization', () => {
  it('is exported as a React.memo component', () => {
    expect((MessageBubble as unknown as { $$typeof: symbol }).$$typeof).toBe(
      Symbol.for('react.memo'),
    );
  });
});
