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
  http.get('http://localhost/api/sessions/default', () =>
    HttpResponse.json({ messages: [] }),
  ),
];
