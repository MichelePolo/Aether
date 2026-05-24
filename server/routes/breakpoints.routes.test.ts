import { describe, it, expect, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createBreakpointsRoutes } from './breakpoints.routes';
import type { BreakpointPolicyStore } from '@/server/domain/mcp/breakpoints/policy.store';
import type { PreviewService } from '@/server/domain/mcp/breakpoints/preview.service';

function makeApp(opts: {
  policyStore?: Partial<BreakpointPolicyStore>;
  previewService?: Partial<PreviewService>;
}) {
  const app = express();
  app.use(express.json());
  app.use(
    '/api/breakpoints',
    createBreakpointsRoutes({
      policyStore: (opts.policyStore ?? {}) as BreakpointPolicyStore,
      previewService: (opts.previewService ?? {}) as PreviewService,
    }),
  );
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  app.use((err: any, _req: any, res: any, _next: any) => {
    res.status(err.statusCode ?? 400).json({ error: { message: err.message } });
  });
  return app;
}

describe('breakpoints.routes', () => {
  it('GET /api/breakpoints/policy returns the current policy', async () => {
    const read = vi.fn().mockReturnValue({ safe: 'auto', dangerous: 'gate', external: 'gate' });
    const res = await request(makeApp({ policyStore: { read } as Partial<BreakpointPolicyStore> }))
      .get('/api/breakpoints/policy');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ safe: 'auto', dangerous: 'gate', external: 'gate' });
  });

  it('PUT /api/breakpoints/policy/:category sets mode and returns the new policy', async () => {
    const policy = { safe: 'auto', dangerous: 'gate', external: 'gate' };
    const setCategory = vi.fn((c: string, m: string) => {
      (policy as Record<string, string>)[c] = m;
    });
    const read = vi.fn().mockImplementation(() => ({ ...policy }));
    const app = makeApp({ policyStore: { setCategory, read } as Partial<BreakpointPolicyStore> });
    const res = await request(app)
      .put('/api/breakpoints/policy/dangerous')
      .send({ mode: 'auto' });
    expect(res.status).toBe(200);
    expect(setCategory).toHaveBeenCalledWith('dangerous', 'auto');
    expect(res.body.dangerous).toBe('auto');
  });

  it('PUT invalid category → 400', async () => {
    const res = await request(makeApp({})).put('/api/breakpoints/policy/garbage').send({ mode: 'auto' });
    expect(res.status).toBe(400);
  });

  it('PUT invalid mode → 400', async () => {
    const res = await request(makeApp({})).put('/api/breakpoints/policy/safe').send({ mode: 'sometimes' });
    expect(res.status).toBe(400);
  });

  it('POST /api/breakpoints/preview returns the preview result', async () => {
    const previewToolCall = vi.fn().mockResolvedValue({ kind: 'plain' });
    const res = await request(makeApp({ previewService: { previewToolCall } as Partial<PreviewService> }))
      .post('/api/breakpoints/preview')
      .send({ qualifiedName: 'fs.read_file', args: { path: '/x' } });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ kind: 'plain' });
  });

  it('POST /api/breakpoints/preview invalid body → 400', async () => {
    const res = await request(makeApp({})).post('/api/breakpoints/preview').send({ args: {} });
    expect(res.status).toBe(400);
  });

  it('GET /api/breakpoints/classify returns category + source', async () => {
    const res = await request(makeApp({}))
      .get('/api/breakpoints/classify')
      .query({ qualifiedName: 'fs.write_file', argsJson: '{}' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ category: 'dangerous', source: 'heuristic' });
  });
});
