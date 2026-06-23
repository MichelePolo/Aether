# OpenAI-compatible (vLLM) provider + custom headers su Ollama — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Aggiungere ad Aether un transport `openai-compat` (vLLM, API OpenAI `/v1`) con autenticazione a **header liberi cifrati**, e portare gli stessi header — additivi e retro-compatibili — sugli Ollama endpoint, senza regressioni.

**Architecture:** Approccio A (estensione in-place con parametri opzionali). `OpenAIProvider` riusato per `openai` e `openai-compat` aggiungendo `baseUrl?`/`headers?`. Nuova feature di dominio `openai-endpoints` modellata 1:1 su `ollama-endpoints` (types/store/migration/route/discovery/probe/registry/frontend). Mappa header cifrata AES-256-GCM, inviata su chat/discovery/probe.

**Tech Stack:** TypeScript (server Express + frontend React/Vite/Zustand), SQLite (`DatabaseHandle`), Vitest. Spec: `docs/superpowers/specs/2026-06-22-openai-compat-vllm-provider-design.md`.

## Global Constraints

- **Nessuna regressione su Ollama / OpenAI ufficiale**: tutte le aggiunte sono parametri **opzionali**; il comportamento esistente è invariato quando non si usano header/baseUrl. Pinnato da **test di non-regressione (NRT)**.
- **Migrations append-only**, prossimi numeri: **018**, **019** (ultima è `017_swarm_workspace.sql`). Mai editare migration esistenti.
- **Convenzione baseUrl** = radice `/v1` (provider → `${baseUrl}/chat/completions`, discovery/probe → `${baseUrl}/models`).
- **Auth openai-compat** = mappa header `Record<string,string>` cifrata; se presente sostituisce l'auth, altrimenti (transport `openai` ufficiale) fallback a `Authorization: Bearer apiKey`.
- **Registry key**: `openai-compat:<endpointId>:<model>`. `defaultName()` priorità **invariata**, openai-compat in coda.
- **Header cifrati a riposo** (AES-256-GCM via `@/server/lib/key-crypto`), mai in chiaro in API/log; esposti solo come chiavi + valore mascherato.
- Convenzioni: alias `@/*`; lint = `npm run lint` (`tsc --noEmit`, no unused); test Vitest colocati `*.test.ts(x)`; coverage ≥ 80% su `server/domain|lib`, `src/stores|lib`.
- Comandi: `npm run lint` · `npm test` (Vitest) · `npm run test -- <path>` per un file.

---

## Task 1: `OpenAIProvider` — `baseUrl?` + `headers?` + model string (NRT first)

**Files:**
- Modify: `server/domain/dispatch/providers/openai.provider.ts`
- Test: `server/domain/dispatch/providers/openai.provider.test.ts`

**Interfaces:**
- Produces:
  - `OpenAIProviderOpts = { apiKey: string; model: string; baseUrl?: string; headers?: Record<string,string>; capabilities?: ProviderCapabilities }`
  - Endpoint default `DEFAULT_OPENAI_ENDPOINT = 'https://api.openai.com/v1/chat/completions'`.
  - Header finali: se `headers` presenti → `{content-type, accept, ...headers}` (l'auth è negli header); altrimenti → `{content-type, accept, authorization: Bearer apiKey}`.

- [ ] **Step 1: NRT — comportamento ufficiale invariato (test che deve restare verde)**

In `openai.provider.test.ts`, aggiungere/confermare un test che pinna l'attuale: stub di `globalThis.fetch`, costruisci `new OpenAIProvider({ apiKey: 'k', model: 'gpt-5' })`, drena lo stream, e **asserisci** che `fetch` è chiamato con URL `https://api.openai.com/v1/chat/completions` e header `authorization: 'Bearer k'` (e nessun header custom).

```ts
it('NRT: senza baseUrl/headers usa api.openai.com + Bearer apiKey', async () => {
  const calls: { url: string; init: RequestInit }[] = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return sseResponse(['data: {"choices":[{"delta":{"content":"hi"}}]}\n\n', 'data: [DONE]\n\n']);
  }));
  const p = new OpenAIProvider({ apiKey: 'k', model: 'gpt-5' });
  await collect(p.stream(baseReq(), new AbortController().signal));
  expect(calls[0].url).toBe('https://api.openai.com/v1/chat/completions');
  const h = calls[0].init.headers as Record<string,string>;
  expect(h.authorization).toBe('Bearer k');
  vi.unstubAllGlobals();
});
```
(`sseResponse`, `collect`, `baseReq` = helper già presenti o da fattorizzare in cima al file di test, sul modello dei test esistenti.)

- [ ] **Step 2: Nuovo test — baseUrl + headers custom**

```ts
it('usa baseUrl e headers custom quando forniti', async () => {
  const calls: { url: string; init: RequestInit }[] = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return sseResponse(['data: [DONE]\n\n']);
  }));
  const p = new OpenAIProvider({
    apiKey: '', model: 'qwen2.5-coder',
    baseUrl: 'https://vllm.corp.example/v1/chat/completions',
    headers: { 'X-API-Key': 'secret', 'Authorization': 'Bearer tok' },
  });
  await collect(p.stream(baseReq(), new AbortController().signal));
  expect(calls[0].url).toBe('https://vllm.corp.example/v1/chat/completions');
  const h = calls[0].init.headers as Record<string,string>;
  expect(h['X-API-Key']).toBe('secret');
  expect(h['Authorization']).toBe('Bearer tok');
  vi.unstubAllGlobals();
});
```

- [ ] **Step 3: Run → FAIL** — `npm run test -- server/domain/dispatch/providers/openai.provider.test.ts` (il secondo test fallisce; opts non accetta baseUrl/headers).

- [ ] **Step 4: Implementazione (modifica additiva)**

In `openai.provider.ts`:
- Rinominare il `const ENDPOINT = 'https://api.openai.com/v1/chat/completions'` in `export const DEFAULT_OPENAI_ENDPOINT = 'https://api.openai.com/v1/chat/completions'`.
- Rilassare `OpenAIModel`: cambiare `model: OpenAIModel` in `model: string` nell'opts (mantieni `OpenAIModel` come tipo esportato per i builder ufficiali, ma l'opts accetta `string`).
- Estendere l'opts:
```ts
export interface OpenAIProviderOpts {
  apiKey: string;
  model: string;
  baseUrl?: string;
  headers?: Record<string, string>;
  capabilities?: ProviderCapabilities;
}
```
- Nel costruttore: `this.capabilities = opts.capabilities ?? { thinking: opts.model === 'o3', toolCalling: true, vision: true };`
- In `stream()`: sostituire l'uso di `ENDPOINT` e degli header:
```ts
const url = this.opts.baseUrl ?? DEFAULT_OPENAI_ENDPOINT;
const headers: Record<string, string> = {
  'content-type': 'application/json',
  'accept': 'text/event-stream',
  ...(this.opts.headers ?? { 'authorization': `Bearer ${this.opts.apiKey}` }),
};
const res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body), signal });
```

- [ ] **Step 5: Run → PASS** (entrambi i test). `npm run lint` deve restare pulito.

- [ ] **Step 6: Commit**
```bash
git add server/domain/dispatch/providers/openai.provider.ts server/domain/dispatch/providers/openai.provider.test.ts
git commit -m "feat(openai-provider): optional baseUrl + custom headers (NRT pins official behavior)"
```

---

## Task 2: `OllamaProvider` — `headers?` opzionali (additivo, NRT)

**Files:**
- Modify: `server/domain/dispatch/providers/ollama.provider.ts`
- Test: `server/domain/dispatch/providers/ollama.provider.test.ts`

**Interfaces:**
- Produces: `OllamaProviderOpts = { host: string; model: string; token?: string; headers?: Record<string,string> }`. Header finali = base + (`Authorization: Bearer token` se token) + `...headers` (gli header sovrascrivono in caso di chiave uguale).

- [ ] **Step 1: NRT — solo token invariato**
```ts
it('NRT: con solo token invia Authorization: Bearer e nessun header extra', async () => {
  const calls: { url: string; init: RequestInit }[] = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
    calls.push({ url, init }); return ndjsonResponse(['{"done":true}\n']);
  }));
  const p = new OllamaProvider({ host: 'http://h:11434', model: 'm', token: 't' });
  await collect(p.stream(baseReq(), new AbortController().signal));
  expect(calls[0].url).toBe('http://h:11434/api/chat');
  const h = calls[0].init.headers as Record<string,string>;
  expect(h.Authorization).toBe('Bearer t');
  vi.unstubAllGlobals();
});
```

- [ ] **Step 2: Nuovo test — headers fusi sopra il token**
```ts
it('fonde headers custom sopra il Bearer token', async () => {
  const calls: { init: RequestInit }[] = [];
  vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => {
    calls.push({ init }); return ndjsonResponse(['{"done":true}\n']);
  }));
  const p = new OllamaProvider({ host: 'http://h:11434', model: 'm', token: 't', headers: { 'X-Tenant': 'acme' } });
  await collect(p.stream(baseReq(), new AbortController().signal));
  const h = calls[0].init.headers as Record<string,string>;
  expect(h.Authorization).toBe('Bearer t');
  expect(h['X-Tenant']).toBe('acme');
  vi.unstubAllGlobals();
});
```

- [ ] **Step 3: Run → FAIL.**

- [ ] **Step 4: Implementazione** — in `ollama.provider.ts` estendere l'opts con `headers?: Record<string,string>`; nel costruttore degli header:
```ts
const headers: Record<string, string> = { 'content-type': 'application/json' };
if (this.opts.token) headers.Authorization = `Bearer ${this.opts.token}`;
Object.assign(headers, this.opts.headers ?? {});
```
(mantenere l'URL `${host}/api/chat` e lo streaming NDJSON invariati).

- [ ] **Step 5: Run → PASS.** `npm run lint` pulito.

- [ ] **Step 6: Commit** `feat(ollama-provider): optional custom headers merged over bearer (NRT)`.

---

## Task 3: Discovery — `discoverOpenAICompat` + `headers?` su `discoverOllama`

**Files:**
- Modify: `server/domain/providers/discovery.ts`
- Test: `server/domain/providers/discovery.test.ts` (creare se assente, sul modello dei test che stubbano `fetch`)

**Interfaces:**
- Produces:
  - `discoverOpenAICompat(baseUrl: string, headers?: Record<string,string>): Promise<string[]>` — `GET ${baseUrl}/models`, parse `{ data: [{ id: string }] }`, timeout 5s, `[]` su errore.
  - `discoverOllama(host: string, token?: string, headers?: Record<string,string>): Promise<string[]>` — invariato + header opzionali fusi (firma additiva: `headers` è il 3° parametro opzionale).

- [ ] **Step 1: Test (FAIL)**
```ts
it('discoverOpenAICompat estrae gli id da /v1/models', async () => {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    expect(url).toBe('https://vllm.corp/v1/models');
    return new Response(JSON.stringify({ data: [{ id: 'qwen' }, { id: 'llama' }] }), { status: 200 });
  }));
  expect(await discoverOpenAICompat('https://vllm.corp/v1')).toEqual(['qwen', 'llama']);
  vi.unstubAllGlobals();
});
it('discoverOpenAICompat ritorna [] su errore', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('net'); }));
  expect(await discoverOpenAICompat('https://x/v1')).toEqual([]);
  vi.unstubAllGlobals();
});
```

- [ ] **Step 2: Run → FAIL.**

- [ ] **Step 3: Implementazione** (append a `discovery.ts`, sul modello di `discoverOllama`):
```ts
export async function discoverOpenAICompat(baseUrl: string, headers?: Record<string, string>): Promise<string[]> {
  try {
    const res = await fetch(`${baseUrl.replace(/\/$/, '')}/models`, {
      headers: headers ?? {},
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return [];
    const body = await res.json() as { data?: Array<{ id?: string }> };
    return (body.data ?? []).map((m) => m.id).filter((id): id is string => typeof id === 'string');
  } catch {
    return [];
  }
}
```
E aggiungere il 3° parametro opzionale a `discoverOllama(host, token?, headers?)`: costruire gli header come `{ ...(token ? { Authorization: \`Bearer ${token}\` } : {}), ...(headers ?? {}) }`.

- [ ] **Step 4: Run → PASS.** (Verificare che i chiamanti esistenti di `discoverOllama` continuino a compilare: il nuovo parametro è opzionale.)

- [ ] **Step 5: Commit** `feat(discovery): discoverOpenAICompat + optional headers on discoverOllama`.

---

## Task 4: Migrations 018 + 019

**Files:**
- Create: `server/db/migrations/018_openai_compat_endpoints.sql`
- Create: `server/db/migrations/019_ollama_endpoints_headers.sql`
- Test: `server/db/migrations.test.ts` (se esiste un test che applica tutte le migration a `makeTestDb()`; altrimenti la verifica è negli store test del Task 5)

- [ ] **Step 1: `018_openai_compat_endpoints.sql`**
```sql
-- slice: openai-compat vLLM provider
CREATE TABLE openai_compat_endpoints (
  id                 TEXT PRIMARY KEY,
  label              TEXT NOT NULL UNIQUE,
  base_url           TEXT NOT NULL,
  model              TEXT,
  headers_ciphertext BLOB,
  headers_iv         BLOB,
  headers_auth_tag   BLOB,
  created_at         INTEGER NOT NULL,
  updated_at         INTEGER NOT NULL
);
```

- [ ] **Step 2: `019_ollama_endpoints_headers.sql`** (additivo, colonne nullable)
```sql
-- slice: custom headers on ollama endpoints (additive)
ALTER TABLE ollama_endpoints ADD COLUMN headers_ciphertext BLOB;
ALTER TABLE ollama_endpoints ADD COLUMN headers_iv         BLOB;
ALTER TABLE ollama_endpoints ADD COLUMN headers_auth_tag   BLOB;
```

- [ ] **Step 3: Verifica applicazione** — eseguire la suite store (Task 5) o un test che fa `makeTestDb()` e `SELECT` dalle nuove tabelle/colonne. Atteso: nessun errore di migrazione, colonne presenti.

- [ ] **Step 4: Commit** `feat(db): migrations 018 openai_compat_endpoints + 019 ollama headers`.

---

## Task 5: Server types + store openai-endpoints (mirror) + headers su ollama-endpoints store

**Files:**
- Create: `server/domain/providers/openai-endpoints.types.ts`
- Create: `server/domain/providers/openai-endpoints.store.ts`
- Modify: `server/domain/providers/ollama-endpoints.types.ts`, `server/domain/providers/ollama-endpoints.store.ts`
- Test: `server/domain/providers/openai-endpoints.store.test.ts` (nuovo), `server/domain/providers/ollama-endpoints.store.test.ts` (estendi)

**Interfaces (produces):**
- `OpenAICompatEndpointRecord = { id: string; label: string; baseUrl: string; model: string | null; headerKeys: string[]; createdAt: number; updatedAt: number }`
- `ResolvedOpenAICompatEndpoint = { id; label; baseUrl; model: string | null; headers: Record<string,string> }`
- `CreateOpenAICompatEndpointInput = { label: string; baseUrl: string; model?: string | null; headers?: Record<string,string> }`
- `UpdateOpenAICompatEndpointInput = Partial<CreateOpenAICompatEndpointInput>`
- `OpenAICompatEndpointStore` con `list(): OpenAICompatEndpointRecord[]`, `listResolved(): ResolvedOpenAICompatEndpoint[]`, `get(id)`, `create(input)`, `update(id, patch)`, `remove(id)`.
- Ollama: estendere `OllamaEndpointRecord` con `headerKeys: string[]`, `ResolvedOllamaEndpoint` con `headers: Record<string,string>`, e `Create/UpdateOllamaEndpointInput` con `headers?: Record<string,string>` (additivo; il `token` resta).

- [ ] **Step 1: Types** — scrivere `openai-endpoints.types.ts` con le interfacce sopra. Estendere `ollama-endpoints.types.ts` (additivo).

- [ ] **Step 2: Test store openai-endpoints (FAIL)** — modellare su `ollama-endpoints.store.test.ts` usando `makeTestDb()`:
```ts
it('create/list cifra gli header e li maschera in list()', () => {
  const db = makeTestDb();
  const store = new OpenAICompatEndpointStore(db);
  const created = store.create({ label: 'vllm', baseUrl: 'https://v/v1', model: 'qwen',
    headers: { Authorization: 'Bearer s3cret' } });
  const pub = store.list().find((e) => e.id === created.id)!;
  expect(pub.headerKeys).toEqual(['Authorization']);   // solo chiavi, niente valore
  expect(JSON.stringify(pub)).not.toContain('s3cret'); // mai in chiaro
  const resolved = store.listResolved().find((e) => e.id === created.id)!;
  expect(resolved.headers.Authorization).toBe('Bearer s3cret'); // decifrato solo qui
});
```

- [ ] **Step 3: Implementazione store** — `openai-endpoints.store.ts` ricalcando `ollama-endpoints.store.ts`:
  - genera `id` (stesso schema dell'ollama store), `created_at`/`updated_at` con `Date.now()`;
  - serializza `headers` → `JSON.stringify`, cifra con `encrypt()` di `@/server/lib/key-crypto` salvando i 3 BLOB (`headers_ciphertext/iv/auth_tag`); su `listResolved()` decifra e `JSON.parse`;
  - `list()` espone `headerKeys = Object.keys(headers)` (senza valori); `headers` mai nel record pubblico;
  - CRUD su tabella `openai_compat_endpoints`.

- [ ] **Step 4: Estendere ollama-endpoints.store** (additivo) — persistere/cifrare anche `headers` (nuove colonne 019), esporre `headerKeys` in `list()` e `headers` in `listResolved()`. **NRT**: aggiungere un test che una riga creata **senza** `headers` ha `headerKeys: []` e `listResolved().headers === {}`, e che il `token` continua a funzionare identico.

- [ ] **Step 5: Run → PASS** entrambe le suite store. `npm run lint` pulito.

- [ ] **Step 6: Commit** `feat(providers): openai-compat endpoint store + headers on ollama store (encrypted, masked)`.

---

## Task 6: Registry — transport `openai-compat` + header passthrough Ollama (NRT)

**Files:**
- Modify: `server/domain/providers/registry.ts`
- Test: `server/domain/providers/registry.test.ts`

**Interfaces:**
- Consumes: `discoverOpenAICompat`, `OpenAIProvider` (baseUrl/headers), gli store del Task 5.
- Produces: `ProviderTransport` include `'openai-compat'`; `ProviderRegistryDeps` aggiunge
  `listOpenAICompatEndpoints(): ResolvedOpenAICompatEndpoint[]` e
  `openAICompatBuilder(baseUrl: string, model: string, headers?: Record<string,string>): AIProvider`.
  Chiavi registrate: `openai-compat:<endpointId>:<model>`.

- [ ] **Step 1: NRT — ollama invariato + default invariato**
```ts
it('NRT: senza openai-compat endpoints, le chiavi ollama e defaultName non cambiano', async () => {
  // deps con listOpenAICompatEndpoints: () => [] e ollama endpoints come prima
  // asserisci che list() contiene le chiavi ollama:* attese e defaultName() === valore atteso pre-feature
});
```

- [ ] **Step 2: Nuovo test — registra openai-compat:\<id\>:\<model\>**
```ts
it('registra provider openai-compat per ogni model scoperto', async () => {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (url.endsWith('/v1/models')) return new Response(JSON.stringify({ data: [{ id: 'qwen' }] }), { status: 200 });
    return new Response('{}', { status: 200 });
  }));
  const reg = new ProviderRegistry(makeDeps({
    listOpenAICompatEndpoints: () => [{ id: 'corp', label: 'corp', baseUrl: 'https://v/v1', model: null, headers: { Authorization: 'Bearer t' } }],
    openAICompatBuilder: (baseUrl, model, headers) => new OpenAIProvider({ apiKey: '', model, baseUrl: `${baseUrl}/chat/completions`, headers }),
  }));
  await reg.refresh();
  expect(reg.list().some((d) => d.name === 'openai-compat:corp:qwen')).toBe(true);
  vi.unstubAllGlobals();
});
```

- [ ] **Step 3: Run → FAIL.**

- [ ] **Step 4: Implementazione (additiva)** in `registry.ts`:
  - `ProviderTransport` += `'openai-compat'`.
  - `ProviderRegistryDeps` += le due dep sopra.
  - In `refresh()`, dopo il blocco openai ufficiale e prima/dopo il blocco ollama, aggiungere:
```ts
for (const ep of this.deps.listOpenAICompatEndpoints()) {
  const models = await discoverOpenAICompat(ep.baseUrl, ep.headers);
  const tags = models.length ? models : (ep.model ? [ep.model] : []);
  for (const model of tags) {
    const provider = this.deps.openAICompatBuilder(ep.baseUrl, model, ep.headers);
    this.entries.set(`openai-compat:${ep.id}:${model}`, { /* descriptor come per ollama */ });
  }
}
```
  - In `defaultName()`: **non modificare** l'ordine esistente; openai-compat non entra nella catena di priorità (resta selezionabile manualmente).
  - Loop ollama: passare `ep.headers` a `discoverOllama(ep.baseUrl, ep.token, ep.headers)` e al builder.

- [ ] **Step 5: Run → PASS.** `npm run lint` pulito.

- [ ] **Step 6: Commit** `feat(registry): openai-compat transport + ollama headers passthrough (NRT default unchanged)`.

---

## Task 7: Auth-status — `probeOpenAICompat` + headers su probe ollama

**Files:**
- Modify: `server/domain/providers/auth-status.ts`, `server/domain/providers/auth-status.types.ts` (se le dep sono tipizzate lì)
- Test: `server/domain/providers/auth-status.test.ts`

**Interfaces:**
- `AuthStatusServiceDeps` += `listOpenAICompatEndpoints()`; nuovo metodo che fa `GET ${baseUrl}/models` con gli header → stato (raggiungibile + conteggio modelli), analogo a `probeOneOllama`.

- [ ] **Step 1: Test (FAIL)** — stub `fetch` su `/v1/models` con header attesi → status `ok` con N modelli; su errore → status non raggiungibile. (Modellare su `auth-status.test.ts` esistente, che inietta `fetch` via deps.)

- [ ] **Step 2: Implementazione** — aggiungere `probeOneOpenAICompat(ep)` (mirror di `probeOneOllama`, URL `${baseUrl}/models`, header dalla mappa), e includere gli endpoint openai-compat nel report di auth-status. Probe ollama: passare `ep.headers` (additivo).

- [ ] **Step 3: Run → PASS.** **Step 4: Commit** `feat(auth-status): probe openai-compat endpoints + ollama headers`.

---

## Task 8: Routes — CRUD `/api/providers/openai-endpoints` + `headers` su route ollama

**Files:**
- Modify: `server/routes/providers.routes.ts`
- Test: `server/routes/providers.routes.test.ts` (se presente) o test d'integrazione esistente dei provider

**Interfaces:**
- `GET/POST/PUT/DELETE /api/providers/openai-endpoints[/:id]` — specchio del blocco ollama (righe ~239–327). Body POST/PUT: `{ label, baseUrl, model?, headers? }`. Validazioni: `baseUrl` http(s) (riusa `isHttpUrl`), `headers` = oggetto `Record<string,string>` (ogni valore stringa), `label` non vuoto/unico. Dopo ogni mutazione: `registry.refresh()` + probe; risposta con record **mascherato** (mai header in chiaro).
- Route ollama esistenti: accettano `headers?` opzionale nel body (additivo).

- [ ] **Step 1: Test (FAIL)** — POST con `headers` non-oggetto → 400 `ValidationError`; POST valido → 201 con `headerKeys` e senza valori header; GET list include il nuovo endpoint.

- [ ] **Step 2: Implementazione** — aggiungere il blocco route (mirror del blocco ollama-endpoints), una `validateHeaders(h): Record<string,string>` che rifiuta valori non-stringa. Estendere le route ollama per leggere `headers` dal body e passarlo a `create/update`.

- [ ] **Step 3: Run → PASS.** **Step 4: Commit** `feat(routes): openai-endpoints CRUD + headers on ollama routes`.

---

## Task 9: Composition root — wiring in `server/index.ts`

**Files:**
- Modify: `server/index.ts`
- Verifica: `npm run lint` (tsc) + `npm test` (tutte verdi); avvio app (`bootstrap()`) senza errori.

- [ ] **Step 1: Implementazione (additiva)** — in `bootstrap()`:
  - istanziare `const openaiEndpointStore = new OpenAICompatEndpointStore(db);`
  - definire `const listOpenAICompatEndpoints = () => openaiEndpointStore.listResolved();`
  - nelle dep del `new ProviderRegistry({...})` aggiungere:
```ts
listOpenAICompatEndpoints,
openAICompatBuilder: (baseUrl, model, headers) =>
  new OpenAIProvider({ apiKey: '', model, baseUrl: `${baseUrl}/chat/completions`, headers }),
```
  - aggiornare `ollamaBuilder` per inoltrare gli header: `(baseUrl, model, token, headers) => new OllamaProvider({ host: baseUrl, model, token, headers })` e `listOllamaEndpoints` per includere `headers` nei record risolti.
  - passare `openaiEndpointStore` alle route (`createProvidersRoutes`) e all'`AuthStatusService` deps.

- [ ] **Step 2: Verifica** — `npm run lint` pulito; `npm test` verde; opzionale: avviare il server in dev e `GET /api/providers/openai-endpoints` → `[]`.

- [ ] **Step 3: Commit** `feat(server): wire openai-compat endpoint store + builder into registry/routes/auth`.

---

## Task 10: Frontend — types + api client + store

**Files:**
- Create: `src/types/openai-endpoints.types.ts`, `src/stores/openaiEndpoints.store.ts`
- Modify: `src/lib/api/providers.api.ts`, `src/types/provider-auth.types.ts`
- Test: `src/stores/openaiEndpoints.store.test.ts`

**Interfaces:**
- `src/types/openai-endpoints.types.ts`: mirror dei record server (`OpenAICompatEndpoint` con `id,label,baseUrl,model,headerKeys`, `OpenAICompatEndpointStatus`, `SaveOpenAICompatEndpointResponse`).
- `providers.api.ts`: 5 wrapper `listOpenAIEndpoints/createOpenAIEndpoint/updateOpenAIEndpoint/deleteOpenAIEndpoint` su `/api/providers/openai-endpoints[/:id]`; estendere `create/updateOllamaEndpoint` per inviare `headers?`.
- `provider-auth.types.ts`: `ProviderTransport` += `'openai-compat'`; `TRANSPORTS` array aggiornato.

- [ ] **Step 1: Test store (FAIL)** — mirror di `src/stores/ollamaEndpoints.store.test.ts` con `vi.spyOn(providersApi, ...)`: create chiama l'API e poi `syncProviders()`.

- [ ] **Step 2: Implementazione** — scrivere types + i 5 wrapper API + lo store Zustand (mirror di `ollamaEndpoints.store.ts`, inclusa la `syncProviders()` che richiama `useProvidersStore.init()` e `useProviderAuthStore.refresh('openai-compat')`). Estendere `providers.api.ts` ollama per `headers`.

- [ ] **Step 3: Run → PASS** (`npm run test -- src/stores/openaiEndpoints.store.test.ts`). `npm run lint` pulito.

- [ ] **Step 4: Commit** `feat(web): openai-compat endpoints types/api/store + headers on ollama api`.

---

## Task 11: Frontend UI — modal + editor header + sidebar

**Files:**
- Create: `src/components/providers/OpenAIEndpointsModal.tsx`, `src/components/providers/OpenAIEndpointsModal.test.tsx`
- Create: `src/components/providers/HeadersEditor.tsx` (estratto condiviso) + `HeadersEditor.test.tsx`
- Modify: `src/components/providers/OllamaEndpointsModal.tsx` (aggiunge `HeadersEditor`), `src/components/sidebar/ProviderAuthSection.tsx`

**Interfaces:**
- `HeadersEditor`: componente controllato `{ value: Record<string,string>; onChange: (h: Record<string,string>) => void }` — righe chiave/valore con add/remove. **DRY**: usato sia dal modal openai-compat sia da quello ollama.
- `OpenAIEndpointsModal`: form `label + baseUrl + model? + HeadersEditor`, lista con edit/delete e dot di stato (mirror di `OllamaEndpointsModal`).

- [ ] **Step 1: Test `HeadersEditor` (FAIL)** — render, aggiungi una riga `K=V`, `onChange` riceve `{ K: 'V' }`; rimuovi riga → `{}`.

- [ ] **Step 2: Implementa `HeadersEditor`** (componente piccolo, una responsabilità). Run → PASS.

- [ ] **Step 3: Test `OpenAIEndpointsModal` (FAIL)** — mirror del test di `OllamaEndpointsModal`: compila form + submit chiama `createOpenAIEndpoint` con `{label, baseUrl, model, headers}`.

- [ ] **Step 4: Implementa `OpenAIEndpointsModal`** (near-copy di `OllamaEndpointsModal` con `HeadersEditor` e campo `model` opzionale). Aggiungi `HeadersEditor` a `OllamaEndpointsModal` (additivo, token resta). Esponi la nuova sezione in `ProviderAuthSection.tsx` (mirror della sezione Ollama). Run → PASS.

- [ ] **Step 5: Commit** `feat(web): OpenAI endpoints modal + shared HeadersEditor + ollama headers UI`.

---

## Task 12: Suite completa, coverage, smoke manuale

- [ ] **Step 1: Lint + test interi** — `npm run lint` (zero errori) e `npm test` (tutte verdi, incluse le NRT). Verificare coverage ≥ 80% sui path toccati (`npm test -- --coverage` se configurato).
- [ ] **Step 2: Smoke manuale** — avviare Aether (`npm run dev`), aprire il modal "OpenAI/vLLM endpoints", aggiungere un endpoint fittizio (baseUrl + un header) e verificare: compare nella lista, dot di stato coerente (non raggiungibile se finto), nessun header in chiaro nelle DevTools/Network di risposta. Se hai a disposizione il tenant reale: aggiungi `baseUrl=<.../v1>` + l'header richiesto, verifica discovery dei modelli e una chat.
- [ ] **Step 3: Verifica NRT finale** — confermare che i flussi Ollama esistenti (endpoint `local`, chat, discovery) funzionano identici.
- [ ] **Step 4: Commit** `chore: verify full suite + coverage for openai-compat feature`.

---

## Self-review (esito)

- **Copertura spec:** provider baseUrl+headers (Task 1) ✓; ollama headers provider (Task 2) ✓; discovery (Task 3) ✓; migration 018/019 (Task 4) ✓; store openai-compat + ollama headers cifrati/mascherati (Task 5) ✓; registry transport + key `openai-compat:<id>:<model>` + default invariato (Task 6) ✓; auth-status probe (Task 7) ✓; route CRUD + validazioni + headers ollama (Task 8) ✓; wiring index.ts (Task 9) ✓; frontend types/api/store (Task 10) ✓; UI modal + HeadersEditor + sidebar (Task 11) ✓; suite+coverage+smoke+NRT (Task 12) ✓. Sicurezza (cifratura/masking) in Task 5/8; baseUrl=/v1 e model-fallback in Task 1/3/6; openai-compat in coda priorità in Task 6.
- **Non-regressione:** NRT esplicite in Task 1 (openai ufficiale), Task 2 (ollama solo-token), Task 5 (riga ollama senza header), Task 6 (chiavi ollama + `defaultName()` invariati).
- **Placeholder:** i task "mirror" nominano il **file-template esatto** + le trasformazioni precise + le firme nuove complete — non sono "TODO". Le firme/chiavi (`openai-compat:<id>:<model>`, opts, store API) sono coerenti tra i task.
- **Da verificare in esecuzione** (non avendo aperto ogni file): nomi esatti degli helper di test (`collect`, `sseResponse`, `ndjsonResponse`, `makeTestDb`, `makeDeps`) e la firma precisa di `encrypt/decrypt` in `@/server/lib/key-crypto` — allinearli a quelli realmente presenti al primo task che li tocca.
