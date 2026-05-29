import type { SseEmitter } from '@/server/lib/sse';
import { createCollectingSse } from './collecting-sse';
import type { SwarmApprovalRegistry } from './swarm.approval';
import type { SwarmRecord } from './swarm.types';

export interface SwarmDispatcher {
  handle(
    body: { sessionId: string; message: string },
    sse: SseEmitter,
    signal: AbortSignal,
  ): Promise<void>;
}

export interface SwarmOrchestratorDeps {
  store: { read(id: string): Promise<SwarmRecord | null> };
  subAgentsStore: { list(): Promise<{ name: string }[]> };
  dispatcher: SwarmDispatcher;
  createSession: () => Promise<string>;
  approvals: SwarmApprovalRegistry;
  approvalTimeoutMs?: number;
}

export interface RunOpts {
  swarmId: string;
  input: string;
}

export async function runSwarm(
  deps: SwarmOrchestratorDeps,
  opts: RunOpts,
  sse: SseEmitter,
  signal: AbortSignal,
): Promise<void> {
  const timeout = deps.approvalTimeoutMs ?? 300_000;

  const swarm = await deps.store.read(opts.swarmId);
  if (!swarm) {
    sse.event('swarm_error', { message: `swarm ${opts.swarmId} not found` });
    sse.event('swarm_done', { status: 'error' });
    sse.end();
    return;
  }
  if (swarm.steps.length === 0) {
    sse.event('swarm_error', { message: 'swarm has no steps' });
    sse.event('swarm_done', { status: 'error' });
    sse.end();
    return;
  }

  const known = new Set((await deps.subAgentsStore.list()).map((s) => s.name));
  const missing = swarm.steps.find((s) => !known.has(s.subAgentName));
  if (missing) {
    sse.event('swarm_error', { message: `unknown sub-agent: ${missing.subAgentName}` });
    sse.event('swarm_done', { status: 'error' });
    sse.end();
    return;
  }

  const sessionId = await deps.createSession();
  sse.event('swarm_started', { sessionId, swarmName: swarm.name, stepCount: swarm.steps.length });

  let incoming = opts.input;
  for (let i = 0; i < swarm.steps.length; i++) {
    if (signal.aborted) {
      sse.event('swarm_done', { status: 'interrupted' });
      sse.end();
      return;
    }
    const step = swarm.steps[i];
    sse.event('swarm_step_started', { position: i, subAgent: step.subAgentName });

    const message = step.promptTemplate ? `${step.promptTemplate}\n\n${incoming}` : incoming;
    const collector = createCollectingSse(sse);
    await deps.dispatcher.handle(
      { sessionId, message: `@${step.subAgentName} ${message}` },
      collector,
      signal,
    );

    const stepError = collector.capturedError();
    if (stepError) {
      sse.event('swarm_error', { position: i, message: stepError.message });
      sse.event('swarm_done', { status: 'error' });
      sse.end();
      return;
    }

    incoming = collector.text();
    sse.event('swarm_step_completed', { position: i, output: incoming });

    if (step.pauseAfter) {
      const approvalId = `${opts.swarmId}:${i}`;
      sse.event('swarm_approval_request', { approvalId, position: i, output: incoming });
      const action = await deps.approvals.awaitDecision(approvalId, timeout, signal);
      if (signal.aborted) {
        sse.event('swarm_done', { status: 'interrupted' });
        sse.end();
        return;
      }
      if (action === 'reject') {
        sse.event('swarm_done', { status: 'rejected', stoppedAt: i });
        sse.end();
        return;
      }
    }
  }

  sse.event('swarm_done', { status: 'done', finalOutput: incoming });
  sse.end();
}
