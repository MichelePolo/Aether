# Aether: Le 7 Killer Features per il Code CLI Agent Definitivo

Questo documento raccoglie 7 funzionalità architetturali ad alto impatto per trasformare Aether da strumento di chat sperimentale a un moltiplicatore di forza indispensabile per l'uso quotidiano da parte di un Senior Software Architect.

### 1. 🐝 Multi-Agent Swarm Orchestration (Workflow DSL)
**La Feature:** Permettere di definire "Swarms" (sciami di agenti) tramite un semplice file YAML o DSL. Ad esempio: un `[Architect Agent]` che redige il plan, un `[Coder Agent]` che scrive l'implementazione e un `[QA Agent]` che esegue i test e fa review.
**Valore Architetturale:** Permette di supervisionare processi complessi delegando la validazione incrociata agli agenti stessi, con lo sviluppatore che interviene unicamente per supervisionare e approvare l'output finale (Human-in-the-loop).

### 2. 🧠 Codebase-Aware RAG (Vector + AST Parsing)
**La Feature:** Un worker in background che costruisce un indice vettoriale locale e un Abstract Syntax Tree (AST) dell'intero workspace utente. L'agente non fa affidamento sui file passati manualmente, ma comprende autonomamente l'albero delle dipendenze, le interfacce esportate e i design pattern.
**Valore Architetturale:** Permette query ad altissimo livello: *"Analizza l'impatto architetturale se sostituiamo l'interfaccia `Store` in `src/domain`"*. L'agente naviga l'AST individuando automaticamente accoppiamenti forti e dipendenze nascoste.

### 3. 🚀 Headless Daemon & CLI Native Integration
**La Feature:** Trasformare l'Express backend in un *Daemon locale* ed esporre una vera e propria CLI nativa (`aether-cli`), abilitando il piping Unix puro: 
`cat error.log | aether "Spiegami questo errore, correggi il file di test associato e mostrami il git diff"`.
**Valore Architetturale:** Zero context-switching. Il database SQLite in background tiene comunque traccia della conversazione testuale, che può essere ripresa fluidamente dalla Web UI qualora il task diventi più esplorativo e visivo.

### 4. 🛑 Agentic Breakpoints & Dry-Run Sandboxing
**La Feature:** Un sistema granulare di autorizzazioni basato su "Breakpoints". Aether può eseguire tool liberamente ma, prima di azioni irreversibili (es. eseguire `git rebase`, droppare database, chiamare API di produzione), sospende lo stato e presenta un execution plan/diff in attesa di approvazione `Y/N`.
**Valore Architetturale:** Fiducia totale. Lo sviluppatore lascia operare l'agente asincronamente e ne revisiona in blocco le "decisioni pericolose" applicando la propria expertise.

### 5. 🔮 Test-Driven Auto-Resolution (Red-Green-Refactor Loop)
**La Feature:** Integrazione bidirezionale con i test runner (Vitest, Playwright). Lo sviluppatore definisce i contratti scrivendo solo test e interfacce (TDD). Aether entra in un loop autonomo chiuso: scrive il codice, lancia il test, fa parsing dello stack trace, corregge l'errore e ripete finché la pipeline non è verde.
**Valore Architetturale:** Approccio "Specification-Driven". Il Senior Architect si concentra sull'architettura e sui contratti; l'agente lavora come un implementatore instancabile per soddisfare la validazione.

### 6. 🛠️ 1-Click Coding MCPs (Filesystem & Terminal pre-censiti)
**La Feature:** Una funzionalità dedicata nella UI che consenta di configurare in maniera "ready-to-go" gli MCP vitali per la scrittura di codice. Gli strumenti per il filesystem e l'esecuzione di comandi non richiederanno comandi CLI complessi per l'aggiunta, ma saranno tool pre-censiti di default. Basterà un interruttore (toggle) "Abilita Filesystem" o "Abilita Terminale" (one-shot abilitabili e disabilitabili).
**Valore Architetturale:** Abbassamento drastico della barriera d'ingresso. L'utente ottiene subito i poteri di agentic coding, nascondendo la complessità del protocollo MCP e promuovendo l'uso sicuro e isolato dei tool fondamentali.

### 7. 📁 Native Workspace Management GUI
**La Feature:** Come per gli MCP di sistema, anche la "gestione del workspace" diventa "ready-to-go" in una sezione dedicata. L'utente, anche non skillato, può gestire l'ambiente in modo canonico tramite classiche finestre di dialogo "Aggiungi Progetto" o "Apri Cartella".
**Valore Architetturale:** Astrazione totale. Sotto il cofano Aether continuerà a generare e orchestrare un filesystem MCP server, ma lato UX l'esperienza risulterà identica a quella di VS Code o Cursor, mantenendo coerenza visiva e focalizzando l'utente sull'architettura del proprio progetto anziché sui dettagli del tool.
