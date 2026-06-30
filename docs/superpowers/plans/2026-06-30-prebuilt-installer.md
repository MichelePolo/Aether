# Prebuilt-Tarball Installer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Sostituire l'installer rotto (`npm i -g github:…#semver:*`, fallisce per il bug npm global-leak) con un **tarball prebuilt** caricato come asset della GitHub Release; i comandi puntano al tarball (`npm i -g <url>`), che non builda all'install.

**Architecture:** Un workflow CI `on: release: published` fa `npm pack` (builda `dist/` sulla CI) e carica `aether-core.tgz` come asset, dando l'URL stabile `releases/latest/download/aether-core.tgz`. Installare un tarball NON esegue `prepare` → niente build/leak/toolchain sul client. `dist/` viaggia nel tarball via `files:["dist"]`. Si corregge anche il versioning (manifest → 0.1.14 → prossima 0.1.15, prima release installabile).

**Tech Stack:** GitHub Actions, `npm pack`, `gh release upload`, release-please, bash + PowerShell.

## Global Constraints

- Repo: `MichelePolo/Aether` (pubblico). `package.json` su `main`: `version 0.1.0`, `files:["dist"]`, `bin:{aether:"dist/cli.cjs"}`, `scripts.prepare:"npm run build"`, `private:true` — **tutto invariato** (il fix non tocca package.json).
- URL canonico del tarball: `https://github.com/MichelePolo/Aether/releases/latest/download/aether-core.tgz` (asset a **nome fisso** `aether-core.tgz`).
- CI minima: il workflow gira **solo `on: release: published`**.
- **0.1.15 è la prima release installabile.** Nessun riferimento a versioni precedenti (alpha, mai distribuite) in docs/README.
- `prepare` resta in `package.json` (serve a `npm pack`/CI; non gira sull'install del tarball).
- Lint = `npm run lint`; suite = `npm run test:run` — restano verdi (modifiche solo CI/docs/manifest/script).
- Prefix npm globale può essere root-owned → install richiede sudo o prefix utente (caveat di permessi, non il nostro bug).

---

## Task 1: Verifica locale del meccanismo tarball (gate)

**Files:** nessuna modifica — è una verifica che PROVA la premessa prima di automatizzarla.

**Interfaces:**
- Produces: conferma che `npm pack` + `npm i -g <tarball-locale>` installa un `aether` funzionante **senza buildare** (niente `prepare`, niente esbuild/vite richiesti).

- [ ] **Step 1: Build + pack**

Dal repo:
```bash
npm ci          # installa deps + builda dist/ via prepare (local: nessun leak)
npm pack        # -> aether-core-0.1.0.tgz  (contiene dist/ via files:["dist"])
```
Expected: viene creato `aether-core-0.1.0.tgz`; `tar -tzf aether-core-0.1.0.tgz | grep -E 'package/dist/(server\.cjs|cli\.cjs|index\.html)'` elenca quei file.

- [ ] **Step 2: Install globale del tarball in un prefix utente (niente sudo) e niente build**

```bash
export NPM_CONFIG_PREFIX="$HOME/.npm-aether-test"
mkdir -p "$NPM_CONFIG_PREFIX"
export PATH="$NPM_CONFIG_PREFIX/bin:$PATH"
npm install -g "./aether-core-0.1.0.tgz"
```
Expected: install **senza** l'errore `Cannot find package 'esbuild'` (il tarball non esegue `prepare`). Il bin viene linkato in `$NPM_CONFIG_PREFIX/bin/aether`.

- [ ] **Step 3: Il comando funziona**

```bash
aether --help
aether --port 3001 daemon start
aether daemon status
aether daemon stop
```
Expected: `--help` stampa l'uso; il daemon parte sul 3001 (la 3000 è occupata da openwebui sulla macchina dell'autore) e `status` riporta running, poi stopped.

- [ ] **Step 4: (Se `bun` è installato) verifica il canale bun col tarball locale**

```bash
command -v bun && bun add -g "./aether-core-0.1.0.tgz" && echo "bun OK" || echo "bun ASSENTE o non supporta il tarball -> documentare fallback"
```
Expected: se bun c'è, registra se l'install del tarball funziona. **Annotare l'esito** (decide se il canale bun usa l'URL tarball o un fallback documentato nel Task 5). Se bun manca, annotarlo e proseguire (verifica rimandata).

- [ ] **Step 5: Cleanup**

```bash
npm rm -g aether-core 2>/dev/null || true
command -v bun && bun remove -g aether-core 2>/dev/null || true
rm -f aether-core-0.1.0.tgz
rm -rf "$HOME/.npm-aether-test"
unset NPM_CONFIG_PREFIX
```
Nessun commit (task di sola verifica). Se lo Step 2/3 fallisce, **fermarsi e segnalare** (la premessa del piano è invalidata).

---

## Task 2: Fix versioning (release-please manifest)

**Files:**
- Modify: `.release-please-manifest.json`

**Interfaces:**
- Produces: il prossimo rilascio di release-please sarà `0.1.15` (tag `v0.1.15`).

- [ ] **Step 1: Riportare il manifest a 0.1.14**

Contenuto attuale: `{ ".": "0.1.0" }`. Sostituirlo con:
```json
{
  ".": "0.1.14"
}
```

- [ ] **Step 2: Validare il JSON**

Run: `node -e "JSON.parse(require('fs').readFileSync('.release-please-manifest.json','utf8')); console.log('ok')"`
Expected: stampa `ok`.

> Effetto: al prossimo merge della release-PR di release-please, bumpa da 0.1.14 → 0.1.15 e tagga `v0.1.15`. La release `v0.1.0` resta in storia, orfana e non referenziata.

- [ ] **Step 3: Commit**
```bash
git add .release-please-manifest.json
git commit -m "ci: reset release-please manifest to 0.1.14 (next release = 0.1.15)"
```

---

## Task 3: Workflow CI — `release-asset.yml`

**Files:**
- Create: `.github/workflows/release-asset.yml`

**Interfaces:**
- Consumes: `package.json` `prepare`/`files` (build + pack). 
- Produces: a ogni Release pubblicata, l'asset `aether-core.tgz` → URL `releases/latest/download/aether-core.tgz`.

- [ ] **Step 1: Scrivere il workflow**

```yaml
name: release-asset

# Builds a prebuilt tarball and attaches it to the GitHub Release as
# `aether-core.tgz`, so installs can use the stable URL
# https://github.com/MichelePolo/Aether/releases/latest/download/aether-core.tgz
# Installing a tarball does NOT run `prepare`, so the client never builds.
on:
  release:
    types: [published]

permissions:
  contents: write

jobs:
  tarball:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v5

      - uses: actions/setup-node@v5
        with:
          node-version: 20
          cache: npm

      - name: Install dependencies (builds dist/ via prepare)
        run: npm ci

      - name: Pack the prebuilt tarball
        run: |
          npm pack
          mv aether-core-*.tgz aether-core.tgz

      - name: Attach tarball to the release
        env:
          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
        run: gh release upload "${{ github.event.release.tag_name }}" aether-core.tgz --clobber
```

- [ ] **Step 2: Validare lo YAML**

Run: `node -e "const y=require('fs').readFileSync('.github/workflows/release-asset.yml','utf8'); if(!/on:\s*[\s\S]*release:/.test(y)||!y.includes('aether-core.tgz')||!y.includes('gh release upload')) throw new Error('workflow incompleto'); console.log('ok')"`
Expected: stampa `ok`.

> L'esecuzione reale si valida al primo `release: published` (0.1.15). `npm ci` esegue `prepare` (build) → `dist/` pronto prima di `npm pack`.

- [ ] **Step 3: Commit**
```bash
git add .github/workflows/release-asset.yml
git commit -m "ci: publish prebuilt aether-core.tgz as a release asset on each release"
```

---

## Task 4: Script di install → URL tarball

**Files:**
- Modify: `scripts/install/install.sh`, `scripts/install/install.ps1`

**Interfaces:**
- Consumes: l'URL tarball (Task 3 lo rende disponibile da 0.1.15).
- Produces: gli script installano dal tarball, niente più `github:#semver:*`.

- [ ] **Step 1: `install.sh`**

Sostituire la riga `REPO="github:MichelePolo/Aether#semver:*"` con:
```sh
TARBALL="https://github.com/MichelePolo/Aether/releases/latest/download/aether-core.tgz"
```
Sostituire il blocco install (commento + echo + npm):
```sh
# 2. Install globally from the latest release tag
echo "Installing Aether (${REPO}) ..."
npm install -g "$REPO"
```
con:
```sh
# 2. Install the latest prebuilt release tarball (no build on the client)
echo "Installing Aether ..."
npm install -g "$TARBALL"
```

- [ ] **Step 2: `install.ps1`**

Sostituire `$Repo = 'github:MichelePolo/Aether#semver:*'` con:
```powershell
$Tarball = 'https://github.com/MichelePolo/Aether/releases/latest/download/aether-core.tgz'
```
Sostituire:
```powershell
Write-Host "Installing Aether ($Repo) ..."
npm install -g "$Repo"
```
con:
```powershell
Write-Host "Installing Aether ..."
npm install -g $Tarball
```

- [ ] **Step 3: Verifica sintassi**

Run: `sh -n scripts/install/install.sh`
Expected: exit 0, nessun output.
Run (se `shellcheck` c'è): `shellcheck -s sh scripts/install/install.sh` → nessun warning bloccante. (Se assente, annotare.)

- [ ] **Step 4: Commit**
```bash
git add scripts/install/install.sh scripts/install/install.ps1
git commit -m "feat(install): install from prebuilt release tarball (no client build)"
```

---

## Task 5: README — comandi d'install al tarball

**Files:**
- Modify: `README.md` (sezione `## Install (one-liner)`)

- [ ] **Step 1: Sostituire la sezione**

Rimpiazzare l'intero blocco da `## Install (one-liner)` fino a (esclusa) la riga `## Run locally` con:
```markdown
## Install (one-liner)

**Prerequisite:** Node.js 20+ (the install downloads a prebuilt tarball;
`better-sqlite3` fetches a prebuilt native binary on most platforms — no build
toolchain needed).

```bash
# macOS / Linux
curl -fsSL https://raw.githubusercontent.com/MichelePolo/Aether/main/scripts/install/install.sh | bash

# Windows (PowerShell)
powershell -c "irm https://raw.githubusercontent.com/MichelePolo/Aether/main/scripts/install/install.ps1 | iex"

# npm / pnpm / bun  (then: aether daemon start --open)
npm  i   -g https://github.com/MichelePolo/Aether/releases/latest/download/aether-core.tgz
pnpm add -g https://github.com/MichelePolo/Aether/releases/latest/download/aether-core.tgz
bun  add -g https://github.com/MichelePolo/Aether/releases/latest/download/aether-core.tgz
```

The curl/PowerShell scripts check Node, install the latest prebuilt release, then
run `aether daemon start --open` (starts the local server and opens the browser).
The npm/pnpm/bun commands install the same tarball; afterwards run
`aether daemon start --open` yourself. To build from a clone instead, see
**Run locally** below.
```

> Se il Task 1 Step 4 ha rilevato che `bun add -g <tgz-url>` NON funziona, rimuovere la riga `bun` da questo blocco e aggiungere una nota "bun: usa npm/pnpm o scarica il tarball e `bun add -g ./aether-core.tgz`".

- [ ] **Step 2: Verifica**

Run: `grep -n "releases/latest/download/aether-core.tgz" README.md`
Expected: trova le righe npm/pnpm/bun.
Run: `grep -c "semver:\*" README.md`
Expected: `0` (nessun residuo del vecchio comando).

- [ ] **Step 3: Commit**
```bash
git add README.md
git commit -m "docs: install via prebuilt release tarball URL"
```

---

## Self-review (esito)

- **Copertura spec:** workflow CI `on: release: published` + pack + upload asset a nome fisso (Task 3) ✓; il tarball non builda all'install — verificato localmente (Task 1) ✓; comandi finali npm/pnpm/bun + curl/powershell (Task 4/5) ✓; bun verificato/fallback (Task 1 Step 4 + Task 5 nota) ✓; fix versioning manifest → 0.1.14 (Task 2) ✓; 0.1.15 = prima release, nessun riferimento alle precedenti (Task 5 prosa, Global Constraints) ✓; `prepare`/`package.json` invariati (Global Constraints) ✓.
- **Placeholder scan:** nessun TBD/TODO; ogni step ha comandi/codice esatti.
- **Coerenza:** l'URL `releases/latest/download/aether-core.tgz` e il nome asset `aether-core.tgz` identici tra Task 3 (upload), Task 4 (script) e Task 5 (README); `0.1.14`→`0.1.15` coerente tra Task 2 e Global Constraints.
- **Rischi gestiti:** bug npm-leak azzerato dal tarball (verificato Task 1); bun incerto → verifica + fallback; transizione 0.1.15 → sito/README pubblicati col rilascio (non si crea l'asset a mano su 0.1.0).
- **Fuori da questo piano:** aggiornare i comandi/troubleshooting del **sito** e pubblicarlo (ciclo del sito), dopo che 0.1.15 è rilasciata.
