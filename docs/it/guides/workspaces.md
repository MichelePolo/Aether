# Workspace

> 🇮🇹 Traduzione derivata — la versione di riferimento è quella inglese: [Workspaces](../../guides/workspaces.md).

Cosa copre: come una cartella di progetto diventa un workspace di Aether, come il browser del filesystem e i server MCP integrati si radicano su di esso, e cosa succede ai dati correlati quando un workspace viene eliminato. Leggilo quando aggiungi/esplori workspace o fai debug del riradicamento degli MCP integrati.

## Come funziona

Un workspace è solo un nome più un `rootPath` su disco, memorizzato da `WorkspacesStore` (`server/domain/workspaces/workspaces.store.ts`). `POST /api/workspaces` (`server/routes/workspaces.routes.ts`) verifica che `rootPath` esista e sia una directory (via `fs.statSync`) prima di inserirlo; un `rootPath` duplicato viene rifiutato con un `ValidationError` (vincolo `UNIQUE` SQLite sulla colonna). `GET /api/workspaces/browse?path=` elenca solo le sottodirectory di un percorso dato (`FilesystemBrowserService.browse()`, `server/domain/workspaces/filesystem-browser.service.ts`), ricadendo sulla directory home del sistema operativo quando nessun `path` è fornito — questo è ciò che alimenta il selettore "sfoglia per una cartella" nell'interfaccia.

Una volta che una sessione o una pianificazione è associata a un workspace (`workspaceId`), `DispatchService` riradica i server MCP integrati filesystem/terminal/git sul percorso di quel workspace al momento del dispatch (`ensureRootedBuiltins`, vedi [Strumenti MCP](mcp-tools.md)) — così gli strumenti filesystem/shell/git del modello operano sulla cartella di progetto corretta man mano che il workspace attivo cambia.

**Cascata di eliminazione**: `WorkspacesStore.delete()` viene eseguito in una transazione che prima azzera `workspace_id` su tutte le righe di `schedules`, `swarms` e `swarm_steps` che fanno riferimento al workspace (verificando prima che ogni tabella esista, dato che non ogni deployment le ha tutte), poi elimina la riga del workspace stessa. Eliminare un workspace **non** elimina le pianificazioni/swarm che vi puntavano — vengono staccate e ricadono sulla radice filesystem integrata / `process.cwd()` (lo scheduler si protegge esplicitamente da questo per le pianificazioni — vedi [Scheduler](scheduler.md)).

## File chiave

- `server/domain/workspaces/workspaces.store.ts` — `WorkspacesStore`: CRUD + la cascata di eliminazione
- `server/domain/workspaces/filesystem-browser.service.ts` — `FilesystemBrowserService.browse`
- `server/domain/workspaces/workspaces.types.ts` — `Workspace`, `BrowseEntry`
- `server/routes/workspaces.routes.ts` — `POST /`, `GET /browse`, `PATCH /:id`, `DELETE /:id`

## Vedi anche

- [Strumenti MCP](mcp-tools.md) — come i server integrati vengono riradicati sul workspace attivo
- [Scheduler](scheduler.md) — le pianificazioni possono puntare a un workspace e saltare le esecuzioni se è sparito
- [Architettura](../../architecture.md) (in inglese) — dove si collocano i workspace nel flusso di dispatch
