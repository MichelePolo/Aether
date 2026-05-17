import { http, HttpResponse } from 'msw';
import type { AetherContext } from '@/src/types/context.types';

// Base URL convenzionale per i test (jsdom configurato con url='http://localhost/').
// Negli Slice successivi qui aggiungiamo handlers per /api/profiles, /api/mcp/*, /api/ai/dispatch.
const defaultContext: AetherContext = {
  systemInstruction: 'You are Aether',
  skills: [],
  tools: [],
  mcpServers: [],
};

export const handlers = [
  http.get('http://localhost/api/__health', () => HttpResponse.json({ ok: true })),
  http.get('http://localhost/api/context', () => HttpResponse.json(defaultContext)),
];
