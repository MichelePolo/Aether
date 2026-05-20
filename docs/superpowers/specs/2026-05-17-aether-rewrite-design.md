# Aether — Local Backend + Component-Based Frontend Rewrite

**Date:** 2026-05-17
**Status:** Approved (brainstorming phase)
**Owner:** Michele

## Goal

Trasformare Aether AI Dev Studio da single-component prototype (1125 righe in `App.tsx`, backend con feature mock) in un'applicazione locale completa con:

1. Backend Express modulare che implementa davvero tutte le feature analizzate (reasoning steps reali, sub-agent dispatch, MCP, Ollama local model, persistenza).
2. Frontend React riscritto in componenti riutilizzabili e testabili, con stato gestito da store Zustand.
3. CSS riorganizzato attorno a token semantici Tailwind v4 + componenti primitivi riutilizzabili.
4. Tutto il codice scritto in TDD (red-green-refactor), organizzato in slice verticali (una feature end-to-end alla volta).

## Non-goals

- Multi-utente / autenticazione (interfaccia rimane aperta per futuro, nessuna implementazione ora).
- Deploy in produzione, CI/CD, containerizzazione.
- Integrazione MCP reale (server stdio/HTTP veri): in questa iterazione si fa un mock conforme al protocollo.
- Tool calling/function declarations verso Gemini (il mock MCP esporrà i tool, ma non li registriamo come function declarations).
- Persistenza chat history su disco (rimane in-memory).
- Internazionalizzazione, theming light/dark (rimane il theme dark esistente).

## Design decisions (brainstorming outcome)

| Decision | Choice | Reasoning |
|---|---|---|
| Persistenza | JSON file per context/profili, in-memory per history | Locale + ispezionabile, niente DB overhead. History persistente è non-goal. |
| MCP integration | Mock conforme al protocollo | Permette di costruire l'intero pipeline tool senza dipendere da server esterni. Real arriva dopo. |
| State management FE | Zustand (4 store separati: context, chat, ui, profiles) | Niente provider, hook tipizzati, facili da mockare. Store separati per minimizzare re-render cross-domain. |
| Slicing strategy | Vertical (feature end-to-end per slice) | Progresso visibile presto, ogni commit = feature completa testata. |
| Workflow | Ogni slice = 1 PR/commit dedicato | Review granulare, rollback chirurgico, history pulita. |
| Test framework | Vitest + jsdom + Testing Library + supertest + MSW + Playwright (smoke) | Native a Vite, ecosistema maturo. Playwright solo per smoke E2E. |
| Demolizione App.tsx | Allo Slice 1 (insieme al primo wiring reale) | Slice 0 resta pura fondazione, Slice 1 è la prima vera sostituzione. |
| Authentication | Aperta, non implementata | Uso locale single-user. Hook esistono nella struttura per aggiunta futura. |
| CSS | Tailwind v4 `@theme` + `@layer components` + cva per varianti primitive | Token semantici sostituiscono color codes hardcoded. Cva dà type safety sulle varianti. |

## Architecture

### Backend (`server/`)

```
server/
  index.ts                     # bootstrap: createApp() + Vite middleware + listen
  app.ts                       # factory createApp(deps): testabile senza listen
  config.ts                    # env loader tipato
  routes/
    context.routes.ts          # GET/POST /api/context, POST /bulk
    dispatch.routes.ts         # POST /api/ai/dispatch (SSE)
    mcp.routes.ts              # GET /api/mcp/servers, POST /:id/ping, POST /:id/tools/:tool/call
    profiles.routes.ts         # GET/POST/DELETE /api/profiles
  domain/
    context/
      context.store.ts         # CRUD + persistenza JSON atomica
      context.schema.ts        # zod schemas
      context.types.ts         # Tool, McpServerConfig, AetherContext
    history/
      history.store.ts         # in-memory Map<sessionId, Message[]>
      history.types.ts
    profiles/
      profiles.store.ts        # CRUD + persistenza JSON atomica
      profiles.schema.ts
    dispatch/
      dispatch.service.ts      # orchestrazione (parser → assembler → provider → tracer)
      prompt-assembler.ts      # system instruction da skills+tools+subagent overlay
      subagent.parser.ts       # estrae @AgentName
      reasoning.tracer.ts      # emette step pipeline reali
      providers/
        provider.types.ts      # interfaccia AIProvider comune
        gemini.provider.ts     # @google/genai + thinkingConfig
        ollama.provider.ts     # fetch a http://localhost:11434
    mcp/
      mcp.mock.ts              # MockMcpServer conforme al protocollo
      mcp.registry.ts          # Map<id, MockMcpServer>
      mcp.types.ts
  lib/
    json-store.ts              # read/write atomico (writeFile tmp + rename) + p-queue lock
    sse.ts                     # writeEvent(name, data), writeError, end
    errors.ts                  # AppError, ValidationError, NotFoundError
  test/
    setup.ts
    fixtures/                  # context.json di test, message fixtures
```

**Factory + DI:**
- `createApp({ contextStore, historyStore, profilesStore, dispatcher, mcpRegistry })` ritorna un Express app senza chiamare `listen`.
- `index.ts` istanzia gli store reali (con path da `config.ts`), li passa a `createApp`, e fa `app.listen(PORT)`.
- I test passano store fake/in-memory.

**Persistenza JSON atomica (`lib/json-store.ts`):**
```ts
export class JsonStore<T> {
  constructor(private path: string, private schema: ZodSchema<T>, private defaultValue: T)
  async read(): Promise<T>                     // legge + parse zod (default se mancante)
  async write(value: T): Promise<void>         // write tmp + rename atomico, p-queue lock
  async update(fn: (cur: T) => T): Promise<T>  // read-modify-write
}
```
File salvati in `<repo>/data/`. `data/.gitignore` con `*` (dati locali, non in repo).

**Pipeline dispatch:**
```
POST /api/ai/dispatch
  → req.body validato (zod)
  → dispatch.service.handle(req)
       → reasoning.tracer.start()
       → subagent.parser(message)            → tracer.step('context_fetch', ...)
       → contextStore.read()                  → tracer.step('context_fetch', ...)
       → mcpRegistry.getTools()               → tracer.step('mcp_query', ...)
       → prompt-assembler.assemble(ctx, sub) → systemInstruction
       → provider.stream(req)                 → tracer.step('dispatch', { subAgent })
            └─→ yield chunks { type: 'text' | 'thinking' | 'done' }
       → per ogni chunk: sse.writeEvent('text' | 'thinking', data)
       → al termine: tracer.step('validation', ...), sse.writeEvent('done', { reasoningSteps })
```

**SSE events:**
```
event: reasoning_step   data: { id, type, title, content, confidence, tokens, durationMs, subAgent? }
event: text             data: { chunk: string }
event: thinking         data: { chunk: string }
event: done             data: { reasoningSteps: [...], model: string }
event: error            data: { message: string }
```

**Nota sulla relazione tra `event: thinking` e `ReasoningStep type='thinking'`:**
Sono due cose diverse con scopi complementari:
- `event: thinking` viene emesso durante lo streaming, chunk per chunk, mentre Gemini produce thoughts. Il frontend lo accumula in `chatStore.currentReasoning` per mostrarlo live nell'UI.
- A fine stream, il `reasoning.tracer` emette un `ReasoningStep` finale con `type='thinking'` e `content` = testo thinking completo accumulato. Questo va dentro `message.reasoningSteps[]` e popola lo storico Reasoning View dopo che lo stream è finito.

**AIProvider interface:**
```ts
interface AIProvider {
  stream(req: ProviderRequest): AsyncIterable<ProviderChunk>;
}
type ProviderChunk =
  | { type: 'text'; text: string }
  | { type: 'thinking'; text: string }
  | { type: 'done' };
```

**Sub-agent dispatch:**
- Parser: regex `^@(\w+)\s+(.+)$` → `{ agent, query }`.
- Assembler aggiunge overlay al system instruction: `## SUB-AGENT MODE: <name>\nYou are operating as <name>. Respond focused...`.
- Stesso modello + system instruction modificato. Visibile nel reasoning tracer come `step.subAgent`.

**MCP mock:**
- `MockMcpServer` conforme al protocollo: `listTools()`, `callTool(name, args)`, `ping()`.
- Tipi importati da `@modelcontextprotocol/sdk/types` per garantire conformità.
- Comportamento: tool fittizi con `inputSchema` JSON Schema valido, `callTool` simula latenza casuale + risposta testuale, `ping` random status.

**Ollama provider:**
- POST a `http://localhost:11434/api/chat` con `stream: true`.
- Parsing NDJSON line-by-line.
- Stessa interfaccia AIProvider.

### Frontend (`src/`)

```
src/
  main.tsx                     # entry
  App.tsx                      # shell minimale (~60 righe)
  components/
    ui/                        # primitives (cva variants)
      Button.tsx, IconButton.tsx, Badge.tsx,
      StatusDot.tsx, Panel.tsx, Modal.tsx,
      PromptDialog.tsx, ConfirmDialog.tsx,
      Tooltip.tsx
    layout/
      AppShell.tsx, TopBar.tsx, Sidebar.tsx, DialogHost.tsx
    sidebar/
      SystemProtocolSection.tsx, EnvironmentsSection.tsx,
      SkillsSection.tsx, ToolsSection.tsx, McpServersSection.tsx,
      ConnectionFooter.tsx
    chat/
      ChatView.tsx, MessageList.tsx, MessageBubble.tsx,
      MessageInput.tsx, EmptyState.tsx, StreamingIndicator.tsx
    reasoning/
      ReasoningView.tsx, ReasoningStep.tsx,
      DispatchBranch.tsx, ConfidenceBar.tsx
    mcp/
      McpView.tsx, McpToolCard.tsx, ToolCallDialog.tsx
    command-palette/
      CommandPalette.tsx, CommandItem.tsx, useCommands.ts
    model-config/
      ModelConfigPopover.tsx, RangeSlider.tsx
  hooks/
    useStreamingDispatch.ts    # gestisce SSE + accumula testo + emette eventi
    useKeyboardShortcut.ts
    useAutoScroll.ts           # con flag isUserScrolled
    useDialog.ts               # prompt()/confirm() async via DialogHost
    useClipboard.ts
  stores/
    context.store.ts           # AetherContext + CRUD ottimistico
    chat.store.ts              # messages, isLoading, currentReasoning
    ui.store.ts                # sidebar, activeTab, commandPalette, toasts
    profiles.store.ts          # profili + sync server
  lib/
    api/
      context.api.ts
      profiles.api.ts
      dispatch.api.ts          # createStreamingDispatch() con ReadableStream parser
      mcp.api.ts
    sse-parser.ts              # parser robusto con line buffer
    ids.ts                     # crypto.randomUUID() wrapper
    cn.ts                      # clsx + tailwind-merge
  types/
    context.types.ts           # condivisi via import path comune
    message.types.ts
    reasoning.types.ts
  styles/
    index.css                  # entry: import tailwind + theme + components
    theme.css                  # @theme con token semantici
    components.css             # @layer components (panel, mono-label, badge, ecc.)
  test/
    setup.ts                   # jest-dom, resetStores
    msw-handlers.ts            # default handlers per /api/*
    msw-server.ts
    utils.tsx                  # renderWithProviders, fixture data
```

**Store layout:**
- `useContextStore`: `{ context, isLoading, error, init(), addSkill(name), updateSkill(idx, val), removeSkill(idx), addTool(...), updateTool(...), removeTool(...), addMcpServer(...), removeMcpServer(...), setSystemInstruction(str), bulkOverwrite(ctx) }`
- `useChatStore`: `{ messages, isStreaming, currentReasoning, appendUser(text), startStream(id), appendChunk(id, text), appendReasoningStep(id, step), finishStream(id, finalText, model), failStream(id, error), reset() }`
- `useUiStore`: `{ sidebarOpen, activeTab, commandPaletteOpen, toasts, ...setters, pushToast(t), dismissToast(id) }`
- `useProfilesStore`: `{ profiles, init(), save(name), load(id), delete(id) }`

**SSE parser (`lib/sse-parser.ts`):**
- Input: `ReadableStream<Uint8Array>`.
- Output: `AsyncIterable<{ event: string; data: unknown }>`.
- Line buffer: chunks possono spezzarsi a metà linea o a metà JSON; buffer-a fino a `\n\n` (event separator).
- Test con `ReadableStream` artificiali che emettono chunk spezzati nei posti peggiori.

**Dialog system (rimpiazza `window.prompt/confirm`):**
- `<DialogHost />` in App.tsx ascolta `useDialogStore`.
- `useDialog()` hook esporta `prompt({title, label, defaultValue})`, `confirm({title, message})` che ritornano Promise.
- I componenti chiamano `await dialog.prompt(...)` invece di `window.prompt(...)`.
- Testabili con RTL + user-event.

## Visual & UX

### CSS token (`src/styles/theme.css`)
```css
@theme {
  /* Surfaces */
  --color-surface-0: #080808; --color-surface-1: #0a0a0a;
  --color-surface-2: #0f0f0f; --color-surface-3: #121212;
  --color-surface-4: #1a1a1a; --color-surface-5: #2a2a2a;

  /* Status */
  --color-status-online: #22c55e;
  --color-status-connecting: #eab308;
  --color-status-offline: #71717a;
  --color-status-error: #ef4444;

  /* Borders */
  --color-border-subtle: #27272a;
  --color-border-default: #3f3f46;

  /* Accent */
  --color-accent: #00ff9d;

  /* Fonts */
  --font-sans: "Inter", system-ui, sans-serif;
  --font-mono: "JetBrains Mono", monospace;
}
```

### Component classes (`src/styles/components.css`)
```css
@layer components {
  .panel        { @apply bg-surface-2 border border-border-subtle rounded; }
  .panel-inset  { @apply bg-zinc-900/30 border border-border-subtle/50 rounded; }
  .mono-label   { @apply font-mono text-[10px] uppercase tracking-widest text-zinc-500; }
  .status-dot   { @apply w-1.5 h-1.5 rounded-full; }
  .badge        { @apply text-[9px] px-1.5 py-0.5 rounded-sm font-bold uppercase; }
  .icon-btn     { @apply p-1.5 rounded hover:bg-zinc-800 text-zinc-500 hover:text-white transition-colors; }
}
```

### Primitives variants via cva
Le primitive React (`Button`, `IconButton`, `Badge`, `StatusDot`) usano `cva` per definire varianti tipizzate:
```ts
const badgeVariants = cva("badge", {
  variants: {
    type: {
      logic: "bg-blue-500/10 text-blue-400",
      dispatch: "bg-purple-500/10 text-purple-400",
      validation: "bg-green-500/10 text-green-400",
      default: "bg-zinc-800 text-zinc-500",
    },
  },
  defaultVariants: { type: "default" },
});
```

## Vertical slices

Ogni slice = 1 PR/commit dedicato su branch `feat/slice-N-<name>`. Definition of Done: tutti i test (unit + integration) verdi, `tsc --noEmit` pulito, coverage ≥80% sui moduli BE non-UI, smoke manuale via `npm run dev`, smoke Playwright passa (dallo Slice 0 in poi).

| # | Slice name | Branch | Scope |
|---|---|---|---|
| 0 | Foundation | `feat/slice-0-foundation` | Vitest + Playwright config, theme tokens, primitive UI (`Button`, `IconButton`, `Badge`, `StatusDot`, `Panel`, `Modal`, `PromptDialog`, `ConfirmDialog`, `Tooltip`), `DialogHost` + `useDialog` hook, `JsonStore` lib, `createApp()` factory vuota, errors lib, `sse-parser` lib + test, `tsconfig.json` con `strict: true`/`noUnusedLocals: true`/`noUnusedParameters: true`, smoke E2E placeholder. **Niente feature utente attivate.** App.tsx vecchio resta in piedi. |
| 1 | Context CRUD + persistenza | `feat/slice-1-context-crud` | Routes `/api/context*`, `context.store` (JSON), zod schemas, `useContextStore` Zustand, `Sidebar` + sezioni (`SystemProtocolSection`, `SkillsSection`, `ToolsSection`, `McpServersSection`), `useDialog` per prompt/confirm, `AppShell`, `TopBar`. **Demolisce App.tsx vecchio.** |
| 2 | Chat streaming reale | `feat/slice-2-chat` | `dispatch.routes`, `dispatch.service` (con `FakeProvider` per i test), `gemini.provider`, `history.store`, `useStreamingDispatch` (usa `sse-parser` di slice 0), `useChatStore`, `ChatView`, `MessageList`, `MessageBubble`, `MessageInput`. Streaming Gemini reale. |
| 3 | Reasoning steps reali | `feat/slice-3-reasoning` | `reasoning.tracer`, `thinkingConfig` integration in Gemini provider, eventi SSE `reasoning_step`/`thinking`, `ReasoningView`, `ReasoningStep`, `ConfidenceBar`, `DispatchBranch`. Sostituisce gli step mock. |
| 4 | Profili + import/export | `feat/slice-4-profiles` | `profiles.routes`, `profiles.store` (JSON), `useProfilesStore`, `EnvironmentsSection`, import/export con validazione zod, migrazione da localStorage se presente. |
| 5 | Command palette + shortcuts | `feat/slice-5-cmdk` | `CommandPalette`, `CommandItem`, `useCommands` registry, `useKeyboardShortcut`, integrazione con tutti gli store. Cmd+K, Escape, navigazione tastiera testata con user-event. |
| 6 | Sub-agent dispatch reale | `feat/slice-6-subagent` | `subagent.parser`, `prompt-assembler` con overlay, autocomplete `@` in `MessageInput`, integration test che verificano il system instruction modificato + traccia reasoning con `subAgent` valorizzato. |
| 7 | MCP mock conforme | `feat/slice-7-mcp` | `mcp.mock`, `mcp.registry`, `mcp.routes`, integrazione in `prompt-assembler` (tool listing), `McpView` reale, `McpToolCard`, `ToolCallDialog`. |
| 8 | Ollama provider | `feat/slice-8-ollama` | `ollama.provider`, model selector aggiornato in `TopBar`, parsing NDJSON, integration test con `FakeProvider` + un test E2E con flag skip se Ollama non running. |
| 9 | Sub-agent skills/tools editor | `feat/slice-9-subagent-editor` | Espone editing di `skills`/`tools` per ogni `SubAgentRecord` (il data-model li supporta già da slice 6, ma la `SubAgentsSection` lascia gli array vuoti). Modal o pannello inline con riuso degli `addFlows` di slice 5, `PUT /api/subagents/:id` esistente. Piccolo, opzionale, non bloccante per slice 7/8. |
| 10 | MCP advanced (transports + hardening) | `feat/slice-10-mcp-advanced` | Estende slice 7 con i non-goals esclusi per scope: trasporto HTTP/SSE oltre a stdio; auto-reconnect su crash subprocess (con backoff); refresh discovery senza disconnect; streaming partial results da `tool-call`; cancellazione user mid-call. Tutto in cima al `McpRegistry` + dispatch loop esistente. |

## TDD pattern per slice

```
1. RED   ─ backend unit test (es. context.store.test.ts)
2. GREEN ─ implementazione minima fino a far passare
3. RED   ─ backend integration test con supertest (es. context.routes.test.ts)
4. GREEN ─ wire route + handler
5. RED   ─ frontend store test (vitest) con MSW per mockare API
6. GREEN ─ store + actions
7. RED   ─ frontend component test (RTL + user-event)
8. GREEN ─ componente implementato
9. REFACTOR ─ semplificare, test verdi non si toccano
10. INTEGRATION ─ test slice E2E con MSW + componenti reali
11. SMOKE ─ Playwright test su una golden path
```

## Testing strategy

### Vitest (unit + integration)
- `vitest.config.ts` root con `environmentMatchGlobs` per separare jsdom (`src/**`) e node (`server/**`).
- Setup file: `src/test/setup.ts` (jest-dom, reset stores Zustand) e `server/test/setup.ts`.
- Coverage: `@vitest/coverage-v8`, threshold 80% per `server/domain/*`, `server/lib/*`, `src/hooks/*`, `src/stores/*`, `src/lib/*`. Componenti UI no threshold.

### MSW
- `src/test/msw-handlers.ts` definisce handlers default per `/api/context`, `/api/profiles`, `/api/mcp/*`.
- `/api/ai/dispatch` mockato con `ReadableStream` controllato che emette chunk in sequenza.
- `src/test/msw-server.ts` con `setupServer()` per Node, attivato in `setup.ts`.

### supertest
- `server/test/setup.ts` helper `createTestApp()` che chiama `createApp({...inMemoryStores})`.
- Test endpoint per endpoint, asserzioni su status + body.
- Per dispatch: usa `FakeProvider` (implementa AIProvider, yield chunk noti).

### Playwright (smoke E2E)
- `playwright.config.ts` con un solo project (chromium).
- `e2e/smoke.spec.ts`: avvia app, verifica sidebar visibile, manda messaggio, verifica risposta (con backend Gemini mockato via env var `AETHER_FAKE_PROVIDER=1`).
- Eseguito post-build, non in watch mode.

## Data model (key types)

```ts
// types/context.types.ts
export interface Tool {
  id: string;
  name: string;
  version: string;
  status: 'online' | 'offline';
}

export interface McpServerConfig {
  id: string;
  name: string;
  url: string;
  status: 'online' | 'offline' | 'connecting';
}

export interface AetherContext {
  systemInstruction: string;
  skills: string[];
  tools: Tool[];
  mcpServers: McpServerConfig[];
}

// types/message.types.ts
export interface Message {
  id: string;
  role: 'user' | 'model' | 'system';
  text: string;
  reasoning?: string;
  reasoningSteps?: ReasoningStep[];
  timestamp: number;
  model?: string;
}

// types/reasoning.types.ts
export interface ReasoningStep {
  id: string;
  type: 'context_fetch' | 'mcp_query' | 'dispatch' | 'thinking' | 'validation' | 'logic';
  title: string;
  content: string;
  confidence?: number;
  tokens?: number;
  durationMs?: number;
  subAgent?: string;
  timestamp: number;
}
```

## Risks & mitigations

| Risk | Mitigation |
|---|---|
| SSE chunk boundary bugs ricomparenti | `sse-parser.ts` isolato + test con chunk artificiali spezzati nei posti peggiori. |
| Race condition in store JSON (concorrent writes) | `p-queue` per file, scrittura atomica via tmp+rename. |
| Test flaky su streaming | Usare `FakeProvider` deterministico, no Gemini reale nei test. |
| Demolizione App.tsx genera regressioni | Slice 0 ha tutti i primitivi testati prima della demolizione; Slice 1 riusa la stessa estetica del vecchio. Smoke E2E Playwright cattura regression. |
| cva aggiunge dipendenza | Accettato (1.5KB), in cambio type safety sulle varianti. |
| `thinkingConfig` non disponibile su tutti i modelli Gemini | Feature-detect: se response non ha thought parts, lo step `thinking` è skipped, tracer continua. |
| Mock MCP devia troppo dal protocollo reale | Importare i tipi da `@modelcontextprotocol/sdk/types` per garantire conformità. |

## Conventions (decided)

- `tsconfig.json` abilita `strict: true`, `noUnusedLocals: true`, `noUnusedParameters: true` da Slice 0.
- Test co-locati con il codice: `xxx.test.ts` accanto a `xxx.ts`. I fixture stanno in `test/fixtures/` per backend e `src/test/fixtures/` per frontend.
- Env vars riconosciute dal backend (definite in `server/config.ts`, default in parentesi):
  - `GEMINI_API_KEY` — required per provider Gemini
  - `OLLAMA_URL` — base URL Ollama (default `http://localhost:11434`)
  - `AETHER_DATA_DIR` — directory per file JSON (default `./data`)
  - `AETHER_FAKE_PROVIDER` — se `1`, usa `FakeProvider` invece di Gemini (solo per E2E/dev senza API key)
  - `PORT` — porta del server (default `3000`)

## Open items (per il piano implementativo)

- Definire i tool/skill di esempio per il seed di `data/context.json` al primo avvio (es. 2-3 skill placeholder, 1 tool, 1 server MCP). Decisione rimandata al piano.

## Approval

Spec approvata in brainstorming session 2026-05-17 con l'utente. Tutte le 6 sezioni del design (test setup, CSS, backend, frontend, slicing, real implementations) confermate.

**Next:** invocare `superpowers:writing-plans` per generare il piano implementativo dettagliato con TDD checkpoints per ogni slice.
