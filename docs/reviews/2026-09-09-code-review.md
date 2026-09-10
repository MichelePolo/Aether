> Aggiornamento 10 settembre: i 30 rilievi numerati sono stati corretti nel branch `fix/comprehensive-review`. Vedere [correzioni, verifiche e limiti](2026-09-10-remediation.md). Il testo seguente descrive lo stato esaminato prima delle correzioni.

**Code review — Aether Core, 9 settembre 2026**

Revisione del commit `24d1f4a8`, versione `0.1.29`. Il repository era pulito. Ho esaminato i principali percorsi di backend, frontend, persistenza, provider, MCP, pianificazioni, swarm, TDD, CLI, desktop e distribuzione. I rilievi riguardano il codice corrente, non soltanto l'ultimo commit. Non ho modificato il codice applicativo.

**Esito:** 30 rilievi: 13 P1 e 17 P2. P1 indica un problema da correggere con priorità alta per sicurezza, operazioni sul progetto sbagliato o funzionalità centrali compromesse; P2 indica un difetto concreto da pianificare. Le opportunità di deduplicazione e manutenzione sono elencate separatamente e non gonfiano il conteggio.

**Verifiche eseguite**

- `npm run lint`: superato.
- `npm run test:run`: 276 file e 2.248 test superati. Il primo tentativo nella sandbox falliva per `listen EPERM`; il risultato riportato è quello della riesecuzione con porte locali e processi figli consentiti.
- `npm run build`: superato. Bundle frontend principale di 673,36 kB minificati, 195,90 kB gzip; Vite segnala la dimensione superiore a 500 kB.
- Smoke test della build di produzione: superato, usando database temporaneo, libreria in `/tmp` e scheduler disattivato.
- 20 verifiche diagnostiche aggiuntive: tutte confermano il comportamento difettoso descritto dalle rispettive asserzioni. **Non sono test che dimostrano l'assenza di bug**: documentano il comportamento attuale con database in memoria, provider e risposte HTTP fittizi.
- `npm audit --omit=dev --json`: 13 dipendenze segnalate, 6 high e 7 moderate; dettaglio e limiti più avanti.

Non ho eseguito chiamate a pagamento ai provider, exploit contro servizi esterni, la suite Playwright completa o il packaging desktop su Windows/macOS. Dove manca una riproduzione dinamica, il rilievo deriva dal percorso di codice indicato. La prova HTTP sugli allegati verifica MIME, contenuto e header; non simula un attacco DNS nel browser.

**Rilievi P1**

**01. Allegati attivi serviti sullo stesso origin dell'API: stored XSS.**  
[server/routes/attachments.routes.ts:20](/home/michele/Documenti/Workspaces/Aether/server/routes/attachments.routes.ts:20); [server/domain/history/history.export.ts:47](/home/michele/Documenti/Workspaces/Aether/server/domain/history/history.export.ts:47).  
Il download copia il MIME controllato dall'input e usa `Content-Disposition: inline`, senza CSP sandbox. L'import accetta HTML/SVG senza una whitelist; anche il dispatch accetta `text/html`. Aprendo l'URL dell'allegato come documento, lo script ha l'origin dell'app e può chiamare le API locali, incluso il reveal delle chiavi da loopback. La prova ha salvato HTML innocuo e verificato che venga restituito integralmente come `text/html` inline. Correzione: download forzato per contenuto attivo, MIME normalizzato, `nosniff`; eventuale preview su origin isolato o con sandbox restrittiva. La sola sanitizzazione del Markdown non copre questa route.

**02. L'API locale non valida Host/Origin né autentica le operazioni sensibili.**  
[server/app.ts:82](/home/michele/Documenti/Workspaces/Aether/server/app.ts:82); [server/routes/providers.routes.ts:185](/home/michele/Documenti/Workspaces/Aether/server/routes/providers.routes.ts:185).  
Le route vengono montate direttamente. Una richiesta con `Host: audit.invalid` e `Origin: http://audit.invalid` riceve dati normalmente. Il bind su loopback limita la rete ma non costituisce protezione applicativa contro DNS rebinding; anche il reveal controlla solo l'indirizzo del socket. In un browser e una rete che consentono il rebinding, un sito può raggiungere API capaci di eseguire comandi. La fattibilità completa dipende dalle protezioni del browser; la mancanza del controllo è verificata. Correzione: allowlist Host/Origin prima di tutte le route, incluso import/dispatch, e token per l'accesso alle API sensibili. Il modello di minaccia è documentato anche nella [specifica MCP](https://modelcontextprotocol.io/specification/2025-06-18/basic/transports).

**03. Stop/disconnessione non annullano il gate o il tool in esecuzione.**  
[server/domain/dispatch/dispatch.service.ts:180](/home/michele/Documenti/Workspaces/Aether/server/domain/dispatch/dispatch.service.ts:180); [server/domain/dispatch/dispatch.service.ts:237](/home/michele/Documenti/Workspaces/Aether/server/domain/dispatch/dispatch.service.ts:237); [server/domain/mcp/registry.ts:294](/home/michele/Documenti/Workspaces/Aether/server/domain/mcp/registry.ts:294).  
L'AbortSignal del dispatch non viene passato all'attesa dell'approvazione. Il tool riceve inoltre un nuovo controller indipendente. Una richiesta può restare pendente per 24 ore dopo Stop e, se approvata successivamente, eseguire comunque il comando. La prova abortisce durante il gate: `callTool` viene ancora invocato con un signal non abortito. Correzione: collegare cancellazione del dispatch, attesa del gate e chiamata MCP; ricontrollare il signal subito prima dell'esecuzione e rimuovere le decisioni pendenti.

**04. Eliminare un workspace lascia attive le sue pianificazioni sul contesto di fallback.**  
[server/domain/workspaces/workspaces.store.ts:55](/home/michele/Documenti/Workspaces/Aether/server/domain/workspaces/workspaces.store.ts:55); [server/domain/schedules/scheduler.service.ts:39](/home/michele/Documenti/Workspaces/Aether/server/domain/schedules/scheduler.service.ts:39).  
La cancellazione azzera `workspace_id` su schedules, swarms e step. Il controllo dello scheduler verifica soltanto ID non vuoti che non esistono più: dopo questa cancellazione non può scattare. Una pianificazione `trusted` rimane abilitata e il dispatch ripiega su root globale/cwd, dove può modificare un altro progetto senza gate. Riprodotto con una pianificazione dovuta che resta abilitata e perde il workspace. Correzione: disabilitare i job interessati o mantenere un riferimento invalido esplicito che blocchi l'esecuzione; richiedere una riassegnazione prima della ripresa.

**05. Il provider Codex scarta interamente il system prompt assemblato.**  
[server/domain/dispatch/providers/codex.provider.ts:154](/home/michele/Documenti/Workspaces/Aether/server/domain/dispatch/providers/codex.provider.ts:154); [server/domain/dispatch/providers/conversation.ts:11](/home/michele/Documenti/Workspaces/Aether/server/domain/dispatch/providers/conversation.ts:11).  
Lo stdin contiene soltanto `renderConversation(req)`, che legge history, pending text e messaggio, ma non `systemInstruction`. Nessun argomento di spawn lo passa separatamente. Scompaiono istruzioni globali, ruolo del subagente, skill, workspace e memoria ETERE. La diagnostica conferma che una regola sentinella non compare nel testo inviato. Correzione: trasmettere esplicitamente il prompt tramite un canale supportato dal provider e verificare il payload completo nel test di spawn.

**06. I nomi dei tool inviati a OpenAI non rispettano il contratto API.**  
[server/domain/dispatch/providers/openai.provider.ts:264](/home/michele/Documenti/Workspaces/Aether/server/domain/dispatch/providers/openai.provider.ts:264).  
`toOpenAITool` invia direttamente nomi come `Filesystem.read_file`. Il punto non è tra i caratteri ammessi dal contratto delle funzioni, che richiede lettere, cifre, underscore o trattino e massimo 64 caratteri. Con MCP attivo una richiesta può essere rifiutata prima della generazione. Il payload è stato catturato in una prova; non è stata invocata l'API reale. Correzione: mappatura reversibile e senza collisioni tra nome API e qualified name, applicata anche a chiamate e risultati. Riferimento: [SDK ufficiale OpenAI, FunctionDefinition](https://github.com/openai/openai-node/blob/main/src/resources/shared.ts).

**07. Gli ID dei messaggi in chat non corrispondono agli ID persistiti.**  
[src/stores/chat.store.ts:133](/home/michele/Documenti/Workspaces/Aether/src/stores/chat.store.ts:133); [src/hooks/useStreamingDispatch.ts:83](/home/michele/Documenti/Workspaces/Aether/src/hooks/useStreamingDispatch.ts:83); [server/domain/dispatch/dispatch.service.ts:591](/home/michele/Documenti/Workspaces/Aether/server/domain/dispatch/dispatch.service.ts:591).  
Client e server generano UUID indipendenti; gli eventi SSE non riconciliano gli identificatori. Branch e Resume passano al backend l'ID della bolla locale, che non esiste nel database. Il fork fallisce nella prova su un messaggio appena inviato; il caricamento successivo della cronologia maschera il difetto sostituendo gli ID. Correzione: ID stabiliti una volta sola oppure evento di conferma che rimappi user/model, attachment e riferimenti UI prima di abilitare queste azioni.

**08. Swarm e TDD ignorano le richieste di approvazione dei tool MCP.**  
[src/hooks/useSwarmRun.ts:73](/home/michele/Documenti/Workspaces/Aether/src/hooks/useSwarmRun.ts:73); [src/hooks/useTddRun.ts:60](/home/michele/Documenti/Workspaces/Aether/src/hooks/useTddRun.ts:60); [server/lib/collecting-sse.ts:24](/home/michele/Documenti/Workspaces/Aether/server/lib/collecting-sse.ts:24).  
Il collector inoltra `tool_call_request`, ma i consumer dei run gestiscono solo gli eventi swarm/TDD e non li inviano a `emitToolCallRequest`. Un subagente che incontra un gate resta in attesa senza alcun controllo visibile per approvarlo. Il problema è particolarmente frequente perché le connessioni MCP reali hanno defaultAutoApprove=false. Correzione: consumer condiviso per gli eventi tool in tutti i flussi SSE, con gestione di richieste simultanee, risultati e cancellazioni.

**09. La conversazione dei tool perde i risultati dei round precedenti.**  
[server/domain/dispatch/dispatch.service.ts:344](/home/michele/Documenti/Workspaces/Aether/server/domain/dispatch/dispatch.service.ts:344); [server/domain/dispatch/dispatch.service.ts:384](/home/michele/Documenti/Workspaces/Aether/server/domain/dispatch/dispatch.service.ts:384); [server/domain/dispatch/providers/openai.provider.ts:275](/home/michele/Documenti/Workspaces/Aether/server/domain/dispatch/providers/openai.provider.ts:275).  
Ogni iterazione conserva solo l'ultimo risultato e riutilizza la history originale. Nella terza chiamata al modello manca il risultato del primo tool, come confermato dalla diagnostica. OpenAI ricostruisce inoltre gli argomenti della chiamata come `{}`, e i builder collocano nuovamente il messaggio utente dopo i risultati. Flussi read→edit→verify possono dimenticare i file letti o ripetere operazioni. Correzione: transcript strutturato append-only per l'intero turno, comprendente richieste, argomenti, risultati e ordine effettivo.

**10. Due esecuzioni dello stesso swarm condividono gli ID di approvazione.**  
[server/domain/swarms/swarm.orchestrator.ts:106](/home/michele/Documenti/Workspaces/Aether/server/domain/swarms/swarm.orchestrator.ts:106); [server/domain/swarms/swarm.approval.ts:17](/home/michele/Documenti/Workspaces/Aether/server/domain/swarms/swarm.approval.ts:17).  
L'ID è `swarmId:stepIndex`, senza run/session ID. La seconda attesa sovrascrive la prima nella Map: approvare il primo pannello sblocca il secondo run, mentre il primo resta pendente. Anche abort/timeout del primo possono eliminare la voce del secondo. Riprodotto con due waiter sullo stesso ID. Correzione: UUID per singola approvazione, associato a run e step; eliminazione condizionata all'identità della voce.

**11. Nel TDD i test e l'agente riparatore operano su root diverse.**  
[server/domain/tdd/tdd.runner.ts:48](/home/michele/Documenti/Workspaces/Aether/server/domain/tdd/tdd.runner.ts:48); [server/domain/tdd/tdd.runner.ts:61](/home/michele/Documenti/Workspaces/Aether/server/domain/tdd/tdd.runner.ts:61); [server/index.ts:334](/home/michele/Documenti/Workspaces/Aether/server/index.ts:334).  
`opts.cwd` viene usato per il comando di test, ma la sessione è creata senza workspace e il dispatch non riceve la cartella. Con cwd diverso dalla root globale, i test girano nel progetto B mentre l'agente legge/modifica A. La prova cattura proprio questa divergenza. Correzione: risolvere e validare un unico workspace per comando, sessione e dispatch.

**12. La rotazione/rimozione della chiave Anthropic può continuare a usare la chiave precedente.**  
[server/index.ts:166](/home/michele/Documenti/Workspaces/Aether/server/index.ts:166); [server/index.ts:171](/home/michele/Documenti/Workspaces/Aether/server/index.ts:171); [server/domain/providers/key-resolver.ts:26](/home/michele/Documenti/Workspaces/Aether/server/domain/providers/key-resolver.ts:26).  
Al boot la chiave nel vault viene copiata in process.env e poi fotografata nell'oggetto `KeyResolver.env`. Gli hook aggiornano process.env e il vault, ma non quella fotografia, che ha precedenza sul vault. Se la chiave proveniva dal vault al boot, aggiornamento e cancellazione dalla UI lasciano utilizzabile quella vecchia nel processo corrente. Riprodotto con snapshot e vault mutabile. Correzione: distinguere vere variabili esterne da credenziali del vault e risolvere queste ultime dinamicamente, senza promuoverle a env immutabile.

**13. Il limite dei tool non limita i round del provider.**  
[server/domain/dispatch/dispatch.service.ts:370](/home/michele/Documenti/Workspaces/Aether/server/domain/dispatch/dispatch.service.ts:370).  
Superato il cap, il loop genera un risultato di errore e riparte con `continue`. Un provider che continua a richiedere tool mantiene il ciclo senza un limite di iterazioni o durata per il dispatch interattivo, pur non eseguendo ulteriori tool. La prova con cap=1 arriva a sei chiamate provider. Correzione: budget separato di round/tempo e conclusione terminale al superamento, eventualmente concedendo una sola risposta conclusiva senza tool.

**Rilievi P2**

**14. Le tool call multiple nello stesso stream vengono scartate dopo la prima.**  
[server/domain/dispatch/dispatch.service.ts:357](/home/michele/Documenti/Workspaces/Aether/server/domain/dispatch/dispatch.service.ts:357).  
Il `break` alla prima function_call chiude l'iteratore asincrono. Gli adapter OpenAI/Ollama/Gemini possono emettere più chiamate nello stesso output, ma le successive non raggiungono il gate né l'esecuzione. La prova con due chiamate registra una sola esecuzione. Correzione: consumare l'intero gruppo di chiamate e restituire tutti i risultati rispettando i limiti; usare sequenzialità se gli effetti non sono indipendenti.

**15. Le sessioni esportate con allegati non possono essere reimportate.**  
[server/domain/history/history.store.ts:181](/home/michele/Documenti/Workspaces/Aether/server/domain/history/history.store.ts:181); [server/domain/history/history.store.ts:525](/home/michele/Documenti/Workspaces/Aether/server/domain/history/history.store.ts:525).  
L'export usa readRecord, che carica solo i metadati degli allegati. L'import pretende contentBase64: un export generato dalla stessa applicazione fallisce con `missing contentBase64`. Riprodotto con un file di un byte. Correzione: includere i BLOB in base64 nell'export e verificare round-trip; riallineare anche i limiti, perché 10 MB binari diventano oltre 13 MB base64, mentre l'import accetta 10 MB JSON. Inoltre lo schema/import scarta tokensIn/tokensOut: il round-trip deve preservare anche l'usage.

**16. La UI sovrascrive sempre il modello configurato nel subagente.**  
[src/hooks/useStreamingDispatch.ts:69](/home/michele/Documenti/Workspaces/Aether/src/hooks/useStreamingDispatch.ts:69); [server/domain/dispatch/dispatch.service.ts:529](/home/michele/Documenti/Workspaces/Aether/server/domain/dispatch/dispatch.service.ts:529).  
Send include il modello della sessione/default come providerName anche quando l'utente usa `@subagent`. Sul server providerName precede matchedSubAgent.model. Il routing cross-model funziona quindi diversamente da quello atteso dalla configurazione del subagente. Correzione: distinguere override esplicito del singolo turno da default di sessione, facendo risolvere al backend la precedenza coerente.

**17. Resume ricostruisce un prompt diverso e perde subagente e skill.**  
[server/domain/dispatch/dispatch.service.ts:776](/home/michele/Documenti/Workspaces/Aether/server/domain/dispatch/dispatch.service.ts:776).  
Resume usa soltanto context.systemInstruction + runtime; non esegue assemble, non risolve la menzione originaria e non carica le skill attive/pinned. Anche il provider è scelto dalla sessione anziché dal turno interrotto. Una continuazione può perdere istruzioni e cambiare modello. Correzione: persistere il contesto effettivo del turno o condividere la stessa preparazione tra handle/resume; proteggere anche il caso di resume di messaggi precedenti all'ultimo turno.

**18. Gli allegati scompaiono dal contesto dei turni successivi.**  
[server/domain/dispatch/dispatch.service.ts:591](/home/michele/Documenti/Workspaces/Aether/server/domain/dispatch/dispatch.service.ts:591); [server/domain/dispatch/dispatch.service.ts:602](/home/michele/Documenti/Workspaces/Aether/server/domain/dispatch/dispatch.service.ts:602).  
Nel database viene salvato il messaggio originale, mentre il testo degli allegati viene aggiunto solo al prompt del turno corrente. La history futura contiene soltanto role/text, senza recuperare testo o immagini degli allegati. “Modifica il file allegato prima” perde il contenuto quando non è stato riportato nella risposta. Correzione: ricostruire messaggi multimodali dalla persistenza, con una politica esplicita di budget e compressione del contesto.

**19. Il trasporto HTTP MCP non completa un handshake conforme.**  
[server/domain/mcp/http-connection.ts:36](/home/michele/Documenti/Workspaces/Aether/server/domain/mcp/http-connection.ts:36); [server/domain/mcp/http-connection.ts:154](/home/michele/Documenti/Workspaces/Aether/server/domain/mcp/http-connection.ts:154); [server/domain/mcp/http-connection.ts:186](/home/michele/Documenti/Workspaces/Aether/server/domain/mcp/http-connection.ts:186).  
Initialize invia params vuoti, Accept supporta solo SSE e il reader interpreta ogni risposta come SSE. Mancano conferma initialized e gestione del session ID per server stateful. Una risposta application/json valida viene rifiutata con `stream closed without response`, riprodotto in diagnostica. Correzione: usare il client ufficiale o implementare lifecycle, negotiation, header e i due content type previsti. Riferimento: [MCP 2025-06-18, trasporti](https://modelcontextprotocol.io/specification/2025-06-18/basic/transports).

**20. Gli header dei server HTTP MCP vengono persi nella persistenza.**  
[server/domain/context/context.store.ts:218](/home/michele/Documenti/Workspaces/Aether/server/domain/context/context.store.ts:218); [server/domain/context/context.store.ts:275](/home/michele/Documenti/Workspaces/Aether/server/domain/context/context.store.ts:275).  
Schema e tipo accettano headers, ma INSERT/SELECT non li salvano. Dopo addMcpServer la configurazione restituita contiene Authorization, mentre read() lo perde già immediatamente; connect() usa questa seconda rappresentazione. Riprodotto. Correzione: migrazione append-only per salvare gli header sensibili cifrati e round-trip completo della configurazione.

**21. Gli errori terminali dell'Agent SDK Anthropic vengono mostrati come successo.**  
[server/domain/dispatch/providers/anthropic.provider.ts:152](/home/michele/Documenti/Workspaces/Aether/server/domain/dispatch/providers/anthropic.provider.ts:152).  
Qualunque evento result produce done, senza leggere is_error, subtype o errors. La definizione SDK installata distingue error_max_turns, error_during_execution e altri errori. Un evento simulato con is_error=true diventa done senza errore nella prova. Questo può far avanzare lo swarm dopo uno step incompleto. Correzione: rispettare l'unione discriminata SDKResultMessage e propagare fallimento e motivo.

**22. Le pianificazioni interrotte vengono registrate come success.**  
[server/domain/schedules/schedule-runner.ts:58](/home/michele/Documenti/Workspaces/Aether/server/domain/schedules/schedule-runner.ts:58).  
outcome() cerca alcuni errori ma ignora done.interrupted e swarm_done.interrupted; in tutti gli altri casi restituisce success, anche senza completamento esplicito. Il timeout di 30 minuti può quindi apparire come riuscita. Riprodotto con un dispatch interrupted. Correzione: stato terminale tipizzato e successo ammesso solo con prova di completamento; introdurre uno stato interrupted o registrare un errore con causa.

**23. Un risultato MCP isError=true viene registrato come ok=true.**  
[server/domain/mcp/http-connection.ts:54](/home/michele/Documenti/Workspaces/Aether/server/domain/mcp/http-connection.ts:54); [server/domain/mcp/stdio-connection.ts:109](/home/michele/Documenti/Workspaces/Aether/server/domain/mcp/stdio-connection.ts:109).  
I due adapter considerano riuscita ogni risposta JSON-RPC non eccezionale, anche se il CallToolResult contiene isError:true. Il modello può leggere l'errore nel testo, ma trace, UI e wrapper agentici dichiarano esito positivo. Riprodotto per HTTP; stdio usa lo stesso criterio. Correzione: validare e normalizzare CallToolResult, distinguendo errore di trasporto ed errore applicativo del tool.

**24. Stage, unstage e discard ignorano l'exit code di Git.**  
[server/domain/git/git.service.ts:112](/home/michele/Documenti/Workspaces/Aether/server/domain/git/git.service.ts:112).  
runGit risolve anche quando code è diverso da zero. Questi tre metodi non lo controllano, a differenza di commit/push. File inesistente, index.lock o restore non applicabile producono una risposta API di successo senza aver modificato quanto richiesto. Correzione: helper condiviso che richieda exit code zero per i comandi di mutazione e propaghi stderr; mantenere distinte le query con esiti non-zero attesi.

**25. Timeout/terminazione dei comandi possono produrre falsi “test verdi”.**  
[server/mcp/builtin/aether-shell.handler.ts:95](/home/michele/Documenti/Workspaces/Aether/server/mcp/builtin/aether-shell.handler.ts:95); [server/domain/tdd/tdd.run-command.ts:15](/home/michele/Documenti/Workspaces/Aether/server/domain/tdd/tdd.run-command.ts:15).  
Il processo terminato da un segnale ha code=null, convertito a zero. Inoltre parseExitCode cerca l'ultima stringa “exit code: N” nell'output prima di considerare isError: se un comando stampa “exit code: 0” e poi va in timeout, TDD lo classifica passato. Quest'ultimo caso è riprodotto. Correzione: restituire exitCode, signal e timedOut come campi strutturati; il contenuto stdout/stderr non deve decidere lo stato. La kill del solo shell PID richiede inoltre gestione dell'albero dei processi per fermare i discendenti.

**26. Le policy per categoria vengono bypassate dal default del trasporto.**  
[server/domain/mcp/registry.ts:325](/home/michele/Documenti/Workspaces/Aether/server/domain/mcp/registry.ts:325); [server/domain/mcp/breakpoints/breakpoints.service.ts:23](/home/michele/Documenti/Workspaces/Aether/server/domain/mcp/breakpoints/breakpoints.service.ts:23).  
Se manca una policy esplicita, resolvePolicy restituisce autoApprove=false per stdio/http. BreakpointService lo interpreta come scelta esplicita e non consulta safe/dangerous/external. Anche una read sicura continua a chiedere approvazione con safe=auto; i job safe rifiutano questi tool. Riprodotto. Correzione: preservare la distinzione tra “nessun override” e false esplicito; applicare poi la policy di categoria.

**27. Le policy dei tool builtin non persistono e possono applicarsi al workspace sbagliato.**  
[server/domain/mcp/registry.ts:278](/home/michele/Documenti/Workspaces/Aether/server/domain/mcp/registry.ts:278); [server/domain/mcp/registry.ts:263](/home/michele/Documenti/Workspaces/Aether/server/domain/mcp/registry.ts:263).  
setToolPolicy cerca il builtin dentro context.mcpServers, dove i builtin generati non sono presenti, quindi aggiorna solo la voce live. Dopo riavvio/eviction l'override si perde. policy(qualifiedName) prende inoltre la prima voce con serverName corrispondente senza root, mentre callTool usa la root del dispatch: con più istanze Filesystem/Git si può approvare secondo la policy di un'altra istanza. Correzione: persistenza esplicita delle policy builtin e identità coerente tra classificazione ed esecuzione.

**28. File testuali con MIME browser vuoto vengono accettati dalla UI e rifiutati dal server.**  
[src/stores/chat.store.ts:233](/home/michele/Documenti/Workspaces/Aether/src/stores/chat.store.ts:233); [src/stores/chat.store.ts:251](/home/michele/Documenti/Workspaces/Aether/src/stores/chat.store.ts:251); [server/domain/dispatch/dispatch.service.ts:33](/home/michele/Documenti/Workspaces/Aether/server/domain/dispatch/dispatch.service.ts:33).  
La UI ammette .ts/.py/.env tramite estensione anche con File.type vuoto, quindi invia mime=''. Il backend richiede min(1) e risponde Invalid request body. Correzione: normalizzare il MIME secondo una funzione condivisa, con fallback testuale per le estensioni supportate.

**29. Una risposta tardiva di hydration può cancellare i messaggi in streaming.**  
[src/stores/sessions.store.ts:72](/home/michele/Documenti/Workspaces/Aether/src/stores/sessions.store.ts:72); [src/stores/chat.store.ts:131](/home/michele/Documenti/Workspaces/Aether/src/stores/chat.store.ts:131).  
Il controllo impedisce l'overwrite solo quando la risposta remota è vuota. Se si apre una sessione con storia e si invia prima che fetchById termini, una risposta non vuota sostituisce i nuovi messaggi locali. streamingId rimane valorizzato, ma la sua bolla non esiste più e appendChunk non la trova. Correzione: non permettere send prima dell'hydration o usare una revisione dello stato/merge per ID che protegga gli aggiornamenti successivi alla richiesta.

**30. Il dispatcher delle pianificazioni perde configurazione e skill rispetto a quello interattivo.**  
[server/domain/schedules/schedule-runner.ts:97](/home/michele/Documenti/Workspaces/Aether/server/domain/schedules/schedule-runner.ts:97); [server/index.ts:305](/home/michele/Documenti/Workspaces/Aether/server/index.ts:305).  
La costruzione duplicata del DispatchService omette skillsService, listWorkspaceRoots e maxToolCallsPerDispatch. Un job schedulato non riceve le skill attive/pinned e ignora il limite configurato con AETHER_MAX_TOOL_CALLS, tornando a 25. Correzione: unica factory della configurazione di dispatch con override limitati ad autonomia e gestione delle approvazioni.

**Deduplicazione e best practice**

- **Preparazione del turno e finalizzazione:** handle/resume duplicano selezione del provider, contesto, errori, usage e persistenza. La divergenza è già osservabile nei rilievi 17 e 18. Estrarre preparazione comune e un esito di dominio tipizzato; SSE deve serializzare quell'esito, non esserne la fonte di verità.
- **Consumer degli eventi SSE:** send/resume ripetono quasi tutti i branch; swarm/TDD implementano consumer separati che perdono i gate (rilievo 08). Un router condiviso degli eventi tool/chat e reducer specifici per il tipo di run ridurrebbero questa divergenza.
- **Contratti client/server:** MIME, limiti allegati e diversi DTO sono duplicati. Il disallineamento sul MIME vuoto è reale (28). Usare un modulo condiviso senza dipendenze Node/React e schemi runtime di confine; evitare cast `as any` che nascondono eventi mancanti.
- **Wrapper HTTP:** `asyncHandler` è definito in 16 file di route; parsing degli errori e costruzione delle richieste sono ripetuti nei client API. In sessions.api.ts esistono sia il metodo updateSession sia una funzione esportata con lo stesso corpo. Consolidare questi helper senza creare un framework generico.
- **Identità e deduplicazione delle operazioni:** non basta deduplicare nomi nel prompt. Servono request/run IDs e serializzazione per sessione per evitare che due tab o retry concorrenti accodino coppie user/model fuori ordine. Il frontend blocca solo il singolo store locale; il backend non serializza il dispatch per sessionId. Retry in ChatView elimina solo la bolla di errore locale e invia di nuovo il messaggio, lasciando errore e richiesta precedenti nella history persistita.
- **Rollback ottimistici:** molti store ripristinano l'intero snapshot precedente dopo un errore. Due mutazioni concorrenti possono così perdere localmente la seconda modifica riuscita. Fare rollback del solo campo/elemento se ancora alla revisione attesa o invalidare e ricaricare.
- **Classificazione di sicurezza:** DANGEROUS_SHELL_PATTERNS è dichiarato ma non viene usato da classifyTool; la categoria external non viene inferita dalle euristiche. Allineare documentazione e comportamento e definire il trattamento dei tool sconosciuti. Non considerare una blacklist regex di comandi una sandbox.
- **Lifecycle:** bootstrap.close chiude l'HTTP server e ferma il timer dello scheduler, ma non chiude esplicitamente DB, connessioni MCP e run attivi. Per il runtime embedded serve shutdown coordinato; un SSE aperto può prolungare la chiusura.
- **Qualità CI:** la soglia coverage è disattivata in CI con COVERAGE_NO_THRESHOLDS=1; tsc è l'unico “lint” e non copre CLI/app/scripts nella sua include. Ripristinare soglie progressive e controlli mirati a Promise non gestite, contratti degli eventi e codice JavaScript/CLI, senza introdurre test cosmetici.
- **Dipendenze di build in produzione:** plugin React/Vite e tooling CSS sono inclusi nelle dependencies; il bundle frontend è monolitico. Valutare separazione delle dipendenze necessarie al server dev rispetto alla distribuzione prod e lazy loading dei pannelli pesanti.

**Dipendenze: risultato dell'audit, non prova di sfruttabilità**

L'audit npm di produzione segnala **13 pacchetti: 6 high, 7 moderate, 0 critical**. Tutti riportano fixAvailable=true. I pacchetti high sono brace-expansion, browserslist, fast-uri, ip-address, nanoid e postcss; gli altri sono @hono/node-server, baseline-browser-mapping, body-parser, express, hono, protobufjs e qs.

Sono segnalazioni del grafo delle dipendenze, non 13 exploit dimostrati nell'app. Alcuni percorsi appartengono al tooling di build; altri richiedono opzioni o input non usati qui. Per esempio, i limiti express.json sono costanti valide: l'advisory su limiti body-parser invalidi non dimostra da solo un bypass in queste route. Aggiornare il lockfile in un intervento separato, verificare la reachability dei percorsi ad alto rischio e ripetere build/test. Nessun pacchetto è stato aggiornato durante la review.

**Ordine proposto degli interventi**

1. Confini di sicurezza e autorizzazione: allegati attivi, Host/Origin, cancellazione, workspace eliminati, approvazioni per run e root.
2. Correttezza del dispatch: system prompt Codex, nomi tool OpenAI, transcript cumulativo, ID messaggi, gate nei run e root TDD.
3. Persistenza e risultati: credenziali, export/import, MCP HTTP/header, classificazione degli errori e interruzioni.
4. Consolidamento dei moduli condivisi, regressioni sui casi emersi e aggiornamento dipendenze.

**Evidenze diagnostiche conservate**

- [Suite completa](/tmp/aether-review-tests-unrestricted.log)
- [Build](/tmp/aether-review-build.log)
- [Smoke test](/tmp/aether-review-smoke.log)
- [16 prove su dispatch, persistenza e API](/tmp/aether-review-probes.log)
- [4 prove su provider e policy](/tmp/aether-review-provider-probes.log)
- [Sorgente diagnostico principale](/tmp/aether-review-probes.test.ts)
- [Sorgente diagnostico provider](/tmp/aether-review-provider-probes.test.ts)
- [Audit npm JSON](/tmp/aether-review-npm-audit.json)

I due sorgenti diagnostici erano temporaneamente in server/test durante l'esecuzione e sono stati spostati in /tmp per lasciare invariata la suite applicativa. I loro import relativi presuppongono quella posizione originaria. Le asserzioni confermano i difetti attuali; per usarli come test di regressione dopo una correzione bisogna invertirne le aspettative pertinenti.

