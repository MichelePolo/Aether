import { useCallback, useRef, useState } from 'react';
import { parseSseStream } from '@/src/lib/sse-parser';
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

    const res = await fetch(`/api/swarms/${swarmId}/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ input }),
      signal: controller.signal,
    });
    if (!res.body) {
      setState((s) => ({ ...s, running: false, error: 'no stream' }));
      return;
    }
    for await (const ev of parseSseStream(res.body)) {
      setState((s) => reduce(s, ev.event, ev.data as any));
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
