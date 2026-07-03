import { useCallback, useRef, useState } from 'react';
import { consumeRun } from '@/src/lib/run-sse';
import { swarmsApi } from '@/src/lib/api/swarms.api';

export interface SwarmStepView {
  position: number;
  subAgent: string;
  output: string;
  status: 'running' | 'completed';
  warning?: { requested?: string; used?: string };
}
export interface SwarmRunState {
  running: boolean;
  steps: SwarmStepView[];
  pending: { approvalId: string; position: number; output: string } | null;
  status: string | null;
  error: string | null;
}

const INITIAL: SwarmRunState = { running: false, steps: [], pending: null, status: null, error: null };

export function reduce(s: SwarmRunState, name: string, data: any): SwarmRunState {
  switch (name) {
    case 'swarm_step_started':
      return {
        ...s,
        steps: [...s.steps, { position: data.position, subAgent: data.subAgent, output: '', status: 'running' }],
      };
    case 'swarm_step_completed':
      return {
        ...s,
        steps: s.steps.map((st) =>
          st.position === data.position ? { ...st, output: data.output, status: 'completed' } : st,
        ),
      };
    case 'swarm_approval_request':
      return { ...s, pending: { approvalId: data.approvalId, position: data.position, output: data.output } };
    case 'swarm_step_warning':
      return {
        ...s,
        steps: s.steps.map((st) =>
          st.position === data.position
            ? { ...st, warning: { requested: data.requested, used: data.used } }
            : st,
        ),
      };
    case 'swarm_error':
      return { ...s, error: data.message };
    case 'swarm_done':
      return { ...s, running: false, status: data.status, pending: null };
    default:
      return s;
  }
}

export function useSwarmRun() {
  const [state, setState] = useState<SwarmRunState>(INITIAL);
  const abortRef = useRef<AbortController | null>(null);

  const run = useCallback(async (swarmId: string, input: string) => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setState({ ...INITIAL, running: true });

    try {
      const res = await fetch(`/api/swarms/${swarmId}/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ input }),
        signal: controller.signal,
      });
      await consumeRun(res, (name, data) => setState((s) => reduce(s, name, data as any)));
    } catch (e) {
      if (e instanceof Error && e.name === 'AbortError') {
        // user cancelled — no error to surface
      } else if (abortRef.current === controller) {
        // only surface the error if this run is still the active one — a
        // superseded run's late rejection must not clobber a newer run's state
        setState((s) => ({ ...s, error: e instanceof Error ? e.message : 'Network error' }));
      }
    } finally {
      // reset even if the stream ended without emitting swarm_done — but only
      // for the still-active run; a superseded run is a no-op here
      if (abortRef.current === controller) {
        setState((s) => (s.running ? { ...s, running: false } : s));
      }
    }
  }, []);

  const decide = useCallback(async (approvalId: string, action: 'approve' | 'reject') => {
    try {
      await swarmsApi.decision(approvalId, action);
      setState((s) => ({ ...s, pending: null })); // only clear on confirmed success
    } catch (e) {
      setState((s) => ({ ...s, error: e instanceof Error ? e.message : 'decision failed' }));
    }
  }, []);
  const approve = useCallback((approvalId: string) => decide(approvalId, 'approve'), [decide]);
  const reject = useCallback((approvalId: string) => decide(approvalId, 'reject'), [decide]);

  return { state, run, approve, reject };
}
