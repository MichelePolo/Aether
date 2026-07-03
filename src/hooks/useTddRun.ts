import { useCallback, useRef, useState } from 'react';
import { consumeRun } from '@/src/lib/run-sse';
import { tddApi, type TddRunRequest } from '@/src/lib/api/tdd.api';

export interface TddResultView {
  iteration: number;
  passed: boolean;
  exitCode: number;
  output: string;
}
export interface TddViewState {
  running: boolean;
  results: TddResultView[];
  currentIteration: number;
  status: string | null;
  error: string | null;
}

export const INITIAL_TDD: TddViewState = {
  running: false,
  results: [],
  currentIteration: 0,
  status: null,
  error: null,
};

export function reduceTdd(s: TddViewState, name: string, data: any): TddViewState {
  switch (name) {
    case 'tdd_iteration_started':
      return { ...s, currentIteration: data.iteration };
    case 'tdd_test_result':
      return {
        ...s,
        results: [
          ...s.results,
          { iteration: data.iteration, passed: data.passed, exitCode: data.exitCode, output: data.output },
        ],
      };
    case 'tdd_error':
      return { ...s, error: data.message };
    case 'tdd_done':
      return { ...s, running: false, status: data.status };
    default:
      return s;
  }
}

export function useTddRun() {
  const [state, setState] = useState<TddViewState>(INITIAL_TDD);
  const abortRef = useRef<AbortController | null>(null);

  const run = useCallback(async (req: TddRunRequest) => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setState({ ...INITIAL_TDD, running: true });

    try {
      const res = await tddApi.run(req, controller.signal);
      await consumeRun(res, (name, data) => setState((s) => reduceTdd(s, name, data as any)));
    } catch (e) {
      if (!(e instanceof Error && e.name === 'AbortError') && abortRef.current === controller) {
        // only surface the error if this run is still the active one — a
        // superseded run's late rejection must not clobber a newer run's state
        setState((s) => ({ ...s, error: e instanceof Error ? e.message : 'Network error' }));
      }
    } finally {
      // reset even if the stream ended without emitting tdd_done — but only
      // for the still-active run; a superseded run is a no-op here
      if (abortRef.current === controller) {
        setState((s) => (s.running ? { ...s, running: false } : s));
      }
    }
  }, []);

  const cancel = useCallback(() => abortRef.current?.abort(), []);

  return { state, run, cancel };
}
