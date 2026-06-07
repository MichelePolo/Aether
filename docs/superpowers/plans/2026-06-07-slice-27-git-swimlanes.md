# Slice 27 — Git Swimlanes (piano di esecuzione)

> Design: `docs/superpowers/specs/2026-06-07-slice-27-git-swimlanes-design.md`.
> Branch: `feat/slice-27-git-swimlanes`. Read-only (Tier 1).
>
> Ordine **bottom-up**: prima la logica pura e il backend (testabili in isolamento),
> poi l'API, poi il frontend, infine la navigazione e i ritocchi. Ogni step termina con un
> checkpoint verde (`npm run lint` = tsc, più i test indicati). Nessuna migrazione SQLite.

## Convenzioni

- Dopo ogni step: `npm run lint` deve passare. Dove indicato, anche i test mirati.
- Test colocati `*.test.ts(x)` accanto al sorgente (vedi CLAUDE.md). `globals` on.
- Commit per step (messaggi `feat(slice-27): …`), così la PR è leggibile.
- Coverage ≥80% su `src/lib/**`, `src/stores/**`, `server/domain/**`.

---

## Step 1 — Logica pura condivisa `src/lib/git-swimlanes/`

Porting 1:1 dalla spec funzionale. Isomorfo (no DOM).

**File:**
- `types.ts` — `FileStatusCode`, `FileChange`, `CommitNode`, `LaneModel`, `DiffRequest`,
  `DiffResult`, `PullRequestRef`, `SwimlanesOptions`.
- `color.ts` — `hueFromName`, `colorFor`.
- `parse.ts` — `parseLog(text)`.
- `pr.ts` — `detectPR(subject)`.
- `lanes.ts` — `priority`, `assignLanes(commits, byHash)`.
- `layout.ts` — `LAYOUT`, `laneX`, `PANEL`, `panelHeight`, `computeOffsets`.
- `diff.ts` — `classifyDiffLine(line)`.
- `index.ts` — re-export pubblico.

**Test (stesso step):**
- `color.test.ts` — determinismo (stesso nome → stesso hue), `(no branch ref)` → grigio.
- `parse.test.ts` — header+file rows; rename `R100\told\tnew`; subject con `|`; righe vuote.
- `pr.test.ts` — ogni pattern forge (Azure/GitHub/GitLab/Bitbucket/squash) + nessun match.
- `lanes.test.ts` — claim first-parent; priorità main/develop/alfabetico; dedup remote/locale
  (preferisci locale); caso fallback `(no branch ref)`.
- `layout.test.ts` — `computeOffsets` con/ senza espansione; `panelHeight` cap a 250.
- `diff.test.ts` — hunk/meta/add/del/ctx.

**Checkpoint:** `npx vitest run --project frontend src/lib/git-swimlanes` verde; lint verde.

---

## Step 2 — Tipi e runner backend `server/domain/git/`

**`git.types.ts`** — riesporta i tipi da `@/src/lib/git-swimlanes/types` + tipi backend
(`GitRunResult`, `GitStatus`). Niente duplicazione.

**`git.runner.ts`:**
- `GIT_SUBCOMMANDS = new Set(['log','show','rev-parse'])`.
- `runGit(args: string[], cwd: string): Promise<GitRunResult>`:
  - valida `args[0] ∈ allowlist` → altrimenti `GitError`.
  - valida `cwd` esiste ed è directory → altrimenti `GitError`.
  - `spawn('git', ['-c','core.quotepath=false','--no-pager', ...args], { cwd, shell: false })`.
  - cap output (`SHELL_DEFAULTS.outputCapBytes`), timeout 15s/30s con SIGTERM→SIGKILL,
    gestione `error`/`exit` (modello `aether-shell.handler.ts`).
- `GitError` estende `AppError` (`server/lib/errors.ts`) con status appropriato.

**Test:** `git.runner.test.ts` — rifiuto sottocomando fuori allowlist; rifiuto `cwd`
inesistente; happy path su un mini repo temporaneo (`git init` + 1 commit) verifica stdout;
timeout (comando lento simulato o cap basso).

**Checkpoint:** `npx vitest run --project backend server/domain/git` verde; lint verde.

---

## Step 3 — Service `server/domain/git/git.service.ts`

- `class GitService { constructor(private workspaces: WorkspacesStore) }`.
- `resolveCwd(workspaceId)` → `workspaces.get(id)?.rootPath` o `AppError` 404.
- `status(workspaceId)` → `rev-parse --is-inside-work-tree` + `rev-parse --short HEAD`
  (best-effort, non lancia se non-repo: ritorna `{ isRepo:false }`).
- `log(workspaceId, {maxCount=500})` → comando §2.1 spec + `--max-count`; `parseLog(stdout)`;
  `truncated = commits.length >= maxCount`.
- `diff(workspaceId, {hash, path, oldPath})` → valida `hash ^[0-9a-f]{7,40}$`; `git show`
  (`-M` se `oldPath`) con pathspec dopo `--`; ritorna `{ unified: stdout }`.

**Test:** `git.service.test.ts` con **fixture repo temporaneo deterministico** (helper che fa
`git init` con `user.email/name` fissi, una sequenza nota di commit/branch/merge/tag su una
temp dir). Verifica:
- `status` true su repo, false su dir vuota / `workspaceId` inesistente → 404.
- `log` → numero commit, ordine newest-first, branch/tag sui tip, parents corretti; con merge
  reale le corsie via `assignLanes` sono quelle attese.
- `diff` di un file modificato → contiene righe `+`/`-`; hash invalido → `ValidationError`.

**Checkpoint:** test backend git verdi; lint verde.

---

## Step 4 — Route e wiring `server/routes/git.routes.ts`

- `createGitRoutes(svc: GitService): Router`:
  - `GET /status?workspaceId` → `{ isRepo, root?, head? }`.
  - `GET /log?workspaceId&maxCount?` → `{ commits, truncated }`.
  - `GET /diff?workspaceId&hash&path&oldPath?` → `text/plain`.
  - Query validate con Zod → `ValidationError`.
- `server/app.ts`: `if (deps.gitService) app.use('/api/git', createGitRoutes(deps.gitService));`
  (prima del middleware d'errore).
- `AppDeps`: aggiungere `gitService?: GitService`.
- `server/index.ts` bootstrap: `const gitService = new GitService(workspacesStore);` e passarlo
  a `createApp`.

**Test:** `git.routes.test.ts` — app minimale con solo `gitService` (fixture repo); 200 su
`/status` e `/log`, 400 su query mancanti/hash invalido, 404 su workspace inesistente.

**Checkpoint:** test verdi; lint verde.

---

## Step 5 — API client + store frontend

**`src/lib/api/git.api.ts`** — `gitApi.status/log/diff` (thin `fetch` + `jsonOrThrow`;
`diff` legge `text()` e ritorna `{ unified }`).

**`src/stores/git.store.ts`** (Zustand):
- stato: `status, commits, truncated, loading, error, expanded:Set<string>, activeWorkspaceId`.
- `load(workspaceId, maxCount?)`: `status` prima; se `!isRepo` → empty-state e stop; altrimenti
  `log`. Pattern loading/error come `workspaces.store`.
- `toggleExpand(hash)`, `refresh()`, `reset()`.

**Test:** `git.store.test.ts` (mock `gitApi`) — `load` isRepo true/false; errore di rete;
`toggleExpand` aggiunge/rimuove; `refresh` ricarica `activeWorkspaceId`.

**Checkpoint:** `npx vitest run --project frontend src/stores/git.store` + `src/lib/api`;
lint verde.

---

## Step 6 — Componenti vista `src/components/git/`

In ordine di dipendenza:
1. `GitLaneLegend.tsx` — etichette persistenti corsia (nome ramo + `colorFor`).
2. `GitGraph.tsx` — SVG **elementi React**: guide corsia (opacity 0.07), archi (`edgePath` →
   `<line>`/`<path>`), nodi (cerchio/ciambella merge/alone PR). Input: `LaneModel` + offset.
3. `GitFileRow.tsx` — riga file: codice→colore/etichetta (§5.2 spec), click → `onFileSelect`.
4. `GitCommitRow.tsx` — hash, badge PR/branch/tag, subject, contatore file, accordion
   (delegazione: `closest('.frow')` prima di `closest('.crow')`).
5. `GitDiffPanel.tsx` — riceve `{unified}`, split righe, `classifyDiffLine`, token colore
   `DiffView` (`status-online`/`status-error`/hunk azzurro/meta attenuato), `pre`+mono;
   stato `{loading|error|result}`, skeleton, gestione binario/hash assente.
6. `GitEmptyState.tsx` — varianti: no workspace / non-repo / repo vuoto.
7. `GitSwimlanesView.tsx` — orchestratore: legge `git.store`, deriva `LaneModel`
   (`useMemo([commits])`) e offset (`computeOffsets(model, expanded)`), allinea SVG+righe,
   apre il diff via `gitApi.diff`, header con refresh + "carica altri" (alza `maxCount`).

Token UI Aether per chrome (`surface-*`, `border-*`, `disclosure`/`manipulation`); palette
`colorFor` solo per i branch nel grafo. Icone lucide.

**Checkpoint:** lint verde; render manuale con `AETHER_FAKE_PROVIDER=1 npm run dev` su questo
stesso repo (è un repo git reale → fixture vivente).

---

## Step 7 — Navigazione vista

- `src/stores/ui.store.ts`: aggiungere `mainView: 'chat'|'history'` (default `'chat'`,
  **non** persistito o persistito a scelta), `setMainView(v)`.
- `App.tsx`: nel main pane, render condizionale `mainView === 'history' ? <GitSwimlanesView/>
  : <ChatView/>`.
- `TopBar`: toggle icona `GitBranch` (lucide), `aria-pressed`, `glow-disc`.
- Al cambio sessione/workspace (sub a `sessions.store`), `git.store.load(workspaceId)` quando
  la vista è attiva.
- (Opz.) voce command palette "Apri History".

**Test:** `ui.store.test.ts` — `setMainView` aggiorna lo stato (estendere il test esistente se
presente).

**Checkpoint:** lint verde; toggle vista funziona nel dev server.

---

## Step 8 — i18n + rifiniture

- Stringhe in `src/i18n/` per: titolo vista, label refresh / carica altri, empty-state,
  etichette stato file, badge PR/branch/tag, errori diff.
- A11y: focus-visible su righe/toggle, `aria-expanded` sugli accordion, ruoli su SVG
  (`role="img"` + `aria-label` sul grafo).
- Verifica nessun `dangerouslySetInnerHTML`, nessun `localStorage` nei componenti git.

**Checkpoint:** lint verde; `npm run test:run` **intero** verde; `npm run test:coverage`
rispetta le soglie.

---

## Step 9 — Docs + PR

- `docs/superpowers/roadmap.md`: spostare slice 27 in **Shipped** (riga + `✅`), e nota che il
  Tier 1 di Git integration è spedito; Tier 2/3 restano candidati.
- (Opz.) breve voce in `docs/` se serve.
- Aprire PR `feat/slice-27-git-swimlanes` → `main` con descrizione: scope read-only, decisioni
  (workspace-rooted, vista dedicata, dominio git dedicato), screenshot della vista, fuori scope.

---

## Riepilogo dipendenze tra step

```
1 (pure lib) ─┬─> 2 (runner) ─> 3 (service) ─> 4 (routes+wiring)
              └─> 5 (api+store) ─> 6 (componenti) ─> 7 (navigazione) ─> 8 (i18n/a11y) ─> 9 (docs/PR)
```

Step 1 sblocca sia il backend (2-4, che riusa `parseLog`) sia il frontend (5-6). 2→3→4 e
5→6→7→8 sono catene seriali; i due rami possono procedere in parallelo dopo lo step 1.

## Rischi / note

- **`assignLanes` su repo reali grandi**: il cap `maxCount` limita i commit, ma un branch il
  cui tip è oltre il cap non viene reclamato → più commit in `(no branch ref)`. Atteso e
  onesto; documentare nell'empty-hint del legend.
- **Import isomorfo** `@/src/lib/git-swimlanes` dal backend: verificare che esbuild bundli il
  modulo nel `dist/server.cjs` (nessuna dipendenza DOM, quindi ok; controllare in `npm run
  build`).
- **Allineamento SVG/righe**: l'unica fonte di verità degli offset è `computeOffsets`; sia il
  grafo che le righe la consumano. Test visivo manuale al checkpoint step 6.
```
