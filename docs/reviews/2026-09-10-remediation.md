# Correzioni della code review

Branch: `fix/comprehensive-review`. Riferimento: [review del 9 settembre](2026-09-09-code-review.md).

I 30 rilievi numerati sono stati corretti. La migrazione **020_review_integrity.sql** aggiunge dati senza modificare le migrazioni precedenti: credenziali HTTP MCP cifrate, policy builtin persistenti e contesto dei messaggi necessario a Resume.

| Rilievi | Correzione |
|---|---|
| 01 | Solo le immagini raster consentite vengono visualizzate inline; HTML/SVG e altri allegati vengono scaricati, con CSP sandbox e nosniff. |
| 02 | Controllo Host, Origin e Sec-Fetch-Site prima delle route API. I client remoti richiedono un bearer token e un Host esplicitamente consentito. |
| 03 | La cancellazione del dispatch raggiunge gate e tool; listener e decisioni pendenti vengono rimossi. |
| 04 | La cancellazione di una workspace disabilita i job e conserva i riferimenti di schedule/swarm: un'esecuzione richiede la riassegnazione anziché scegliere un'altra root. |
| 05 | Codex riceve l'intera system instruction tramite `developer_instructions`. |
| 06 | Nomi dei tool OpenAI/Gemini validi, stabili, limitati in lunghezza e mappati ai nomi MCP originali. |
| 07 | Evento `message_ids` con riconciliazione delle bolle locali, degli indici e degli allegati con i record persistiti. |
| 08 | Consumer tool condiviso tra chat, Swarm e TDD; coda delle approvazioni e pulizia limitata alle chiamate della singola esecuzione. |
| 09, 14 | Transcript cumulativo per round con testo, tutte le chiamate, argomenti e risultati nell'ordine corretto. |
| 10 | UUID distinti per le approvazioni di ogni run/step e rifiuto dei duplicati pendenti. |
| 11 | TDD risolve una workspace registrata e passa la stessa directory ai test e lo stesso workspace ID al fixer. |
| 12 | Le chiavi del vault vengono risolte dinamicamente; nessuna copia della chiave Anthropic in process.env. |
| 13 | Limite effettivo dei tool: termina i loop SDK e impedisce round manuali illimitati anche se il provider continua a chiedere chiamate. |
| 15 | Export con bytes degli allegati, import compatibile con file vuoti, roundtrip del consumo token e limite HTTP di import a 50 MB. |
| 16 | La scelta UI viene inviata come fallback; il modello del sub-agent conserva la propria precedenza. |
| 17 | Snapshot di istruzioni, provider, root, sub-agent e thinking per Resume; i messaggi precedenti richiedono un fork. |
| 18 | Ricostruzione del contenuto degli allegati testuali e delle immagini della history prima dell'invio al provider. |
| 19 | HTTP MCP con initialize completo, notifications/initialized, risposte JSON/SSE, protocol/session headers e DELETE di chiusura. |
| 20 | Header HTTP MCP persistiti con AES-GCM usando la chiave del vault. |
| 21 | Gli errori terminali dell'SDK Anthropic diventano errori del dispatch. |
| 22 | Le pianificazioni interrotte o prive di completamento esplicito vengono registrate come errori. |
| 23 | Normalizzazione condivisa di `isError` per MCP HTTP e stdio. |
| 24 | Stage, unstage e discard propagano gli errori Git invece di restituire successo. |
| 25 | Shell con stato di uscita strutturato, attesa della chiusura stdio, timeout e cancellazione dell'albero dei processi. TDD usa lo stato strutturato. |
| 26, 27 | Distinzione tra default del trasporto e override esplicito; policy builtin persistenti e selezionate per root. |
| 28 | Classificazione, MIME e limiti degli allegati condivisi tra client e server; normalizzazione dei MIME browser vuoti. |
| 29 | Una hydration tardiva non sostituisce i messaggi modificati dopo l'avvio della richiesta. |
| 30 | Configurazione del dispatcher condivisa tra esecuzioni interattive e pianificate, incluse skill, workspace, preview e limite tool. |

Ulteriori consolidamenti: unico asyncHandler per 16 router; consumer chat unico per send/resume; helper updateSession deduplicato; un solo dispatch attivo per sessione; Retry dei messaggi persistiti senza duplicare la richiesta utente; cleanup di dispatcher, schedule, MCP e database; classificazione prudente dei tool sconosciuti e riconoscimento delle azioni esterne. Le decisioni UI vengono chiuse solo dopo conferma server e non modificano altre approvazioni concorrenti.

## Dipendenze

Lockfile rigenerato rispettando i vincoli semver del progetto, con override `qs: ^6.16.0` perché Express 4 fissa una versione vulnerabile. Nessuna migrazione a Express 5. L'aggiornamento ha richiesto npm 11 temporaneo a causa di un errore interno `edgesOut` del gestore npm installato. Il manifest non impone npm 11 per l'uso ordinario.

Audit del grafo installato, incluse dipendenze dev: **0 vulnerabilità**. Prima della correzione, il solo grafo di produzione aveva 13 segnalazioni, di cui 6 high.

## Verifiche

- Type-check: `npm run lint`, superato.
- Suite sulla base `main` della PR: **277 file, 2.276 test superati**. Prima del riallineamento, il branch che comprendeva anche le funzionalità Skill Smith aveva superato 279 file e 2.288 test. Le correzioni aggiungono 40 test di regressione.
- Build di produzione: `npm run build`, superata.
- Smoke del bundle con dati/libreria temporanei: `npm run smoke:prod`, superato.
- Audit: `npm audit --json`, 0 vulnerabilità.
- `git diff --check`, superato.

Le regressioni coprono, tra gli altri, Host/Origin/token, allegati attivi ed export/import, cifratura degli header, lifecycle HTTP MCP, approvazioni concorrenti, abort dei gate e della shell, budget dei tool, transcript cumulativo, ID persistiti, Retry/Resume, TDD, esiti scheduler e errori Git. I provider remoti sono verificati con fixture e mock: non sono state effettuate chiamate a pagamento. I test di processo sono stati eseguiti su Linux; il percorso Windows usa taskkill ed è da verificare nella CI Windows.

## Comportamenti e limiti da conoscere

- L'accesso loopback rimane utilizzabile senza token da processi locali fidati. Non fornisce isolamento tra utenti/processi della stessa macchina. L'esposizione remota richiede `AETHER_ALLOWED_HOSTS` e `AETHER_API_TOKEN`; l'interfaccia browser non include un nuovo flusso di login remoto.
- TDD richiede che la directory sia registrata come workspace. Dopo la rimozione di una workspace, i riferimenti delle automazioni vanno riassegnati esplicitamente.
- Lo snapshot esatto del contesto è disponibile per i nuovi messaggi. Le conversazioni precedenti alla migrazione usano la ricostruzione compatibile del contesto corrente.
- L'import gestisce payload fino a 50 MB; archivi più grandi richiedono un futuro formato streaming. Il formato di export resta v1.
- Le raccomandazioni strutturali della review su rollback ottimistici generalizzati, soglie coverage progressive, controllo di tutta la CLI/JavaScript e separazione/lazy loading del bundle restano interventi distinti. La build segnala ancora un chunk frontend superiore a 500 kB. Non sono state nascoste queste limitazioni modificando le soglie.
