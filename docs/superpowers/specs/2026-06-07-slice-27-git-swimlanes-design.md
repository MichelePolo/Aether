# Slice 27 — Git Swimlanes (design)

> Visualizzatore deterministico della history Git come **vista web dedicata** dentro
> Aether Core. Read-only (Tier 1). Costruisce su Slice 23 (workspaces) e riusa i token
> di colore di `DiffView`. Nessuna mutazione del working tree, nessuna migrazione SQLite.
>
> Spec funzionale di riferimento (algoritmi/contratti di rendering): il documento
> "Git Swimlanes — Specifica funzionale e di integrazione" fornito dall'utente. Questo
> file ne formalizza il **porting ad Aether**: dominio backend, API HTTP, store/vista
> frontend, e le decisioni prese in fase di brainstorming.

## 1. Scope e decisioni di brainstorming

Scope di **questa** slice (concordato):

- **Solo visualizzazione read-only** (Tier 1). Niente checkout/commit/restore: quelle
  sono slice 28+. Nessun comando git che modifichi il repository o il working tree.
- **Sorgente repo = workspace della sessione attiva.** Risolto `session.workspaceId →
  WorkspacesStore.get(id).rootPath`. Empty-state se la sessione non ha workspace o se
  `rootPath` non è un repo git.
- **UI = vista principale dedicata** ("History"), affiancata alla chat nel main pane,
  commutata via flag nella `ui.store` (no router).
- **Backend = dominio git dedicato** `server/domain/git/`, runner `spawn('git', args,
  { cwd })` **senza shell**, sottocomandi allowlisted. Non si passa per il terminal MCP.

Invarianti ereditati dalla spec funzionale, da preservare:

- **Determinismo** — stesso input ⇒ stesse corsie, colori, posizioni. Nessuna scelta
  dipendente da ordine di scoperta o tempo.
- **Colore = funzione pura del nome branch** (`hash(nome) → HSL`), palette separato dai
  4 token UI di Aether.
- **Onestà topologica** — `(no branch ref)` per i commit non reclamati; PR *inferite* dal
  messaggio, mai presentate come verità Git; nessuna ricostruzione del rebase.

## 2. Architettura — vista d'insieme

```
git (backend, spawn senza shell, allowlist)
  └─ server/domain/git/git.runner.ts        esecuzione sicura
       └─ git.service.ts                     log()/diff()/status(); risolve workspaceId→rootPath
            └─ routes/git.routes.ts          GET /api/git/{status,log,diff}
                 └─ src/lib/api/git.api.ts   client fetch tipato
                      └─ src/stores/git.store.ts   stato Zustand
                           └─ src/components/git/GitSwimlanesView.tsx   vista dedicata

Logica pura condivisa: src/lib/git-swimlanes/  (parse, lanes, color, PR, layout, diff classify)
```

**Parsing lato server.** Il runner esegue `git log` col formato testuale; il *parsing*
(`parseLog`) gira **nel service**, così l'API restituisce `CommitNode[]` JSON tipato. Il
client riceve dati strutturati, non testo grezzo. Le funzioni pure di *layout* (corsie,
colori, offset, classificazione diff) restano nel bundle condiviso `src/lib/git-swimlanes/`
e girano client-side (dipendono dallo stato UI di espansione).

> `parseLog` vive in `src/lib/git-swimlanes/` ma viene importato anche dal service backend
> (è codice isomorfo, nessuna dipendenza DOM). L'alias `@/src/lib/...` è già risolvibile dal
> backend (vedi tsconfig/vitest paths).

## 3. Backend

### 3.1 Runner sicuro — `server/domain/git/git.runner.ts`

Rispecchia il pattern di sicurezza di `aether-shell.handler.ts` (timeout SIGTERM→SIGKILL,
cap output, gestione `error`/`exit`) ma:

- `spawn('git', args, { cwd })` con **`shell: false`** → niente interpolazione di shell,
  `hash`/`path` non fidati passano come `argv` separati, immuni a injection.
- **Allowlist di sottocomandi**: solo `log`, `show`, `rev-parse`. `args[0]` deve ∈ allowlist;
  altrimenti errore. Nessuna blocklist.
- `cwd` **obbligatorio** e validato (deve esistere ed essere una directory).
- Cap output (riuso `SHELL_DEFAULTS.outputCapBytes`), timeout default 15s / max 30s.

```ts
const GIT_SUBCOMMANDS = new Set(['log', 'show', 'rev-parse']);

export interface GitRunResult { stdout: string; stderr: string; code: number; }

export async function runGit(args: string[], cwd: string): Promise<GitRunResult>;
// throws GitError se args[0] ∉ allowlist, se cwd non è dir, o su spawn error.
```

`-c core.quotepath=false` e `--no-pager` sono prepended dal runner (o passati come primi
args fissi), non dal chiamante.

### 3.2 Service — `server/domain/git/git.service.ts`

```ts
export class GitService {
  constructor(private readonly workspaces: WorkspacesStore) {}

  /** true se rootPath del workspace è dentro/è un repo git. */
  async status(workspaceId: string): Promise<{ isRepo: boolean; root?: string; head?: string }>;

  /** Parsea git log --all --name-status in CommitNode[] (newest first). */
  async log(workspaceId: string, opts?: { maxCount?: number }): Promise<{ commits: CommitNode[]; truncated: boolean }>;

  /** Diff unificato di un file in un commit. */
  async diff(workspaceId: string, req: { hash: string; path: string; oldPath?: string }): Promise<DiffResult>;
}
```

- `resolveCwd(workspaceId)`: `workspaces.get(id)` → 404 `AppError` se assente; ritorna
  `rootPath`.
- `status`: `git rev-parse --is-inside-work-tree` + `git rev-parse --short HEAD` (best-effort).
- `log`: comando §2.1 della spec funzionale + `--max-count=<n>` (default 500). `truncated`
  = true se il numero di commit raggiunge il cap. Parsing via `parseLog` condiviso.
- `diff`: `git show <hash> -- <path>` (e `-M` con `oldPath` per i rename). **Validazione
  input**: `hash` deve matchare `^[0-9a-f]{7,40}$`; `path` non può iniziare con `-` (evita
  che venga interpretato come flag) — in più `--` già separa flag da pathspec.

### 3.3 Routes — `server/routes/git.routes.ts`

`createGitRoutes(svc: GitService): Router`, montato in `app.ts` solo se `deps.gitService`,
costruito in `index.ts` con `new GitService(workspacesStore)`.

| Metodo | Path | Query | Risposta |
|---|---|---|---|
| GET | `/api/git/status` | `workspaceId` | `{ isRepo, root?, head? }` |
| GET | `/api/git/log` | `workspaceId`, `maxCount?` | `{ commits: CommitNode[], truncated }` |
| GET | `/api/git/diff` | `workspaceId`, `hash`, `path`, `oldPath?` | `text/plain` (diff unificato) |

Validazione query con Zod → `ValidationError`. Errori git (es. repo assente) → `AppError`
con status appropriato, serializzati dal middleware esistente in `{ error: { code, message } }`.

### 3.4 Tipi — `server/domain/git/git.types.ts`

`CommitNode`, `FileChange`, `FileStatusCode`, `DiffResult`, `PullRequestRef` — identici alla
§2.2 della spec funzionale. Riesportati dal bundle condiviso per non duplicare.

## 4. Logica pura condivisa — `src/lib/git-swimlanes/`

Porting 1:1 della spec funzionale, isomorfo (no DOM), copertura test ≥ 80%:

| File | Export | Note |
|---|---|---|
| `parse.ts` | `parseLog(text)` | §4.1. Usato anche dal service backend. |
| `lanes.ts` | `assignLanes(commits, byHash)` → `LaneModel` | §4.3 first-parent claim. |
| `color.ts` | `hueFromName`, `colorFor` | §4.2. `(no branch ref)` → grigio. |
| `pr.ts` | `detectPR(subject)` | §4.4 pattern multi-forge. |
| `layout.ts` | `panelHeight`, `computeOffsets`, `laneX`, `LAYOUT` | §4.5. Ricalcolo a ogni toggle. |
| `diff.ts` | `classifyDiffLine(line)` | §5.3 hunk/meta/add/del/ctx. |
| `types.ts` | tutti i tipi §2.2 | fonte unica di verità. |
| `index.ts` | re-export | superficie pubblica del modulo. |

## 5. Frontend

### 5.1 API client — `src/lib/api/git.api.ts`

```ts
export const gitApi = {
  status: (workspaceId: string) => Promise<GitStatus>,
  log:    (workspaceId: string, maxCount?: number) => Promise<{ commits: CommitNode[]; truncated: boolean }>,
  diff:   (req: DiffRequest & { workspaceId: string }) => Promise<DiffResult>,  // ritorna { unified }
};
```

Thin wrapper su `fetch` + `jsonOrThrow`, come `workspaces.api.ts`. `diff` legge `text()`.

### 5.2 Store — `src/stores/git.store.ts`

Zustand. **Non** parte da `init()` globale in `App.tsx` (è lazy: si carica quando si apre la
vista o cambia il workspace attivo).

```ts
interface GitState {
  status: GitStatus | null;
  commits: CommitNode[];
  truncated: boolean;
  loading: boolean;
  error: string | null;
  expanded: Set<string>;          // hash espansi (accordion file)
  load(workspaceId: string, maxCount?: number): Promise<void>;
  toggleExpand(hash: string): void;
  refresh(): void;                // ricarica il workspace corrente
  reset(): void;
}
```

- `load`: prima `status`; se `!isRepo` setta empty-state e si ferma. Altrimenti `log`.
- Il `LaneModel` **non** è nello store: è derivato con `useMemo([commits])` nel componente.
- L'espansione è nello store così la vista può persisterla tra re-render; gli offset si
  ricalcolano via `computeOffsets(model, expanded)`.

### 5.3 Vista — `src/components/git/`

```
GitSwimlanesView.tsx     orchestratore: legge git.store, deriva LaneModel, gestisce diff modal
  GitGraph.tsx           SVG: guide corsia, archi, nodi (elementi React, NO innerHTML)
  GitCommitRow.tsx       riga commit: hash, badge PR/branch/tag, subject, accordion file
  GitFileRow.tsx         riga file: codice/colore (§5.2), click → richiesta diff
  GitDiffPanel.tsx       render del diff unificato (classifyDiffLine + token DiffView)
  GitLaneLegend.tsx      etichette persistenti di corsia (nome ramo + colore)
  GitEmptyState.tsx      "nessun workspace" / "non è un repo git" / "repo vuoto"
```

**SVG come elementi React.** `<line>/<path>/<circle>` mappati da `LaneModel` + offset.
Niente `dangerouslySetInnerHTML`: i `subject`/nomi branch non finiscono mai in stringhe
SVG iniettate (anti-XSS). Per repo entro il cap (~500) il numero di nodi è gestibile.

**Diff viewer.** `GitDiffPanel` riceve il `{ unified }` da `gitApi.diff`, lo spezza per riga,
classifica con `classifyDiffLine` e applica i **token colore esistenti** di
`DiffView`/theme: `text-status-online`+`bg-status-online/10` (add), `text-status-error`+
`bg-status-error/10` (del), azzurro per hunk, attenuato per meta. Corpo `white-space: pre`,
font `--font-mono`. Stato per-richiesta `{ loading | error | result }` (skeleton in attesa,
gestione file binario/hash assente). Aperto come pannello/overlay glass.

**Token di colore.** Etichette corsia e UI usano i token Aether (`disclosure`,
`manipulation`, `surface-*`, `border-*`). I **colori dei branch nel grafo** usano il palette
deterministico `colorFor` (HSL hash) — è intenzionale che siano un asse cromatico distinto.

### 5.4 Navigazione vista

`App.tsx` rende oggi `<ChatView />` nel main pane. Si introduce in `ui.store`:

```ts
mainView: 'chat' | 'history';   // default 'chat'
setMainView(v): void;
```

`App.tsx` rende condizionalmente `<ChatView />` o `<GitSwimlanesView />`. Toggle nella
`TopBar` (icona git/branch, lucide `GitBranch`), evidenziato con `glow-disc` (è una
"reveal"). Eventuale voce nella command palette ("Apri History"). La vista legge il
`workspaceId` della sessione attiva da `sessions.store`; al cambio sessione/workspace,
`git.store.load(newWorkspaceId)`.

## 6. Sicurezza

- `spawn('git', args, { shell: false })` — nessuna shell injection.
- Allowlist sottocomandi (`log`/`show`/`rev-parse`); tutto il resto rifiutato.
- `hash` validato `^[0-9a-f]{7,40}$`; `path` passato dopo `--`; nessun argomento inizia con `-`.
- `cwd` derivato **solo** da un `workspaceId` esistente in `WorkspacesStore` — l'utente non
  passa path arbitrari all'API.
- Cap output + timeout → niente comandi runaway.
- Read-only per costruzione: nessun sottocomando muta repo o working tree.

## 7. Testing

**Backend (project `backend`, node):**
- `git.runner.test.ts` — rifiuto sottocomandi fuori allowlist; rifiuto args con shell-meta;
  timeout; cap output. Mock/temp dir.
- `git.service.test.ts` — **fixture repo git temporaneo deterministico** costruito nel test
  (`git init` → commit → branch → merge → tag), verifica end-to-end di `log` (corsie reali),
  `diff`, `status`, ed empty-state su dir non-repo.

**Logica pura (project `frontend`, ≥80% coverage):**
- `parse.test.ts`, `lanes.test.ts` (incl. caso `(no branch ref)` e dedup remote/locale),
  `color.test.ts` (determinismo/stabilità hue), `pr.test.ts` (tutti i pattern forge),
  `layout.test.ts` (offset con/ senza espansione), `diff.test.ts` (classificazione righe).

**Store:** `git.store.test.ts` — `load` con isRepo true/false, `toggleExpand`, errori.

**E2e (Playwright, opzionale in questa slice):** apertura vista History su un repo di prova,
espansione di un commit, apertura diff di un file.

## 8. Fuori scope (slice future)

- Azioni write/remote (checkout/commit/restore/push) → Tier 2/3 (slice 28+), ognuna gated da
  breakpoint (slice 22) con preview diff.
- Integrazione API della forge per ricostruire PR/branch cancellati e PR in rebase.
- File-watching / auto-refresh (MVP: refresh manuale).
- Sintassi-highlighting nel diff.
- Paginazione incrementale oltre il semplice "carica altri" (alza `maxCount`).

## 9. Checklist di consegna

- [ ] `server/domain/git/{git.types,git.runner,git.service}.ts` + test
- [ ] `server/routes/git.routes.ts`; wiring in `app.ts` + `index.ts`
- [ ] `src/lib/git-swimlanes/*` (porting funzioni pure) + test
- [ ] `src/lib/api/git.api.ts`, `src/stores/git.store.ts` + test
- [ ] `src/components/git/*` (vista, grafo SVG, righe, diff panel, empty-state)
- [ ] `ui.store`: `mainView` + toggle TopBar + voce command palette
- [ ] i18n strings (`src/i18n/`) per etichette/empty-state
- [ ] `npm run lint` (tsc) e `npm run test:run` verdi; coverage soglie rispettate
- [ ] aggiornare `docs/superpowers/roadmap.md` (slice 27 → shipped)
```
