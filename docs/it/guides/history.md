# Cronologia

> 🇮🇹 Traduzione derivata — la versione di riferimento è quella inglese: [History](../../guides/history.md).

Cosa copre: come le conversazioni vengono persistite, biforcate (fork), esportate/importate, cercate, e come gli allegati vengono memorizzati e reinviati ai provider. Leggilo quando tocchi la memorizzazione delle sessioni, i flussi di fork/esportazione/importazione, o la gestione degli allegati nel dispatch.

## Come funziona

Ogni sessione è una riga in `sessions`, e ogni messaggio una riga in `messages` (`server/domain/history/history.store.ts`, `HistoryStore`). `append()` inserisce il messaggio, ne rispecchia il testo nella tabella FTS5 `messages_fts`, scrive qualsiasi passo di ragionamento/traccia di chiamata a strumento e gli allegati nella stessa transazione e — se è il primo messaggio utente di una sessione ancora senza titolo — deriva da esso il titolo della sessione (`computeTitle`, `server/domain/history/title.ts`). Le letture (`readMessages`, usata da `read()`/`readRecord()`) ricompongono l'intero albero del messaggio — allegati, passi di ragionamento, tracce di chiamate a strumenti — con quattro istruzioni preparate indipendentemente dal numero di messaggi.

**Fork**: `forkSession(sessionId, fromMessageId)` implementa il "viaggio nel tempo" — copia tutti i messaggi fino a un punto di taglio in una sessione completamente nuova. Se `fromMessageId` punta a un messaggio del modello, il taglio risale all'indietro fino al più vicino messaggio utente precedente (così il fork parte sempre da un turno utente); se non c'è alcun messaggio utente in quel punto o prima, lancia un `ValidationError` con tag `NO_FORK_POINT`. Esposto tramite `POST /api/sessions/:id/fork` (`server/routes/sessions.routes.ts`), corpo `{ fromMessageId }`.

**Esportazione/importazione**: `exportSession()` avvolge il record completo di una sessione in una busta versionata (`ExportEnvelope`, `{ app: 'aether', version: 1, exportedAt, session }`, `server/domain/history/history.export.ts`) validata da uno schema Zod permissivo (le chiavi sconosciute vengono scartate silenziosamente) così le vecchie esportazioni restano importabili. `GET /api/sessions/:id/export` lo trasmette come file JSON scaricabile nominato tramite `slugifyFilename()` (dal titolo della sessione + timestamp); `POST /api/sessions/import` rivalida la busta e chiama `importSession()`, che riassegna un nuovo id a ogni sessione/messaggio/passo di ragionamento/chiamata a strumento/allegato per evitare collisioni.

**Ricerca**: `SearchService.search()` (`server/domain/search/search.service.ts`) esegue una query `messages_fts MATCH` con ranking `bm25()` ed evidenziazione `snippet()`, raggruppando i risultati per sessione; qualsiasi errore di sintassi FTS5 nella query viene inghiottito e restituisce un risultato vuoto invece di un 500. Montato su `/api/search` (`server/routes/search.routes.ts`).

**Allegati**: gli allegati sono memorizzati come righe `MessageAttachment` (`id`, `mime`, `name`, `size`, più `contentBase64` solo nel percorso di scrittura/importazione — mai in lettura) insieme al messaggio con cui sono stati inviati. Al momento del dispatch, `preprocessAttachments()` (`server/domain/dispatch/dispatch.service.ts`) classifica ogni allegato tramite `classifyAttachment()`, applica `MAX_ATTACHMENTS` e un **limite totale di 10 MB** su tutti gli allegati in un singolo dispatch (`AppError` con `PAYLOAD_TOO_LARGE`/413 se superato), poi li divide: gli allegati di testo vengono inseriti in linea nel messaggio utente come blocchi di codice delimitati (`inlineTextAttachments`), mentre gli allegati immagine vengono inoltrati al provider solo se `provider.capabilities.vision` è true (`providerAttachments`) — i provider senza vision non li vedono mai. Il messaggio viene persistito con i suoi allegati **originali** indipendentemente da quali il provider abbia effettivamente ricevuto.

**Contatore token/utilizzo**: ogni messaggio del modello persistito può portare `tokensIn`/`tokensOut` (dal reporting di utilizzo del provider); l'interfaccia li legge dal messaggio per mostrare una riga "Prompt: N / Reply: M tokens" (`src/components/chat/MessageBubble.tsx`).

## File chiave

- `server/domain/history/history.store.ts` — `HistoryStore`: append, read, fork, export, import, delete
- `server/domain/history/history.export.ts` — `ExportEnvelope`, `wrap`, `slugifyFilename`
- `server/domain/history/history.types.ts` — `Message`, `MessageAttachment`, `SessionRecord`
- `server/domain/history/title.ts` — `computeTitle`
- `server/domain/search/search.service.ts` — `SearchService.search`, la query `messages_fts`
- `server/routes/sessions.routes.ts` — `/export`, `/import`, `/:id/fork`
- `server/routes/history.routes.ts` — CRUD delle sessioni, `PATCH` per titolo/provider/workspace
- `server/domain/dispatch/dispatch.service.ts` — `preprocessAttachments`, `inlineTextAttachments`, il limite di 10 MB

## Vedi anche

- [Provider](providers.md) — il gating `capabilities.vision` per gli allegati immagine
- [Subagent e swarm](subagents-swarms.md) — come un subagent risolto confluisce nello stesso dispatch che gestisce gli allegati
- [Architettura](../../architecture.md) (in inglese) — il ciclo di dispatch e dove si colloca la persistenza della cronologia
