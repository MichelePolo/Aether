# Scheduler — Guida ai test manuali (slice 31)

Guida pratica per collaudare a mano la feature **Scheduled / Background Agents**:
schedule cron/intervallo che eseguono un agente (prompt o swarm) in autonomia, con
i risultati persistiti nella history.

Tutto gira dentro l'unico processo Node del server (il poller vive lì): non serve
nulla di esterno.

---

## 0. Setup & avvio

| Cosa | Comando / valore |
|---|---|
| Avvio offline (consigliato per lo smoke) | `AETHER_FAKE_PROVIDER=1 npm run dev` |
| Avvio con provider reale | `ANTHROPIC_API_KEY=… npm run dev` (o `GEMINI_…`/`OPENAI_…`/`OLLAMA_HOST`) |
| Disabilitare il poller (solo run manuali) | `AETHER_SCHEDULER=0 npm run dev` |
| URL UI / API | `http://localhost:3000` — API sotto `/api/schedules` |
| DB SQLite | `./data/aether.sqlite` (override con `AETHER_DATA_DIR`) |

**Parametri di timing da tenere a mente** (non configurabili da UI):
- **Tick del poller:** ogni **30 s** + un tick all'avvio (boot catch-up).
- **Intervallo minimo di una schedule:** **60 000 ms (1 min)** — imposto dallo schema Zod.
- Conseguenza: una schedule a intervallo di 1 min parte la prima volta ~1 min dopo la
  creazione e viene raccolta dal tick entro ~30 s → fino a ~**90 s** di attesa reale.
- Per un test **istantaneo** usa sempre il pulsante **▶ Run now** (non aspetta la cadenza).

> Suggerimento: tieni aperto un terminale con il log del server e uno con `sqlite3`/`curl`
> per osservare gli effetti dei run.

---

## 1. Dove si trova nella UI

Nella **sidebar** c'è la sezione **Schedules** (sotto Swarms). Per ogni schedule:
- 🟢/⚫ pallino di stato = `enabled`/disabilitata;
- nome **(cadenza)** — la cadenza mostra l'espressione cron oppure `every Nm`;
- **▶ Run now** · **✏️ Edit** · **🗑 Delete**.

`+ New` apre il modal con: nome, cadenza (cron|interval), target (prompt|swarm),
`@subagent` opzionale / input iniziale dello swarm, checkbox **Trusted** e **Enabled**.

> ⚠️ La lista dei **run** (esiti) **non** è in UI: si verifica via API `GET /:id/runs`,
> via DB, oppure osservando le **sessioni** che ogni run crea nella history.

---

## 2. Test A — Smoke: prompt + Run now (fake provider)

**Obiettivo:** un run manuale crea una sessione e registra un esito `success`.

1. Avvia con `AETHER_FAKE_PROVIDER=1 npm run dev`.
2. Sidebar → Schedules → **+ New**:
   - Name: `smoke`
   - Cadence: `interval`, Every minutes: `60`
   - Target: `prompt`, Prompt: `Dì ciao e fermati.`
   - Autonomy: lascia **safe** (Trusted off), Enabled on → **Save**.
3. Sulla riga `smoke` premi **▶ Run now**.

**Atteso:**
- Compare una **nuova sessione** nella lista sessioni (il run la crea via `createEmpty`);
  aprendola vedi il messaggio utente e la risposta del fake provider.
- `GET /api/schedules/<id>/runs` mostra un run con `status: "success"` e un `sessionId`
  valorizzato (vedi §11 per i comandi).

---

## 3. Test B — Verifica del record di run via API

```bash
# elenca le schedule e prendi l'id
curl -s localhost:3000/api/schedules | jq

# storico run di quella schedule (max 20, più recenti prima)
curl -s localhost:3000/api/schedules/<ID>/runs | jq
```

**Atteso:** ogni elemento ha `id`, `scheduleId`, `sessionId` (o `null` per uno swarm
fallito prima di creare la sessione), `startedAt`, `finishedAt`, `status`
(`success` | `error` | `rejected`), e `error` se fallito.

---

## 4. Test C — Poller automatico (cadenza, senza Run now)

**Obiettivo:** la schedule parte da sola alla cadenza, senza doppio-fire.

1. **+ New**: Name `tick`, Cadence `interval` Every minutes `1`, prompt qualsiasi,
   safe, Enabled → Save. (In alternativa, cron `* * * * *` = ogni minuto.)
2. **Non** premere Run now. Aspetta ~90 s osservando i run via API o il DB.

**Atteso:**
- Entro ~90 s appare **un** nuovo run; poi **uno** nuovo ad ogni minuto.
- `next_run_at` nel DB **avanza prima** dello sparo (niente doppio-fire nello stesso tick);
  `last_run_at` si aggiorna ad ogni esecuzione.
- Se un run è ancora in corso quando scatterebbe il successivo, quello nuovo viene
  **saltato** (niente sovrapposizione sulla stessa schedule).

---

## 5. Test D — Autonomia **safe**: i tool gated vengono rifiutati

> Richiede un **provider reale** e un workspace con un MCP "di coding" (Terminal/Git),
> perché il fake provider non chiama davvero tool pericolosi. Senza provider reale,
> questo comportamento è comunque coperto dai unit test (`schedule-runner.test.ts`).

1. Avvia con un provider reale e abilita il MCP Terminal/Git su un workspace.
2. **+ New**: target `prompt`, autonomy **safe**, prompt che induce un'azione
   **pericolosa**, es. `Esegui \`rm -rf tmpdir\`` oppure `Fai git push`.
3. **▶ Run now** e apri la sessione creata.

**Atteso:**
- Nessun comando pericoloso viene eseguito: la chiamata gated viene **rifiutata
  all'istante** (nessuna attesa di 60 s, perché non c'è un umano che approva).
- Il run si chiude (tipicamente `success` per il turno, ma **senza** l'effetto
  collaterale pericoloso) — verifica che il file/azione **non** sia avvenuta.

---

## 6. Test E — Autonomia **trusted**: auto-approva tutto

> Stesso setup del Test D (provider reale + MCP). ⚠️ `trusted` esegue azioni
> potenzialmente distruttive senza conferma: usalo su un workspace usa-e-getta.

1. Duplica la schedule del Test D ma spunta **Trusted**.
2. **▶ Run now**.

**Atteso:** il tool pericoloso viene **eseguito** (auto-approvato). L'effetto collaterale
ora avviene davvero. Conferma così che `trusted` è opt-in esplicito e cambia il comportamento.

---

## 7. Test F — Swarm con step `pauseAfter` (il caso corretto in review)

**Obiettivo:** verificare che l'override di autonomia copra anche le approvazioni
**degli step swarm**, non solo i tool MCP.

Prerequisito: avere uno **swarm** con almeno uno step che ha **Pause after** attivo
(creane uno nella sezione Swarms se non c'è).

1. **+ New**: target `swarm`, scegli lo swarm con lo step in pausa, input iniziale
   opzionale.
2. Esegui due varianti con **Run now**:
   - **Autonomy = trusted** → lo step in pausa viene **auto-approvato** e lo swarm
     **prosegue** fino in fondo. Run `success`.
   - **Autonomy = safe** → lo step in pausa viene **rifiutato subito** (niente stallo
     fino al timeout di 5 min). Run `rejected`.

**Atteso (perché conta):** prima del fix di review, un `trusted` non auto-approvava lo
step (restava bloccato fino a ~5 min poi `rejected`) e un `safe` stallava 5 min. Ora
entrambi decidono **istantaneamente**.

---

## 8. Test G — Enable/disable, edit→reschedule, delete (cascade)

1. **Disable:** togli la spunta **Enabled** e salva → nel DB `next_run_at` diventa
   `NULL` e il poller **non** la fa più partire (pallino grigio).
2. **Re-enable:** rimetti Enabled → `next_run_at` viene **ricalcolato** dalla cadenza.
3. **Edit cadenza:** cambia es. da 60 a 1 min e salva → `next_run_at` si ricalcola
   subito (non aspetta il vecchio intervallo).
4. **Swarm input round-trip:** apri in Edit una schedule swarm con input → il campo
   "Initial input" è **precompilato** (non viene perso al salvataggio).
5. **Delete:** elimina la schedule → sparisce dalla lista e i suoi `schedule_runs`
   vengono rimossi in **cascade** (FK `ON DELETE CASCADE`); verifica nel DB.

---

## 9. Test H — Validazione (errori attesi 400)

Via API (la UI limita alcuni input, l'API li valida tutti):

```bash
# interval troppo corto (< 60_000 ms) → 400
curl -s -X POST localhost:3000/api/schedules -H 'content-type: application/json' \
  -d '{"name":"x","cadence":{"kind":"interval","everyMs":1000},"target":{"kind":"prompt","prompt":"hi"}}' | jq

# cron non valido → 400
curl -s -X POST localhost:3000/api/schedules -H 'content-type: application/json' \
  -d '{"name":"x","cadence":{"kind":"cron","expr":"non valido"},"target":{"kind":"prompt","prompt":"hi"}}' | jq

# nome/prompt vuoti → 400
curl -s -X POST localhost:3000/api/schedules -H 'content-type: application/json' \
  -d '{"name":"","cadence":{"kind":"interval","everyMs":60000},"target":{"kind":"prompt","prompt":""}}' | jq
```

**Atteso:** ognuno risponde `400` con `{ "error": { "code", "message" } }`.

---

## 10. Test I — `AETHER_SCHEDULER=0` e persistenza al riavvio

**Poller disattivato:**
1. Riavvia con `AETHER_SCHEDULER=0 AETHER_FAKE_PROVIDER=1 npm run dev`.
2. Crea una schedule a 1 min e aspetta 2 min: **nessun** run automatico.
3. **▶ Run now** funziona comunque (le route restano montate; `=0` ferma solo il poller).

**Boot catch-up (persistenza):**
1. Riavvia **senza** `AETHER_SCHEDULER=0`. Con una schedule abilitata il cui
   `next_run_at` è già nel passato (es. creata, poi server spento qualche minuto),
   al boot parte **un** run di recupero, poi riprende la cadenza normale.

---

## 11. Appendice — API & DB

### API (curl)

```bash
# crea (201) → ritorna la schedule con id e next_run_at
curl -s -X POST localhost:3000/api/schedules -H 'content-type: application/json' -d '{
  "name":"nightly","cadence":{"kind":"cron","expr":"0 3 * * *"},
  "target":{"kind":"prompt","prompt":"Riassumi i commit di oggi.","subAgent":"researcher"},
  "autonomy":"safe","enabled":true
}' | jq

curl -s localhost:3000/api/schedules | jq                  # lista
curl -s localhost:3000/api/schedules/<ID> | jq             # singola
curl -s -X PUT localhost:3000/api/schedules/<ID> \
  -H 'content-type: application/json' -d '{"enabled":false}' | jq   # update parziale
curl -s -X POST localhost:3000/api/schedules/<ID>/run | jq # 202, esegue subito
curl -s localhost:3000/api/schedules/<ID>/runs | jq        # storico run
curl -s -X DELETE localhost:3000/api/schedules/<ID> -i     # 204
```

Body del target:
- prompt: `{"kind":"prompt","prompt":"…","subAgent":"nome"?}`
- swarm: `{"kind":"swarm","swarmId":"…","input":"…"?}`

### DB (sqlite3)

```bash
sqlite3 data/aether.sqlite '.schema schedules'        # colonne esatte
sqlite3 data/aether.sqlite \
  'SELECT id,name,autonomy,enabled,next_run_at,last_run_at FROM schedules;'
sqlite3 data/aether.sqlite \
  'SELECT id,schedule_id,session_id,status,error,started_at,finished_at
   FROM schedule_runs ORDER BY started_at DESC LIMIT 10;'
```

`next_run_at`/`last_run_at` sono epoch in **millisecondi** (o `NULL` se disabilitata).

---

## 12. Checklist rapida

- [ ] A — Run now su prompt safe → sessione creata + run `success`
- [ ] B — `GET /:id/runs` mostra il record con `sessionId`
- [ ] C — poller fa partire la schedule da sola (~90 s), `next_run_at` avanza, no doppio-fire
- [ ] D — safe rifiuta il tool pericoloso (no effetto collaterale, nessuno stallo)
- [ ] E — trusted esegue il tool pericoloso (auto-approvato)
- [ ] F — swarm `pauseAfter`: trusted prosegue / safe rifiuta subito
- [ ] G — disable→`next_run_at` NULL; re-enable/edit ricalcola; swarm input round-trip; delete cascade
- [ ] H — interval <60s, cron invalida, campi vuoti → 400
- [ ] I — `AETHER_SCHEDULER=0` ferma il poller ma non Run now; boot catch-up al riavvio

---

## 13. Note / limiti noti

- L'autonomia **safe** rifiuta ciò che *richiede* il gate. Se hai pre-approvato
  globalmente un tool (policy breakpoint) quel tool **non** gate-a e quindi parte:
  è coerente con "safe rifiuta i tool gated", ma tienilo presente.
- Non esiste (ancora) un pannello UI per lo storico dei run: usa API/DB/sessioni.
- Tetto massimo per run: **30 min** (poi il run viene abortito).
- Intervallo minimo **1 min**: non si possono pianificare cadenze al secondo.
