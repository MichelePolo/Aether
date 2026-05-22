import { http, HttpResponse } from 'msw';
import type { AetherContext } from '@/src/types/context.types';

const defaultContext: AetherContext = {
  systemInstruction: 'You are Aether',
  skills: [],
  tools: [],
  mcpServers: [],
};

export const handlers = [
  http.get('http://localhost/api/__health', () => HttpResponse.json({ ok: true })),
  http.get('http://localhost/api/context', () => HttpResponse.json(defaultContext)),
  http.get('http://localhost/api/sessions', () => HttpResponse.json({ sessions: [] })),
  http.post('http://localhost/api/sessions', () =>
    HttpResponse.json(
      { id: 'msw-session-1', title: '', createdAt: 0, updatedAt: 0 },
      { status: 201 },
    ),
  ),
  http.get('http://localhost/api/sessions/:id', () => HttpResponse.json({ messages: [] })),
  http.patch('http://localhost/api/sessions/:id', ({ params }) =>
    HttpResponse.json({ id: params.id, title: 'renamed', createdAt: 0, updatedAt: 0 }),
  ),
  http.delete('http://localhost/api/sessions/:id', () => new HttpResponse(null, { status: 204 })),
  http.get('http://localhost/api/profiles', () => HttpResponse.json({ profiles: [] })),
  http.post('http://localhost/api/profiles', () =>
    HttpResponse.json(
      { id: 'msw-prof-1', name: 'New', createdAt: 0, updatedAt: 0 },
      { status: 201 },
    ),
  ),
  http.get('http://localhost/api/profiles/:id', () =>
    HttpResponse.json({
      name: 'msw',
      createdAt: 0,
      updatedAt: 0,
      context: { systemInstruction: '', skills: [], tools: [], mcpServers: [] },
      thinkingEnabled: false,
    }),
  ),
  http.put('http://localhost/api/profiles/:id', ({ params }) =>
    HttpResponse.json({ id: params.id, name: 'msw', createdAt: 0, updatedAt: 1 }),
  ),
  http.patch('http://localhost/api/profiles/:id', ({ params }) =>
    HttpResponse.json({ id: params.id, name: 'renamed', createdAt: 0, updatedAt: 1 }),
  ),
  http.delete('http://localhost/api/profiles/:id', () => new HttpResponse(null, { status: 204 })),
  http.post('http://localhost/api/profiles/import', () =>
    HttpResponse.json(
      { id: 'msw-imp-1', name: 'Imported', createdAt: 0, updatedAt: 0 },
      { status: 201 },
    ),
  ),
  http.get('http://localhost/api/subagents', () => HttpResponse.json({ subAgents: [] })),
  http.post('http://localhost/api/subagents', async ({ request }) => {
    const body = (await request.json()) as { name: string };
    return HttpResponse.json(
      { id: `sa-${Date.now()}`, name: body.name, createdAt: Date.now(), updatedAt: Date.now() },
      { status: 201 },
    );
  }),
  http.get('http://localhost/api/subagents/:id', ({ params }) =>
    HttpResponse.json({
      id: params.id,
      name: 'default',
      systemInstruction: '',
      skills: [],
      tools: [],
      createdAt: 1,
      updatedAt: 1,
    }),
  ),
  http.put('http://localhost/api/subagents/:id', ({ params }) =>
    HttpResponse.json({
      id: params.id,
      name: 'updated',
      createdAt: 1,
      updatedAt: Date.now(),
    }),
  ),
  http.delete('http://localhost/api/subagents/:id', () => new HttpResponse(null, { status: 204 })),
  http.post('http://localhost/api/mcp/:id/connect', () =>
    HttpResponse.json({ state: 'online', tools: [] }),
  ),
  http.post('http://localhost/api/mcp/:id/disconnect', () => new HttpResponse(null, { status: 204 })),
  http.get('http://localhost/api/mcp/tools', () => HttpResponse.json({ tools: [] })),
  http.patch('http://localhost/api/mcp/:id/tools/:name', async ({ request }) => {
    const body = (await request.json()) as { autoApprove: boolean };
    return HttpResponse.json(body);
  }),
  http.post('http://localhost/api/mcp/decision', () => new HttpResponse(null, { status: 204 })),
  http.get('http://localhost/api/mcp/state', () => HttpResponse.json({ servers: [] })),
  http.post('http://localhost/api/mcp/:id/refresh-tools', () =>
    HttpResponse.json({ tools: [] }),
  ),
  http.post('http://localhost/api/mcp/cancel-call', () =>
    new HttpResponse(null, { status: 204 }),
  ),
  http.get('http://localhost/api/providers', () =>
    HttpResponse.json({
      providers: [
        {
          name: 'fake:default',
          transport: 'fake',
          model: 'default',
          capabilities: { thinking: true, toolCalling: true },
          displayName: 'Fake (default)',
        },
      ],
    }),
  ),
  http.post('http://localhost/api/providers/refresh', () =>
    HttpResponse.json({ providers: [] }),
  ),
  http.get('http://localhost/api/providers/default', () =>
    HttpResponse.json({ name: 'fake:default' }),
  ),
  http.get('http://localhost/api/search', () =>
    HttpResponse.json({ results: [] }),
  ),
  http.get('http://localhost/api/sessions/:id/export', ({ params }) =>
    HttpResponse.json({
      app: 'aether',
      version: 1,
      exportedAt: 0,
      session: {
        title: `exported-${params.id}`,
        createdAt: 0,
        messages: [],
      },
    }),
  ),
  http.post('http://localhost/api/sessions/import', async ({ request }) => {
    const body = (await request.json()) as { session?: { title?: string } };
    return HttpResponse.json(
      {
        id: `imp-${Date.now()}`,
        title: body?.session?.title ?? 'imported',
        createdAt: Date.now(),
        updatedAt: Date.now(),
      },
      { status: 201 },
    );
  }),
];
