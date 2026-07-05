# Subagent e swarm

> 🇮🇹 Traduzione derivata — la versione di riferimento è quella inglese: [Subagents & swarms](../../guides/subagents-swarms.md).

Cosa copre: come una menzione `@subagent` iniziale viene risolta in un dispatch, il subagent `skill-smith` preconfigurato, e come gli swarm concatenano i subagent su più passi con approvazione per singolo passo. Leggilo quando aggiungi un subagent, fai debug del perché `@nome` non si risolve, o lavori su esecuzioni di swarm multi-passo.

## Come funziona

I **subagent** sono record memorizzati (`SubAgentRecord`: `name`, `systemInstruction`, `skills`, `tools`, `model` opzionale) in `SubAgentsStore` (`server/domain/subagents/subagents.store.ts`). `model`, quando impostato, è un override di provider `transport:model` — un subagent può puntare a un provider diverso rispetto alla sessione da cui viene invocato.

Al momento del dispatch, `DispatchService.handle()` (`server/domain/dispatch/dispatch.service.ts`) analizza una menzione `@nome` iniziale nel messaggio utente con `parseLeadingMention()` (`server/domain/dispatch/subagent-parser.ts`), poi la confronta con ogni record di subagent tramite `subAgentsStore.list()`/`read()`. In caso di corrispondenza emette un passo di ragionamento `resolve_subagent`, e la selezione del provider diventa: `providerName` del corpo della richiesta → **`model` del subagent trovato** → `providerName` della sessione → predefinito del registro. Il `systemInstruction`/`skills`/`tools` del subagent vengono ripiegati nel prompt assemblato allo stesso modo dell'istruzione di sistema di workspace/contesto (vedi [Strumenti MCP](mcp-tools.md) per come si aggiungono le dichiarazioni degli strumenti).

**`skill-smith`** (`server/domain/subagents/skill-smith.ts`) è un subagent preconfigurato una volta all'avvio se non esiste già un subagent chiamato `skill-smith` (`seedSkillSmith()`, idempotente — non sovrascrive mai la copia modificata di un utente). La sua istruzione di sistema guida il modello attraverso un processo fisso: leggere la skill `brainstorming` inclusa e intervistare l'utente una domanda alla volta, poi leggere `skill-creator` per generare i file, scrivendo solo dentro una cartella `.drafts/<slug>/` nella directory delle skill — mai altrove — e passando all'utente la revisione/promozione dal pannello Skill invece di abilitare la skill stessa.

Gli **swarm** sono un'orchestrazione multi-passo separata sopra i subagent: un `SwarmRecord` (`server/domain/swarms/swarm.types.ts`) ha una lista ordinata di `SwarmStep`, ognuno nominando un `subAgentName`, un `promptTemplate`, un override opzionale per passo di `providerName`/`workspaceId`, e un flag `pauseAfter`. `swarm.orchestrator.ts` esegue i passi in sequenza, passando l'output di ogni passo come input del successivo, ed emette il progresso via SSE (`swarm_approval_request`, `swarm_done` con `status: 'done' | 'rejected' | 'error' | 'interrupted'`). Quando un passo ha `pauseAfter: true`, l'orchestratore emette `swarm_approval_request` e blocca su `SwarmApprovalRegistry.awaitDecision()` (`server/domain/swarms/swarm.approval.ts`) — risolto da un'approvazione/rifiuto esplicito, da un timeout configurabile (predefinito 24h, passato come `approvalTimeoutMs`), o dallo scatto dell'`AbortSignal` della richiesta; questi ultimi due si risolvono entrambi in `'reject'` così un client disconnesso non lascia un'approvazione in sospeso per l'intero timeout.

## File chiave

- `server/domain/subagents/subagents.store.ts` — `SubAgentsStore`: CRUD per i record dei subagent
- `server/domain/subagents/subagents.types.ts` — `SubAgentRecord` (override di provider `model`), `SubAgentMeta`
- `server/domain/subagents/skill-smith.ts` — `seedSkillSmith`, l'istruzione di sistema di skill-smith
- `server/domain/dispatch/subagent-parser.ts` — `parseLeadingMention`
- `server/domain/dispatch/dispatch.service.ts` — risoluzione della menzione, precedenza nella selezione del provider
- `server/domain/swarms/swarm.types.ts` — `SwarmRecord`, `SwarmStep`, `SwarmRunStatus`
- `server/domain/swarms/swarm.orchestrator.ts` — il ciclo di esecuzione passo-passo, eventi SSE
- `server/domain/swarms/swarm.approval.ts` — `SwarmApprovalRegistry.awaitDecision`/`resolveDecision`

## Vedi anche

- [Strumenti MCP](mcp-tools.md) — come gli strumenti di un subagent risolto si uniscono al prompt assemblato
- [Provider](providers.md) — precedenza nella selezione del provider e capacità per provider
- [Scheduler](scheduler.md) — le pianificazioni possono puntare o a un prompt (con un subagent opzionale) o a uno swarm
