import { describe, it, expect } from 'vitest';
import { reduceTdd, type TddViewState, INITIAL_TDD } from './useTddRun';

function run(events: [string, any][]): TddViewState {
  const init: TddViewState = { ...INITIAL_TDD, running: true };
  return events.reduce((s, [name, data]) => reduceTdd(s, name, data), init);
}

describe('reduceTdd', () => {
  it('tracks iterations and test results', () => {
    const s = run([
      ['tdd_started', { command: 'cmd', maxRetries: 5 }],
      ['tdd_test_result', { iteration: 0, passed: false, exitCode: 1, output: 'FAIL' }],
      ['tdd_iteration_started', { iteration: 1 }],
      ['tdd_test_result', { iteration: 1, passed: true, exitCode: 0, output: 'ok' }],
      ['tdd_done', { status: 'success', iterations: 1 }],
    ]);
    expect(s.results).toHaveLength(2);
    expect(s.results[1].passed).toBe(true);
    expect(s.status).toBe('success');
    expect(s.running).toBe(false);
  });

  it('captures errors', () => {
    const s = run([['tdd_error', { message: 'boom' }], ['tdd_done', { status: 'error' }]]);
    expect(s.error).toBe('boom');
    expect(s.status).toBe('error');
  });
});
