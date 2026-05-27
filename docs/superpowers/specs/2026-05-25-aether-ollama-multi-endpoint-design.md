# Slice 27 — Multi-endpoint Ollama (configurazioni remote a runtime)

**Branch:** `feat/slice-27-ollama-multi-endpoint`
**Data:** 2026-05-25
**Stato:** design approvato, in attesa di piano di implementazione

## Contesto

Oggi Aether supporta **una sola** istanza Ollama, definita dalla variabile d'ambiente
`OLLAMA_HOST` (default `http://localhost:11434`). All'avvio `discoverOllama(host)`
interroga `/api/tags` e il `ProviderRegistry` registra una entry `ollama:<model>` per
ogni modello scoperto. Il pannello provider in basso a sinistra
(`ProviderAuthSection.tsx`) mostra **una riga per transport** con un pallino di stato.
Le chiavi API degli altri provider vivono nel Key Vault (`provider_keys`, una riga per
transport, cifrata AES-256-GCM) e sono configurabili a runtime senza riavvio
(`PUT /providers/keys/:transport` → `registry.refresh()`).

L'utente vuole poter usare **più istanze Ollama** contemporaneamente: l'istanza locale
resta fissa, mentre altre istanze remote devono essere aggiungibili / modificabili /
eliminabili **a runtime**, visibili nel pannello provider, alcune dietro
autenticazione (header Bearer).

## Obiettivi

- Modellare l'**endpoint Ollama** come entità di dominio di prima classe, persistita.
- Permettere CRUD a runtime degli endpoint remoti, senza riavvio (`registry.refresh()`).
- Supportare un **token Bearer opzionale** per endpoint, cifrato nel DB.
- Mantenere l'**endpoint locale fisso** (da `OLLAMA_HOST`), immutabile e sempre presente.
- Mostrare ogni endpoint come riga di stato nel pannello provider.
- Gestire add/edit/delete in una **modale dedicata** agli endpoint Ollama.
- **Non rompere** le sessioni esistenti che referenziano `ollama:<model>`.

## Non obiettivi (YAGNI)

- Nessun marcatore "default" su endpoint remoti: in fallback il default resta il locale.
- Nessun fallback automatico se l'endpoint selezionato sparisce: il dispatch fallisce
  con errore esplicito (comportamento già esistente).
- Nessuna gestione di header custom diversi da `Authorization: Bearer` (solo token).
- Nessuna migrazione dati delle sessioni (il naming del locale resta invariato).

## Modello dati & persistenza

### Migrazione `010_ollama_endpoints.sql` (append-only)

```sql
-- Slice 27: configurazioni Ollama remote multiple, gestibili a runtime.
CREATE TABLE ollama_endpoints (
  id               TEXT PRIMARY KEY,   -- uuid generato lato server
  label            TEXT NOT NULL UNIQUE,
  base_url         TEXT NOT NULL,
  token_ciphertext BLOB,               -- NULL = nessun auth
  token_iv         BLOB,
  token_auth_tag   BLOB,
  created_at       INTEGER NOT NULL,
  updated_at       INTEGER NOT NULL
);
```

- L'**endpoint locale non è in tabella**: è un record sintetico costruito da
  `OLLAMA_HOST`, con `id = "local"`, `label = "local"`, sempre presente, non
  modificabile né eliminabile.
- Il token è cifrato con `encrypt()` (`server/lib/key-crypto.ts`); le tre colonne
  `token_*` rispecchiano `provider_keys`. `token_ciphertext IS NULL` ⇒ nessun header.

### `OllamaEndpointStore` (`server/domain/providers/ollama-endpoints.store.ts`)

API:
- `list(): OllamaEndpointRecord[]` — record persistiti (token mascherato di default).
- `listResolved(): { id; label; baseUrl; token? }[]` — token **in chiaro**, uso interno
  (registry / probing). Non esposto via HTTP.
- `get(id): OllamaEndpointRecord | null`
- `create({ label, baseUrl, token? }): OllamaEndpointRecord`
- `update(id, { label?, baseUrl?, token? }): OllamaEndpointRecord`
- `remove(id): void`

## Naming, registry & auth header

### Schema dei nomi provider

| Endpoint     | `name` (chiave persistita)      | `displayName`              |
|--------------|---------------------------------|----------------------------|
| Locale (env) | `ollama:<model>` (invariato)    | `Ollama (local) / <model>` |
| Remoto       | `ollama:<endpointId>:<model>`   | `Ollama (<label>) / <model>` |

Il locale mantiene `ollama:<model>` per non rompere le sessioni salvate. I remoti usano
l'`id` (uuid) come namespace ⇒ nessuna collisione tra host con lo stesso modello.

### `discovery.ts`

`discoverOllama(host, token?)`: se `token` presente, aggiunge
`headers: { Authorization: \`Bearer ${token}\` }` alla `fetch` di `/api/tags`.

### `OllamaProvider`

`OllamaProviderOpts` guadagna `token?: string`. In `stream()` l'header `Authorization`
viene aggiunto quando presente (accanto a `content-type`).

### `ProviderRegistry`

Cambio nelle `deps`:
- Rimosso `ollamaHost: string`.
- Sostituito `ollamaBuilder` con:
  - `listOllamaEndpoints: () => Array<{ id: string; label: string; baseUrl: string; token?: string }>`
  - `ollamaBuilder: (baseUrl: string, model: string, token?: string) => AIProvider`

In `refresh()` il blocco Ollama itera su `listOllamaEndpoints()`, chiama
`discoverOllama(baseUrl, token)` per ciascuno e registra le entry con lo schema sopra
(`id === 'local'` ⇒ `ollama:<model>`; altrimenti `ollama:<id>:<model>`).

### Composition root (`server/index.ts`)

Fornisce `listOllamaEndpoints` che antepone il locale sintetico
(`{ id:'local', label:'local', baseUrl: OLLAMA_HOST }`) a `store.listResolved()` (token
decifrati). Il registry resta disaccoppiato da env e DB.

### Default provider

`defaultName()` invariato: il fallback Ollama prende la prima entry, che — dato che il
locale è anteposto — è il locale. Confermato come comportamento voluto.

## API REST & probing dello stato

### Route CRUD (in `providers.routes.ts`)

| Metodo   | Path                               | Azione                                                  |
|----------|------------------------------------|---------------------------------------------------------|
| `GET`    | `/providers/ollama-endpoints`      | Lista (token mascherato; locale incluso con `fixed:true`) |
| `POST`   | `/providers/ollama-endpoints`      | Crea `{label, baseUrl, token?}` → `refresh()` + probe   |
| `PUT`    | `/providers/ollama-endpoints/:id`  | Aggiorna `{label?, baseUrl?, token?}` → `refresh()` + probe |
| `DELETE` | `/providers/ollama-endpoints/:id`  | Elimina → `refresh()`                                   |

- Mutazioni su `id = "local"` ⇒ `ValidationError`.
- Validazione: `label` non vuota; `baseUrl` URL `http(s)` valido; collisione
  `UNIQUE(label)` ⇒ `ValidationError` con messaggio chiaro.
- Ogni mutazione chiama `registry.refresh()` poi ri-sonda (pattern di `PUT /keys/:transport`).

### Probing dello stato — `AuthStatusService`

- Le dep passano da `ollamaHost: string` allo stesso `listOllamaEndpoints` iniettato.
- Il report passa da un solo stato Ollama a una lista per-endpoint:

```ts
interface AuthStatusReport {
  statuses: TransportStatus[];     // anthropic, openai, gemini (invariato)
  ollama: OllamaEndpointStatus[];  // nuovo: uno per endpoint
  checkedAt: number;
}
interface OllamaEndpointStatus {
  id: string; label: string; fixed: boolean;
  state: 'ok' | 'error' | 'unconfigured';
  reason?: string;   // es. "3 models" / "ECONNREFUSED" / "401"
  detail?: string;
}
```

- `probeOllamaEndpoints()` sonda ogni endpoint in parallelo (riusa `fetchWithTimeout`,
  con header Bearer quando c'è token).
- Il refresh mirato `?transport=ollama` ri-sonda **tutti** gli endpoint; in `mergeReport`
  l'array `ollama` viene **rimpiazzato** per intero (nessun merge per-endpoint).

## UI

### Pannello `ProviderAuthSection` (basso a sinistra)

- I 3 transport con chiave (anthropic/openai/gemini) restano identici (riga cliccabile →
  `KeyVaultModal`).
- Ollama diventa un sotto-blocco: header "Ollama" con icona di gestione; l'header è
  cliccabile → apre la modale dedicata. Sotto, **una riga per endpoint** (locale +
  remoti) con pallino di stato + label + `reason`. La riga locale ha un badge "local".
  Le righe sono sola visualizzazione.

### Modale dedicata `OllamaEndpointsModal` (sul modello di `KeyVaultModal`)

- Locale in cima, read-only, badge "fixed" + URL da `OLLAMA_HOST`.
- Ogni remoto: label, base URL, token mascherato, pallino, pulsanti modifica / elimina.
- Form "Aggiungi endpoint": `label`, `URL`, `token` (opzionale). Salva → POST.
- Modifica: stesso form precompilato → PUT. Elimina → DELETE con conferma.

### Stato frontend

- Nuovo store `src/stores/ollamaEndpoints.store.ts` + client
  `src/lib/api/ollama-endpoints.api.ts` per il CRUD (optimistic-update / rollback).
- `providerAuth.store` esteso per portare l'array `ollama` del report (righe pannello).
- `ui.store`: `openOllamaEndpoints()` analogo a `openKeyVault()`.
- Stringhe in `src/i18n/`.

## Error handling

- Endpoint selezionato eliminato: il dispatch emette già l'evento SSE
  `error: "Provider '<name>' not available" (retryable:false)`
  (`dispatch.service.ts:333-335` e `:590-592`). Nessun codice nuovo; l'utente riseleziona.
- Endpoint irraggiungibile in discovery: `discoverOllama` torna `[]` (catch silenzioso) ⇒
  nessun modello registrato per quell'endpoint; lo stato nel pannello segnala l'errore.
- Token errato (401/403): la `fetch` non è `ok` ⇒ discovery `[]` + stato `error` con
  `reason` = codice HTTP.

## Testing

Colocato `*.test.ts(x)`, soglia 80% su `domain/`, `lib/`, `stores/`.

Backend:
- `ollama-endpoints.store.test.ts`: CRUD, cifratura/mascheramento token, `UNIQUE(label)`.
- `registry.test.ts`: più endpoint, collisione modelli, naming locale vs remoto.
- `discovery.test.ts` / `ollama.provider.test.ts`: header Bearer presente/assente.
- `auth-status.test.ts`: lista per-endpoint, errori e timeout per singolo endpoint.
- `providers.routes.test.ts`: CRUD, validazione URL, `id=local` rifiutato, label duplicata.

Frontend:
- `ollamaEndpoints.store.test.ts`: CRUD optimistic + rollback su errore.
- `ProviderAuthSection.test.tsx`: render di N righe Ollama + stato.
- `OllamaEndpointsModal.test.tsx`: add / edit / delete.

## Retro-compatibilità

- Le sessioni con `providerName = ollama:<model>` continuano a risolvere (naming locale
  invariato).
- Nessuna riscrittura di dati esistenti.
- `OLLAMA_HOST` resta la fonte dell'endpoint locale; il default in fallback non cambia.

## File toccati (riepilogo)

Nuovi:
- `server/db/migrations/010_ollama_endpoints.sql`
- `server/domain/providers/ollama-endpoints.store.ts` (+ test)
- `src/stores/ollamaEndpoints.store.ts` (+ test)
- `src/lib/api/ollama-endpoints.api.ts`
- `src/components/providers/OllamaEndpointsModal.tsx` (+ test)

Modificati:
- `server/domain/providers/discovery.ts`
- `server/domain/dispatch/providers/ollama.provider.ts`
- `server/domain/providers/registry.ts`
- `server/domain/providers/auth-status.ts` (+ `auth-status.types.ts`)
- `server/routes/providers.routes.ts`
- `server/index.ts`
- `server/app.ts` (wiring del nuovo store nelle `AppDeps`)
- `src/components/sidebar/ProviderAuthSection.tsx`
- `src/stores/providerAuth.store.ts`
- `src/stores/ui.store.ts`
- `src/types/provider-auth.types.ts`
- `src/i18n/*`
