# Spec — Provider OpenAI-compatibile (vLLM) + header liberi su Ollama

- **Data:** 2026-06-22
- **Progetto:** Aether (`aether-core`) — server TS + frontend React/Vite
- **Stato:** design approvato in brainstorming
- **Obiettivo utente:** usare Aether per sviluppare contro un **tenant vLLM aziendale** (Enterprise, auth ignota gestita dal team sicurezza), **senza toccare** l'integrazione Ollama usata quotidianamente.

## 1. Obiettivo

Aggiungere ad Aether un transport **`openai-compat`** per endpoint che parlano l'API OpenAI
(`/v1/...`) — tipicamente **vLLM** self-hosted — con **autenticazione a header liberi** (mappa
chiave→valore cifrata), perché l'auth del tenant è sconosciuta e probabilmente non banale.
In aggiunta, portare la **stessa capacità di header liberi** sugli **Ollama endpoint** esistenti,
in modo **strettamente additivo e retro-compatibile**.

## 2. Vincoli (dal contesto e dal codice)

- **Nessuna regressione su Ollama**: il percorso runtime Ollama non cambia comportamento se non
  si aggiungono header. Coperto da **test di non-regressione (NRT)**.
- **Approccio A** (approvato): estensione *in-place* con parametri **opzionali**; nessun refactor
  della logica di streaming. `OpenAIProvider` riusato per `openai` e `openai-compat`.
- **Anthropic/Gemini intoccati.**
- Convenzioni Aether (da `CLAUDE.md`): composition root in `server/index.ts`; dominio in
  `server/domain/<feature>/` con `*.types.ts`/`*.store.ts`; migration **append-only** numerate
  (`server/db/migrations/NNN_*.sql`, prossime = **018**, **019**); route factory in
  `server/routes/*.routes.ts`; alias import `@/*`; **lint = `tsc --noEmit`** (no unused);
  test Vitest **colocati** `*.test.ts(x)`; coverage ≥ 80% su `server/domain|lib`, `src/stores|lib`.

## 3. Decisioni approvate

1. **Auth = header liberi (mappa chiave→valore), cifrati a riposo** (AES-256-GCM via
   `server/lib/key-crypto`). Coprono `Authorization: Bearer …`, `X-API-Key: …`, header di gateway, ecc.
2. **Convenzione `baseUrl` = radice `/v1`** del tenant. Il provider compone `${baseUrl}/chat/completions`,
   la discovery `${baseUrl}/models`.
3. **Model manuale come fallback** quando `GET /v1/models` non è accessibile (tenant che lo blocca).
4. **`openai-compat` in coda alla priorità di `defaultName()`** → non scavalca mai il default attuale dell'utente.
5. Header liberi resi disponibili **anche su Ollama** (additivo; il `token` Bearer resta invariato).

## 4. Architettura (Approccio A)

Concetto nuovo condiviso: **mappa header cifrata per-endpoint**, inviata su chat, discovery e probe.

### 4.1 Provider layer — `server/domain/dispatch/providers/`
- **`openai.provider.ts` (MODIFICA additiva).** `OpenAIProviderOpts` → aggiunge:
  - `baseUrl?: string` (default attuale `https://api.openai.com/v1/chat/completions` se assente);
  - `headers?: Record<string, string>`;
  - `model: string` (rilassato dall'enum `OpenAIModel`); `capabilities?` override opzionale.
  In `stream()`: usa `opts.baseUrl ?? DEFAULT_ENDPOINT`; gli header finali = base
  (`content-type`, `accept: text/event-stream`) + (se `opts.headers` presenti → quelli, e l'auth
  arriva da lì; altrimenti → `Authorization: Bearer ${apiKey}` come oggi). **Retro-compatibile**:
  il transport `openai` ufficiale passa solo `{apiKey, model}` → comportamento identico.
- **`ollama.provider.ts` (MODIFICA additiva).** `OllamaProviderOpts` → aggiunge `headers?: Record<string,string>`,
  fusi **sopra** l'header `Authorization: Bearer <token>` esistente (token invariato).

### 4.2 Dominio nuovo — `server/domain/providers/openai-endpoints.*` (mirror di `ollama-endpoints.*`)
- `openai-endpoints.types.ts`: `OpenAICompatEndpointRecord` (pubblico: `id`, `label`, `baseUrl`,
  `model?`, `headerKeys: string[]` + valori mascherati — mai header in chiaro), `ResolvedOpenAICompatEndpoint`
  (header decifrati, solo per il registry), `Create/UpdateOpenAICompatEndpointInput`.
- `openai-endpoints.store.ts`: CRUD su SQLite; serializza la mappa header in JSON e la cifra
  (AES-256-GCM) come per il token Ollama; `list()` (pubblico/mascherato), `listResolved()` (decifrato),
  `get/create/update/remove`.

### 4.3 Discovery — `server/domain/providers/discovery.ts`
- `discoverOpenAICompat(baseUrl, headers?) → string[]`: `GET ${baseUrl}/models` con gli header,
  parse `{ data: [{ id }] }`, timeout 5s, `[]` su errore (come `discoverOllama`).
- Se discovery `[]` **e** l'endpoint ha un `model` manuale → usare quello.

### 4.4 Auth/health — `server/domain/providers/auth-status.ts`
- `probeOpenAICompat(baseUrl, headers?)`: `GET ${baseUrl}/models` con header → stato raggiungibile +
  conteggio modelli (analogo a `probeOneOllama`).
- Probe Ollama: passa gli header se presenti (additivo).

### 4.5 Registry — `server/domain/providers/registry.ts` (additivo)
- `ProviderTransport` += `'openai-compat'`.
- `ProviderRegistryDeps` += `listOpenAICompatEndpoints()` e `openAICompatBuilder(baseUrl, model, headers?)`.
- `refresh()`: loop sugli endpoint openai-compat → discovery (o model manuale) → registra provider
  con chiave **`openai-compat:<endpointId>:<model>`** (costruiti via `openAICompatBuilder` →
  `new OpenAIProvider({ baseUrl, model, headers })`).
- Loop Ollama: passa gli header dell'endpoint al builder/discovery (additivo).
- `defaultName()`: **priorità invariata**; `openai-compat` aggiunto in coda (mai default automatico).

### 4.6 Route — `server/routes/providers.routes.ts` (additivo)
- CRUD `/api/providers/openai-endpoints` (GET/POST/PUT/DELETE) **specchio** del blocco Ollama
  (righe ~239–327): valida `baseUrl` http(s), `headers` come oggetto `Record<string,string>`,
  `model?` stringa; chiama `registry.refresh()` + probe. (Nessun id sintetico riservato come il
  `local` di Ollama: tutti gli endpoint openai-compat sono su DB.)
- Route Ollama esistenti: accettano un campo `headers?` opzionale nel body (additivo).

### 4.7 Composition root — `server/index.ts` (additivo)
- Istanzia `OpenAICompatEndpointStore`; definisce `listOpenAICompatEndpoints()`; cabla
  `openAICompatBuilder` + `listOpenAICompatEndpoints` nelle dep del `ProviderRegistry`.
- Aggiorna `listOllamaEndpoints`/`ollamaBuilder` per veicolare gli header (additivo).

### 4.8 Frontend — `src/`
- `src/types/openai-endpoints.types.ts` (mirror), `src/stores/openaiEndpoints.store.ts` (Zustand,
  mirror di `ollamaEndpoints.store.ts`), 5 wrapper in `src/lib/api/providers.api.ts`.
- `src/components/providers/OpenAIEndpointsModal.tsx`: form con **editor header chiave→valore**
  (righe add/remove) + `label` + `baseUrl` + `model?`.
- `OllamaEndpointsModal.tsx`: **aggiunge** lo stesso editor header (additivo; campo token invariato).
- `ProviderTransport` frontend (`src/types/provider-auth.types.ts`) += `'openai-compat'`; sezione
  sidebar che espone i nuovi endpoint (mirror della sezione Ollama).

## 5. Schema / migrations (append-only)
- **018_openai_compat_endpoints.sql**: tabella `openai_compat_endpoints` (`id` PK, `label` UNIQUE,
  `base_url` NOT NULL, `model` TEXT NULL, `headers_ciphertext`/`headers_iv`/`headers_auth_tag` BLOB NULL,
  `created_at`/`updated_at` INTEGER NOT NULL).
- **019_ollama_endpoints_headers.sql**: `ALTER TABLE ollama_endpoints` aggiunge
  `headers_ciphertext`/`headers_iv`/`headers_auth_tag` BLOB NULL (nullable → righe esistenti intatte).

## 6. Flusso dati
1. UI: aggiungi endpoint vLLM → `label` + `baseUrl` (es. `https://vllm.corp.example/v1`) + header
   (es. `Authorization: Bearer …` o `X-API-Key: …`) + `model?`.
2. Server: store (header cifrati) → `registry.refresh()` → discovery `${baseUrl}/models` (con header)
   o model manuale → registra `openai-compat:<id>:<model>`.
3. Dispatch: selezione provider → `OpenAIProvider({ baseUrl, model, headers })` → POST
   `${baseUrl}/chat/completions` (SSE, tool_calls via logica esistente).

## 7. Sicurezza & gestione errori
- Header **cifrati a riposo**; mai restituiti in chiaro (espongo solo chiavi + valori mascherati,
  come il token oggi); **niente header nei log**.
- Discovery/probe falliti → endpoint "non raggiungibile", 0 modelli, nessun crash.
- 401/headers errati → errore upstream propagato (gestione esistente di `OpenAIProvider`).
- TLS/CA aziendale: fuori dall'app (via env `NODE_EXTRA_CA_CERTS`) — documentato, non implementato.

## 8. Testing — con non-regressione (NRT)
- **NRT Ollama:** endpoint con solo token → invia *esattamente* `Authorization: Bearer <token>` e
  nessun header extra; discovery su `/api/tags`; endpoint **senza** header identico a prima;
  priorità di `defaultName()` invariata.
- **NRT OpenAI ufficiale:** senza `baseUrl`/`headers`, POST invariato su `api.openai.com/v1/chat/completions`
  con `Authorization: Bearer apiKey`.
- **Nuovi:** provider openai-compat (URL+header corretti, parse SSE, accumulo `tool_calls`),
  `openai-endpoints.store` (CRUD + cifratura + masking), `discoverOpenAICompat` (parse `/v1/models`,
  errore→`[]`, fallback model manuale), probe, route (validazioni baseUrl/headers/model), registry
  (chiavi `openai-compat:*`), merge header su Ollama; store/modal frontend (mirror pattern esistenti).
- Vitest, `fetch` stubbato via `vi.stubGlobal`, store con `makeTestDb()`; coverage ≥ 80% sul toccato.

## 9. Fuori scope (YAGNI)
- Nessun refresh OAuth automatico (l'utente incolla l'header necessario).
- Nessun header per-richiesta dinamico; nessuna gestione CA in-app.
- Nessun cambio al default/priorità Ollama; Anthropic/Gemini intoccati.
