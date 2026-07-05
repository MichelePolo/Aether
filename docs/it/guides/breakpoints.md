# Breakpoint

> 🇮🇹 Traduzione derivata — la versione di riferimento è quella inglese: [Breakpoints](../../guides/breakpoints.md).

Cosa copre: il gate di approvazione che si frappone davanti a ogni chiamata a uno strumento MCP. Leggilo quando stai modificando la policy di chiamata agli strumenti, fai debug del perché una chiamata resta in sospeso o viene auto-rifiutata, o costruisci l'interfaccia intorno al flusso di approvazione/rifiuto.

## Come funziona

Ogni chiamata a strumento che il modello vuole effettuare viene classificata in una di tre categorie — `safe`, `dangerous`, `external` (`ToolCategory` in `server/domain/mcp/breakpoints/breakpoints.types.ts`) — da `classifyTool()` (`server/domain/mcp/breakpoints/classify.ts`), usando pattern sui nomi (`DANGEROUS_NAME_PATTERNS`: write/edit/delete/execute_command/git rebase-push-reset, ecc.) e, per le chiamate shell, pattern sugli argomenti (`DANGEROUS_SHELL_PATTERNS`: `git push -f`, `npm publish`, `git reset --hard`, `git rebase`, scritture dirette su disco). Un override di policy per singolo strumento (`McpToolPolicy.category` o un flag esplicito `autoApprove`) può bypassare la classificazione.

`BreakpointService.resolveDecision()` (`server/domain/mcp/breakpoints/breakpoints.service.ts`) trasforma una categoria classificata in una modalità:
1. Se la policy dello strumento imposta `autoApprove: true` → `auto`. Se `autoApprove: false` → `gate`.
2. Altrimenti, classifica lo strumento e cerca la modalità di quella categoria in `BreakpointPolicyStore.read()` — un'impostazione `auto`/`gate` per categoria (`safe`/`dangerous`/`external`), modificabile tramite `GET/PUT /policy/:category` (`server/routes/breakpoints.routes.ts`).

**`auto`** significa che il ciclo di dispatch esegue subito lo strumento. **`gate`** significa che il ciclo di dispatch chiama `McpRegistry.awaitDecision(callId)` (`server/domain/mcp/registry.ts`), che restituisce una promise che si risolve solo quando qualcosa chiama `resolveDecision(callId, 'approve' | 'reject')` — oppure **viene rifiutata dopo un timeout di 24 ore** (`timeoutMs = 24 * 60 * 60 * 1000`, parametro predefinito hardcoded), momento in cui la decisione in sospeso viene scartata e la chiamata è trattata come rifiutata.

**UI di anteprima / diff**: prima di attendere la decisione, `DispatchService.gateExecuteAndTrace()` (`server/domain/dispatch/dispatch.service.ts`) calcola un'anteprima tramite `PreviewService.previewToolCall()` (`server/domain/mcp/breakpoints/preview.service.ts`) — una tra `diff` (testo vecchio/nuovo + percorso), `gitDiff` (diff unificato + titolo), `commitList`, o `plain` (`PreviewResult` in `breakpoints.types.ts`) — e la emette sull'evento SSE `tool_call_request` così l'interfaccia può renderizzare il widget di approvazione giusto (es. una vista diff per una scrittura di file, una lista di commit per un'operazione git) prima che l'utente decida.

**Comportamento della CLI**: il client CLI non ha un prompt di approvazione interattivo. Quando arriva una chiamata soggetta a gate, `rejectDecision()` (`cli/client.ts`) invia proattivamente una POST `{ callId, action: 'reject' }` a `/api/mcp/decision` (best-effort — una chiamata di rifiuto fallita non deve mai far crashare lo stream) invece di lasciare che la chiamata scada per il timeout di 24 ore. L'approvazione/rifiuto interattivo è disponibile solo nella web UI.

**Interazione SSE**: `gateExecuteAndTrace()` emette `tool_call_request` (immediatamente, portando l'anteprima) poi blocca in attesa della decisione del gate; una volta risolta (approva → esegue, o rifiuta/timeout → `{ ok: false, error: 'Rejected by user' }`), emette `tool_call_result` e registra un passo `tool_call` nel `ReasoningTracer`. Lo stream SSE di dispatch resta aperto durante l'attesa, così una lunga pausa del gate ritarda solo `tool_call_result`, non la connessione stessa.

## File chiave

- `server/domain/mcp/breakpoints/classify.ts` — `classifyTool`, pattern pericolosi su nomi/shell
- `server/domain/mcp/breakpoints/breakpoints.service.ts` — `BreakpointService.resolveDecision`
- `server/domain/mcp/breakpoints/policy.store.ts` — memorizzazione della policy `auto`/`gate` per categoria
- `server/domain/mcp/breakpoints/preview.service.ts` — generazione anteprima diff/gitDiff/commitList/plain
- `server/domain/mcp/registry.ts` — `awaitDecision` (timeout 24h), `resolveDecision`
- `server/domain/dispatch/dispatch.service.ts` — `gateExecuteAndTrace`, gli eventi SSE `tool_call_request`/`tool_call_result`
- `server/routes/breakpoints.routes.ts` — endpoint HTTP `/policy`, `/preview`
- `cli/client.ts` — `rejectDecision`, il comportamento di auto-rifiuto della CLI sui gate

## Vedi anche

- [Strumenti MCP](mcp-tools.md) — da dove provengono le dichiarazioni degli strumenti e il limite di chiamate per dispatch
- [Architettura](../../architecture.md) (in inglese) — il ciclo di dispatch e lo stream di eventi SSE
- [Riferimento API & SSE](../../reference/api.md) (in inglese) — catalogo completo degli eventi SSE
