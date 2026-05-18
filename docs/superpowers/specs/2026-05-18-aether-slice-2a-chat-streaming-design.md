# Aether Slice 2a — Chat Streaming Reale (Single-Session)

**Date:** 2026-05-18
**Status:** Approved (brainstorming phase)
**Owner:** Michele
**Reference spec:** `docs/superpowers/specs/2026-05-17-aether-rewrite-design.md`

## Goal

Sostituire il placeholder centrale di `App.tsx` con una chat funzionante che:

1. Invia un messaggio utente al backend via `POST /api/ai/dispatch`.
2. Riceve uno stream SSE di chunk testuali dal modello Gemini reale (con `FakeProvider` deterministico per i test e per il dev senza API key).
3. Mostra la risposta che cresce live in un bubble assistant, con rendering markdown live.
4. Persiste la cronologia su `data/sessions.json` (singola sessione, `sessionId='default'` hardcoded).
5. Supporta Stop dell'invio in corso via AbortController (client + server) con salvataggio del partial text.
6. Espone errori inline nel bubble assistant con bottone Retry.
7. Auto-scroll intelligente: segue il bottom se l'utente è già lì, non disturba se sta leggendo sopra.

Lo Slice 2a è già una feature spedibile: l'utente può chattare con Gemini. Lo Slice 2b (multi-sessione + Sidebar SessionsSection) si costruisce sopra, in PR separato.

## Non-goals (in 2a)

- Multi-sessione e UI di switch (rimandato a Slice 2b).
- Reasoning steps reali e `event: thinking` (rimandato a Slice 3).
- Sub-agent parser (Slice 6).
- Tool calls / function declarations (Slice 7+).
- Resume di uno stream interrotto dopo network blip.
- Streaming concorrente di più sessioni.
- Token usage / cost display.

## Design decisions (brainstorming outcome)

| Decision | Choice | Reasoning |
|---|---|---|
| Sessione | Singola, `sessionId='default'` hardcoded server-side | Mantiene 2a focalizzato sullo streaming; 2b introdurrà multi-session senza toccare la pipeline di streaming. |
| Persistenza sessioni | JSON via `JsonStore` (slice 0) | Coerente col pattern context; deviazione cosciente dallo "in-memory" originale per supportare la roadmap 2b. |
| Annullamento | Stop button con AbortController (client+server) | UX standard; il partial text viene comunque salvato in history con `interrupted:true`. |
| Rendering | Markdown live durante streaming via `react-markdown` (già in deps) | UX moderna; re-parse per chunk è accettabile per messaggi normali. |
| Auto-scroll | Smart con flag `userScrolledUp` (pattern ChatGPT) | Non disturba l'utente che sta leggendo sopra. |
| Errori | Inline nel bubble assistant + bottone Retry (no toast) | Contestuale, non si perde, no notifica effimera. |
| Provider toggle | `AETHER_FAKE_PROVIDER=1` → `FakeProvider`, altrimenti `GeminiProvider` | Test deterministici e dev senza API key; coerente con env vars dello spec generale. |
| Test del provider Gemini | SDK `@google/genai` mockato in unit, niente hit reali su Gemini | Test stabili e gratuiti; smoke E2E con FakeProvider chiude la coverage. |

## Architecture

### Backend (`server/`)

```
server/
  config.ts                                  # NEW: env loader tipato (GEMINI_API_KEY, AETHER_FAKE_PROVIDER, AETHER_DATA_DIR, PORT)
  app.ts                                     # MODIFY: accetta dispatcher + historyStore in AppDeps
  app.test.ts                                # MODIFY: passa dispatcher fake nei test
  index.ts                                   # MODIFY: istanzia HistoryStore + provider (Fake o Gemini)
  domain/
    history/
      history.types.ts                       # NEW: Message
      history.schema.ts                      # NEW: MessageSchema (zod)
      history.store.ts                       # NEW: HistoryStore (JsonStore-backed, sessionId='default' costante)
      history.store.test.ts                  # NEW
    dispatch/
      dispatch.service.ts                    # NEW: orchestra provider + history + sse
      dispatch.service.test.ts               # NEW (con FakeProvider)
      providers/
        provider.types.ts                    # NEW: AIProvider, ProviderChunk, ProviderRequest
        fake.provider.ts                     # NEW: deterministic per test + AETHER_FAKE_PROVIDER
        fake.provider.test.ts                # NEW
        gemini.provider.ts                   # NEW: @google/genai streaming
        gemini.provider.test.ts              # NEW (SDK mockato)
  routes/
    dispatch.routes.ts                       # NEW: POST /api/ai/dispatch
    dispatch.routes.test.ts                  # NEW (supertest + FakeProvider)
    history.routes.ts                        # NEW: GET /api/sessions/default (hydration on reload)
    history.routes.test.ts                   # NEW
  test/
    sse-collector.ts                         # NEW: helper per collettare event stream nei test
```

**`AIProvider` interface (cuore della testabilità):**

```ts
// server/domain/dispatch/providers/provider.types.ts
export interface ProviderRequest {
  systemInstruction: string;
  history: { role: 'user' | 'model'; text: string }[];
  userMessage: string;
}

export type ProviderChunk =
  | { type: 'text'; text: string }
  | { type: 'done' };

export interface AIProvider {
  stream(req: ProviderRequest, signal: AbortSignal): AsyncIterable<ProviderChunk>;
}
```

`ProviderChunk` non include ancora `thinking` (lo aggiunge Slice 3 con `reasoning.tracer`).

**`HistoryStore`:**

```ts
// server/domain/history/history.store.ts
export interface HistoryStore {
  read(): Promise<Message[]>;                    // sessionId='default' implicito in 2a
  append(message: Message): Promise<void>;
  reset(): Promise<void>;                        // per test e debug
}
```

L'implementazione usa `JsonStore<{ default: Message[] }>` per essere già pronta alla migrazione multi-sessione di 2b (la struttura on-disk è `{ "default": [...] }`).

**`dispatch.service.handle(req, sse, signal)` pipeline:**

```
1. valida req (zod)                                                   → 400 prima dello stream se fail
2. contextStore.read()                                                → systemInstruction
3. history.read()                                                     → Message[] precedenti
4. history.append({role:'user', text:userMessage, timestamp})
5. for await chunk of provider.stream({systemInstruction, history, userMessage}, signal):
     if signal.aborted        → break
     if chunk.type === 'text' → sse.event('text', {chunk:chunk.text}) + accumula
     if chunk.type === 'done' → break
6. const interrupted = signal.aborted
7. history.append({role:'model', text:accumulated, timestamp, interrupted})
8. sse.event('done', { model: provider.model, interrupted })
9. sse.end()

errors:
  provider throws       → sse.error(message) → sse closes
  history persist fails → sse.error('History persist failed') ma testo già streamato
```

**Server-side abort:** in `dispatch.routes.ts`:

```ts
const controller = new AbortController();
req.on('close', () => controller.abort());
await dispatchService.handle(body, sseEmitter, controller.signal);
```

Quando il client chiude il fetch (Stop → AbortController.abort()), Express emette `'close'`, che propaga al provider via `signal`. Il provider observed lo signal e termina il generator. Il partial accumulato resta in history.

**Route `POST /api/ai/dispatch`:**

```ts
// request body (zod-validated)
{ message: string }                            // sessionId in 2b
```

Risposta: `Content-Type: text/event-stream`, events:

```
event: text             data: { chunk: string }
event: done             data: { model: string, interrupted: boolean }
event: error            data: { message: string, retryable: boolean }
```

Il flag `retryable` viene impostato dal `dispatch.service` in base alla causa (auth/config = `false`, network/rate-limit/transient = `true`) e usato dal `MessageBubble` per mostrare o nascondere il bottone Retry.

**Route `GET /api/sessions/default`:**

```ts
// response (200)
{ messages: Message[] }
```

Usato dal frontend al boot per idratare `useChatStore`.

**`AETHER_FAKE_PROVIDER=1`** in `server/index.ts` decide istanza:

```ts
const provider = config.fakeProvider
  ? new FakeProvider({ chunks: ['pong'] })
  : new GeminiProvider({ apiKey: config.geminiApiKey });
```

### Frontend (`src/`)

```
src/
  types/
    message.types.ts                         # NEW: Message (import da server domain types via path)
  lib/
    api/
      dispatch.api.ts                        # NEW: createStreamingDispatch(req, signal): AsyncIterable<SseEvent>
      dispatch.api.test.ts                   # NEW (MSW + ReadableStream)
      history.api.ts                         # NEW: fetchHistory(): Promise<Message[]>
      history.api.test.ts                    # NEW (MSW)
  stores/
    chat.store.ts                            # NEW (zustand)
    chat.store.test.ts                       # NEW
  hooks/
    useStreamingDispatch.ts                  # NEW (send + abort + retry)
    useStreamingDispatch.test.ts             # NEW (MSW)
    useAutoScroll.ts                         # NEW
    useAutoScroll.test.ts                    # NEW
  components/
    chat/
      ChatView.tsx                           # NEW (orchestratore)
      ChatView.test.tsx                      # NEW
      MessageList.tsx                        # NEW (con auto-scroll)
      MessageList.test.tsx                   # NEW
      MessageBubble.tsx                      # NEW (react-markdown + error footer + retry)
      MessageBubble.test.tsx                 # NEW
      MessageInput.tsx                       # NEW (textarea + Enter/Shift+Enter + Send/Stop toggle)
      MessageInput.test.tsx                  # NEW
      EmptyState.tsx                         # NEW
      StreamingIndicator.tsx                 # NEW (cursor blinking)
  App.tsx                                    # MODIFY: <ChatView/> al posto del placeholder
  App.test.tsx                               # MODIFY: assert ChatView presente
  test/
    msw-handlers.ts                          # MODIFY: aggiunge /api/ai/dispatch + /api/sessions/default
```

**`useChatStore`** (single source of truth della conversazione):

```ts
interface ChatState {
  messages: Message[];
  streamingId: string | null;
  abortController: AbortController | null;
  hydrated: boolean;

  hydrate(messages: Message[]): void;
  appendUser(text: string): { id: string };
  startAssistant(): { id: string };
  appendChunk(id: string, text: string): void;
  finishAssistant(id: string, opts: { model?: string; interrupted?: boolean }): void;
  failAssistant(id: string, error: string, retryable: boolean): void;
  setAbortController(c: AbortController | null): void;
  abort(): void;
  reset(): void;
}

interface Message {
  id: string;
  role: 'user' | 'model';
  text: string;
  timestamp: number;
  model?: string;          // solo per role='model', dopo done
  interrupted?: boolean;   // solo per role='model'
  error?: string;          // solo per role='model'
  retryable?: boolean;     // solo per role='model', accompagna error
}
```

**Selettori granulari** per minimizzare i re-render durante lo streaming:

```ts
// MessageBubble.tsx
const text = useChatStore((s) => s.messages.find((m) => m.id === id)?.text);
```

Solo il bubble in streaming si re-renderizza, non tutta `MessageList`.

**`useStreamingDispatch` hook (API ad alto livello):**

```ts
function useStreamingDispatch() {
  const send = async (text: string): Promise<void> => {
    const controller = new AbortController();
    chatStore.appendUser(text);
    const { id } = chatStore.startAssistant();
    chatStore.setAbortController(controller);
    try {
      for await (const ev of createStreamingDispatch({ message: text }, controller.signal)) {
        if (ev.event === 'text')  chatStore.appendChunk(id, ev.data.chunk);
        else if (ev.event === 'done')  chatStore.finishAssistant(id, ev.data);
        else if (ev.event === 'error') chatStore.failAssistant(id, ev.data.message, ev.data.retryable);
      }
    } catch (e) {
      if (controller.signal.aborted) chatStore.finishAssistant(id, { interrupted: true });
      else chatStore.failAssistant(id, errorMessage(e));
    } finally {
      chatStore.setAbortController(null);
    }
  };

  const retry = async (messageId: string): Promise<void> => {
    // (a) trova lo user message precedente al messageId fallito
    // (b) chatStore.removeFromIndex(failedIdx) — rimuove solo l'assistant fallito
    // (c) await send(userMessage.text)
  };

  return {
    send,
    retry,
    abort: () => chatStore.abort(),
    isStreaming: useChatStore((s) => s.streamingId !== null),
  };
}
```

**Component tree** in `App.tsx`:

```
<DialogHost />
<AppShell sidebar={...}>
  <TopBar ... />
  <ChatView>
    <MessageList>
      {empty ? <EmptyState/> : messages.map(m => <MessageBubble id={m.id}/>)}
      {isStreaming && <StreamingIndicator/>}
    </MessageList>
    <MessageInput onSend={send} onStop={abort} isStreaming={isStreaming} />
  </ChatView>
</AppShell>
```

**`useAutoScroll(ref, deps)`** (hook puro):

- Stato `userScrolledUp` interno (sync via ref per evitare re-render).
- Listener `scroll` sul container: se distanza dal bottom > 50px → `userScrolledUp=true`, altrimenti `false`.
- `useEffect` su `deps`: se `!userScrolledUp` → `ref.current.scrollTop = ref.current.scrollHeight`.

**Hydration su boot:**

In `App.tsx`:

```ts
useEffect(() => {
  fetchHistory().then((msgs) => chatStore.hydrate(msgs));
}, []);
```

`hydrate(messages)` setta `messages` e `hydrated=true`. Prima dell'idratazione, `ChatView` mostra uno skeleton minimo (o niente).

## Data flow

**Happy path** (utente preme Send su "Ciao"):

```
MessageInput → useStreamingDispatch.send("Ciao")
  ↓ chatStore.appendUser("Ciao")
  ↓ chatStore.startAssistant() → id=X
  ↓ chatStore.setAbortController(c)
  ↓ fetch POST /api/ai/dispatch  { message: "Ciao" }  signal=c.signal

[server] dispatch.routes
  ↓ req.on('close') → serverController.abort()
  ↓ dispatch.service.handle(body, sse, serverSignal)
       ↓ contextStore.read() → systemInstruction
       ↓ history.append({role:user,text:"Ciao"})
       ↓ for await chunk of provider.stream(...):
           sse.event('text', {chunk}) ──→ client
       ↓ history.append({role:model,text:accumulated})
       ↓ sse.event('done', {model,interrupted:false})
       ↓ sse.end()

[client] parseSseStream yields {event,data}
  ↓ appendChunk(X, chunk)  → MessageBubble re-render (solo X)
  ↓ useAutoScroll → scroll bottom (se !userScrolledUp)
  ↓ on done → finishAssistant(X, {model})
  ↓ streamingId=null → MessageInput torna abilitato
```

**Stop path:**

```
[client] MessageInput Stop → useStreamingDispatch.abort()
  ↓ chatStore.abortController.abort()
  ↓ fetch lancia AbortError → catch in useStreamingDispatch
  ↓ signal.aborted → chatStore.finishAssistant(X, {interrupted:true})

[server] req.on('close') fires
  ↓ serverController.abort()
  ↓ provider.stream loop osserva signal → break
  ↓ history.append({role:model, text:partial, interrupted:true})
  ↓ sse closed (idempotent)
```

**Error path** (es. GEMINI_API_KEY invalid):

```
[server] provider.stream throws AuthError
  ↓ dispatch.service catch
  ↓ sse.error("Authentication failed: check GEMINI_API_KEY")
  ↓ sse.end() (createSseEmitter chiude da solo dopo error)

[client] parseSseStream yields {event:'error',...}
  ↓ chatStore.failAssistant(X, "Authentication failed: ...")
  ↓ MessageBubble footer rosso + Retry button
```

**Reload** (idratazione):

```
[client] App mount → fetchHistory()
  ↓ GET /api/sessions/default
[server] history.routes → history.read() → { messages: [...] }
[client] chatStore.hydrate(messages)
```

## Error handling & edge cases

**Error taxonomy:**

| Causa | Dove | sse.error message | Recovery client |
|---|---|---|---|
| Body invalido (zod fail) | route, before SSE | risposta JSON 400 | toast/inline, no bubble |
| contextStore.read() fail | service | "Context load failed" | bubble error + Retry |
| Provider auth (401/403) | provider | "Authentication failed: check GEMINI_API_KEY" | bubble error, no Retry |
| Rate limit (429) | provider | "Rate limit hit, retry in Ns" | bubble error + Retry |
| Network/timeout provider | provider | "Network error" | bubble error + Retry |
| Server abort (close socket) | service | nessun event:error (clean exit) | client già lo sa via signal.aborted |
| Stream malformato (SDK bug) | service | "Stream parse error" | bubble error + Retry |
| History persist fail (disk full) | service | "History persist failed" (best-effort) | testo già visto, non rietrovabile dopo reload |

**Edge cases coperti:**

1. **Send con messaggio vuoto/whitespace** → MessageInput non chiama onSend.
2. **Send mentre isStreaming** → bottone Send hidden (sostituito da Stop), Enter bloccato.
3. **Stop dopo done** → idempotente: `abort()` controlla `if (!abortController) return`.
4. **Più send rapidi** → secondo bloccato dal flag isStreaming impostato sincronicamente in startAssistant.
5. **Chunk SSE spezzato a metà JSON** → gestito da parseSseStream (slice 0).
6. **sse.error dopo sse.end** → already-closed flag in createSseEmitter (slice 0).
7. **Provider yield 0 chunk poi done** → assistant message text="", bubble mostra "(empty response)".
8. **AbortError vs altri errori** → discriminato via `if (signal.aborted) finishAssistant({interrupted:true})`.
9. **Server crash mid-stream** → TCP close → parseSseStream esaurisce → loop esce con bubble ancora streaming → catch globale → failAssistant("Connection lost").
10. **Auto-scroll durante user-scroll-up** → useAutoScroll legge userScrolledUp; reset a false solo entro 50px dal bottom.
11. **Markdown con code block non chiuso mid-stream** → react-markdown rende il blocco aperto come testo, si chiude quando arriva la chiusura.

## Testing strategy

### Backend (Vitest + node + supertest)

| File | Cosa testa | Tipo |
|---|---|---|
| `history.store.test.ts` | append, read, reset, ordinamento, persistenza JSON | unit |
| `fake.provider.test.ts` | chunks deterministici, abort termina il generator | unit |
| `gemini.provider.test.ts` | SDK mockato: parsing chunk, abort propagation | unit |
| `dispatch.service.test.ts` | pipeline orchestrazione con FakeProvider: text events, history user+model, AbortSignal (partial save + interrupted), provider error → sse.error | unit |
| `dispatch.routes.test.ts` | supertest: happy path, body invalido → 400, abort via socket close | integration |
| `history.routes.test.ts` | supertest: GET ritorna messages | integration |
| `app.test.ts` (MODIFY) | wire-up dispatcher iniettato | integration |

Helper `server/test/sse-collector.ts`: trasforma response body chunked in `SseEvent[]` riusando `parseSseStream`.

### Frontend (Vitest + jsdom + RTL + MSW)

| File | Cosa testa | Tipo |
|---|---|---|
| `chat.store.test.ts` | tutte le actions, transizioni di stato | unit |
| `dispatch.api.test.ts` | MSW + ReadableStream con chunk spezzati, abort cancella fetch | unit |
| `history.api.test.ts` | MSW happy path | unit |
| `useStreamingDispatch.test.ts` | renderHook: send → store popolato, chunk → appendChunk, done → finish, abort → interrupted, error event → failAssistant | unit |
| `useAutoScroll.test.ts` | scroll-up disabilita, ritorno a 50px riabilita, dep change scrolla solo se al bottom | unit |
| `MessageBubble.test.tsx` | user/model rendering, markdown, error footer con Retry (retryable=true) e senza Retry (retryable=false), interrupted label | unit |
| `MessageList.test.tsx` | EmptyState quando vuoto, bubble per ogni message | unit |
| `MessageInput.test.tsx` | Enter trim e send, Shift+Enter newline, disabled in streaming, Stop visibile, empty no-send | unit |
| `ChatView.test.tsx` | integration store reale + MSW: happy/stop/error path | integration |
| `App.test.tsx` (MODIFY) | smoke: ChatView presente, sidebar intatta | smoke |

MSW handler base `/api/ai/dispatch` in `src/test/msw-handlers.ts` con ReadableStream artificiale; varianti (error/slow/partial) via `server.use(...)` nel singolo test.

### E2E (Playwright)

`e2e/smoke.spec.ts` (MODIFY): boot con `AETHER_FAKE_PROVIDER=1`, digita "ping", verifica bubble assistant con "pong", verifica Stop sparisce dopo done.

### TDD ordering

```
1. RED  history.store + types
2. GREEN minimal store
3. RED  fake.provider + provider.types
4. GREEN
5. RED  dispatch.service (con FakeProvider)
6. GREEN
7. RED  dispatch.routes (supertest)
8. GREEN + wire app.ts
9. RED  gemini.provider (SDK mockato)
10. GREEN
11. RED  history.routes
12. GREEN
13. RED  chat.store
14. GREEN
15. RED  dispatch.api + history.api
16. GREEN
17. RED  useStreamingDispatch
18. GREEN
19. RED  useAutoScroll
20. GREEN
21. RED  MessageBubble (markdown, error, retry)
22. GREEN
23. RED  MessageInput
24. GREEN
25. RED  MessageList + EmptyState
26. GREEN
27. RED  ChatView integration
28. GREEN + wire App.tsx
29. SMOKE Playwright update
```

## Data model (key types)

```ts
// types/message.types.ts
export interface Message {
  id: string;
  role: 'user' | 'model';
  text: string;
  timestamp: number;
  model?: string;
  interrupted?: boolean;
  error?: string;
}
```

`reasoningSteps?` e `reasoning?` (presenti nello spec generale) non sono popolati in 2a — verranno aggiunti in Slice 3.

## Conventions

- Tutti i nuovi file rispettano `tsc --noEmit` con strict + noUnusedLocals/Parameters.
- Test co-locati: `xxx.test.ts` accanto a `xxx.ts`.
- Coverage threshold 80% su `server/domain/dispatch/*`, `server/domain/history/*`, `src/hooks/useStreamingDispatch.ts`, `src/hooks/useAutoScroll.ts`, `src/stores/chat.store.ts`, `src/lib/api/dispatch.api.ts`.

## Env vars (nuove o usate)

- `GEMINI_API_KEY` — required se `AETHER_FAKE_PROVIDER` non è `1`.
- `AETHER_FAKE_PROVIDER` — se `1`, usa FakeProvider.
- `AETHER_DATA_DIR` — già esistente, ora ospita anche `sessions.json`.
- `PORT` — già esistente.

## Risks & mitigations

| Risk | Mitigation |
|---|---|
| `react-markdown` re-parse per chunk lento | Accettabile per messaggi normali. Se osserviamo lag, throttle a 16ms o memoize componenti markdown. |
| AbortController non propagato dal SDK Gemini | Testare esplicitamente in `gemini.provider.test.ts`. Se il SDK non rispetta signal, fallback: lasciar finire lo stream ma stoppare l'emissione lato service. |
| History persist su ogni done blocca lo stream | append è chiamato dopo l'ultimo chunk, non durante. Latenza accettabile (single JSON write atomico via JsonStore). |
| Reload con sessione lunga lento da idratare | In 2a la sessione singola è bounded dall'uso; in 2b si considererà pagination. |
| Test flaky su streaming | FakeProvider deterministico + MSW con ReadableStream controllato. Niente hit reali a Gemini nei test. |

## Slice 2b (planned, not in scope here)

- `SessionsSection` in Sidebar con lista + "New session" + delete.
- `sessions.routes.ts`: GET/POST/DELETE/PATCH `/api/sessions[/:id]`.
- `useSessionsStore` o estensione di `chatStore` con `activeSessionId`.
- `HistoryStore.read(sessionId)` parametrizzato.
- Migrazione automatica del JSON 2a (chiave `default`) al formato multi-sessione.
- Titolazione auto della sessione dal primo messaggio user.

## Open items (per il piano implementativo)

- Decidere se il FakeProvider in dev (non solo test) emette chunk con delay artificiale (utile per vedere lo streaming "live") o tutti insieme (più veloce). Default proposto: 50ms tra chunk in dev, 0ms nei test.
- Stringa esatta del messaggio assistant del FakeProvider in test (`"pong"`? echo del messaggio user? lista canned di risposte?). Default proposto: `["pong"]` chunk singolo per i test che non specificano altrimenti.

## Approval

Spec approvata in brainstorming session 2026-05-18 con l'utente. Tutte le 5 sezioni (backend, frontend, data flow, error handling, testing) confermate.

**Next:** invocare `superpowers:writing-plans` per generare il piano implementativo dettagliato di Slice 2a con TDD checkpoints.
