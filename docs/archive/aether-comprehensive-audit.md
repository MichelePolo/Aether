# Audit Completo: Aether Dev Studio (Slices 16-20 Edition)

Questo documento espone i risultati dell'analisi architetturale end-to-end della codebase di Aether Dev Studio, aggiornato con le più recenti macro-funzionalità di produzione (Slices 16-20).

---

## Diagrammi Architetturali (C4 Model)

### 1. System Context Diagram
```mermaid
C4Context
    title System Context diagram for Aether Dev Studio

    Person(developer, "Developer", "Sviluppatore software che utilizza l'ambiente Aether.")
    System(aether, "Aether Dev Studio", "Piattaforma IDE e Agentica potenziata dall'AI")
    
    System_Ext(llm, "LLM Providers", "Gemini, Ollama, Anthropic")
    System_Ext(mcp, "MCP Tools", "Tool CLI locali o servizi esterni")

    Rel(developer, aether, "Scrive codice, gestisce key vault, carica allegati", "UI")
    Rel(aether, llm, "Richiede reasoning, allega file testuali/immagini", "API")
    Rel(aether, mcp, "Esegue comandi di sistema, legge file, compila", "STDIO / HTTP")
```

### 2. Container Diagram
```mermaid
C4Container
    title Container diagram for Aether Dev Studio

    Person(user, "Sviluppatore", "Interagisce con l'ambiente AI.")
    
    System_Boundary(aether_boundary, "Aether Dev Studio") {
        Container(spa, "Single Page Application", "React, Vite, Zustand", "UI per Chat, Auth Pane, Import/Export, Forking.")
        Container(api_app, "API Application", "Node.js, Express", "REST API, KeyVault API, SSE, Attachments proxy.")
        
        System_Boundary(domain_boundary, "Domain Layer (Backend)") {
            Container(dispatch_service, "Dispatch Service", "TypeScript", "Agentic loop e preprocessing allegati (BLOBs).")
            Container(mcp_registry, "MCP Registry", "TypeScript", "Connessioni live ai server MCP e policy execution.")
            Container(provider_registry, "Provider Registry", "TypeScript", "Integrazione LLM e risoluzione chiavi tramite KeyResolver.")
            ContainerDb(sqlite_db, "SQLite Database", "better-sqlite3", "Persistenza relazionale (History, KeyVault, FTS, Attachments).")
        }
    }
    
    System_Ext(gemini, "Gemini API", "Google Generative AI Provider")
    System_Ext(ollama, "Ollama", "Local LLM Daemon")

    Rel(user, spa, "Usa la UI", "HTTPS/Browser")
    Rel(spa, api_app, "Invia dati e chiavi crittografiche", "REST API / SSE")
    Rel(api_app, dispatch_service, "Inoltra dispatch")
    Rel(dispatch_service, provider_registry, "Risolve LLM e credenziali")
    Rel(api_app, sqlite_db, "Scrive Vault, History, import JSON")
    Rel(dispatch_service, sqlite_db, "Scrive History, BLOBs, FTS")
```

---

## 1. Nuove Capacità Avanzate (Slices 16-20)

### 1.1 Gestione Sicura Credenziali: `KeyVaultService` (Slice 17-18)
- Il sistema ha introdotto un **KeyVault** interno basato su SQLite.
- **Risoluzione Ibrida:** La classe `KeyResolver` usa un fallback stratificato. Cerca prima la variabile d'ambiente (es. `process.env.GEMINI_API_KEY`) per deployment "12-factor", e se assente fallbacksul Vault in-app configurato dall'utente tramite il **Provider Auth Pane**.
- **UX Security:** Il frontend gestisce esplicitamente il flusso di salvataggio/rimozione chiavi per permettere sessioni sicure anche a utenti sprovvisti di env-vars a livello OS.

### 1.2 Gestione Allegati (Slice 20)
- Il DB SQLite è stato espanso con la migrazione `005_message_attachments.sql`.
- **Fisicità:** I file (immagini e documenti testo) vengono immagazzinati direttamente come BLOB (`bytes`) legati per foreign key al `message_id`. L'engine SQLite supporta eccellentemente BLOB di media taglia, mantenendo compattezza (1 solo file) e garantendo transazionalità.
- **Preprocessing:** Il `DispatchService` normalizza gli allegati testo inserendoli come blocchi Markdown `fenced` nel corpo del prompt, e spinge gli allegati immagine tramite payload multimodali diretti (ove supportati dal provider, es. Gemini/Anthropic).

### 1.3 Forking & Token Meter (Slice 19)
- **Time-Travel / Forking:** `HistoryStore.forkSession()` implementa una sofisticata clonazione transazionale del DB. Tronca la timeline virtuale al `fromMessageId` clona l'intero set (inclusi gli idenitificatori univoci UUID) e propaga le foreign-keys degli allegati in modo atomico. 
- La protezione "NO_FORK_POINT" impedisce fork incoerenti (es. derivati da messaggi orfani del modello senza contesto utente).

### 1.4 Portabilità: Export/Import JSON (Slice 16)
- **JSON Envelopes:** Introdotto il layer per estrarre integralmente l'albero di dipendenze (messaggi, FTS, reasoning steps, tool calls) in un raw JSON (`ExportEnvelope`). Il reverse proxy reidrata (`importSession`) lo schema SQL mantenendo intatte le associazioni, utilissimo per il backup locale o per la condivisione di prompt-chain riproducibili.

---

## 2. Architettura Storica Consolidata (Frontend & Backend)

### 2.1 State Management e UI (Zustand & SSE)
Lo streaming `useStreamingDispatch.ts` mantiene l'app leggera. Nonostante l'aggiunta del Token Meter, la reattività dell'interfaccia non è compromessa poiché gli update viaggiano confinati in subset di stato Zustand (`messages` vs `mcpStore`), e intercettano il chunking SSE in tempo reale. L'aggiunta di HMR disabilitata via env-var `DISABLE_HMR` permette code-editing aggressivo senza reload invadenti.

### 2.2 Database & Transazioni SQL
Tutta l'infrastruttura si affida all'implementazione `better-sqlite3` con transazioni `db.transaction()` strict. Le Foreign Keys (`PRAGMA foreign_keys = ON`) sono l'ancora di salvezza principale che previene orfani durante l'eliminazione a cascata (`ON DELETE CASCADE`) delle sessioni o dei messaggi forkati.

---

## Conclusioni
L'app Aether, con le nuove Slices (16-20), supera lo status di *esperimento* ed entra ufficialmente in quello di **Piattaforma di Produttività Sicura**.
- La persistenza BLOB degli allegati evita problemi legati a dischi locali effimeri.
- Il KeyVault porta comodità per chi non lavora da terminale.
- Le funzionalità di import/export & fork abilitano l'uso del tool come vero e proprio "prompt engineering workbench".
