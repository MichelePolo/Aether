# Aether Slice 8 — Ollama Provider + Multi-Provider Selection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship `OllamaProvider` + a runtime `ProviderRegistry` that the dispatch service consults per request, with a TopBar dropdown for selection and "sticky" semantics (per-session + default-for-new-sessions persistence).

**Architecture:** `ProviderRegistry` replaces the single `provider: AIProvider` constructor arg on `DispatchService`. Discovery is dynamic at boot (Ollama `/api/tags`, Gemini hardcoded list, Fake always present). The dispatch request body carries an optional `providerName`; backend resolves request → `SessionRecord.providerName` → `registry.defaultName()`. Frontend exposes a selector in TopBar; changes PATCH the active session AND update `aether.defaultProvider` in localStorage. Function calling works on Ollama through the existing slice-7 loop (no provider-specific branching outside the `OllamaProvider` itself).

**Tech Stack:** Node `fetch` + line-buffered NDJSON reader (no Ollama SDK dep), zod 4, Zustand 5, MSW 2, Vitest 4.1.6, RTL + user-event, Playwright. Existing `JsonStore`, `useDialog`, `FakeProvider`, `GeminiProvider`.

**Reference spec:** `docs/superpowers/specs/2026-05-20-aether-slice-8-ollama-design.md`

**Branch:** `feat/slice-8-ollama` (already checked out; spec already committed)

**Lavora con un solo branch dall'inizio alla fine; ogni Task termina con un commit verde su questo branch.**

---

## File structure (NEW unless marked MODIFY)

```
server/
  domain/providers/
    registry.ts                                     # NEW
    registry.test.ts                                # NEW
    discovery.ts                                    # NEW
    discovery.test.ts                               # NEW
  domain/dispatch/providers/
    provider.types.ts                               # MODIFY: +capabilities
    gemini.provider.ts                              # MODIFY: declare capabilities
    fake.provider.ts                                # MODIFY: declare capabilities
    ollama.provider.ts                              # NEW
    ollama.provider.test.ts                         # NEW
  domain/dispatch/
    dispatch.service.ts                             # MODIFY: providers: ProviderRegistry
    dispatch.service.test.ts                        # MODIFY: registry-based test fixtures
  domain/history/
    history.types.ts                                # MODIFY: SessionRecord +providerName
    history.schema.ts                               # MODIFY: schema +providerName
    history.store.ts                                # MODIFY: create accepts providerName, +setProviderName
    history.store.test.ts                           # MODIFY: cover new field/action
  routes/
    providers.routes.ts                             # NEW
    providers.routes.test.ts                        # NEW
    history.routes.ts                               # MODIFY: PATCH accepts {providerName}
    history.routes.test.ts                          # MODIFY: cover new PATCH path
    dispatch.routes.ts                              # MODIFY: schema +providerName
    dispatch.routes.test.ts                         # MODIFY: migrate all DispatchService constructions
  app.ts                                            # MODIFY: AppDeps +providers, mount /api/providers
  index.ts                                          # MODIFY: build registry, thread into DispatchService + createApp

src/
  types/
    provider.types.ts                               # NEW
  lib/api/
    providers.api.ts                                # NEW
    providers.api.test.ts                           # NEW
    sessions.api.ts                                 # MODIFY: +setProviderName PATCH
  stores/
    providers.store.ts                              # NEW
    providers.store.test.ts                         # NEW
    sessions.store.ts                               # MODIFY: +setProviderName action
    sessions.store.test.ts                          # MODIFY: cover new action
  test/
    msw-handlers.ts                                 # MODIFY: +/api/providers handlers
  components/providers/
    ProviderSelector.tsx                            # NEW
    ProviderSelector.test.tsx                       # NEW
  components/layout/
    TopBar.tsx                                      # MODIFY: mount ProviderSelector
    TopBar.test.tsx                                 # MODIFY: assert selector mounted
  components/chat/
    MessageInput.tsx                                # MODIFY: capability gating on Brain
    MessageInput.test.tsx                           # MODIFY: cover disabled-Brain case
  hooks/
    useStreamingDispatch.ts                         # MODIFY: include providerName in POST body
  App.tsx                                           # MODIFY: init useProvidersStore
  App.test.tsx                                      # MODIFY: reset useProvidersStore in beforeEach
  integration/
    provider-switch.integration.test.tsx            # NEW

e2e/
  smoke.spec.ts                                     # MODIFY: append provider-switch test
```

---

## Phase A — Pre-flight

### Task A1: Verify branch and clean working tree

- [ ] **Step 1: Confirm branch + clean tree**

```bash
git rev-parse --abbrev-ref HEAD
git status --porcelain
```

Expected: branch is `feat/slice-8-ollama`; second command outputs nothing.

No commit in this task.

---

## Phase B — `AIProvider.capabilities` extension

### Task B1: Add `capabilities` to the provider interface + existing providers

**Files:**
- Modify: `server/domain/dispatch/providers/provider.types.ts`
- Modify: `server/domain/dispatch/providers/gemini.provider.ts`
- Modify: `server/domain/dispatch/providers/fake.provider.ts`

This is the foundation for slice-8 capability gating (Brain disabled on non-thinking providers). Purely additive at the interface level; both existing providers declare full capabilities so behaviour is unchanged.

- [ ] **Step 1: Modify `provider.types.ts`**

Add the `ProviderCapabilities` interface and a `capabilities` property on `AIProvider`. Append near the existing exports:

```ts
export interface ProviderCapabilities {
  thinking: boolean;
  toolCalling: boolean;
}

export interface AIProvider {
  readonly model: string;
  readonly capabilities: ProviderCapabilities;
  stream(req: ProviderRequest, signal: AbortSignal): AsyncIterable<ProviderChunk>;
}
```

(If `AIProvider` already exists, REPLACE its declaration with the version above — don't keep two copies.)

- [ ] **Step 2: Modify `gemini.provider.ts`**

Find the `GeminiProvider` class. Add a public field next to `readonly model`:

```ts
readonly capabilities = { thinking: true, toolCalling: true };
```

- [ ] **Step 3: Modify `fake.provider.ts`**

Add the same field to `FakeProvider`:

```ts
readonly capabilities = { thinking: true, toolCalling: true };
```

- [ ] **Step 4: Run full server suite, expect PASS**

```bash
npx vitest run server
npm run lint
```

Expected: PASS. The new field is purely additive; existing tests are unaffected.

- [ ] **Step 5: Commit**

```bash
git add server/domain/dispatch/providers/provider.types.ts server/domain/dispatch/providers/gemini.provider.ts server/domain/dispatch/providers/fake.provider.ts
git commit -m "feat(slice-8): AIProvider +capabilities (Gemini+Fake = thinking+toolCalling)"
```

---

## Phase C — `SessionRecord.providerName`

### Task C1: Add optional `providerName` to session storage

**Files:**
- Modify: `server/domain/history/history.types.ts`
- Modify: `server/domain/history/history.schema.ts`
- Modify: `server/domain/history/history.store.ts`
- Modify: `server/domain/history/history.store.test.ts`

- [ ] **Step 1: Append failing test to `history.store.test.ts`**

```ts
describe('providerName persistence (slice-8)', () => {
  it('createEmpty accepts an optional providerName and persists it', async () => {
    const store = newStore();
    const meta = await store.createEmpty({ providerName: 'ollama:llama3' });
    const rec = await store.readRecord(meta.id);
    expect(rec?.providerName).toBe('ollama:llama3');
  });

  it('createEmpty without providerName leaves the field undefined', async () => {
    const store = newStore();
    const meta = await store.createEmpty();
    const rec = await store.readRecord(meta.id);
    expect(rec?.providerName).toBeUndefined();
  });

  it('setProviderName updates an existing session', async () => {
    const store = newStore();
    const meta = await store.createEmpty();
    await store.setProviderName(meta.id, 'gemini:gemini-2.0-flash-exp');
    const rec = await store.readRecord(meta.id);
    expect(rec?.providerName).toBe('gemini:gemini-2.0-flash-exp');
  });
});
```

If `readRecord` doesn't already exist on `HistoryStore`, the test should use whatever public accessor the store exposes for the full `SessionRecord`. Read `history.store.ts` to verify. If only `read(id)` exists and returns messages, add a `readRecord` method (or accept the deviation and assert via a different public method).

- [ ] **Step 2: Run, expect FAIL**

```bash
npx vitest run server/domain/history/history.store.test.ts
```

- [ ] **Step 3: Modify `history.types.ts`**

```ts
export interface SessionRecord {
  title: string;
  createdAt: number;
  providerName?: string;
  messages: Message[];
}
```

- [ ] **Step 4: Modify `history.schema.ts`**

Find `SessionRecordSchema` (or equivalent). Add `providerName: z.string().optional()` to the shape.

- [ ] **Step 5: Modify `history.store.ts`**

Extend `createEmpty` to accept an optional opts object:

```ts
async createEmpty(opts?: { providerName?: string }): Promise<SessionMeta> {
  // ... existing logic
  // When constructing the SessionRecord, include providerName if opts?.providerName is set
}
```

Add a new method:

```ts
async setProviderName(id: string, providerName: string): Promise<void> {
  await this.json.update((cur) => {
    const r = cur[id];
    if (!r) throw new NotFoundError(`session ${id}`);
    return { ...cur, [id]: { ...r, providerName } };
  });
}
```

If `HistoryStore` doesn't expose a public way to read the full `SessionRecord` (only messages), add:

```ts
async readRecord(id: string): Promise<SessionRecord | null> {
  const file = await this.json.read();
  return file[id] ?? null;
}
```

- [ ] **Step 6: Run, expect PASS**

```bash
npx vitest run server/domain/history/history.store.test.ts
```

- [ ] **Step 7: Run full server suite + lint**

```bash
npx vitest run server
npm run lint
```

- [ ] **Step 8: Commit**

```bash
git add server/domain/history/
git commit -m "feat(slice-8): SessionRecord +providerName + setProviderName store action"
```

---

## Phase D — Provider discovery (pure)

### Task D1: `discoverOllama` + `geminiHardcodedModels`

**Files:**
- Create: `server/domain/providers/discovery.ts`
- Create: `server/domain/providers/discovery.test.ts`

- [ ] **Step 1: Failing tests `discovery.test.ts`**

```ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { discoverOllama, geminiHardcodedModels } from './discovery';

describe('discoverOllama', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns model names from /api/tags', async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        models: [
          { name: 'llama3:latest' },
          { name: 'mistral:7b' },
        ],
      }),
    } as Response);
    const tags = await discoverOllama('http://localhost:11434');
    expect(tags).toEqual(['llama3:latest', 'mistral:7b']);
  });

  it('returns [] when fetch rejects', async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('ECONNREFUSED'));
    expect(await discoverOllama('http://localhost:11434')).toEqual([]);
  });

  it('returns [] on non-OK response', async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      status: 500,
    } as Response);
    expect(await discoverOllama('http://localhost:11434')).toEqual([]);
  });

  it('returns [] when JSON shape is wrong', async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ broken: true }),
    } as Response);
    expect(await discoverOllama('http://localhost:11434')).toEqual([]);
  });
});

describe('geminiHardcodedModels', () => {
  it('returns a non-empty list of known model names', () => {
    const models = geminiHardcodedModels();
    expect(models.length).toBeGreaterThan(0);
    expect(models).toEqual(expect.arrayContaining(['gemini-2.0-flash-exp']));
  });
});
```

- [ ] **Step 2: Run, expect FAIL (module not found)**

```bash
npx vitest run server/domain/providers/discovery.test.ts
```

- [ ] **Step 3: Implement `discovery.ts`**

```ts
import { z } from 'zod';

const TagsResponse = z.object({
  models: z.array(z.object({ name: z.string() })),
});

export async function discoverOllama(host: string): Promise<string[]> {
  try {
    const res = await fetch(`${host.replace(/\/$/, '')}/api/tags`);
    if (!res.ok) return [];
    const body = await res.json();
    const parsed = TagsResponse.safeParse(body);
    if (!parsed.success) return [];
    return parsed.data.models.map((m) => m.name);
  } catch {
    return [];
  }
}

export function geminiHardcodedModels(): string[] {
  return [
    'gemini-2.0-flash-exp',
    'gemini-1.5-pro',
    'gemini-1.5-flash',
  ];
}
```

- [ ] **Step 4: Run, expect PASS**

```bash
npx vitest run server/domain/providers/discovery.test.ts
```

- [ ] **Step 5: Lint + commit**

```bash
npm run lint
git add server/domain/providers/discovery.ts server/domain/providers/discovery.test.ts
git commit -m "feat(slice-8): provider discovery (Ollama /api/tags + Gemini hardcoded)"
```

---

## Phase E — `ProviderRegistry`

### Task E1: Registry with builder injection

**Files:**
- Create: `server/domain/providers/registry.ts`
- Create: `server/domain/providers/registry.test.ts`

The registry is constructed with builder functions for each transport so tests can pass stubs without spinning up real providers.

- [ ] **Step 1: Failing tests**

```ts
// server/domain/providers/registry.test.ts
import { describe, it, expect, vi } from 'vitest';
import { ProviderRegistry } from './registry';
import type { AIProvider } from '@/server/domain/dispatch/providers/provider.types';

function makeFake(model: string): AIProvider {
  return {
    model,
    capabilities: { thinking: true, toolCalling: true },
    async *stream() { yield { type: 'done' as const }; },
  };
}

describe('ProviderRegistry', () => {
  it('always registers fake:default', async () => {
    const reg = new ProviderRegistry({
      ollamaHost: 'http://localhost:11434',
      geminiApiKey: undefined,
      fakeProvider: makeFake('fake-1'),
      geminiBuilder: () => makeFake('g'),
      ollamaBuilder: () => makeFake('o'),
    });
    await reg.refresh();
    expect(reg.get('fake:default')).not.toBeNull();
  });

  it('registers gemini entries when API key is set', async () => {
    const reg = new ProviderRegistry({
      ollamaHost: 'http://localhost:11434',
      geminiApiKey: 'sk-...',
      fakeProvider: makeFake('fake-1'),
      geminiBuilder: (model) => makeFake(model),
      ollamaBuilder: () => makeFake('o'),
    });
    await reg.refresh();
    expect(reg.get('gemini:gemini-2.0-flash-exp')).not.toBeNull();
  });

  it('skips gemini entries when no API key', async () => {
    const reg = new ProviderRegistry({
      ollamaHost: 'http://localhost:11434',
      geminiApiKey: undefined,
      fakeProvider: makeFake('fake-1'),
      geminiBuilder: () => makeFake('g'),
      ollamaBuilder: () => makeFake('o'),
    });
    await reg.refresh();
    expect(reg.list().find((d) => d.transport === 'gemini')).toBeUndefined();
  });

  it('describes returns the correct displayName', async () => {
    const reg = new ProviderRegistry({
      ollamaHost: 'http://localhost:11434',
      geminiApiKey: undefined,
      fakeProvider: makeFake('fake-1'),
      geminiBuilder: () => makeFake('g'),
      ollamaBuilder: () => makeFake('o'),
    });
    await reg.refresh();
    const d = reg.describe('fake:default');
    expect(d?.displayName).toMatch(/fake/i);
  });

  it('defaultName resolves: env override > gemini > ollama > fake', async () => {
    const reg = new ProviderRegistry({
      ollamaHost: 'http://localhost:11434',
      geminiApiKey: 'sk-...',
      fakeProvider: makeFake('fake-1'),
      geminiBuilder: (model) => makeFake(model),
      ollamaBuilder: () => makeFake('o'),
      defaultOverride: 'gemini:gemini-1.5-flash',
    });
    await reg.refresh();
    expect(reg.defaultName()).toBe('gemini:gemini-1.5-flash');
  });

  it('defaultName falls back to fake when nothing else registered', async () => {
    const reg = new ProviderRegistry({
      ollamaHost: 'http://localhost:11434',
      geminiApiKey: undefined,
      fakeProvider: makeFake('fake-1'),
      geminiBuilder: () => makeFake('g'),
      ollamaBuilder: () => makeFake('o'),
    });
    await reg.refresh();
    expect(reg.defaultName()).toBe('fake:default');
  });
});
```

- [ ] **Step 2: Run, expect FAIL**

```bash
npx vitest run server/domain/providers/registry.test.ts
```

- [ ] **Step 3: Implement `registry.ts`**

```ts
import type { AIProvider, ProviderCapabilities } from '@/server/domain/dispatch/providers/provider.types';
import { discoverOllama, geminiHardcodedModels } from './discovery';

export type ProviderTransport = 'fake' | 'gemini' | 'ollama';

export interface ProviderDescriptor {
  name: string;
  transport: ProviderTransport;
  model: string;
  capabilities: ProviderCapabilities;
  displayName: string;
}

export interface ProviderRegistryDeps {
  ollamaHost: string;
  geminiApiKey: string | undefined;
  fakeProvider: AIProvider;
  geminiBuilder: (model: string) => AIProvider;
  ollamaBuilder: (model: string) => AIProvider;
  defaultOverride?: string;
}

function transportFromName(name: string): ProviderTransport | null {
  const sep = name.indexOf(':');
  if (sep < 0) return null;
  const t = name.slice(0, sep);
  if (t === 'fake' || t === 'gemini' || t === 'ollama') return t;
  return null;
}

function displayNameFor(transport: ProviderTransport, model: string): string {
  if (transport === 'fake') return 'Fake (default)';
  if (transport === 'gemini') return `Gemini / ${model}`;
  return `Ollama / ${model}`;
}

export class ProviderRegistry {
  private entries = new Map<string, { provider: AIProvider; descriptor: ProviderDescriptor }>();

  constructor(private readonly deps: ProviderRegistryDeps) {}

  async refresh(): Promise<void> {
    const next = new Map<string, { provider: AIProvider; descriptor: ProviderDescriptor }>();

    // Always: fake
    {
      const name = 'fake:default';
      next.set(name, {
        provider: this.deps.fakeProvider,
        descriptor: {
          name,
          transport: 'fake',
          model: 'default',
          capabilities: this.deps.fakeProvider.capabilities,
          displayName: displayNameFor('fake', 'default'),
        },
      });
    }

    // Gemini (when key present)
    if (this.deps.geminiApiKey) {
      for (const model of geminiHardcodedModels()) {
        const provider = this.deps.geminiBuilder(model);
        next.set(`gemini:${model}`, {
          provider,
          descriptor: {
            name: `gemini:${model}`,
            transport: 'gemini',
            model,
            capabilities: provider.capabilities,
            displayName: displayNameFor('gemini', model),
          },
        });
      }
    }

    // Ollama (discovery)
    const tags = await discoverOllama(this.deps.ollamaHost);
    for (const tag of tags) {
      const provider = this.deps.ollamaBuilder(tag);
      next.set(`ollama:${tag}`, {
        provider,
        descriptor: {
          name: `ollama:${tag}`,
          transport: 'ollama',
          model: tag,
          capabilities: provider.capabilities,
          displayName: displayNameFor('ollama', tag),
        },
      });
    }

    this.entries = next;
  }

  get(name: string): AIProvider | null {
    return this.entries.get(name)?.provider ?? null;
  }

  list(): ProviderDescriptor[] {
    return [...this.entries.values()].map((e) => e.descriptor);
  }

  describe(name: string): ProviderDescriptor | null {
    return this.entries.get(name)?.descriptor ?? null;
  }

  defaultName(): string | null {
    if (this.deps.defaultOverride && this.entries.has(this.deps.defaultOverride)) {
      return this.deps.defaultOverride;
    }
    for (const e of this.entries.values()) {
      if (e.descriptor.transport === 'gemini') return e.descriptor.name;
    }
    for (const e of this.entries.values()) {
      if (e.descriptor.transport === 'ollama') return e.descriptor.name;
    }
    if (this.entries.has('fake:default')) return 'fake:default';
    return null;
  }
}
```

> **Implementer note:** `transportFromName` is currently unused; remove it if the implementer's linter flags it, or use it in a future helper. Don't keep dead code.

- [ ] **Step 4: Run, expect PASS**

```bash
npx vitest run server/domain/providers/registry.test.ts
```

- [ ] **Step 5: Lint + commit**

```bash
npm run lint
git add server/domain/providers/registry.ts server/domain/providers/registry.test.ts
git commit -m "feat(slice-8): ProviderRegistry (list/get/describe/refresh/defaultName)"
```

---

## Phase F — `OllamaProvider`

### Task F1: NDJSON streaming + tool calling

**Files:**
- Create: `server/domain/dispatch/providers/ollama.provider.ts`
- Create: `server/domain/dispatch/providers/ollama.provider.test.ts`

The provider takes `{ host, model }`, builds `/api/chat` POST requests, and streams NDJSON responses.

- [ ] **Step 1: Failing tests**

```ts
// server/domain/dispatch/providers/ollama.provider.test.ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { OllamaProvider } from './ollama.provider';
import type { ProviderChunk } from './provider.types';

function ndjsonStream(lines: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const line of lines) controller.enqueue(encoder.encode(line + '\n'));
      controller.close();
    },
  });
}

describe('OllamaProvider', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('capabilities = { thinking: false, toolCalling: true }', () => {
    const p = new OllamaProvider({ host: 'http://localhost:11434', model: 'llama3' });
    expect(p.capabilities).toEqual({ thinking: false, toolCalling: true });
  });

  it('streams text chunks from NDJSON message.content', async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      body: ndjsonStream([
        JSON.stringify({ message: { role: 'assistant', content: 'hello ' } }),
        JSON.stringify({ message: { role: 'assistant', content: 'world' } }),
        JSON.stringify({ done: true, eval_count: 5, prompt_eval_count: 3 }),
      ]),
    } as Response);

    const p = new OllamaProvider({ host: 'http://localhost:11434', model: 'llama3' });
    const chunks: ProviderChunk[] = [];
    for await (const c of p.stream(
      { systemInstruction: '', history: [], userMessage: 'hi' },
      new AbortController().signal,
    )) {
      chunks.push(c);
    }
    const text = chunks.filter((c) => c.type === 'text').map((c) => (c as { text: string }).text).join('');
    expect(text).toBe('hello world');
    const done = chunks.find((c) => c.type === 'done');
    expect(done).toEqual({ type: 'done', usage: { totalTokens: 8 } });
  });

  it('emits function_call chunks for tool_calls in the response', async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      body: ndjsonStream([
        JSON.stringify({
          message: {
            role: 'assistant',
            content: '',
            tool_calls: [{ function: { name: 'mock.echo', arguments: { message: 'hi' } } }],
          },
        }),
        JSON.stringify({ done: true }),
      ]),
    } as Response);

    const p = new OllamaProvider({ host: 'http://localhost:11434', model: 'llama3' });
    const chunks: ProviderChunk[] = [];
    for await (const c of p.stream(
      { systemInstruction: '', history: [], userMessage: 'go' },
      new AbortController().signal,
    )) {
      chunks.push(c);
    }
    const fc = chunks.find((c) => c.type === 'function_call');
    expect(fc).toBeTruthy();
    if (fc && fc.type === 'function_call') {
      expect(fc.call.qualifiedName).toBe('mock.echo');
      expect(fc.call.args).toEqual({ message: 'hi' });
      expect(typeof fc.call.callId).toBe('string');
    }
  });

  it('forwards mcpTools as tools array', async () => {
    let captured: unknown = null;
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockImplementation(async (_url: string, init?: RequestInit) => {
      captured = JSON.parse(init?.body as string);
      return {
        ok: true,
        body: ndjsonStream([JSON.stringify({ done: true })]),
      } as Response;
    });

    const p = new OllamaProvider({ host: 'http://localhost:11434', model: 'llama3' });
    const drain = async () => {
      for await (const _ of p.stream(
        {
          systemInstruction: '',
          history: [],
          userMessage: 'go',
          mcpTools: [{ qualifiedName: 'mock.echo', description: 'echo', schema: { type: 'object' } }],
        },
        new AbortController().signal,
      )) { /* drain */ }
    };
    await drain();
    const body = captured as { tools: Array<{ type: string; function: { name: string } }> };
    expect(body.tools[0].function.name).toBe('mock.echo');
  });

  it('on continuation (toolResults present), prepends a tool message', async () => {
    let captured: unknown = null;
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockImplementation(async (_url: string, init?: RequestInit) => {
      captured = JSON.parse(init?.body as string);
      return {
        ok: true,
        body: ndjsonStream([JSON.stringify({ done: true })]),
      } as Response;
    });

    const p = new OllamaProvider({ host: 'http://localhost:11434', model: 'llama3' });
    for await (const _ of p.stream(
      {
        systemInstruction: '',
        history: [],
        userMessage: 'go',
        toolResults: [{
          callId: 'C1',
          qualifiedName: 'mock.echo',
          ok: true,
          output: { message: 'hi' },
        }],
      },
      new AbortController().signal,
    )) { /* drain */ }
    const body = captured as { messages: Array<{ role: string; content?: string }> };
    const toolMsg = body.messages.find((m) => m.role === 'tool');
    expect(toolMsg).toBeTruthy();
    expect(toolMsg?.content).toContain('hi');
  });

  it('rejects with parsed error message on non-OK response', async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      status: 404,
      json: () => Promise.resolve({ error: 'model not found' }),
    } as Response);

    const p = new OllamaProvider({ host: 'http://localhost:11434', model: 'llama3' });
    const drain = async () => {
      for await (const _ of p.stream(
        { systemInstruction: '', history: [], userMessage: 'go' },
        new AbortController().signal,
      )) { /* drain */ }
    };
    await expect(drain()).rejects.toThrow(/model not found/);
  });
});
```

- [ ] **Step 2: Run, expect FAIL**

```bash
npx vitest run server/domain/dispatch/providers/ollama.provider.test.ts
```

- [ ] **Step 3: Implement `ollama.provider.ts`**

```ts
import { randomUUID } from 'node:crypto';
import type {
  AIProvider,
  ProviderRequest,
  ProviderChunk,
  ProviderToolDecl,
  ProviderToolResultMessage,
  ProviderCapabilities,
} from './provider.types';

interface OllamaChatChunk {
  message?: {
    role: 'assistant';
    content: string;
    tool_calls?: Array<{
      function: { name: string; arguments: Record<string, unknown> };
    }>;
  };
  done?: boolean;
  eval_count?: number;
  prompt_eval_count?: number;
}

export interface OllamaProviderOpts {
  host: string;
  model: string;
}

export class OllamaProvider implements AIProvider {
  readonly capabilities: ProviderCapabilities = { thinking: false, toolCalling: true };
  readonly model: string;

  constructor(private readonly opts: OllamaProviderOpts) {
    this.model = opts.model;
  }

  async *stream(req: ProviderRequest, signal: AbortSignal): AsyncIterable<ProviderChunk> {
    const url = `${this.opts.host.replace(/\/$/, '')}/api/chat`;
    const body = buildBody(this.model, req);

    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal,
    });

    if (!res.ok) {
      let errorMessage = `Ollama HTTP ${res.status}`;
      try {
        const errBody = await res.json();
        if (typeof errBody?.error === 'string') errorMessage = errBody.error;
      } catch {
        // ignore body parse failure
      }
      throw new Error(errorMessage);
    }

    if (!res.body) {
      throw new Error('Ollama response has no body');
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = '';

    while (true) {
      if (signal.aborted) {
        try { await reader.cancel(); } catch { /* ignore */ }
        return;
      }
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let idx;
      while ((idx = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, idx).trim();
        buf = buf.slice(idx + 1);
        if (!line) continue;
        let parsed: OllamaChatChunk;
        try {
          parsed = JSON.parse(line) as OllamaChatChunk;
        } catch {
          continue;
        }

        if (parsed.message?.tool_calls) {
          for (const tc of parsed.message.tool_calls) {
            yield {
              type: 'function_call',
              call: {
                callId: randomUUID(),
                qualifiedName: tc.function.name,
                args: tc.function.arguments ?? {},
              },
            };
          }
        }

        if (typeof parsed.message?.content === 'string' && parsed.message.content.length > 0) {
          yield { type: 'text', text: parsed.message.content };
        }

        if (parsed.done) {
          const total = (parsed.prompt_eval_count ?? 0) + (parsed.eval_count ?? 0);
          yield {
            type: 'done',
            usage: total > 0 ? { totalTokens: total } : undefined,
          };
          return;
        }
      }
    }
  }
}

function toOllamaTool(t: ProviderToolDecl) {
  return {
    type: 'function' as const,
    function: {
      name: t.qualifiedName,
      description: t.description,
      parameters: t.schema,
    },
  };
}

function buildToolMessages(r: ProviderToolResultMessage): Array<{
  role: 'tool';
  content: string;
}> {
  const content = r.ok ? JSON.stringify(r.output ?? {}) : JSON.stringify({ error: r.error });
  return [{ role: 'tool', content }];
}

function buildBody(model: string, req: ProviderRequest): unknown {
  const messages: Array<{ role: string; content: string }> = [];
  if (req.systemInstruction.trim().length > 0) {
    messages.push({ role: 'system', content: req.systemInstruction });
  }
  for (const m of req.history) {
    messages.push({
      role: m.role === 'model' ? 'assistant' : 'user',
      content: m.text,
    });
  }
  if (req.pendingAssistantText && req.pendingAssistantText.length > 0) {
    messages.push({ role: 'assistant', content: req.pendingAssistantText });
  }
  for (const r of req.toolResults ?? []) {
    for (const tm of buildToolMessages(r)) messages.push(tm);
  }
  messages.push({ role: 'user', content: req.userMessage });

  return {
    model,
    messages,
    tools: req.mcpTools && req.mcpTools.length > 0 ? req.mcpTools.map(toOllamaTool) : undefined,
    stream: true,
  };
}
```

- [ ] **Step 4: Run, expect PASS**

```bash
npx vitest run server/domain/dispatch/providers/ollama.provider.test.ts
```

- [ ] **Step 5: Lint + commit**

```bash
npm run lint
git add server/domain/dispatch/providers/ollama.provider.ts server/domain/dispatch/providers/ollama.provider.test.ts
git commit -m "feat(slice-8): OllamaProvider (NDJSON streaming + tool calling)"
```

---

## Phase G — `/api/providers` routes

### Task G1: GET + refresh endpoints

**Files:**
- Create: `server/routes/providers.routes.ts`
- Create: `server/routes/providers.routes.test.ts`

- [ ] **Step 1: Failing tests**

```ts
// server/routes/providers.routes.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { createApp } from '@/server/app';
import { ProviderRegistry } from '@/server/domain/providers/registry';
import type { AIProvider } from '@/server/domain/dispatch/providers/provider.types';

function makeFake(model: string): AIProvider {
  return {
    model,
    capabilities: { thinking: true, toolCalling: true },
    async *stream() { yield { type: 'done' as const }; },
  };
}

async function makeApp() {
  const reg = new ProviderRegistry({
    ollamaHost: 'http://localhost:11434',
    geminiApiKey: undefined,
    fakeProvider: makeFake('fake-1'),
    geminiBuilder: () => makeFake('g'),
    ollamaBuilder: () => makeFake('o'),
  });
  await reg.refresh();
  return { app: createApp({ providers: reg }), reg };
}

describe('providers routes', () => {
  let app: Awaited<ReturnType<typeof makeApp>>['app'];
  beforeEach(async () => {
    ({ app } = await makeApp());
  });

  it('GET /api/providers returns at least fake:default', async () => {
    const res = await request(app).get('/api/providers');
    expect(res.status).toBe(200);
    const names = res.body.providers.map((p: { name: string }) => p.name);
    expect(names).toContain('fake:default');
  });

  it('GET /api/providers includes capabilities + displayName', async () => {
    const res = await request(app).get('/api/providers');
    const fake = res.body.providers.find((p: { name: string }) => p.name === 'fake:default');
    expect(fake.capabilities).toEqual({ thinking: true, toolCalling: true });
    expect(fake.displayName).toMatch(/fake/i);
  });

  it('POST /api/providers/refresh re-runs discovery', async () => {
    const res = await request(app).post('/api/providers/refresh');
    expect(res.status).toBe(200);
    expect(res.body.providers).toEqual(expect.any(Array));
  });

  it('GET /api/providers/default returns the registry default name', async () => {
    const res = await request(app).get('/api/providers/default');
    expect(res.status).toBe(200);
    expect(res.body.name).toBe('fake:default');
  });
});
```

- [ ] **Step 2: Run, expect FAIL (createApp doesn't yet accept providers)**

```bash
npx vitest run server/routes/providers.routes.test.ts
```

This is expected — Task H1 wires `providers?` into `AppDeps`.

- [ ] **Step 3: Implement `providers.routes.ts`**

```ts
import { Router, type Request, type Response, type NextFunction } from 'express';
import type { ProviderRegistry } from '@/server/domain/providers/registry';

function asyncHandler(fn: (req: Request, res: Response, next: NextFunction) => Promise<void>) {
  return (req: Request, res: Response, next: NextFunction) => {
    fn(req, res, next).catch(next);
  };
}

export function createProvidersRoutes(registry: ProviderRegistry): Router {
  const router = Router();

  router.get(
    '/',
    asyncHandler(async (_req, res) => {
      res.json({ providers: registry.list() });
    }),
  );

  router.post(
    '/refresh',
    asyncHandler(async (_req, res) => {
      await registry.refresh();
      res.json({ providers: registry.list() });
    }),
  );

  router.get(
    '/default',
    asyncHandler(async (_req, res) => {
      const name = registry.defaultName();
      res.json({ name });
    }),
  );

  return router;
}
```

- [ ] **Step 4: Don't run tests yet (needs Task H1).** Commit the module:

```bash
git add server/routes/providers.routes.ts server/routes/providers.routes.test.ts
git commit -m "feat(slice-8): /api/providers routes module"
```

---

## Phase H — Wire registry into app

### Task H1: `AppDeps.providers` + mount routes + ProviderRegistry instantiation in `index.ts`

**Files:**
- Modify: `server/app.ts`
- Modify: `server/index.ts`

- [ ] **Step 1: Update `server/app.ts`**

Add imports:

```ts
import { createProvidersRoutes } from '@/server/routes/providers.routes';
import type { ProviderRegistry } from '@/server/domain/providers/registry';
```

In `AppDeps`:

```ts
  providers?: ProviderRegistry;
```

In `createApp`, near other conditional mounts:

```ts
  if (deps.providers) {
    app.use('/api/providers', createProvidersRoutes(deps.providers));
  }
```

- [ ] **Step 2: Update `server/index.ts`**

Add imports:

```ts
import { ProviderRegistry } from './domain/providers/registry';
import { OllamaProvider } from './domain/dispatch/providers/ollama.provider';
```

In `bootstrap()`, REPLACE the current provider construction block with:

```ts
const fake = new FakeProvider({
  chunks: ['pong'],
  thoughtChunks: ['thinking about it…'],
  chunkDelayMs: 50,
  model: 'fake-1',
});

const providers = new ProviderRegistry({
  ollamaHost: process.env.OLLAMA_HOST ?? 'http://localhost:11434',
  geminiApiKey: cfg.geminiApiKey || undefined,
  fakeProvider: fake,
  geminiBuilder: (model) => new GeminiProvider({ apiKey: cfg.geminiApiKey, model }),
  ollamaBuilder: (model) =>
    new OllamaProvider({
      host: process.env.OLLAMA_HOST ?? 'http://localhost:11434',
      model,
    }),
  defaultOverride: process.env.AETHER_DEFAULT_PROVIDER || undefined,
});

await providers.refresh();
```

Keep the existing `cfg.fakeProvider` flag for back-compat but it no longer drives the choice of provider — the registry always exposes Fake as a registered option, and `AETHER_FAKE_PROVIDER=1` can be re-interpreted by the implementer as `AETHER_DEFAULT_PROVIDER=fake:default`. If both env vars are set, `AETHER_DEFAULT_PROVIDER` wins.

Pass `providers` to `createApp(...)`:

```ts
const app = createApp({
  contextStore, historyStore, dispatcher,
  profilesStore, subAgentsStore, mcpRegistry,
  providers,
});
```

> NOTE: `dispatcher` still uses the old `provider: AIProvider` shape. Task J1 changes the DispatchService to consume `providers: ProviderRegistry`. For this task, leave the dispatcher construction alone — the breaking change is rolled out in Phase J. After this task lands, the server boots with both the old single `provider` AND the new `providers` registry side-by-side. Both compile; behaviour is unchanged.

If your `GeminiProvider` constructor doesn't accept a `model` opt yet, modify it now to accept one (see slice-7 spec — it already accepted `model?: string`).

- [ ] **Step 3: Verify GeminiProvider accepts `model` in its options**

```bash
grep -n "GeminiProviderOpts\|model?:" server/domain/dispatch/providers/gemini.provider.ts
```

If `model?: string` is already present (it is — slice-2), no change needed. If absent, add it.

- [ ] **Step 4: Run providers route tests**

```bash
npx vitest run server/routes/providers.routes.test.ts
```

Expected: PASS.

- [ ] **Step 5: Run full server suite (no regressions)**

```bash
npx vitest run server
```

Expected: ALL PASS.

- [ ] **Step 6: Lint + commit**

```bash
npm run lint
git add server/app.ts server/index.ts
git commit -m "feat(slice-8): wire ProviderRegistry into createApp + bootstrap"
```

---

## Phase I — Session PATCH supports `providerName`

### Task I1: Extend `PATCH /api/history/:id` schema to accept `{ providerName }`

**Files:**
- Modify: `server/routes/history.routes.ts`
- Modify: `server/routes/history.routes.test.ts`

The existing route accepts `{ title }`. We make the body schema a partial that also accepts `providerName`.

- [ ] **Step 1: Append failing test**

```ts
describe('PATCH /api/history/:id providerName (slice-8)', () => {
  it('accepts providerName and persists it', async () => {
    // Build app following the existing harness in this file.
    // Create session, PATCH with { providerName: 'ollama:llama3' },
    // assert response or follow-up GET shows providerName.
    // If the route returns SessionMeta (without providerName), use store.readRecord
    // for the assertion.
  });

  it('rejects empty body', async () => {
    // PATCH with {} → expect 400.
  });
});
```

The exact harness shape depends on the existing tests. Read the file first.

- [ ] **Step 2: Run, expect FAIL**

```bash
npx vitest run server/routes/history.routes.test.ts
```

- [ ] **Step 3: Modify `history.routes.ts`**

Replace `RenameBody` with a more permissive schema and route logic:

```ts
const PatchBody = z.object({
  title: z.string().optional(),
  providerName: z.string().optional(),
}).refine(
  (b) => b.title !== undefined || b.providerName !== undefined,
  { message: 'At least one field is required' },
);

// In the route handler:
router.patch(
  '/:id',
  asyncHandler(async (req, res) => {
    const parsed = PatchBody.safeParse(req.body);
    if (!parsed.success) throw new ValidationError('Invalid patch payload', parsed.error);
    if (parsed.data.title !== undefined) {
      await store.rename(req.params.id, parsed.data.title);
    }
    if (parsed.data.providerName !== undefined) {
      await store.setProviderName(req.params.id, parsed.data.providerName);
    }
    // Return the updated SessionMeta (rename's return is sufficient if titleed; otherwise re-read)
    const list = await store.listSessions();
    const meta = list.find((m) => m.id === req.params.id);
    if (!meta) {
      res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Session not found' } });
      return;
    }
    res.json(meta);
  }),
);
```

- [ ] **Step 4: Run, expect PASS**

```bash
npx vitest run server/routes/history.routes.test.ts
```

- [ ] **Step 5: Run full server suite + lint**

```bash
npx vitest run server
npm run lint
```

- [ ] **Step 6: Commit**

```bash
git add server/routes/history.routes.ts server/routes/history.routes.test.ts
git commit -m "feat(slice-8): PATCH /api/history/:id accepts providerName"
```

---

## Phase J — Dispatch service uses `ProviderRegistry`

### Task J1: Replace `provider: AIProvider` with `providers: ProviderRegistry` in `DispatchServiceDeps`; migrate existing tests

**Files:**
- Modify: `server/domain/dispatch/dispatch.service.ts`
- Modify: `server/domain/dispatch/dispatch.service.test.ts`
- Modify: `server/routes/dispatch.routes.test.ts`
- Modify: `server/index.ts`

This is the breaking change. Multiple test sites build `new DispatchService({ provider, ... })`; they all need migration.

- [ ] **Step 1: Modify `dispatch.service.ts`**

In `DispatchServiceDeps`, REPLACE:

```ts
provider: AIProvider;
```

with:

```ts
providers: ProviderRegistry;
```

Add import:

```ts
import type { ProviderRegistry } from '@/server/domain/providers/registry';
```

Inside `handle()`, find where `provider` is referenced. Replace with a resolution helper:

```ts
// At the top of handle(), after we have `sessionId` and `req`:
const sessionRecord = await this.deps.historyStore.readRecord(sessionId);
const requestedName = req.providerName;
const sessionName = sessionRecord?.providerName;
const fallbackName = this.deps.providers.defaultName();
const providerName = requestedName ?? sessionName ?? fallbackName;
if (!providerName) {
  sse.event('error', { message: 'No provider available', retryable: false });
  sse.end();
  return;
}
const provider = this.deps.providers.get(providerName);
if (!provider) {
  sse.event('error', { message: `Provider '${providerName}' not available`, retryable: false });
  sse.end();
  return;
}
```

All subsequent `provider.stream(...)` and `provider.model` references continue to work with the resolved `provider` local variable. The dispatch step's title can show `provider.model` (existing behaviour) — that's fine.

- [ ] **Step 2: Modify the request schema**

In `dispatch.service.ts` (or wherever `DispatchRequestSchema` lives), add:

```ts
providerName: z.string().optional(),
```

- [ ] **Step 3: Migrate `dispatch.service.test.ts`**

Read the file. Every `new DispatchService({ provider, ... })` becomes:

```ts
import { ProviderRegistry } from '@/server/domain/providers/registry';

function singleProviderRegistry(provider: AIProvider): ProviderRegistry {
  // Build a tiny registry that exposes ONE provider as fake:default.
  const reg = new ProviderRegistry({
    ollamaHost: 'http://localhost:11434',
    geminiApiKey: undefined,
    fakeProvider: provider,
    geminiBuilder: () => provider,
    ollamaBuilder: () => provider,
  });
  // Synchronously primed: register only fake:default by calling refresh() without
  // network. discovery.ts returns [] on fetch failure, so this is safe.
  return reg;
}
```

Then in each test setup, replace:

```ts
const service = new DispatchService({ provider, historyStore, contextStore /* ... */ });
```

with:

```ts
const providers = singleProviderRegistry(provider);
await providers.refresh();  // registers fake:default
const service = new DispatchService({ providers, historyStore, contextStore /* ... */ });
```

If the test wants to dispatch via a specific provider name, send `providerName: 'fake:default'` in the request body. Otherwise the registry's `defaultName()` (= `fake:default`) takes over.

- [ ] **Step 4: Migrate `dispatch.routes.test.ts`**

Same treatment. Find every `new DispatchService({ provider, ... })` — there are 5+ — and apply the same `singleProviderRegistry` helper. Consider extracting the helper to a shared test util at `server/test/registry.test-helper.ts` to avoid duplication.

If the helper is reused across files, create it as a shared module:

```ts
// server/test/registry.test-helper.ts
import { ProviderRegistry } from '@/server/domain/providers/registry';
import type { AIProvider } from '@/server/domain/dispatch/providers/provider.types';

export async function buildSingleProviderRegistry(provider: AIProvider): Promise<ProviderRegistry> {
  const reg = new ProviderRegistry({
    ollamaHost: 'http://localhost:11434',
    geminiApiKey: undefined,
    fakeProvider: provider,
    geminiBuilder: () => provider,
    ollamaBuilder: () => provider,
  });
  await reg.refresh();
  return reg;
}
```

Tests then `import { buildSingleProviderRegistry } from '@/server/test/registry.test-helper'`.

- [ ] **Step 5: Modify `server/index.ts`**

Now that DispatchService accepts `providers`, change the construction:

```ts
const dispatcher = new DispatchService({
  providers,
  historyStore,
  contextStore,
  subAgentsStore,
  mcpRegistry,
});
```

Remove the now-unused `let provider: AIProvider;` block (the FakeProvider/GeminiProvider conditional) — the registry's builders handle it.

- [ ] **Step 6: Run dispatch tests + full suite**

```bash
npx vitest run server/domain/dispatch server/routes/dispatch.routes.test.ts
npx vitest run server
```

Expected: ALL PASS. Any test that's still passing the old `provider` arg will fail compilation; migrate it.

- [ ] **Step 7: Lint + commit**

```bash
npm run lint
git add server/domain/dispatch/dispatch.service.ts server/domain/dispatch/dispatch.service.test.ts server/routes/dispatch.routes.test.ts server/index.ts server/test/registry.test-helper.ts
git commit -m "feat(slice-8): DispatchService uses ProviderRegistry; migrate all test fixtures"
```

---

## Phase K — FE provider types re-export

### Task K1: `src/types/provider.types.ts`

**Files:**
- Create: `src/types/provider.types.ts`

```ts
export type {
  ProviderTransport,
  ProviderDescriptor,
} from '@/server/domain/providers/registry';

export type {
  ProviderCapabilities,
} from '@/server/domain/dispatch/providers/provider.types';
```

- [ ] **Step 1: Create the file**, lint, commit.

```bash
npm run lint
git add src/types/provider.types.ts
git commit -m "feat(slice-8): re-export provider types to frontend"
```

---

## Phase L — `mcp.api`-style providers client + MSW

### Task L1: `providers.api` + MSW handlers + `sessions.api.setProviderName`

**Files:**
- Create: `src/lib/api/providers.api.ts`
- Create: `src/lib/api/providers.api.test.ts`
- Modify: `src/lib/api/sessions.api.ts`
- Modify: `src/test/msw-handlers.ts`

- [ ] **Step 1: Failing test `providers.api.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { http, HttpResponse } from 'msw';
import { server } from '@/src/test/msw-server';
import { providersApi } from './providers.api';

describe('providersApi', () => {
  it('list returns descriptors', async () => {
    server.use(
      http.get('http://localhost/api/providers', () =>
        HttpResponse.json({
          providers: [{
            name: 'fake:default',
            transport: 'fake',
            model: 'default',
            capabilities: { thinking: true, toolCalling: true },
            displayName: 'Fake (default)',
          }],
        }),
      ),
    );
    const list = await providersApi.list();
    expect(list[0].name).toBe('fake:default');
  });

  it('refresh re-fetches', async () => {
    server.use(
      http.post('http://localhost/api/providers/refresh', () =>
        HttpResponse.json({ providers: [] }),
      ),
    );
    const r = await providersApi.refresh();
    expect(r).toEqual([]);
  });

  it('defaultName returns the server default', async () => {
    server.use(
      http.get('http://localhost/api/providers/default', () =>
        HttpResponse.json({ name: 'fake:default' }),
      ),
    );
    const n = await providersApi.defaultName();
    expect(n).toBe('fake:default');
  });
});
```

- [ ] **Step 2: Run, expect FAIL**

```bash
npx vitest run src/lib/api/providers.api.test.ts
```

- [ ] **Step 3: Implement `providers.api.ts`**

```ts
import type { ProviderDescriptor } from '@/src/types/provider.types';

async function jsonRes<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const msg = (body as { error?: { message?: string } }).error?.message ?? res.statusText;
    throw new Error(msg);
  }
  return (await res.json()) as T;
}

export const providersApi = {
  list: (): Promise<ProviderDescriptor[]> =>
    fetch('/api/providers')
      .then(jsonRes<{ providers: ProviderDescriptor[] }>)
      .then((b) => b.providers),

  refresh: (): Promise<ProviderDescriptor[]> =>
    fetch('/api/providers/refresh', { method: 'POST' })
      .then(jsonRes<{ providers: ProviderDescriptor[] }>)
      .then((b) => b.providers),

  defaultName: (): Promise<string | null> =>
    fetch('/api/providers/default')
      .then(jsonRes<{ name: string | null }>)
      .then((b) => b.name),
};
```

- [ ] **Step 4: Extend `sessions.api.ts`**

Find the existing `sessionsApi`. Add:

```ts
setProviderName: async (id: string, providerName: string): Promise<void> => {
  const res = await fetch(`/api/history/${id}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ providerName }),
  });
  if (!res.ok) throw new Error(res.statusText);
},
```

(Adjust the endpoint path if it differs in the existing code — match the rename endpoint's pattern.)

- [ ] **Step 5: Add MSW handlers in `msw-handlers.ts`**

Append:

```ts
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
```

The PATCH handler for `/api/history/:id` already exists from slice 2b. Verify it accepts `{ providerName }`; if it strictly checks for `{ title }`, relax it or add a new handler.

- [ ] **Step 6: Run tests + lint + commit**

```bash
npx vitest run src/lib/api/providers.api.test.ts src/lib/api
npm run lint
git add src/lib/api/providers.api.ts src/lib/api/providers.api.test.ts src/lib/api/sessions.api.ts src/test/msw-handlers.ts
git commit -m "feat(slice-8): providers.api + MSW handlers + sessions.api.setProviderName"
```

---

## Phase M — `useProvidersStore`

### Task M1: Zustand store

**Files:**
- Create: `src/stores/providers.store.ts`
- Create: `src/stores/providers.store.test.ts`

- [ ] **Step 1: Failing tests**

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { http, HttpResponse } from 'msw';
import { server } from '@/src/test/msw-server';
import { useProvidersStore } from './providers.store';

beforeEach(() => {
  useProvidersStore.getState()._reset();
  localStorage.clear();
});

describe('useProvidersStore', () => {
  it('init fetches the list and defaults to the server default when no localStorage entry', async () => {
    server.use(
      http.get('http://localhost/api/providers', () =>
        HttpResponse.json({
          providers: [
            { name: 'fake:default', transport: 'fake', model: 'default',
              capabilities: { thinking: true, toolCalling: true }, displayName: 'Fake' },
          ],
        }),
      ),
      http.get('http://localhost/api/providers/default', () =>
        HttpResponse.json({ name: 'fake:default' }),
      ),
    );
    await useProvidersStore.getState().init();
    expect(useProvidersStore.getState().defaultProvider).toBe('fake:default');
    expect(useProvidersStore.getState().hydrated).toBe(true);
  });

  it('init prefers localStorage value when present and valid', async () => {
    localStorage.setItem('aether.defaultProvider', 'gemini:gemini-2.0-flash-exp');
    server.use(
      http.get('http://localhost/api/providers', () =>
        HttpResponse.json({
          providers: [
            { name: 'gemini:gemini-2.0-flash-exp', transport: 'gemini', model: 'gemini-2.0-flash-exp',
              capabilities: { thinking: true, toolCalling: true }, displayName: 'Gemini / 2.0 flash' },
          ],
        }),
      ),
      http.get('http://localhost/api/providers/default', () =>
        HttpResponse.json({ name: 'gemini:gemini-2.0-flash-exp' }),
      ),
    );
    await useProvidersStore.getState().init();
    expect(useProvidersStore.getState().defaultProvider).toBe('gemini:gemini-2.0-flash-exp');
  });

  it('falls back to server default when localStorage entry is unavailable in registry', async () => {
    localStorage.setItem('aether.defaultProvider', 'ollama:gone');
    server.use(
      http.get('http://localhost/api/providers', () =>
        HttpResponse.json({
          providers: [
            { name: 'fake:default', transport: 'fake', model: 'default',
              capabilities: { thinking: true, toolCalling: true }, displayName: 'Fake' },
          ],
        }),
      ),
      http.get('http://localhost/api/providers/default', () =>
        HttpResponse.json({ name: 'fake:default' }),
      ),
    );
    await useProvidersStore.getState().init();
    expect(useProvidersStore.getState().defaultProvider).toBe('fake:default');
  });

  it('setDefault writes localStorage', () => {
    useProvidersStore.getState().setDefault('fake:default');
    expect(localStorage.getItem('aether.defaultProvider')).toBe('fake:default');
    expect(useProvidersStore.getState().defaultProvider).toBe('fake:default');
  });

  it('capabilitiesOf returns the descriptor capabilities or null', () => {
    useProvidersStore.setState({
      list: [{
        name: 'ollama:llama3', transport: 'ollama', model: 'llama3',
        capabilities: { thinking: false, toolCalling: true }, displayName: 'Ollama / llama3',
      }],
      defaultProvider: 'ollama:llama3',
      hydrated: true,
      error: null,
    });
    expect(useProvidersStore.getState().capabilitiesOf('ollama:llama3')).toEqual({ thinking: false, toolCalling: true });
    expect(useProvidersStore.getState().capabilitiesOf('not-real')).toBeNull();
  });
});
```

- [ ] **Step 2: Run, expect FAIL**

```bash
npx vitest run src/stores/providers.store.test.ts
```

- [ ] **Step 3: Implement `providers.store.ts`**

```ts
import { create } from 'zustand';
import { providersApi } from '@/src/lib/api/providers.api';
import type { ProviderDescriptor, ProviderCapabilities } from '@/src/types/provider.types';

const STORAGE_KEY = 'aether.defaultProvider';

interface ProvidersState {
  list: ProviderDescriptor[];
  defaultProvider: string | null;
  hydrated: boolean;
  error: string | null;

  init(): Promise<void>;
  refresh(): Promise<void>;
  setDefault(name: string): void;
  capabilitiesOf(name: string | null): ProviderCapabilities | null;
  _reset(): void;
}

const initial = {
  list: [] as ProviderDescriptor[],
  defaultProvider: null as string | null,
  hydrated: false,
  error: null as string | null,
};

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : 'Operation failed';
}

function readStoredDefault(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

function writeStoredDefault(name: string): void {
  try {
    localStorage.setItem(STORAGE_KEY, name);
  } catch {
    // ignore
  }
}

export const useProvidersStore = create<ProvidersState>((set, get) => ({
  ...initial,
  _reset: () => set(initial),

  init: async () => {
    try {
      const [list, serverDefault] = await Promise.all([
        providersApi.list(),
        providersApi.defaultName(),
      ]);
      const stored = readStoredDefault();
      const storedIsAvailable = stored && list.some((p) => p.name === stored);
      const defaultProvider = storedIsAvailable
        ? stored
        : serverDefault && list.some((p) => p.name === serverDefault)
          ? serverDefault
          : list[0]?.name ?? null;
      set({ list, defaultProvider, hydrated: true, error: null });
    } catch (e) {
      set({ hydrated: true, error: errMsg(e) });
    }
  },

  refresh: async () => {
    try {
      const list = await providersApi.refresh();
      set({ list, error: null });
      const current = get().defaultProvider;
      if (current && !list.some((p) => p.name === current)) {
        const serverDefault = await providersApi.defaultName();
        set({ defaultProvider: serverDefault });
      }
    } catch (e) {
      set({ error: errMsg(e) });
    }
  },

  setDefault: (name) => {
    writeStoredDefault(name);
    set({ defaultProvider: name });
  },

  capabilitiesOf: (name) => {
    if (!name) return null;
    return get().list.find((p) => p.name === name)?.capabilities ?? null;
  },
}));
```

- [ ] **Step 4: Run, expect PASS**

```bash
npx vitest run src/stores/providers.store.test.ts
```

- [ ] **Step 5: Lint + commit**

```bash
npm run lint
git add src/stores/providers.store.ts src/stores/providers.store.test.ts
git commit -m "feat(slice-8): useProvidersStore (init/refresh/setDefault/capabilitiesOf)"
```

---

## Phase N — `useSessionsStore.setProviderName`

### Task N1: Add session-level provider mutation

**Files:**
- Modify: `src/stores/sessions.store.ts`
- Modify: `src/stores/sessions.store.test.ts`

- [ ] **Step 1: Append failing test**

```ts
it('setProviderName updates the session optimistically and PATCHes', async () => {
  useSessionsStore.setState({
    sessions: [{ id: 'S1', title: 't', createdAt: 0, updatedAt: 0 }],
    activeSessionId: 'S1',
    hydrated: true,
  });
  let posted: unknown = null;
  server.use(
    http.patch('http://localhost/api/history/S1', async ({ request }) => {
      posted = await request.json();
      return HttpResponse.json({ id: 'S1', title: 't', createdAt: 0, updatedAt: 1 });
    }),
  );
  await useSessionsStore.getState().setProviderName('S1', 'ollama:llama3');
  expect(posted).toEqual({ providerName: 'ollama:llama3' });
  // local state can also track providerName per session — assert if you add the field
});

it('setProviderName rolls back on error', async () => {
  useSessionsStore.setState({
    sessions: [{ id: 'S1', title: 't', createdAt: 0, updatedAt: 0 }],
    activeSessionId: 'S1',
    hydrated: true,
  });
  server.use(
    http.patch('http://localhost/api/history/S1', () =>
      HttpResponse.json({ error: { message: 'Boom' } }, { status: 500 }),
    ),
  );
  await expect(useSessionsStore.getState().setProviderName('S1', 'ollama:llama3')).rejects.toThrow();
  expect(useSessionsStore.getState().error).toBe('Boom');
});
```

If you decide to track `providerName` per session locally (recommended for the TopBar selector to render the right value without re-fetching), extend `SessionMeta` re-export or add a side map. The simplest path: include `providerName?: string` on the local `SessionMeta` shape and update it inside `setProviderName`.

- [ ] **Step 2: Run, expect FAIL**

```bash
npx vitest run src/stores/sessions.store.test.ts
```

- [ ] **Step 3: Add action in `sessions.store.ts`**

Add `setProviderName` to the interface and the implementation:

```ts
setProviderName: async (id, providerName) => {
  const prev = get().sessions;
  const optimistic = prev.map((s) => (s.id === id ? { ...s, providerName } : s));
  set({ sessions: optimistic, error: null });
  try {
    await sessionsApi.setProviderName(id, providerName);
  } catch (e) {
    set({ sessions: prev, error: errMsg(e) });
    throw e;
  }
},
```

If `SessionMeta` doesn't have `providerName` on the FE, extend the local interface (e.g., via a `SessionMetaLocal` type) so the optimistic field has a place to live.

- [ ] **Step 4: Run, expect PASS + suite + lint**

```bash
npx vitest run src/stores/sessions.store.test.ts
npx vitest run src
npm run lint
```

- [ ] **Step 5: Commit**

```bash
git add src/stores/sessions.store.ts src/stores/sessions.store.test.ts src/types/session.types.ts
git commit -m "feat(slice-8): useSessionsStore +setProviderName (optimistic with rollback)"
```

---

## Phase O — `ProviderSelector`

### Task O1: Dropdown component

**Files:**
- Create: `src/components/providers/ProviderSelector.tsx`
- Create: `src/components/providers/ProviderSelector.test.tsx`

- [ ] **Step 1: Failing tests**

```tsx
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ProviderSelector } from './ProviderSelector';
import { useProvidersStore } from '@/src/stores/providers.store';
import { useSessionsStore } from '@/src/stores/sessions.store';

beforeEach(() => {
  useProvidersStore.getState()._reset();
  useSessionsStore.getState()._reset();
});

describe('ProviderSelector', () => {
  it('renders all available providers', () => {
    useProvidersStore.setState({
      list: [
        { name: 'fake:default', transport: 'fake', model: 'default',
          capabilities: { thinking: true, toolCalling: true }, displayName: 'Fake' },
        { name: 'ollama:llama3', transport: 'ollama', model: 'llama3',
          capabilities: { thinking: false, toolCalling: true }, displayName: 'Ollama / llama3' },
      ],
      defaultProvider: 'fake:default',
      hydrated: true,
      error: null,
    });
    render(<ProviderSelector />);
    expect(screen.getByText(/Fake/)).toBeInTheDocument();
    expect(screen.getByText(/Ollama \/ llama3/)).toBeInTheDocument();
  });

  it('reflects active session providerName when present', () => {
    useProvidersStore.setState({
      list: [
        { name: 'fake:default', transport: 'fake', model: 'default',
          capabilities: { thinking: true, toolCalling: true }, displayName: 'Fake' },
        { name: 'ollama:llama3', transport: 'ollama', model: 'llama3',
          capabilities: { thinking: false, toolCalling: true }, displayName: 'Ollama / llama3' },
      ],
      defaultProvider: 'fake:default',
      hydrated: true,
      error: null,
    });
    useSessionsStore.setState({
      sessions: [{ id: 'S1', title: 't', createdAt: 0, updatedAt: 0, providerName: 'ollama:llama3' } as never],
      activeSessionId: 'S1',
      hydrated: true,
    });
    render(<ProviderSelector />);
    const select = screen.getByRole('combobox') as HTMLSelectElement;
    expect(select.value).toBe('ollama:llama3');
  });

  it('onChange calls setProviderName and setDefault', async () => {
    useProvidersStore.setState({
      list: [
        { name: 'fake:default', transport: 'fake', model: 'default',
          capabilities: { thinking: true, toolCalling: true }, displayName: 'Fake' },
        { name: 'ollama:llama3', transport: 'ollama', model: 'llama3',
          capabilities: { thinking: false, toolCalling: true }, displayName: 'Ollama / llama3' },
      ],
      defaultProvider: 'fake:default',
      hydrated: true,
      error: null,
    });
    useSessionsStore.setState({
      sessions: [{ id: 'S1', title: 't', createdAt: 0, updatedAt: 0 }],
      activeSessionId: 'S1',
      hydrated: true,
    });
    const setSpy = vi.spyOn(useSessionsStore.getState(), 'setProviderName').mockResolvedValue(undefined);
    const defSpy = vi.spyOn(useProvidersStore.getState(), 'setDefault');
    const user = userEvent.setup();
    render(<ProviderSelector />);
    await user.selectOptions(screen.getByRole('combobox'), 'ollama:llama3');
    expect(setSpy).toHaveBeenCalledWith('S1', 'ollama:llama3');
    expect(defSpy).toHaveBeenCalledWith('ollama:llama3');
  });

  it('refresh button triggers refresh', async () => {
    useProvidersStore.setState({
      list: [], defaultProvider: null, hydrated: true, error: null,
    });
    const spy = vi.spyOn(useProvidersStore.getState(), 'refresh').mockResolvedValue(undefined);
    const user = userEvent.setup();
    render(<ProviderSelector />);
    await user.click(screen.getByRole('button', { name: /refresh providers/i }));
    expect(spy).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run, expect FAIL**

```bash
npx vitest run src/components/providers/ProviderSelector.test.tsx
```

- [ ] **Step 3: Implement `ProviderSelector.tsx`**

```tsx
import { useProvidersStore } from '@/src/stores/providers.store';
import { useSessionsStore } from '@/src/stores/sessions.store';
import { RefreshCw } from 'lucide-react';

export function ProviderSelector() {
  const list = useProvidersStore((s) => s.list);
  const defaultProvider = useProvidersStore((s) => s.defaultProvider);
  const setDefault = useProvidersStore((s) => s.setDefault);
  const refresh = useProvidersStore((s) => s.refresh);

  const activeId = useSessionsStore((s) => s.activeSessionId);
  const sessions = useSessionsStore((s) => s.sessions);
  const setProviderName = useSessionsStore((s) => s.setProviderName);

  const activeSession = activeId ? sessions.find((s) => s.id === activeId) : null;
  const activeName = (activeSession as { providerName?: string } | null)?.providerName ?? defaultProvider ?? '';

  const handleChange = async (e: React.ChangeEvent<HTMLSelectElement>) => {
    const name = e.target.value;
    if (activeId) await setProviderName(activeId, name).catch(() => {});
    setDefault(name);
  };

  const knownNames = new Set(list.map((p) => p.name));
  const showUnavailable = !!activeName && !knownNames.has(activeName);

  return (
    <div className="ml-2 flex items-center gap-1">
      <select
        aria-label="Active provider"
        value={activeName}
        onChange={handleChange}
        className="bg-surface-3 border border-border-subtle rounded px-1.5 py-0.5 text-[10px] font-mono text-zinc-300"
      >
        {showUnavailable && (
          <option value={activeName} disabled>
            (unavailable) {activeName}
          </option>
        )}
        {list.map((p) => (
          <option key={p.name} value={p.name}>
            {p.displayName}
          </option>
        ))}
      </select>
      <button
        type="button"
        aria-label="Refresh providers"
        onClick={() => refresh().catch(() => {})}
        className="p-1 text-zinc-500 hover:text-white"
      >
        <RefreshCw size={12} />
      </button>
    </div>
  );
}
```

- [ ] **Step 4: Run, expect PASS**

```bash
npx vitest run src/components/providers/ProviderSelector.test.tsx
```

- [ ] **Step 5: Lint + commit**

```bash
npm run lint
git add src/components/providers/ProviderSelector.tsx src/components/providers/ProviderSelector.test.tsx
git commit -m "feat(slice-8): ProviderSelector (dropdown + refresh)"
```

---

## Phase P — TopBar mounts selector

### Task P1: Render `<ProviderSelector />` in `TopBar`

**Files:**
- Modify: `src/components/layout/TopBar.tsx`
- Modify: `src/components/layout/TopBar.test.tsx`

- [ ] **Step 1: Append failing test**

```tsx
it('mounts ProviderSelector', () => {
  render(<TopBar title="X" sidebarOpen onToggleSidebar={() => {}} />);
  expect(screen.getByRole('combobox', { name: /active provider/i })).toBeInTheDocument();
});
```

- [ ] **Step 2: Run, expect FAIL**

```bash
npx vitest run src/components/layout/TopBar.test.tsx
```

- [ ] **Step 3: Modify `TopBar.tsx`**

Import + mount:

```tsx
import { ProviderSelector } from '@/src/components/providers/ProviderSelector';

// Inside the existing JSX, after <ProfilesButton />:
<ProviderSelector />
```

- [ ] **Step 4: Run, expect PASS + lint + commit**

```bash
npx vitest run src/components/layout/TopBar.test.tsx
npm run lint
git add src/components/layout/TopBar.tsx src/components/layout/TopBar.test.tsx
git commit -m "feat(slice-8): TopBar mounts ProviderSelector"
```

---

## Phase Q — `MessageInput` capability gating

### Task Q1: Brain button disabled when provider lacks `thinking`

**Files:**
- Modify: `src/components/chat/MessageInput.tsx`
- Modify: `src/components/chat/MessageInput.test.tsx`

- [ ] **Step 1: Append failing test**

```tsx
it('disables Brain button when active provider lacks thinking capability', () => {
  useProvidersStore.setState({
    list: [{
      name: 'ollama:llama3', transport: 'ollama', model: 'llama3',
      capabilities: { thinking: false, toolCalling: true }, displayName: 'Ollama / llama3',
    }],
    defaultProvider: 'ollama:llama3',
    hydrated: true,
    error: null,
  });
  render(<MessageInput onSend={() => {}} onStop={() => {}} isStreaming={false} />);
  expect(screen.getByRole('button', { name: /toggle thinking/i })).toBeDisabled();
});

it('enables Brain button when active provider supports thinking', () => {
  useProvidersStore.setState({
    list: [{
      name: 'fake:default', transport: 'fake', model: 'default',
      capabilities: { thinking: true, toolCalling: true }, displayName: 'Fake',
    }],
    defaultProvider: 'fake:default',
    hydrated: true,
    error: null,
  });
  render(<MessageInput onSend={() => {}} onStop={() => {}} isStreaming={false} />);
  expect(screen.getByRole('button', { name: /toggle thinking/i })).not.toBeDisabled();
});
```

Make sure `useProvidersStore` is imported and reset in `beforeEach`.

- [ ] **Step 2: Run, expect FAIL**

```bash
npx vitest run src/components/chat/MessageInput.test.tsx
```

- [ ] **Step 3: Modify `MessageInput.tsx`**

Inside the component, read the active provider's capabilities:

```tsx
import { useProvidersStore } from '@/src/stores/providers.store';
import { useSessionsStore } from '@/src/stores/sessions.store';

// In the component body:
const activeId = useSessionsStore((s) => s.activeSessionId);
const sessions = useSessionsStore((s) => s.sessions);
const defaultProvider = useProvidersStore((s) => s.defaultProvider);
const capabilitiesOf = useProvidersStore((s) => s.capabilitiesOf);

const activeProviderName = activeId
  ? (sessions.find((s) => s.id === activeId) as { providerName?: string } | undefined)?.providerName ?? defaultProvider
  : defaultProvider;
const caps = capabilitiesOf(activeProviderName);
const thinkingSupported = caps?.thinking !== false;
```

On the Brain button, add `disabled={!thinkingSupported}` and a `title` attribute when disabled. Keep the existing `aria-label="Toggle thinking mode"` (the tests match `/toggle thinking/i`).

- [ ] **Step 4: Run, expect PASS + suite + lint**

```bash
npx vitest run src/components/chat/MessageInput.test.tsx
npx vitest run src
npm run lint
```

- [ ] **Step 5: Commit**

```bash
git add src/components/chat/MessageInput.tsx src/components/chat/MessageInput.test.tsx
git commit -m "feat(slice-8): MessageInput Brain disabled when provider lacks thinking"
```

---

## Phase R — `useStreamingDispatch` passes `providerName`

### Task R1: Include providerName in dispatch POST body

**Files:**
- Modify: `src/hooks/useStreamingDispatch.ts`

- [ ] **Step 1: Read the hook to find the POST body**

Locate the `fetch('/api/ai/dispatch', { ... })` (or equivalent) call. The body currently includes `{ sessionId, message, thinking? }`. Add `providerName`.

- [ ] **Step 2: Modify**

At the top of the file:

```ts
import { useProvidersStore } from '@/src/stores/providers.store';
import { useSessionsStore } from '@/src/stores/sessions.store';
```

In the `send` function (or wherever the body is built):

```ts
const activeId = useSessionsStore.getState().activeSessionId;
const sessions = useSessionsStore.getState().sessions;
const defaultProvider = useProvidersStore.getState().defaultProvider;
const activeName = activeId
  ? (sessions.find((s) => s.id === activeId) as { providerName?: string } | undefined)?.providerName ?? defaultProvider
  : defaultProvider;

const body = {
  sessionId,
  message,
  thinking,
  ...(activeName ? { providerName: activeName } : {}),
};
```

`useProvidersStore.getState()` and `useSessionsStore.getState()` are called from inside `send` so we always read fresh state (selector subscriptions would cause re-renders but we don't need re-renders for a fire-and-forget POST).

- [ ] **Step 3: Run FE suite + lint**

```bash
npx vitest run src
npm run lint
```

Expected: ALL PASS.

- [ ] **Step 4: Commit**

```bash
git add src/hooks/useStreamingDispatch.ts
git commit -m "feat(slice-8): useStreamingDispatch includes providerName in body"
```

---

## Phase S — App.tsx init

### Task S1: `useProvidersStore.init()` on mount

**Files:**
- Modify: `src/App.tsx`
- Modify: `src/App.test.tsx`

- [ ] **Step 1: Append `useProvidersStore.getState()._reset()` to `beforeEach`**

In `src/App.test.tsx`:

```ts
import { useProvidersStore } from '@/src/stores/providers.store';

// In beforeEach:
useProvidersStore.getState()._reset();
```

- [ ] **Step 2: Modify `src/App.tsx`**

Add import + init action call (mirroring the other init calls):

```tsx
import { useProvidersStore } from '@/src/stores/providers.store';

// Inside the component body, alongside other init selectors:
const initProviders = useProvidersStore((s) => s.init);

// Inside the existing useEffect:
useEffect(() => {
  initContext();
  initSessions();
  initUi();
  initProfiles();
  initSubAgents();
  initProviders();
}, [initContext, initSessions, initUi, initProfiles, initSubAgents, initProviders]);
```

- [ ] **Step 3: Run App tests + full FE suite**

```bash
npx vitest run src/App.test.tsx
npx vitest run src
```

Expected: ALL PASS.

- [ ] **Step 4: Lint + commit**

```bash
npm run lint
git add src/App.tsx src/App.test.tsx
git commit -m "feat(slice-8): App.tsx inits useProvidersStore on mount"
```

---

## Phase T — Integration test

### Task T1: provider-switch.integration.test.tsx

**Files:**
- Create: `src/integration/provider-switch.integration.test.tsx`

- [ ] **Step 1: Write the test**

```tsx
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { server } from '@/src/test/msw-server';
import App from '@/src/App';
import { useUiStore } from '@/src/stores/ui.store';
import { useSessionsStore } from '@/src/stores/sessions.store';
import { useProfilesStore } from '@/src/stores/profiles.store';
import { useContextStore } from '@/src/stores/context.store';
import { useSubAgentsStore } from '@/src/stores/subagents.store';
import { useMcpStore } from '@/src/stores/mcp.store';
import { useProvidersStore } from '@/src/stores/providers.store';

beforeEach(() => {
  useUiStore.getState()._reset();
  useSessionsStore.getState()._reset();
  useProfilesStore.getState()._reset();
  useContextStore.getState()._reset();
  useSubAgentsStore.getState()._reset();
  useMcpStore.getState()._reset();
  useProvidersStore.getState()._reset();
  localStorage.clear();
});

describe('provider switch integration', () => {
  it('selecting a provider PATCHes the active session AND updates the default in localStorage', async () => {
    let patchedBody: unknown = null;
    server.use(
      http.get('http://localhost/api/providers', () =>
        HttpResponse.json({
          providers: [
            { name: 'fake:default', transport: 'fake', model: 'default',
              capabilities: { thinking: true, toolCalling: true }, displayName: 'Fake' },
            { name: 'ollama:llama3', transport: 'ollama', model: 'llama3',
              capabilities: { thinking: false, toolCalling: true }, displayName: 'Ollama / llama3' },
          ],
        }),
      ),
      http.get('http://localhost/api/providers/default', () =>
        HttpResponse.json({ name: 'fake:default' }),
      ),
      http.patch('http://localhost/api/history/:id', async ({ request }) => {
        patchedBody = await request.json();
        return HttpResponse.json({ id: 'S1', title: 't', createdAt: 0, updatedAt: 1 });
      }),
    );

    const user = userEvent.setup();
    render(<App />);

    // Wait for init to complete
    await waitFor(() => expect(useProvidersStore.getState().hydrated).toBe(true));
    await waitFor(() => expect(useSessionsStore.getState().activeSessionId).toBeTruthy());

    // Find the selector and pick the new option
    const select = screen.getByRole('combobox', { name: /active provider/i });
    await user.selectOptions(select, 'ollama:llama3');

    await waitFor(() => {
      expect((patchedBody as { providerName?: string })?.providerName).toBe('ollama:llama3');
    });
    expect(localStorage.getItem('aether.defaultProvider')).toBe('ollama:llama3');
  });
});
```

- [ ] **Step 2: Run, expect PASS**

```bash
npx vitest run src/integration/provider-switch.integration.test.tsx
```

- [ ] **Step 3: Lint + commit**

```bash
npm run lint
git add src/integration/provider-switch.integration.test.tsx
git commit -m "test(slice-8): integration — selector PATCHes session + updates default"
```

---

## Phase U — Playwright e2e

### Task U1: provider switch + new session inheritance

**Files:**
- Modify: `e2e/smoke.spec.ts`

The dev server boots with whatever providers discovery finds. The E2E env sets `AETHER_FAKE_PROVIDER=1` which (after Phase H) is reinterpreted as `AETHER_DEFAULT_PROVIDER=fake:default`. In any case, `fake:default` is always registered. The test asserts the selector renders and shows at least Fake.

- [ ] **Step 1: Append the test**

Append after the existing `mcp:` test:

```ts
test('provider: selector lists Fake; switching persists across new session', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByText('AETHER_CORE')).toBeVisible();

  // Selector is visible
  const selector = page.getByRole('combobox', { name: /active provider/i });
  await expect(selector).toBeVisible();

  // At minimum, fake:default should be available
  await expect(page.getByRole('option', { name: /fake/i })).toBeAttached();

  // Pick fake:default (no-op if already selected) and verify it's the active value
  await selector.selectOption('fake:default');
  await expect(selector).toHaveValue('fake:default');

  // Create a new session via the sidebar
  await page.getByRole('button', { name: /new session/i }).click();

  // Send a message; the FakeProvider replies with "pong"
  const input = page.getByPlaceholder(/Scrivi un messaggio/i);
  await input.fill('ping');
  await input.press('Enter');
  await expect(page.getByText('pong')).toBeVisible({ timeout: 5000 });
});
```

- [ ] **Step 2: Lint + run Playwright**

```bash
npm run lint
npx playwright test e2e/smoke.spec.ts -g "provider:"
```

If port 3000 is occupied, document and skip; otherwise expect PASS.

- [ ] **Step 3: Commit**

```bash
git add e2e/smoke.spec.ts
git commit -m "test(slice-8): playwright — provider selector + Fake reply path"
```

---

## Phase V — Final verification + PR

### Task V1: lint + full vitest + Playwright + push + PR

- [ ] **Step 1: Lint**

```bash
npm run lint
```

- [ ] **Step 2: Vitest**

```bash
npm run test:run
```

Expected: ALL PASS.

- [ ] **Step 3: Coverage spot-check**

```bash
npm run test:coverage
```

Expected: ≥80% on `ollama.provider.ts`, `registry.ts`, `discovery.ts`, `providers.routes.ts`, `src/stores/providers.store.ts`, `src/components/providers/ProviderSelector.tsx`.

- [ ] **Step 4: Playwright (port 3000 expected free)**

```bash
npx playwright test
```

Expected: all PASS.

- [ ] **Step 5: Push**

```bash
git push -u origin feat/slice-8-ollama
```

- [ ] **Step 6: Open PR**

```bash
gh pr create --base main --title "feat(slice-8): Ollama provider + multi-provider selection" --body "$(cat <<'EOF'
## Summary
- New `ProviderRegistry` discovers Gemini (hardcoded list), Ollama (`/api/tags`), and always registers Fake.
- `DispatchService` now takes `providers: ProviderRegistry` (REPLACES `provider: AIProvider`); resolution order: request body → session.providerName → registry default.
- `OllamaProvider` speaks `/api/chat` (NDJSON streaming) with function-calling support; `host` from `OLLAMA_HOST` env (default `http://localhost:11434`).
- `SessionRecord.providerName` persists per-session selection.
- TopBar `<ProviderSelector />` switches the active session AND updates `aether.defaultProvider` localStorage (sticky semantics — does not touch other open sessions).
- Brain button disabled when active provider has `capabilities.thinking === false`.
- `POST /api/providers/refresh` re-runs discovery; in-flight dispatches keep their captured references.

## Test plan
- [x] \`npm run lint\` clean
- [x] \`npm run test:run\` all green
- [x] \`npx playwright test\` all green
- [x] Coverage ≥80% on new modules

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

Expected: PR URL printed.

---

## Definition of Done

- All new BE + FE unit / component / integration tests green.
- `e2e/smoke.spec.ts` has 12 tests (11 existing + 1 new).
- `npm run lint` clean.
- Coverage ≥80% on `ollama.provider.ts`, `registry.ts`, `discovery.ts`, `providers.routes.ts`, `src/stores/providers.store.ts`, `src/components/providers/ProviderSelector.tsx`.
- Manual smoke (`npm run dev` with GEMINI_API_KEY + Ollama instance running): TopBar lists Gemini models + installed Ollama models; switching provider persists across reload; Brain button greys out on Ollama.
- One PR on `feat/slice-8-ollama` against `main`.
