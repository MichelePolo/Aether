import { describe, it, expect, beforeEach } from 'vitest';
import { http, HttpResponse } from 'msw';
import { server } from '@/src/test/msw-server';
import { useSubAgentsStore } from './subagents.store';

beforeEach(() => {
  useSubAgentsStore.getState()._reset();
});

describe('useSubAgentsStore', () => {
  it('init populates list from API', async () => {
    server.use(
      http.get('http://localhost/api/subagents', () =>
        HttpResponse.json({ subAgents: [{ id: 's1', name: 'd', createdAt: 1, updatedAt: 1 }] }),
      ),
    );
    await useSubAgentsStore.getState().init();
    expect(useSubAgentsStore.getState().list).toHaveLength(1);
    expect(useSubAgentsStore.getState().hydrated).toBe(true);
  });

  it('create appends to list', async () => {
    server.use(
      http.post('http://localhost/api/subagents', () =>
        HttpResponse.json({ id: 'sX', name: 'designer', createdAt: 1, updatedAt: 1 }, { status: 201 }),
      ),
    );
    await useSubAgentsStore.getState().create({ name: 'designer', systemInstruction: 'D.' });
    expect(useSubAgentsStore.getState().list).toHaveLength(1);
    expect(useSubAgentsStore.getState().list[0].name).toBe('designer');
  });

  it('delete removes from list', async () => {
    useSubAgentsStore.setState({
      list: [{ id: 's1', name: 'd', createdAt: 0, updatedAt: 0 }],
      hydrated: true,
    });
    server.use(
      http.delete('http://localhost/api/subagents/s1', () => new HttpResponse(null, { status: 204 })),
    );
    await useSubAgentsStore.getState().delete('s1');
    expect(useSubAgentsStore.getState().list).toHaveLength(0);
  });

  it('sets error on API failure', async () => {
    server.use(
      http.post('http://localhost/api/subagents', () =>
        HttpResponse.json({ error: { message: 'Boom' } }, { status: 400 }),
      ),
    );
    await expect(useSubAgentsStore.getState().create({ name: '1bad' })).rejects.toThrow();
    expect(useSubAgentsStore.getState().error).toBe('Boom');
  });

  it('clearError resets error', () => {
    useSubAgentsStore.setState({ error: 'x' });
    useSubAgentsStore.getState().clearError();
    expect(useSubAgentsStore.getState().error).toBeNull();
  });
});
