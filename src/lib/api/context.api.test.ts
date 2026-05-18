import { describe, it, expect } from 'vitest';
import { http, HttpResponse } from 'msw';
import { server } from '@/src/test/msw-server';
import { contextApi } from './context.api';

describe('contextApi', () => {
  it('fetches context', async () => {
    server.use(
      http.get('http://localhost/api/context', () =>
        HttpResponse.json({
          systemInstruction: 'Hi',
          skills: ['a'],
          tools: [],
          mcpServers: [],
        }),
      ),
    );
    const ctx = await contextApi.get();
    expect(ctx.systemInstruction).toBe('Hi');
  });

  it('patches context', async () => {
    server.use(
      http.patch('http://localhost/api/context', async ({ request }) => {
        const body = (await request.json()) as { systemInstruction: string };
        return HttpResponse.json({
          systemInstruction: body.systemInstruction,
          skills: [],
          tools: [],
          mcpServers: [],
        });
      }),
    );
    const ctx = await contextApi.patch({ systemInstruction: 'Updated' });
    expect(ctx.systemInstruction).toBe('Updated');
  });

  it('adds a skill (204 → undefined)', async () => {
    server.use(
      http.post('http://localhost/api/context/skills', () =>
        HttpResponse.json({ status: 'ok' }, { status: 201 }),
      ),
    );
    await expect(contextApi.addSkill('Skill1')).resolves.toBeUndefined();
  });

  it('throws on 400 with error.message', async () => {
    server.use(
      http.post('http://localhost/api/context/skills', () =>
        HttpResponse.json(
          { error: { code: 'VALIDATION_ERROR', message: 'Empty' } },
          { status: 400 },
        ),
      ),
    );
    await expect(contextApi.addSkill('')).rejects.toThrow(/Empty/);
  });

  it('adds a tool returning the created object', async () => {
    server.use(
      http.post('http://localhost/api/context/tools', () =>
        HttpResponse.json(
          { id: 't1', name: 'X', version: '1.0', status: 'online' },
          { status: 201 },
        ),
      ),
    );
    const tool = await contextApi.addTool({ name: 'X', version: '1.0', status: 'online' });
    expect(tool).toEqual({ id: 't1', name: 'X', version: '1.0', status: 'online' });
  });

  it('removes a tool (204)', async () => {
    server.use(
      http.delete(
        'http://localhost/api/context/tools/abc',
        () => new HttpResponse(null, { status: 204 }),
      ),
    );
    await expect(contextApi.removeTool('abc')).resolves.toBeUndefined();
  });

  it('removes an mcp server', async () => {
    server.use(
      http.delete(
        'http://localhost/api/context/mcp-servers/m1',
        () => new HttpResponse(null, { status: 204 }),
      ),
    );
    await expect(contextApi.removeMcpServer('m1')).resolves.toBeUndefined();
  });

  it('bulkOverwrite PUTs whole context and returns new state', async () => {
    const incoming = {
      systemInstruction: 'New',
      skills: ['s'],
      tools: [],
      mcpServers: [],
    };
    server.use(
      http.put('http://localhost/api/context', async ({ request }) => {
        const body = (await request.json()) as typeof incoming;
        return HttpResponse.json(body);
      }),
    );
    const out = await contextApi.bulkOverwrite(incoming);
    expect(out).toEqual(incoming);
  });

  it('updateSkillAt PATCHes and resolves on 204', async () => {
    server.use(
      http.patch(
        'http://localhost/api/context/skills/2',
        () => new HttpResponse(null, { status: 204 }),
      ),
    );
    await expect(contextApi.updateSkillAt(2, 'v')).resolves.toBeUndefined();
  });

  it('removeSkillAt DELETEs and resolves on 204', async () => {
    server.use(
      http.delete(
        'http://localhost/api/context/skills/3',
        () => new HttpResponse(null, { status: 204 }),
      ),
    );
    await expect(contextApi.removeSkillAt(3)).resolves.toBeUndefined();
  });

  it('updateTool PATCHes and resolves on 204', async () => {
    server.use(
      http.patch(
        'http://localhost/api/context/tools/abc',
        () => new HttpResponse(null, { status: 204 }),
      ),
    );
    await expect(contextApi.updateTool('abc', { name: 'Y' })).resolves.toBeUndefined();
  });

  it('addMcpServer POSTs and returns server object', async () => {
    const srv = { id: 'm1', name: 'M', url: 'http://m', status: 'online' as const };
    server.use(
      http.post(
        'http://localhost/api/context/mcp-servers',
        () => HttpResponse.json(srv, { status: 201 }),
      ),
    );
    const out = await contextApi.addMcpServer({ name: 'M', url: 'http://m', status: 'online' });
    expect(out).toEqual(srv);
  });

  it('falls back to HTTP <status> message when error body is empty', async () => {
    server.use(
      http.delete(
        'http://localhost/api/context/tools/none',
        () => new HttpResponse(null, { status: 500 }),
      ),
    );
    await expect(contextApi.removeTool('none')).rejects.toThrow(/HTTP 500/);
  });
});
