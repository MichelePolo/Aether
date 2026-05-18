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
];
