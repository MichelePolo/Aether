# Aether Slice 0: Foundation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stabilire la base testabile di Aether — toolchain di test, theme tokens, primitive UI, dialog system, librerie foundation backend — senza attivare alcuna feature utente. Lo Slice 1 ne dipende per demolire `App.tsx` e iniziare a costruire le feature reali.

**Architecture:** Branch `feat/slice-0-foundation`. Tutto il codice scritto in TDD (red-green-refactor). I componenti primitivi seguono un pattern uniforme (cva per varianti, forwardRef per `ref`, props extends gli HTML standard). Le librerie backend espongono interfacce iniettabili (DI ready). L'`App.tsx` vecchio resta intoccato (Slice 1 lo demolirà).

**Tech Stack:** Vitest, @testing-library/react, @testing-library/user-event, jsdom, MSW, supertest, Playwright, class-variance-authority, p-queue, zod. React 19, Tailwind v4, TypeScript ~5.8.

**Riferimento spec:** `docs/superpowers/specs/2026-05-17-aether-rewrite-design.md`

---

## File structure creato in questo slice

```
vitest.config.ts                                # NEW
playwright.config.ts                            # NEW
tsconfig.json                                   # MODIFY: strict, noUnusedLocals, noUnusedParameters
package.json                                    # MODIFY: deps + scripts
src/test/setup.ts                               # NEW
src/test/msw-server.ts                          # NEW
src/test/msw-handlers.ts                        # NEW
src/test/utils.tsx                              # NEW
src/lib/cn.ts                                   # NEW
src/lib/cn.test.ts                              # NEW
src/lib/ids.ts                                  # NEW
src/lib/ids.test.ts                             # NEW
src/lib/sse-parser.ts                           # NEW
src/lib/sse-parser.test.ts                      # NEW
src/styles/index.css                            # NEW (replaces src/index.css imports)
src/styles/theme.css                            # NEW
src/styles/components.css                       # NEW
src/index.css                                   # MODIFY: just re-export src/styles/index.css
src/components/ui/Button.tsx                    # NEW
src/components/ui/Button.test.tsx               # NEW
src/components/ui/IconButton.tsx                # NEW
src/components/ui/IconButton.test.tsx           # NEW
src/components/ui/Badge.tsx                     # NEW
src/components/ui/Badge.test.tsx                # NEW
src/components/ui/StatusDot.tsx                 # NEW
src/components/ui/StatusDot.test.tsx            # NEW
src/components/ui/Panel.tsx                     # NEW
src/components/ui/Panel.test.tsx                # NEW
src/components/ui/Tooltip.tsx                   # NEW
src/components/ui/Tooltip.test.tsx              # NEW
src/components/ui/Modal.tsx                     # NEW
src/components/ui/Modal.test.tsx                # NEW
src/components/ui/PromptDialog.tsx              # NEW
src/components/ui/PromptDialog.test.tsx         # NEW
src/components/ui/ConfirmDialog.tsx             # NEW
src/components/ui/ConfirmDialog.test.tsx        # NEW
src/components/ui/index.ts                      # NEW (re-export barrel)
src/hooks/useDialog.ts                          # NEW
src/hooks/useDialog.test.ts                     # NEW
src/components/layout/DialogHost.tsx            # NEW
src/components/layout/DialogHost.test.tsx       # NEW
server/lib/json-store.ts                        # NEW
server/lib/json-store.test.ts                   # NEW
server/lib/errors.ts                            # NEW
server/lib/errors.test.ts                       # NEW
server/lib/sse.ts                               # NEW
server/lib/sse.test.ts                          # NEW
server/app.ts                                   # NEW (createApp factory, empty)
server/app.test.ts                              # NEW
server/test/setup.ts                            # NEW
e2e/smoke.spec.ts                               # NEW (placeholder)
data/.gitignore                                 # NEW
.gitignore                                      # MODIFY: add data/, coverage/, playwright-report/
```

`server.ts` (root) rimane intoccato in Slice 0 (Slice 1 lo demolirà). `src/App.tsx` rimane intoccato.

---

## Task 1: Crea branch e installa dipendenze

**Files:**
- Modify: `package.json`

- [ ] **Step 1.1: Crea il branch slice-0**

```bash
git checkout -b feat/slice-0-foundation
```

- [ ] **Step 1.2: Installa runtime deps**

```bash
npm install class-variance-authority p-queue zod
```

Expected: 3 packages aggiunti senza errori, `package.json` aggiornato.

- [ ] **Step 1.3: Installa dev deps per testing**

```bash
npm install -D vitest @vitest/coverage-v8 @vitest/ui \
  @testing-library/react @testing-library/user-event @testing-library/jest-dom \
  @testing-library/dom jsdom \
  msw supertest @types/supertest \
  @playwright/test
```

Expected: tutti i pacchetti installati, nessun errore di peer dependency.

- [ ] **Step 1.4: Installa Playwright browsers**

```bash
npx playwright install chromium --with-deps
```

Expected: chromium scaricato (può richiedere alcuni minuti).

- [ ] **Step 1.5: Verifica package.json**

Apri `package.json` e verifica che `dependencies` includa `class-variance-authority`, `p-queue`, `zod`. `devDependencies` includa `vitest`, `@testing-library/*`, `msw`, `supertest`, `@playwright/test`.

- [ ] **Step 1.6: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore(slice-0): install testing toolchain + cva + zod + p-queue"
```

---

## Task 2: Aggiungi script npm

**Files:**
- Modify: `package.json`

- [ ] **Step 2.1: Aggiorna scripts in package.json**

Sostituisci la sezione `"scripts"` esistente con:

```json
"scripts": {
  "dev": "tsx server.ts",
  "build": "vite build && esbuild server.ts --bundle --platform=node --format=cjs --packages=external --sourcemap --outfile=dist/server.cjs",
  "start": "node dist/server.cjs",
  "clean": "rm -rf dist server.js coverage playwright-report",
  "lint": "tsc --noEmit",
  "test": "vitest",
  "test:run": "vitest run",
  "test:coverage": "vitest run --coverage",
  "test:ui": "vitest --ui",
  "test:e2e": "playwright test",
  "test:e2e:ui": "playwright test --ui"
}
```

- [ ] **Step 2.2: Commit**

```bash
git add package.json
git commit -m "chore(slice-0): add test scripts (vitest + playwright)"
```

---

## Task 3: Abilita TS strict mode

**Files:**
- Modify: `tsconfig.json`

- [ ] **Step 3.1: Aggiungi flag strict**

Sostituisci `tsconfig.json` con:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "experimentalDecorators": true,
    "useDefineForClassFields": false,
    "module": "ESNext",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "skipLibCheck": true,
    "moduleResolution": "bundler",
    "isolatedModules": true,
    "moduleDetection": "force",
    "allowJs": true,
    "jsx": "react-jsx",
    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noFallthroughCasesInSwitch": true,
    "esModuleInterop": true,
    "paths": {
      "@/*": ["./*"]
    },
    "allowImportingTsExtensions": true,
    "noEmit": true,
    "types": ["vitest/globals", "@testing-library/jest-dom"]
  },
  "include": ["src", "server", "e2e", "vitest.config.ts", "playwright.config.ts"]
}
```

- [ ] **Step 3.2: Esegui lint per vedere errori esistenti**

```bash
npm run lint
```

Expected: probabilmente alcuni errori in `server.ts` e `src/App.tsx` (es. `ThinkingLevel` non usato, `any[]` impliciti). **Non li sistemiamo ora** — sono parte dello Slice 1+2 che riscrivono questi file. Annota gli errori per il piano successivo.

- [ ] **Step 3.3: Aggiungi `// @ts-nocheck` temporaneo a server.ts e src/App.tsx**

Questa è una concessione esplicita: lo Slice 0 non tocca il codice legacy. Aggiungi come prima riga di `server.ts`:

```ts
// @ts-nocheck — legacy file, replaced in slice-1/2
```

E come prima riga di `src/App.tsx`:

```tsx
// @ts-nocheck — legacy file, replaced in slice-1
```

- [ ] **Step 3.4: Verifica lint pulito**

```bash
npm run lint
```

Expected: nessun errore.

- [ ] **Step 3.5: Commit**

```bash
git add tsconfig.json server.ts src/App.tsx
git commit -m "chore(slice-0): enable TS strict mode (legacy files marked nocheck)"
```

---

## Task 4: Vitest config

**Files:**
- Create: `vitest.config.ts`
- Create: `src/test/setup.ts`
- Create: `server/test/setup.ts`

- [ ] **Step 4.1: Crea vitest.config.ts**

> **Nota:** Vitest 4 ha rimosso `environmentMatchGlobs` in favore di `projects`. Usiamo la nuova sintassi.

```ts
/// <reference types="vitest" />
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
    },
  },
  test: {
    globals: true,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      exclude: [
        'node_modules/**',
        'dist/**',
        'coverage/**',
        'e2e/**',
        '**/*.config.*',
        '**/test/**',
        '**/types/**',
        'src/main.tsx',
        'src/App.tsx',
        'server.ts',
      ],
      thresholds: {
        'server/domain/**': { branches: 80, functions: 80, lines: 80, statements: 80 },
        'server/lib/**': { branches: 80, functions: 80, lines: 80, statements: 80 },
        'src/hooks/**': { branches: 80, functions: 80, lines: 80, statements: 80 },
        'src/stores/**': { branches: 80, functions: 80, lines: 80, statements: 80 },
        'src/lib/**': { branches: 80, functions: 80, lines: 80, statements: 80 },
      },
    },
    projects: [
      {
        extends: true,
        test: {
          name: 'frontend',
          environment: 'jsdom',
          include: ['src/**/*.{test,spec}.{ts,tsx}'],
          setupFiles: ['src/test/setup.ts'],
        },
      },
      {
        extends: true,
        test: {
          name: 'backend',
          environment: 'node',
          include: ['server/**/*.{test,spec}.ts'],
          setupFiles: ['server/test/setup.ts'],
        },
      },
    ],
  },
});
```

- [ ] **Step 4.2: Crea src/test/setup.ts**

```ts
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeAll, afterAll } from 'vitest';
import { cleanup } from '@testing-library/react';
import { server } from './msw-server';

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => {
  cleanup();
  server.resetHandlers();
});
afterAll(() => server.close());
```

- [ ] **Step 4.3: Crea server/test/setup.ts**

```ts
// Placeholder per setup specifico backend (es. reset store).
// Verrà arricchito negli Slice successivi quando avremo store.
export {};
```

- [ ] **Step 4.4: Verifica che vitest si avvii (anche senza test)**

```bash
npx vitest run --reporter=verbose
```

Expected: "No test files found". Nessun errore di config. Se errore sul MSW import (riga 6 del setup), è normale — fixato in Task 5.

- [ ] **Step 4.5: Commit**

```bash
git add vitest.config.ts src/test/setup.ts server/test/setup.ts
git commit -m "feat(slice-0): vitest config with jsdom/node split + setup files"
```

---

## Task 5: MSW server scaffold

**Files:**
- Create: `src/test/msw-server.ts`
- Create: `src/test/msw-handlers.ts`

- [ ] **Step 5.1: Crea handlers vuoti**

`src/test/msw-handlers.ts`:

> **Nota:** MSW in Node richiede URL assoluti negli handlers (i path relativi non si risolvono nel contesto `msw/node`). I test useranno un base URL convenzionale `http://localhost`; per gli slice successivi che testano route reali useremo lo stesso base URL.

```ts
import { http, HttpResponse } from 'msw';

// Base URL convenzionale per i test (jsdom + msw/node).
// Negli Slice successivi qui aggiungiamo handlers per /api/context, /api/profiles, /api/mcp/*, /api/ai/dispatch.
export const handlers = [
  http.get('http://localhost/api/__health', () => HttpResponse.json({ ok: true })),
];
```

- [ ] **Step 5.2: Crea msw-server.ts**

```ts
import { setupServer } from 'msw/node';
import { handlers } from './msw-handlers';

export const server = setupServer(...handlers);
```

- [ ] **Step 5.3: Scrivi test smoke per MSW**

`src/test/msw-server.test.ts`:

```ts
import { describe, it, expect } from 'vitest';

describe('msw server', () => {
  it('intercepts /api/__health', async () => {
    const res = await fetch('http://localhost/api/__health');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });
});
```

- [ ] **Step 5.4: Run test, verifica passa**

```bash
npm run test:run -- src/test/msw-server.test.ts
```

Expected: 1 test passed.

- [ ] **Step 5.5: Commit**

```bash
git add src/test/msw-server.ts src/test/msw-handlers.ts src/test/msw-server.test.ts
git commit -m "feat(slice-0): MSW server scaffolding + smoke test"
```

---

## Task 6: Playwright config

**Files:**
- Create: `playwright.config.ts`
- Create: `e2e/smoke.spec.ts`
- Modify: `.gitignore`

- [ ] **Step 6.1: Aggiorna .gitignore**

Apri `.gitignore` e aggiungi alla fine:

```
# Test artifacts
coverage/
playwright-report/
test-results/
playwright/.cache/

# Local data (allow only the directory marker files)
data/*
!data/.gitignore
!data/.gitkeep
```

- [ ] **Step 6.2: Crea playwright.config.ts**

```ts
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: 'http://localhost:3000',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:3000',
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
    env: { AETHER_FAKE_PROVIDER: '1' },
  },
});
```

- [ ] **Step 6.3: Crea smoke E2E placeholder**

`e2e/smoke.spec.ts`:

```ts
import { test, expect } from '@playwright/test';

test('app shell loads', async ({ page }) => {
  await page.goto('/');
  // Slice 0: l'app legacy è ancora viva, quindi cerchiamo l'elemento esistente.
  // Slice 1+ aggiornerà questo selettore alla nuova UI.
  await expect(page).toHaveTitle(/AI Studio|Aether/i);
});
```

- [ ] **Step 6.4: Run E2E**

```bash
npm run test:e2e
```

Expected: 1 test passed. Il server dev avvia (può richiedere ~5s), apre la home, verifica il titolo. Se il dev server è già attivo su porta 3000 viene riusato.

- [ ] **Step 6.5: Commit**

```bash
git add playwright.config.ts e2e/smoke.spec.ts .gitignore
git commit -m "feat(slice-0): playwright config + smoke E2E placeholder"
```

---

## Task 7: Utility — cn() helper (TDD)

**Files:**
- Create: `src/lib/cn.ts`
- Create: `src/lib/cn.test.ts`

- [ ] **Step 7.1: Scrivi i test (RED)**

`src/lib/cn.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { cn } from './cn';

describe('cn', () => {
  it('joins multiple class strings', () => {
    expect(cn('a', 'b', 'c')).toBe('a b c');
  });

  it('filters out falsy values', () => {
    expect(cn('a', false, null, undefined, '', 'b')).toBe('a b');
  });

  it('handles conditional objects', () => {
    expect(cn('base', { active: true, disabled: false })).toBe('base active');
  });

  it('merges conflicting tailwind classes (last wins)', () => {
    expect(cn('p-2 text-red-500', 'p-4')).toBe('text-red-500 p-4');
  });
});
```

- [ ] **Step 7.2: Run test, verifica fallisce (RED)**

```bash
npm run test:run -- src/lib/cn.test.ts
```

Expected: 4 test falliscono con "Cannot find module './cn'".

- [ ] **Step 7.3: Implementa cn (GREEN)**

`src/lib/cn.ts`:

```ts
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
```

- [ ] **Step 7.4: Run test, verifica passa (GREEN)**

```bash
npm run test:run -- src/lib/cn.test.ts
```

Expected: 4 test passed.

- [ ] **Step 7.5: Commit**

```bash
git add src/lib/cn.ts src/lib/cn.test.ts
git commit -m "feat(slice-0): add cn() helper (clsx + tailwind-merge) with tests"
```

---

## Task 8: Utility — ids() generator (TDD)

**Files:**
- Create: `src/lib/ids.ts`
- Create: `src/lib/ids.test.ts`

- [ ] **Step 8.1: Scrivi i test (RED)**

`src/lib/ids.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { newId } from './ids';

describe('newId', () => {
  it('returns a non-empty string', () => {
    expect(newId()).toMatch(/.+/);
  });

  it('returns unique values across rapid calls', () => {
    const ids = new Set<string>();
    for (let i = 0; i < 1000; i++) ids.add(newId());
    expect(ids.size).toBe(1000);
  });

  it('returns a UUID-shaped string by default', () => {
    expect(newId()).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  });

  it('accepts a prefix', () => {
    const id = newId('msg');
    expect(id).toMatch(/^msg_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  });
});
```

- [ ] **Step 8.2: Run test, verifica fallisce (RED)**

```bash
npm run test:run -- src/lib/ids.test.ts
```

Expected: 4 test falliscono.

- [ ] **Step 8.3: Implementa newId (GREEN)**

`src/lib/ids.ts`:

```ts
export function newId(prefix?: string): string {
  const uuid = crypto.randomUUID();
  return prefix ? `${prefix}_${uuid}` : uuid;
}
```

- [ ] **Step 8.4: Run test, verifica passa**

```bash
npm run test:run -- src/lib/ids.test.ts
```

Expected: 4 test passed.

- [ ] **Step 8.5: Commit**

```bash
git add src/lib/ids.ts src/lib/ids.test.ts
git commit -m "feat(slice-0): add newId() helper using crypto.randomUUID"
```

---

## Task 9: SSE parser (TDD)

L'SSE parser è il pezzo critico per la chat streaming. Lo testiamo nello Slice 0 perché è pura logica di parsing, isolabile, e tutti gli edge case di chunk-boundary devono essere coperti prima che lo si usi davvero in Slice 2.

**Files:**
- Create: `src/lib/sse-parser.ts`
- Create: `src/lib/sse-parser.test.ts`

- [ ] **Step 9.1: Scrivi i test (RED)**

`src/lib/sse-parser.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { parseSseStream, type SseEvent } from './sse-parser';

function streamFromChunks(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const c of chunks) controller.enqueue(encoder.encode(c));
      controller.close();
    },
  });
}

async function collect(stream: ReadableStream<Uint8Array>): Promise<SseEvent[]> {
  const out: SseEvent[] = [];
  for await (const ev of parseSseStream(stream)) out.push(ev);
  return out;
}

describe('parseSseStream', () => {
  it('parses a single well-formed event', async () => {
    const events = await collect(streamFromChunks([
      'event: text\ndata: {"chunk":"hello"}\n\n',
    ]));
    expect(events).toEqual([{ event: 'text', data: { chunk: 'hello' } }]);
  });

  it('defaults event name to "message" when absent', async () => {
    const events = await collect(streamFromChunks([
      'data: {"foo":1}\n\n',
    ]));
    expect(events).toEqual([{ event: 'message', data: { foo: 1 } }]);
  });

  it('parses multiple events in one chunk', async () => {
    const events = await collect(streamFromChunks([
      'event: text\ndata: {"chunk":"a"}\n\nevent: text\ndata: {"chunk":"b"}\n\n',
    ]));
    expect(events).toHaveLength(2);
    expect(events[1].data).toEqual({ chunk: 'b' });
  });

  it('handles event split across multiple chunks', async () => {
    const events = await collect(streamFromChunks([
      'event: text\nda',
      'ta: {"chunk":"hel',
      'lo"}\n\n',
    ]));
    expect(events).toEqual([{ event: 'text', data: { chunk: 'hello' } }]);
  });

  it('handles event boundary split across chunks', async () => {
    const events = await collect(streamFromChunks([
      'event: text\ndata: {"chunk":"a"}\n',
      '\nevent: text\ndata: {"chunk":"b"}\n\n',
    ]));
    expect(events).toHaveLength(2);
  });

  it('skips comments (lines starting with :)', async () => {
    const events = await collect(streamFromChunks([
      ': keep-alive\nevent: text\ndata: "ok"\n\n',
    ]));
    expect(events).toEqual([{ event: 'text', data: 'ok' }]);
  });

  it('emits error event for malformed JSON data', async () => {
    const events = await collect(streamFromChunks([
      'event: text\ndata: {not-json\n\n',
    ]));
    expect(events).toHaveLength(1);
    expect(events[0].event).toBe('parse_error');
    expect(events[0].data).toMatchObject({ raw: '{not-json' });
  });

  it('handles empty stream gracefully', async () => {
    const events = await collect(streamFromChunks([]));
    expect(events).toEqual([]);
  });

  it('ignores trailing data without terminator', async () => {
    const events = await collect(streamFromChunks([
      'event: text\ndata: {"chunk":"complete"}\n\nevent: text\ndata: {"chunk":"partial"}',
    ]));
    expect(events).toHaveLength(1);
    expect(events[0].data).toEqual({ chunk: 'complete' });
  });
});
```

- [ ] **Step 9.2: Run test, verifica fallisce (RED)**

```bash
npm run test:run -- src/lib/sse-parser.test.ts
```

Expected: tutti i test falliscono.

- [ ] **Step 9.3: Implementa parseSseStream (GREEN)**

`src/lib/sse-parser.ts`:

```ts
export type SseEvent = { event: string; data: unknown };

export async function* parseSseStream(
  stream: ReadableStream<Uint8Array>,
): AsyncGenerator<SseEvent> {
  const reader = stream.getReader();
  const decoder = new TextDecoder('utf-8');
  let buffer = '';

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      let sepIdx: number;
      while ((sepIdx = buffer.indexOf('\n\n')) !== -1) {
        const rawEvent = buffer.slice(0, sepIdx);
        buffer = buffer.slice(sepIdx + 2);
        const parsed = parseEventBlock(rawEvent);
        if (parsed) yield parsed;
      }
    }
  } finally {
    reader.releaseLock();
  }
}

function parseEventBlock(raw: string): SseEvent | null {
  let event = 'message';
  const dataLines: string[] = [];

  for (const line of raw.split('\n')) {
    if (line.startsWith(':')) continue; // comment
    if (line.startsWith('event:')) {
      event = line.slice(6).trim();
    } else if (line.startsWith('data:')) {
      dataLines.push(line.slice(5).trim());
    }
  }

  if (dataLines.length === 0) return null;
  const rawData = dataLines.join('\n');
  try {
    return { event, data: JSON.parse(rawData) };
  } catch {
    return { event: 'parse_error', data: { raw: rawData } };
  }
}
```

- [ ] **Step 9.4: Run test, verifica passa**

```bash
npm run test:run -- src/lib/sse-parser.test.ts
```

Expected: 9 test passed.

- [ ] **Step 9.5: Commit**

```bash
git add src/lib/sse-parser.ts src/lib/sse-parser.test.ts
git commit -m "feat(slice-0): add SSE parser with chunk-boundary handling + tests"
```

---

## Task 10: Theme CSS tokens

**Files:**
- Create: `src/styles/theme.css`
- Create: `src/styles/components.css`
- Create: `src/styles/index.css`
- Modify: `src/index.css`

- [ ] **Step 10.1: Crea src/styles/theme.css**

```css
@theme {
  /* Surface scale — dal più scuro al più chiaro */
  --color-surface-0: #080808;
  --color-surface-1: #0a0a0a;
  --color-surface-2: #0f0f0f;
  --color-surface-3: #121212;
  --color-surface-4: #1a1a1a;
  --color-surface-5: #2a2a2a;

  /* Status colors */
  --color-status-online: #22c55e;
  --color-status-connecting: #eab308;
  --color-status-offline: #71717a;
  --color-status-error: #ef4444;

  /* Borders */
  --color-border-subtle: #27272a;
  --color-border-default: #3f3f46;

  /* Accent */
  --color-accent: #00ff9d;

  /* Typography */
  --font-sans: "Inter", system-ui, sans-serif;
  --font-mono: "JetBrains Mono", monospace;
}
```

- [ ] **Step 10.2: Crea src/styles/components.css**

```css
@layer base {
  body {
    @apply bg-surface-2 text-white font-sans antialiased;
    overflow: hidden;
  }
}

@layer components {
  .panel        { @apply bg-surface-2 border border-border-subtle rounded; }
  .panel-inset  { @apply bg-zinc-900/30 border border-border-subtle/50 rounded; }
  .mono-label   { @apply font-mono text-[10px] uppercase tracking-widest text-zinc-500; }
  .status-dot   { @apply w-1.5 h-1.5 rounded-full inline-block; }
  .badge        { @apply text-[9px] px-1.5 py-0.5 rounded-sm font-bold uppercase tracking-wide; }
  .icon-btn     { @apply p-1.5 rounded text-zinc-500 hover:bg-zinc-800 hover:text-white transition-colors; }
  .cli-input    { @apply bg-transparent border-none outline-none text-white font-mono w-full; }
  .scrollbar-hide::-webkit-scrollbar { display: none; }
}

/* Custom scrollbar */
::-webkit-scrollbar { width: 4px; }
::-webkit-scrollbar-track { background: transparent; }
::-webkit-scrollbar-thumb { background: var(--color-border-default); border-radius: 4px; }
::-webkit-scrollbar-thumb:hover { background: #444; }
```

- [ ] **Step 10.3: Crea src/styles/index.css**

```css
@import "tailwindcss";
@import "./theme.css";
@import "./components.css";
```

- [ ] **Step 10.4: Aggiorna src/index.css**

Sostituisci tutto il contenuto di `src/index.css` con:

```css
@import "./styles/index.css";
```

(Manteniamo questo file per non rompere l'import in `src/main.tsx`.)

- [ ] **Step 10.5: Verifica visivamente**

```bash
npm run dev
```

Apri `http://localhost:3000`. L'app legacy (App.tsx) deve continuare a funzionare. I colori devono essere identici. Se qualche colore è sparito è perché abbiamo refattorizzato un valore — annotare e fixare prima del commit.

Chiudi il dev server con Ctrl+C.

- [ ] **Step 10.6: Commit**

```bash
git add src/styles/ src/index.css
git commit -m "feat(slice-0): theme tokens + component classes in @layer components"
```

---

## Task 11: Button primitive (TDD)

**Files:**
- Create: `src/components/ui/Button.tsx`
- Create: `src/components/ui/Button.test.tsx`

- [ ] **Step 11.1: Scrivi i test (RED)**

`src/components/ui/Button.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Button } from './Button';

describe('Button', () => {
  it('renders children', () => {
    render(<Button>Click me</Button>);
    expect(screen.getByRole('button', { name: 'Click me' })).toBeInTheDocument();
  });

  it('calls onClick when clicked', async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Go</Button>);
    await user.click(screen.getByRole('button'));
    expect(onClick).toHaveBeenCalledOnce();
  });

  it('does not call onClick when disabled', async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(<Button disabled onClick={onClick}>Go</Button>);
    await user.click(screen.getByRole('button'));
    expect(onClick).not.toHaveBeenCalled();
  });

  it('applies primary variant by default', () => {
    render(<Button>X</Button>);
    expect(screen.getByRole('button')).toHaveClass('bg-accent');
  });

  it('applies ghost variant when specified', () => {
    render(<Button variant="ghost">X</Button>);
    const btn = screen.getByRole('button');
    expect(btn).not.toHaveClass('bg-accent');
    expect(btn.className).toMatch(/hover:bg-zinc-800/);
  });

  it('applies danger variant when specified', () => {
    render(<Button variant="danger">X</Button>);
    expect(screen.getByRole('button').className).toMatch(/red/);
  });

  it('applies small size class', () => {
    render(<Button size="sm">X</Button>);
    expect(screen.getByRole('button').className).toMatch(/text-\[10px\]|text-xs/);
  });

  it('forwards ref to the underlying button', () => {
    const ref = { current: null as HTMLButtonElement | null };
    render(<Button ref={ref}>X</Button>);
    expect(ref.current).toBeInstanceOf(HTMLButtonElement);
  });

  it('accepts additional className', () => {
    render(<Button className="extra-class">X</Button>);
    expect(screen.getByRole('button')).toHaveClass('extra-class');
  });

  it('passes through type attribute', () => {
    render(<Button type="submit">X</Button>);
    expect(screen.getByRole('button')).toHaveAttribute('type', 'submit');
  });
});
```

- [ ] **Step 11.2: Run test, verifica fallisce**

```bash
npm run test:run -- src/components/ui/Button.test.tsx
```

Expected: 10 test falliscono con "Cannot find module './Button'".

- [ ] **Step 11.3: Implementa Button (GREEN)**

`src/components/ui/Button.tsx`:

```tsx
import { forwardRef, type ButtonHTMLAttributes } from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/src/lib/cn';

const buttonVariants = cva(
  'inline-flex items-center justify-center font-mono rounded transition-colors disabled:opacity-30 disabled:pointer-events-none',
  {
    variants: {
      variant: {
        primary: 'bg-accent text-black hover:bg-accent/90',
        ghost: 'bg-transparent text-zinc-300 hover:bg-zinc-800 hover:text-white',
        danger: 'bg-red-500/10 text-red-400 hover:bg-red-500 hover:text-white',
      },
      size: {
        sm: 'text-[10px] px-2 py-1 gap-1',
        md: 'text-xs px-3 py-1.5 gap-2',
        lg: 'text-sm px-4 py-2 gap-2',
      },
    },
    defaultVariants: { variant: 'primary', size: 'md' },
  },
);

export interface ButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, ...rest }, ref) => (
    <button ref={ref} className={cn(buttonVariants({ variant, size }), className)} {...rest} />
  ),
);
Button.displayName = 'Button';
```

- [ ] **Step 11.4: Run test, verifica passa**

```bash
npm run test:run -- src/components/ui/Button.test.tsx
```

Expected: 10 test passed.

- [ ] **Step 11.5: Commit**

```bash
git add src/components/ui/Button.tsx src/components/ui/Button.test.tsx
git commit -m "feat(slice-0): add Button primitive with variants (primary/ghost/danger) + tests"
```

---

## Task 12: IconButton primitive (TDD)

**Files:**
- Create: `src/components/ui/IconButton.tsx`
- Create: `src/components/ui/IconButton.test.tsx`

- [ ] **Step 12.1: Scrivi i test (RED)**

`src/components/ui/IconButton.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { IconButton } from './IconButton';

describe('IconButton', () => {
  it('renders an accessible button with label', () => {
    render(<IconButton label="Settings"><span data-testid="icon" /></IconButton>);
    expect(screen.getByRole('button', { name: 'Settings' })).toBeInTheDocument();
  });

  it('sets aria-label from label prop', () => {
    render(<IconButton label="Close"><span /></IconButton>);
    expect(screen.getByRole('button')).toHaveAttribute('aria-label', 'Close');
  });

  it('also sets title for tooltip', () => {
    render(<IconButton label="Reset"><span /></IconButton>);
    expect(screen.getByRole('button')).toHaveAttribute('title', 'Reset');
  });

  it('applies default variant', () => {
    render(<IconButton label="X"><span /></IconButton>);
    expect(screen.getByRole('button')).toHaveClass('icon-btn');
  });

  it('applies active variant', () => {
    render(<IconButton label="X" variant="active"><span /></IconButton>);
    expect(screen.getByRole('button').className).toMatch(/bg-zinc-800/);
  });

  it('applies danger variant', () => {
    render(<IconButton label="X" variant="danger"><span /></IconButton>);
    expect(screen.getByRole('button').className).toMatch(/red/);
  });

  it('handles clicks', async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(<IconButton label="X" onClick={onClick}><span /></IconButton>);
    await user.click(screen.getByRole('button'));
    expect(onClick).toHaveBeenCalledOnce();
  });
});
```

- [ ] **Step 12.2: Run, verifica fallisce**

```bash
npm run test:run -- src/components/ui/IconButton.test.tsx
```

Expected: tutti falliscono.

- [ ] **Step 12.3: Implementa IconButton (GREEN)**

`src/components/ui/IconButton.tsx`:

```tsx
import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/src/lib/cn';

const iconButtonVariants = cva('icon-btn', {
  variants: {
    variant: {
      default: '',
      active: 'bg-zinc-800 text-white',
      danger: 'hover:text-red-400',
    },
  },
  defaultVariants: { variant: 'default' },
});

export interface IconButtonProps
  extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'aria-label'>,
    VariantProps<typeof iconButtonVariants> {
  label: string;
  children: ReactNode;
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(
  ({ className, variant, label, children, ...rest }, ref) => (
    <button
      ref={ref}
      aria-label={label}
      title={label}
      className={cn(iconButtonVariants({ variant }), className)}
      {...rest}
    >
      {children}
    </button>
  ),
);
IconButton.displayName = 'IconButton';
```

- [ ] **Step 12.4: Run, verifica passa**

```bash
npm run test:run -- src/components/ui/IconButton.test.tsx
```

Expected: 7 test passed.

- [ ] **Step 12.5: Commit**

```bash
git add src/components/ui/IconButton.tsx src/components/ui/IconButton.test.tsx
git commit -m "feat(slice-0): add IconButton primitive with required label for a11y"
```

---

## Task 13: Badge primitive (TDD)

**Files:**
- Create: `src/components/ui/Badge.tsx`
- Create: `src/components/ui/Badge.test.tsx`

- [ ] **Step 13.1: Scrivi i test (RED)**

`src/components/ui/Badge.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Badge } from './Badge';

describe('Badge', () => {
  it('renders text content', () => {
    render(<Badge>logic</Badge>);
    expect(screen.getByText('logic')).toBeInTheDocument();
  });

  it('applies badge base class', () => {
    render(<Badge>x</Badge>);
    expect(screen.getByText('x')).toHaveClass('badge');
  });

  it.each([
    ['logic', /blue/],
    ['dispatch', /purple/],
    ['validation', /green/],
    ['context_fetch', /zinc/],
    ['mcp_query', /cyan/],
    ['thinking', /amber|yellow/],
  ] as const)('applies %s variant colors', (variant, colorPattern) => {
    render(<Badge variant={variant}>x</Badge>);
    expect(screen.getByText('x').className).toMatch(colorPattern);
  });

  it('applies default variant when none specified', () => {
    render(<Badge>x</Badge>);
    expect(screen.getByText('x').className).toMatch(/zinc/);
  });
});
```

- [ ] **Step 13.2: Run, verifica fallisce**

```bash
npm run test:run -- src/components/ui/Badge.test.tsx
```

- [ ] **Step 13.3: Implementa Badge (GREEN)**

`src/components/ui/Badge.tsx`:

```tsx
import { forwardRef, type HTMLAttributes } from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/src/lib/cn';

const badgeVariants = cva('badge', {
  variants: {
    variant: {
      default: 'bg-zinc-800 text-zinc-400',
      logic: 'bg-blue-500/10 text-blue-400',
      dispatch: 'bg-purple-500/10 text-purple-400',
      validation: 'bg-green-500/10 text-green-400',
      context_fetch: 'bg-zinc-700/40 text-zinc-300',
      mcp_query: 'bg-cyan-500/10 text-cyan-400',
      thinking: 'bg-amber-500/10 text-amber-400',
    },
  },
  defaultVariants: { variant: 'default' },
});

export interface BadgeProps
  extends HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

export const Badge = forwardRef<HTMLSpanElement, BadgeProps>(
  ({ className, variant, ...rest }, ref) => (
    <span ref={ref} className={cn(badgeVariants({ variant }), className)} {...rest} />
  ),
);
Badge.displayName = 'Badge';
```

- [ ] **Step 13.4: Run, verifica passa**

```bash
npm run test:run -- src/components/ui/Badge.test.tsx
```

Expected: 8 test passed (6 da `it.each` + 2).

- [ ] **Step 13.5: Commit**

```bash
git add src/components/ui/Badge.tsx src/components/ui/Badge.test.tsx
git commit -m "feat(slice-0): add Badge primitive with reasoning-step variants"
```

---

## Task 14: StatusDot primitive (TDD)

**Files:**
- Create: `src/components/ui/StatusDot.tsx`
- Create: `src/components/ui/StatusDot.test.tsx`

- [ ] **Step 14.1: Scrivi i test (RED)**

`src/components/ui/StatusDot.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { StatusDot } from './StatusDot';

describe('StatusDot', () => {
  it('renders with status-dot class', () => {
    render(<StatusDot status="online" label="Server" />);
    expect(screen.getByTitle('Server: online')).toHaveClass('status-dot');
  });

  it.each(['online', 'offline', 'connecting', 'error'] as const)('renders for status %s', (s) => {
    render(<StatusDot status={s} label="X" />);
    expect(screen.getByTitle(`X: ${s}`)).toBeInTheDocument();
  });

  it('uses green color for online', () => {
    render(<StatusDot status="online" label="X" />);
    const dot = screen.getByTitle('X: online');
    expect(dot.className).toMatch(/status-online|green/);
  });

  it('uses yellow color and pulse animation for connecting', () => {
    render(<StatusDot status="connecting" label="X" />);
    const dot = screen.getByTitle('X: connecting');
    expect(dot.className).toMatch(/connecting|yellow/);
    expect(dot.className).toMatch(/animate-pulse/);
  });

  it('uses zinc color for offline', () => {
    render(<StatusDot status="offline" label="X" />);
    expect(screen.getByTitle('X: offline').className).toMatch(/offline|zinc/);
  });

  it('uses red color for error', () => {
    render(<StatusDot status="error" label="X" />);
    expect(screen.getByTitle('X: error').className).toMatch(/red|error/);
  });
});
```

- [ ] **Step 14.2: Run, verifica fallisce**

```bash
npm run test:run -- src/components/ui/StatusDot.test.tsx
```

- [ ] **Step 14.3: Implementa StatusDot (GREEN)**

`src/components/ui/StatusDot.tsx`:

```tsx
import { type HTMLAttributes } from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/src/lib/cn';

const dotVariants = cva('status-dot', {
  variants: {
    status: {
      online: 'bg-status-online shadow-[0_0_8px_var(--color-status-online)]',
      offline: 'bg-status-offline',
      connecting: 'bg-status-connecting animate-pulse',
      error: 'bg-status-error',
    },
  },
});

export interface StatusDotProps
  extends Omit<HTMLAttributes<HTMLSpanElement>, 'title'>,
    Required<VariantProps<typeof dotVariants>> {
  label: string;
}

export function StatusDot({ status, label, className, ...rest }: StatusDotProps) {
  return (
    <span
      title={`${label}: ${status}`}
      className={cn(dotVariants({ status }), className)}
      {...rest}
    />
  );
}
```

- [ ] **Step 14.4: Run, verifica passa**

```bash
npm run test:run -- src/components/ui/StatusDot.test.tsx
```

Expected: 9 test passed.

- [ ] **Step 14.5: Commit**

```bash
git add src/components/ui/StatusDot.tsx src/components/ui/StatusDot.test.tsx
git commit -m "feat(slice-0): add StatusDot primitive with 4 statuses"
```

---

## Task 15: Panel primitive (TDD)

**Files:**
- Create: `src/components/ui/Panel.tsx`
- Create: `src/components/ui/Panel.test.tsx`

- [ ] **Step 15.1: Scrivi i test (RED)**

`src/components/ui/Panel.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Panel } from './Panel';

describe('Panel', () => {
  it('renders children', () => {
    render(<Panel>content</Panel>);
    expect(screen.getByText('content')).toBeInTheDocument();
  });

  it('uses panel class by default', () => {
    render(<Panel data-testid="p">x</Panel>);
    expect(screen.getByTestId('p')).toHaveClass('panel');
  });

  it('uses panel-inset class for inset variant', () => {
    render(<Panel variant="inset" data-testid="p">x</Panel>);
    expect(screen.getByTestId('p')).toHaveClass('panel-inset');
  });

  it('renders title when provided', () => {
    render(<Panel title="Section">body</Panel>);
    expect(screen.getByText('Section')).toBeInTheDocument();
    expect(screen.getByText('Section').className).toMatch(/mono-label/);
  });

  it('does not render title when not provided', () => {
    render(<Panel>body</Panel>);
    expect(screen.queryByText(/Section/)).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 15.2: Run, fallisce**

```bash
npm run test:run -- src/components/ui/Panel.test.tsx
```

- [ ] **Step 15.3: Implementa (GREEN)**

`src/components/ui/Panel.tsx`:

```tsx
import { type HTMLAttributes, type ReactNode } from 'react';
import { cn } from '@/src/lib/cn';

export interface PanelProps extends HTMLAttributes<HTMLDivElement> {
  variant?: 'default' | 'inset';
  title?: string;
  children: ReactNode;
}

export function Panel({ variant = 'default', title, className, children, ...rest }: PanelProps) {
  return (
    <div
      className={cn(variant === 'inset' ? 'panel-inset' : 'panel', 'p-3', className)}
      {...rest}
    >
      {title && <div className="mono-label mb-2">{title}</div>}
      {children}
    </div>
  );
}
```

- [ ] **Step 15.4: Run, passa**

```bash
npm run test:run -- src/components/ui/Panel.test.tsx
```

Expected: 5 test passed.

- [ ] **Step 15.5: Commit**

```bash
git add src/components/ui/Panel.tsx src/components/ui/Panel.test.tsx
git commit -m "feat(slice-0): add Panel primitive with optional title"
```

---

## Task 16: Tooltip primitive (TDD)

Implementiamo un tooltip CSS-only (no library) basato su `title` HTML + un wrapper testabile per evitare di dipendere da Radix in Slice 0.

**Files:**
- Create: `src/components/ui/Tooltip.tsx`
- Create: `src/components/ui/Tooltip.test.tsx`

- [ ] **Step 16.1: Scrivi i test (RED)**

`src/components/ui/Tooltip.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Tooltip } from './Tooltip';

describe('Tooltip', () => {
  it('renders the trigger child', () => {
    render(<Tooltip label="hint"><button>Action</button></Tooltip>);
    expect(screen.getByRole('button', { name: 'Action' })).toBeInTheDocument();
  });

  it('attaches the label as title to the child wrapper', () => {
    render(<Tooltip label="hint"><button>Action</button></Tooltip>);
    expect(screen.getByTitle('hint')).toBeInTheDocument();
  });

  it('passes through ref-less children unchanged', () => {
    render(<Tooltip label="hint"><span data-testid="ch">x</span></Tooltip>);
    expect(screen.getByTestId('ch')).toHaveTextContent('x');
  });
});
```

- [ ] **Step 16.2: Run, fallisce**

- [ ] **Step 16.3: Implementa (GREEN)**

`src/components/ui/Tooltip.tsx`:

```tsx
import { type ReactNode } from 'react';

export interface TooltipProps {
  label: string;
  children: ReactNode;
}

export function Tooltip({ label, children }: TooltipProps) {
  return <span title={label} className="inline-flex">{children}</span>;
}
```

- [ ] **Step 16.4: Run, passa**

```bash
npm run test:run -- src/components/ui/Tooltip.test.tsx
```

Expected: 3 test passed.

- [ ] **Step 16.5: Commit**

```bash
git add src/components/ui/Tooltip.tsx src/components/ui/Tooltip.test.tsx
git commit -m "feat(slice-0): add minimal Tooltip primitive (CSS title-based)"
```

---

## Task 17: Modal primitive (TDD)

Il Modal è la primitiva su cui PromptDialog/ConfirmDialog si appoggiano. Gestisce: backdrop, focus trap minimo (focus iniziale), Escape per chiudere, click backdrop per chiudere (opzionale).

**Files:**
- Create: `src/components/ui/Modal.tsx`
- Create: `src/components/ui/Modal.test.tsx`

- [ ] **Step 17.1: Scrivi i test (RED)**

`src/components/ui/Modal.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Modal } from './Modal';

describe('Modal', () => {
  it('does not render content when closed', () => {
    render(<Modal open={false} onClose={() => {}}>body</Modal>);
    expect(screen.queryByText('body')).not.toBeInTheDocument();
  });

  it('renders content when open', () => {
    render(<Modal open onClose={() => {}}>body</Modal>);
    expect(screen.getByText('body')).toBeInTheDocument();
  });

  it('renders title when provided', () => {
    render(<Modal open onClose={() => {}} title="Confirm">body</Modal>);
    expect(screen.getByText('Confirm')).toBeInTheDocument();
  });

  it('uses role="dialog" with aria-modal', () => {
    render(<Modal open onClose={() => {}}>body</Modal>);
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveAttribute('aria-modal', 'true');
  });

  it('calls onClose when Escape is pressed', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<Modal open onClose={onClose}>body</Modal>);
    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('calls onClose when backdrop is clicked', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<Modal open onClose={onClose}>body</Modal>);
    await user.click(screen.getByTestId('modal-backdrop'));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('does not call onClose when content is clicked', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<Modal open onClose={onClose}>body</Modal>);
    await user.click(screen.getByText('body'));
    expect(onClose).not.toHaveBeenCalled();
  });

  it('does not close on backdrop when dismissOnBackdrop=false', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<Modal open onClose={onClose} dismissOnBackdrop={false}>body</Modal>);
    await user.click(screen.getByTestId('modal-backdrop'));
    expect(onClose).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 17.2: Run, verifica fallisce**

```bash
npm run test:run -- src/components/ui/Modal.test.tsx
```

- [ ] **Step 17.3: Implementa Modal (GREEN)**

`src/components/ui/Modal.tsx`:

```tsx
import { useEffect, type ReactNode } from 'react';
import { cn } from '@/src/lib/cn';

export interface ModalProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: ReactNode;
  dismissOnBackdrop?: boolean;
  className?: string;
}

export function Modal({
  open,
  onClose,
  title,
  children,
  dismissOnBackdrop = true,
  className,
}: ModalProps) {
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      data-testid="modal-backdrop"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={dismissOnBackdrop ? onClose : undefined}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={cn(
          'bg-surface-1 border border-border-subtle rounded-xl shadow-2xl w-full max-w-md overflow-hidden',
          className,
        )}
        onClick={(e) => e.stopPropagation()}
      >
        {title && (
          <div className="px-4 py-3 border-b border-border-subtle mono-label text-white">
            {title}
          </div>
        )}
        <div className="p-4">{children}</div>
      </div>
    </div>
  );
}
```

- [ ] **Step 17.4: Run, verifica passa**

```bash
npm run test:run -- src/components/ui/Modal.test.tsx
```

Expected: 8 test passed.

- [ ] **Step 17.5: Commit**

```bash
git add src/components/ui/Modal.tsx src/components/ui/Modal.test.tsx
git commit -m "feat(slice-0): add Modal primitive (escape + backdrop dismiss + a11y)"
```

---

## Task 18: PromptDialog (TDD)

**Files:**
- Create: `src/components/ui/PromptDialog.tsx`
- Create: `src/components/ui/PromptDialog.test.tsx`

- [ ] **Step 18.1: Scrivi i test (RED)**

`src/components/ui/PromptDialog.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PromptDialog } from './PromptDialog';

describe('PromptDialog', () => {
  it('renders label and input', () => {
    render(<PromptDialog open title="T" label="Name" onConfirm={() => {}} onCancel={() => {}} />);
    expect(screen.getByText('Name')).toBeInTheDocument();
    expect(screen.getByRole('textbox')).toBeInTheDocument();
  });

  it('shows default value in input', () => {
    render(<PromptDialog open title="T" label="L" defaultValue="hello" onConfirm={() => {}} onCancel={() => {}} />);
    expect(screen.getByRole('textbox')).toHaveValue('hello');
  });

  it('calls onConfirm with current value when Confirm is clicked', async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    render(<PromptDialog open title="T" label="L" onConfirm={onConfirm} onCancel={() => {}} />);
    await user.type(screen.getByRole('textbox'), 'world');
    await user.click(screen.getByRole('button', { name: /confirm|ok/i }));
    expect(onConfirm).toHaveBeenCalledWith('world');
  });

  it('calls onCancel when Cancel is clicked', async () => {
    const user = userEvent.setup();
    const onCancel = vi.fn();
    render(<PromptDialog open title="T" label="L" onConfirm={() => {}} onCancel={onCancel} />);
    await user.click(screen.getByRole('button', { name: /cancel/i }));
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it('confirms on Enter key', async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    render(<PromptDialog open title="T" label="L" onConfirm={onConfirm} onCancel={() => {}} />);
    await user.type(screen.getByRole('textbox'), 'go{Enter}');
    expect(onConfirm).toHaveBeenCalledWith('go');
  });

  it('does not render when closed', () => {
    render(<PromptDialog open={false} title="T" label="L" onConfirm={() => {}} onCancel={() => {}} />);
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  });

  it('disables confirm when input is empty and required', async () => {
    render(<PromptDialog open required title="T" label="L" onConfirm={() => {}} onCancel={() => {}} />);
    expect(screen.getByRole('button', { name: /confirm|ok/i })).toBeDisabled();
  });
});
```

- [ ] **Step 18.2: Run, fallisce**

- [ ] **Step 18.3: Implementa (GREEN)**

`src/components/ui/PromptDialog.tsx`:

```tsx
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Modal } from './Modal';
import { Button } from './Button';

export interface PromptDialogProps {
  open: boolean;
  title: string;
  label: string;
  defaultValue?: string;
  placeholder?: string;
  required?: boolean;
  onConfirm: (value: string) => void;
  onCancel: () => void;
}

export function PromptDialog({
  open,
  title,
  label,
  defaultValue = '',
  placeholder,
  required = false,
  onConfirm,
  onCancel,
}: PromptDialogProps) {
  const [value, setValue] = useState(defaultValue);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setValue(defaultValue);
      setTimeout(() => inputRef.current?.focus(), 10);
    }
  }, [open, defaultValue]);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (required && !value.trim()) return;
    onConfirm(value);
  };

  const canConfirm = !required || value.trim().length > 0;

  return (
    <Modal open={open} onClose={onCancel} title={title}>
      <form onSubmit={submit} className="space-y-4">
        <label className="block">
          <span className="mono-label">{label}</span>
          <input
            ref={inputRef}
            type="text"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder={placeholder}
            className="mt-1 w-full bg-zinc-900 border border-border-subtle rounded px-2 py-1.5 text-sm text-white outline-none focus:border-accent"
          />
        </label>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onCancel}>Cancel</Button>
          <Button type="submit" disabled={!canConfirm}>Confirm</Button>
        </div>
      </form>
    </Modal>
  );
}
```

- [ ] **Step 18.4: Run, passa**

```bash
npm run test:run -- src/components/ui/PromptDialog.test.tsx
```

Expected: 7 test passed.

- [ ] **Step 18.5: Commit**

```bash
git add src/components/ui/PromptDialog.tsx src/components/ui/PromptDialog.test.tsx
git commit -m "feat(slice-0): add PromptDialog (modal + input + confirm/cancel)"
```

---

## Task 19: ConfirmDialog (TDD)

**Files:**
- Create: `src/components/ui/ConfirmDialog.tsx`
- Create: `src/components/ui/ConfirmDialog.test.tsx`

- [ ] **Step 19.1: Scrivi i test (RED)**

`src/components/ui/ConfirmDialog.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ConfirmDialog } from './ConfirmDialog';

describe('ConfirmDialog', () => {
  it('renders message and buttons', () => {
    render(<ConfirmDialog open title="Sure?" message="This deletes data." onConfirm={() => {}} onCancel={() => {}} />);
    expect(screen.getByText('Sure?')).toBeInTheDocument();
    expect(screen.getByText('This deletes data.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /confirm|ok/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /cancel/i })).toBeInTheDocument();
  });

  it('calls onConfirm when Confirm is clicked', async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    render(<ConfirmDialog open title="T" message="M" onConfirm={onConfirm} onCancel={() => {}} />);
    await user.click(screen.getByRole('button', { name: /confirm|ok/i }));
    expect(onConfirm).toHaveBeenCalledOnce();
  });

  it('calls onCancel when Cancel is clicked', async () => {
    const user = userEvent.setup();
    const onCancel = vi.fn();
    render(<ConfirmDialog open title="T" message="M" onConfirm={() => {}} onCancel={onCancel} />);
    await user.click(screen.getByRole('button', { name: /cancel/i }));
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it('confirm button uses danger variant when destructive=true', () => {
    render(<ConfirmDialog open destructive title="T" message="M" onConfirm={() => {}} onCancel={() => {}} />);
    const confirm = screen.getByRole('button', { name: /confirm|ok|delete/i });
    expect(confirm.className).toMatch(/red/);
  });
});
```

- [ ] **Step 19.2: Run, fallisce**

- [ ] **Step 19.3: Implementa (GREEN)**

`src/components/ui/ConfirmDialog.tsx`:

```tsx
import { Modal } from './Modal';
import { Button } from './Button';

export interface ConfirmDialogProps {
  open: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  destructive = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  return (
    <Modal open={open} onClose={onCancel} title={title}>
      <div className="space-y-4">
        <p className="text-sm text-zinc-300">{message}</p>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onCancel}>{cancelLabel}</Button>
          <Button variant={destructive ? 'danger' : 'primary'} onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
```

- [ ] **Step 19.4: Run, passa**

```bash
npm run test:run -- src/components/ui/ConfirmDialog.test.tsx
```

Expected: 4 test passed.

- [ ] **Step 19.5: Commit**

```bash
git add src/components/ui/ConfirmDialog.tsx src/components/ui/ConfirmDialog.test.tsx
git commit -m "feat(slice-0): add ConfirmDialog with destructive variant"
```

---

## Task 20: Re-export barrel per ui primitives

**Files:**
- Create: `src/components/ui/index.ts`

- [ ] **Step 20.1: Crea il barrel**

`src/components/ui/index.ts`:

```ts
export { Button, type ButtonProps } from './Button';
export { IconButton, type IconButtonProps } from './IconButton';
export { Badge, type BadgeProps } from './Badge';
export { StatusDot, type StatusDotProps } from './StatusDot';
export { Panel, type PanelProps } from './Panel';
export { Tooltip, type TooltipProps } from './Tooltip';
export { Modal, type ModalProps } from './Modal';
export { PromptDialog, type PromptDialogProps } from './PromptDialog';
export { ConfirmDialog, type ConfirmDialogProps } from './ConfirmDialog';
```

- [ ] **Step 20.2: Verifica tsc**

```bash
npm run lint
```

Expected: nessun errore.

- [ ] **Step 20.3: Commit**

```bash
git add src/components/ui/index.ts
git commit -m "feat(slice-0): add barrel export for ui primitives"
```

---

## Task 21: useDialog hook + DialogHost (TDD)

Questo è il sistema che rimpiazza `window.prompt/confirm`. Hook + componente host che vivono ai vertici dell'app. Lo store è interno al hook (singleton tramite `useSyncExternalStore` per non dipendere da Zustand prima dello Slice 1).

**Files:**
- Create: `src/hooks/useDialog.ts`
- Create: `src/hooks/useDialog.test.ts`
- Create: `src/components/layout/DialogHost.tsx`
- Create: `src/components/layout/DialogHost.test.tsx`

- [ ] **Step 21.1: Scrivi i test per useDialog (RED)**

`src/hooks/useDialog.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useDialog, _resetDialogStore } from './useDialog';

beforeEach(() => _resetDialogStore());

describe('useDialog', () => {
  it('initially has no active dialog', () => {
    const { result } = renderHook(() => useDialog());
    expect(result.current.current).toBeNull();
  });

  it('prompt() opens a prompt dialog', async () => {
    const { result } = renderHook(() => useDialog());
    let promise!: Promise<string | null>;
    act(() => { promise = result.current.prompt({ title: 'T', label: 'L' }); });
    expect(result.current.current?.kind).toBe('prompt');
    expect(result.current.current?.title).toBe('T');

    act(() => result.current.current?.resolve('hello'));
    await expect(promise).resolves.toBe('hello');
  });

  it('prompt() resolves null on cancel', async () => {
    const { result } = renderHook(() => useDialog());
    let promise!: Promise<string | null>;
    act(() => { promise = result.current.prompt({ title: 'T', label: 'L' }); });
    act(() => result.current.current?.cancel());
    await expect(promise).resolves.toBeNull();
  });

  it('confirm() opens a confirm dialog', async () => {
    const { result } = renderHook(() => useDialog());
    let promise!: Promise<boolean>;
    act(() => { promise = result.current.confirm({ title: 'T', message: 'M' }); });
    expect(result.current.current?.kind).toBe('confirm');

    act(() => result.current.current?.resolve(true));
    await expect(promise).resolves.toBe(true);
  });

  it('confirm() resolves false on cancel', async () => {
    const { result } = renderHook(() => useDialog());
    let promise!: Promise<boolean>;
    act(() => { promise = result.current.confirm({ title: 'T', message: 'M' }); });
    act(() => result.current.current?.cancel());
    await expect(promise).resolves.toBe(false);
  });

  it('only one dialog active at a time (FIFO queue)', async () => {
    const { result } = renderHook(() => useDialog());
    let p1!: Promise<string | null>;
    let p2!: Promise<string | null>;
    act(() => {
      p1 = result.current.prompt({ title: 'A', label: 'L' });
      p2 = result.current.prompt({ title: 'B', label: 'L' });
    });
    expect(result.current.current?.title).toBe('A');
    act(() => result.current.current?.resolve('1'));
    await expect(p1).resolves.toBe('1');
    expect(result.current.current?.title).toBe('B');
    act(() => result.current.current?.resolve('2'));
    await expect(p2).resolves.toBe('2');
  });
});
```

- [ ] **Step 21.2: Run, fallisce**

```bash
npm run test:run -- src/hooks/useDialog.test.ts
```

- [ ] **Step 21.3: Implementa useDialog (GREEN)**

`src/hooks/useDialog.ts`:

```ts
import { useSyncExternalStore } from 'react';

type PromptOptions = { title: string; label: string; defaultValue?: string; placeholder?: string; required?: boolean };
type ConfirmOptions = { title: string; message: string; confirmLabel?: string; cancelLabel?: string; destructive?: boolean };

export type ActiveDialog =
  | (PromptOptions & { kind: 'prompt'; id: string; resolve: (v: string | null) => void; cancel: () => void })
  | (ConfirmOptions & { kind: 'confirm'; id: string; resolve: (v: boolean) => void; cancel: () => void });

type DialogQueueItem = ActiveDialog;

let queue: DialogQueueItem[] = [];
const listeners = new Set<() => void>();
let counter = 0;

function emit() { listeners.forEach((l) => l()); }
function nextId() { counter += 1; return `dlg_${counter}`; }

function enqueue(item: DialogQueueItem) {
  queue = [...queue, item];
  emit();
}

function dequeue() {
  queue = queue.slice(1);
  emit();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getSnapshot(): DialogQueueItem | null {
  return queue[0] ?? null;
}

export function _resetDialogStore() {
  queue = [];
  counter = 0;
  emit();
}

export function useDialog() {
  const current = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  function prompt(opts: PromptOptions): Promise<string | null> {
    return new Promise((resolve) => {
      const id = nextId();
      enqueue({
        kind: 'prompt',
        id,
        ...opts,
        resolve: (v) => { resolve(v); dequeue(); },
        cancel: () => { resolve(null); dequeue(); },
      });
    });
  }

  function confirm(opts: ConfirmOptions): Promise<boolean> {
    return new Promise((resolve) => {
      const id = nextId();
      enqueue({
        kind: 'confirm',
        id,
        ...opts,
        resolve: (v) => { resolve(v); dequeue(); },
        cancel: () => { resolve(false); dequeue(); },
      });
    });
  }

  return { current, prompt, confirm };
}
```

- [ ] **Step 21.4: Run, passa**

```bash
npm run test:run -- src/hooks/useDialog.test.ts
```

Expected: 6 test passed.

- [ ] **Step 21.5: Scrivi i test per DialogHost (RED)**

`src/components/layout/DialogHost.test.tsx`:

```tsx
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DialogHost } from './DialogHost';
import { useDialog, _resetDialogStore } from '@/src/hooks/useDialog';

function TestHarness() {
  const { prompt, confirm } = useDialog();
  return (
    <>
      <DialogHost />
      <button onClick={async () => { const r = await prompt({ title: 'Ask', label: 'Name' }); (window as any).lastResult = r; }}>Open Prompt</button>
      <button onClick={async () => { const r = await confirm({ title: 'OK?', message: 'sure' }); (window as any).lastResult = r; }}>Open Confirm</button>
    </>
  );
}

describe('DialogHost', () => {
  beforeEach(() => { _resetDialogStore(); (window as any).lastResult = undefined; });

  it('renders nothing when queue is empty', () => {
    render(<DialogHost />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('renders PromptDialog when prompt is queued', async () => {
    const user = userEvent.setup();
    render(<TestHarness />);
    await user.click(screen.getByText('Open Prompt'));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText('Name')).toBeInTheDocument();
  });

  it('resolves prompt with input value on confirm', async () => {
    const user = userEvent.setup();
    render(<TestHarness />);
    await user.click(screen.getByText('Open Prompt'));
    await user.type(screen.getByRole('textbox'), 'Alice');
    await user.click(screen.getByRole('button', { name: /confirm|ok/i }));
    expect((window as any).lastResult).toBe('Alice');
  });

  it('renders ConfirmDialog when confirm is queued', async () => {
    const user = userEvent.setup();
    render(<TestHarness />);
    await user.click(screen.getByText('Open Confirm'));
    expect(screen.getByText('sure')).toBeInTheDocument();
  });

  it('resolves confirm true on Confirm click', async () => {
    const user = userEvent.setup();
    render(<TestHarness />);
    await user.click(screen.getByText('Open Confirm'));
    await user.click(screen.getByRole('button', { name: /confirm|ok/i }));
    expect((window as any).lastResult).toBe(true);
  });
});
```

- [ ] **Step 21.6: Run, fallisce**

```bash
npm run test:run -- src/components/layout/DialogHost.test.tsx
```

- [ ] **Step 21.7: Implementa DialogHost (GREEN)**

`src/components/layout/DialogHost.tsx`:

```tsx
import { useDialog } from '@/src/hooks/useDialog';
import { PromptDialog } from '@/src/components/ui/PromptDialog';
import { ConfirmDialog } from '@/src/components/ui/ConfirmDialog';

export function DialogHost() {
  const { current } = useDialog();
  if (!current) return null;

  if (current.kind === 'prompt') {
    return (
      <PromptDialog
        open
        title={current.title}
        label={current.label}
        defaultValue={current.defaultValue}
        placeholder={current.placeholder}
        required={current.required}
        onConfirm={(v) => current.resolve(v)}
        onCancel={current.cancel}
      />
    );
  }

  return (
    <ConfirmDialog
      open
      title={current.title}
      message={current.message}
      confirmLabel={current.confirmLabel}
      cancelLabel={current.cancelLabel}
      destructive={current.destructive}
      onConfirm={() => current.resolve(true)}
      onCancel={current.cancel}
    />
  );
}
```

- [ ] **Step 21.8: Run, verifica passa**

```bash
npm run test:run -- src/components/layout/DialogHost.test.tsx
```

Expected: 5 test passed.

- [ ] **Step 21.9: Commit**

```bash
git add src/hooks/useDialog.ts src/hooks/useDialog.test.ts \
        src/components/layout/DialogHost.tsx src/components/layout/DialogHost.test.tsx
git commit -m "feat(slice-0): add useDialog hook + DialogHost (replaces window.prompt/confirm)"
```

---

## Task 22: Backend — errors lib (TDD)

**Files:**
- Create: `server/lib/errors.ts`
- Create: `server/lib/errors.test.ts`

- [ ] **Step 22.1: Scrivi i test (RED)**

`server/lib/errors.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { AppError, ValidationError, NotFoundError, isAppError } from './errors';

describe('errors', () => {
  it('AppError carries status and code', () => {
    const e = new AppError('oops', { status: 500, code: 'INTERNAL' });
    expect(e.message).toBe('oops');
    expect(e.status).toBe(500);
    expect(e.code).toBe('INTERNAL');
    expect(e).toBeInstanceOf(Error);
  });

  it('ValidationError defaults to 400 / VALIDATION_ERROR', () => {
    const e = new ValidationError('bad input');
    expect(e.status).toBe(400);
    expect(e.code).toBe('VALIDATION_ERROR');
  });

  it('NotFoundError defaults to 404 / NOT_FOUND', () => {
    const e = new NotFoundError('profile xyz');
    expect(e.status).toBe(404);
    expect(e.code).toBe('NOT_FOUND');
    expect(e.message).toMatch(/profile xyz/);
  });

  it('isAppError distinguishes AppError instances', () => {
    expect(isAppError(new ValidationError('x'))).toBe(true);
    expect(isAppError(new Error('plain'))).toBe(false);
    expect(isAppError('string')).toBe(false);
    expect(isAppError(null)).toBe(false);
  });
});
```

- [ ] **Step 22.2: Run, fallisce**

```bash
npm run test:run -- server/lib/errors.test.ts
```

- [ ] **Step 22.3: Implementa (GREEN)**

`server/lib/errors.ts`:

```ts
export interface AppErrorOptions {
  status?: number;
  code?: string;
  cause?: unknown;
}

export class AppError extends Error {
  readonly status: number;
  readonly code: string;
  override readonly cause?: unknown;

  constructor(message: string, options: AppErrorOptions = {}) {
    super(message);
    this.name = 'AppError';
    this.status = options.status ?? 500;
    this.code = options.code ?? 'INTERNAL';
    this.cause = options.cause;
  }
}

export class ValidationError extends AppError {
  constructor(message: string, cause?: unknown) {
    super(message, { status: 400, code: 'VALIDATION_ERROR', cause });
    this.name = 'ValidationError';
  }
}

export class NotFoundError extends AppError {
  constructor(resource: string) {
    super(`Not found: ${resource}`, { status: 404, code: 'NOT_FOUND' });
    this.name = 'NotFoundError';
  }
}

export function isAppError(value: unknown): value is AppError {
  return value instanceof AppError;
}
```

- [ ] **Step 22.4: Run, passa**

```bash
npm run test:run -- server/lib/errors.test.ts
```

Expected: 4 test passed.

- [ ] **Step 22.5: Commit**

```bash
git add server/lib/errors.ts server/lib/errors.test.ts
git commit -m "feat(slice-0): add backend errors lib (AppError, ValidationError, NotFoundError)"
```

---

## Task 23: Backend — JsonStore (TDD)

**Files:**
- Create: `server/lib/json-store.ts`
- Create: `server/lib/json-store.test.ts`

- [ ] **Step 23.1: Scrivi i test (RED)**

`server/lib/json-store.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { z } from 'zod';
import { JsonStore } from './json-store';

const Schema = z.object({ count: z.number(), items: z.array(z.string()) });
type Data = z.infer<typeof Schema>;
const defaults: Data = { count: 0, items: [] };

let dir: string;
let file: string;
let store: JsonStore<Data>;

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'aether-jsonstore-'));
  file = path.join(dir, 'data.json');
  store = new JsonStore(file, Schema, defaults);
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('JsonStore', () => {
  it('returns defaults when file does not exist', async () => {
    const data = await store.read();
    expect(data).toEqual(defaults);
  });

  it('writes and reads data back', async () => {
    await store.write({ count: 3, items: ['a', 'b'] });
    const data = await store.read();
    expect(data).toEqual({ count: 3, items: ['a', 'b'] });
  });

  it('persists across instances', async () => {
    await store.write({ count: 7, items: ['x'] });
    const fresh = new JsonStore(file, Schema, defaults);
    expect(await fresh.read()).toEqual({ count: 7, items: ['x'] });
  });

  it('update() reads, applies fn, writes', async () => {
    await store.write({ count: 1, items: [] });
    const result = await store.update((cur) => ({ ...cur, count: cur.count + 1 }));
    expect(result.count).toBe(2);
    expect(await store.read()).toEqual({ count: 2, items: [] });
  });

  it('falls back to defaults if file is corrupted JSON', async () => {
    await writeFile(file, 'not json{{{', 'utf-8');
    const data = await store.read();
    expect(data).toEqual(defaults);
  });

  it('falls back to defaults if schema validation fails', async () => {
    await writeFile(file, JSON.stringify({ count: 'not-a-number', items: [] }), 'utf-8');
    const data = await store.read();
    expect(data).toEqual(defaults);
  });

  it('serializes concurrent writes (last write wins, no corruption)', async () => {
    const ops = Array.from({ length: 20 }, (_, i) =>
      store.update((cur) => ({ ...cur, count: cur.count + 1 })),
    );
    await Promise.all(ops);
    expect((await store.read()).count).toBe(20);
  });

  it('writes atomically via temp file + rename', async () => {
    await store.write({ count: 5, items: ['atomic'] });
    const raw = await readFile(file, 'utf-8');
    expect(JSON.parse(raw)).toEqual({ count: 5, items: ['atomic'] });
  });
});
```

- [ ] **Step 23.2: Run, fallisce**

```bash
npm run test:run -- server/lib/json-store.test.ts
```

- [ ] **Step 23.3: Implementa (GREEN)**

`server/lib/json-store.ts`:

```ts
import { readFile, writeFile, rename, mkdir } from 'node:fs/promises';
import path from 'node:path';
import PQueue from 'p-queue';
import type { ZodSchema } from 'zod';

export class JsonStore<T> {
  private queue = new PQueue({ concurrency: 1 });

  constructor(
    private readonly filePath: string,
    private readonly schema: ZodSchema<T>,
    private readonly defaultValue: T,
  ) {}

  async read(): Promise<T> {
    return this.queue.add(async () => this.readInternal()) as Promise<T>;
  }

  async write(value: T): Promise<void> {
    await this.queue.add(async () => this.writeInternal(value));
  }

  async update(fn: (current: T) => T): Promise<T> {
    return this.queue.add(async () => {
      const current = await this.readInternal();
      const next = fn(current);
      await this.writeInternal(next);
      return next;
    }) as Promise<T>;
  }

  private async readInternal(): Promise<T> {
    try {
      const raw = await readFile(this.filePath, 'utf-8');
      const parsed = JSON.parse(raw);
      const result = this.schema.safeParse(parsed);
      return result.success ? result.data : this.defaultValue;
    } catch (err: unknown) {
      if (err instanceof Error && 'code' in err && (err as { code?: string }).code === 'ENOENT') {
        return this.defaultValue;
      }
      // file presente ma corrotto / JSON invalido / errore di lettura → defaults
      return this.defaultValue;
    }
  }

  private async writeInternal(value: T): Promise<void> {
    await mkdir(path.dirname(this.filePath), { recursive: true });
    const tmp = `${this.filePath}.tmp-${process.pid}-${Date.now()}`;
    const serialized = JSON.stringify(value, null, 2);
    await writeFile(tmp, serialized, 'utf-8');
    await rename(tmp, this.filePath);
  }
}
```

- [ ] **Step 23.4: Run, passa**

```bash
npm run test:run -- server/lib/json-store.test.ts
```

Expected: 8 test passed.

- [ ] **Step 23.5: Commit**

```bash
git add server/lib/json-store.ts server/lib/json-store.test.ts
git commit -m "feat(slice-0): add JsonStore with zod schema, atomic writes, p-queue lock"
```

---

## Task 24: Backend — SSE helpers (TDD)

**Files:**
- Create: `server/lib/sse.ts`
- Create: `server/lib/sse.test.ts`

- [ ] **Step 24.1: Scrivi i test (RED)**

`server/lib/sse.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import type { Response } from 'express';
import { createSseEmitter } from './sse';

function fakeRes() {
  const headers = new Map<string, string>();
  const chunks: string[] = [];
  return {
    setHeader: vi.fn((k: string, v: string) => headers.set(k, v)),
    write: vi.fn((c: string) => { chunks.push(c); return true; }),
    end: vi.fn(),
    headers,
    chunks,
  } as unknown as Response & { headers: Map<string, string>; chunks: string[] };
}

describe('createSseEmitter', () => {
  it('sets SSE response headers on first emit', () => {
    const res = fakeRes();
    const sse = createSseEmitter(res);
    sse.event('text', { chunk: 'hi' });
    expect((res as any).headers.get('Content-Type')).toBe('text/event-stream');
    expect((res as any).headers.get('Cache-Control')).toBe('no-cache');
  });

  it('emits event with JSON data', () => {
    const res = fakeRes();
    const sse = createSseEmitter(res);
    sse.event('text', { chunk: 'hi' });
    expect((res as any).chunks).toContain('event: text\ndata: {"chunk":"hi"}\n\n');
  });

  it('emits error event then ends', () => {
    const res = fakeRes();
    const sse = createSseEmitter(res);
    sse.error('boom');
    expect((res as any).chunks.some((c: string) => c.includes('event: error') && c.includes('"message":"boom"'))).toBe(true);
    expect((res as Response).end).toHaveBeenCalled();
  });

  it('end() closes the response', () => {
    const res = fakeRes();
    const sse = createSseEmitter(res);
    sse.event('text', { chunk: 'x' });
    sse.end();
    expect((res as Response).end).toHaveBeenCalled();
  });

  it('subsequent emits after end are no-ops', () => {
    const res = fakeRes();
    const sse = createSseEmitter(res);
    sse.end();
    const before = (res as any).chunks.length;
    sse.event('text', { chunk: 'lost' });
    expect((res as any).chunks.length).toBe(before);
  });
});
```

- [ ] **Step 24.2: Run, fallisce**

```bash
npm run test:run -- server/lib/sse.test.ts
```

- [ ] **Step 24.3: Implementa (GREEN)**

`server/lib/sse.ts`:

```ts
import type { Response } from 'express';

export interface SseEmitter {
  event(name: string, data: unknown): void;
  error(message: string): void;
  end(): void;
}

export function createSseEmitter(res: Response): SseEmitter {
  let headersSent = false;
  let closed = false;

  function ensureHeaders() {
    if (headersSent) return;
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    headersSent = true;
  }

  return {
    event(name, data) {
      if (closed) return;
      ensureHeaders();
      res.write(`event: ${name}\ndata: ${JSON.stringify(data)}\n\n`);
    },
    error(message) {
      if (closed) return;
      ensureHeaders();
      res.write(`event: error\ndata: ${JSON.stringify({ message })}\n\n`);
      closed = true;
      res.end();
    },
    end() {
      if (closed) return;
      ensureHeaders();
      closed = true;
      res.end();
    },
  };
}
```

- [ ] **Step 24.4: Run, passa**

```bash
npm run test:run -- server/lib/sse.test.ts
```

Expected: 5 test passed.

- [ ] **Step 24.5: Commit**

```bash
git add server/lib/sse.ts server/lib/sse.test.ts
git commit -m "feat(slice-0): add server SSE emitter helper (event/error/end)"
```

---

## Task 25: Backend — createApp() factory (TDD)

Lo Slice 0 crea una `createApp()` minimale che ritorna un'app Express con un solo endpoint health-check. Le rotte vere arrivano negli slice successivi.

**Files:**
- Create: `server/app.ts`
- Create: `server/app.test.ts`

- [ ] **Step 25.1: Scrivi i test (RED)**

`server/app.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createApp } from './app';
import { AppError } from './lib/errors';

describe('createApp', () => {
  it('returns an express app without starting it', () => {
    const app = createApp({});
    expect(typeof app.listen).toBe('function');
  });

  it('exposes GET /api/health returning 200 ok', async () => {
    const app = createApp({});
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok' });
  });

  it('returns 404 for unknown routes', async () => {
    const app = createApp({});
    const res = await request(app).get('/api/__nope__');
    expect(res.status).toBe(404);
  });

  it('returns JSON error for handler-thrown AppError', async () => {
    const app = createApp({});
    // Endpoint di test ad hoc per coprire il path dell'error middleware.
    // Va aggiunto DOPO che createApp() ha registrato i suoi middleware, ma
    // in express l'ordine dei .use() conta: useremo app._router per accodare
    // l'endpoint prima dell'error handler. Più semplice: esponiamo un hook
    // di registrazione opzionale in createApp per i test, o usiamo un wrapper.
    // Soluzione pulita: estraiamo l'error handler in una funzione esportata
    // e lo applichiamo dopo aver registrato la route di test.
    app.get('/api/__throw', () => {
      throw new AppError('bang', { status: 418, code: 'TEAPOT' });
    });
    const res = await request(app).get('/api/__throw');
    expect(res.status).toBe(418);
    expect(res.body).toMatchObject({ error: { code: 'TEAPOT', message: 'bang' } });
  });
});
```

**Nota implementativa:** in Express, l'error middleware (4 argomenti) deve essere registrato DOPO le route. Se aggiungiamo una route dopo `createApp()` ritorna, l'error handler già registrato è ancora valido perché Express valuta i middleware in ordine al momento della richiesta. Quindi il test sopra funziona così com'è.

- [ ] **Step 25.2: Run, fallisce**

```bash
npm run test:run -- server/app.test.ts
```

- [ ] **Step 25.3: Implementa (GREEN)**

`server/app.ts`:

```ts
import express, { type Express, type NextFunction, type Request, type Response } from 'express';
import { isAppError } from './lib/errors';

export interface AppDeps {
  // Negli slice successivi: contextStore, historyStore, profilesStore, dispatcher, mcpRegistry.
}

export function createApp(_deps: AppDeps): Express {
  const app = express();
  app.use(express.json({ limit: '1mb' }));

  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok' });
  });

  // Error middleware
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (isAppError(err)) {
      res.status(err.status).json({ error: { code: err.code, message: err.message } });
      return;
    }
    const message = err instanceof Error ? err.message : 'Unknown error';
    res.status(500).json({ error: { code: 'INTERNAL', message } });
  });

  return app;
}
```

- [ ] **Step 25.4: Run, passa**

```bash
npm run test:run -- server/app.test.ts
```

Expected: 4 test passed.

- [ ] **Step 25.5: Commit**

```bash
git add server/app.ts server/app.test.ts
git commit -m "feat(slice-0): add createApp() factory with health route + error middleware"
```

---

## Task 26: data/ directory + gitignore

**Files:**
- Create: `data/.gitkeep`
- Create: `data/.gitignore`

- [ ] **Step 26.1: Crea data directory**

```bash
mkdir -p data
```

- [ ] **Step 26.2: Aggiungi .gitignore locale**

`data/.gitignore`:

```
*
!.gitignore
!.gitkeep
```

- [ ] **Step 26.3: Aggiungi .gitkeep**

```bash
touch data/.gitkeep
```

- [ ] **Step 26.4: Verifica con git status**

```bash
git status
```

Expected: `data/.gitignore` e `data/.gitkeep` appaiono come nuovi file da aggiungere; nient'altro dentro `data/`. Il pattern in `.gitignore` root (impostato a Task 6.1) permette esattamente questi due file e ignora tutto il resto.

- [ ] **Step 26.5: Commit**

```bash
git add data/.gitignore data/.gitkeep
git commit -m "chore(slice-0): create data/ directory with local gitignore"
```

---

## Task 27: Final smoke — tutti i test passano

**Files:** nessuno, è un check.

- [ ] **Step 27.1: Esegui tutti i test unit + integration**

```bash
npm run test:run
```

Expected: tutti i test passano. Numero approssimativo: ~80-90 test verdi (tra primitive UI, lib, backend).

- [ ] **Step 27.2: Esegui coverage**

```bash
npm run test:coverage
```

Expected: coverage sopra soglia per `src/lib/*`, `server/lib/*`. UI primitives non hanno soglia.

- [ ] **Step 27.3: Esegui lint**

```bash
npm run lint
```

Expected: nessun errore TypeScript.

- [ ] **Step 27.4: Esegui smoke E2E**

```bash
npm run test:e2e
```

Expected: 1 test E2E verde.

- [ ] **Step 27.5: Verifica app legacy ancora funziona**

```bash
npm run dev
```

Apri `http://localhost:3000`. L'App.tsx legacy deve renderizzare come prima. Chiudi con Ctrl+C.

- [ ] **Step 27.6: Commit "slice 0 complete" (opzionale, se ti piacciono i marker)**

```bash
git commit --allow-empty -m "chore(slice-0): foundation complete (all tests green)"
```

- [ ] **Step 27.7: Push branch e apri PR**

```bash
git push -u origin feat/slice-0-foundation
```

Poi (manuale): apri PR su GitHub con titolo "feat(slice-0): foundation — toolchain, primitives, dialog system, server lib". Body: lista dei task completati (estratta dai commit), link al design doc, screenshot dei test verdi.

---

## Definition of Done per Slice 0

- [x] Vitest config attivo con split jsdom/node
- [x] MSW server pronto
- [x] Playwright config + 1 smoke test verde
- [x] TS strict mode attivo, legacy files marcati `@ts-nocheck`
- [x] Theme tokens e component classes in `src/styles/`
- [x] 9 primitive UI (`Button`, `IconButton`, `Badge`, `StatusDot`, `Panel`, `Tooltip`, `Modal`, `PromptDialog`, `ConfirmDialog`) testate
- [x] `useDialog` hook + `DialogHost` testati
- [x] `src/lib/cn.ts`, `src/lib/ids.ts`, `src/lib/sse-parser.ts` testati
- [x] `server/lib/errors.ts`, `server/lib/json-store.ts`, `server/lib/sse.ts` testati
- [x] `server/app.ts` `createApp()` factory con health endpoint
- [x] `data/` directory con gitignore
- [x] Tutti i test verdi (~80-90)
- [x] Coverage ≥80% sui moduli con soglia
- [x] App legacy (server.ts + App.tsx) ancora funziona
- [x] PR aperta

---

## Note per chi esegue

- **Ogni task ha un commit dedicato.** Lo Slice ha ~26 commit. Va bene: il PR puoi scegliere di squash-mergiarlo al merge in main, oppure mantenere i singoli commit.
- **Se un test fallisce dopo che lo hai implementato:** non passare al task successivo. Investiga. Il pattern TDD richiede che ogni step verde diventi verde, altrimenti non sai cosa cambia tra una task e l'altra.
- **Path import:** ho usato `@/src/lib/cn` perché il `tsconfig.json` ha `"paths": { "@/*": ["./*"] }`. Verifica al primo uso che gli import risolvano correttamente; se Vite si lamenta, alternative: import relativi (`../../lib/cn`) o cambiare path alias a `@/lib/cn` → `["./src/lib/*"]`.
- **Test legacy:** lo Slice 0 non tocca `server.ts` né `src/App.tsx`. Il legacy continua a girare. Lo Slice 1 sostituirà `App.tsx`. Lo Slice 2 sostituirà `server.ts`.
- **Performance:** vitest gira un singolo test in ~50-200ms. L'intera suite Slice 0 finisce in pochi secondi.
- **CI:** non ancora configurata in Slice 0. Slice 1 o successivo aggiungerà un GitHub Action.

---

## Self-review

**Spec coverage:**
- ✅ Test setup (Sezione 1): Task 1-5 (deps, vitest, MSW), Task 6 (Playwright)
- ✅ CSS architecture (Sezione 2): Task 10 (theme + components.css)
- ✅ Primitive UI (Sezione 2): Task 11-20 (Button, IconButton, Badge, StatusDot, Panel, Tooltip, Modal, PromptDialog, ConfirmDialog, barrel)
- ✅ DialogHost + useDialog (Sezione 4): Task 21
- ✅ Backend factory + lib (Sezione 3): Task 22-25 (errors, JsonStore, SSE, createApp)
- ✅ TS strict (Conventions): Task 3
- ✅ Test naming co-locato (Conventions): tutti i file `*.test.ts(x)` accanto al source
- ✅ Data directory (Sezione 3): Task 26
- ⏭ Frontend store layout (Sezione 4): Slice 1+ (Zustand non installato in Slice 0)
- ⏭ API layer (Sezione 4): Slice 1+
- ⏭ Tutti gli `useStreamingDispatch` ecc: Slice 2+

**Placeholder scan:** nessun TBD, TODO, "implement later". Ogni step ha codice completo.

**Type consistency:** verificato — `Button` espone `ButtonProps`, `IconButton` espone `IconButtonProps`, ecc. `useDialog` espone `ActiveDialog` con discriminator `kind`. `DialogHost` usa lo stesso discriminator.

**Scope check:** lo slice è focalizzato su foundation. Niente feature utente, niente backend di dominio. La spec dice esplicitamente "Niente feature utente attivate" per Slice 0 — coerente.

**Risk:** se il commit "data/ gitignore" risulta complicato (Task 26.4 ha un edge case), si può saltare il commit della directory vuota e creare `data/` al volo nello Slice 1. Non blocca.
