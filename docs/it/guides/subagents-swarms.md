# Subagent e swarm

> 🇮🇹 Traduzione derivata — la versione di riferimento è quella inglese: [Subagents & swarms](../../guides/subagents-swarms.md).

Cosa copre: come una menzione `@subagent` iniziale viene risolta in un dispatch, il subagent `skill-smith` preconfigurato, e come gli swarm concatenano i subagent su più passi con approvazione per singolo passo. Leggilo quando aggiungi un subagent, fai debug del perché `@nome` non si risolve, o lavori su esecuzioni di swarm multi-passo.

## Come funziona

I **subagent** sono record memorizzati (`SubAgentRecord`: `name`, `systemInstruction`, `skills`, `tools`, `model` opzionale) in `SubAgentsStore` (`server/domain/subagents/subagents.store.ts`). `model`, quando impostato, è un override di provider `transport:model` — un subagent può puntare a un provider diverso rispetto alla sessione da cui viene invocato.

Al momento del dispatch, `DispatchService.handle()` (`server/domain/dispatch/dispatch.service.ts`) analizza una menzione `@nome` iniziale nel messaggio utente con `parseLeadingMention()` (`server/domain/dispatch/subagent-parser.ts`), poi la confronta con ogni record di subagent tramite `subAgentsStore.list()`/`read()`. In caso di corrispondenza emette un passo di ragionamento `resolve_subagent`, e la selezione del provider diventa: `providerName` del corpo della richiesta → **`model` del subagent trovato** → `providerName` della sessione → predefinito del registro. Il `systemInstruction`/`skills`/`tools` del subagent vengono ripiegati nel prompt assemblato allo stesso modo dell'istruzione di sistema di workspace/contesto (vedi [Strumenti MCP](mcp-tools.md) per come si aggiungono le dichiarazioni degli strumenti).

**`skill-smith`** (`server/domain/subagents/skill-smith.ts`) è un subagent preconfigurato una volta all'avvio se non esiste già un subagent chiamato `skill-smith` (`seedSkillSmith()`, idempotente — non sovrascrive mai la copia modificata di un utente). La sua istruzione di sistema è assemblata da `skillSmithInstruction()` a partire da due metà: il **corpo portabile dell'agente**, letto da `bundle/sources/agent.md`, e un'appendice specifica di Aether su collocazione (scrivere sotto `.drafts/<slug>/`, mai altrove) e consegna (l'utente rivede e promuove dal pannello Skill; il subagent non abilita mai una skill da sé). La metà portabile non contiene deliberatamente alcun metodo: dice al modello di leggere la skill `skill-smith` inclusa e di seguirla, usando `brainstorming` per la fase di progettazione.

La separazione esiste perché lo stesso agente viene distribuito anche fuori da Aether. `scripts/build-bundle.mjs` assembla `bundle/skill-smith/` — un plugin per Claude Code che contiene `agents/skill-smith.md` (lo stesso file che Aether preconfigura, byte per byte) più `skills/skill-smith/` (la stessa directory che Aether preconfigura come skill predefinita, con in più `agents/openai.yaml` per Codex). Il bundle è generato *e* committato: `npm run bundle` lo rigenera, `npm run bundle:check` fallisce quando la copia committata è fuori sincrono con le sorgenti, e `npm run bundle -- --zip` produce l'archivio con la sola skill accettato da claude.ai e dalle Skills API. I target di installazione e i rispettivi layout sono documentati in `bundle/skill-smith/README.md`. In produzione il file dell'agente viene letto da `dist/agents/skill-smith.md`, copiato lì da `scripts/build.mjs`.

Gli **swarm** sono un'orchestrazione multi-passo separata sopra i subagent: un `SwarmRecord` (`server/domain/swarms/swarm.types.ts`) ha una lista ordinata di `SwarmStep`, ognuno nominando un `subAgentName`, un `promptTemplate`, un override opzionale per passo di `providerName`/`workspaceId`, e un flag `pauseAfter`. `swarm.orchestrator.ts` esegue i passi in sequenza, passando l'output di ogni passo come input del successivo, ed emette il progresso via SSE (`swarm_approval_request`, `swarm_done` con `status: 'done' | 'rejected' | 'error' | 'interrupted'`). Quando un passo ha `pauseAfter: true`, l'orchestratore emette `swarm_approval_request` e blocca su `SwarmApprovalRegistry.awaitDecision()` (`server/domain/swarms/swarm.approval.ts`) — risolto da un'approvazione/rifiuto esplicito, da un timeout configurabile (predefinito 24h, passato come `approvalTimeoutMs`), o dallo scatto dell'`AbortSignal` della richiesta; questi ultimi due si risolvono entrambi in `'reject'` così un client disconnesso non lascia un'approvazione in sospeso per l'intero timeout.

## File chiave

- `server/domain/subagents/subagents.store.ts` — `SubAgentsStore`: CRUD per i record dei subagent
- `server/domain/subagents/subagents.types.ts` — `SubAgentRecord` (override di provider `model`), `SubAgentMeta`
- `server/domain/subagents/skill-smith.ts` — `seedSkillSmith`, `skillSmithInstruction`: il corpo portabile dell'agente più l'appendice Aether
- `bundle/sources/` — la metà scritta a mano del bundle esportabile: agente, manifest del plugin, config Codex, README
- `scripts/build-bundle.mjs` — assembla `bundle/skill-smith/`; `--check` sorveglia il disallineamento, `--zip` impacchetta la skill
- `server/domain/dispatch/subagent-parser.ts` — `parseLeadingMention`
- `server/domain/dispatch/dispatch.service.ts` — risoluzione della menzione, precedenza nella selezione del provider
- `server/domain/swarms/swarm.types.ts` — `SwarmRecord`, `SwarmStep`, `SwarmRunStatus`
- `server/domain/swarms/swarm.orchestrator.ts` — il ciclo di esecuzione passo-passo, eventi SSE
- `server/domain/swarms/swarm.approval.ts` — `SwarmApprovalRegistry.awaitDecision`/`resolveDecision`

## Vedi anche

- [Strumenti MCP](mcp-tools.md) — come gli strumenti di un subagent risolto si uniscono al prompt assemblato
- [Provider](providers.md) — precedenza nella selezione del provider e capacità per provider
- [Scheduler](scheduler.md) — le pianificazioni possono puntare o a un prompt (con un subagent opzionale) o a uno swarm
