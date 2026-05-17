import { describe, it, expect } from 'vitest';

describe('msw server', () => {
  it('intercepts /api/__health', async () => {
    const res = await fetch('http://localhost/api/__health');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });
});
