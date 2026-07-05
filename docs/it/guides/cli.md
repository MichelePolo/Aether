# CLI

> 🇮🇹 Traduzione derivata — la versione di riferimento è quella inglese: [CLI](../../guides/cli.md).

Cosa copre: la CLI headless `aether` — il daemon in background con cui comunica, il dispatch di prompt one-shot, e le sue modalità di output stdout/stderr/JSON. Leggilo quando scrivi script contro Aether, fai debug di un flag della CLI, o cambi il comportamento del ciclo di vita del daemon.

## Come funziona

**Ciclo di vita del daemon**: la CLI è un client sottile sopra lo stesso server Express usato dalla web UI, eseguito come processo in background staccato (detached). `aether daemon start` (`cli/daemon.ts` `startDaemon`, collegato in `cli/index.ts`) sonda prima `/api/health` — se qualcosa è già in ascolto, riporta `already: true` invece di avviarne un duplicato (che altrimenti fallirebbe silenziosamente con `EADDRINUSE` sotto `stdio: 'ignore'`). Altrimenti avvia `node dist/server.cjs` (`cli/runtime.ts` `defaultDeps`) staccato, forzando `NODE_ENV=production` così serve la SPA prebuilt da `dist/` invece di provare a montare Vite — **`npm run build` è un prerequisito** perché `daemon start` funzioni. Sonda lo stato di salute ogni 500 ms (40 tentativi) finché il server risponde. Il daemon si lega a `127.0.0.1` (solo loopback, secondo `resolveEndpoint()` in `cli/config.ts`, che rispetta anche un file `daemon.json` e `PORT`/`--port`). `aether daemon status` riporta `running`/`stopped` più pid/porta; `aether daemon stop` invia `SIGTERM` al pid registrato e cancella il file del daemon; `aether daemon restart` ferma e poi riavvia.

**Prompt one-shot**: `aether "<prompt>"` crea una nuova sessione (a meno che non venga fornito `--session ID` per riusarne una, stampato su stderr come `aether: session <id>` così stdout resta solo la risposta) e invia il prompt esattamente come farebbe la web UI, trasmettendo la risposta SSE in streaming. `--provider <name>` sovrascrive il provider per quel dispatch (vedi [Provider](providers.md) per la precedenza di selezione in cui si inserisce).

**Piping da stdin**: se stdin non è un TTY, la CLI lo legge interamente e lo aggiunge al prompt come blocco di codice delimitato (`cli/index.ts` `readStdin`) — es. `cat file.ts | aether "review this"`.

**Modalità di output**: per default (`cli/output.ts` `handleEvent`), i chunk `text` vanno su **stdout** (così `aether "prompt" > out.txt` cattura solo la risposta del modello), mentre i chunk `thinking`, le righe di richiesta/risultato di chiamata a strumento, e la riga dell'id di sessione vanno tutte su **stderr**, in colore attenuato. Con `--json`, ogni evento SSE viene invece scritto su stdout come un oggetto JSON per riga (JSONL) — incluso `done`/`error` — per scripting.

**Le chiamate a strumenti soggette a gate vengono auto-rifiutate, non lasciate scadere**: a differenza della web UI (che mostra un prompt di approvazione/rifiuto), la CLI non ha un gate interattivo. Quando arriva un evento SSE `tool_call_request` per una chiamata soggetta a gate, `cli/index.ts` chiama immediatamente `rejectDecision(baseUrl, callId)` (`cli/client.ts`), che invia una POST `{ callId, action: 'reject' }` a `/api/mcp/decision` — best-effort, una chiamata di rifiuto fallita non deve mai far crashare lo stream. Questo significa che un dispatch guidato dalla CLI non resta mai in attesa del timeout di 24 ore del gate dei [breakpoint](breakpoints.md); le chiamate a strumenti pericolose/esterne vengono attivamente rifiutate nell'ambito della stessa richiesta.

**Memorizzazione condivisa**: la CLI e la web UI sono lo stesso processo server che parla con lo stesso database SQLite — una sessione creata via CLI compare nella lista delle sessioni della web UI e viceversa, e `--session <id>` permette a uno script di continuare una conversazione iniziata in uno dei due posti.

## File chiave

- `cli/index.ts` — `main`, `runPrompt`: dispatch degli argomenti, piping da stdin, il collegamento dell'auto-rifiuto
- `cli/args.ts` — `parseArgs`: `--json`, `--open`, `--provider`, `--session`, `--port`, `daemon <action>`
- `cli/daemon.ts` — `startDaemon`/`statusDaemon`/`stopDaemon`
- `cli/runtime.ts` — `defaultDeps`: avvia `dist/server.cjs` con `NODE_ENV=production`
- `cli/config.ts` — `resolveEndpoint`: binding `127.0.0.1`, ordine di risoluzione della porta
- `cli/output.ts` — `handleEvent`: separazione stdout/stderr, modalità JSONL `--json`
- `cli/client.ts` — `createSession`, `dispatch`, `rejectDecision`

## Vedi anche

- [Breakpoint](breakpoints.md) — il gate di approvazione che la CLI auto-rifiuta invece di attendere
- [Provider](providers.md) — `--provider` e la precedenza di selezione del provider in cui si inserisce
- [Architettura](../../architecture.md) (in inglese) — il modello a processo singolo Express + SSE su cui si basa la CLI
