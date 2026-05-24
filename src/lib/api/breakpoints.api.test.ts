import { describe, it, expect } from 'vitest';
import { breakpointsApi } from './breakpoints.api';

describe('breakpointsApi (against MSW defaults)', () => {
  it('getPolicy returns the seeded policy', async () => {
    const p = await breakpointsApi.getPolicy();
    expect(p).toEqual({ safe: 'auto', dangerous: 'gate', external: 'gate' });
  });

  it('setCategoryMode returns the updated policy', async () => {
    const p = await breakpointsApi.setCategoryMode('dangerous', 'auto');
    expect(p.dangerous).toBe('auto');
  });

  it('preview returns kind=plain by default', async () => {
    const r = await breakpointsApi.preview({ qualifiedName: 'fs.read_file', args: {} });
    expect(r.kind).toBe('plain');
  });

  it('classify returns category from heuristic', async () => {
    const r = await breakpointsApi.classify({ qualifiedName: 'fs.write_file', args: {} });
    expect(r.category).toBe('dangerous');
    expect(r.source).toBe('heuristic');
  });
});
