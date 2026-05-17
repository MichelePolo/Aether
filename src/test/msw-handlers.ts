import { http, HttpResponse } from 'msw';

// Base URL convenzionale per i test (jsdom + msw/node).
// Negli Slice successivi qui aggiungiamo handlers per /api/context, /api/profiles, /api/mcp/*, /api/ai/dispatch.
export const handlers = [
  http.get('http://localhost/api/__health', () => HttpResponse.json({ ok: true })),
];
