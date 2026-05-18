# Aether Slice 2b — Multi-Session Chat

**Date:** 2026-05-18
**Status:** Approved (brainstorming phase)
**Owner:** Michele
**Reference specs:** `docs/superpowers/specs/2026-05-17-aether-rewrite-design.md`, `docs/superpowers/specs/2026-05-18-aether-slice-2a-chat-streaming-design.md`

## Goal

Estendere Aether con sessioni multiple di chat indipendenti, costruite sopra l'infrastruttura streaming di Slice 2a:

1. Una nuova `SessionsSection` nella Sidebar (sopra le altre sezioni) che lista le sessioni con titolo, le ordina per most-recently-active, e permette di crearne, rinominarle, eliminarle.
2. Il backend `HistoryStore` viene parametrizzato per `sessionId` (non più hardcoded `'default'`). Lo schema su disco diventa `{[sessionId]: SessionRecord}` con `title`, `createdAt`, e `messages[]`. `updatedAt` è derivato.
3. CRUD routes per le sessioni: `GET /api/sessions`, `POST /api/sessions`, `GET/PATCH/DELETE /api/sessions/:id`.
4. `POST /api/ai/dispatch` accetta `sessionId` obbligatorio nel body.
5. Frontend: nuovo `useSessionsStore` (Zustand + localStorage per `activeSessionId`). `useChatStore` resta single-session (i suoi messaggi sono quelli della sessione attiva) e viene resettato + idratato al cambio sessione.
6. Migrazione one-shot della chiave legacy `'default'` di Slice 2a in una sessione con UUID + auto-title.
7. Auto-title della sessione dal primo user message; editable dall'utente via PATCH.
8. UX: switch e nuova sessione disabilitati durante uno streaming attivo; delete con confirm dialog; se elimini l'ultima sessione, ne viene auto-creata una vuota.

## Non-goals (in 2b)

- Multi-tab sync di `activeSessionId` (es. BroadcastChannel).
- Session search / filter / pinning / tagging.
- Export/import individuale di sessione.
- Title regenerate via AI.
- Folders / nesting.
- Concurrent streaming su più sessioni in background.
- Resume di sessione abbandonata cross-device.

## Design decisions (brainstorming outcome)

| Decision | Choice | Reasoning |
|---|---|---|
| Migrazione `'default'` | Rinomina a UUID al primo load di `HistoryStore.listSessions()`, idempotente | Schema omogeneo (tutti UUID), no chiavi speciali. Migrate-on-load è meno fragile di una fase di boot dedicata. |
| `activeSessionId` source of truth | Frontend localStorage | Backend resta stateless sui metadata utente. Single-user single-tab è il use-case dominante. |
| Title | Auto da primo user message + editabile (PATCH) | UX standard. Computed sia server-side (definitive) sia client-side (UI immediata). |
| Switch durante streaming | Disabilitato (button greyed) | Niente race condition, niente abort accidentale; UX ovvia (Stop prima di cambiare). |
| Delete | Confirm dialog + auto-switch + auto-create new se ultima | Pattern dell'app (vedi SkillsSection `useDialog.confirm`), sicurezza contro click accidentali. |
| Ordering | Most-recently-active first (updatedAt desc) | Pattern ChatGPT; usabile naturalmente. |
| Storage shape | `{[sessionId]: {title, createdAt, messages[]}}`, `updatedAt` derivato | Una sola scrittura per session change. Minimal storage, no campi ridondanti. |
| State integration | `useSessionsStore` separato; `useChatStore` resta single-session | Single responsibility per store. Switch sessione = `reset()` + `hydrate()`. Fetch è economico (file locale). |
| `activeSessionId` hydration validation | Confrontato con lista sessions dal server al boot; fallback su `sessions[0]` o `create()` | Protegge da localStorage corrotto o riferimenti a sessioni eliminate da altra tab. |
| Hydration race protection | Token incrementale; fetch obsoleto scartato | Switch rapidi non lasciano i messaggi della sessione sbagliata nel chat store. |

## Architecture

### Backend (`server/`)

#### File structure (NEW unless marked MODIFY)

```
server/
  domain/
    history/
      history.types.ts                # MODIFY: SessionRecord, SessionMeta
      history.schema.ts               # MODIFY: SessionRecordSchema, SessionsFileV2Schema
      history.store.ts                # REWRITE: API parametrizzata + migrate-on-load
      history.store.test.ts           # REWRITE
      history.migrate.ts              # NEW: migrateLegacyDefault (one-shot, idempotente)
      history.migrate.test.ts         # NEW
    dispatch/
      dispatch.service.ts             # MODIFY: accetta sessionId, scrive nella session giusta
      dispatch.service.test.ts        # MODIFY
  routes/
    history.routes.ts                 # REWRITE: CRUD /api/sessions[/:id]
    history.routes.test.ts            # REWRITE
    dispatch.routes.ts                # MODIFY (solo se necessario: la validazione body è in service)
    dispatch.routes.test.ts           # MODIFY
```

#### Data types

```ts
// server/domain/history/history.types.ts
export interface Message {       // unchanged from slice 2a
  id: string;
  role: 'user' | 'model';
  text: string;
  timestamp: number;
  model?: string;
  interrupted?: boolean;
  error?: string;
  retryable?: boolean;
}

export interface SessionRecord {
  title: string;                  // '' if not yet auto-titled
  createdAt: number;
  messages: Message[];
}

export interface SessionMeta {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;              // computed: last message.timestamp || createdAt
}

export type SessionsFileV2 = Record<string, SessionRecord>;
```

#### `HistoryStore` API

```ts
class HistoryStore {
  constructor(filePath: string);

  // Lista metadata di tutte le sessioni, ordinate updatedAt desc.
  // Idempotentemente esegue migrateLegacyDefault al primo load se necessario.
  listSessions(): Promise<SessionMeta[]>;

  // Messaggi della sessione richiesta. null se la sessione non esiste.
  read(sessionId: string): Promise<Message[] | null>;

  // Crea sessione vuota: { title: '', createdAt: Date.now(), messages: [] }.
  // Restituisce il SessionMeta della nuova sessione.
  createEmpty(): Promise<SessionMeta>;

  // Rinomina la sessione. Throws NotFoundError se inesistente.
  // Throws ValidationError se title vuoto o > 200 char.
  rename(sessionId: string, title: string): Promise<SessionMeta>;

  // Appende un messaggio. Se la sessione era vuota e message.role === 'user',
  // auto-imposta title = computeTitle(message.text) (primi 40 char, trim, fallback 'Nuova sessione').
  append(sessionId: string, message: Message): Promise<void>;

  // Elimina la sessione. Throws NotFoundError se inesistente.
  delete(sessionId: string): Promise<void>;
}
```

`updatedAt` non è memorizzato: in `listSessions()` è calcolato come `messages.at(-1)?.timestamp ?? createdAt`.

#### Migration

`history.migrate.ts`:

```ts
import { newId } from '@/server/lib/ids';        // o crypto.randomUUID inline

export function migrateLegacyDefault(file: Record<string, unknown>): SessionsFileV2 {
  // Idempotente: se NON c'è la chiave 'default', return as-is (typed).
  // Se c'è 'default' AND il valore è Message[] (legacy 2a shape), converte.
  // Se c'è 'default' AND il valore è già SessionRecord (improbabile), preserva ma con un id UUID.
  // Le altre chiavi sono passate through.
}
```

Chiamata da `HistoryStore.listSessions()` (prima lettura). Se la migrazione cambia il file, viene persistito via `JsonStore.update()`.

**Behavior:**
- `{'default': []}` → `{'<uuid>': {title: 'Sessione importata', createdAt: Date.now(), messages: []}}`
- `{'default': [...messages]}` → `{'<uuid>': {title: computeTitle(firstUserMsg) ?? 'Sessione importata', createdAt: messages[0].timestamp, messages: [...]}}`
- `{'<uuid1>': {...}, '<uuid2>': {...}}` → invariato

#### Routes

```
GET    /api/sessions                  → 200 { sessions: SessionMeta[] }
POST   /api/sessions                  → 201 SessionMeta
GET    /api/sessions/:id              → 200 { messages: Message[] }     | 404
PATCH  /api/sessions/:id              → 200 SessionMeta                 | 400 | 404
                                        body: { title: string }
DELETE /api/sessions/:id              → 204                             | 404
```

La rotta legacy `/api/sessions/default` non viene più esposta (rimossa).

#### Dispatch route changes

`POST /api/ai/dispatch` body diventa:
```ts
{ sessionId: string (uuid), message: string (min 1) }
```

In `dispatch.service.handle`:
1. Valida body con zod (include sessionId)
2. Verifica esistenza session: `historyStore.read(sessionId)` — se `null`, emette `sse.event('error', { message: 'Session not found', retryable: false })` + end
3. Procede come 2a, ma `historyStore.append(sessionId, message)` ora richiede l'id

### Frontend (`src/`)

#### File structure (NEW unless marked MODIFY)

```
src/
  types/
    session.types.ts                  # NEW: re-export SessionMeta + SessionRecord
  lib/
    api/
      sessions.api.ts                 # NEW: list/create/rename/delete
      sessions.api.test.ts            # NEW
      history.api.ts                  # REWRITE: fetchById(id) sostituisce fetchDefault()
      history.api.test.ts             # REWRITE
      dispatch.api.ts                 # MODIFY: body include sessionId
      dispatch.api.test.ts            # MODIFY
  stores/
    sessions.store.ts                 # NEW (Zustand + localStorage)
    sessions.store.test.ts            # NEW
    chat.store.ts                     # UNCHANGED
  hooks/
    useStreamingDispatch.ts           # MODIFY: include activeSessionId nel body; auto-title client-side
    useStreamingDispatch.test.ts      # MODIFY
  components/
    sidebar/
      SessionsSection.tsx             # NEW
      SessionsSection.test.tsx        # NEW
    chat/
      ChatView.tsx                    # MODIFY: guard activeSessionId, mostra hint se assente
      ChatView.test.tsx               # MODIFY
  App.tsx                             # MODIFY: bootstrap sessions → hydrate chat
  App.test.tsx                        # MODIFY
  test/
    msw-handlers.ts                   # MODIFY: nuovi handlers /api/sessions*
```

#### `useSessionsStore` shape

```ts
interface SessionsState {
  sessions: SessionMeta[];           // ordered updatedAt desc
  activeSessionId: string | null;
  hydrated: boolean;
  error: string | null;              // inline error pill in SessionsSection

  init: () => Promise<void>;
  create: () => Promise<SessionMeta>;
  rename: (id: string, title: string) => Promise<void>;
  delete: (id: string) => Promise<void>;
  setActive: (id: string) => void;
  setLocalTitle: (id: string, title: string) => void;  // ottimistico per auto-title
  touchUpdatedAt: (id: string, ts: number) => void;    // re-sort dopo chunk/done
  clearError: () => void;

  _reset: () => void;                // test only
}
```

#### Boot flow (in `App.tsx`)

```ts
useEffect(() => {
  initContext();
  sessionsStore.init();
}, [initContext]);
```

Inside `sessionsStore.init()`:
```
1. GET /api/sessions → sessions[]
2. stored = localStorage.getItem('aether.activeSessionId')
3. activeId:
   - if stored is in sessions[] → stored
   - else if sessions.length > 0 → sessions[0].id
   - else → result of create()  (POST + push)
4. set({ sessions, activeSessionId: activeId, hydrated: true })
5. localStorage.setItem('aether.activeSessionId', activeId)
6. const token = ++hydrationToken
   historyApi.fetchById(activeId).then((msgs) => {
     if (token === hydrationToken) chatStore.hydrate(msgs);
   })
```

#### `setActive(id)`

```
1. guard: if chatStore.streamingId !== null → return (no-op; UI già disable)
2. if id === activeSessionId → return (no-op)
3. localStorage.setItem('aether.activeSessionId', id)
4. set({ activeSessionId: id })
5. chatStore.reset()
6. const token = ++hydrationToken
7. historyApi.fetchById(id).then((msgs) => {
     if (token === hydrationToken) chatStore.hydrate(msgs);
   })
   .catch((e) => {
     if (token === hydrationToken) {
       // mostra error nel ChatView via stato dedicato o tramite chatStore failHydrate
     }
   })
```

`hydrationToken` è un counter modulo (chiuso nel closure dello store o `let` privato).

#### `delete(id)` flow

```
1. ok = await dialog.confirm('Delete session?', destructive:true)  ← gestito nel componente
2. await sessionsApi.delete(id) → 204
3. wasActive = activeSessionId === id
4. set((s) => ({ sessions: s.sessions.filter((x) => x.id !== id) }))
5. if wasActive:
     remaining = get().sessions
     if remaining.length > 0: setActive(remaining[0].id)
     else: await create() (POST + push + setActive)
```

#### `useStreamingDispatch.send(text)` changes

```ts
const send = async (text) => {
  const trimmed = text.trim();
  if (!trimmed) return;
  const sessionsState = sessionsStore.getState();
  const activeId = sessionsState.activeSessionId;
  if (!activeId) { console.warn('[aether] no active session'); return; }

  const chat = chatStore.getState();
  if (chat.streamingId) return;

  // Auto-title locale: se la sessione attiva ha title vuoto, lo precalcoliamo.
  const active = sessionsState.sessions.find((s) => s.id === activeId);
  if (active && !active.title) {
    sessionsState.setLocalTitle(activeId, computeTitle(trimmed));
  }

  chat.appendUser(trimmed);
  const { id } = chat.startAssistant();
  const controller = new AbortController();
  chat.setAbortController(controller);

  try {
    for await (const ev of createStreamingDispatch({ sessionId: activeId, message: trimmed }, controller.signal)) {
      // ... unchanged ...
    }
  } catch (e) { /* unchanged */ }
  finally {
    sessionsStore.getState().touchUpdatedAt(activeId, Date.now());
  }
};
```

`computeTitle(text)` è una utility condivisa o duplicata in `src/lib/title.ts`:
```ts
export function computeTitle(text: string): string {
  const trimmed = text.trim().replace(/\s+/g, ' ');
  if (!trimmed) return 'Nuova sessione';
  return trimmed.length > 40 ? trimmed.slice(0, 40).trimEnd() + '…' : trimmed;
}
```
Stessa funzione esiste lato server in `server/domain/history/title.ts` (export identico). Per evitare drift, **non viene cross-importata**: la duplicazione è accettata, ma il test verifica che entrambe abbiano lo stesso output su 5 input canonici.

#### `SessionsSection.tsx`

```tsx
<section>
  <div className="flex items-center justify-between mb-2">
    <div className="mono-label">Sessions</div>
    <span className="text-[10px] text-zinc-600">[{sessions.length}]</span>
  </div>
  <div className="space-y-1">
    {sessions.map((s) => (
      <SessionRow
        key={s.id}
        session={s}
        active={s.id === activeSessionId}
        disabled={isStreaming}
        onSelect={() => setActive(s.id)}
        onRename={() => handleRename(s.id, s.title)}
        onDelete={() => handleDelete(s.id, s.title)}
      />
    ))}
    <button
      onClick={handleNewSession}
      disabled={isStreaming}
      aria-label="New session"
      className="w-full p-1 border border-dashed border-border-subtle rounded text-[10px] text-zinc-600 hover:text-zinc-400 transition-colors mt-2 disabled:opacity-40 disabled:cursor-not-allowed"
    >
      + New Session
    </button>
  </div>
</section>
```

`SessionRow` (inline o file separato): row con titolo troncato, highlight accent quando active, hover icons ✎ / ×.

`handleRename` apre `dialog.prompt` con `defaultValue: current.title`; `handleDelete` apre `dialog.confirm(destructive:true)`.

#### `ChatView` guard

Aggiungiamo un fallback: se per qualunque motivo `activeSessionId` è `null` (stato transitorio durante l'init catastrofico), `ChatView` mostra un messaggio breve "Nessuna sessione attiva. Crea una nuova sessione dalla sidebar." invece dei suoi child.

#### App.tsx

```tsx
useEffect(() => {
  initContext();
  sessionsStore.init();
}, [initContext]);
```

`SessionsSection` viene posizionata **prima** delle altre sezioni nel `Sidebar` (sopra `SystemProtocolSection`).

## Data flow

(Vedi sezione dedicata nel brainstorming. Riassunto dei flussi chiave.)

**Boot cold (no data):**
- `init()` → GET empty → `create()` → setActive → hydrate empty → UI mostra EmptyState chat con MessageInput attivo.

**Boot warm con sessione 2a legacy:**
- `HistoryStore.listSessions()` rileva chiave `'default'` → `migrateLegacyDefault` la trasforma in `{[UUID]: {title, createdAt, messages}}` → JsonStore.update persiste atomico → ritorna SessionMeta[].
- `sessions.store.init()` riceve la lista con la nuova UUID. localStorage potenzialmente conteneva ancora `'default'` → fallback `sessions[0]` → la stessa nuova UUID.

**Switch sessione:**
- Click su SessionRow → `setActive` (guard streamingId) → localStorage + reset chat + fetch by id + hydrate.

**Nuova sessione:**
- Click "+ New Session" → POST → push in sessions head → setActive.

**Invio messaggio:**
- `send()` precalcola title localmente se sessione vuota → POST /api/ai/dispatch con sessionId → server auto-titola (idempotente con client) + append → stream → finally `touchUpdatedAt` → re-sort sidebar.

**Rename:**
- Click ✎ → dialog.prompt → ottimistico set → PATCH → on fail rollback + toast.

**Delete (active):**
- Click × → confirm → DELETE → filter → if was active: setActive(next) o create() se empty.

## Error handling & edge cases

(Vedi anche brainstorming sezione 4.)

**Error taxonomy:**

Per gli errori non-streaming (CRUD sessioni), useremo un pattern di error inline nello store:
- `useSessionsStore.error: string | null` viene popolato dall'action fallita
- `SessionsSection` legge `error` e, se non null, mostra un piccolo pill rosso sopra alla lista con messaggio + bottone "×" che chiama `clearError()`
- L'errore si auto-clear al successo della prossima action

| Causa | Dove | Comportamento |
|---|---|---|
| POST /api/sessions fail | sessionsStore.create | set error: 'Impossibile creare sessione' |
| GET /api/sessions fail al boot | sessionsStore.init | sessions=[], activeSessionId=null, set error con 'Lista sessioni non disponibile' (l'init terminerà comunque con hydrated=true per non bloccare la UI) |
| GET /api/sessions/:id 404 (id obsoleto) | hydration | clear localStorage + fallback su sessions[0] o create() (no error pill, è un caso normale) |
| PATCH rename fail | sessionsStore.rename | rollback ottimistico + set error: 'Rename failed' |
| DELETE fail | sessionsStore.delete | set error: 'Delete failed', no optimistic remove |
| POST /api/ai/dispatch body invalido | service | `sse.error('Invalid request body', false)` (già 2a, retryable=false) |
| sessionId non esiste in dispatch | service | `sse.event('error', { message: 'Session not found', retryable: false })` |

**Edge cases coperti:**

1. localStorage corrotto → catch + ignore.
2. localStorage punta a id rimosso → fallback su sessions[0].
3. Delete unica sessione → auto-create new.
4. Delete + streaming attivo → bottone disabled, evento impossibile.
5. Switch + streaming attivo → button disabled.
6. Switch durante hydration in corso → hydrationToken filtra il fetch obsoleto.
7. Rename con title vuoto → blocked dal dialog (required:true) e validato dal server.
8. Title > 200 char → server 400 + toast.
9. Concurrent rename + delete (multi-tab) → il secondo riceve 404.
10. Migrazione `'default'` eseguita due volte → idempotente (no key 'default' più presente).
11. Migrazione con `{default: []}` (vuoto) → UUID + title 'Sessione importata'.
12. `sessions.json` corrotto → JsonStore fallback `{}` → init crea automaticamente una nuova sessione.
13. Hydration fetch fail dopo switch → UI mostra error inline con Retry che richiama `setActive(activeSessionId)`.
14. dispatch con sessionId di sessione cancellata mid-stream → server emette error 'Session not found'.

## Data model summary

```ts
// On disk (data/sessions.json)
{
  "<uuid-1>": {
    "title": "first prompt text",
    "createdAt": 1779100000000,
    "messages": [...]
  },
  "<uuid-2>": { ... }
}

// In RAM (server)
Map<sessionId, SessionRecord>

// Wire (HTTP)
SessionMeta = { id, title, createdAt, updatedAt }
GET  /api/sessions          → { sessions: SessionMeta[] }
GET  /api/sessions/:id      → { messages: Message[] }
POST /api/sessions          → SessionMeta (201)
PATCH /api/sessions/:id     → SessionMeta (200)
DELETE /api/sessions/:id    → 204

// Frontend (useSessionsStore)
sessions: SessionMeta[]
activeSessionId: string | null
hydrated: boolean
```

## Testing strategy

### Backend

- `history.schema.test.ts` (MODIFY) — parses V2 records, rejects malformed
- `history.migrate.test.ts` (NEW) — legacy default → UUID, idempotenza, sessione vuota
- `history.store.test.ts` (REWRITE) — listSessions ordering + migrate-on-load, read(null), createEmpty, rename validation, append auto-title, delete
- `history.routes.test.ts` (REWRITE) — supertest CRUD completo
- `dispatch.service.test.ts` (MODIFY) — sessionId required, 'Session not found' per id mancante
- `dispatch.routes.test.ts` (MODIFY) — body include sessionId
- `app.test.ts` — wire-up smoke

### Frontend

- `sessions.api.test.ts` (NEW)
- `history.api.test.ts` (REWRITE) — fetchById happy + 404
- `dispatch.api.test.ts` (MODIFY) — body shape
- `sessions.store.test.ts` (NEW) — init/create/setActive/rename/delete/streaming-guard/hydration-token
- `useStreamingDispatch.test.ts` (MODIFY) — sessionId nel body, no-op senza activeId, auto-title client
- `SessionsSection.test.tsx` (NEW) — render, hover, switch click, disabled streaming
- `ChatView.test.tsx` (MODIFY) — riusa hydrate via sessionsStore
- `App.test.tsx` (MODIFY) — smoke includendo SessionsSection
- `msw-handlers.ts` (MODIFY) — nuovi default handlers per `/api/sessions*`

### E2E (Playwright)

- `playwright.config.ts` (MODIFY): `webServer.env.AETHER_DATA_DIR = path.join(os.tmpdir(), 'aether-e2e-' + process.pid)` per ottenere uno scratch dir pulito ad ogni run. `beforeAll` opzionale che svuota il path.
- `e2e/smoke.spec.ts` (MODIFY):
  - Test esistente "chat: send message" rimane ma usa il nuovo flow (session auto-creata dal boot, primo messaggio "ping" auto-titola).
  - Nuovo test "multi-session creation": invia "first", crea seconda sessione, invia "second", verifica 2 righe in sidebar con titoli corretti, seconda è attiva.
  - Nuovo test "delete session": dalla situazione precedente, elimina la prima sessione, verifica che resta solo la seconda.

### Coverage thresholds

Invariate (80% per `server/domain/**`, `server/lib/**`, `src/hooks/**`, `src/stores/**`, `src/lib/**`). I nuovi file `sessions.api.ts`, `sessions.store.ts`, `history.migrate.ts`, `title.ts` (BE+FE), `SessionsSection.tsx` (no threshold), ricadono nelle cartelle già coperte.

### TDD ordering

```
1. RED   history.types V2 + history.schema V2
2. GREEN
3. RED   history.migrate
4. GREEN
5. RED   history.store (new API + migrate-on-load)
6. GREEN
7. RED   history.routes (CRUD via supertest)
8. GREEN + wire app.ts
9. RED   dispatch.service sessionId
10. GREEN
11. RED  dispatch.routes minor (body schema is in service)
12. GREEN
13. RED  sessions.api FE
14. GREEN
15. RED  history.api FE rewrite (fetchById)
16. GREEN
17. RED  dispatch.api FE (body sessionId)
18. GREEN
19. RED  sessions.store (init/setActive/create/rename/delete + token)
20. GREEN
21. RED  useStreamingDispatch (sessionId + auto-title client)
22. GREEN
23. RED  SessionsSection
24. GREEN
25. RED  ChatView integration update
26. GREEN
27. RED  App.tsx boot
28. GREEN
29. SMOKE Playwright (3 test: existing + 2 new) + AETHER_DATA_DIR scratch
```

## Risks & mitigations

| Risk | Mitigation |
|---|---|
| Migration non idempotente rompe localStorage | Test esplicito di doppio run; UUID generato una volta sola la prima volta. |
| Multi-tab activeSessionId desync | Accettato come limitazione; doc lo dichiara. |
| Auto-title divergente client vs server | Funzione identica, test condiviso che assert stesso output su input canonici. |
| Race fetch on rapid switch | Hydration token. |
| Delete della sessione attiva durante streaming | Bottone disabled; impossibile design-wise. |
| Playwright run leftover su `data/sessions.json` di dev | `AETHER_DATA_DIR` scratch in tmpdir per ogni run E2E. |
| 2a `localStorage` ha valore `'default'` | `init()` confronta con la lista sessions dal server; non trovandolo, fa fallback. Niente errori utente. |

## Open items

- **Toast component**: non esiste in slice 0. Decisione: per 2b non lo introduciamo. Gli errori CRUD sessioni si mostrano via `useSessionsStore.error` (inline pill nella `SessionsSection`). Un toast system generale resta out-of-scope.
- **Concurrent multi-tab**: accettato come non gestito. Se serve in futuro, aggiungere BroadcastChannel listener in `sessions.store`.
- **Search/Filter**: rimandato a slice futuro se la lista cresce > 20 sessioni.

## Approval

Spec approvata in brainstorming session 2026-05-18 con l'utente. Tutte le 5 sezioni (backend, frontend, data flow, error handling, testing) confermate.

**Next:** invocare `superpowers:writing-plans` per generare il piano implementativo TDD-driven.
