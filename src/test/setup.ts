import '@testing-library/jest-dom/vitest';
import { afterEach, beforeAll, afterAll } from 'vitest';
import { cleanup } from '@testing-library/react';
import { server } from './msw-server';

// Strict mode: ogni fetch non mockato fa fallire il test, forzando handler espliciti.
// `onUnhandledRequest` deve essere passato qui (API MSW v2: setupServer accetta solo
// gli handlers, le options vanno a listen).
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));

// Ordine: resetHandlers prima di cleanup, così se un unmount triggera fetch
// (race condition teardown) non collide con handler "sporchi" del test precedente.
afterEach(() => {
  server.resetHandlers();
  cleanup();
});

afterAll(() => server.close());
