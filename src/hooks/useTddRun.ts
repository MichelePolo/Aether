import { useCallback, useRef, useState } from 'react';
import { parseSseStream } from '@/src/lib/sse-parser';
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
      if (!res.body) {
        setState((s) => ({ ...s, running: false, error: 'no stream' }));
        return;
      }
      for await (const ev of parseSseStream(res.body)) {
        setState((s) => reduceTdd(s, ev.event, ev.data as any));
      }
    } catch (e) {
      if (e instanceof Error && e.name === 'AbortError') {
        setState((s) => ({ ...s, running: false }));
      } else {
        setState((s) => ({ ...s, running: false, error: e instanceof Error ? e.message : 'Network error' }));
      }
    }
  }, []);

  const cancel = useCallback(() => abortRef.current?.abort(), []);

  return { state, run, cancel };
}
