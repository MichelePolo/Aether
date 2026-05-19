import '@testing-library/jest-dom/vitest';
import { afterEach, beforeAll, afterAll } from 'vitest';
import { cleanup } from '@testing-library/react';
import { server } from './msw-server';

// jsdom does not implement ResizeObserver; polyfill for cmdk and similar libs
if (typeof globalThis.ResizeObserver === 'undefined') {
  globalThis.ResizeObserver = class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}

// jsdom does not implement scrollIntoView; polyfill for cmdk
if (typeof Element.prototype.scrollIntoView === 'undefined') {
  Element.prototype.scrollIntoView = function () {};
}

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
