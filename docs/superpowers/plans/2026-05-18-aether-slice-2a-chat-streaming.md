# Aether Slice 2a — Chat Streaming Reale Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Sostituire il placeholder centrale di `App.tsx` con una chat funzionante in streaming reale via SSE, con history persistita su disco (single-session), Stop con AbortController, errori inline con retryable, markdown live e smart auto-scroll.

**Architecture:** Backend `createApp({ contextStore, historyStore, dispatcher })` con DI. `dispatch.service` orchestra `AIProvider` (Gemini reale o FakeProvider deterministico) + `history.store` (JsonStore-backed, sessionId='default' costante in 2a). Frontend: `useChatStore` (Zustand) come single source of truth, `useStreamingDispatch` hook incapsula fetch+SSE+abort, `ChatView` orchestrator con `MessageList` (auto-scroll) + `MessageInput` (Enter/Stop). Markdown via `react-markdown`. Errori inline nel bubble assistant con flag `retryable`.

**Tech Stack:** Express + zod + p-queue + `@google/genai` (mockabile) backend; Zustand + react-markdown + RTL + MSW frontend; supertest backend integration; Playwright smoke.

**Reference spec:** `docs/superpowers/specs/2026-05-18-aether-slice-2a-chat-streaming-design.md`

**Branch:** `feat/slice-2a-chat-streaming`

**Lavora con un solo branch dall'inizio alla fine; ogni Task termina con un commit verde su questo branch.**

---

## File structure (NEW unless marked MODIFY)

```
server/
  config.ts                                            # NEW
  config.test.ts                                       # NEW
  app.ts                                               # MODIFY
  app.test.ts                                          # MODIFY
  index.ts                                             # MODIFY
  domain/
    history/
      history.types.ts                                 # NEW
      history.schema.ts                                # NEW
      history.schema.test.ts                          # NEW
      history.store.ts                                 # NEW
      history.store.test.ts                            # NEW
    dispatch/
      dispatch.service.ts                              # NEW
      dispatch.service.test.ts                         # NEW
      providers/
        provider.types.ts                              # NEW
        fake.provider.ts                               # NEW
        fake.provider.test.ts                          # NEW
        gemini.provider.ts                             # NEW
        gemini.provider.test.ts                        # NEW
  routes/
    dispatch.routes.ts                                 # NEW
    dispatch.routes.test.ts                            # NEW
    history.routes.ts                                  # NEW
    history.routes.test.ts                             # NEW
  test/
    sse-collector.ts                                   # NEW

src/
  types/
    message.types.ts                                   # NEW
  lib/
    api/
      dispatch.api.ts                                  # NEW
      dispatch.api.test.ts                             # NEW
      history.api.ts                                   # NEW
      history.api.test.ts                              # NEW
  stores/
    chat.store.ts                                      # NEW
    chat.store.test.ts                                 # NEW
  hooks/
    useStreamingDispatch.ts                            # NEW
    useStreamingDispatch.test.ts                       # NEW
    useAutoScroll.ts                                   # NEW
    useAutoScroll.test.ts                              # NEW
  components/
    chat/
      ChatView.tsx                                     # NEW
      ChatView.test.tsx                                # NEW
      MessageList.tsx                                  # NEW
      MessageList.test.tsx                             # NEW
      MessageBubble.tsx                                # NEW
      MessageBubble.test.tsx                           # NEW
      MessageInput.tsx                                 # NEW
      MessageInput.test.tsx                            # NEW
      EmptyState.tsx                                   # NEW
      StreamingIndicator.tsx                           # NEW
  App.tsx                                              # MODIFY
  App.test.tsx                                         # NEW (smoke)
  test/
    msw-handlers.ts                                    # MODIFY

e2e/
  smoke.spec.ts                                        # MODIFY
```

---

## Phase A — Branch + dipendenze

### Task A1: Crea il branch

- [ ] **Step 1: Crea e checkout il branch**

```bash
git checkout main
git pull --ff-only
git checkout -b feat/slice-2a-chat-streaming
```

Expected: `Switched to a new branch 'feat/slice-2a-chat-streaming'`.

- [ ] **Step 2: Verifica clean state**

```bash
git status
```

Expected: `nothing to commit, working tree clean`.

---

## Phase B — Backend config tipato

### Task B1: `server/config.ts` con env loader

**Files:**
- Create: `server/config.ts`
- Create: `server/config.test.ts`

- [ ] **Step 1: Write the failing test**

`server/config.test.ts`:
```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { loadConfig } from './config';

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

describe('loadConfig', () => {
  it('returns defaults when nothing is set', () => {
    delete process.env.PORT;
    delete process.env.AETHER_DATA_DIR;
    delete process.env.AETHER_FAKE_PROVIDER;
    delete process.env.GEMINI_API_KEY;
    const cfg = loadConfig();
    expect(cfg.port).toBe(3000);
    expect(cfg.dataDir).toMatch(/data$/);
    expect(cfg.fakeProvider).toBe(false);
    expect(cfg.geminiApiKey).toBe('');
  });

  it('reads PORT as integer', () => {
    process.env.PORT = '4321';
    expect(loadConfig().port).toBe(4321);
  });

  it('treats AETHER_FAKE_PROVIDER=1 as true, other values as false', () => {
    process.env.AETHER_FAKE_PROVIDER = '1';
    expect(loadConfig().fakeProvider).toBe(true);
    process.env.AETHER_FAKE_PROVIDER = '0';
    expect(loadConfig().fakeProvider).toBe(false);
    process.env.AETHER_FAKE_PROVIDER = 'true';
    expect(loadConfig().fakeProvider).toBe(false);
  });

  it('reads GEMINI_API_KEY when set', () => {
    process.env.GEMINI_API_KEY = 'abc123';
    expect(loadConfig().geminiApiKey).toBe('abc123');
  });

  it('reads AETHER_DATA_DIR when set', () => {
    process.env.AETHER_DATA_DIR = '/tmp/aether';
    expect(loadConfig().dataDir).toBe('/tmp/aether');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run server/config.test.ts
```

Expected: FAIL `Failed to resolve import "./config"`.

- [ ] **Step 3: Write minimal implementation**

`server/config.ts`:
```ts
import path from 'node:path';

export interface AppConfig {
  port: number;
  dataDir: string;
  fakeProvider: boolean;
  geminiApiKey: string;
}

export function loadConfig(): AppConfig {
  return {
    port: parseInt(process.env.PORT ?? '3000', 10),
    dataDir: process.env.AETHER_DATA_DIR ?? path.resolve(process.cwd(), 'data'),
    fakeProvider: process.env.AETHER_FAKE_PROVIDER === '1',
    geminiApiKey: process.env.GEMINI_API_KEY ?? '',
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run server/config.test.ts
```

Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add server/config.ts server/config.test.ts
git commit -m "feat(slice-2a): add typed env config loader"
```

---

## Phase C — Backend types + history store

### Task C1: Message types + schema

**Files:**
- Create: `server/domain/history/history.types.ts`
- Create: `server/domain/history/history.schema.ts`
- Create: `server/domain/history/history.schema.test.ts`

- [ ] **Step 1: Write the failing test**

`server/domain/history/history.schema.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { MessageSchema, SessionsFileSchema } from './history.schema';

describe('MessageSchema', () => {
  it('parses minimal user message', () => {
    const msg = { id: 'a', role: 'user' as const, text: 'hi', timestamp: 1 };
    expect(MessageSchema.parse(msg)).toEqual(msg);
  });

  it('parses model message with optional fields', () => {
    const msg = {
      id: 'b',
      role: 'model' as const,
      text: 'hello',
      timestamp: 2,
      model: 'gemini-test',
      interrupted: false,
      error: undefined,
      retryable: undefined,
    };
    const parsed = MessageSchema.parse(msg);
    expect(parsed.model).toBe('gemini-test');
    expect(parsed.interrupted).toBe(false);
  });

  it('rejects invalid role', () => {
    expect(() =>
      MessageSchema.parse({ id: 'x', role: 'admin', text: 't', timestamp: 1 }),
    ).toThrow();
  });

  it('rejects missing required fields', () => {
    expect(() => MessageSchema.parse({ role: 'user', text: 'x' })).toThrow();
  });

  it('SessionsFileSchema parses { default: Message[] }', () => {
    const file = {
      default: [
        { id: '1', role: 'user' as const, text: 'a', timestamp: 1 },
        { id: '2', role: 'model' as const, text: 'b', timestamp: 2 },
      ],
    };
    expect(SessionsFileSchema.parse(file).default).toHaveLength(2);
  });

  it('SessionsFileSchema accepts empty', () => {
    expect(SessionsFileSchema.parse({})).toEqual({});
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run server/domain/history/history.schema.test.ts
```

Expected: FAIL — cannot resolve `./history.schema`.

- [ ] **Step 3: Write the types**

`server/domain/history/history.types.ts`:
```ts
export interface Message {
  id: string;
  role: 'user' | 'model';
  text: string;
  timestamp: number;
  model?: string;
  interrupted?: boolean;
  error?: string;
  retryable?: boolean;
}

export type SessionsFile = Record<string, Message[]>;
```

- [ ] **Step 4: Write the schema**

`server/domain/history/history.schema.ts`:
```ts
import { z } from 'zod';

export const MessageSchema = z.object({
  id: z.string(),
  role: z.enum(['user', 'model']),
  text: z.string(),
  timestamp: z.number(),
  model: z.string().optional(),
  interrupted: z.boolean().optional(),
  error: z.string().optional(),
  retryable: z.boolean().optional(),
});

export const SessionsFileSchema = z.record(z.string(), z.array(MessageSchema));
```

- [ ] **Step 5: Run test to verify it passes**

```bash
npx vitest run server/domain/history/history.schema.test.ts
```

Expected: PASS (6 tests).

- [ ] **Step 6: Commit**

```bash
git add server/domain/history
git commit -m "feat(slice-2a): add Message types + zod schema"
```

---

### Task C2: HistoryStore

**Files:**
- Create: `server/domain/history/history.store.ts`
- Create: `server/domain/history/history.store.test.ts`

- [ ] **Step 1: Write the failing test**

`server/domain/history/history.store.test.ts`:
```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { HistoryStore, DEFAULT_SESSION_ID } from './history.store';

let dir: string;
let store: HistoryStore;

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'aether-history-'));
  store = new HistoryStore(path.join(dir, 'sessions.json'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('HistoryStore', () => {
  it('DEFAULT_SESSION_ID is "default"', () => {
    expect(DEFAULT_SESSION_ID).toBe('default');
  });

  it('read() returns empty array on empty file', async () => {
    expect(await store.read()).toEqual([]);
  });

  it('append() adds message and read() returns it', async () => {
    await store.append({ id: 'a', role: 'user', text: 'hi', timestamp: 1 });
    expect(await store.read()).toEqual([
      { id: 'a', role: 'user', text: 'hi', timestamp: 1 },
    ]);
  });

  it('append() preserves order', async () => {
    await store.append({ id: '1', role: 'user', text: 'a', timestamp: 1 });
    await store.append({ id: '2', role: 'model', text: 'b', timestamp: 2 });
    await store.append({ id: '3', role: 'user', text: 'c', timestamp: 3 });
    const msgs = await store.read();
    expect(msgs.map((m) => m.id)).toEqual(['1', '2', '3']);
  });

  it('reset() clears the session', async () => {
    await store.append({ id: 'x', role: 'user', text: 't', timestamp: 1 });
    await store.reset();
    expect(await store.read()).toEqual([]);
  });

  it('persists across instances (file-backed)', async () => {
    await store.append({ id: 'p', role: 'user', text: 'persist', timestamp: 1 });
    const store2 = new HistoryStore(path.join(dir, 'sessions.json'));
    expect(await store2.read()).toEqual([
      { id: 'p', role: 'user', text: 'persist', timestamp: 1 },
    ]);
  });

  it('append accepts optional fields on model messages', async () => {
    await store.append({
      id: 'm',
      role: 'model',
      text: 'done',
      timestamp: 1,
      model: 'gemini-test',
      interrupted: false,
    });
    const msgs = await store.read();
    expect(msgs[0]).toMatchObject({ model: 'gemini-test', interrupted: false });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run server/domain/history/history.store.test.ts
```

Expected: FAIL — cannot resolve `./history.store`.

- [ ] **Step 3: Write minimal implementation**

`server/domain/history/history.store.ts`:
```ts
import { JsonStore } from '@/server/lib/json-store';
import { SessionsFileSchema } from './history.schema';
import type { Message, SessionsFile } from './history.types';

export const DEFAULT_SESSION_ID = 'default';

export class HistoryStore {
  private json: JsonStore<SessionsFile>;

  constructor(filePath: string) {
    this.json = new JsonStore<SessionsFile>(filePath, SessionsFileSchema, {});
  }

  async read(): Promise<Message[]> {
    const file = await this.json.read();
    return file[DEFAULT_SESSION_ID] ?? [];
  }

  async append(message: Message): Promise<void> {
    await this.json.update((cur) => {
      const list = cur[DEFAULT_SESSION_ID] ?? [];
      return { ...cur, [DEFAULT_SESSION_ID]: [...list, message] };
    });
  }

  async reset(): Promise<void> {
    await this.json.update((cur) => ({ ...cur, [DEFAULT_SESSION_ID]: [] }));
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run server/domain/history/history.store.test.ts
```

Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add server/domain/history/history.store.ts server/domain/history/history.store.test.ts
git commit -m "feat(slice-2a): add HistoryStore (JsonStore-backed, sessionId='default')"
```

---

## Phase D — AIProvider interface + FakeProvider

### Task D1: provider.types.ts

**Files:**
- Create: `server/domain/dispatch/providers/provider.types.ts`

- [ ] **Step 1: Create the file**

`server/domain/dispatch/providers/provider.types.ts`:
```ts
export interface ProviderRequest {
  systemInstruction: string;
  history: { role: 'user' | 'model'; text: string }[];
  userMessage: string;
}

export type ProviderChunk =
  | { type: 'text'; text: string }
  | { type: 'done' };

export interface AIProvider {
  readonly model: string;
  stream(req: ProviderRequest, signal: AbortSignal): AsyncIterable<ProviderChunk>;
}
```

- [ ] **Step 2: Verify type-checks**

```bash
npm run lint
```

Expected: PASS (no errors).

- [ ] **Step 3: Commit**

```bash
git add server/domain/dispatch/providers/provider.types.ts
git commit -m "feat(slice-2a): add AIProvider interface + ProviderChunk types"
```

---

### Task D2: FakeProvider

**Files:**
- Create: `server/domain/dispatch/providers/fake.provider.ts`
- Create: `server/domain/dispatch/providers/fake.provider.test.ts`

- [ ] **Step 1: Write the failing test**

`server/domain/dispatch/providers/fake.provider.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { FakeProvider } from './fake.provider';

async function collect<T>(it: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const v of it) out.push(v);
  return out;
}

describe('FakeProvider', () => {
  it('yields configured text chunks then done', async () => {
    const p = new FakeProvider({ chunks: ['Hello', ' world'] });
    const ctrl = new AbortController();
    const all = await collect(
      p.stream(
        { systemInstruction: '', history: [], userMessage: '' },
        ctrl.signal,
      ),
    );
    expect(all).toEqual([
      { type: 'text', text: 'Hello' },
      { type: 'text', text: ' world' },
      { type: 'done' },
    ]);
  });

  it('aborts mid-stream when signal is aborted', async () => {
    const p = new FakeProvider({ chunks: ['a', 'b', 'c'], chunkDelayMs: 10 });
    const ctrl = new AbortController();
    const out: string[] = [];
    const iter = p.stream(
      { systemInstruction: '', history: [], userMessage: '' },
      ctrl.signal,
    );
    setTimeout(() => ctrl.abort(), 5);
    for await (const chunk of iter) {
      if (chunk.type === 'text') out.push(chunk.text);
    }
    expect(out.length).toBeLessThan(3);
  });

  it('does not yield text after abort', async () => {
    const p = new FakeProvider({ chunks: ['a'] });
    const ctrl = new AbortController();
    ctrl.abort();
    const out = await collect(
      p.stream(
        { systemInstruction: '', history: [], userMessage: '' },
        ctrl.signal,
      ),
    );
    expect(out.filter((c) => c.type === 'text')).toHaveLength(0);
  });

  it('exposes model property', () => {
    const p = new FakeProvider({ chunks: ['x'] });
    expect(p.model).toBe('fake-1');
  });

  it('accepts custom model name', () => {
    const p = new FakeProvider({ chunks: ['x'], model: 'fake-echo' });
    expect(p.model).toBe('fake-echo');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run server/domain/dispatch/providers/fake.provider.test.ts
```

Expected: FAIL — cannot resolve.

- [ ] **Step 3: Write the implementation**

`server/domain/dispatch/providers/fake.provider.ts`:
```ts
import type { AIProvider, ProviderChunk, ProviderRequest } from './provider.types';

export interface FakeProviderOptions {
  chunks: string[];
  chunkDelayMs?: number;
  model?: string;
}

export class FakeProvider implements AIProvider {
  readonly model: string;

  constructor(private readonly opts: FakeProviderOptions) {
    this.model = opts.model ?? 'fake-1';
  }

  async *stream(
    _req: ProviderRequest,
    signal: AbortSignal,
  ): AsyncGenerator<ProviderChunk> {
    for (const text of this.opts.chunks) {
      if (signal.aborted) return;
      if (this.opts.chunkDelayMs && this.opts.chunkDelayMs > 0) {
        await sleep(this.opts.chunkDelayMs, signal);
        if (signal.aborted) return;
      }
      yield { type: 'text', text };
    }
    if (!signal.aborted) yield { type: 'done' };
  }
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) return resolve();
    const t = setTimeout(resolve, ms);
    signal.addEventListener('abort', () => {
      clearTimeout(t);
      resolve();
    }, { once: true });
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run server/domain/dispatch/providers/fake.provider.test.ts
```

Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add server/domain/dispatch/providers/fake.provider.ts server/domain/dispatch/providers/fake.provider.test.ts
git commit -m "feat(slice-2a): add FakeProvider (deterministic, AbortSignal-aware)"
```

---

## Phase E — dispatch.service

### Task E1: SseEmitter mock helper for tests

**Files:**
- Create: `server/test/sse-collector.ts`

This helper is used by service tests (capturing emitted events) and route tests (parsing SSE response bodies).

- [ ] **Step 1: Create the helper**

`server/test/sse-collector.ts`:
```ts
import type { Response } from 'supertest';
import { parseSseStream } from '@/src/lib/sse-parser';
import type { SseEmitter } from '@/server/lib/sse';

// ----- Helper #1: in-memory SseEmitter mock for unit tests -----
export interface CollectedEvent {
  event: string;
  data: unknown;
}

export function createCollectorEmitter(): {
  emitter: SseEmitter;
  events: CollectedEvent[];
  ended: boolean;
} {
  const events: CollectedEvent[] = [];
  let ended = false;
  const emitter: SseEmitter = {
    event(name, data) {
      if (ended) return;
      events.push({ event: name, data });
    },
    error(message) {
      if (ended) return;
      events.push({ event: 'error', data: { message } });
      ended = true;
    },
    end() {
      ended = true;
    },
  };
  return {
    emitter,
    events,
    get ended() {
      return ended;
    },
  } as { emitter: SseEmitter; events: CollectedEvent[]; ended: boolean };
}

// ----- Helper #2: parse supertest streaming body into events -----
export async function collectSseEvents(res: Response): Promise<CollectedEvent[]> {
  const text: string = (res as unknown as { text: string }).text ?? '';
  // Costruisce un ReadableStream a partire dal testo già accumulato.
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(text));
      controller.close();
    },
  });
  const out: CollectedEvent[] = [];
  for await (const ev of parseSseStream(stream)) {
    out.push({ event: ev.event, data: ev.data });
  }
  return out;
}
```

- [ ] **Step 2: Verify type-check**

```bash
npm run lint
```

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add server/test/sse-collector.ts
git commit -m "test(slice-2a): add sse collector helper (unit + supertest)"
```

---

### Task E2: dispatch.service

**Files:**
- Create: `server/domain/dispatch/dispatch.service.ts`
- Create: `server/domain/dispatch/dispatch.service.test.ts`

- [ ] **Step 1: Write the failing test**

`server/domain/dispatch/dispatch.service.test.ts`:
```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DispatchService } from './dispatch.service';
import { FakeProvider } from './providers/fake.provider';
import { HistoryStore } from '@/server/domain/history/history.store';
import { ContextStore } from '@/server/domain/context/context.store';
import { createCollectorEmitter } from '@/server/test/sse-collector';

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'aether-dispatch-'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('DispatchService', () => {
  function makeService(opts: { chunks: string[]; chunkDelayMs?: number }) {
    const provider = new FakeProvider({ chunks: opts.chunks, chunkDelayMs: opts.chunkDelayMs, model: 'fake-1' });
    const historyStore = new HistoryStore(path.join(dir, 'sessions.json'));
    const contextStore = new ContextStore(path.join(dir, 'context.json'));
    const service = new DispatchService({ provider, historyStore, contextStore });
    return { service, historyStore, contextStore };
  }

  it('emits text events then done', async () => {
    const { service } = makeService({ chunks: ['Hello', ' world'] });
    const { emitter, events } = createCollectorEmitter();
    const ctrl = new AbortController();
    await service.handle({ message: 'hi' }, emitter, ctrl.signal);
    expect(events.map((e) => e.event)).toEqual(['text', 'text', 'done']);
    expect(events[0].data).toEqual({ chunk: 'Hello' });
    expect(events[1].data).toEqual({ chunk: ' world' });
    expect(events[2].data).toMatchObject({ model: 'fake-1', interrupted: false });
  });

  it('persists user + model messages to history', async () => {
    const { service, historyStore } = makeService({ chunks: ['pong'] });
    const { emitter } = createCollectorEmitter();
    const ctrl = new AbortController();
    await service.handle({ message: 'ping' }, emitter, ctrl.signal);
    const msgs = await historyStore.read();
    expect(msgs).toHaveLength(2);
    expect(msgs[0]).toMatchObject({ role: 'user', text: 'ping' });
    expect(msgs[1]).toMatchObject({ role: 'model', text: 'pong', model: 'fake-1', interrupted: false });
  });

  it('saves partial text + interrupted=true when aborted', async () => {
    const { service, historyStore } = makeService({ chunks: ['a', 'b', 'c'], chunkDelayMs: 20 });
    const { emitter, events } = createCollectorEmitter();
    const ctrl = new AbortController();
    setTimeout(() => ctrl.abort(), 10);
    await service.handle({ message: 'ping' }, emitter, ctrl.signal);
    const last = events.at(-1);
    expect(last?.event).toBe('done');
    expect((last?.data as { interrupted: boolean }).interrupted).toBe(true);
    const msgs = await historyStore.read();
    const model = msgs.find((m) => m.role === 'model')!;
    expect(model.interrupted).toBe(true);
    expect(model.text.length).toBeLessThan(3);
  });

  it('passes history + systemInstruction to provider', async () => {
    const { service, historyStore, contextStore } = makeService({ chunks: ['x'] });
    await contextStore.patch({ systemInstruction: 'YOU_ARE_AETHER' });
    await historyStore.append({ id: 'p1', role: 'user', text: 'first', timestamp: 1 });
    await historyStore.append({ id: 'p2', role: 'model', text: 'reply', timestamp: 2 });

    let captured: unknown;
    class CapturingProvider {
      readonly model = 'cap';
      async *stream(req: unknown) {
        captured = req;
        yield { type: 'text' as const, text: 'x' };
        yield { type: 'done' as const };
      }
    }
    const svc = new (await import('./dispatch.service')).DispatchService({
      // @ts-expect-error duck-typed test provider
      provider: new CapturingProvider(),
      historyStore,
      contextStore,
    });
    const { emitter } = createCollectorEmitter();
    await svc.handle({ message: 'second' }, emitter, new AbortController().signal);
    expect(captured).toMatchObject({
      systemInstruction: 'YOU_ARE_AETHER',
      history: [
        { role: 'user', text: 'first' },
        { role: 'model', text: 'reply' },
      ],
      userMessage: 'second',
    });
  });

  it('emits error event and ends when provider throws', async () => {
    class FailingProvider {
      readonly model = 'broken';
      async *stream(): AsyncGenerator<never> {
        throw new Error('Authentication failed');
      }
    }
    const historyStore = new HistoryStore(path.join(dir, 'sessions.json'));
    const contextStore = new ContextStore(path.join(dir, 'context.json'));
    const service = new DispatchService({
      // @ts-expect-error duck-typed test provider
      provider: new FailingProvider(),
      historyStore,
      contextStore,
    });
    const { emitter, events } = createCollectorEmitter();
    await service.handle({ message: 'hi' }, emitter, new AbortController().signal);
    const errEvt = events.find((e) => e.event === 'error');
    expect(errEvt).toBeDefined();
    expect((errEvt!.data as { message: string }).message).toMatch(/Authentication/);
    expect((errEvt!.data as { retryable: boolean }).retryable).toBe(false);
  });

  it('marks transient errors retryable=true', async () => {
    class TransientProvider {
      readonly model = 'rl';
      async *stream(): AsyncGenerator<never> {
        const err = new Error('Network error') as Error & { code?: string };
        err.code = 'ECONNRESET';
        throw err;
      }
    }
    const historyStore = new HistoryStore(path.join(dir, 'sessions.json'));
    const contextStore = new ContextStore(path.join(dir, 'context.json'));
    const service = new DispatchService({
      // @ts-expect-error duck-typed test provider
      provider: new TransientProvider(),
      historyStore,
      contextStore,
    });
    const { emitter, events } = createCollectorEmitter();
    await service.handle({ message: 'hi' }, emitter, new AbortController().signal);
    const errEvt = events.find((e) => e.event === 'error')!;
    expect((errEvt.data as { retryable: boolean }).retryable).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run server/domain/dispatch/dispatch.service.test.ts
```

Expected: FAIL — cannot resolve `./dispatch.service`.

- [ ] **Step 3: Write the implementation**

`server/domain/dispatch/dispatch.service.ts`:
```ts
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { SseEmitter } from '@/server/lib/sse';
import type { ContextStore } from '@/server/domain/context/context.store';
import type { HistoryStore } from '@/server/domain/history/history.store';
import type { AIProvider } from './providers/provider.types';

export const DispatchRequestSchema = z.object({
  message: z.string().min(1),
});
export type DispatchRequest = z.infer<typeof DispatchRequestSchema>;

export interface DispatchServiceDeps {
  provider: AIProvider;
  historyStore: HistoryStore;
  contextStore: ContextStore;
}

export class DispatchService {
  constructor(private readonly deps: DispatchServiceDeps) {}

  async handle(
    rawBody: unknown,
    sse: SseEmitter,
    signal: AbortSignal,
  ): Promise<void> {
    const parsed = DispatchRequestSchema.safeParse(rawBody);
    if (!parsed.success) {
      sse.error('Invalid request body');
      return;
    }
    const { message } = parsed.data;
    const { provider, historyStore, contextStore } = this.deps;

    let context;
    try {
      context = await contextStore.read();
    } catch (e) {
      sse.event('error', { message: 'Context load failed', retryable: true });
      sse.end();
      return;
    }

    const priorHistory = await historyStore.read();
    const now = Date.now();
    await historyStore.append({
      id: randomUUID(),
      role: 'user',
      text: message,
      timestamp: now,
    });

    let accumulated = '';
    try {
      const it = provider.stream(
        {
          systemInstruction: context.systemInstruction,
          history: priorHistory.map((m) => ({ role: m.role, text: m.text })),
          userMessage: message,
        },
        signal,
      );
      for await (const chunk of it) {
        if (signal.aborted) break;
        if (chunk.type === 'text') {
          accumulated += chunk.text;
          sse.event('text', { chunk: chunk.text });
        } else if (chunk.type === 'done') {
          break;
        }
      }
    } catch (e) {
      const { message: msg, retryable } = classifyError(e);
      sse.event('error', { message: msg, retryable });
      // salva il partial comunque per coerenza UX
      await historyStore.append({
        id: randomUUID(),
        role: 'model',
        text: accumulated,
        timestamp: Date.now(),
        model: provider.model,
        error: msg,
        retryable,
      });
      sse.end();
      return;
    }

    const interrupted = signal.aborted;
    await historyStore.append({
      id: randomUUID(),
      role: 'model',
      text: accumulated,
      timestamp: Date.now(),
      model: provider.model,
      interrupted,
    });

    sse.event('done', { model: provider.model, interrupted });
    sse.end();
  }
}

function classifyError(e: unknown): { message: string; retryable: boolean } {
  const message = e instanceof Error ? e.message : 'Unknown error';
  const code = (e as { code?: string; status?: number }).code;
  const status = (e as { status?: number }).status;
  // Retryable: network/transient/rate-limit
  if (code === 'ECONNRESET' || code === 'ETIMEDOUT' || code === 'EAI_AGAIN') {
    return { message, retryable: true };
  }
  if (status === 429 || status === 503 || status === 504) {
    return { message, retryable: true };
  }
  // Non-retryable: auth/config
  if (status === 401 || status === 403 || /api[_ ]?key|auth|unauthor/i.test(message)) {
    return { message, retryable: false };
  }
  // Default: retryable=true (conservativo per network blips)
  return { message, retryable: true };
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run server/domain/dispatch/dispatch.service.test.ts
```

Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add server/domain/dispatch/dispatch.service.ts server/domain/dispatch/dispatch.service.test.ts
git commit -m "feat(slice-2a): add dispatch.service (orchestration + error classification)"
```

---

## Phase F — dispatch.routes + history.routes + wire app

### Task F1: dispatch.routes

**Files:**
- Create: `server/routes/dispatch.routes.ts`
- Create: `server/routes/dispatch.routes.test.ts`

- [ ] **Step 1: Write the failing test**

`server/routes/dispatch.routes.test.ts`:
```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createApp } from '@/server/app';
import { ContextStore } from '@/server/domain/context/context.store';
import { HistoryStore } from '@/server/domain/history/history.store';
import { DispatchService } from '@/server/domain/dispatch/dispatch.service';
import { FakeProvider } from '@/server/domain/dispatch/providers/fake.provider';
import { collectSseEvents } from '@/server/test/sse-collector';

let dir: string;
let contextStore: ContextStore;
let historyStore: HistoryStore;

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'aether-disp-routes-'));
  contextStore = new ContextStore(path.join(dir, 'context.json'));
  historyStore = new HistoryStore(path.join(dir, 'sessions.json'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

function appWith(chunks: string[]) {
  const provider = new FakeProvider({ chunks });
  const dispatcher = new DispatchService({ provider, historyStore, contextStore });
  return createApp({ contextStore, historyStore, dispatcher });
}

describe('/api/ai/dispatch', () => {
  it('streams text + done events', async () => {
    const app = appWith(['Hello', ' world']);
    const res = await request(app)
      .post('/api/ai/dispatch')
      .set('Accept', 'text/event-stream')
      .send({ message: 'hi' });
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/event-stream/);
    const events = await collectSseEvents(res);
    expect(events.map((e) => e.event)).toEqual(['text', 'text', 'done']);
    expect(events[0].data).toEqual({ chunk: 'Hello' });
  });

  it('persists messages after success', async () => {
    const app = appWith(['pong']);
    await request(app).post('/api/ai/dispatch').send({ message: 'ping' });
    const msgs = await historyStore.read();
    expect(msgs.map((m) => `${m.role}:${m.text}`)).toEqual(['user:ping', 'model:pong']);
  });

  it('emits error event for invalid body', async () => {
    const app = appWith(['x']);
    const res = await request(app).post('/api/ai/dispatch').send({});
    const events = await collectSseEvents(res);
    expect(events.find((e) => e.event === 'error')).toBeDefined();
  });

  it('returns 503 when dispatcher is not configured', async () => {
    const app = createApp({ contextStore, historyStore });
    const res = await request(app).post('/api/ai/dispatch').send({ message: 'x' });
    expect(res.status).toBe(503);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run server/routes/dispatch.routes.test.ts
```

Expected: FAIL — cannot resolve `dispatch.routes` and `dispatcher` dep.

- [ ] **Step 3: Write the route**

`server/routes/dispatch.routes.ts`:
```ts
import { Router, type Request, type Response } from 'express';
import { createSseEmitter } from '@/server/lib/sse';
import type { DispatchService } from '@/server/domain/dispatch/dispatch.service';

export function createDispatchRoutes(dispatcher: DispatchService): Router {
  const router = Router();

  router.post('/', async (req: Request, res: Response) => {
    const sse = createSseEmitter(res);
    const controller = new AbortController();
    req.on('close', () => controller.abort());
    try {
      await dispatcher.handle(req.body, sse, controller.signal);
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Internal error';
      sse.error(message);
    }
  });

  return router;
}
```

- [ ] **Step 4: Wire in app.ts**

Modify `server/app.ts`:

```ts
import express, { type Express, type NextFunction, type Request, type Response } from 'express';
import { isAppError } from './lib/errors';
import type { ContextStore } from './domain/context/context.store';
import type { HistoryStore } from './domain/history/history.store';
import type { DispatchService } from './domain/dispatch/dispatch.service';
import { createContextRoutes } from './routes/context.routes';
import { createDispatchRoutes } from './routes/dispatch.routes';

export interface AppDeps {
  contextStore?: ContextStore;
  historyStore?: HistoryStore;
  dispatcher?: DispatchService;
}

export function createApp(
  deps: AppDeps,
  extraRoutes?: (app: Express) => void,
): Express {
  const app = express();
  app.use(express.json({ limit: '1mb' }));

  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok' });
  });

  if (deps.contextStore) {
    app.use('/api/context', createContextRoutes(deps.contextStore));
  }

  if (deps.dispatcher) {
    app.use('/api/ai/dispatch', createDispatchRoutes(deps.dispatcher));
  } else {
    app.post('/api/ai/dispatch', (_req, res) => {
      res.status(503).json({ error: { code: 'NO_DISPATCHER', message: 'Dispatcher not configured' } });
    });
  }

  extraRoutes?.(app);

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

- [ ] **Step 5: Run dispatch route tests**

```bash
npx vitest run server/routes/dispatch.routes.test.ts
```

Expected: PASS (4 tests).

- [ ] **Step 6: Run existing app.test.ts to verify no regression**

```bash
npx vitest run server/app.test.ts
```

Expected: PASS (all existing tests).

- [ ] **Step 7: Commit**

```bash
git add server/routes/dispatch.routes.ts server/routes/dispatch.routes.test.ts server/app.ts
git commit -m "feat(slice-2a): wire POST /api/ai/dispatch route with SSE streaming"
```

---

### Task F2: history.routes

**Files:**
- Create: `server/routes/history.routes.ts`
- Create: `server/routes/history.routes.test.ts`

- [ ] **Step 1: Write the failing test**

`server/routes/history.routes.test.ts`:
```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createApp } from '@/server/app';
import { ContextStore } from '@/server/domain/context/context.store';
import { HistoryStore } from '@/server/domain/history/history.store';

let dir: string;
let contextStore: ContextStore;
let historyStore: HistoryStore;
let app: ReturnType<typeof createApp>;

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'aether-hist-routes-'));
  contextStore = new ContextStore(path.join(dir, 'context.json'));
  historyStore = new HistoryStore(path.join(dir, 'sessions.json'));
  app = createApp({ contextStore, historyStore });
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('/api/sessions/default', () => {
  it('GET returns empty messages on empty history', async () => {
    const res = await request(app).get('/api/sessions/default');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ messages: [] });
  });

  it('GET returns stored messages', async () => {
    await historyStore.append({ id: 'a', role: 'user', text: 'hi', timestamp: 1 });
    await historyStore.append({ id: 'b', role: 'model', text: 'hello', timestamp: 2 });
    const res = await request(app).get('/api/sessions/default');
    expect(res.body.messages).toHaveLength(2);
    expect(res.body.messages[0]).toMatchObject({ id: 'a', role: 'user' });
  });

  it('DELETE clears the session', async () => {
    await historyStore.append({ id: 'a', role: 'user', text: 'x', timestamp: 1 });
    const res = await request(app).delete('/api/sessions/default');
    expect(res.status).toBe(204);
    expect(await historyStore.read()).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run server/routes/history.routes.test.ts
```

Expected: FAIL — route not registered.

- [ ] **Step 3: Write the route**

`server/routes/history.routes.ts`:
```ts
import { Router } from 'express';
import type { HistoryStore } from '@/server/domain/history/history.store';

export function createHistoryRoutes(store: HistoryStore): Router {
  const router = Router();

  router.get('/default', async (_req, res, next) => {
    try {
      const messages = await store.read();
      res.json({ messages });
    } catch (e) {
      next(e);
    }
  });

  router.delete('/default', async (_req, res, next) => {
    try {
      await store.reset();
      res.status(204).end();
    } catch (e) {
      next(e);
    }
  });

  return router;
}
```

- [ ] **Step 4: Wire in app.ts**

Add to `server/app.ts` just after the dispatcher block:
```ts
import { createHistoryRoutes } from './routes/history.routes';
// ...
if (deps.historyStore) {
  app.use('/api/sessions', createHistoryRoutes(deps.historyStore));
}
```

- [ ] **Step 5: Run test to verify it passes**

```bash
npx vitest run server/routes/history.routes.test.ts
```

Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
git add server/routes/history.routes.ts server/routes/history.routes.test.ts server/app.ts
git commit -m "feat(slice-2a): add GET/DELETE /api/sessions/default route"
```

---

## Phase G — Gemini provider (mocked SDK)

### Task G1: GeminiProvider

**Files:**
- Create: `server/domain/dispatch/providers/gemini.provider.ts`
- Create: `server/domain/dispatch/providers/gemini.provider.test.ts`

- [ ] **Step 1: Write the failing test**

`server/domain/dispatch/providers/gemini.provider.test.ts`:
```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { AIProvider, ProviderChunk } from './provider.types';

// Mock @google/genai prima dell'import del provider
const generateContentStream = vi.fn();
vi.mock('@google/genai', () => ({
  GoogleGenAI: vi.fn().mockImplementation(() => ({
    models: { generateContentStream },
  })),
}));

async function collect<T>(it: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const v of it) out.push(v);
  return out;
}

beforeEach(() => {
  generateContentStream.mockReset();
});

describe('GeminiProvider', () => {
  it('streams text chunks then done', async () => {
    async function* fakeStream() {
      yield { text: 'Hello' };
      yield { text: ' world' };
    }
    generateContentStream.mockResolvedValue(fakeStream());

    const { GeminiProvider } = await import('./gemini.provider');
    const p: AIProvider = new GeminiProvider({ apiKey: 'k', model: 'gemini-test' });
    const events = await collect(
      p.stream(
        { systemInstruction: 'SYS', history: [{ role: 'user', text: 'prev' }], userMessage: 'now' },
        new AbortController().signal,
      ),
    );
    expect(events).toEqual<ProviderChunk[]>([
      { type: 'text', text: 'Hello' },
      { type: 'text', text: ' world' },
      { type: 'done' },
    ]);
  });

  it('forwards systemInstruction + history + userMessage to SDK', async () => {
    async function* empty() { yield { text: 'x' }; }
    generateContentStream.mockResolvedValue(empty());

    const { GeminiProvider } = await import('./gemini.provider');
    const p = new GeminiProvider({ apiKey: 'k', model: 'gemini-test' });
    await collect(
      p.stream(
        {
          systemInstruction: 'BE_HELPFUL',
          history: [
            { role: 'user', text: 'hi' },
            { role: 'model', text: 'hello' },
          ],
          userMessage: 'how are you',
        },
        new AbortController().signal,
      ),
    );
    const call = generateContentStream.mock.calls[0][0];
    expect(call.model).toBe('gemini-test');
    expect(call.config.systemInstruction).toBe('BE_HELPFUL');
    expect(call.contents).toEqual([
      { role: 'user', parts: [{ text: 'hi' }] },
      { role: 'model', parts: [{ text: 'hello' }] },
      { role: 'user', parts: [{ text: 'how are you' }] },
    ]);
  });

  it('skips chunks with empty text', async () => {
    async function* stream() {
      yield { text: 'A' };
      yield { text: '' };
      yield { text: undefined };
      yield { text: 'B' };
    }
    generateContentStream.mockResolvedValue(stream());
    const { GeminiProvider } = await import('./gemini.provider');
    const p = new GeminiProvider({ apiKey: 'k', model: 'm' });
    const events = await collect(
      p.stream(
        { systemInstruction: '', history: [], userMessage: 'x' },
        new AbortController().signal,
      ),
    );
    expect(events.filter((e) => e.type === 'text')).toEqual([
      { type: 'text', text: 'A' },
      { type: 'text', text: 'B' },
    ]);
  });

  it('breaks the stream when aborted', async () => {
    async function* slow() {
      yield { text: 'A' };
      await new Promise((r) => setTimeout(r, 20));
      yield { text: 'B' };
    }
    generateContentStream.mockResolvedValue(slow());
    const { GeminiProvider } = await import('./gemini.provider');
    const p = new GeminiProvider({ apiKey: 'k', model: 'm' });
    const ctrl = new AbortController();
    setTimeout(() => ctrl.abort(), 5);
    const out: ProviderChunk[] = [];
    for await (const ev of p.stream(
      { systemInstruction: '', history: [], userMessage: 'x' },
      ctrl.signal,
    )) {
      out.push(ev);
    }
    expect(out.filter((e) => e.type === 'text').map((e) => e.type === 'text' && e.text)).not.toContain('B');
  });

  it('throws with code preserved on SDK rejection', async () => {
    generateContentStream.mockRejectedValue(Object.assign(new Error('Auth failed'), { status: 401 }));
    const { GeminiProvider } = await import('./gemini.provider');
    const p = new GeminiProvider({ apiKey: 'k', model: 'm' });
    await expect(
      collect(
        p.stream(
          { systemInstruction: '', history: [], userMessage: 'x' },
          new AbortController().signal,
        ),
      ),
    ).rejects.toMatchObject({ message: 'Auth failed', status: 401 });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run server/domain/dispatch/providers/gemini.provider.test.ts
```

Expected: FAIL — cannot resolve `./gemini.provider`.

- [ ] **Step 3: Write the implementation**

`server/domain/dispatch/providers/gemini.provider.ts`:
```ts
import { GoogleGenAI } from '@google/genai';
import type { AIProvider, ProviderChunk, ProviderRequest } from './provider.types';

export interface GeminiProviderOptions {
  apiKey: string;
  model?: string;
}

export class GeminiProvider implements AIProvider {
  readonly model: string;
  private ai: GoogleGenAI;

  constructor(opts: GeminiProviderOptions) {
    this.model = opts.model ?? 'gemini-2.0-flash-exp';
    this.ai = new GoogleGenAI({ apiKey: opts.apiKey });
  }

  async *stream(
    req: ProviderRequest,
    signal: AbortSignal,
  ): AsyncGenerator<ProviderChunk> {
    const contents = [
      ...req.history.map((m) => ({ role: m.role, parts: [{ text: m.text }] })),
      { role: 'user' as const, parts: [{ text: req.userMessage }] },
    ];

    const stream = await this.ai.models.generateContentStream({
      model: this.model,
      contents,
      config: {
        systemInstruction: req.systemInstruction,
      },
    });

    for await (const chunk of stream) {
      if (signal.aborted) return;
      const text = chunk.text;
      if (typeof text === 'string' && text.length > 0) {
        yield { type: 'text', text };
      }
    }
    if (!signal.aborted) yield { type: 'done' };
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run server/domain/dispatch/providers/gemini.provider.test.ts
```

Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add server/domain/dispatch/providers/gemini.provider.ts server/domain/dispatch/providers/gemini.provider.test.ts
git commit -m "feat(slice-2a): add GeminiProvider with @google/genai streaming"
```

---

## Phase H — Bootstrap in server/index.ts

### Task H1: Provider selection in index.ts

**Files:**
- Modify: `server/index.ts`

- [ ] **Step 1: Replace the file content**

`server/index.ts`:
```ts
import path from 'node:path';
import express from 'express';
import { createServer as createViteServer } from 'vite';
import dotenv from 'dotenv';
import { createApp } from './app';
import { loadConfig } from './config';
import { ContextStore } from './domain/context/context.store';
import { HistoryStore } from './domain/history/history.store';
import { DispatchService } from './domain/dispatch/dispatch.service';
import { FakeProvider } from './domain/dispatch/providers/fake.provider';
import { GeminiProvider } from './domain/dispatch/providers/gemini.provider';
import type { AIProvider } from './domain/dispatch/providers/provider.types';

dotenv.config();

async function bootstrap() {
  const cfg = loadConfig();

  const contextStore = new ContextStore(path.join(cfg.dataDir, 'context.json'));
  const historyStore = new HistoryStore(path.join(cfg.dataDir, 'sessions.json'));

  let provider: AIProvider;
  if (cfg.fakeProvider) {
    provider = new FakeProvider({
      chunks: ['pong'],
      chunkDelayMs: 50,
      model: 'fake-1',
    });
    console.log('[aether] Using FakeProvider (AETHER_FAKE_PROVIDER=1)');
  } else {
    if (!cfg.geminiApiKey) {
      console.warn('[aether] GEMINI_API_KEY not set — falling back to FakeProvider');
      provider = new FakeProvider({ chunks: ['pong'], chunkDelayMs: 50 });
    } else {
      provider = new GeminiProvider({ apiKey: cfg.geminiApiKey });
    }
  }

  const dispatcher = new DispatchService({ provider, historyStore, contextStore });

  const app = createApp({ contextStore, historyStore, dispatcher });

  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(cfg.port, '0.0.0.0', () => {
    console.log(`Aether server running on http://localhost:${cfg.port}`);
  });
}

bootstrap().catch((err) => {
  console.error('Bootstrap failed:', err);
  process.exit(1);
});
```

- [ ] **Step 2: Verify lint passes**

```bash
npm run lint
```

Expected: PASS.

- [ ] **Step 3: Smoke run (manual sanity check, optional)**

```bash
AETHER_FAKE_PROVIDER=1 npm run dev
```

Then `curl -N -X POST http://localhost:3000/api/ai/dispatch -H 'Content-Type: application/json' -d '{"message":"hi"}'` should print `event: text\ndata: {"chunk":"pong"}\n\n` followed by `event: done...`. Kill with Ctrl+C.

- [ ] **Step 4: Run all backend tests**

```bash
npx vitest run server
```

Expected: ALL PASS.

- [ ] **Step 5: Commit**

```bash
git add server/index.ts
git commit -m "feat(slice-2a): wire dispatcher into bootstrap with FakeProvider fallback"
```

---

## Phase I — Frontend types + API clients

### Task I1: Message type (re-export to FE)

**Files:**
- Create: `src/types/message.types.ts`

- [ ] **Step 1: Create the file**

`src/types/message.types.ts`:
```ts
export type { Message } from '@/server/domain/history/history.types';
```

- [ ] **Step 2: Verify lint passes**

```bash
npm run lint
```

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/types/message.types.ts
git commit -m "feat(slice-2a): re-export Message type to frontend"
```

---

### Task I2: history.api

**Files:**
- Create: `src/lib/api/history.api.ts`
- Create: `src/lib/api/history.api.test.ts`
- Modify: `src/test/msw-handlers.ts`

- [ ] **Step 1: Add MSW handler**

Modify `src/test/msw-handlers.ts` — replace its content with:
```ts
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
```

- [ ] **Step 2: Write the failing test**

`src/lib/api/history.api.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { http, HttpResponse } from 'msw';
import { server } from '@/src/test/msw-server';
import { historyApi } from './history.api';

describe('historyApi', () => {
  it('fetchDefault returns empty messages from default handler', async () => {
    const out = await historyApi.fetchDefault();
    expect(out).toEqual([]);
  });

  it('fetchDefault returns messages when populated', async () => {
    server.use(
      http.get('http://localhost/api/sessions/default', () =>
        HttpResponse.json({
          messages: [{ id: 'a', role: 'user', text: 'hi', timestamp: 1 }],
        }),
      ),
    );
    const out = await historyApi.fetchDefault();
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ id: 'a', role: 'user' });
  });

  it('clearDefault hits DELETE', async () => {
    let called = false;
    server.use(
      http.delete('http://localhost/api/sessions/default', () => {
        called = true;
        return new HttpResponse(null, { status: 204 });
      }),
    );
    await historyApi.clearDefault();
    expect(called).toBe(true);
  });

  it('throws on 500', async () => {
    server.use(
      http.get('http://localhost/api/sessions/default', () =>
        HttpResponse.json({ error: { message: 'boom' } }, { status: 500 }),
      ),
    );
    await expect(historyApi.fetchDefault()).rejects.toThrow(/boom/);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

```bash
npx vitest run src/lib/api/history.api.test.ts
```

Expected: FAIL — cannot resolve `./history.api`.

- [ ] **Step 4: Write the implementation**

`src/lib/api/history.api.ts`:
```ts
import type { Message } from '@/src/types/message.types';

const BASE = '/api/sessions';

interface ErrorBody { error?: { message?: string } }

async function asJson<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as ErrorBody;
    throw new Error(body?.error?.message ?? `HTTP ${res.status}`);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export const historyApi = {
  fetchDefault: async (): Promise<Message[]> => {
    const res = await fetch(`${BASE}/default`);
    const body = await asJson<{ messages: Message[] }>(res);
    return body.messages;
  },
  clearDefault: async (): Promise<void> => {
    const res = await fetch(`${BASE}/default`, { method: 'DELETE' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
  },
};
```

- [ ] **Step 5: Run test to verify it passes**

```bash
npx vitest run src/lib/api/history.api.test.ts
```

Expected: PASS (4 tests).

- [ ] **Step 6: Commit**

```bash
git add src/lib/api/history.api.ts src/lib/api/history.api.test.ts src/test/msw-handlers.ts
git commit -m "feat(slice-2a): add historyApi client + MSW default handler"
```

---

### Task I3: dispatch.api with SSE streaming

**Files:**
- Create: `src/lib/api/dispatch.api.ts`
- Create: `src/lib/api/dispatch.api.test.ts`

- [ ] **Step 1: Write the failing test**

`src/lib/api/dispatch.api.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { http, HttpResponse } from 'msw';
import { server } from '@/src/test/msw-server';
import { createStreamingDispatch } from './dispatch.api';

function sseChunks(...lines: string[]) {
  const enc = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(c) {
      for (const l of lines) c.enqueue(enc.encode(l));
      c.close();
    },
  });
}

async function collect<T>(it: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const v of it) out.push(v);
  return out;
}

describe('createStreamingDispatch', () => {
  it('yields parsed text + done events', async () => {
    server.use(
      http.post('http://localhost/api/ai/dispatch', () =>
        new HttpResponse(
          sseChunks(
            'event: text\ndata: {"chunk":"Hello"}\n\n',
            'event: text\ndata: {"chunk":" world"}\n\n',
            'event: done\ndata: {"model":"fake-1","interrupted":false}\n\n',
          ),
          { headers: { 'Content-Type': 'text/event-stream' } },
        ),
      ),
    );
    const events = await collect(createStreamingDispatch({ message: 'hi' }, new AbortController().signal));
    expect(events.map((e) => e.event)).toEqual(['text', 'text', 'done']);
    expect(events[2].data).toMatchObject({ model: 'fake-1', interrupted: false });
  });

  it('handles chunk boundaries inside events', async () => {
    server.use(
      http.post('http://localhost/api/ai/dispatch', () =>
        new HttpResponse(
          sseChunks(
            'event: text\nd',
            'ata: {"chunk":"A"}\n\nevent: text\ndata: {"chu',
            'nk":"B"}\n\nevent: done\ndata: {"model":"m","interrupted":false}\n\n',
          ),
          { headers: { 'Content-Type': 'text/event-stream' } },
        ),
      ),
    );
    const events = await collect(createStreamingDispatch({ message: 'hi' }, new AbortController().signal));
    expect(events.filter((e) => e.event === 'text').map((e) => (e.data as { chunk: string }).chunk))
      .toEqual(['A', 'B']);
  });

  it('throws AbortError when signal aborted before fetch resolves', async () => {
    server.use(
      http.post('http://localhost/api/ai/dispatch', async () =>
        new HttpResponse(
          sseChunks('event: text\ndata: {"chunk":"A"}\n\n'),
          { headers: { 'Content-Type': 'text/event-stream' } },
        ),
      ),
    );
    const ctrl = new AbortController();
    ctrl.abort();
    await expect(
      collect(createStreamingDispatch({ message: 'hi' }, ctrl.signal)),
    ).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('throws when response is not ok', async () => {
    server.use(
      http.post('http://localhost/api/ai/dispatch', () =>
        HttpResponse.json({ error: { message: 'bad' } }, { status: 503 }),
      ),
    );
    await expect(
      collect(createStreamingDispatch({ message: 'hi' }, new AbortController().signal)),
    ).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run src/lib/api/dispatch.api.test.ts
```

Expected: FAIL — cannot resolve `./dispatch.api`.

- [ ] **Step 3: Write the implementation**

`src/lib/api/dispatch.api.ts`:
```ts
import { parseSseStream, type SseEvent } from '@/src/lib/sse-parser';

export interface DispatchRequestBody {
  message: string;
}

export async function* createStreamingDispatch(
  body: DispatchRequestBody,
  signal: AbortSignal,
): AsyncGenerator<SseEvent> {
  const res = await fetch('/api/ai/dispatch', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
    body: JSON.stringify(body),
    signal,
  });
  if (!res.ok || !res.body) {
    throw new Error(`HTTP ${res.status}`);
  }
  for await (const ev of parseSseStream(res.body)) {
    yield ev;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run src/lib/api/dispatch.api.test.ts
```

Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/api/dispatch.api.ts src/lib/api/dispatch.api.test.ts
git commit -m "feat(slice-2a): add createStreamingDispatch SSE client"
```

---

## Phase J — chat.store (Zustand)

### Task J1: chat.store

**Files:**
- Create: `src/stores/chat.store.ts`
- Create: `src/stores/chat.store.test.ts`

- [ ] **Step 1: Write the failing test**

`src/stores/chat.store.test.ts`:
```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { useChatStore } from './chat.store';

beforeEach(() => {
  useChatStore.getState()._reset();
});

describe('useChatStore', () => {
  it('starts with empty state', () => {
    const s = useChatStore.getState();
    expect(s.messages).toEqual([]);
    expect(s.streamingId).toBeNull();
    expect(s.hydrated).toBe(false);
  });

  it('hydrate sets messages and hydrated flag', () => {
    useChatStore.getState().hydrate([
      { id: 'a', role: 'user', text: 'hi', timestamp: 1 },
    ]);
    expect(useChatStore.getState().messages).toHaveLength(1);
    expect(useChatStore.getState().hydrated).toBe(true);
  });

  it('appendUser pushes a user message', () => {
    const { id } = useChatStore.getState().appendUser('hello');
    const msgs = useChatStore.getState().messages;
    expect(msgs).toHaveLength(1);
    expect(msgs[0]).toMatchObject({ id, role: 'user', text: 'hello' });
  });

  it('startAssistant creates empty model bubble and sets streamingId', () => {
    const { id } = useChatStore.getState().startAssistant();
    const s = useChatStore.getState();
    expect(s.streamingId).toBe(id);
    expect(s.messages.at(-1)).toMatchObject({ id, role: 'model', text: '' });
  });

  it('appendChunk concatenates text on the right message', () => {
    const { id } = useChatStore.getState().startAssistant();
    useChatStore.getState().appendChunk(id, 'Hello');
    useChatStore.getState().appendChunk(id, ' world');
    const last = useChatStore.getState().messages.at(-1);
    expect(last?.text).toBe('Hello world');
  });

  it('finishAssistant clears streamingId and sets model + interrupted', () => {
    const { id } = useChatStore.getState().startAssistant();
    useChatStore.getState().finishAssistant(id, { model: 'fake-1', interrupted: false });
    const s = useChatStore.getState();
    expect(s.streamingId).toBeNull();
    expect(s.messages.at(-1)).toMatchObject({ model: 'fake-1', interrupted: false });
  });

  it('failAssistant sets error and retryable, clears streamingId', () => {
    const { id } = useChatStore.getState().startAssistant();
    useChatStore.getState().failAssistant(id, 'boom', true);
    const last = useChatStore.getState().messages.at(-1);
    expect(last).toMatchObject({ error: 'boom', retryable: true });
    expect(useChatStore.getState().streamingId).toBeNull();
  });

  it('abort calls abortController.abort and clears it', () => {
    const c = new AbortController();
    useChatStore.getState().setAbortController(c);
    let aborted = false;
    c.signal.addEventListener('abort', () => { aborted = true; });
    useChatStore.getState().abort();
    expect(aborted).toBe(true);
    expect(useChatStore.getState().abortController).toBeNull();
  });

  it('abort is no-op when no controller', () => {
    expect(() => useChatStore.getState().abort()).not.toThrow();
  });

  it('reset clears everything', () => {
    useChatStore.getState().appendUser('x');
    useChatStore.getState().startAssistant();
    useChatStore.getState().reset();
    const s = useChatStore.getState();
    expect(s.messages).toEqual([]);
    expect(s.streamingId).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run src/stores/chat.store.test.ts
```

Expected: FAIL — cannot resolve `./chat.store`.

- [ ] **Step 3: Write the implementation**

`src/stores/chat.store.ts`:
```ts
import { create } from 'zustand';
import { newId } from '@/src/lib/ids';
import type { Message } from '@/src/types/message.types';

interface ChatState {
  messages: Message[];
  streamingId: string | null;
  abortController: AbortController | null;
  hydrated: boolean;

  hydrate: (messages: Message[]) => void;
  appendUser: (text: string) => { id: string };
  startAssistant: () => { id: string };
  appendChunk: (id: string, text: string) => void;
  finishAssistant: (id: string, opts: { model?: string; interrupted?: boolean }) => void;
  failAssistant: (id: string, error: string, retryable: boolean) => void;
  setAbortController: (c: AbortController | null) => void;
  abort: () => void;
  reset: () => void;
  _reset: () => void;
}

const initial = {
  messages: [] as Message[],
  streamingId: null as string | null,
  abortController: null as AbortController | null,
  hydrated: false,
};

export const useChatStore = create<ChatState>((set, get) => ({
  ...initial,
  _reset: () => set(initial),
  reset: () => set(initial),

  hydrate: (messages) => set({ messages, hydrated: true }),

  appendUser: (text) => {
    const msg: Message = { id: newId(), role: 'user', text, timestamp: Date.now() };
    set((s) => ({ messages: [...s.messages, msg] }));
    return { id: msg.id };
  },

  startAssistant: () => {
    const msg: Message = { id: newId(), role: 'model', text: '', timestamp: Date.now() };
    set((s) => ({ messages: [...s.messages, msg], streamingId: msg.id }));
    return { id: msg.id };
  },

  appendChunk: (id, text) =>
    set((s) => ({
      messages: s.messages.map((m) =>
        m.id === id ? { ...m, text: m.text + text } : m,
      ),
    })),

  finishAssistant: (id, opts) =>
    set((s) => ({
      streamingId: s.streamingId === id ? null : s.streamingId,
      messages: s.messages.map((m) =>
        m.id === id ? { ...m, ...opts } : m,
      ),
      abortController: null,
    })),

  failAssistant: (id, error, retryable) =>
    set((s) => ({
      streamingId: s.streamingId === id ? null : s.streamingId,
      messages: s.messages.map((m) =>
        m.id === id ? { ...m, error, retryable } : m,
      ),
      abortController: null,
    })),

  setAbortController: (c) => set({ abortController: c }),

  abort: () => {
    const c = get().abortController;
    if (!c) return;
    c.abort();
    set({ abortController: null });
  },
}));
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run src/stores/chat.store.test.ts
```

Expected: PASS (10 tests).

- [ ] **Step 5: Commit**

```bash
git add src/stores/chat.store.ts src/stores/chat.store.test.ts
git commit -m "feat(slice-2a): add useChatStore (Zustand) with streaming state"
```

---

## Phase K — Hooks

### Task K1: useStreamingDispatch

**Files:**
- Create: `src/hooks/useStreamingDispatch.ts`
- Create: `src/hooks/useStreamingDispatch.test.ts`

- [ ] **Step 1: Write the failing test**

`src/hooks/useStreamingDispatch.test.ts`:
```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { server } from '@/src/test/msw-server';
import { useStreamingDispatch } from './useStreamingDispatch';
import { useChatStore } from '@/src/stores/chat.store';

function sseStream(...lines: string[]) {
  const enc = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(c) {
      for (const l of lines) c.enqueue(enc.encode(l));
      c.close();
    },
  });
}

beforeEach(() => {
  useChatStore.getState()._reset();
});

describe('useStreamingDispatch', () => {
  it('happy path: appends user + streams assistant + finalizes', async () => {
    server.use(
      http.post('http://localhost/api/ai/dispatch', () =>
        new HttpResponse(
          sseStream(
            'event: text\ndata: {"chunk":"Hello"}\n\n',
            'event: text\ndata: {"chunk":" world"}\n\n',
            'event: done\ndata: {"model":"fake-1","interrupted":false}\n\n',
          ),
          { headers: { 'Content-Type': 'text/event-stream' } },
        ),
      ),
    );
    const { result } = renderHook(() => useStreamingDispatch());
    await act(async () => {
      await result.current.send('hi');
    });
    const msgs = useChatStore.getState().messages;
    expect(msgs).toHaveLength(2);
    expect(msgs[0]).toMatchObject({ role: 'user', text: 'hi' });
    expect(msgs[1]).toMatchObject({ role: 'model', text: 'Hello world', model: 'fake-1' });
    expect(useChatStore.getState().streamingId).toBeNull();
  });

  it('error event marks message as failed with retryable flag', async () => {
    server.use(
      http.post('http://localhost/api/ai/dispatch', () =>
        new HttpResponse(
          sseStream('event: error\ndata: {"message":"Auth failed","retryable":false}\n\n'),
          { headers: { 'Content-Type': 'text/event-stream' } },
        ),
      ),
    );
    const { result } = renderHook(() => useStreamingDispatch());
    await act(async () => {
      await result.current.send('hi');
    });
    const last = useChatStore.getState().messages.at(-1);
    expect(last?.error).toBe('Auth failed');
    expect(last?.retryable).toBe(false);
  });

  it('abort marks message interrupted', async () => {
    server.use(
      http.post('http://localhost/api/ai/dispatch', async () =>
        new HttpResponse(
          sseStream('event: text\ndata: {"chunk":"A"}\n\n'),
          { headers: { 'Content-Type': 'text/event-stream' } },
        ),
      ),
    );
    const { result } = renderHook(() => useStreamingDispatch());
    const promise = act(async () => {
      const p = result.current.send('hi');
      // abort subito dopo: MSW handler restituisce immediatamente, ma il segnale
      // viene comunque visto come abort se chiamato durante l'iterazione.
      result.current.abort();
      await p;
    });
    await promise;
    await waitFor(() => {
      expect(useChatStore.getState().streamingId).toBeNull();
    });
  });

  it('isStreaming flips during send', async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => { release = r; });
    server.use(
      http.post('http://localhost/api/ai/dispatch', async () => {
        await gate;
        return new HttpResponse(
          sseStream('event: done\ndata: {"model":"f","interrupted":false}\n\n'),
          { headers: { 'Content-Type': 'text/event-stream' } },
        );
      }),
    );
    const { result } = renderHook(() => useStreamingDispatch());
    const p = act(async () => { await result.current.send('hi'); });
    await waitFor(() => {
      expect(result.current.isStreaming).toBe(true);
    });
    release();
    await p;
    expect(result.current.isStreaming).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run src/hooks/useStreamingDispatch.test.ts
```

Expected: FAIL — cannot resolve.

- [ ] **Step 3: Write the implementation**

`src/hooks/useStreamingDispatch.ts`:
```ts
import { useCallback } from 'react';
import { useChatStore } from '@/src/stores/chat.store';
import { createStreamingDispatch } from '@/src/lib/api/dispatch.api';

interface TextData { chunk: string }
interface DoneData { model?: string; interrupted?: boolean }
interface ErrorData { message: string; retryable: boolean }

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : 'Unknown error';
}

export function useStreamingDispatch() {
  const isStreaming = useChatStore((s) => s.streamingId !== null);

  const send = useCallback(async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    const store = useChatStore.getState();
    if (store.streamingId) return; // guard against double-send

    store.appendUser(trimmed);
    const { id } = store.startAssistant();
    const controller = new AbortController();
    store.setAbortController(controller);

    try {
      for await (const ev of createStreamingDispatch({ message: trimmed }, controller.signal)) {
        if (ev.event === 'text') {
          useChatStore.getState().appendChunk(id, (ev.data as TextData).chunk);
        } else if (ev.event === 'done') {
          const d = ev.data as DoneData;
          useChatStore.getState().finishAssistant(id, { model: d.model, interrupted: !!d.interrupted });
          return;
        } else if (ev.event === 'error') {
          const d = ev.data as ErrorData;
          useChatStore.getState().failAssistant(id, d.message, !!d.retryable);
          return;
        }
      }
      // stream esaurito senza event:done → trattiamolo come done
      useChatStore.getState().finishAssistant(id, { interrupted: controller.signal.aborted });
    } catch (e) {
      if (controller.signal.aborted) {
        useChatStore.getState().finishAssistant(id, { interrupted: true });
      } else {
        useChatStore.getState().failAssistant(id, errMsg(e), true);
      }
    }
  }, []);

  const abort = useCallback(() => {
    useChatStore.getState().abort();
  }, []);

  return { send, abort, isStreaming };
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run src/hooks/useStreamingDispatch.test.ts
```

Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/hooks/useStreamingDispatch.ts src/hooks/useStreamingDispatch.test.ts
git commit -m "feat(slice-2a): add useStreamingDispatch hook (send + abort + isStreaming)"
```

---

### Task K2: useAutoScroll

**Files:**
- Create: `src/hooks/useAutoScroll.ts`
- Create: `src/hooks/useAutoScroll.test.ts`

- [ ] **Step 1: Write the failing test**

`src/hooks/useAutoScroll.test.ts`:
```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useAutoScroll } from './useAutoScroll';
import { useRef, useEffect } from 'react';

// jsdom non implementa scrollTo, ma scrollTop scrittura sì.
function makeContainer({ scrollHeight = 1000, clientHeight = 200, scrollTop = 0 } = {}) {
  const el = document.createElement('div');
  Object.defineProperty(el, 'scrollHeight', { value: scrollHeight, configurable: true });
  Object.defineProperty(el, 'clientHeight', { value: clientHeight, configurable: true });
  el.scrollTop = scrollTop;
  return el;
}

function harness(initialDeps: number[]) {
  return renderHook(({ deps }: { deps: number[] }) => {
    const ref = useRef<HTMLDivElement | null>(null);
    // mountato solo una volta
    useEffect(() => {
      if (!ref.current) ref.current = makeContainer({ scrollHeight: 1000, clientHeight: 200 });
    }, []);
    useAutoScroll(ref, deps);
    return ref;
  }, { initialProps: { deps: initialDeps } });
}

beforeEach(() => { /* noop */ });

describe('useAutoScroll', () => {
  it('scrolls to bottom when deps change and user is at bottom', () => {
    const { result, rerender } = harness([0]);
    const el = result.current.current!;
    // simula user al bottom (scrollTop = scrollHeight - clientHeight)
    el.scrollTop = 800;
    rerender({ deps: [1] });
    expect(el.scrollTop).toBe(1000); // scrollHeight
  });

  it('does not scroll when user has scrolled up', () => {
    const { result, rerender } = harness([0]);
    const el = result.current.current!;
    el.scrollTop = 0; // user scrolled all the way up
    // simula evento scroll che setta userScrolledUp
    el.dispatchEvent(new Event('scroll'));
    rerender({ deps: [1] });
    expect(el.scrollTop).toBe(0);
  });

  it('resumes scrolling after user scrolls back to bottom', () => {
    const { result, rerender } = harness([0]);
    const el = result.current.current!;
    // scroll up: disabilita
    el.scrollTop = 0;
    el.dispatchEvent(new Event('scroll'));
    rerender({ deps: [1] });
    expect(el.scrollTop).toBe(0);
    // ritorna entro 50px dal bottom: riabilita
    el.scrollTop = 800; // 1000 - 200 = 800, esattamente al bottom
    el.dispatchEvent(new Event('scroll'));
    act(() => {});
    rerender({ deps: [2] });
    expect(el.scrollTop).toBe(1000);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run src/hooks/useAutoScroll.test.ts
```

Expected: FAIL — cannot resolve.

- [ ] **Step 3: Write the implementation**

`src/hooks/useAutoScroll.ts`:
```ts
import { useEffect, useRef, type RefObject } from 'react';

const BOTTOM_THRESHOLD_PX = 50;

export function useAutoScroll<T extends HTMLElement>(
  ref: RefObject<T | null>,
  deps: ReadonlyArray<unknown>,
): void {
  const userScrolledUpRef = useRef(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onScroll = () => {
      const dist = el.scrollHeight - (el.scrollTop + el.clientHeight);
      userScrolledUpRef.current = dist > BOTTOM_THRESHOLD_PX;
    };
    el.addEventListener('scroll', onScroll);
    return () => el.removeEventListener('scroll', onScroll);
  }, [ref]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (userScrolledUpRef.current) return;
    el.scrollTop = el.scrollHeight;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run src/hooks/useAutoScroll.test.ts
```

Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/hooks/useAutoScroll.ts src/hooks/useAutoScroll.test.ts
git commit -m "feat(slice-2a): add useAutoScroll hook (smart, threshold 50px)"
```

---

## Phase L — Chat components

### Task L1: StreamingIndicator + EmptyState (no test required — leaf presentationals)

**Files:**
- Create: `src/components/chat/StreamingIndicator.tsx`
- Create: `src/components/chat/EmptyState.tsx`

- [ ] **Step 1: Create StreamingIndicator**

`src/components/chat/StreamingIndicator.tsx`:
```tsx
export function StreamingIndicator() {
  return (
    <span
      aria-label="streaming"
      className="inline-block w-2 h-4 bg-accent animate-pulse align-middle ml-0.5"
    />
  );
}
```

- [ ] **Step 2: Create EmptyState**

`src/components/chat/EmptyState.tsx`:
```tsx
export function EmptyState() {
  return (
    <div className="flex-1 flex items-center justify-center text-zinc-600">
      <div className="text-center opacity-60">
        <div className="font-mono text-xs uppercase tracking-widest text-accent mb-2">
          Aether ready
        </div>
        <div className="text-[11px] text-zinc-500">
          Inizia digitando un messaggio qui sotto.
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Verify lint passes**

```bash
npm run lint
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/components/chat/StreamingIndicator.tsx src/components/chat/EmptyState.tsx
git commit -m "feat(slice-2a): add StreamingIndicator + EmptyState components"
```

---

### Task L2: MessageBubble

**Files:**
- Create: `src/components/chat/MessageBubble.tsx`
- Create: `src/components/chat/MessageBubble.test.tsx`

- [ ] **Step 1: Write the failing test**

`src/components/chat/MessageBubble.test.tsx`:
```tsx
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MessageBubble } from './MessageBubble';
import { useChatStore } from '@/src/stores/chat.store';

beforeEach(() => {
  useChatStore.getState()._reset();
});

interface SeedInput {
  id: string;
  role: 'user' | 'model';
  text: string;
  timestamp?: number;
  error?: string;
  retryable?: boolean;
  interrupted?: boolean;
  model?: string;
}

function seed(msg: SeedInput) {
  useChatStore.getState().hydrate([{ timestamp: 0, ...msg }]);
}

describe('MessageBubble', () => {
  it('renders user message as plain text', () => {
    seed({ id: 'u1', role: 'user', text: 'Hello **world**' });
    render(<MessageBubble id="u1" />);
    // user messages: niente markdown rendering, testo puro
    expect(screen.getByText('Hello **world**')).toBeInTheDocument();
  });

  it('renders model message with markdown', () => {
    seed({ id: 'm1', role: 'model', text: 'Hello **bold**' });
    render(<MessageBubble id="m1" />);
    const strong = screen.getByText('bold');
    expect(strong.tagName).toBe('STRONG');
  });

  it('shows error footer with Retry when retryable=true', async () => {
    const onRetry = vi.fn();
    seed({ id: 'e1', role: 'model', text: 'partial', error: 'Network down', retryable: true });
    render(<MessageBubble id="e1" onRetry={onRetry} />);
    expect(screen.getByText(/Network down/)).toBeInTheDocument();
    const btn = screen.getByRole('button', { name: /retry/i });
    await userEvent.click(btn);
    expect(onRetry).toHaveBeenCalledWith('e1');
  });

  it('shows error footer without Retry when retryable=false', () => {
    seed({ id: 'e2', role: 'model', text: 'x', error: 'Bad API key', retryable: false });
    render(<MessageBubble id="e2" onRetry={() => {}} />);
    expect(screen.getByText(/Bad API key/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /retry/i })).not.toBeInTheDocument();
  });

  it('shows interrupted label when interrupted (no error)', () => {
    seed({ id: 'i1', role: 'model', text: 'half', interrupted: true });
    render(<MessageBubble id="i1" />);
    expect(screen.getByText(/Interrotto/i)).toBeInTheDocument();
  });

  it('shows StreamingIndicator only while streaming this message', () => {
    seed({ id: 'm2', role: 'model', text: '' });
    // simula streamingId == m2
    useChatStore.setState({ streamingId: 'm2' });
    render(<MessageBubble id="m2" />);
    expect(screen.getByLabelText('streaming')).toBeInTheDocument();
  });

  it('renders empty model bubble with placeholder text', () => {
    seed({ id: 'z', role: 'model', text: '' });
    render(<MessageBubble id="z" />);
    expect(screen.getByText(/empty response/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run src/components/chat/MessageBubble.test.tsx
```

Expected: FAIL — cannot resolve.

- [ ] **Step 3: Write the implementation**

`src/components/chat/MessageBubble.tsx`:
```tsx
import ReactMarkdown from 'react-markdown';
import { useChatStore } from '@/src/stores/chat.store';
import { StreamingIndicator } from './StreamingIndicator';
import { cn } from '@/src/lib/cn';

export interface MessageBubbleProps {
  id: string;
  onRetry?: (id: string) => void;
}

export function MessageBubble({ id, onRetry }: MessageBubbleProps) {
  const message = useChatStore((s) => s.messages.find((m) => m.id === id));
  const isStreaming = useChatStore((s) => s.streamingId === id);

  if (!message) return null;

  const isUser = message.role === 'user';

  return (
    <div className={cn('flex', isUser ? 'justify-end' : 'justify-start')}>
      <div
        className={cn(
          'max-w-[80%] rounded-lg px-3 py-2 text-sm',
          isUser
            ? 'bg-surface-4 text-zinc-100'
            : 'bg-surface-2 border border-border-subtle text-zinc-200',
        )}
      >
        {isUser ? (
          <span className="whitespace-pre-wrap">{message.text}</span>
        ) : message.text.length === 0 && !isStreaming ? (
          <span className="italic text-zinc-500">(empty response)</span>
        ) : (
          <div className="prose prose-invert prose-sm max-w-none">
            <ReactMarkdown>{message.text}</ReactMarkdown>
            {isStreaming && <StreamingIndicator />}
          </div>
        )}

        {message.error && (
          <div className="mt-2 pt-2 border-t border-status-error/40 text-status-error text-xs flex items-center gap-2">
            <span>⚠ Stream interrotto: {message.error}</span>
            {message.retryable && onRetry && (
              <button
                type="button"
                onClick={() => onRetry(id)}
                className="ml-auto px-2 py-0.5 text-[10px] uppercase tracking-widest font-bold rounded bg-status-error/20 hover:bg-status-error/30"
              >
                Retry
              </button>
            )}
          </div>
        )}

        {!message.error && message.interrupted && (
          <div className="mt-2 pt-2 border-t border-border-subtle text-zinc-500 text-xs">
            ⏸ Interrotto dall'utente
          </div>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run src/components/chat/MessageBubble.test.tsx
```

Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add src/components/chat/MessageBubble.tsx src/components/chat/MessageBubble.test.tsx
git commit -m "feat(slice-2a): add MessageBubble (markdown, error+retry, interrupted)"
```

---

### Task L3: MessageInput

**Files:**
- Create: `src/components/chat/MessageInput.tsx`
- Create: `src/components/chat/MessageInput.test.tsx`

- [ ] **Step 1: Write the failing test**

`src/components/chat/MessageInput.test.tsx`:
```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MessageInput } from './MessageInput';

describe('MessageInput', () => {
  it('sends on Enter with trim', async () => {
    const onSend = vi.fn();
    render(<MessageInput onSend={onSend} onStop={() => {}} isStreaming={false} />);
    const ta = screen.getByRole('textbox');
    await userEvent.type(ta, '  hello  {Enter}');
    expect(onSend).toHaveBeenCalledWith('hello');
  });

  it('does not send on empty/whitespace Enter', async () => {
    const onSend = vi.fn();
    render(<MessageInput onSend={onSend} onStop={() => {}} isStreaming={false} />);
    const ta = screen.getByRole('textbox');
    await userEvent.type(ta, '   {Enter}');
    expect(onSend).not.toHaveBeenCalled();
  });

  it('Shift+Enter inserts newline', async () => {
    const onSend = vi.fn();
    render(<MessageInput onSend={onSend} onStop={() => {}} isStreaming={false} />);
    const ta = screen.getByRole<HTMLTextAreaElement>('textbox');
    await userEvent.type(ta, 'a{Shift>}{Enter}{/Shift}b');
    expect(onSend).not.toHaveBeenCalled();
    expect(ta.value).toBe('a\nb');
  });

  it('shows Send button when idle, Stop when streaming', () => {
    const { rerender } = render(
      <MessageInput onSend={() => {}} onStop={() => {}} isStreaming={false} />,
    );
    expect(screen.getByRole('button', { name: /send/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /stop/i })).not.toBeInTheDocument();
    rerender(<MessageInput onSend={() => {}} onStop={() => {}} isStreaming />);
    expect(screen.queryByRole('button', { name: /send/i })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /stop/i })).toBeInTheDocument();
  });

  it('clicking Stop calls onStop', async () => {
    const onStop = vi.fn();
    render(<MessageInput onSend={() => {}} onStop={onStop} isStreaming />);
    await userEvent.click(screen.getByRole('button', { name: /stop/i }));
    expect(onStop).toHaveBeenCalled();
  });

  it('textarea is disabled during streaming', () => {
    render(<MessageInput onSend={() => {}} onStop={() => {}} isStreaming />);
    expect(screen.getByRole('textbox')).toBeDisabled();
  });

  it('clears textarea after successful send', async () => {
    const onSend = vi.fn();
    render(<MessageInput onSend={onSend} onStop={() => {}} isStreaming={false} />);
    const ta = screen.getByRole<HTMLTextAreaElement>('textbox');
    await userEvent.type(ta, 'hi{Enter}');
    expect(ta.value).toBe('');
  });

  it('Send button click also sends', async () => {
    const onSend = vi.fn();
    render(<MessageInput onSend={onSend} onStop={() => {}} isStreaming={false} />);
    await userEvent.type(screen.getByRole('textbox'), 'click-send');
    await userEvent.click(screen.getByRole('button', { name: /send/i }));
    expect(onSend).toHaveBeenCalledWith('click-send');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run src/components/chat/MessageInput.test.tsx
```

Expected: FAIL — cannot resolve.

- [ ] **Step 3: Write the implementation**

`src/components/chat/MessageInput.tsx`:
```tsx
import { useState, type KeyboardEvent } from 'react';
import { Send, Square } from 'lucide-react';

export interface MessageInputProps {
  onSend: (text: string) => void;
  onStop: () => void;
  isStreaming: boolean;
}

export function MessageInput({ onSend, onStop, isStreaming }: MessageInputProps) {
  const [value, setValue] = useState('');

  const submit = () => {
    const trimmed = value.trim();
    if (!trimmed) return;
    onSend(trimmed);
    setValue('');
  };

  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  };

  return (
    <div className="border-t border-border-subtle bg-surface-2 p-3">
      <div className="flex items-end gap-2">
        <textarea
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={onKey}
          disabled={isStreaming}
          placeholder={isStreaming ? 'Streaming…' : 'Scrivi un messaggio. Enter per inviare, Shift+Enter per a capo.'}
          rows={2}
          className="flex-1 bg-surface-1 border border-border-subtle rounded text-sm p-2 resize-none focus:outline-none focus:ring-1 focus:ring-accent disabled:opacity-50"
        />
        {isStreaming ? (
          <button
            type="button"
            aria-label="Stop"
            onClick={onStop}
            className="p-2 rounded bg-status-error/20 hover:bg-status-error/30 text-status-error"
          >
            <Square size={16} />
          </button>
        ) : (
          <button
            type="button"
            aria-label="Send"
            onClick={submit}
            className="p-2 rounded bg-accent/20 hover:bg-accent/30 text-accent disabled:opacity-30"
            disabled={!value.trim()}
          >
            <Send size={16} />
          </button>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run src/components/chat/MessageInput.test.tsx
```

Expected: PASS (8 tests).

- [ ] **Step 5: Commit**

```bash
git add src/components/chat/MessageInput.tsx src/components/chat/MessageInput.test.tsx
git commit -m "feat(slice-2a): add MessageInput (Enter/Shift+Enter, Send/Stop toggle)"
```

---

### Task L4: MessageList

**Files:**
- Create: `src/components/chat/MessageList.tsx`
- Create: `src/components/chat/MessageList.test.tsx`

- [ ] **Step 1: Write the failing test**

`src/components/chat/MessageList.test.tsx`:
```tsx
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MessageList } from './MessageList';
import { useChatStore } from '@/src/stores/chat.store';

beforeEach(() => {
  useChatStore.getState()._reset();
});

describe('MessageList', () => {
  it('shows EmptyState when no messages', () => {
    render(<MessageList onRetry={() => {}} />);
    expect(screen.getByText(/Aether ready/i)).toBeInTheDocument();
  });

  it('renders one bubble per message', () => {
    useChatStore.getState().hydrate([
      { id: '1', role: 'user', text: 'hello', timestamp: 1 },
      { id: '2', role: 'model', text: 'world', timestamp: 2 },
    ]);
    render(<MessageList onRetry={() => {}} />);
    expect(screen.getByText('hello')).toBeInTheDocument();
    expect(screen.getByText('world')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run src/components/chat/MessageList.test.tsx
```

Expected: FAIL — cannot resolve.

- [ ] **Step 3: Write the implementation**

`src/components/chat/MessageList.tsx`:
```tsx
import { useRef } from 'react';
import { useChatStore } from '@/src/stores/chat.store';
import { useAutoScroll } from '@/src/hooks/useAutoScroll';
import { MessageBubble } from './MessageBubble';
import { EmptyState } from './EmptyState';

export interface MessageListProps {
  onRetry: (id: string) => void;
}

export function MessageList({ onRetry }: MessageListProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  // dep: total text length, così ogni chunk in streaming triggera lo scroll-effect
  const totalLen = useChatStore((s) =>
    s.messages.reduce((acc, m) => acc + m.text.length, 0),
  );
  const count = useChatStore((s) => s.messages.length);
  const ids = useChatStore((s) => s.messages.map((m) => m.id));

  useAutoScroll(containerRef, [count, totalLen]);

  if (count === 0) {
    return <EmptyState />;
  }

  return (
    <div
      ref={containerRef}
      className="flex-1 overflow-y-auto p-4 flex flex-col gap-3"
    >
      {ids.map((id) => (
        <MessageBubble key={id} id={id} onRetry={onRetry} />
      ))}
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run src/components/chat/MessageList.test.tsx
```

Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/components/chat/MessageList.tsx src/components/chat/MessageList.test.tsx
git commit -m "feat(slice-2a): add MessageList with auto-scroll"
```

---

### Task L5: ChatView (integration)

**Files:**
- Create: `src/components/chat/ChatView.tsx`
- Create: `src/components/chat/ChatView.test.tsx`

- [ ] **Step 1: Write the failing test**

`src/components/chat/ChatView.test.tsx`:
```tsx
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { server } from '@/src/test/msw-server';
import { ChatView } from './ChatView';
import { useChatStore } from '@/src/stores/chat.store';

beforeEach(() => {
  useChatStore.getState()._reset();
});

function sse(...lines: string[]) {
  const enc = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(c) {
      for (const l of lines) c.enqueue(enc.encode(l));
      c.close();
    },
  });
}

describe('ChatView', () => {
  it('happy path: send a message and receive streamed reply', async () => {
    server.use(
      http.post('http://localhost/api/ai/dispatch', () =>
        new HttpResponse(
          sse(
            'event: text\ndata: {"chunk":"Hello"}\n\n',
            'event: text\ndata: {"chunk":" Aether"}\n\n',
            'event: done\ndata: {"model":"fake-1","interrupted":false}\n\n',
          ),
          { headers: { 'Content-Type': 'text/event-stream' } },
        ),
      ),
    );
    render(<ChatView />);
    await userEvent.type(screen.getByRole('textbox'), 'hi{Enter}');
    await waitFor(() => {
      expect(screen.getByText(/Hello Aether/)).toBeInTheDocument();
    });
    expect(screen.getByText('hi')).toBeInTheDocument();
  });

  it('Retry resends the last user message', async () => {
    server.use(
      http.post('http://localhost/api/ai/dispatch', () =>
        new HttpResponse(
          sse('event: error\ndata: {"message":"Network","retryable":true}\n\n'),
          { headers: { 'Content-Type': 'text/event-stream' } },
        ),
      ),
    );
    render(<ChatView />);
    await userEvent.type(screen.getByRole('textbox'), 'first{Enter}');
    const retryBtn = await screen.findByRole('button', { name: /retry/i });

    // ora la prossima chiamata deve riuscire
    server.use(
      http.post('http://localhost/api/ai/dispatch', () =>
        new HttpResponse(
          sse(
            'event: text\ndata: {"chunk":"OK"}\n\n',
            'event: done\ndata: {"model":"f","interrupted":false}\n\n',
          ),
          { headers: { 'Content-Type': 'text/event-stream' } },
        ),
      ),
    );
    await userEvent.click(retryBtn);
    await waitFor(() => {
      expect(screen.getByText('OK')).toBeInTheDocument();
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run src/components/chat/ChatView.test.tsx
```

Expected: FAIL — cannot resolve.

- [ ] **Step 3: Write the implementation**

`src/components/chat/ChatView.tsx`:
```tsx
import { useCallback } from 'react';
import { useStreamingDispatch } from '@/src/hooks/useStreamingDispatch';
import { useChatStore } from '@/src/stores/chat.store';
import { MessageList } from './MessageList';
import { MessageInput } from './MessageInput';

export function ChatView() {
  const { send, abort, isStreaming } = useStreamingDispatch();

  const handleRetry = useCallback(
    async (failedId: string) => {
      const state = useChatStore.getState();
      const idx = state.messages.findIndex((m) => m.id === failedId);
      if (idx < 1) return;
      const prev = state.messages[idx - 1];
      if (prev.role !== 'user') return;
      // rimuove il bubble fallito
      useChatStore.setState((s) => ({
        messages: s.messages.filter((m) => m.id !== failedId),
      }));
      await send(prev.text);
    },
    [send],
  );

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <MessageList onRetry={handleRetry} />
      <MessageInput onSend={send} onStop={abort} isStreaming={isStreaming} />
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run src/components/chat/ChatView.test.tsx
```

Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/components/chat/ChatView.tsx src/components/chat/ChatView.test.tsx
git commit -m "feat(slice-2a): add ChatView orchestrator with retry support"
```

---

## Phase M — Wire ChatView into App.tsx + hydration

### Task M1: Replace placeholder with ChatView + hydrate history

**Files:**
- Modify: `src/App.tsx`
- Create: `src/App.test.tsx`

- [ ] **Step 1: Modify App.tsx**

`src/App.tsx`:
```tsx
import { useEffect, useState } from 'react';
import { AppShell } from '@/src/components/layout/AppShell';
import { TopBar } from '@/src/components/layout/TopBar';
import { Sidebar } from '@/src/components/layout/Sidebar';
import { DialogHost } from '@/src/components/layout/DialogHost';
import { SystemProtocolSection } from '@/src/components/sidebar/SystemProtocolSection';
import { SkillsSection } from '@/src/components/sidebar/SkillsSection';
import { ToolsSection } from '@/src/components/sidebar/ToolsSection';
import { McpServersSection } from '@/src/components/sidebar/McpServersSection';
import { ConnectionFooter } from '@/src/components/sidebar/ConnectionFooter';
import { ChatView } from '@/src/components/chat/ChatView';
import { useContextStore } from '@/src/stores/context.store';
import { useChatStore } from '@/src/stores/chat.store';
import { historyApi } from '@/src/lib/api/history.api';

export default function App() {
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const initContext = useContextStore((s) => s.init);
  const hydrateChat = useChatStore((s) => s.hydrate);

  useEffect(() => {
    initContext();
    historyApi
      .fetchDefault()
      .then((msgs) => hydrateChat(msgs))
      .catch(() => hydrateChat([]));
  }, [initContext, hydrateChat]);

  return (
    <>
      <DialogHost />
      <AppShell
        sidebarOpen={sidebarOpen}
        sidebar={
          <Sidebar
            header={
              <span className="font-mono text-sm tracking-tight text-white font-bold">
                AETHER_CORE
              </span>
            }
            footer={<ConnectionFooter />}
          >
            <SystemProtocolSection />
            <SkillsSection />
            <ToolsSection />
            <McpServersSection />
          </Sidebar>
        }
      >
        <TopBar
          title="Aether Dev Studio"
          sidebarOpen={sidebarOpen}
          onToggleSidebar={() => setSidebarOpen((v) => !v)}
        />
        <ChatView />
      </AppShell>
    </>
  );
}
```

- [ ] **Step 2: Write App smoke test**

`src/App.test.tsx`:
```tsx
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import App from './App';
import { useChatStore } from '@/src/stores/chat.store';
import { useContextStore } from '@/src/stores/context.store';

beforeEach(() => {
  useChatStore.getState()._reset();
  useContextStore.getState()._reset();
});

describe('App', () => {
  it('renders sidebar + ChatView, hydrates from /api/sessions/default', async () => {
    render(<App />);
    expect(screen.getByText('AETHER_CORE')).toBeInTheDocument();
    // l'EmptyState compare quando l'history idratata è vuota (default handler)
    await waitFor(() => {
      expect(screen.getByText(/Aether ready/i)).toBeInTheDocument();
    });
    expect(screen.getByRole('textbox')).toBeInTheDocument();
  });
});
```

- [ ] **Step 3: Run App tests**

```bash
npx vitest run src/App.test.tsx
```

Expected: PASS (1 test).

- [ ] **Step 4: Run full frontend suite to ensure no regression**

```bash
npx vitest run src
```

Expected: ALL PASS.

- [ ] **Step 5: Commit**

```bash
git add src/App.tsx src/App.test.tsx
git commit -m "feat(slice-2a): wire ChatView into App + hydrate history on boot"
```

---

## Phase N — Smoke E2E

### Task N1: Update Playwright smoke

**Files:**
- Modify: `e2e/smoke.spec.ts`

> `playwright.config.ts` ha già `webServer.env = { AETHER_FAKE_PROVIDER: '1' }` (configurato in slice 0), quindi non serve modificarlo.

- [ ] **Step 1: Add chat smoke test**

Append to `e2e/smoke.spec.ts`:
```ts
test('chat: send message and receive FakeProvider reply', async ({ page }) => {
  await page.goto('/');
  const input = page.getByRole('textbox');
  await input.fill('ping');
  await input.press('Enter');
  await expect(page.getByText('ping')).toBeVisible();
  // FakeProvider emette ['pong'] con 50ms di delay
  await expect(page.getByText('pong')).toBeVisible({ timeout: 5000 });
  // Send button torna visibile a fine streaming
  await expect(page.getByRole('button', { name: /send/i })).toBeVisible({ timeout: 5000 });
});
```

- [ ] **Step 2: Run Playwright smoke**

```bash
npx playwright test
```

Expected: PASS (3 tests including new chat smoke). `playwright.config.ts` inietta `AETHER_FAKE_PROVIDER=1` nel webServer, quindi `pong` deterministico.

- [ ] **Step 3: Commit**

```bash
git add e2e/smoke.spec.ts
git commit -m "test(slice-2a): playwright smoke for chat send/receive with FakeProvider"
```

---

## Phase O — Final verification & PR prep

### Task O1: Full test suite + lint

- [ ] **Step 1: Run lint**

```bash
npm run lint
```

Expected: PASS, no errors.

- [ ] **Step 2: Run all vitest**

```bash
npm run test:run
```

Expected: ALL tests pass (existing slice 0/1 + new slice 2a).

- [ ] **Step 3: Run coverage threshold check**

```bash
npm run test:coverage
```

Expected: PASS, coverage thresholds met on `server/domain/**`, `server/lib/**`, `src/hooks/**`, `src/stores/**`, `src/lib/**`.

- [ ] **Step 4: Run Playwright (if not done)**

```bash
npx playwright test
```

Expected: PASS.

- [ ] **Step 5: Manual smoke (optional but recommended)**

```bash
AETHER_FAKE_PROVIDER=1 npm run dev
```

In browser: open `http://localhost:3000`, type a message, press Enter, observe streaming "pong" with markdown rendering. Click Stop mid-stream on a longer test. Refresh — message history should reload.

- [ ] **Step 6: Push branch**

```bash
git push -u origin feat/slice-2a-chat-streaming
```

- [ ] **Step 7: Open PR**

```bash
gh pr create --title "feat(slice-2a): real streaming chat (single-session)" --body "$(cat <<'EOF'
## Summary
- Backend dispatch route con SSE streaming via Gemini (con FakeProvider deterministico per test e dev senza API key)
- HistoryStore JSON-backed, sessionId='default' costante
- AbortController end-to-end: Stop client → fetch abort → req.on('close') → provider signal → partial salvato con interrupted=true
- Frontend: useChatStore + useStreamingDispatch + useAutoScroll (smart, threshold 50px)
- MessageBubble con markdown live (react-markdown), error footer con flag retryable, Retry button
- Hydration history su boot via GET /api/sessions/default

## Test plan
- [x] Unit tests: history.store, providers, dispatch.service, chat.store, useStreamingDispatch, useAutoScroll, tutti i bubble/input components
- [x] Integration tests: dispatch.routes (supertest), history.routes, ChatView (MSW)
- [x] Smoke E2E: Playwright invio + ricezione con FakeProvider
- [x] Manual: streaming reale con Gemini (con GEMINI_API_KEY)
- [x] Manual: Stop mid-stream, refresh idrata correttamente
EOF
)"
```

Expected: PR created, URL printed.

---

## Riepilogo task → commit

| # | Task | Commit message prefix |
|---|---|---|
| A1 | Branch | (no commit) |
| B1 | config loader | `feat(slice-2a): add typed env config loader` |
| C1 | Message types + schema | `feat(slice-2a): add Message types + zod schema` |
| C2 | HistoryStore | `feat(slice-2a): add HistoryStore` |
| D1 | provider.types | `feat(slice-2a): add AIProvider interface` |
| D2 | FakeProvider | `feat(slice-2a): add FakeProvider` |
| E1 | sse-collector | `test(slice-2a): add sse collector helper` |
| E2 | dispatch.service | `feat(slice-2a): add dispatch.service` |
| F1 | dispatch.routes | `feat(slice-2a): wire POST /api/ai/dispatch` |
| F2 | history.routes | `feat(slice-2a): add GET/DELETE /api/sessions/default` |
| G1 | GeminiProvider | `feat(slice-2a): add GeminiProvider` |
| H1 | server/index.ts | `feat(slice-2a): wire dispatcher into bootstrap` |
| I1 | Message type FE | `feat(slice-2a): re-export Message type` |
| I2 | history.api | `feat(slice-2a): add historyApi client` |
| I3 | dispatch.api | `feat(slice-2a): add createStreamingDispatch` |
| J1 | chat.store | `feat(slice-2a): add useChatStore` |
| K1 | useStreamingDispatch | `feat(slice-2a): add useStreamingDispatch hook` |
| K2 | useAutoScroll | `feat(slice-2a): add useAutoScroll hook` |
| L1 | StreamingIndicator + EmptyState | `feat(slice-2a): add StreamingIndicator + EmptyState` |
| L2 | MessageBubble | `feat(slice-2a): add MessageBubble` |
| L3 | MessageInput | `feat(slice-2a): add MessageInput` |
| L4 | MessageList | `feat(slice-2a): add MessageList with auto-scroll` |
| L5 | ChatView | `feat(slice-2a): add ChatView orchestrator` |
| M1 | App.tsx wire | `feat(slice-2a): wire ChatView into App` |
| N1 | Playwright | `test(slice-2a): playwright smoke for chat` |
| O1 | PR | (no commit) |

Totale: ~24 commit, ognuno verde.

---

## Note operative

- **Vitest globals**: il config (`vitest.config.ts`) ha `globals: true`. Quindi puoi usare `describe`, `it`, `expect` senza importarli, ma per chiarezza il piano li importa esplicitamente.
- **Path alias `@/`**: mappato a root del progetto (`vitest.config.ts` + `tsconfig.json`). Quindi `@/server/...` e `@/src/...` funzionano sia in test che in build.
- **MSW**: in setup test usa `onUnhandledRequest: 'error'` — ogni test che fa fetch a un'URL non mockata fallisce. Aggiungere sempre `server.use(...)` per le varianti.
- **AbortController e Express**: `req.on('close')` viene chiamato quando il client chiude il fetch. È il pattern Express standard.
- **react-markdown**: già installato (vedi `package.json` slice 0). Usa `prose prose-invert` Tailwind classes per styling base, ma se i test cercano `<strong>` direttamente come fa `MessageBubble.test.tsx`, funziona di default.
- **lucide-react**: già installato. Usa `Send` e `Square` come icone.
- **Coverage thresholds**: definite in `vitest.config.ts` slice 0. Tutti i nuovi moduli ricadono in path con threshold; se la coverage scende sotto 80%, `npm run test:coverage` fallisce → aggiungere test mancanti prima del PR.
