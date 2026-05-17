import { describe, it, expect, beforeEach } from 'vitest';
import { http, HttpResponse } from 'msw';
import { server } from '@/src/test/msw-server';
import { useContextStore } from './context.store';

const fixture = {
  systemInstruction: 'You are X',
  skills: ['s1', 's2'],
  tools: [],
  mcpServers: [],
};

beforeEach(() => {
  useContextStore.getState()._reset();
});

describe('useContextStore', () => {
  it('init fetches context', async () => {
    server.use(http.get('http://localhost/api/context', () => HttpResponse.json(fixture)));
    await useContextStore.getState().init();
    expect(useContextStore.getState().context).toEqual(fixture);
    expect(useContextStore.getState().isLoading).toBe(false);
  });

  it('init sets error on fetch failure', async () => {
    server.use(
      http.get('http://localhost/api/context', () =>
        HttpResponse.json({ error: { message: 'Boom' } }, { status: 500 }),
      ),
    );
    await useContextStore.getState().init();
    expect(useContextStore.getState().error).toMatch(/Boom/);
    expect(useContextStore.getState().context).toBeNull();
  });

  it('addSkill appends optimistically', async () => {
    server.use(
      http.get('http://localhost/api/context', () => HttpResponse.json(fixture)),
      http.post('http://localhost/api/context/skills', () =>
        HttpResponse.json({ status: 'ok' }, { status: 201 }),
      ),
    );
    await useContextStore.getState().init();
    await useContextStore.getState().addSkill('s3');
    expect(useContextStore.getState().context?.skills).toEqual(['s1', 's2', 's3']);
  });

  it('addSkill rolls back on error', async () => {
    server.use(
      http.get('http://localhost/api/context', () => HttpResponse.json(fixture)),
      http.post('http://localhost/api/context/skills', () =>
        HttpResponse.json({ error: { message: 'bad' } }, { status: 400 }),
      ),
    );
    await useContextStore.getState().init();
    await expect(useContextStore.getState().addSkill('s3')).rejects.toThrow();
    expect(useContextStore.getState().context?.skills).toEqual(['s1', 's2']);
    expect(useContextStore.getState().error).toMatch(/bad/);
  });

  it('removeSkillAt removes optimistically', async () => {
    server.use(
      http.get('http://localhost/api/context', () => HttpResponse.json(fixture)),
      http.delete(
        'http://localhost/api/context/skills/0',
        () => new HttpResponse(null, { status: 204 }),
      ),
    );
    await useContextStore.getState().init();
    await useContextStore.getState().removeSkillAt(0);
    expect(useContextStore.getState().context?.skills).toEqual(['s2']);
  });

  it('addTool adds with returned id', async () => {
    const tool = { id: 't-1', name: 'Search', version: '1.0', status: 'online' as const };
    server.use(
      http.get('http://localhost/api/context', () => HttpResponse.json(fixture)),
      http.post('http://localhost/api/context/tools', () => HttpResponse.json(tool, { status: 201 })),
    );
    await useContextStore.getState().init();
    await useContextStore.getState().addTool({ name: 'Search', version: '1.0', status: 'online' });
    expect(useContextStore.getState().context?.tools).toContainEqual(tool);
  });

  it('removeTool removes optimistically and rolls back on error', async () => {
    const fix = {
      ...fixture,
      tools: [{ id: 't1', name: 'X', version: '1.0', status: 'online' as const }],
    };
    server.use(
      http.get('http://localhost/api/context', () => HttpResponse.json(fix)),
      http.delete('http://localhost/api/context/tools/t1', () =>
        HttpResponse.json({ error: { message: 'gone' } }, { status: 404 }),
      ),
    );
    await useContextStore.getState().init();
    await expect(useContextStore.getState().removeTool('t1')).rejects.toThrow();
    expect(useContextStore.getState().context?.tools).toEqual(fix.tools);
  });

  it('setSystemInstruction patches and updates context', async () => {
    server.use(
      http.get('http://localhost/api/context', () => HttpResponse.json(fixture)),
      http.patch('http://localhost/api/context', () =>
        HttpResponse.json({ ...fixture, systemInstruction: 'Updated' }),
      ),
    );
    await useContextStore.getState().init();
    await useContextStore.getState().setSystemInstruction('Updated');
    expect(useContextStore.getState().context?.systemInstruction).toBe('Updated');
  });
});
