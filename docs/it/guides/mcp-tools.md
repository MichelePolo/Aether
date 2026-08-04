# Strumenti MCP

> 🇮🇹 Traduzione derivata — la versione di riferimento è quella inglese: [MCP tools](../../guides/mcp-tools.md).

Cosa copre: come i server MCP (Model Context Protocol) — personalizzati o integrati — vengono connessi, esposti a un dispatch e limitati. Leggilo quando stai aggiungendo un server MCP, fai debug del perché uno strumento non è visibile al modello, o stai regolando il limite di chiamate a strumenti per dispatch.

## Come funziona

I server MCP sono configurati per workspace/contesto e si connettono su uno dei transport implementati sotto `server/domain/mcp/`: `StdioMcpConnection` (avvia un processo figlio, JSON-RPC su stdio), `HttpMcpConnection` (server MCP HTTP remoto), e `MockMcpConnection` (test). `McpRegistry` (`server/domain/mcp/registry.ts`) possiede le connessioni live, chiama `listLiveTools(root)` per enumerare gli strumenti che ogni server connesso pubblicizza attualmente, ed espone `callTool()` per invocarne uno.

**Server integrati**: tre transport sono forniti come toggle a un click, tracciati in `BuiltinMcpStore` (`server/domain/mcp/builtin/builtin.store.ts`, `BuiltinTransport = 'filesystem' | 'terminal' | 'git'`):
- `filesystem` avvia il pacchetto ufficiale `@modelcontextprotocol/server-filesystem`, radicato nel workspace.
- `terminal` avvia il server MCP `aether-shell` di Aether come processo Node separato (in sviluppo viene eseguito via `--import tsx`; in produzione esegue direttamente il file bundlato `dist/server/mcp/builtin/aether-shell.js`). I comandi shell sono soggetti a una blocklist (`BLOCKED_PATTERNS` — `rm -rf /`, `sudo`, fork bomb, `dd if=`, `mkfs.*`, scritture dirette su disco, `chmod -R 777 /`) e a valori predefiniti (`SHELL_DEFAULTS`: timeout 30s, massimo 120s, limite output 1 MiB).
- `git` avvia `aether-git` nello stesso modo, per le chiamate a strumenti specifiche di git.

Ognuno viene abilitato/disabilitato per workspace tramite `BuiltinMcpStore.setEnabled()`, e può essere riradicato sul percorso del workspace attivo (`fs_root`) al cambiare del workspace corrente.

**Ingresso nel dispatch**: al momento del dispatch, `DispatchService` chiama `ensureRootedBuiltins(currentRoot)` poi `listLiveTools(currentRoot)` per raccogliere ogni strumento attualmente connesso (integrato e personalizzato), e li passa a `assemble()` (`server/domain/dispatch/prompt-assembler.ts`), che ripiega le dichiarazioni degli strumenti (`ProviderToolDecl[]`, da `provider.types.ts`) nell'istruzione di sistema inviata al provider insieme al contesto e a qualsiasi subagent risolto. I provider che eseguono il proprio ciclo agentico (Anthropic tramite il Claude Agent SDK) invocano gli strumenti attraverso una callback `runToolCall` fornita dal livello di dispatch; i provider REST stateless invece producono chunk `function_call` che `runDispatchLoop()` intercetta.

**Limite di chiamate per dispatch**: `runDispatchLoop()` (`server/domain/dispatch/dispatch.service.ts`) traccia `toolCallsCount` e smette di eseguire ulteriori chiamate a strumenti una volta raggiunto `MAX_TOOL_CALLS_PER_DISPATCH`, che di default è `DEFAULT_MAX_TOOL_CALLS_PER_DISPATCH = 25` e può essere sovrascritto tramite la variabile d'ambiente `AETHER_MAX_TOOL_CALLS` (collegata tramite `maxToolCallsPerDispatch` nelle dipendenze del servizio). Una volta raggiunto il limite, le chiamate successive vengono rifiutate invece che eseguite, delimitando il raggio d'azione delle chiamate a strumenti di un singolo dispatch.

Ogni chiamata a strumento — integrata o personalizzata — è comunque soggetta al gate di approvazione descritto in [Breakpoint](breakpoints.md) prima di essere effettivamente eseguita.

## File chiave

- `server/domain/mcp/registry.ts` — `McpRegistry`: connessioni live, `listLiveTools`, `callTool`, `policy`
- `server/domain/mcp/stdio-connection.ts` / `http-connection.ts` / `mock-connection.ts` — implementazioni dei transport
- `server/domain/mcp/builtin/builtin.store.ts` — abilitazione server integrati, blocklist, valori predefiniti shell
- `server/domain/mcp/builtin/builtin.types.ts` — `BuiltinTransport`, `BLOCKED_PATTERNS`, `SHELL_DEFAULTS`
- `server/domain/dispatch/prompt-assembler.ts` — `assemble()`, ripiega le dichiarazioni degli strumenti nell'istruzione di sistema
- `server/domain/dispatch/dispatch.service.ts` — `DEFAULT_MAX_TOOL_CALLS_PER_DISPATCH`, il ciclo di chiamata agli strumenti

## Vedi anche

- [Approfondimento MCP builtin](builtin-mcp.md) — strategie implementative, ciclo di vita e sicurezza a strati di Filesystem/Terminal/Git
- [Breakpoint](breakpoints.md) — il gate di approvazione che ogni chiamata a strumento attraversa
- [Architettura](../../architecture.md) (in inglese) — il ciclo di dispatch e dove si colloca l'assemblaggio degli strumenti
- [Configurazione](../../reference/configuration.md) (in inglese) — `AETHER_MAX_TOOL_CALLS`
