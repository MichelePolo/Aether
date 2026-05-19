import { describe, it, expect } from 'vitest';
import { http, HttpResponse } from 'msw';
import { server } from '@/src/test/msw-server';
import { subagentsApi } from './subagents.api';

describe('subagentsApi', () => {
  it('list returns array', async () => {
    server.use(
      http.get('http://localhost/api/subagents', () =>
        HttpResponse.json({ subAgents: [{ id: 's1', name: 'designer', createdAt: 1, updatedAt: 2 }] }),
      ),
    );
    expect(await subagentsApi.list()).toEqual([
      { id: 's1', name: 'designer', createdAt: 1, updatedAt: 2 },
    ]);
  });

  it('get returns record', async () => {
    server.use(
      http.get('http://localhost/api/subagents/s1', () =>
        HttpResponse.json({
          id: 's1',
          name: 'designer',
          systemInstruction: 'Design.',
          skills: [],
          tools: [],
          createdAt: 1,
          updatedAt: 2,
        }),
      ),
    );
    const rec = await subagentsApi.get('s1');
    expect(rec.name).toBe('designer');
  });

  it('create posts payload and returns meta', async () => {
    let captured: unknown = null;
    server.use(
      http.post('http://localhost/api/subagents', async ({ request }) => {
        captured = await request.json();
        return HttpResponse.json(
          { id: 'sX', name: 'designer', createdAt: 1, updatedAt: 1 },
          { status: 201 },
        );
      }),
    );
    const meta = await subagentsApi.create({
      name: 'designer',
      systemInstruction: 'Design.',
      skills: [],
      tools: [],
    });
    expect(meta.id).toBe('sX');
    expect(captured).toEqual({ name: 'designer', systemInstruction: 'Design.', skills: [], tools: [] });
  });

  it('update PUTs and returns meta', async () => {
    server.use(
      http.put('http://localhost/api/subagents/s1', () =>
        HttpResponse.json({ id: 's1', name: 'designer', createdAt: 1, updatedAt: 5 }),
      ),
    );
    const meta = await subagentsApi.update('s1', { systemInstruction: 'new' });
    expect(meta.updatedAt).toBe(5);
  });

  it('delete returns void on 204', async () => {
    server.use(
      http.delete('http://localhost/api/subagents/s1', () => new HttpResponse(null, { status: 204 })),
    );
    await expect(subagentsApi.delete('s1')).resolves.toBeUndefined();
  });

  it('throws on non-OK', async () => {
    server.use(
      http.post('http://localhost/api/subagents', () =>
        HttpResponse.json({ error: { message: 'bad' } }, { status: 400 }),
      ),
    );
    await expect(subagentsApi.create({ name: '1bad' })).rejects.toThrow();
  });
});
