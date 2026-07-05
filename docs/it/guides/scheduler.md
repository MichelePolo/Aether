# Scheduler

> 🇮🇹 Traduzione derivata — la versione di riferimento è quella inglese: [Scheduler](../../guides/scheduler.md).

Cosa copre: il poller in background che avvia prompt/swarm pianificati (cadenza cron o a intervalli) senza alcun processo esterno al singolo server Node. Leggilo quando fai debug del perché una pianificazione non è scattata, cambi le costanti di temporizzazione, o eserciti manualmente la funzionalità.

## Come funziona

`SchedulerService` (`server/domain/schedules/scheduler.service.ts`) gira interamente dentro lo stesso processo Node del resto dell'app — nessun cron esterno, nessun worker separato. `start()` avvia subito un `tick()` (recupero all'avvio, così una pianificazione il cui `next_run_at` è già nel passato quando il server (ri)parte ottiene subito un'esecuzione di recupero) e poi un `setInterval` ogni **30 s** (`TICK_MS = 30_000`). Ogni tick chiede al negozio le pianificazioni scadute (`listDue(now)`), e per ognuna: avanza `next_run_at` e `last_run_at` **prima** di avviare l'esecuzione (così un'esecuzione lenta non può essere riavviata dal tick successivo), la salta se il suo `workspaceId` punta a un workspace che non esiste più (registra un avviso invece di ricadere silenziosamente sulla radice filesystem integrata / `process.cwd()`), e la salta se un'esecuzione per quella pianificazione è ancora in corso (insieme `running`, indicizzato per id di pianificazione — nessuna esecuzione sovrapposta della stessa pianificazione).

**Intervallo minimo**: lo schema della cadenza `interval` (`server/domain/schedules/schedules.schema.ts`) impone `everyMs` ≥ **60 000 ms (1 minuto)** tramite Zod. Combinato con il tick di 30 s, una pianificazione da 1 minuto appena creata può impiegare fino a circa **90 s** prima della sua prima esecuzione automatica — il poller controlla solo ogni 30 s, e la pianificazione stessa non sarà scaduta per un minuto intero. Usa il pulsante **▶ Esegui ora** (o `POST /api/schedules/:id/run`) per un'esecuzione istantanea che aggira completamente la cadenza.

**Disabilitazione**: impostare `AETHER_SCHEDULER=0` salta `scheduler.start()` all'avvio (`server/index.ts`) — il poller non gira mai, ma le route `/api/schedules` restano montate, quindi `Esegui ora` e il CRUD continuano a funzionare.

**Limite massimo di esecuzione**: `schedule-runner.ts` impone un limite rigido di **30 minuti** a una singola esecuzione (`MAX_RUN_MS`), dopo il quale viene interrotta.

**Tipi di target**: il `target` di una pianificazione è o `{ kind: 'prompt', prompt, subAgent? }` (vedi [Subagent e swarm](subagents-swarms.md) per come si risolve `subAgent`) o `{ kind: 'swarm', swarmId, input? }`. La cadenza è o `{ kind: 'cron', expr }` (validata da `isValidCron`) o `{ kind: 'interval', everyMs }`. L'API vive sotto `/api/schedules` (`server/routes/schedules.routes.ts`, montata in `server/app.ts`), sostenuta da `ScheduleStore` ed eseguita da `ScheduleRunner`; l'esito di ogni esecuzione viene registrato (`success` / `error` / `rejected`, più il `sessionId` che ha creato) e recuperabile tramite `GET /api/schedules/:id/runs`.

## Provarlo

Un rapido test manuale, senza servizi esterni richiesti:

1. Avvia con il provider fake deterministico: `AETHER_FAKE_PROVIDER=1 npm run dev`.
2. Nella sidebar, apri **Schedules** → **+ New**: nome `smoke`, cadenza `interval` ogni `60` minuti, target `prompt` con qualcosa come "Say hi and stop.", lascia l'autonomia a **safe**, abilitala, salva.
3. Clicca **▶ Run now** sulla riga `smoke`.

Atteso: appare una nuova sessione nella lista delle sessioni (l'esecuzione la crea), e `GET /api/schedules/<id>/runs` mostra un'esecuzione con `status: "success"` e un `sessionId` popolato. Non c'è ancora un pannello di cronologia esecuzioni nell'interfaccia — ispeziona gli esiti delle esecuzioni tramite l'endpoint `/runs`, la tabella `schedule_runs`, o aprendo la sessione creata dall'esecuzione.

Per osservare il poller scattare da solo invece di usare `Run now`, crea una pianificazione con un intervallo di 1 minuto, non cliccare nulla, e attendi fino a ~90 s — un flusso senza `Run now` che esercita insieme la cadenza e il tick da 30 s, utile per confermare che non c'è doppio scatto (`next_run_at` avanza prima che l'esecuzione parta) e nessuna sovrapposizione (una pianificazione ancora in esecuzione viene saltata al tick successivo).

## File chiave

- `server/domain/schedules/scheduler.service.ts` — `SchedulerService`: il tick da 30 s, il recupero all'avvio, il ciclo delle pianificazioni scadute
- `server/domain/schedules/schedules.schema.ts` — validazione cadenza/target, il limite minimo di 60 000 ms per l'intervallo
- `server/domain/schedules/schedule-runner.ts` — `ScheduleRunner`, `MAX_RUN_MS` (30 min)
- `server/domain/schedules/schedules.store.ts` — `ScheduleStore`: CRUD, `listDue`, cronologia esecuzioni
- `server/routes/schedules.routes.ts` — CRUD `/api/schedules`, `/:id/run`, `/:id/runs`
- `server/index.ts` — il gate `AETHER_SCHEDULER=0` intorno a `scheduler.start()`

## Vedi anche

- [Subagent e swarm](subagents-swarms.md) — cosa invia effettivamente una pianificazione con target prompt o swarm
- [Workspace](workspaces.md) — perché una pianificazione salta la sua esecuzione quando il suo workspace è stato eliminato
- [Configurazione](../../reference/configuration.md) (in inglese) — `AETHER_SCHEDULER`, `AETHER_FAKE_PROVIDER`
