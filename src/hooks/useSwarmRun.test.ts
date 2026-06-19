import { reduce, type SwarmRunState } from '@/src/hooks/useSwarmRun';

const base: SwarmRunState = {
  running: true,
  steps: [{ position: 0, subAgent: 'a', output: '', status: 'running' }],
  pending: null,
  status: null,
  error: null,
};

it('records a step warning', () => {
  const next = reduce(base, 'swarm_step_warning', { position: 0, requested: 'openai:gpt-4o', used: 'fake:default' });
  expect(next.steps[0].warning).toEqual({ requested: 'openai:gpt-4o', used: 'fake:default' });
});

it('leaves other steps untouched on swarm_step_warning', () => {
  const state: SwarmRunState = {
    ...base,
    steps: [
      { position: 0, subAgent: 'a', output: '', status: 'running' },
      { position: 1, subAgent: 'b', output: '', status: 'running' },
    ],
  };
  const next = reduce(state, 'swarm_step_warning', { position: 1, requested: 'openai:gpt-4o', used: 'fake:default' });
  expect(next.steps[0].warning).toBeUndefined();
  expect(next.steps[1].warning).toEqual({ requested: 'openai:gpt-4o', used: 'fake:default' });
});

it('does not mutate existing cases', () => {
  const next = reduce(base, 'swarm_step_started', { position: 1, subAgent: 'b' });
  expect(next.steps).toHaveLength(2);
  expect(next.steps[1]).toMatchObject({ position: 1, subAgent: 'b', output: '', status: 'running' });
});
