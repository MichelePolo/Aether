# Documentazione di Aether

> 🇮🇹 Questa è la documentazione italiana. 🇬🇧 [English (canonica)](../README.md).

Un percorso di lettura, in ordine. Ogni passo presuppone i precedenti.

| # | Leggi | Imparerai |
|---|------|--------------|
| 1 | [Per iniziare](getting-started.md) | Installazione, primo dispatch, abilitazione dei provider |
| 2 | [Architettura](../architecture.md) (in inglese) | Il modello a processo singolo, il livello di dominio, il ciclo di dispatch |
| 3 | [Guide](#guide) | Un approfondimento per dominio — scegli quello che ti serve |
| 4 | [Riferimento](#riferimento) | Tabelle esatte: variabili d'ambiente, API/SSE, database |
| 5 | [Sviluppo](../development.md) (in inglese) | Test, convenzioni, come le modifiche arrivano in produzione |

## Guide
- [Provider](guides/providers.md) — registro, risoluzione delle chiavi, selezione persistente, vLLM
- [Vault delle chiavi](guides/key-vault.md) — credenziali cifrate a riposo
- [Strumenti MCP](guides/mcp-tools.md) — connessione dei server di strumenti, built-in, limiti di chiamata
- [Approfondimento MCP builtin](guides/builtin-mcp.md) — introduzione a MCP e best practice, poi come sono implementati Filesystem, Terminal e Git
- [Breakpoint](guides/breakpoints.md) — gate di approvazione sulle chiamate a strumenti pericolosi
- [Workspace](guides/workspaces.md) — cartelle di progetto e l'MCP filesystem
- [Cronologia](guides/history.md) — sessioni, fork, esportazione/importazione, ricerca
- [Subagent e swarm](guides/subagents-swarms.md) — delega cross-modello
- [Scheduler](guides/scheduler.md) — agenti pianificati/in background
- [CLI](guides/cli.md) — daemon `aether` e uso one-shot

## Riferimento
- [Configurazione](../reference/configuration.md) (in inglese) · [API & SSE](../reference/api.md) (in inglese) · [Database](../reference/database.md) (in inglese)

## Altrove
- [Contribuire](../../CONTRIBUTING.md) (in inglese) — come le modifiche arrivano in produzione (solo PR, squash)
- [Archivio](../archive/README.md) (in inglese) — audit storici (non aggiornati)
- [Storia del design](../superpowers/README.md) (in inglese) — specifiche e piani per ogni slice
- 🇬🇧 [English documentation](../README.md)
