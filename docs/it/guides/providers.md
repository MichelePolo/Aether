# Provider

> 🇮🇹 Traduzione derivata — la versione di riferimento è quella inglese: [Providers](../../guides/providers.md).

Cosa copre: come Aether scopre, blocca in base alle credenziali e nomina i backend modello a cui una sessione può inviare richieste. Leggilo quando stai aggiungendo un provider, stai facendo debug del perché un modello non compare nel selettore, o stai collegando un endpoint compatibile OpenAI (vLLM, LM Studio, ecc.).

## Come funziona

Ogni backend implementa la piccola interfaccia `AIProvider` (`server/domain/dispatch/providers/provider.types.ts`): una stringa `model`, un oggetto `capabilities` (`thinking`, `toolCalling`, `vision`) e un metodo `stream()` che produce chunk `text` / `thinking` / `function_call` / `done`. Ci sono sette transport: `fake`, `gemini`, `ollama`, `anthropic`, `openai`, `openai-compat` e `codex` (`ProviderTransport` in `server/domain/providers/registry.ts`).

`ProviderRegistry.refresh()` (`server/domain/providers/registry.ts`) ricostruisce da zero l'intera mappa dei provider ad ogni chiamata:
- `fake:default` è sempre presente.
- Le voci `gemini:<model>` e `openai:<model>` vengono aggiunte solo quando `resolveKey('gemini' | 'openai')` restituisce una chiave — cioè la credenziale deve risolversi prima che il provider compaia.
- `anthropic:<model>` dipende da `detectAnthropicAuth()`: in modalità `oauth` elenca l'insieme di modelli hardcoded; in modalità `apikey` chiama `discoverAnthropic(key)` e aggiunge voci solo per i modelli che vengono restituiti (un risultato vuoto viene registrato come problema del registro, non scartato silenziosamente).
- Le voci `ollama:<model>` provengono da una **scoperta live**: `listOllamaEndpoints()` restituisce gli endpoint configurati, e ognuno viene sondato via `discoverOllama(baseUrl, token, headers)`, che chiama `<baseUrl>/api/tags`. L'endpoint locale mantiene il vecchio naming `ollama:<model>` per retrocompatibilità con le sessioni salvate prima del supporto multi-endpoint; gli endpoint aggiuntivi sono namespaced come `ollama:<endpointId>:<model>`.
- Le voci `openai-compat:<endpointId>:<model>` provengono da `listOpenAICompatEndpoints()` + `discoverOpenAICompat(baseUrl, headers)`, che chiama `<baseUrl>/models` e ricade sul campo `model` configurato dell'endpoint se la scoperta non restituisce nulla. I provider openai-compat **non** vengono mai scelti come predefiniti — devono essere selezionati manualmente.
- Le voci `codex:<model>` compaiono quando `detectCodexAuth()` (`server/lib/codex-auth.ts`) trova il binario `codex` nel PATH **e** `$CODEX_HOME/auth.json` (scritto da `codex login`, OAuth dell'abbonamento ChatGPT). Nessuna API key e nessuna voce nel vault — il CLI legge da solo le proprie credenziali. La lista modelli è l'insieme hardcoded più il `model` di `~/.codex/config.toml`. Al dispatch `CodexProvider` spawna `codex exec --json` con sandbox read-only ed espone i tool MCP di Aether tramite un bridge MCP su loopback (`/api/mcp-bridge/:token`), così le tool call passano comunque dal gate breakpoints e dal tracing di Aether.

Il `name` di ogni voce (la chiave della mappa del registro, es. `gemini:gemini-1.5-pro` o `openai-compat:my-vllm:llama-3-70b`) è ciò che il campo `providerName` di una sessione memorizza, e ciò che il campo `providerName` del corpo della richiesta di dispatch può sovrascrivere per singola chiamata.

**La risoluzione della chiave** dà priorità all'ambiente: `KeyResolver.get()` (`server/domain/providers/key-resolver.ts`) controlla prima `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` / `GEMINI_API_KEY` in `process.env`, e ricade sul vault cifrato (`KeyVaultService.getKey()`) solo se la variabile d'ambiente non è impostata. Vedi [Vault delle chiavi](key-vault.md) per i dettagli sulla cifratura.

**Selezione predefinita**: `ProviderRegistry.defaultName()` restituisce `deps.defaultOverride` (popolato da `AETHER_DEFAULT_PROVIDER`, `server/index.ts`) se nomina una voce che esiste attualmente; altrimenti ricade su un ordine di preferenza fisso — gemini, poi openai, poi anthropic, poi ollama, poi codex, poi `fake:default` — scegliendo la prima voce trovata in ciascun transport. openai-compat è deliberatamente escluso da questa catena di fallback; codex è ultimo tra i transport reali, così non scavalca mai un default esistente ma batte comunque il fallback fake.

**Selezione persistente**: una sessione mantiene il proprio `providerName` (`src/stores/sessions.store.ts`); cambiare provider nella TopBar aggiorna il `providerName` della sessione attiva e scrive anche un predefinito in `localStorage` così le nuove sessioni ereditano l'ultima scelta.

**Gli endpoint openai-compat** sono gestiti dal pannello Provider Auth: ogni endpoint ha un `label`, un `baseUrl`, un `model` fissato opzionale, e header personalizzati opzionali. Gli header sono cifrati a riposo (`OpenAICompatEndpointStore`, `server/domain/providers/openai-endpoints.store.ts`) usando la stessa chiave di vault AES-256-GCM delle chiavi API dei provider; solo le **chiavi** degli header, mai i valori, sono esposte tramite l'API HTTP (`OpenAICompatEndpointRecord.headerKeys`). La scoperta dei modelli chiama `/models` sul `baseUrl` configurato (quindi il `baseUrl` di un endpoint vLLM/LM Studio in genere include già `/v1`).

**Server senza catalogo `/models`** — il caso comune è un vLLM che espone un modello per endpoint — richiedono il campo `model` compilato: è il valore su cui ricade il registry, e senza di esso l'endpoint non registra alcuna voce (il registry lo segnala come issue e lo stato dell'endpoint riporta `no /models — pin a model`). Con un modello fissato, un 404/405 su `/models` viene riportato come `ok — pinned <model>` invece che come errore; 401/403 ed errori di connessione restano errori, così credenziali sbagliate restano visibili.

Poiché i **valori** degli header non vengono mai restituiti al browser, l'editor header del form di modifica si apre sempre vuoto e il pannello elenca invece i nomi degli header salvati. Lasciarlo intatto conserva gli header salvati; aggiungere righe li sostituisce in blocco; svuotarlo dopo averlo toccato (`headers: null` sul filo) li cancella, con la stessa convenzione già usata da `token` e `model`.

## File chiave

- `server/domain/dispatch/providers/provider.types.ts` — l'interfaccia `AIProvider` e i tipi condivisi di richiesta/chunk
- `server/domain/providers/registry.ts` — `ProviderRegistry`, lista dei transport, logica di selezione predefinita
- `server/domain/providers/discovery.ts` — `discoverOllama`, `discoverOpenAICompat`, `discoverAnthropic`, liste di modelli hardcoded
- `server/domain/providers/key-resolver.ts` — `KeyResolver` con priorità all'ambiente
- `server/lib/codex-auth.ts` + `server/domain/dispatch/providers/codex.provider.ts` — detection e provider Codex CLI
- `server/domain/mcp/bridge/bridge.service.ts` + `server/routes/mcp-bridge.routes.ts` — bridge MCP su loopback per i provider CLI agentici
- `server/domain/providers/openai-endpoints.store.ts` / `openai-endpoints.types.ts` — configurazione cifrata degli endpoint openai-compat
- `src/stores/sessions.store.ts` — `providerName` persistente per sessione

## Vedi anche

- [Vault delle chiavi](key-vault.md) — come le chiavi API dei provider sono cifrate a riposo
- [Architettura](../../architecture.md) (in inglese) — dove si collocano i provider nel ciclo di dispatch
- [Configurazione](../../reference/configuration.md) (in inglese) — `AETHER_DEFAULT_PROVIDER` e le variabili d'ambiente dei provider
