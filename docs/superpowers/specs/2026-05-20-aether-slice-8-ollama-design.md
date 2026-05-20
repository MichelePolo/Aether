# Aether — Slice 8: Ollama Provider + Multi-Provider Selection (Design)

**Branch:** `feat/slice-8-ollama`
**Date:** 2026-05-20
**Depends on:** slices 0–7.

## Goal

Ship Ollama as a runtime alternative to Gemini, with a TopBar dropdown that lets the user pick any installed Gemini/Ollama/Fake model. Provider selection is "sticky": changing the selector updates the active session AND becomes the default for *new* sessions; existing sessions keep whatever model they were created with. Function calling (introduced in slice 7) works on Ollama too when the picked model supports it. Concurrent dispatches on different providers run independently.

## Non-goals

- Provider-level config UI (timeouts, custom URLs per provider, request retry policies). `OLLAMA_HOST` is an env var; nothing more.
- Cross-provider conversation continuity heuristics (e.g. summarising long history when switching to a smaller-context model). The user is responsible for picking sensible models.
- An Ollama-specific reasoning emulation (no "Think step by step" prompt prefix; the Brain button is disabled when the provider lacks native thinking).
- Per-message provider override. Provider is per-session, not per-message.
- Streaming partial tool results from Ollama (consistent with slice 7's scope).
- Persistent provider lists in `providers.json`. The registry is built from discovery at boot and refresh; not user-editable through CRUD.

## Decisions log

| # | Decision | Chosen | Rationale |
|---|---|---|---|
| 1 | Provider granularity | `<transport>:<model>` — one registry entry per concrete model | Lets the selector show "Ollama / llama3" vs "Ollama / mistral" cleanly; matches how multi-model providers are exposed in Cursor / Continue.dev |
| 2 | Discovery | Dynamic at boot (Ollama `/api/tags`, Gemini hardcoded, Fake always present) + manual refresh | Fits the way users install Ollama models post-boot |
| 3 | Function calling on Ollama | Yes — forward `mcpTools` as Ollama's `tools` array | Slice 7's MCP loop should work on the local stack too; uniform UX |
| 4 | Thinking capability | Provider exposes `capabilities.thinking: boolean`; Brain button disabled when false | Honest UX; no fake thinking on models that lack it |
| 5 | Selector semantics | Sticky model — active session updated + default for new sessions; existing sessions untouched | User decision recorded 2026-05-19 (memory file `slice-8-provider-selection.md`) |
| 6 | Persistence | Session.providerName in `sessions.json`; `aether.defaultProvider` in localStorage | Survives reload; no new store |
| 7 | Provider name format | `<transport>:<model>` — same string in request body, session metadata, localStorage, registry keys | One canonical form everywhere; no parsing surprises |
| 8 | Bootstrap dep wiring | `DispatchService.deps.providers: ProviderRegistry` (no single `provider`) | Avoids the slice-6 bug where a dep was declared but not threaded through — see [[slice-6-subagent-dispatch-wiring]] |
| 9 | Concurrency model | Each dispatch holds its own provider reference + AbortSignal; providers are stateless | Registry returns the same instance to every caller; no shared mutable state |
| 10 | Refresh strategy | `POST /api/providers/refresh` rebuilds the registry; in-flight dispatches keep their captured references | Clean swap without disrupting running streams |
| 11 | Ollama host | `OLLAMA_HOST` env var, default `http://localhost:11434` | Standard Ollama convention |
| 12 | Tool name mapping | Ollama accepts `.` in tool names — no `__` rewrite (unlike Gemini) | One less translation layer to test |
| 13 | E2E coverage | Ollama provider NOT exercised in Playwright; unit-tested with mocked fetch | CI can't reliably run Ollama; provider switch path covered by integration test |
| 14 | Breaking change | `DispatchServiceDeps.provider: AIProvider` → `providers: ProviderRegistry`. Every existing test that builds a `DispatchService` (slice 2a, 2b, 3, 6, 7) needs migration to pass a small registry — typically a one-line helper that wraps a `FakeProvider` into a stub `ProviderRegistry`. The plan will include that helper as Phase B foundation work | Centralising provider lookup is the whole point; preserving the old single-provider API would defeat it |

## Architecture

### Library

No new third-party deps. Ollama's API is plain HTTP+NDJSON; we use `fetch` + a small line-buffered reader (the same pattern as the SSE parser from slice 0).

### Backend (`server/`)

| Path | Role |
|---|---|
| `domain/providers/registry.ts` | `ProviderRegistry` — owns `Record<string, AIProvider>`, exposes `get/list/describe/refresh/defaultName` |
| `domain/providers/registry.test.ts` | Unit tests with stubbed discovery |
| `domain/providers/discovery.ts` | Pure functions: `discoverOllama(host)`, `geminiHardcodedModels(apiKey)`, build provider instances |
| `domain/providers/discovery.test.ts` | Unit tests with mocked `fetch` |
| `domain/dispatch/providers/ollama.provider.ts` | `OllamaProvider` implementing `AIProvider`; NDJSON streaming, tool calling |
| `domain/dispatch/providers/ollama.provider.test.ts` | Unit tests with mocked `fetch` |
| `domain/dispatch/providers/provider.types.ts` | **Modify**: `AIProvider` gains `capabilities: ProviderCapabilities` |
| `domain/dispatch/providers/gemini.provider.ts` | **Modify**: declare `capabilities = { thinking: true, toolCalling: true }` |
| `domain/dispatch/providers/fake.provider.ts` | **Modify**: declare `capabilities = { thinking: true, toolCalling: true }` |
| `domain/dispatch/dispatch.service.ts` | **Modify**: `DispatchServiceDeps.providers: ProviderRegistry` (REPLACES `provider: AIProvider`); resolves provider per request |
| `domain/dispatch/dispatch.routes.ts` | **Modify**: `DispatchRequestSchema` adds `providerName?: string` |
| `domain/history/history.types.ts` | **Modify**: `SessionRecord` gains `providerName?: string` |
| `domain/history/history.schema.ts` | **Modify**: schema matches the type |
| `domain/history/history.store.ts` | **Modify**: `create({ providerName? })` stores it; new `setProviderName(id, name)` action |
| `domain/history/history.store.test.ts` | **Modify**: cover new field |
| `routes/providers.routes.ts` | **NEW**: `GET /api/providers`, `POST /api/providers/refresh` |
| `routes/providers.routes.test.ts` | **NEW** |
| `routes/history.routes.ts` (or sessions equivalent) | **Modify**: PATCH endpoint supports `{ providerName }` |
| `routes/history.routes.test.ts` | **Modify**: cover the new PATCH |
| `app.ts` | **Modify**: `AppDeps` gains `providers?: ProviderRegistry`; mount `/api/providers` when present |
| `index.ts` | **Modify**: build `ProviderRegistry`, pass to `DispatchService` AND `createApp` |

### Frontend (`src/`)

| Path | Role |
|---|---|
| `types/provider.types.ts` | **NEW**: re-export `ProviderDescriptor`, `ProviderCapabilities` |
| `lib/api/providers.api.ts` | **NEW**: `list()`, `refresh()` |
| `lib/api/providers.api.test.ts` | **NEW** |
| `stores/providers.store.ts` | **NEW**: Zustand store with `list`, `defaultProvider`, `init`, `refresh`, `setDefault`, `capabilitiesOf(name)` |
| `stores/providers.store.test.ts` | **NEW** |
| `lib/api/sessions.api.ts` | **Modify**: add `setProviderName(id, name)` PATCH |
| `stores/sessions.store.ts` | **Modify**: `create({ providerName? })`, `setProviderName(id, name)` action; rollback on error |
| `stores/sessions.store.test.ts` | **Modify**: cover the new action |
| `test/msw-handlers.ts` | **Modify**: default handlers for `/api/providers`, `/api/providers/refresh`, PATCH for session provider |
| `components/providers/ProviderSelector.tsx` | **NEW**: dropdown in TopBar |
| `components/providers/ProviderSelector.test.tsx` | **NEW** |
| `components/layout/TopBar.tsx` | **Modify**: mount `<ProviderSelector />` |
| `components/layout/TopBar.test.tsx` | **Modify**: assert selector mounted |
| `components/chat/MessageInput.tsx` | **Modify**: read `capabilitiesOf(activeProviderName)`; disable Brain when `thinking: false` |
| `components/chat/MessageInput.test.tsx` | **Modify**: cover disabled-Brain case |
| `hooks/useStreamingDispatch.ts` | **Modify**: include `providerName` in dispatch POST body |
| `App.tsx` | **Modify**: init `useProvidersStore` |
| `App.test.tsx` | **Modify**: reset `useProvidersStore` in `beforeEach` |
| `integration/provider-switch.integration.test.tsx` | **NEW**: switch in TopBar updates active session + default; new session uses default |

### E2E

`e2e/smoke.spec.ts` gains one test: `provider: switch + persists across new session`. Uses the registry entries available in the E2E environment (Fake is guaranteed; Gemini depends on key). The test asserts the selector renders, the user can change the provider, and a new session inherits the new default. Ollama is NOT covered in E2E.

## Types

```ts
// server/domain/dispatch/providers/provider.types.ts (extension)
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

```ts
// server/domain/providers/registry.ts
import type { AIProvider } from '@/server/domain/dispatch/providers/provider.types';

export type ProviderTransport = 'fake' | 'gemini' | 'ollama';

export interface ProviderDescriptor {
  name: string;        // `<transport>:<model>`
  transport: ProviderTransport;
  model: string;
  capabilities: ProviderCapabilities;
  displayName: string; // UI hint
}

export interface ProviderRegistryDeps {
  ollamaHost: string;
  geminiApiKey: string | undefined;
  fakeProvider: AIProvider;
  geminiBuilder: (model: string) => AIProvider;
  ollamaBuilder: (model: string) => AIProvider;
  /** Default name override from env (AETHER_DEFAULT_PROVIDER). */
  defaultOverride?: string;
}

export class ProviderRegistry {
  constructor(deps: ProviderRegistryDeps);
  get(name: string): AIProvider | null;
  list(): ProviderDescriptor[];
  describe(name: string): ProviderDescriptor | null;
  refresh(): Promise<void>;
  defaultName(): string | null;
}
```

```ts
// server/domain/history/history.types.ts (extension)
export interface SessionRecord {
  title: string;
  createdAt: number;
  providerName?: string;
  messages: Message[];
}
```

`history.schema.ts` mirrors with `providerName: z.string().optional()`. Legacy entries without the field still parse.

```ts
// server/domain/dispatch/dispatch.service.ts (extension)
export const DispatchRequestSchema = z.object({
  sessionId: z.string().min(1),
  message: z.string().min(1),
  thinking: z.boolean().optional(),
  providerName: z.string().optional(),
});
```

## Ollama provider

```ts
// server/domain/dispatch/providers/ollama.provider.ts (signature)
export class OllamaProvider implements AIProvider {
  readonly capabilities = { thinking: false, toolCalling: true };
  constructor(opts: { host: string; model: string });
  readonly model: string;
  stream(req: ProviderRequest, signal: AbortSignal): AsyncIterable<ProviderChunk>;
}
```

### Wire format

```
POST ${OLLAMA_HOST}/api/chat
Content-Type: application/json
Body: {
  model,
  messages: [
    { role: 'system', content: systemInstruction },                // if non-empty
    ...history.map(m => ({ role: m.role === 'model' ? 'assistant' : 'user', content: m.text })),
    ...toolResults.flatMap(r => buildToolMessages(r)),              // continuation
    { role: 'user', content: userMessage }
  ],
  tools: mcpTools?.length ? mcpTools.map(toOllamaTool) : undefined,
  stream: true
}
```

`buildToolMessages(r)` produces the Ollama-required pair: the prior assistant `tool_calls` it made, plus the `{ role: 'tool', content: JSON.stringify(output || error) }`. We synthesise the assistant turn from the previous `pendingAssistantText` if present, plus the `tool_calls` we tracked.

Response body is NDJSON. A line-buffered reader feeds parsed objects to a switch:

- `chunk.message.tool_calls`: emit one `function_call` chunk per call (with `randomUUID()` for `callId`).
- `chunk.message.content`: emit `text` chunk.
- `chunk.done === true`: emit `done` chunk with `usage.totalTokens = (prompt_eval_count + eval_count)` when available.

### Tool conversion

```ts
function toOllamaTool(t: ProviderToolDecl) {
  return {
    type: 'function' as const,
    function: {
      name: t.qualifiedName,      // dot allowed
      description: t.description,
      parameters: t.schema,
    },
  };
}
```

### Error classification

| Condition | Result |
|---|---|
| `fetch` throws (host down, ECONNREFUSED) | `Error('Ollama unreachable')`, retryable |
| 404 Not Found (model missing) | `Error('Model X not found on Ollama host')`, non-retryable |
| 4xx other | error message from body, non-retryable |
| 5xx | retryable |
| Socket closed mid-stream | retryable; whatever text streamed so far is preserved (existing dispatch behaviour) |
| Schema mismatch (NDJSON line doesn't parse) | line skipped, warning logged; not fatal |

## Registry + discovery

Discovery is split into pure functions for testability.

```ts
// server/domain/providers/discovery.ts (signatures)
export async function discoverOllama(host: string): Promise<string[]>;
//  → fetch `${host}/api/tags`, returns model names; [] on any failure.

export function geminiHardcodedModels(): string[];
//  → ['gemini-2.0-flash-exp', 'gemini-1.5-pro', 'gemini-1.5-flash'].
//  Updated manually if Google adds models worth supporting.
```

The registry's `refresh()` re-runs both, rebuilds the `Record<string, AIProvider>`, and the next `get(name)` reflects the new state. In-flight dispatches that already called `get()` retain their reference — no torn state.

### Default resolution order

1. `AETHER_DEFAULT_PROVIDER` env var, if it's a key in the registry
2. First `gemini:*` entry, if any
3. First `ollama:*` entry, if any
4. `fake:default` (always present)

## Frontend stores

```ts
// src/stores/providers.store.ts (interface)
interface ProvidersState {
  list: ProviderDescriptor[];
  defaultProvider: string | null;   // hydrated from localStorage
  hydrated: boolean;
  error: string | null;

  init(): Promise<void>;
  refresh(): Promise<void>;
  setDefault(name: string): void;
  capabilitiesOf(name: string | null): ProviderCapabilities | null;
  _reset(): void;
}
```

`init()` runs once on App mount; it GETs `/api/providers`, sets `list`, reads localStorage `aether.defaultProvider`, falls back to `list[0]?.name` if no localStorage entry. `setDefault` writes localStorage immediately.

`useSessionsStore` gains:

```ts
setProviderName(sessionId: string, providerName: string): Promise<void>;
```

Behaviour: optimistic update of local state → PATCH `/api/sessions/:id` → on error, revert + set `error`. Existing rename/delete actions already follow this pattern; mirror it.

## Frontend selector

`ProviderSelector` is a small native `<select>` (or a styled equivalent) mounted in `TopBar` between `ProfilesButton` and the right edge. Display logic:

- Active value = `activeSession.providerName ?? providersStore.defaultProvider`.
- Options come from `providersStore.list`, rendered with `displayName`.
- If the active value isn't in `list` (e.g. Ollama model uninstalled), render it as a disabled option labelled `(unavailable) <name>` and surface a small warning icon.
- A refresh button next to the dropdown calls `providersStore.refresh()`.

`onChange(newName)`:
1. `useSessionsStore.setProviderName(activeId, newName)`
2. `providersStore.setDefault(newName)`

When there's no active session (rare), the change only updates `defaultProvider`.

`MessageInput`'s Brain button reads `providersStore.capabilitiesOf(activeProviderName)?.thinking` — if false, the button is disabled with a tooltip naming the active provider.

## Data flow summary

```
boot
  │
  ▼
build ProviderRegistry → discover ollama, register gemini/fake
  │
  ▼
DispatchService.deps.providers = registry
HTTP routes mounted (/api/providers, PATCH /api/sessions/:id)
  │
  ▼ user opens app
GET /api/providers → providers.store.list
localStorage aether.defaultProvider → providers.store.defaultProvider
  │
  ▼ user picks `ollama:llama3` in TopBar
PATCH /api/sessions/:active { providerName: 'ollama:llama3' }
sessions.store updates locally; defaultProvider updated; localStorage written
  │
  ▼ user sends a message
useStreamingDispatch.send:
  POST /api/ai/dispatch { sessionId, message, providerName: 'ollama:llama3' }
DispatchService.handle:
  registry.get('ollama:llama3') → OllamaProvider instance
  stream + function-call loop (unchanged)
```

## Error handling (cross-cutting)

| Source | Behaviour |
|---|---|
| Selector picks a provider not in registry | Selector marks it `(unavailable)`; dispatch fails fast with `Provider X not available` SSE error |
| Discovery times out at boot | Boot continues without Ollama entries; warning logged |
| `setProviderName` PATCH fails | Optimistic update reverted; sessions.error set; UI shows error pill |
| Refresh fails | providers.store.error set; previous list retained |
| Ollama running but the picked model is uninstalled | Discovery removes it on next refresh; mid-dispatch failures are classified non-retryable with the model-name error |
| Ollama version too old for tool calling | First tool-call dispatch fails; user is responsible for upgrading; we don't attempt detection |
| Multiple concurrent dispatches on the same Ollama model | Each opens its own `fetch` stream; Ollama handles parallelism server-side |

## Persistence

- `data/sessions.json`: each `SessionRecord` now optionally carries `providerName`. Legacy entries (missing the field) fall back to the registry default at dispatch time. No migration step needed.
- `localStorage.aether.defaultProvider`: writes happen synchronously inside `setDefault`. Reads happen during `init`. Clearing localStorage reverts to `list[0]?.name`.
- `env.AETHER_DEFAULT_PROVIDER` (optional): if set, overrides the registry's `defaultName()`. Useful for CI/E2E to pin to `fake:default`.

## Testing

(Enumerated in brainstorming Section 4; reproduced here for completeness.)

### Backend unit
- `discovery.test.ts` — 3 paths: success, unreachable, malformed.
- `registry.test.ts` — list/get/describe/refresh/defaultName precedence (8 cases).
- `ollama.provider.test.ts` — wire format, NDJSON streaming, tool calls in + tool results back, error classification, capabilities (10–12 cases).

### Backend integration (supertest)
- `providers.routes.test.ts` — GET + refresh (4 cases).
- `dispatch.routes.test.ts` (extend) — provider resolution + error path (3 cases).
- `history.routes.test.ts` (extend) — PATCH providerName + persistence (2 cases).

### Frontend unit + component
- `providers.api.test.ts`, `providers.store.test.ts`, `sessions.store.test.ts` (extend), `ProviderSelector.test.tsx`, `MessageInput.test.tsx` (extend), `TopBar.test.tsx` (extend).

### Integration
- `provider-switch.integration.test.tsx` — switch flow + dispatch body assertion + new-session inheritance.

### E2E
- One Playwright test exercising the selector + new-session inheritance. No Ollama-specific E2E.

### Coverage target (≥80%)
`ollama.provider.ts`, `registry.ts`, `discovery.ts`, `providers.routes.ts`, `src/stores/providers.store.ts`, `src/components/providers/ProviderSelector.tsx`.

## Risks

| Risk | Mitigation |
|---|---|
| Ollama API instability across versions | We use only `/api/tags` and `/api/chat`; both have been stable since 0.1.x. Pin tested versions in the spec when a regression is observed. |
| Stateless-provider assumption violated | The registry handle is shared. We document the contract: providers MUST be stateless or re-entrant. Test coverage includes a "two concurrent streams on the same instance" case in `ollama.provider.test.ts`. |
| Refresh races with in-flight dispatch | Dispatches capture the provider reference before the loop starts; refresh rebuilds the map but old references remain valid. |
| User picks an unavailable provider | Selector marks it `(unavailable)`, dispatch fails with a clear message. |
| Sticky semantics confuse users (changes don't propagate to other sessions) | The selector tooltip / label calls this out: "applies to this session and new sessions". |
| Provider name format collisions (`<transport>:<model>` could clash if Ollama ever installs a model with `:` in its tag) | Ollama tags follow `name:tag` (e.g. `llama3:latest`). We use the FULL tag as the model — registry key becomes `ollama:llama3:latest`. The `:` count is parsed as `transport` = first segment, `model` = rest joined. This is safe because the transport prefix is always one of three known values. |

## Definition of Done

- All new BE + FE unit / component / integration tests green.
- `e2e/smoke.spec.ts` has 11 tests (10 existing + 1 new).
- `npm run lint` clean.
- Coverage ≥80% on the new files listed above.
- Manual smoke via `npm run dev` with GEMINI_API_KEY set + an Ollama instance running: TopBar lists Gemini models + installed Ollama models; switching provider updates the active session and persists across reload.
- One PR on `feat/slice-8-ollama` against `main`.
