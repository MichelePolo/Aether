import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createApp } from '@/server/app';

function makeApp(over: Partial<import('@/server/domain/tdd/tdd.types').TddRunnerDeps> = {}) {
  const tddRunnerDeps = {
    runCommand: async () => ({ exitCode: 0, output: 'ok' }),
    subAgentsStore: { list: async () => [{ name: 'coder' }] },
    dispatcher: { handle: async () => {} },
    createSession: async () => 'sess-1',
    ...over,
  };
  return createApp({ tddRunnerDeps } as any);
}

describe('tdd routes', () => {
  it('streams already_green when the command passes', async () => {
    const res = await request(makeApp())
      .post('/api/tdd/run')
      .send({ command: 'cmd', subAgentName: 'coder' });
    expect(res.status).toBe(200);
    expect(res.text).toContain('tdd_started');
    expect(res.text).toContain('already_green');
  });

  it('emits a terminal error pair on invalid input', async () => {
    const res = await request(makeApp()).post('/api/tdd/run').send({ command: '' });
    expect(res.text).toContain('tdd_error');
    expect(res.text).toContain('"status":"error"');
  });
});
