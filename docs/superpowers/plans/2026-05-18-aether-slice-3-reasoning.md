# Aether Slice 3 — Real Reasoning Steps + Gemini Thinking Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Sostituire i reasoning steps mock con un `ReasoningTracer` reale che emette step strutturati durante la pipeline di dispatch, e integrare i thoughts del modello Gemini quando il toggle "thinking" è attivo. Aggiungere un `ReasoningDrawer` side-panel con live thinking display.

**Architecture:** Backend `ReasoningTracer` stateful (one per request) emette `event: reasoning_step` via SSE. `GeminiProvider` accetta `thinking?: boolean` in `ProviderRequest` e configura `thinkingConfig` + `includeThoughts`; distingue thought parts (`part.thought === true`) da answer parts e ne emette `{type:'thinking',text}`. `ProviderChunk` esteso con `'thinking'` e `done.usage`. `dispatch.service` orchestra i 4 step (context_fetch, dispatch, thinking se thoughts presenti, validation). Frontend: nuovo `useUiStore` per drawer + thinking toggle persistito; `useChatStore` esteso con `currentReasoning` (thinkingText + steps live); `useStreamingDispatch` riceve `event:thinking`/`reasoning_step`/`done.reasoningSteps`; `ReasoningDrawer` overlay con focus resolution priority `focusedMessageId > streamingId > lastAssistant`. `Message.reasoningSteps?` persistito in `sessions.json` (additivo, backward-compat).

**Tech Stack:** Zustand 5 + react-markdown (già presenti), `@google/genai` v1.29 (Part.thought, ThinkingConfig, usageMetadata già esposti dal SDK), zod 4, MSW 2, Vitest 4.1.6, Playwright. Tutti i pattern (mock vi.fn function-expression, useShallow, res.on('close'), AETHER_DATA_DIR scratch per E2E) ereditati da slice 2a/2b.

**Reference spec:** `docs/superpowers/specs/2026-05-18-aether-slice-3-reasoning-design.md`

**Branch:** `feat/slice-3-reasoning`

**Lavora con un solo branch dall'inizio alla fine; ogni Task termina con un commit verde su questo branch.**

---

## File structure (NEW unless marked MODIFY)

```
server/
  domain/
    reasoning/
      reasoning.types.ts                       # NEW
      reasoning.schema.ts                      # NEW
      reasoning.schema.test.ts                 # NEW
      reasoning.tracer.ts                      # NEW
      reasoning.tracer.test.ts                 # NEW
    dispatch/
      dispatch.service.ts                      # MODIFY (tracer integration)
      dispatch.service.test.ts                 # MODIFY
      providers/
        provider.types.ts                      # MODIFY (ProviderChunk + done.usage + thinking)
        fake.provider.ts                       # MODIFY (thoughtChunks + done.usage)
        fake.provider.test.ts                  # MODIFY
        gemini.provider.ts                     # MODIFY (thinkingConfig + parts discrimination)
        gemini.provider.test.ts                # MODIFY
    history/
      history.types.ts                         # MODIFY (Message.reasoningSteps?)
      history.schema.ts                        # MODIFY
      history.schema.test.ts                   # MODIFY
      history.store.test.ts                    # MODIFY (1 new test)
  routes/
    dispatch.routes.test.ts                    # MODIFY (test thinking forwarding)
  index.ts                                     # MODIFY (FakeProvider thoughtChunks for E2E)

src/
  types/
    reasoning.types.ts                         # NEW
  lib/api/
    dispatch.api.ts                            # MODIFY (body.thinking)
    dispatch.api.test.ts                       # MODIFY
  stores/
    ui.store.ts                                # NEW
    ui.store.test.ts                           # NEW
    chat.store.ts                              # MODIFY (currentReasoning + actions)
    chat.store.test.ts                         # MODIFY
  hooks/
    useStreamingDispatch.ts                    # MODIFY (thinking + reasoning_step + body.thinking)
    useStreamingDispatch.test.ts               # MODIFY
  components/
    chat/
      MessageBubble.tsx                        # MODIFY (badges)
      MessageBubble.test.tsx                   # MODIFY
      MessageInput.tsx                         # MODIFY (brain toggle)
      MessageInput.test.tsx                    # MODIFY
      ChatView.test.tsx                        # MODIFY (1 new test)
    reasoning/
      ConfidenceBar.tsx                        # NEW
      ConfidenceBar.test.tsx                   # NEW
      DispatchBranch.tsx                       # NEW
      DispatchBranch.test.tsx                  # NEW
      LiveThinkingBlock.tsx                    # NEW
      ReasoningStepCard.tsx                    # NEW
      ReasoningStepCard.test.tsx               # NEW
      ReasoningDrawer.tsx                      # NEW
      ReasoningDrawer.test.tsx                 # NEW
  App.tsx                                      # MODIFY (mount ReasoningDrawer)
  App.test.tsx                                 # MODIFY

e2e/
  smoke.spec.ts                                # MODIFY (1 new test)
```

---

## Phase A — Branch

### Task A1: Crea il branch

- [ ] **Step 1: Create and checkout**

```bash
git checkout main
git pull --ff-only
git checkout -b feat/slice-3-reasoning
```

Expected: `Switched to a new branch 'feat/slice-3-reasoning'`.

- [ ] **Step 2: Verify clean state**

```bash
git status
```

Expected: `nothing to commit, working tree clean`.

---

## Phase B — Backend reasoning core

### Task B1: `reasoning.types` + `reasoning.schema`

**Files:**
- Create: `server/domain/reasoning/reasoning.types.ts`
- Create: `server/domain/reasoning/reasoning.schema.ts`
- Create: `server/domain/reasoning/reasoning.schema.test.ts`

- [ ] **Step 1: Write the failing test**

`server/domain/reasoning/reasoning.schema.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { ReasoningStepSchema, ReasoningStepTypeSchema } from './reasoning.schema';

describe('ReasoningStepTypeSchema', () => {
  it('accepts known types', () => {
    for (const t of ['context_fetch', 'mcp_query', 'dispatch', 'thinking', 'validation', 'logic']) {
      expect(ReasoningStepTypeSchema.parse(t)).toBe(t);
    }
  });

  it('rejects unknown type', () => {
    expect(() => ReasoningStepTypeSchema.parse('unknown')).toThrow();
  });
});

describe('ReasoningStepSchema', () => {
  it('parses minimal required fields', () => {
    const step = {
      id: 'a',
      type: 'context_fetch' as const,
      title: 'Read context',
      content: 'loaded',
      timestamp: 1,
    };
    expect(ReasoningStepSchema.parse(step)).toEqual(step);
  });

  it('accepts optional fields', () => {
    const step = {
      id: 'a',
      type: 'dispatch' as const,
      title: 'Dispatch',
      content: '',
      timestamp: 1,
      tokens: 100,
      durationMs: 50,
      subAgent: 'Coder',
    };
    expect(ReasoningStepSchema.parse(step)).toEqual(step);
  });

  it('rejects missing required fields', () => {
    expect(() => ReasoningStepSchema.parse({ id: 'a', type: 'logic' })).toThrow();
  });

  it('rejects invalid type', () => {
    expect(() =>
      ReasoningStepSchema.parse({ id: 'a', type: 'wrong', title: 't', content: 'c', timestamp: 1 }),
    ).toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run server/domain/reasoning/reasoning.schema.test.ts
```

Expected: FAIL (cannot resolve `./reasoning.schema`).

- [ ] **Step 3: Write the types**

`server/domain/reasoning/reasoning.types.ts`:
```ts
export type ReasoningStepType =
  | 'context_fetch'
  | 'mcp_query'
  | 'dispatch'
  | 'thinking'
  | 'validation'
  | 'logic';

export interface ReasoningStep {
  id: string;
  type: ReasoningStepType;
  title: string;
  content: string;
  tokens?: number;
  durationMs?: number;
  subAgent?: string;
  timestamp: number;
}
```

- [ ] **Step 4: Write the schema**

`server/domain/reasoning/reasoning.schema.ts`:
```ts
import { z } from 'zod';

export const ReasoningStepTypeSchema = z.enum([
  'context_fetch',
  'mcp_query',
  'dispatch',
  'thinking',
  'validation',
  'logic',
]);

export const ReasoningStepSchema = z.object({
  id: z.string(),
  type: ReasoningStepTypeSchema,
  title: z.string(),
  content: z.string(),
  tokens: z.number().optional(),
  durationMs: z.number().optional(),
  subAgent: z.string().optional(),
  timestamp: z.number(),
});
```

- [ ] **Step 5: Run test to verify it passes**

```bash
npx vitest run server/domain/reasoning/reasoning.schema.test.ts
```

Expected: PASS (6 tests).

- [ ] **Step 6: Commit**

```bash
git add server/domain/reasoning/reasoning.types.ts server/domain/reasoning/reasoning.schema.ts server/domain/reasoning/reasoning.schema.test.ts
git commit -m "feat(slice-3): add ReasoningStep types + zod schema"
```

---

### Task B2: `ReasoningTracer`

**Files:**
- Create: `server/domain/reasoning/reasoning.tracer.ts`
- Create: `server/domain/reasoning/reasoning.tracer.test.ts`

- [ ] **Step 1: Write the failing test**

`server/domain/reasoning/reasoning.tracer.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { ReasoningTracer } from './reasoning.tracer';
import { createCollectorEmitter } from '@/server/test/sse-collector';

describe('ReasoningTracer.step', () => {
  it('emits a reasoning_step event with measured durationMs', async () => {
    const { emitter, events } = createCollectorEmitter();
    const tracer = new ReasoningTracer(emitter);
    const result = await tracer.step({
      type: 'context_fetch',
      title: 'Read context',
      run: async () => ({ content: 'done', result: 42 }),
    });
    expect(result).toBe(42);
    expect(events).toHaveLength(1);
    const step = events[0].data as { type: string; title: string; content: string; durationMs: number };
    expect(step.type).toBe('context_fetch');
    expect(step.title).toBe('Read context');
    expect(step.content).toBe('done');
    expect(typeof step.durationMs).toBe('number');
    expect(step.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('captures tokens when run() returns them', async () => {
    const { emitter, events } = createCollectorEmitter();
    const tracer = new ReasoningTracer(emitter);
    await tracer.step({
      type: 'dispatch',
      title: 'Dispatch',
      run: async () => ({ content: 'x', tokens: 1234, result: null }),
    });
    expect((events[0].data as { tokens?: number }).tokens).toBe(1234);
  });

  it('does NOT emit when run() rejects, and propagates the error', async () => {
    const { emitter, events } = createCollectorEmitter();
    const tracer = new ReasoningTracer(emitter);
    await expect(
      tracer.step({
        type: 'dispatch',
        title: 'Dispatch',
        run: async () => { throw new Error('boom'); },
      }),
    ).rejects.toThrow('boom');
    expect(events).toHaveLength(0);
    expect(tracer.finalSteps()).toHaveLength(0);
  });

  it('accumulates multiple steps in order', async () => {
    const { emitter } = createCollectorEmitter();
    const tracer = new ReasoningTracer(emitter);
    await tracer.step({ type: 'context_fetch', title: 'a', run: async () => ({ content: 'a', result: null }) });
    await tracer.step({ type: 'dispatch', title: 'b', run: async () => ({ content: 'b', result: null }) });
    const steps = tracer.finalSteps();
    expect(steps.map((s) => s.type)).toEqual(['context_fetch', 'dispatch']);
  });
});

describe('ReasoningTracer.pushExternal', () => {
  it('emits the step + accumulates', () => {
    const { emitter, events } = createCollectorEmitter();
    const tracer = new ReasoningTracer(emitter);
    tracer.pushExternal({
      type: 'thinking',
      title: 'Thoughts',
      content: 'pondering',
      durationMs: 100,
    });
    expect(events).toHaveLength(1);
    const step = events[0].data as { type: string; content: string };
    expect(step.type).toBe('thinking');
    expect(step.content).toBe('pondering');
    expect(tracer.finalSteps()).toHaveLength(1);
  });

  it('assigns id and timestamp', () => {
    const { emitter } = createCollectorEmitter();
    const tracer = new ReasoningTracer(emitter);
    tracer.pushExternal({ type: 'logic', title: 't', content: 'c' });
    const step = tracer.finalSteps()[0];
    expect(step.id).toBeTruthy();
    expect(typeof step.timestamp).toBe('number');
  });
});

describe('ReasoningTracer.finalSteps', () => {
  it('returns a shallow copy (mutation does not affect tracer state)', async () => {
    const { emitter } = createCollectorEmitter();
    const tracer = new ReasoningTracer(emitter);
    await tracer.step({ type: 'context_fetch', title: 'a', run: async () => ({ content: 'a', result: null }) });
    const a = tracer.finalSteps();
    a.push({} as never);
    expect(tracer.finalSteps()).toHaveLength(1);
  });

  it('is idempotent (multiple calls return same content)', async () => {
    const { emitter } = createCollectorEmitter();
    const tracer = new ReasoningTracer(emitter);
    await tracer.step({ type: 'context_fetch', title: 'a', run: async () => ({ content: 'a', result: null }) });
    expect(tracer.finalSteps()).toEqual(tracer.finalSteps());
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run server/domain/reasoning/reasoning.tracer.test.ts
```

Expected: FAIL (cannot resolve `./reasoning.tracer`).

- [ ] **Step 3: Write the implementation**

`server/domain/reasoning/reasoning.tracer.ts`:
```ts
import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import type { SseEmitter } from '@/server/lib/sse';
import type { ReasoningStep, ReasoningStepType } from './reasoning.types';

export interface TracerStepOpts<T> {
  type: ReasoningStepType;
  title: string;
  run: () => Promise<{ content: string; tokens?: number; result: T }>;
}

export class ReasoningTracer {
  private readonly steps: ReasoningStep[] = [];

  constructor(private readonly sse: SseEmitter) {}

  async step<T>(opts: TracerStepOpts<T>): Promise<T> {
    const t0 = performance.now();
    const { content, tokens, result } = await opts.run();
    const t1 = performance.now();
    const step: ReasoningStep = {
      id: randomUUID(),
      type: opts.type,
      title: opts.title,
      content,
      tokens,
      durationMs: Math.round(t1 - t0),
      timestamp: Date.now(),
    };
    this.steps.push(step);
    this.sse.event('reasoning_step', step);
    return result;
  }

  pushExternal(partial: Omit<ReasoningStep, 'id' | 'timestamp'>): void {
    const step: ReasoningStep = {
      id: randomUUID(),
      timestamp: Date.now(),
      ...partial,
    };
    this.steps.push(step);
    this.sse.event('reasoning_step', step);
  }

  finalSteps(): ReasoningStep[] {
    return [...this.steps];
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run server/domain/reasoning/reasoning.tracer.test.ts
```

Expected: PASS (8 tests).

- [ ] **Step 5: Commit**

```bash
git add server/domain/reasoning/reasoning.tracer.ts server/domain/reasoning/reasoning.tracer.test.ts
git commit -m "feat(slice-3): add ReasoningTracer with step()+pushExternal()+finalSteps()"
```

---

## Phase C — Provider extensions

### Task C1: `provider.types` V3

**Files:**
- Modify: `server/domain/dispatch/providers/provider.types.ts`

- [ ] **Step 1: Replace the file**

`server/domain/dispatch/providers/provider.types.ts`:
```ts
export interface ProviderRequest {
  systemInstruction: string;
  history: { role: 'user' | 'model'; text: string }[];
  userMessage: string;
  thinking?: boolean;
}

export interface ProviderUsage {
  totalTokens?: number;
}

export type ProviderChunk =
  | { type: 'text'; text: string }
  | { type: 'thinking'; text: string }
  | { type: 'done'; usage?: ProviderUsage };

export interface AIProvider {
  readonly model: string;
  stream(req: ProviderRequest, signal: AbortSignal): AsyncIterable<ProviderChunk>;
}
```

- [ ] **Step 2: Verify lint state (expected errors in fake/gemini providers)**

```bash
npm run lint 2>&1 | head -30
```

Expected errors only in: `server/domain/dispatch/providers/fake.provider.ts` (the `{type:'done'}` literal no longer matches if it omits usage — but `usage?` is optional so should still pass). Actually the new ProviderChunk shape is backward-compat since `usage?` is optional. So lint should be CLEAN here.

If lint shows errors elsewhere, STOP and report BLOCKED.

- [ ] **Step 3: Commit**

```bash
git add server/domain/dispatch/providers/provider.types.ts
git commit -m "feat(slice-3): extend ProviderChunk with thinking + done.usage; ProviderRequest +thinking"
```

---

### Task C2: `FakeProvider` thoughtChunks + done.usage

**Files:**
- Modify: `server/domain/dispatch/providers/fake.provider.ts`
- Modify: `server/domain/dispatch/providers/fake.provider.test.ts`

- [ ] **Step 1: Replace the test**

`server/domain/dispatch/providers/fake.provider.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { FakeProvider } from './fake.provider';
import type { ProviderChunk } from './provider.types';

async function collect<T>(it: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const v of it) out.push(v);
  return out;
}

describe('FakeProvider', () => {
  it('yields configured text chunks then done', async () => {
    const p = new FakeProvider({ chunks: ['Hello', ' world'] });
    const out = await collect(
      p.stream(
        { systemInstruction: '', history: [], userMessage: '' },
        new AbortController().signal,
      ),
    );
    expect(out).toEqual<ProviderChunk[]>([
      { type: 'text', text: 'Hello' },
      { type: 'text', text: ' world' },
      { type: 'done' },
    ]);
  });

  it('aborts mid-stream when signal is aborted', async () => {
    const p = new FakeProvider({ chunks: ['a', 'b', 'c'], chunkDelayMs: 10 });
    const ctrl = new AbortController();
    const iter = p.stream(
      { systemInstruction: '', history: [], userMessage: '' },
      ctrl.signal,
    );
    setTimeout(() => ctrl.abort(), 5);
    const out: ProviderChunk[] = [];
    for await (const c of iter) out.push(c);
    expect(out.filter((c) => c.type === 'text').length).toBeLessThan(3);
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

  it('yields thoughtChunks BEFORE text chunks when req.thinking=true', async () => {
    const p = new FakeProvider({ chunks: ['hello'], thoughtChunks: ['pondering', ' more'] });
    const out = await collect(
      p.stream(
        { systemInstruction: '', history: [], userMessage: 'x', thinking: true },
        new AbortController().signal,
      ),
    );
    expect(out).toEqual<ProviderChunk[]>([
      { type: 'thinking', text: 'pondering' },
      { type: 'thinking', text: ' more' },
      { type: 'text', text: 'hello' },
      { type: 'done' },
    ]);
  });

  it('omits thoughtChunks when req.thinking is not true', async () => {
    const p = new FakeProvider({ chunks: ['hello'], thoughtChunks: ['pondering'] });
    const out = await collect(
      p.stream(
        { systemInstruction: '', history: [], userMessage: 'x' },
        new AbortController().signal,
      ),
    );
    expect(out.filter((c) => c.type === 'thinking')).toHaveLength(0);
  });

  it('includes usage in done when totalTokens configured', async () => {
    const p = new FakeProvider({ chunks: ['x'], totalTokens: 42 });
    const out = await collect(
      p.stream(
        { systemInstruction: '', history: [], userMessage: 'x' },
        new AbortController().signal,
      ),
    );
    const done = out.at(-1);
    expect(done).toEqual({ type: 'done', usage: { totalTokens: 42 } });
  });
});
```

- [ ] **Step 2: Run test to verify it fails on new cases**

```bash
npx vitest run server/domain/dispatch/providers/fake.provider.test.ts
```

Expected: FAIL on the 3 new tests (thoughtChunks, omits, usage).

- [ ] **Step 3: Replace the implementation**

`server/domain/dispatch/providers/fake.provider.ts`:
```ts
import type { AIProvider, ProviderChunk, ProviderRequest } from './provider.types';

export interface FakeProviderOptions {
  chunks: string[];
  thoughtChunks?: string[];
  chunkDelayMs?: number;
  model?: string;
  totalTokens?: number;
}

export class FakeProvider implements AIProvider {
  readonly model: string;

  constructor(private readonly opts: FakeProviderOptions) {
    this.model = opts.model ?? 'fake-1';
  }

  async *stream(
    req: ProviderRequest,
    signal: AbortSignal,
  ): AsyncGenerator<ProviderChunk> {
    // Thought chunks emitted FIRST, only when req.thinking === true.
    if (req.thinking === true && this.opts.thoughtChunks) {
      for (const text of this.opts.thoughtChunks) {
        if (signal.aborted) return;
        if (this.opts.chunkDelayMs && this.opts.chunkDelayMs > 0) {
          await sleep(this.opts.chunkDelayMs, signal);
          if (signal.aborted) return;
        }
        yield { type: 'thinking', text };
      }
    }
    for (const text of this.opts.chunks) {
      if (signal.aborted) return;
      if (this.opts.chunkDelayMs && this.opts.chunkDelayMs > 0) {
        await sleep(this.opts.chunkDelayMs, signal);
        if (signal.aborted) return;
      }
      yield { type: 'text', text };
    }
    if (!signal.aborted) {
      yield {
        type: 'done',
        usage:
          this.opts.totalTokens !== undefined
            ? { totalTokens: this.opts.totalTokens }
            : undefined,
      };
    }
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

Expected: PASS (8 tests).

- [ ] **Step 5: Commit**

```bash
git add server/domain/dispatch/providers/fake.provider.ts server/domain/dispatch/providers/fake.provider.test.ts
git commit -m "feat(slice-3): FakeProvider supports thoughtChunks + done.usage"
```

---

### Task C3: `GeminiProvider` thinkingConfig + parts discrimination

**Files:**
- Modify: `server/domain/dispatch/providers/gemini.provider.ts`
- Modify: `server/domain/dispatch/providers/gemini.provider.test.ts`

- [ ] **Step 1: Replace the test**

`server/domain/dispatch/providers/gemini.provider.test.ts`:
```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ProviderChunk } from './provider.types';

const generateContentStream = vi.fn();
vi.mock('@google/genai', () => ({
  GoogleGenAI: vi.fn(function (this: { models: unknown }) {
    this.models = { generateContentStream };
  }),
}));

async function collect<T>(it: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const v of it) out.push(v);
  return out;
}

beforeEach(() => {
  generateContentStream.mockReset();
});

describe('GeminiProvider (without thinking)', () => {
  it('streams text + done from chunks with `text` shape', async () => {
    async function* fake() {
      yield { text: 'Hello' };
      yield { text: ' world' };
    }
    generateContentStream.mockResolvedValue(fake());
    const { GeminiProvider } = await import('./gemini.provider');
    const p = new GeminiProvider({ apiKey: 'k', model: 'gemini-test' });
    const events = await collect(
      p.stream(
        { systemInstruction: '', history: [], userMessage: 'x' },
        new AbortController().signal,
      ),
    );
    expect(events).toEqual<ProviderChunk[]>([
      { type: 'text', text: 'Hello' },
      { type: 'text', text: ' world' },
      { type: 'done', usage: undefined },
    ]);
  });

  it('does NOT include thinkingConfig when thinking is false/absent', async () => {
    async function* fake() { yield { text: 'x' }; }
    generateContentStream.mockResolvedValue(fake());
    const { GeminiProvider } = await import('./gemini.provider');
    const p = new GeminiProvider({ apiKey: 'k', model: 'm' });
    await collect(
      p.stream(
        { systemInstruction: '', history: [], userMessage: 'x' },
        new AbortController().signal,
      ),
    );
    const cfg = generateContentStream.mock.calls[0][0].config;
    expect(cfg.thinkingConfig).toBeUndefined();
  });
});

describe('GeminiProvider (with thinking)', () => {
  it('sets config.thinkingConfig with includeThoughts + thinkingBudget=-1', async () => {
    async function* fake() { yield { text: 'x' }; }
    generateContentStream.mockResolvedValue(fake());
    const { GeminiProvider } = await import('./gemini.provider');
    const p = new GeminiProvider({ apiKey: 'k', model: 'm' });
    await collect(
      p.stream(
        { systemInstruction: '', history: [], userMessage: 'x', thinking: true },
        new AbortController().signal,
      ),
    );
    const cfg = generateContentStream.mock.calls[0][0].config;
    expect(cfg.thinkingConfig).toEqual({ includeThoughts: true, thinkingBudget: -1 });
  });

  it('discriminates thought parts from answer parts', async () => {
    async function* fake() {
      yield {
        candidates: [{
          content: {
            parts: [
              { text: 'pondering', thought: true },
              { text: 'Hello' },
            ],
          },
        }],
      };
      yield {
        candidates: [{
          content: { parts: [{ text: ' world' }] },
        }],
      };
    }
    generateContentStream.mockResolvedValue(fake());
    const { GeminiProvider } = await import('./gemini.provider');
    const p = new GeminiProvider({ apiKey: 'k', model: 'm' });
    const events = await collect(
      p.stream(
        { systemInstruction: '', history: [], userMessage: 'x', thinking: true },
        new AbortController().signal,
      ),
    );
    expect(events.slice(0, 3)).toEqual([
      { type: 'thinking', text: 'pondering' },
      { type: 'text', text: 'Hello' },
      { type: 'text', text: ' world' },
    ]);
  });

  it('captures usageMetadata.totalTokenCount into done.usage', async () => {
    async function* fake() {
      yield { text: 'x', usageMetadata: { totalTokenCount: 123 } };
    }
    generateContentStream.mockResolvedValue(fake());
    const { GeminiProvider } = await import('./gemini.provider');
    const p = new GeminiProvider({ apiKey: 'k', model: 'm' });
    const events = await collect(
      p.stream(
        { systemInstruction: '', history: [], userMessage: 'x' },
        new AbortController().signal,
      ),
    );
    const done = events.at(-1);
    expect(done).toEqual({ type: 'done', usage: { totalTokens: 123 } });
  });

  it('skips empty parts', async () => {
    async function* fake() {
      yield { candidates: [{ content: { parts: [{ text: 'A' }, { text: '' }, { text: 'B' }] } }] };
    }
    generateContentStream.mockResolvedValue(fake());
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

  it('throws with status preserved on SDK rejection', async () => {
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

Expected: FAIL (most tests).

- [ ] **Step 3: Replace the implementation**

`server/domain/dispatch/providers/gemini.provider.ts`:
```ts
import { GoogleGenAI } from '@google/genai';
import type { AIProvider, ProviderChunk, ProviderRequest, ProviderUsage } from './provider.types';

export interface GeminiProviderOptions {
  apiKey: string;
  model?: string;
}

interface GeminiPart {
  text?: string;
  thought?: boolean;
}

interface GeminiCandidate {
  content?: { parts?: GeminiPart[] };
}

interface GeminiChunk {
  text?: string;
  candidates?: GeminiCandidate[];
  usageMetadata?: { totalTokenCount?: number };
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

    const config: Record<string, unknown> = {
      systemInstruction: req.systemInstruction,
      abortSignal: signal,
    };
    if (req.thinking === true) {
      config.thinkingConfig = { includeThoughts: true, thinkingBudget: -1 };
    }

    const stream = await this.ai.models.generateContentStream({
      model: this.model,
      contents,
      config,
    });

    let lastUsage: ProviderUsage | undefined;
    for await (const raw of stream) {
      if (signal.aborted) return;
      const chunk = raw as GeminiChunk;

      if (chunk.usageMetadata?.totalTokenCount !== undefined) {
        lastUsage = { totalTokens: chunk.usageMetadata.totalTokenCount };
      }

      const parts = chunk.candidates?.[0]?.content?.parts;
      if (parts && parts.length > 0) {
        for (const part of parts) {
          const text = part.text;
          if (typeof text !== 'string' || text.length === 0) continue;
          if (part.thought === true) yield { type: 'thinking', text };
          else yield { type: 'text', text };
        }
      } else if (typeof chunk.text === 'string' && chunk.text.length > 0) {
        yield { type: 'text', text: chunk.text };
      }
    }
    if (!signal.aborted) yield { type: 'done', usage: lastUsage };
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run server/domain/dispatch/providers/gemini.provider.test.ts
```

Expected: PASS (8 tests).

- [ ] **Step 5: Commit**

```bash
git add server/domain/dispatch/providers/gemini.provider.ts server/domain/dispatch/providers/gemini.provider.test.ts
git commit -m "feat(slice-3): GeminiProvider supports thinkingConfig + part.thought + usageMetadata"
```

---

## Phase D — History `Message.reasoningSteps`

### Task D1: extend `Message` schema with `reasoningSteps`

**Files:**
- Modify: `server/domain/history/history.types.ts`
- Modify: `server/domain/history/history.schema.ts`
- Modify: `server/domain/history/history.schema.test.ts`

- [ ] **Step 1: Modify types**

In `server/domain/history/history.types.ts`, add import + field to `Message`:

```ts
import type { ReasoningStep } from '@/server/domain/reasoning/reasoning.types';

export interface Message {
  id: string;
  role: 'user' | 'model';
  text: string;
  timestamp: number;
  model?: string;
  interrupted?: boolean;
  error?: string;
  retryable?: boolean;
  reasoningSteps?: ReasoningStep[];
}

export interface SessionRecord {
  title: string;
  createdAt: number;
  messages: Message[];
}

export interface SessionMeta {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
}

export type SessionsFile = Record<string, SessionRecord>;
```

- [ ] **Step 2: Add test for schema accepting reasoningSteps**

Append to `server/domain/history/history.schema.test.ts` (inside the `MessageSchema` describe block):

```ts
  it('accepts optional reasoningSteps array', () => {
    const msg = {
      id: 'm',
      role: 'model' as const,
      text: 't',
      timestamp: 1,
      reasoningSteps: [
        {
          id: 's1',
          type: 'context_fetch' as const,
          title: 'Read',
          content: 'ok',
          timestamp: 1,
        },
      ],
    };
    expect(MessageSchema.parse(msg).reasoningSteps).toHaveLength(1);
  });

  it('rejects invalid reasoningStep type inside the array', () => {
    expect(() =>
      MessageSchema.parse({
        id: 'm',
        role: 'model',
        text: 't',
        timestamp: 1,
        reasoningSteps: [{ id: 's', type: 'bogus', title: 't', content: 'c', timestamp: 1 }],
      }),
    ).toThrow();
  });
```

- [ ] **Step 3: Run test (expect failure on new tests)**

```bash
npx vitest run server/domain/history/history.schema.test.ts
```

Expected: FAIL on the 2 new tests.

- [ ] **Step 4: Modify the schema**

`server/domain/history/history.schema.ts`:
```ts
import { z } from 'zod';
import { ReasoningStepSchema } from '@/server/domain/reasoning/reasoning.schema';

export const MessageSchema = z.object({
  id: z.string(),
  role: z.enum(['user', 'model']),
  text: z.string(),
  timestamp: z.number(),
  model: z.string().optional(),
  interrupted: z.boolean().optional(),
  error: z.string().optional(),
  retryable: z.boolean().optional(),
  reasoningSteps: z.array(ReasoningStepSchema).optional(),
});

export const SessionRecordSchema = z.object({
  title: z.string(),
  createdAt: z.number(),
  messages: z.array(MessageSchema),
});

export const SessionsFileSchema = z.record(z.string(), SessionRecordSchema);
```

- [ ] **Step 5: Run test to verify it passes**

```bash
npx vitest run server/domain/history/history.schema.test.ts
```

Expected: PASS (11 tests now).

- [ ] **Step 6: Commit**

```bash
git add server/domain/history/history.types.ts server/domain/history/history.schema.ts server/domain/history/history.schema.test.ts
git commit -m "feat(slice-3): Message.reasoningSteps? optional in history schema"
```

---

### Task D2: `history.store` preserves `reasoningSteps`

**Files:**
- Modify: `server/domain/history/history.store.test.ts`

The store already uses `JsonStore` which writes/reads via zod schema. With the schema updated in D1, persistence Just Works. Add one test for safety.

- [ ] **Step 1: Add 1 test to history.store.test.ts**

Inside the existing `describe('HistoryStore', ...)` block append:

```ts
  it('append+read preserves reasoningSteps', async () => {
    const meta = await store.createEmpty();
    await store.append(meta.id, {
      id: 'u', role: 'user', text: 'hi', timestamp: 1,
    });
    await store.append(meta.id, {
      id: 'm',
      role: 'model',
      text: 'pong',
      timestamp: 2,
      model: 'fake-1',
      reasoningSteps: [
        { id: 's1', type: 'context_fetch', title: 't', content: 'c', timestamp: 1, durationMs: 5 },
        { id: 's2', type: 'dispatch', title: 't2', content: 'c2', timestamp: 2, tokens: 42, durationMs: 100 },
      ],
    });
    const msgs = await store.read(meta.id);
    const model = msgs!.find((m) => m.role === 'model')!;
    expect(model.reasoningSteps).toHaveLength(2);
    expect(model.reasoningSteps![0]).toMatchObject({ type: 'context_fetch', durationMs: 5 });
    expect(model.reasoningSteps![1]).toMatchObject({ type: 'dispatch', tokens: 42 });
  });
```

- [ ] **Step 2: Run history.store tests**

```bash
npx vitest run server/domain/history/history.store.test.ts
```

Expected: PASS (16 tests now).

- [ ] **Step 3: Commit**

```bash
git add server/domain/history/history.store.test.ts
git commit -m "test(slice-3): history.store preserves reasoningSteps on append/read"
```

---

## Phase E — dispatch.service integration

### Task E1: integrate `ReasoningTracer` + forward `thinking`

**Files:**
- Modify: `server/domain/dispatch/dispatch.service.ts`
- Modify: `server/domain/dispatch/dispatch.service.test.ts`

- [ ] **Step 1: Replace the test**

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
  async function makeService(opts: {
    chunks: string[];
    thoughtChunks?: string[];
    chunkDelayMs?: number;
    totalTokens?: number;
  }) {
    const provider = new FakeProvider({
      chunks: opts.chunks,
      thoughtChunks: opts.thoughtChunks,
      chunkDelayMs: opts.chunkDelayMs,
      model: 'fake-1',
      totalTokens: opts.totalTokens,
    });
    const historyStore = new HistoryStore(path.join(dir, 'sessions.json'));
    const contextStore = new ContextStore(path.join(dir, 'context.json'));
    const service = new DispatchService({ provider, historyStore, contextStore });
    const session = await historyStore.createEmpty();
    return { service, historyStore, contextStore, sessionId: session.id };
  }

  it('emits context_fetch, dispatch, validation steps (no thinking when thinking=false)', async () => {
    const { service, sessionId } = await makeService({ chunks: ['pong'] });
    const { emitter, events } = createCollectorEmitter();
    await service.handle({ sessionId, message: 'ping' }, emitter, new AbortController().signal);
    const steps = events.filter((e) => e.event === 'reasoning_step').map((e) => (e.data as { type: string }).type);
    expect(steps).toEqual(['context_fetch', 'dispatch', 'validation']);
  });

  it('emits context_fetch, dispatch, thinking, validation when thinking=true and thoughts present', async () => {
    const { service, sessionId } = await makeService({
      chunks: ['pong'],
      thoughtChunks: ['ponder'],
    });
    const { emitter, events } = createCollectorEmitter();
    await service.handle({ sessionId, message: 'ping', thinking: true }, emitter, new AbortController().signal);
    const steps = events.filter((e) => e.event === 'reasoning_step').map((e) => (e.data as { type: string }).type);
    expect(steps).toEqual(['context_fetch', 'dispatch', 'thinking', 'validation']);
  });

  it('does NOT emit thinking step when thinking=true but no thoughts produced', async () => {
    const { service, sessionId } = await makeService({ chunks: ['pong'] }); // no thoughtChunks
    const { emitter, events } = createCollectorEmitter();
    await service.handle({ sessionId, message: 'ping', thinking: true }, emitter, new AbortController().signal);
    const steps = events.filter((e) => e.event === 'reasoning_step').map((e) => (e.data as { type: string }).type);
    expect(steps).toEqual(['context_fetch', 'dispatch', 'validation']);
  });

  it('emits event:thinking chunks during dispatch when thoughts present', async () => {
    const { service, sessionId } = await makeService({
      chunks: ['pong'],
      thoughtChunks: ['ponder', ' more'],
    });
    const { emitter, events } = createCollectorEmitter();
    await service.handle({ sessionId, message: 'ping', thinking: true }, emitter, new AbortController().signal);
    const thinkingChunks = events
      .filter((e) => e.event === 'thinking')
      .map((e) => (e.data as { chunk: string }).chunk);
    expect(thinkingChunks).toEqual(['ponder', ' more']);
  });

  it('done event includes reasoningSteps matching what was persisted', async () => {
    const { service, historyStore, sessionId } = await makeService({ chunks: ['pong'] });
    const { emitter, events } = createCollectorEmitter();
    await service.handle({ sessionId, message: 'ping' }, emitter, new AbortController().signal);
    const done = events.find((e) => e.event === 'done')!;
    const reasoningSteps = (done.data as { reasoningSteps: { type: string }[] }).reasoningSteps;
    expect(reasoningSteps.map((s) => s.type)).toEqual(['context_fetch', 'dispatch', 'validation']);
    const msgs = await historyStore.read(sessionId);
    const model = msgs!.find((m) => m.role === 'model')!;
    expect(model.reasoningSteps).toHaveLength(3);
  });

  it('validation step content reports tokens when usage available', async () => {
    const { service, sessionId } = await makeService({ chunks: ['pong'], totalTokens: 42 });
    const { emitter, events } = createCollectorEmitter();
    await service.handle({ sessionId, message: 'ping' }, emitter, new AbortController().signal);
    const validation = events
      .filter((e) => e.event === 'reasoning_step')
      .find((e) => (e.data as { type: string }).type === 'validation')!;
    expect((validation.data as { tokens?: number }).tokens).toBe(42);
    expect((validation.data as { content: string }).content).toContain('tokens 42');
  });

  it('persists partial reasoningSteps on provider error', async () => {
    class FailingProvider {
      readonly model = 'broken';
      async *stream(): AsyncGenerator<never> {
        throw new Error('Auth failed');
      }
    }
    const historyStore = new HistoryStore(path.join(dir, 'sessions.json'));
    const contextStore = new ContextStore(path.join(dir, 'context.json'));
    const service = new DispatchService({
      provider: new FailingProvider(),
      historyStore,
      contextStore,
    });
    const session = await historyStore.createEmpty();
    const { emitter, events } = createCollectorEmitter();
    await service.handle({ sessionId: session.id, message: 'hi' }, emitter, new AbortController().signal);
    const err = events.find((e) => e.event === 'error');
    expect(err).toBeDefined();
    const msgs = await historyStore.read(session.id);
    const model = msgs!.find((m) => m.role === 'model')!;
    // context_fetch was emitted before the provider threw → it should be persisted
    expect(model.reasoningSteps?.[0]?.type).toBe('context_fetch');
  });

  it('persists reasoningSteps on aborted stream', async () => {
    const { service, historyStore, sessionId } = await makeService({
      chunks: ['a', 'b', 'c'],
      chunkDelayMs: 20,
    });
    const { emitter, events } = createCollectorEmitter();
    const ctrl = new AbortController();
    setTimeout(() => ctrl.abort(), 10);
    await service.handle({ sessionId, message: 'ping' }, emitter, ctrl.signal);
    const done = events.find((e) => e.event === 'done')!;
    expect((done.data as { interrupted: boolean }).interrupted).toBe(true);
    const msgs = await historyStore.read(sessionId);
    const model = msgs!.find((m) => m.role === 'model')!;
    expect(model.reasoningSteps?.length).toBeGreaterThanOrEqual(2); // context_fetch + dispatch
    expect(model.interrupted).toBe(true);
  });
});
```

- [ ] **Step 2: Run test (expect failures because service still old)**

```bash
npx vitest run server/domain/dispatch/dispatch.service.test.ts
```

Expected: FAIL on new tests.

- [ ] **Step 3: Replace the implementation**

`server/domain/dispatch/dispatch.service.ts`:
```ts
import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { z } from 'zod';
import type { SseEmitter } from '@/server/lib/sse';
import type { ContextStore } from '@/server/domain/context/context.store';
import type { HistoryStore } from '@/server/domain/history/history.store';
import type { AIProvider, ProviderUsage } from './providers/provider.types';
import { ReasoningTracer } from '@/server/domain/reasoning/reasoning.tracer';

export const DispatchRequestSchema = z.object({
  sessionId: z.string().min(1),
  message: z.string().min(1),
  thinking: z.boolean().optional(),
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
      sse.error('Invalid request body', false);
      return;
    }
    const { sessionId, message, thinking } = parsed.data;
    const { provider, historyStore, contextStore } = this.deps;

    const prior = await historyStore.read(sessionId);
    if (prior === null) {
      sse.event('error', { message: 'Session not found', retryable: false });
      sse.end();
      return;
    }

    const tracer = new ReasoningTracer(sse);

    let context;
    try {
      context = await tracer.step({
        type: 'context_fetch',
        title: 'Read context',
        run: async () => {
          const ctx = await contextStore.read();
          return {
            content: `loaded systemInstruction (${ctx.systemInstruction.length} chars)`,
            result: ctx,
          };
        },
      });
    } catch {
      sse.event('error', { message: 'Context load failed', retryable: true });
      sse.end();
      return;
    }

    await historyStore.append(sessionId, {
      id: randomUUID(),
      role: 'user',
      text: message,
      timestamp: Date.now(),
    });

    let accumText = '';
    let accumThought = '';
    let dispatchUsage: ProviderUsage | undefined;
    const dispatchStart = performance.now();

    try {
      await tracer.step({
        type: 'dispatch',
        title: `Dispatch to ${provider.model}${thinking ? ' (thinking)' : ''}`,
        run: async () => {
          const it = provider.stream(
            {
              systemInstruction: context.systemInstruction,
              history: prior.map((m) => ({ role: m.role, text: m.text })),
              userMessage: message,
              thinking,
            },
            signal,
          );
          for await (const chunk of it) {
            if (signal.aborted) break;
            if (chunk.type === 'text') {
              accumText += chunk.text;
              sse.event('text', { chunk: chunk.text });
            } else if (chunk.type === 'thinking') {
              accumThought += chunk.text;
              sse.event('thinking', { chunk: chunk.text });
            } else if (chunk.type === 'done') {
              dispatchUsage = chunk.usage;
              break;
            }
          }
          return {
            content: `${accumText.length} chars streamed${
              accumThought.length > 0 ? `, ${accumThought.length} chars thinking` : ''
            }`,
            tokens: dispatchUsage?.totalTokens,
            result: null,
          };
        },
      });
    } catch (e) {
      const { message: msg, retryable } = classifyError(e);
      sse.event('error', { message: msg, retryable });
      await historyStore.append(sessionId, {
        id: randomUUID(),
        role: 'model',
        text: accumText,
        timestamp: Date.now(),
        model: provider.model,
        error: msg,
        retryable,
        reasoningSteps: tracer.finalSteps(),
      });
      sse.end();
      return;
    }

    if (accumThought.length > 0) {
      tracer.pushExternal({
        type: 'thinking',
        title: 'Gemini thoughts',
        content: accumThought,
        durationMs: Math.round(performance.now() - dispatchStart),
      });
    }

    await tracer.step({
      type: 'validation',
      title: 'Validate response',
      run: async () => {
        const ok = accumText.length > 0;
        const tokens = dispatchUsage?.totalTokens;
        return {
          content: `response length ${accumText.length}${
            tokens !== undefined ? `, tokens ${tokens}` : ''
          }${ok ? '' : ' (empty)'}`,
          tokens,
          result: null,
        };
      },
    });

    const interrupted = signal.aborted;
    const reasoningSteps = tracer.finalSteps();

    await historyStore.append(sessionId, {
      id: randomUUID(),
      role: 'model',
      text: accumText,
      timestamp: Date.now(),
      model: provider.model,
      interrupted,
      reasoningSteps,
    });

    sse.event('done', { model: provider.model, interrupted, reasoningSteps });
    sse.end();
  }
}

function classifyError(e: unknown): { message: string; retryable: boolean } {
  const message = e instanceof Error ? e.message : 'Unknown error';
  const code = (e as { code?: string; status?: number }).code;
  const status = (e as { status?: number }).status;
  if (code === 'ECONNRESET' || code === 'ETIMEDOUT' || code === 'EAI_AGAIN') {
    return { message, retryable: true };
  }
  if (status === 429 || status === 503 || status === 504) {
    return { message, retryable: true };
  }
  if (status === 401 || status === 403 || /api[_ ]?key|auth|unauthor/i.test(message)) {
    return { message, retryable: false };
  }
  return { message, retryable: true };
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run server/domain/dispatch/dispatch.service.test.ts
```

Expected: PASS (8 tests).

- [ ] **Step 5: Run full backend suite for regression**

```bash
npx vitest run server
```

Expected: ALL PASS.

- [ ] **Step 6: Commit**

```bash
git add server/domain/dispatch/dispatch.service.ts server/domain/dispatch/dispatch.service.test.ts
git commit -m "feat(slice-3): dispatch.service integrates ReasoningTracer + forwards thinking"
```

---

### Task E2: `dispatch.routes` test verifies thinking forwarding

**Files:**
- Modify: `server/routes/dispatch.routes.test.ts`

- [ ] **Step 1: Append a test**

Inside the existing `describe('/api/ai/dispatch', ...)` block:

```ts
  it('forwards thinking=true through to the service (emits thinking chunks)', async () => {
    const provider = new FakeProvider({ chunks: ['pong'], thoughtChunks: ['ponder'] });
    const dispatcher = new DispatchService({ provider, historyStore, contextStore });
    const app = createApp({ contextStore, historyStore, dispatcher });
    const session = await historyStore.createEmpty();

    const res = await request(app)
      .post('/api/ai/dispatch')
      .send({ sessionId: session.id, message: 'ping', thinking: true });
    const events = await collectSseEvents(res);
    const thinkingChunks = events.filter((e) => e.event === 'thinking');
    expect(thinkingChunks.length).toBeGreaterThan(0);
  });

  it('rejects non-boolean thinking', async () => {
    const { app } = await appWith(['x']);
    const session = await historyStore.createEmpty();
    const res = await request(app)
      .post('/api/ai/dispatch')
      .send({ sessionId: session.id, message: 'hi', thinking: 'yes' });
    const events = await collectSseEvents(res);
    expect(events.find((e) => e.event === 'error')).toBeDefined();
  });
```

- [ ] **Step 2: Run test**

```bash
npx vitest run server/routes/dispatch.routes.test.ts
```

Expected: PASS (7 tests now).

- [ ] **Step 3: Lint check + full backend run**

```bash
npm run lint
npx vitest run server
```

Both expected to pass cleanly.

- [ ] **Step 4: Commit**

```bash
git add server/routes/dispatch.routes.test.ts
git commit -m "test(slice-3): dispatch.routes forwards thinking flag"
```

---

## Phase F — Frontend foundations

### Task F1: `session.types` and `reasoning.types` re-exports (FE)

**Files:**
- Create: `src/types/reasoning.types.ts`

- [ ] **Step 1: Create the re-export**

`src/types/reasoning.types.ts`:
```ts
export type {
  ReasoningStep,
  ReasoningStepType,
} from '@/server/domain/reasoning/reasoning.types';
```

- [ ] **Step 2: Lint**

```bash
npm run lint
```

Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add src/types/reasoning.types.ts
git commit -m "feat(slice-3): re-export ReasoningStep types to frontend"
```

---

### Task F2: `dispatch.api.ts` body include thinking

**Files:**
- Modify: `src/lib/api/dispatch.api.ts`
- Modify: `src/lib/api/dispatch.api.test.ts`

- [ ] **Step 1: Update test**

Replace `src/lib/api/dispatch.api.test.ts` with:
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
  it('sends sessionId + message in body (no thinking)', async () => {
    let received: unknown;
    server.use(
      http.post('http://localhost/api/ai/dispatch', async ({ request }) => {
        received = await request.json();
        return new HttpResponse(
          sseChunks('event: done\ndata: {"model":"f","interrupted":false}\n\n'),
          { headers: { 'Content-Type': 'text/event-stream' } },
        );
      }),
    );
    await collect(createStreamingDispatch({ sessionId: 'S', message: 'hi' }, new AbortController().signal));
    expect(received).toEqual({ sessionId: 'S', message: 'hi' });
  });

  it('sends sessionId + message + thinking when provided', async () => {
    let received: unknown;
    server.use(
      http.post('http://localhost/api/ai/dispatch', async ({ request }) => {
        received = await request.json();
        return new HttpResponse(
          sseChunks('event: done\ndata: {"model":"f","interrupted":false}\n\n'),
          { headers: { 'Content-Type': 'text/event-stream' } },
        );
      }),
    );
    await collect(createStreamingDispatch({ sessionId: 'S', message: 'hi', thinking: true }, new AbortController().signal));
    expect(received).toEqual({ sessionId: 'S', message: 'hi', thinking: true });
  });

  it('yields parsed text + done events', async () => {
    server.use(
      http.post('http://localhost/api/ai/dispatch', () =>
        new HttpResponse(
          sseChunks(
            'event: text\ndata: {"chunk":"Hello"}\n\n',
            'event: done\ndata: {"model":"fake-1","interrupted":false}\n\n',
          ),
          { headers: { 'Content-Type': 'text/event-stream' } },
        ),
      ),
    );
    const events = await collect(createStreamingDispatch({ sessionId: 'S', message: 'hi' }, new AbortController().signal));
    expect(events.map((e) => e.event)).toEqual(['text', 'done']);
  });

  it('throws AbortError when signal aborted before fetch resolves', async () => {
    server.use(
      http.post('http://localhost/api/ai/dispatch', () =>
        new HttpResponse(sseChunks('event: text\ndata: {"chunk":"A"}\n\n'), {
          headers: { 'Content-Type': 'text/event-stream' },
        }),
      ),
    );
    const ctrl = new AbortController();
    ctrl.abort();
    await expect(
      collect(createStreamingDispatch({ sessionId: 'S', message: 'hi' }, ctrl.signal)),
    ).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('throws when response is not ok', async () => {
    server.use(
      http.post('http://localhost/api/ai/dispatch', () =>
        HttpResponse.json({ error: { message: 'bad' } }, { status: 503 }),
      ),
    );
    await expect(
      collect(createStreamingDispatch({ sessionId: 'S', message: 'hi' }, new AbortController().signal)),
    ).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run test (1 new test fails)**

```bash
npx vitest run src/lib/api/dispatch.api.test.ts
```

Expected: FAIL on "sends ... + thinking when provided".

- [ ] **Step 3: Update the implementation**

`src/lib/api/dispatch.api.ts`:
```ts
import { parseSseStream, type SseEvent } from '@/src/lib/sse-parser';

export interface DispatchRequestBody {
  sessionId: string;
  message: string;
  thinking?: boolean;
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

- [ ] **Step 4: Run test**

```bash
npx vitest run src/lib/api/dispatch.api.test.ts
```

Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/api/dispatch.api.ts src/lib/api/dispatch.api.test.ts
git commit -m "feat(slice-3): dispatch.api body includes optional thinking flag"
```

---

### Task F3: `useUiStore`

**Files:**
- Create: `src/stores/ui.store.ts`
- Create: `src/stores/ui.store.test.ts`

- [ ] **Step 1: Write the failing test**

`src/stores/ui.store.test.ts`:
```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { useUiStore } from './ui.store';

beforeEach(() => {
  useUiStore.getState()._reset();
  localStorage.clear();
});

describe('useUiStore.reasoningDrawer', () => {
  it('starts closed by default', () => {
    expect(useUiStore.getState().reasoningDrawerOpen).toBe(false);
  });

  it('openReasoningDrawer sets to true; closeReasoningDrawer to false', () => {
    useUiStore.getState().openReasoningDrawer();
    expect(useUiStore.getState().reasoningDrawerOpen).toBe(true);
    useUiStore.getState().closeReasoningDrawer();
    expect(useUiStore.getState().reasoningDrawerOpen).toBe(false);
  });

  it('closeReasoningDrawer clears focusedMessageId', () => {
    useUiStore.setState({ reasoningDrawerOpen: true, focusedMessageId: 'm1' });
    useUiStore.getState().closeReasoningDrawer();
    expect(useUiStore.getState().focusedMessageId).toBeNull();
  });

  it('toggleReasoningDrawer flips state', () => {
    useUiStore.getState().toggleReasoningDrawer();
    expect(useUiStore.getState().reasoningDrawerOpen).toBe(true);
    useUiStore.getState().toggleReasoningDrawer();
    expect(useUiStore.getState().reasoningDrawerOpen).toBe(false);
  });
});

describe('useUiStore.thinkingEnabled', () => {
  it('defaults to false when no localStorage', () => {
    expect(useUiStore.getState().thinkingEnabled).toBe(false);
  });

  it('setThinkingEnabled persists to localStorage', () => {
    useUiStore.getState().setThinkingEnabled(true);
    expect(useUiStore.getState().thinkingEnabled).toBe(true);
    expect(localStorage.getItem('aether.thinkingEnabled')).toBe('1');
    useUiStore.getState().setThinkingEnabled(false);
    expect(localStorage.getItem('aether.thinkingEnabled')).toBe('0');
  });

  it('initFromStorage reads existing value', () => {
    localStorage.setItem('aether.thinkingEnabled', '1');
    useUiStore.getState().initFromStorage();
    expect(useUiStore.getState().thinkingEnabled).toBe(true);
  });

  it('initFromStorage tolerates missing/corrupt values', () => {
    localStorage.setItem('aether.thinkingEnabled', 'garbage');
    useUiStore.getState().initFromStorage();
    expect(useUiStore.getState().thinkingEnabled).toBe(false);
  });
});

describe('useUiStore.focusedMessageId', () => {
  it('starts null', () => {
    expect(useUiStore.getState().focusedMessageId).toBeNull();
  });

  it('setFocusedMessageId stores and clears', () => {
    useUiStore.getState().setFocusedMessageId('m1');
    expect(useUiStore.getState().focusedMessageId).toBe('m1');
    useUiStore.getState().setFocusedMessageId(null);
    expect(useUiStore.getState().focusedMessageId).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run src/stores/ui.store.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Write the implementation**

`src/stores/ui.store.ts`:
```ts
import { create } from 'zustand';

const THINKING_KEY = 'aether.thinkingEnabled';

interface UiState {
  reasoningDrawerOpen: boolean;
  thinkingEnabled: boolean;
  focusedMessageId: string | null;

  toggleReasoningDrawer: () => void;
  openReasoningDrawer: () => void;
  closeReasoningDrawer: () => void;
  setThinkingEnabled: (v: boolean) => void;
  setFocusedMessageId: (id: string | null) => void;
  initFromStorage: () => void;
  _reset: () => void;
}

const initial = {
  reasoningDrawerOpen: false,
  thinkingEnabled: false,
  focusedMessageId: null as string | null,
};

function readStoredThinking(): boolean {
  try {
    return localStorage.getItem(THINKING_KEY) === '1';
  } catch {
    return false;
  }
}

function persistThinking(v: boolean): void {
  try {
    localStorage.setItem(THINKING_KEY, v ? '1' : '0');
  } catch {
    // ignore
  }
}

export const useUiStore = create<UiState>((set) => ({
  ...initial,
  _reset: () => set(initial),

  toggleReasoningDrawer: () =>
    set((s) => ({ reasoningDrawerOpen: !s.reasoningDrawerOpen })),
  openReasoningDrawer: () => set({ reasoningDrawerOpen: true }),
  closeReasoningDrawer: () =>
    set({ reasoningDrawerOpen: false, focusedMessageId: null }),

  setThinkingEnabled: (v) => {
    persistThinking(v);
    set({ thinkingEnabled: v });
  },

  setFocusedMessageId: (id) => set({ focusedMessageId: id }),

  initFromStorage: () => set({ thinkingEnabled: readStoredThinking() }),
}));
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run src/stores/ui.store.test.ts
```

Expected: PASS (12 tests).

- [ ] **Step 5: Commit**

```bash
git add src/stores/ui.store.ts src/stores/ui.store.test.ts
git commit -m "feat(slice-3): add useUiStore (drawer + thinkingEnabled persisted)"
```

---

### Task F4: extend `useChatStore` with `currentReasoning`

**Files:**
- Modify: `src/stores/chat.store.ts`
- Modify: `src/stores/chat.store.test.ts`

- [ ] **Step 1: Update test**

Replace `src/stores/chat.store.test.ts` with:
```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { useChatStore } from './chat.store';
import type { ReasoningStep } from '@/src/types/reasoning.types';

beforeEach(() => {
  useChatStore.getState()._reset();
});

describe('useChatStore basic actions', () => {
  it('starts with empty state', () => {
    const s = useChatStore.getState();
    expect(s.messages).toEqual([]);
    expect(s.streamingId).toBeNull();
    expect(s.hydrated).toBe(false);
    expect(s.currentReasoning).toEqual({ thinkingText: '', steps: [] });
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

  it('startAssistant creates empty model bubble + resets currentReasoning', () => {
    useChatStore.setState({
      currentReasoning: { thinkingText: 'old', steps: [{ id: 'x' } as ReasoningStep] },
    });
    const { id } = useChatStore.getState().startAssistant();
    const s = useChatStore.getState();
    expect(s.streamingId).toBe(id);
    expect(s.currentReasoning).toEqual({ thinkingText: '', steps: [] });
  });

  it('appendChunk concatenates text on the right message', () => {
    const { id } = useChatStore.getState().startAssistant();
    useChatStore.getState().appendChunk(id, 'Hello');
    useChatStore.getState().appendChunk(id, ' world');
    expect(useChatStore.getState().messages.at(-1)?.text).toBe('Hello world');
  });

  it('finishAssistant clears streamingId and sets model + interrupted', () => {
    const { id } = useChatStore.getState().startAssistant();
    useChatStore.getState().finishAssistant(id, { model: 'fake-1', interrupted: false });
    const s = useChatStore.getState();
    expect(s.streamingId).toBeNull();
    expect(s.messages.at(-1)).toMatchObject({ model: 'fake-1', interrupted: false });
  });

  it('failAssistant sets error and retryable, clears streamingId + currentReasoning', () => {
    const { id } = useChatStore.getState().startAssistant();
    useChatStore.setState({ currentReasoning: { thinkingText: 'live', steps: [] } });
    useChatStore.getState().failAssistant(id, 'boom', true);
    const last = useChatStore.getState().messages.at(-1);
    expect(last).toMatchObject({ error: 'boom', retryable: true });
    expect(useChatStore.getState().streamingId).toBeNull();
    expect(useChatStore.getState().currentReasoning).toEqual({ thinkingText: '', steps: [] });
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

  it('reset clears everything', () => {
    useChatStore.getState().appendUser('x');
    useChatStore.getState().startAssistant();
    useChatStore.setState({ currentReasoning: { thinkingText: 'live', steps: [] } });
    useChatStore.getState().reset();
    const s = useChatStore.getState();
    expect(s.messages).toEqual([]);
    expect(s.streamingId).toBeNull();
    expect(s.currentReasoning).toEqual({ thinkingText: '', steps: [] });
  });
});

describe('useChatStore reasoning actions', () => {
  it('appendThinkingChunk accumulates into currentReasoning.thinkingText', () => {
    useChatStore.getState().appendThinkingChunk('a');
    useChatStore.getState().appendThinkingChunk('b');
    expect(useChatStore.getState().currentReasoning.thinkingText).toBe('ab');
  });

  it('appendReasoningStep pushes into currentReasoning.steps', () => {
    const s: ReasoningStep = {
      id: '1', type: 'context_fetch', title: 't', content: 'c', timestamp: 1,
    };
    useChatStore.getState().appendReasoningStep(s);
    expect(useChatStore.getState().currentReasoning.steps).toEqual([s]);
  });

  it('finishAssistant accepts reasoningSteps and attaches them to message', () => {
    const { id } = useChatStore.getState().startAssistant();
    const steps: ReasoningStep[] = [{
      id: '1', type: 'context_fetch', title: 't', content: 'c', timestamp: 1,
    }];
    useChatStore.getState().finishAssistant(id, { model: 'fake', reasoningSteps: steps });
    const last = useChatStore.getState().messages.at(-1);
    expect(last?.reasoningSteps).toEqual(steps);
  });

  it('finishAssistant clears currentReasoning', () => {
    const { id } = useChatStore.getState().startAssistant();
    useChatStore.setState({ currentReasoning: { thinkingText: 'live', steps: [] } });
    useChatStore.getState().finishAssistant(id, { model: 'fake' });
    expect(useChatStore.getState().currentReasoning).toEqual({ thinkingText: '', steps: [] });
  });
});
```

- [ ] **Step 2: Run test (failures on new tests)**

```bash
npx vitest run src/stores/chat.store.test.ts
```

Expected: FAIL on new tests.

- [ ] **Step 3: Replace the implementation**

`src/stores/chat.store.ts`:
```ts
import { create } from 'zustand';
import { newId } from '@/src/lib/ids';
import type { Message } from '@/src/types/message.types';
import type { ReasoningStep } from '@/src/types/reasoning.types';

interface CurrentReasoning {
  thinkingText: string;
  steps: ReasoningStep[];
}

interface ChatState {
  messages: Message[];
  streamingId: string | null;
  abortController: AbortController | null;
  hydrated: boolean;
  currentReasoning: CurrentReasoning;

  hydrate: (messages: Message[]) => void;
  appendUser: (text: string) => { id: string };
  startAssistant: () => { id: string };
  appendChunk: (id: string, text: string) => void;
  appendThinkingChunk: (text: string) => void;
  appendReasoningStep: (step: ReasoningStep) => void;
  finishAssistant: (
    id: string,
    opts: { model?: string; interrupted?: boolean; reasoningSteps?: ReasoningStep[] },
  ) => void;
  failAssistant: (id: string, error: string, retryable: boolean) => void;
  setAbortController: (c: AbortController | null) => void;
  abort: () => void;
  reset: () => void;
  _reset: () => void;
}

const emptyReasoning: CurrentReasoning = { thinkingText: '', steps: [] };

const initial = {
  messages: [] as Message[],
  streamingId: null as string | null,
  abortController: null as AbortController | null,
  hydrated: false,
  currentReasoning: emptyReasoning,
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
    set((s) => ({
      messages: [...s.messages, msg],
      streamingId: msg.id,
      currentReasoning: emptyReasoning,
    }));
    return { id: msg.id };
  },

  appendChunk: (id, text) =>
    set((s) => ({
      messages: s.messages.map((m) =>
        m.id === id ? { ...m, text: m.text + text } : m,
      ),
    })),

  appendThinkingChunk: (text) =>
    set((s) => ({
      currentReasoning: {
        ...s.currentReasoning,
        thinkingText: s.currentReasoning.thinkingText + text,
      },
    })),

  appendReasoningStep: (step) =>
    set((s) => ({
      currentReasoning: {
        ...s.currentReasoning,
        steps: [...s.currentReasoning.steps, step],
      },
    })),

  finishAssistant: (id, opts) =>
    set((s) => ({
      streamingId: s.streamingId === id ? null : s.streamingId,
      messages: s.messages.map((m) =>
        m.id === id
          ? {
              ...m,
              model: opts.model,
              interrupted: opts.interrupted,
              reasoningSteps: opts.reasoningSteps ?? m.reasoningSteps,
            }
          : m,
      ),
      abortController: null,
      currentReasoning: emptyReasoning,
    })),

  failAssistant: (id, error, retryable) =>
    set((s) => ({
      streamingId: s.streamingId === id ? null : s.streamingId,
      messages: s.messages.map((m) =>
        m.id === id ? { ...m, error, retryable } : m,
      ),
      abortController: null,
      currentReasoning: emptyReasoning,
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

Expected: PASS (14 tests).

- [ ] **Step 5: Commit**

```bash
git add src/stores/chat.store.ts src/stores/chat.store.test.ts
git commit -m "feat(slice-3): useChatStore +currentReasoning + reasoning actions"
```

---

## Phase G — Hook

### Task G1: `useStreamingDispatch` handles thinking + reasoning_step

**Files:**
- Modify: `src/hooks/useStreamingDispatch.ts`
- Modify: `src/hooks/useStreamingDispatch.test.ts`

- [ ] **Step 1: Update test**

Replace `src/hooks/useStreamingDispatch.test.ts` with:
```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { server } from '@/src/test/msw-server';
import { useStreamingDispatch } from './useStreamingDispatch';
import { useChatStore } from '@/src/stores/chat.store';
import { useSessionsStore } from '@/src/stores/sessions.store';
import { useUiStore } from '@/src/stores/ui.store';

function sseStream(...lines: string[]) {
  const enc = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(c) {
      for (const l of lines) c.enqueue(enc.encode(l));
      c.close();
    },
  });
}

const meta = (id: string, title = '') => ({ id, title, createdAt: 1, updatedAt: 1 });

beforeEach(() => {
  useChatStore.getState()._reset();
  useSessionsStore.getState()._reset();
  useUiStore.getState()._reset();
  useSessionsStore.setState({ sessions: [meta('S1')], activeSessionId: 'S1', hydrated: true });
  localStorage.clear();
});

describe('useStreamingDispatch', () => {
  it('sends sessionId + thinking (false by default)', async () => {
    let received: unknown;
    server.use(
      http.post('http://localhost/api/ai/dispatch', async ({ request }) => {
        received = await request.json();
        return new HttpResponse(
          sseStream('event: done\ndata: {"model":"f","interrupted":false}\n\n'),
          { headers: { 'Content-Type': 'text/event-stream' } },
        );
      }),
    );
    const { result } = renderHook(() => useStreamingDispatch());
    await act(async () => { await result.current.send('hi'); });
    expect(received).toMatchObject({ sessionId: 'S1', message: 'hi', thinking: false });
  });

  it('sends thinking=true when useUiStore.thinkingEnabled is true', async () => {
    useUiStore.getState().setThinkingEnabled(true);
    let received: unknown;
    server.use(
      http.post('http://localhost/api/ai/dispatch', async ({ request }) => {
        received = await request.json();
        return new HttpResponse(
          sseStream('event: done\ndata: {"model":"f","interrupted":false}\n\n'),
          { headers: { 'Content-Type': 'text/event-stream' } },
        );
      }),
    );
    const { result } = renderHook(() => useStreamingDispatch());
    await act(async () => { await result.current.send('hi'); });
    expect((received as { thinking?: boolean }).thinking).toBe(true);
  });

  it('event:thinking opens drawer + accumulates thinkingText', async () => {
    server.use(
      http.post('http://localhost/api/ai/dispatch', () =>
        new HttpResponse(
          sseStream(
            'event: thinking\ndata: {"chunk":"pondering"}\n\n',
            'event: thinking\ndata: {"chunk":" more"}\n\n',
            'event: done\ndata: {"model":"f","interrupted":false}\n\n',
          ),
          { headers: { 'Content-Type': 'text/event-stream' } },
        ),
      ),
    );
    expect(useUiStore.getState().reasoningDrawerOpen).toBe(false);
    const { result } = renderHook(() => useStreamingDispatch());
    await act(async () => { await result.current.send('hi'); });
    // drawer auto-opened
    expect(useUiStore.getState().reasoningDrawerOpen).toBe(true);
  });

  it('event:reasoning_step accumulates in currentReasoning (during stream)', async () => {
    server.use(
      http.post('http://localhost/api/ai/dispatch', () =>
        new HttpResponse(
          sseStream(
            'event: reasoning_step\ndata: {"id":"a","type":"context_fetch","title":"Read","content":"ok","timestamp":1}\n\n',
            'event: text\ndata: {"chunk":"hello"}\n\n',
            'event: done\ndata: {"model":"f","interrupted":false,"reasoningSteps":[{"id":"a","type":"context_fetch","title":"Read","content":"ok","timestamp":1}]}\n\n',
          ),
          { headers: { 'Content-Type': 'text/event-stream' } },
        ),
      ),
    );
    const { result } = renderHook(() => useStreamingDispatch());
    await act(async () => { await result.current.send('hi'); });
    const last = useChatStore.getState().messages.at(-1);
    expect(last?.reasoningSteps).toHaveLength(1);
  });

  it('done.reasoningSteps attached to message', async () => {
    server.use(
      http.post('http://localhost/api/ai/dispatch', () =>
        new HttpResponse(
          sseStream(
            'event: text\ndata: {"chunk":"OK"}\n\n',
            'event: done\ndata: {"model":"f","interrupted":false,"reasoningSteps":[{"id":"a","type":"validation","title":"V","content":"ok","timestamp":1}]}\n\n',
          ),
          { headers: { 'Content-Type': 'text/event-stream' } },
        ),
      ),
    );
    const { result } = renderHook(() => useStreamingDispatch());
    await act(async () => { await result.current.send('hi'); });
    expect(useChatStore.getState().messages.at(-1)?.reasoningSteps).toEqual([
      { id: 'a', type: 'validation', title: 'V', content: 'ok', timestamp: 1 },
    ]);
  });

  it('no-op when activeSessionId is null', async () => {
    useSessionsStore.setState({ sessions: [], activeSessionId: null, hydrated: true });
    const { result } = renderHook(() => useStreamingDispatch());
    await act(async () => { await result.current.send('hi'); });
    expect(useChatStore.getState().messages).toEqual([]);
  });

  it('clears focusedMessageId at start of send', async () => {
    useUiStore.getState().setFocusedMessageId('m-old');
    server.use(
      http.post('http://localhost/api/ai/dispatch', () =>
        new HttpResponse(
          sseStream('event: done\ndata: {"model":"f","interrupted":false}\n\n'),
          { headers: { 'Content-Type': 'text/event-stream' } },
        ),
      ),
    );
    const { result } = renderHook(() => useStreamingDispatch());
    await act(async () => { await result.current.send('hi'); });
    expect(useUiStore.getState().focusedMessageId).toBeNull();
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
    await waitFor(() => { expect(result.current.isStreaming).toBe(true); });
    release();
    await p;
    expect(result.current.isStreaming).toBe(false);
  });
});
```

- [ ] **Step 2: Run test (expect failures)**

```bash
npx vitest run src/hooks/useStreamingDispatch.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Replace the hook**

`src/hooks/useStreamingDispatch.ts`:
```ts
import { useCallback } from 'react';
import { useChatStore } from '@/src/stores/chat.store';
import { useSessionsStore } from '@/src/stores/sessions.store';
import { useUiStore } from '@/src/stores/ui.store';
import { createStreamingDispatch } from '@/src/lib/api/dispatch.api';
import { computeTitle } from '@/src/lib/title';
import type { ReasoningStep } from '@/src/types/reasoning.types';

interface TextData { chunk: string }
interface ThinkingData { chunk: string }
interface DoneData { model?: string; interrupted?: boolean; reasoningSteps?: ReasoningStep[] }
interface ErrorData { message: string; retryable: boolean }

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : 'Unknown error';
}

export function useStreamingDispatch() {
  const isStreaming = useChatStore((s) => s.streamingId !== null);

  const send = useCallback(async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    const activeId = useSessionsStore.getState().activeSessionId;
    if (!activeId) {
      console.warn('[aether] no active session');
      return;
    }
    const chat = useChatStore.getState();
    if (chat.streamingId) return;

    // Clear focus so the drawer naturally targets the new streamingId.
    useUiStore.getState().setFocusedMessageId(null);

    // Local auto-title (slice 2b).
    const active = useSessionsStore.getState().sessions.find((s) => s.id === activeId);
    if (active && !active.title) {
      useSessionsStore.getState().setLocalTitle(activeId, computeTitle(trimmed));
    }

    const thinking = useUiStore.getState().thinkingEnabled;

    chat.appendUser(trimmed);
    const { id } = chat.startAssistant();
    const controller = new AbortController();
    chat.setAbortController(controller);

    let firstThinkingSeen = false;

    try {
      for await (const ev of createStreamingDispatch(
        { sessionId: activeId, message: trimmed, thinking },
        controller.signal,
      )) {
        if (ev.event === 'text') {
          useChatStore.getState().appendChunk(id, (ev.data as TextData).chunk);
        } else if (ev.event === 'thinking') {
          useChatStore.getState().appendThinkingChunk((ev.data as ThinkingData).chunk);
          if (!firstThinkingSeen) {
            firstThinkingSeen = true;
            useUiStore.getState().openReasoningDrawer();
          }
        } else if (ev.event === 'reasoning_step') {
          useChatStore.getState().appendReasoningStep(ev.data as ReasoningStep);
        } else if (ev.event === 'done') {
          const d = ev.data as DoneData;
          useChatStore.getState().finishAssistant(id, {
            model: d.model,
            interrupted: !!d.interrupted,
            reasoningSteps: d.reasoningSteps,
          });
          return;
        } else if (ev.event === 'error') {
          const d = ev.data as ErrorData;
          useChatStore.getState().failAssistant(id, d.message, !!d.retryable);
          return;
        }
      }
      useChatStore.getState().finishAssistant(id, { interrupted: controller.signal.aborted });
    } catch (e) {
      if (controller.signal.aborted) {
        useChatStore.getState().finishAssistant(id, { interrupted: true });
      } else {
        useChatStore.getState().failAssistant(id, errMsg(e), true);
      }
    } finally {
      useSessionsStore.getState().touchUpdatedAt(activeId, Date.now());
    }
  }, []);

  const abort = useCallback(() => {
    useChatStore.getState().abort();
  }, []);

  return { send, abort, isStreaming };
}
```

- [ ] **Step 4: Run test**

```bash
npx vitest run src/hooks/useStreamingDispatch.test.ts
```

Expected: PASS (8 tests).

- [ ] **Step 5: Commit**

```bash
git add src/hooks/useStreamingDispatch.ts src/hooks/useStreamingDispatch.test.ts
git commit -m "feat(slice-3): useStreamingDispatch handles thinking/reasoning_step + body.thinking"
```

---

## Phase H — Reasoning components

### Task H1: leaf components (`ConfidenceBar`, `DispatchBranch`, `LiveThinkingBlock`)

**Files:**
- Create: `src/components/reasoning/ConfidenceBar.tsx`
- Create: `src/components/reasoning/ConfidenceBar.test.tsx`
- Create: `src/components/reasoning/DispatchBranch.tsx`
- Create: `src/components/reasoning/DispatchBranch.test.tsx`
- Create: `src/components/reasoning/LiveThinkingBlock.tsx`

- [ ] **Step 1: Write ConfidenceBar test**

`src/components/reasoning/ConfidenceBar.test.tsx`:
```tsx
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { ConfidenceBar } from './ConfidenceBar';

describe('ConfidenceBar', () => {
  it('renders null when confidence is undefined', () => {
    const { container } = render(<ConfidenceBar />);
    expect(container.firstChild).toBeNull();
  });

  it('renders a bar with width proportional to confidence', () => {
    const { container } = render(<ConfidenceBar confidence={0.5} />);
    const bar = container.querySelector('[data-testid="confidence-fill"]') as HTMLElement;
    expect(bar).not.toBeNull();
    expect(bar.style.width).toBe('50%');
  });

  it('clamps confidence to [0,1]', () => {
    const { container, rerender } = render(<ConfidenceBar confidence={2} />);
    let bar = container.querySelector('[data-testid="confidence-fill"]') as HTMLElement;
    expect(bar.style.width).toBe('100%');
    rerender(<ConfidenceBar confidence={-0.5} />);
    bar = container.querySelector('[data-testid="confidence-fill"]') as HTMLElement;
    expect(bar.style.width).toBe('0%');
  });
});
```

- [ ] **Step 2: Write ConfidenceBar implementation**

`src/components/reasoning/ConfidenceBar.tsx`:
```tsx
export interface ConfidenceBarProps {
  confidence?: number;
}

export function ConfidenceBar({ confidence }: ConfidenceBarProps) {
  if (confidence === undefined) return null;
  const clamped = Math.max(0, Math.min(1, confidence));
  const pct = `${Math.round(clamped * 100)}%`;
  return (
    <div className="h-1 w-full bg-zinc-800 rounded overflow-hidden">
      <div
        data-testid="confidence-fill"
        className="h-full bg-accent"
        style={{ width: pct }}
      />
    </div>
  );
}
```

- [ ] **Step 3: Write DispatchBranch test**

`src/components/reasoning/DispatchBranch.test.tsx`:
```tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { DispatchBranch } from './DispatchBranch';

describe('DispatchBranch', () => {
  it('renders null when subAgent is undefined', () => {
    const { container } = render(<DispatchBranch />);
    expect(container.firstChild).toBeNull();
  });

  it('renders pill with subAgent label', () => {
    render(<DispatchBranch subAgent="Coder_X1" />);
    expect(screen.getByText('Coder_X1')).toBeInTheDocument();
  });
});
```

- [ ] **Step 4: Write DispatchBranch implementation**

`src/components/reasoning/DispatchBranch.tsx`:
```tsx
export interface DispatchBranchProps {
  subAgent?: string;
}

export function DispatchBranch({ subAgent }: DispatchBranchProps) {
  if (!subAgent) return null;
  return (
    <span className="text-[9px] px-1.5 py-0.5 rounded bg-purple-500/10 text-purple-300 font-mono uppercase tracking-widest">
      {subAgent}
    </span>
  );
}
```

- [ ] **Step 5: Write LiveThinkingBlock (no test needed — pure presentational)**

`src/components/reasoning/LiveThinkingBlock.tsx`:
```tsx
export interface LiveThinkingBlockProps {
  text: string;
}

export function LiveThinkingBlock({ text }: LiveThinkingBlockProps) {
  if (!text) return null;
  return (
    <div className="p-2 rounded bg-purple-500/5 border border-purple-500/30">
      <div className="mono-label text-purple-300 mb-1">💭 thinking</div>
      <div className="text-[11px] text-zinc-300 whitespace-pre-wrap font-mono leading-relaxed">
        {text}
      </div>
    </div>
  );
}
```

- [ ] **Step 6: Run tests**

```bash
npx vitest run src/components/reasoning/ConfidenceBar.test.tsx src/components/reasoning/DispatchBranch.test.tsx
```

Expected: PASS (5 tests total).

- [ ] **Step 7: Lint**

```bash
npm run lint
```

Expected: clean.

- [ ] **Step 8: Commit**

```bash
git add src/components/reasoning/ConfidenceBar.tsx src/components/reasoning/ConfidenceBar.test.tsx src/components/reasoning/DispatchBranch.tsx src/components/reasoning/DispatchBranch.test.tsx src/components/reasoning/LiveThinkingBlock.tsx
git commit -m "feat(slice-3): add ConfidenceBar + DispatchBranch + LiveThinkingBlock"
```

---

### Task H2: `ReasoningStepCard`

**Files:**
- Create: `src/components/reasoning/ReasoningStepCard.tsx`
- Create: `src/components/reasoning/ReasoningStepCard.test.tsx`

- [ ] **Step 1: Write the failing test**

`src/components/reasoning/ReasoningStepCard.test.tsx`:
```tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ReasoningStepCard } from './ReasoningStepCard';
import type { ReasoningStep } from '@/src/types/reasoning.types';

const baseStep: ReasoningStep = {
  id: '1', type: 'context_fetch', title: 'Read context', content: 'loaded', timestamp: 1,
};

describe('ReasoningStepCard', () => {
  it('renders title + content', () => {
    render(<ReasoningStepCard step={baseStep} />);
    expect(screen.getByText('Read context')).toBeInTheDocument();
    expect(screen.getByText('loaded')).toBeInTheDocument();
  });

  it('shows durationMs in ms when < 1000', () => {
    render(<ReasoningStepCard step={{ ...baseStep, durationMs: 123 }} />);
    expect(screen.getByText(/123ms/)).toBeInTheDocument();
  });

  it('shows durationMs in seconds when >= 1000', () => {
    render(<ReasoningStepCard step={{ ...baseStep, durationMs: 1500 }} />);
    expect(screen.getByText(/1\.5s/)).toBeInTheDocument();
  });

  it('shows tokens when present', () => {
    render(<ReasoningStepCard step={{ ...baseStep, tokens: 42 }} />);
    expect(screen.getByText(/42 t/)).toBeInTheDocument();
  });

  it('shows em-dash for missing tokens', () => {
    render(<ReasoningStepCard step={baseStep} />);
    expect(screen.getByText(/— t/)).toBeInTheDocument();
  });

  it('renders unknown type with neutral fallback (does not crash)', () => {
    const step = { ...baseStep, type: 'mystery' as unknown as 'logic' };
    render(<ReasoningStepCard step={step} />);
    expect(screen.getByText('Read context')).toBeInTheDocument();
  });

  it('renders DispatchBranch when subAgent present', () => {
    render(<ReasoningStepCard step={{ ...baseStep, subAgent: 'Coder' }} />);
    expect(screen.getByText('Coder')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run src/components/reasoning/ReasoningStepCard.test.tsx
```

Expected: FAIL.

- [ ] **Step 3: Write the implementation**

`src/components/reasoning/ReasoningStepCard.tsx`:
```tsx
import type { ReasoningStep, ReasoningStepType } from '@/src/types/reasoning.types';
import { ConfidenceBar } from './ConfidenceBar';
import { DispatchBranch } from './DispatchBranch';
import { cn } from '@/src/lib/cn';

const TYPE_LABELS: Record<ReasoningStepType, string> = {
  context_fetch: 'context',
  mcp_query: 'mcp',
  dispatch: 'dispatch',
  thinking: 'thinking',
  validation: 'validation',
  logic: 'logic',
};

const TYPE_COLORS: Record<ReasoningStepType, string> = {
  context_fetch: 'bg-blue-500/10 text-blue-400',
  mcp_query: 'bg-cyan-500/10 text-cyan-400',
  dispatch: 'bg-purple-500/10 text-purple-400',
  thinking: 'bg-purple-500/10 text-purple-300',
  validation: 'bg-green-500/10 text-green-400',
  logic: 'bg-zinc-800 text-zinc-400',
};

function formatDuration(ms?: number): string {
  if (ms === undefined) return '—';
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function formatTokens(tokens?: number): string {
  return tokens === undefined ? '—' : `${tokens}`;
}

export interface ReasoningStepCardProps {
  step: ReasoningStep;
}

export function ReasoningStepCard({ step }: ReasoningStepCardProps) {
  const knownType = step.type in TYPE_LABELS ? step.type : 'logic';
  const badgeLabel = TYPE_LABELS[knownType as ReasoningStepType] ?? step.type;
  const badgeColor = TYPE_COLORS[knownType as ReasoningStepType] ?? TYPE_COLORS.logic;

  return (
    <div className="p-2 rounded bg-surface-3 border border-border-subtle">
      <div className="flex items-center justify-between gap-2 mb-1">
        <span className={cn('text-[9px] px-1.5 py-0.5 rounded font-mono uppercase tracking-widest font-bold', badgeColor)}>
          {badgeLabel}
        </span>
        <DispatchBranch subAgent={step.subAgent} />
      </div>
      <div className="text-xs font-mono text-zinc-200 mb-1">{step.title}</div>
      <div className="text-[11px] text-zinc-400 whitespace-pre-wrap mb-2">{step.content}</div>
      <div className="flex items-center justify-between text-[10px] text-zinc-500 font-mono">
        <span>{formatDuration(step.durationMs)}</span>
        <span>{formatTokens(step.tokens)} t</span>
      </div>
      <ConfidenceBar />
    </div>
  );
}
```

- [ ] **Step 4: Run test**

```bash
npx vitest run src/components/reasoning/ReasoningStepCard.test.tsx
```

Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add src/components/reasoning/ReasoningStepCard.tsx src/components/reasoning/ReasoningStepCard.test.tsx
git commit -m "feat(slice-3): add ReasoningStepCard with type badge + duration/tokens"
```

---

### Task H3: `ReasoningDrawer`

**Files:**
- Create: `src/components/reasoning/ReasoningDrawer.tsx`
- Create: `src/components/reasoning/ReasoningDrawer.test.tsx`

- [ ] **Step 1: Write the failing test**

`src/components/reasoning/ReasoningDrawer.test.tsx`:
```tsx
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ReasoningDrawer } from './ReasoningDrawer';
import { useUiStore } from '@/src/stores/ui.store';
import { useChatStore } from '@/src/stores/chat.store';
import type { ReasoningStep } from '@/src/types/reasoning.types';

const step = (id: string, type: ReasoningStep['type'] = 'context_fetch', title = 't', content = 'c'): ReasoningStep => ({
  id, type, title, content, timestamp: 1,
});

beforeEach(() => {
  useUiStore.getState()._reset();
  useChatStore.getState()._reset();
});

describe('ReasoningDrawer', () => {
  it('renders nothing when drawer is closed', () => {
    useUiStore.setState({ reasoningDrawerOpen: false });
    const { container } = render(<ReasoningDrawer />);
    expect(container.firstChild).toBeNull();
  });

  it('renders when open with empty state', () => {
    useUiStore.setState({ reasoningDrawerOpen: true });
    render(<ReasoningDrawer />);
    expect(screen.getByRole('complementary', { name: /reasoning/i })).toBeInTheDocument();
    expect(screen.getByText(/Nessuno step/i)).toBeInTheDocument();
  });

  it('close button calls closeReasoningDrawer', async () => {
    useUiStore.setState({ reasoningDrawerOpen: true });
    render(<ReasoningDrawer />);
    await userEvent.click(screen.getByRole('button', { name: /close reasoning drawer/i }));
    expect(useUiStore.getState().reasoningDrawerOpen).toBe(false);
  });

  it('live mode: shows LiveThinkingBlock + currentReasoning.steps', () => {
    useUiStore.setState({ reasoningDrawerOpen: true });
    useChatStore.setState({
      streamingId: 'm1',
      messages: [{ id: 'm1', role: 'model', text: '', timestamp: 1 }],
      currentReasoning: { thinkingText: 'pondering', steps: [step('s1')] },
    });
    render(<ReasoningDrawer />);
    expect(screen.getByText(/pondering/)).toBeInTheDocument();
    expect(screen.getByText('t')).toBeInTheDocument(); // step title
  });

  it('static mode: shows activeMessage.reasoningSteps after stream done', () => {
    useUiStore.setState({ reasoningDrawerOpen: true });
    useChatStore.setState({
      streamingId: null,
      messages: [
        { id: 'u', role: 'user', text: 'hi', timestamp: 0 },
        {
          id: 'm1', role: 'model', text: 'ok', timestamp: 1,
          reasoningSteps: [step('s1', 'validation', 'Validate', 'ok')],
        },
      ],
    });
    render(<ReasoningDrawer />);
    expect(screen.getByText('Validate')).toBeInTheDocument();
  });

  it('focus resolution: focusedMessageId wins over streamingId', () => {
    useUiStore.setState({ reasoningDrawerOpen: true, focusedMessageId: 'm_old' });
    useChatStore.setState({
      streamingId: 'm_new',
      messages: [
        {
          id: 'm_old', role: 'model', text: 'old', timestamp: 0,
          reasoningSteps: [step('a', 'context_fetch', 'OldStep', 'old content')],
        },
        { id: 'm_new', role: 'model', text: '', timestamp: 1 },
      ],
      currentReasoning: { thinkingText: '', steps: [step('b', 'dispatch', 'NewStep', 'new content')] },
    });
    render(<ReasoningDrawer />);
    expect(screen.getByText('OldStep')).toBeInTheDocument();
    expect(screen.queryByText('NewStep')).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run src/components/reasoning/ReasoningDrawer.test.tsx
```

Expected: FAIL.

- [ ] **Step 3: Write the implementation**

`src/components/reasoning/ReasoningDrawer.tsx`:
```tsx
import { useMemo } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useUiStore } from '@/src/stores/ui.store';
import { useChatStore } from '@/src/stores/chat.store';
import { LiveThinkingBlock } from './LiveThinkingBlock';
import { ReasoningStepCard } from './ReasoningStepCard';

export function ReasoningDrawer() {
  const open = useUiStore((s) => s.reasoningDrawerOpen);
  const close = useUiStore((s) => s.closeReasoningDrawer);
  const focusedId = useUiStore((s) => s.focusedMessageId);

  const streamingId = useChatStore((s) => s.streamingId);
  const messages = useChatStore(useShallow((s) => s.messages));
  const currentReasoning = useChatStore((s) => s.currentReasoning);

  const lastAssistantId = useMemo(
    () => [...messages].reverse().find((m) => m.role === 'model')?.id ?? null,
    [messages],
  );

  const activeId = focusedId ?? streamingId ?? lastAssistantId;
  const activeMessage = messages.find((m) => m.id === activeId);
  const isLive = streamingId !== null && activeId === streamingId;

  const steps = isLive ? currentReasoning.steps : (activeMessage?.reasoningSteps ?? []);
  const liveThinking = isLive ? currentReasoning.thinkingText : '';

  if (!open) return null;

  return (
    <aside
      role="complementary"
      aria-label="Reasoning"
      className="fixed right-0 top-0 bottom-0 z-40 w-96 bg-surface-2 border-l border-border-subtle flex flex-col"
    >
      <header className="p-3 border-b border-border-subtle flex items-center justify-between">
        <span className="mono-label">Reasoning</span>
        <button
          type="button"
          aria-label="Close reasoning drawer"
          onClick={close}
          className="text-zinc-500 hover:text-white"
        >
          ×
        </button>
      </header>
      <div className="flex-1 overflow-y-auto p-3 flex flex-col gap-2">
        {liveThinking && <LiveThinkingBlock text={liveThinking} />}
        {steps.map((s) => (
          <ReasoningStepCard key={s.id} step={s} />
        ))}
        {steps.length === 0 && !liveThinking && (
          <p className="text-zinc-500 text-xs italic">Nessuno step</p>
        )}
      </div>
    </aside>
  );
}
```

- [ ] **Step 4: Run test**

```bash
npx vitest run src/components/reasoning/ReasoningDrawer.test.tsx
```

Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/components/reasoning/ReasoningDrawer.tsx src/components/reasoning/ReasoningDrawer.test.tsx
git commit -m "feat(slice-3): add ReasoningDrawer with focus resolution + live/static modes"
```

---

## Phase I — Chat UI updates

### Task I1: `MessageBubble` badges

**Files:**
- Modify: `src/components/chat/MessageBubble.tsx`
- Modify: `src/components/chat/MessageBubble.test.tsx`

- [ ] **Step 1: Append tests**

In `src/components/chat/MessageBubble.test.tsx`, append inside the existing `describe('MessageBubble', ...)`:

```tsx
  it('shows "💭 thinking…" badge when streaming this message AND thinkingText has content', () => {
    seed({ id: 'mt', role: 'model', text: '' });
    useChatStore.setState({
      streamingId: 'mt',
      currentReasoning: { thinkingText: 'pondering', steps: [] },
    });
    render(<MessageBubble id="mt" />);
    expect(screen.getByText(/thinking/i)).toBeInTheDocument();
  });

  it('shows "🧠 N steps" badge when message.reasoningSteps non-empty (post-stream)', () => {
    seed({
      id: 'ms', role: 'model', text: 'done',
      reasoningSteps: [
        { id: 'a', type: 'context_fetch', title: 't', content: 'c', timestamp: 1 },
        { id: 'b', type: 'dispatch', title: 't', content: 'c', timestamp: 1 },
      ],
    });
    render(<MessageBubble id="ms" />);
    expect(screen.getByText(/2 steps/i)).toBeInTheDocument();
  });

  it('clicking the steps badge opens drawer and sets focusedMessageId', async () => {
    seed({
      id: 'mb', role: 'model', text: 'done',
      reasoningSteps: [{ id: 'a', type: 'context_fetch', title: 't', content: 'c', timestamp: 1 }],
    });
    render(<MessageBubble id="mb" />);
    await userEvent.click(screen.getByRole('button', { name: /show reasoning/i }));
    expect(useUiStore.getState().reasoningDrawerOpen).toBe(true);
    expect(useUiStore.getState().focusedMessageId).toBe('mb');
  });

  it('no badge when message has no reasoning and not streaming', () => {
    seed({ id: 'noreasoning', role: 'model', text: 'done' });
    render(<MessageBubble id="noreasoning" />);
    expect(screen.queryByRole('button', { name: /show reasoning/i })).not.toBeInTheDocument();
  });
```

Also at top of the file: `import { useUiStore } from '@/src/stores/ui.store';` and reset it in `beforeEach`:
```ts
beforeEach(() => {
  useChatStore.getState()._reset();
  useUiStore.getState()._reset();
});
```

- [ ] **Step 2: Run test (4 new tests fail)**

```bash
npx vitest run src/components/chat/MessageBubble.test.tsx
```

Expected: FAIL.

- [ ] **Step 3: Update MessageBubble**

`src/components/chat/MessageBubble.tsx`:
```tsx
import ReactMarkdown from 'react-markdown';
import { useChatStore } from '@/src/stores/chat.store';
import { useUiStore } from '@/src/stores/ui.store';
import { StreamingIndicator } from './StreamingIndicator';
import { cn } from '@/src/lib/cn';

export interface MessageBubbleProps {
  id: string;
  onRetry?: (id: string) => void;
}

export function MessageBubble({ id, onRetry }: MessageBubbleProps) {
  const message = useChatStore((s) => s.messages.find((m) => m.id === id));
  const isStreaming = useChatStore((s) => s.streamingId === id);
  const isThinkingNow = useChatStore(
    (s) => s.streamingId === id && s.currentReasoning.thinkingText.length > 0,
  );

  if (!message) return null;

  const isUser = message.role === 'user';
  const hasReasoningSteps = (message.reasoningSteps?.length ?? 0) > 0;

  const handleReasoningClick = () => {
    useUiStore.getState().setFocusedMessageId(id);
    useUiStore.getState().openReasoningDrawer();
  };

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

        {(isThinkingNow || hasReasoningSteps) && (
          <button
            type="button"
            onClick={handleReasoningClick}
            aria-label="Show reasoning"
            className="mt-2 text-[10px] text-zinc-500 hover:text-accent flex items-center gap-1"
          >
            {isThinkingNow
              ? '💭 thinking…'
              : `🧠 ${message.reasoningSteps!.length} steps`}
          </button>
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
            ⏸ Interrotto dall&apos;utente
          </div>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run test**

```bash
npx vitest run src/components/chat/MessageBubble.test.tsx
```

Expected: PASS (11 tests now).

- [ ] **Step 5: Commit**

```bash
git add src/components/chat/MessageBubble.tsx src/components/chat/MessageBubble.test.tsx
git commit -m "feat(slice-3): MessageBubble adds thinking/steps badges + drawer focus"
```

---

### Task I2: `MessageInput` brain toggle

**Files:**
- Modify: `src/components/chat/MessageInput.tsx`
- Modify: `src/components/chat/MessageInput.test.tsx`

- [ ] **Step 1: Append tests**

In `src/components/chat/MessageInput.test.tsx`, prepend `useUiStore` setup:

```tsx
import { useUiStore } from '@/src/stores/ui.store';
// inside an existing or new describe, add:

import { beforeEach } from 'vitest';

beforeEach(() => {
  useUiStore.getState()._reset();
  localStorage.clear();
});
```

Append at the end of the existing `describe('MessageInput', ...)`:

```tsx
  it('brain toggle reflects ui.store.thinkingEnabled', () => {
    render(<MessageInput onSend={() => {}} onStop={() => {}} isStreaming={false} />);
    const btn = screen.getByRole('button', { name: /thinking/i });
    expect(btn).toHaveAttribute('aria-pressed', 'false');
    useUiStore.getState().setThinkingEnabled(true);
    // re-render-on-state-change: with Zustand selectors, the component should re-render automatically
    expect(btn).toHaveAttribute('aria-pressed', 'true');
  });

  it('clicking brain toggle flips thinkingEnabled', async () => {
    render(<MessageInput onSend={() => {}} onStop={() => {}} isStreaming={false} />);
    const btn = screen.getByRole('button', { name: /thinking/i });
    await userEvent.click(btn);
    expect(useUiStore.getState().thinkingEnabled).toBe(true);
    await userEvent.click(btn);
    expect(useUiStore.getState().thinkingEnabled).toBe(false);
  });
```

- [ ] **Step 2: Run test (2 new tests fail)**

```bash
npx vitest run src/components/chat/MessageInput.test.tsx
```

Expected: FAIL.

- [ ] **Step 3: Update MessageInput**

`src/components/chat/MessageInput.tsx`:
```tsx
import { useState, type KeyboardEvent } from 'react';
import { Send, Square, Brain } from 'lucide-react';
import { useUiStore } from '@/src/stores/ui.store';
import { cn } from '@/src/lib/cn';

export interface MessageInputProps {
  onSend: (text: string) => void;
  onStop: () => void;
  isStreaming: boolean;
}

export function MessageInput({ onSend, onStop, isStreaming }: MessageInputProps) {
  const [value, setValue] = useState('');
  const thinkingEnabled = useUiStore((s) => s.thinkingEnabled);
  const setThinkingEnabled = useUiStore((s) => s.setThinkingEnabled);

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
        <button
          type="button"
          aria-label="Toggle thinking mode"
          aria-pressed={thinkingEnabled}
          onClick={() => setThinkingEnabled(!thinkingEnabled)}
          title={thinkingEnabled ? 'Thinking enabled (slower, shows reasoning)' : 'Thinking disabled'}
          className={cn(
            'p-2 rounded transition-colors',
            thinkingEnabled
              ? 'bg-accent/20 text-accent border border-accent/40'
              : 'bg-surface-1 text-zinc-500 border border-border-subtle hover:text-zinc-300',
          )}
        >
          <Brain size={16} />
        </button>
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

- [ ] **Step 4: Run test**

```bash
npx vitest run src/components/chat/MessageInput.test.tsx
```

Expected: PASS (10 tests now).

- [ ] **Step 5: Commit**

```bash
git add src/components/chat/MessageInput.tsx src/components/chat/MessageInput.test.tsx
git commit -m "feat(slice-3): MessageInput adds Brain toggle for thinking mode"
```

---

### Task I3: `ChatView.test.tsx` adds thinking integration test

**Files:**
- Modify: `src/components/chat/ChatView.test.tsx`

The `ChatView.tsx` itself doesn't change (it doesn't directly know about thinking; the hook+stores handle it). We just add an integration test that thinking events flow end-to-end.

- [ ] **Step 1: Append a test**

In `src/components/chat/ChatView.test.tsx`, ensure `useUiStore` is reset in `beforeEach`:

```tsx
import { useUiStore } from '@/src/stores/ui.store';

// inside beforeEach:
beforeEach(() => {
  useChatStore.getState()._reset();
  useSessionsStore.getState()._reset();
  useUiStore.getState()._reset();
  useSessionsStore.setState({
    sessions: [{ id: 'S1', title: '', createdAt: 0, updatedAt: 0 }],
    activeSessionId: 'S1',
    hydrated: true,
  });
});
```

Append test:
```tsx
  it('event:thinking auto-opens reasoning drawer', async () => {
    server.use(
      http.post('http://localhost/api/ai/dispatch', () =>
        new HttpResponse(
          sse(
            'event: thinking\ndata: {"chunk":"pondering"}\n\n',
            'event: text\ndata: {"chunk":"Hello"}\n\n',
            'event: done\ndata: {"model":"fake-1","interrupted":false,"reasoningSteps":[]}\n\n',
          ),
          { headers: { 'Content-Type': 'text/event-stream' } },
        ),
      ),
    );
    expect(useUiStore.getState().reasoningDrawerOpen).toBe(false);
    render(<ChatView />);
    await userEvent.type(screen.getByRole('textbox'), 'hi{Enter}');
    await waitFor(() => {
      expect(useUiStore.getState().reasoningDrawerOpen).toBe(true);
    });
  });
```

- [ ] **Step 2: Run test**

```bash
npx vitest run src/components/chat/ChatView.test.tsx
```

Expected: PASS (4 tests now).

- [ ] **Step 3: Commit**

```bash
git add src/components/chat/ChatView.test.tsx
git commit -m "test(slice-3): ChatView event:thinking auto-opens drawer"
```

---

## Phase J — App wire

### Task J1: mount `ReasoningDrawer` + initFromStorage

**Files:**
- Modify: `src/App.tsx`
- Modify: `src/App.test.tsx`

- [ ] **Step 1: Modify App.tsx**

`src/App.tsx`:
```tsx
import { useEffect, useState } from 'react';
import { AppShell } from '@/src/components/layout/AppShell';
import { TopBar } from '@/src/components/layout/TopBar';
import { Sidebar } from '@/src/components/layout/Sidebar';
import { DialogHost } from '@/src/components/layout/DialogHost';
import { SessionsSection } from '@/src/components/sidebar/SessionsSection';
import { SystemProtocolSection } from '@/src/components/sidebar/SystemProtocolSection';
import { SkillsSection } from '@/src/components/sidebar/SkillsSection';
import { ToolsSection } from '@/src/components/sidebar/ToolsSection';
import { McpServersSection } from '@/src/components/sidebar/McpServersSection';
import { ConnectionFooter } from '@/src/components/sidebar/ConnectionFooter';
import { ChatView } from '@/src/components/chat/ChatView';
import { ReasoningDrawer } from '@/src/components/reasoning/ReasoningDrawer';
import { useContextStore } from '@/src/stores/context.store';
import { useSessionsStore } from '@/src/stores/sessions.store';
import { useUiStore } from '@/src/stores/ui.store';

export default function App() {
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const initContext = useContextStore((s) => s.init);
  const initSessions = useSessionsStore((s) => s.init);
  const initUi = useUiStore((s) => s.initFromStorage);

  useEffect(() => {
    initContext();
    initSessions();
    initUi();
  }, [initContext, initSessions, initUi]);

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
            <SessionsSection />
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
      <ReasoningDrawer />
    </>
  );
}
```

- [ ] **Step 2: Update App.test.tsx**

`src/App.test.tsx`:
```tsx
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import App from './App';
import { useChatStore } from '@/src/stores/chat.store';
import { useContextStore } from '@/src/stores/context.store';
import { useSessionsStore } from '@/src/stores/sessions.store';
import { useUiStore } from '@/src/stores/ui.store';

beforeEach(() => {
  useChatStore.getState()._reset();
  useContextStore.getState()._reset();
  useSessionsStore.getState()._reset();
  useUiStore.getState()._reset();
  localStorage.clear();
});

describe('App', () => {
  it('renders sidebar with SessionsSection, ChatView present after init', async () => {
    render(<App />);
    expect(screen.getByText('AETHER_CORE')).toBeInTheDocument();
    expect(screen.getByText(/Sessions/i)).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByPlaceholderText(/Scrivi un messaggio/i)).toBeInTheDocument();
    });
  });

  it('mounts ReasoningDrawer (closed by default)', () => {
    render(<App />);
    // drawer should NOT be visible by default (returns null when closed)
    expect(screen.queryByRole('complementary', { name: /reasoning/i })).not.toBeInTheDocument();
  });

  it('opens ReasoningDrawer when ui.store flips', async () => {
    render(<App />);
    useUiStore.getState().openReasoningDrawer();
    await waitFor(() => {
      expect(screen.getByRole('complementary', { name: /reasoning/i })).toBeInTheDocument();
    });
  });
});
```

- [ ] **Step 3: Run App tests**

```bash
npx vitest run src/App.test.tsx
```

Expected: PASS (3 tests).

- [ ] **Step 4: Run full frontend suite**

```bash
npx vitest run src
```

Expected: ALL PASS.

- [ ] **Step 5: Lint**

```bash
npm run lint
```

Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add src/App.tsx src/App.test.tsx
git commit -m "feat(slice-3): mount ReasoningDrawer + initFromStorage in App"
```

---

## Phase K — E2E

### Task K1: Playwright thinking smoke + server bootstrap

**Files:**
- Modify: `server/index.ts` (FakeProvider thoughtChunks)
- Modify: `e2e/smoke.spec.ts`

- [ ] **Step 1: Modify server/index.ts FakeProvider config**

In `server/index.ts`, find the `FakeProvider` instantiations and add `thoughtChunks`. The relevant blocks (both the `cfg.fakeProvider` branch and the missing-API-key fallback):

Locate:
```ts
provider = new FakeProvider({
  chunks: ['pong'],
  chunkDelayMs: 50,
  model: 'fake-1',
});
```
Replace with:
```ts
provider = new FakeProvider({
  chunks: ['pong'],
  thoughtChunks: ['thinking about it…'],
  chunkDelayMs: 50,
  model: 'fake-1',
});
```

And locate:
```ts
provider = new FakeProvider({ chunks: ['pong'], chunkDelayMs: 50 });
```
Replace with:
```ts
provider = new FakeProvider({ chunks: ['pong'], thoughtChunks: ['thinking about it…'], chunkDelayMs: 50 });
```

- [ ] **Step 2: Append Playwright test**

In `e2e/smoke.spec.ts` append:
```ts
test('reasoning: thinking on emits steps + opens drawer', async ({ page, request }) => {
  // clean session state for determinism
  const list = await request.get('/api/sessions').then((r) => r.json());
  for (const s of (list.sessions as { id: string }[])) {
    await request.delete(`/api/sessions/${s.id}`);
  }
  await page.addInitScript(() => {
    localStorage.removeItem('aether.activeSessionId');
  });

  await page.goto('/');
  // enable thinking
  await page.getByRole('button', { name: /toggle thinking/i }).click();

  const input = page.getByPlaceholder(/Scrivi un messaggio/i);
  await input.fill('think');
  await input.press('Enter');

  // drawer auto-opens on first thinking chunk
  await expect(page.getByRole('complementary', { name: /reasoning/i })).toBeVisible({ timeout: 5000 });
  // at least one reasoning step card appears (any of context/dispatch/validation badges)
  await expect(page.getByText(/context|dispatch|validation/i).first()).toBeVisible({ timeout: 5000 });
});
```

- [ ] **Step 3: Run Playwright**

```bash
npx playwright test
```

Expected: PASS (6 tests now: 5 from slice 2b + this one).

If the new test fails, try common diagnostics:
1. Ensure FakeProvider truly emits thoughtChunks. The `req.thinking` flag must be `true` — verify by adding a console.log in the FakeProvider temporarily.
2. If the `Toggle thinking` button is matched ambiguously, use a more specific selector: `page.getByRole('button', { name: /toggle thinking/i }).first()`.
3. If `complementary` role isn't found, the drawer may render with a different role; inspect with `await page.pause()` (only locally).

- [ ] **Step 4: Commit**

```bash
git add server/index.ts e2e/smoke.spec.ts
git commit -m "test(slice-3): playwright thinking smoke + FakeProvider thoughtChunks in bootstrap"
```

---

## Phase L — Final verification + PR

### Task L1: Verify all green + push + PR

- [ ] **Step 1: Lint**

```bash
npm run lint
```

Expected: PASS.

- [ ] **Step 2: Vitest full**

```bash
npm run test:run
```

Expected: ALL PASS. Report file+test count.

- [ ] **Step 3: Coverage**

```bash
npm run test:coverage
```

Expected: PASS, all 80% thresholds met.

If a folder fails (most likely `src/stores/**` if `ui.store` error paths uncovered, or `server/domain/**` if some reasoning.tracer branches uncovered), add targeted tests in commits like `test(slice-3): cover X path`. Do not lower thresholds.

- [ ] **Step 4: Playwright**

```bash
npx playwright test
```

Expected: PASS (6 tests).

- [ ] **Step 5: Branch summary**

```bash
git log main..HEAD --oneline
```

- [ ] **Step 6: Push**

```bash
git push -u origin feat/slice-3-reasoning
```

- [ ] **Step 7: Open PR**

```bash
gh pr create --base main --head feat/slice-3-reasoning --title "feat(slice-3): real reasoning steps + Gemini thinking" --body "$(cat <<'EOF'
## Summary

Slice 3 sostituisce i reasoning steps mock con un \`ReasoningTracer\` reale + integrazione thoughts del modello Gemini:

- **Backend** — \`ReasoningTracer\` stateful (one per request) con \`step(type, run)\` (timing automatico, emit SSE) e \`pushExternal\` (per step esterni come thoughts cross-chunk). \`dispatch.service\` orchestra 3-4 step (\`context_fetch\` + \`dispatch\` + \`thinking\` se thoughts presenti + \`validation\`).
- **Provider** — \`ProviderChunk\` esteso con \`'thinking'\` + \`done.usage\`. \`GeminiProvider\` accetta \`thinking?: boolean\` e configura \`thinkingConfig.includeThoughts=true\` + \`thinkingBudget=-1\`; distingue \`part.thought === true\` da answer parts. \`FakeProvider\` supporta \`thoughtChunks\` opzionale (emessi solo se \`req.thinking === true\`).
- **SSE** — Nuovi eventi: \`reasoning_step\` (per ogni step concluso) e \`thinking\` (chunk-by-chunk). \`done\` ora include \`reasoningSteps[]\`.
- **Persistenza** — \`Message.reasoningSteps?\` opzionale dentro \`sessions.json\`. Backward-compat trasparente con messaggi 2a/2b.
- **Frontend** — Nuovo \`useUiStore\` per \`reasoningDrawerOpen\` + \`thinkingEnabled\` (persistito localStorage) + \`focusedMessageId\`. \`useChatStore\` esteso con \`currentReasoning\` live (\`thinkingText\` + \`steps[]\`).
- **UI** — \`ReasoningDrawer\` overlay a destra (focus resolution: \`focusedMessageId > streamingId > lastAssistant\`). Auto-apre al primo \`event:thinking\`. \`MessageBubble\` mostra \`💭 thinking…\` durante stream + \`🧠 N steps\` post-done (click apre drawer focalizzato). \`MessageInput\` ha un Brain icon toggle per thinking mode.
- **Metrics** — \`durationMs\` sempre misurato via \`performance.now()\` server-side. \`tokens\` da \`usageMetadata.totalTokenCount\` quando Gemini lo espone. \`confidence\` omesso (\`ConfidenceBar\` pronto per future).
- **E2E** — \`AETHER_FAKE_PROVIDER=1\` boot configura \`thoughtChunks: ['thinking about it…']\`, garantendo path thinking deterministico.

## Numeri

- ~22 commit TDD su \`feat/slice-3-reasoning\`
- Tests verdi (totale post-3 inclusi 2a/2b/3); Playwright 6 (5 + 1 nuovo)
- Coverage: tutte le soglie 80% per folder rispettate
- Lint: clean

## Out-of-scope (intenzionalmente differiti)

- \`thinkingBudget\` configurabile (slider) — sempre \`-1\` (auto)
- \`mcp_query\` step (slice 7)
- \`logic\` step (no current source)
- \`subAgent\` valorizzato (slice 6)
- \`confidence\` numerico (\`ConfidenceBar\` placeholder UI ready)
- Reasoning storage in file separato (resta dentro \`Message\`)
- Detection automatica del modello "thinking-capable" (se utente abilita thinking ma il modello non lo supporta → niente thoughts, UX degradata ma non rotta)

## Riferimenti

- Spec: \`docs/superpowers/specs/2026-05-18-aether-slice-3-reasoning-design.md\`
- Plan: \`docs/superpowers/plans/2026-05-18-aether-slice-3-reasoning.md\`

## Test plan

- [x] Backend unit (reasoning.tracer step()+pushExternal()+finalSteps(), provider chunks/usage, dispatch.service tracer integration, provider error preserves partial steps)
- [x] Frontend unit (ui.store + persistence, chat.store currentReasoning, useStreamingDispatch thinking/reasoning_step/body.thinking, ReasoningDrawer focus resolution, ReasoningStepCard duration/tokens formatting, MessageBubble badges, MessageInput brain toggle)
- [x] Integration ChatView + App con MSW
- [x] Playwright thinking smoke con FakeProvider thoughtChunks
- [x] Manual: thinking mode con \`AETHER_FAKE_PROVIDER=1\`
- [x] Manual: Gemini reale con \`GEMINI_API_KEY\` + modello thinking-capable

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

Expected: PR URL printed.

---

## Riepilogo task → commit

| # | Task | Commit message prefix |
|---|---|---|
| A1 | Branch | (no commit) |
| B1 | reasoning.types + schema | `feat(slice-3): add ReasoningStep types + zod schema` |
| B2 | ReasoningTracer | `feat(slice-3): add ReasoningTracer` |
| C1 | provider.types V3 | `feat(slice-3): extend ProviderChunk with thinking + done.usage` |
| C2 | FakeProvider thoughtChunks | `feat(slice-3): FakeProvider supports thoughtChunks + done.usage` |
| C3 | GeminiProvider thinkingConfig | `feat(slice-3): GeminiProvider supports thinkingConfig + part.thought` |
| D1 | Message.reasoningSteps schema | `feat(slice-3): Message.reasoningSteps? optional` |
| D2 | history.store reasoningSteps test | `test(slice-3): history.store preserves reasoningSteps` |
| E1 | dispatch.service tracer | `feat(slice-3): dispatch.service integrates ReasoningTracer` |
| E2 | dispatch.routes thinking test | `test(slice-3): dispatch.routes forwards thinking` |
| F1 | reasoning.types FE | `feat(slice-3): re-export ReasoningStep types to frontend` |
| F2 | dispatch.api body.thinking | `feat(slice-3): dispatch.api body includes optional thinking` |
| F3 | useUiStore | `feat(slice-3): add useUiStore` |
| F4 | useChatStore currentReasoning | `feat(slice-3): useChatStore +currentReasoning + reasoning actions` |
| G1 | useStreamingDispatch | `feat(slice-3): useStreamingDispatch handles thinking/reasoning_step` |
| H1 | leaf components | `feat(slice-3): add ConfidenceBar + DispatchBranch + LiveThinkingBlock` |
| H2 | ReasoningStepCard | `feat(slice-3): add ReasoningStepCard` |
| H3 | ReasoningDrawer | `feat(slice-3): add ReasoningDrawer` |
| I1 | MessageBubble badges | `feat(slice-3): MessageBubble adds thinking/steps badges` |
| I2 | MessageInput Brain | `feat(slice-3): MessageInput adds Brain toggle` |
| I3 | ChatView thinking test | `test(slice-3): ChatView event:thinking auto-opens drawer` |
| J1 | App.tsx ReasoningDrawer | `feat(slice-3): mount ReasoningDrawer + initFromStorage in App` |
| K1 | Playwright | `test(slice-3): playwright thinking smoke + FakeProvider thoughtChunks` |
| L1 | PR | (no commit) |

Totale: ~22 commit feature/test + eventuali fix-up coverage.

---

## Note operative

- **`vi.mock('@google/genai', ...)` pattern**: vitest 4.1.6 richiede `vi.fn(function(this){})` non `vi.fn(() => ...)` per costruzioni con `new`. Slice 2a già stabilì questo. Conservato verbatim nei test gemini.provider.

- **Mid-refactor red state**: dopo Task C1 (provider.types V3) potrebbero esserci errori temporanei in fake/gemini fino a C2/C3. Dopo D1 (Message.reasoningSteps in types) potrebbero esserci errori in dispatch.service fino a E1. Documentato in ogni task quando applicabile. Lint pulito ritorna a fine Phase E (task E2).

- **`performance.now()` vs `Date.now()`**: il tracer usa `performance.now()` per `durationMs` (monotonico, immune a system clock changes) e `Date.now()` per `timestamp` (assoluto, per display + ordinamento globale). Documentato nello spec.

- **`useShallow` per `messages` in ReasoningDrawer**: il drawer subscribe a `messages` per `useMemo(findLastAssistant)`. Senza `useShallow`, ogni `appendChunk` durante streaming forza il re-render del drawer perché il messages array cambia identity. `useShallow` confronta per shallow-equality, evitando il re-render se solo il contenuto di un messaggio è cambiato (la lista di id è la stessa).

- **Cover gap `dispatch.service.ts` da slice 2a**: lo `provider.stream` error path in classifyError ha già coverage da tests di slice 2a. Le nuove modifiche in slice 3 mantengono la stessa logica; il test E1 "persists partial reasoningSteps on provider error" copre il nuovo behavior (steps preservation).

- **Toast system NON aggiunto**: lo spec lo conferma. Errori UI restano nel pattern `useSessionsStore.error` (slice 2b) e inline error footer in MessageBubble (slice 2a). Nessuna regressione su questo fronte.

- **Lucide-react `Brain` icon**: presente nella versione 0.546.0 installata (verificato durante design). Se in un'iterazione futura lucide non lo esportasse, sostituire con un SVG custom.
