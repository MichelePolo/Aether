# Prebuilt-Tarball Installer — Design Spec

> Status: approved (brainstorming) · Date: 2026-06-30 · Topic: fix the broken `npm i -g github:` installer by shipping a prebuilt tarball asset

## Goal

Rendere l'installazione di Aether **affidabile** su tutti i package manager, eliminando il build-da-sorgente all'install. Il fix: la CI, a ogni release, produce un **tarball prebuilt** (`aether-core.tgz`) e lo carica come **asset della GitHub Release**; i comandi d'install puntano a quel tarball. Installare un tarball **non esegue `prepare`** → niente build, niente bug npm, niente toolchain sul client.

## Contesto: il bug da risolvere

L'installer attuale (`<pm> i -g github:MichelePolo/Aether#semver:*`) **è rotto**. Root cause (confermata): `npm i -g <git-url>` fa "leakare" `npm_config_global=true` nello script `prepare` della git-dep; l'install nidificato mette le devDeps (`esbuild`/`vite`) nel prefix **globale** invece che nel `node_modules` del clone → `node scripts/build.mjs` fallisce con `Cannot find package 'esbuild'`. Prova: `npm i` **locale** funziona (no leak), solo `-g` fallisce; con `npm_config_global=true` l'install lascia 0 pacchetti nel clone, con `--global=false` ne lascia 474. Bug noto di npm (visto su Debian npm 9.2.0 / Node 22).

Secondo problema collaterale: dopo il merge di PR #92, release-please (col cambio `include-component-in-tag:false`) ha **resettato la versione 0.1.14 → 0.1.0** e taggato `v0.1.0`. Da correggere.

Stato attuale di `package.json` su main (0.1.0): `files:["dist"]`, `bin:{aether:"dist/cli.cjs"}`, `scripts.prepare:"npm run build"`, `esbuild`/`vite` in devDependencies, `private:true`.

## Decisioni fissate (dal brainstorming)

- **Approccio A — tarball asset** (non branch con `dist` committato): repo pulito, CI minima.
- **CI minima:** un workflow che gira **solo `on: release: published`** (a ogni rilascio), niente carico su PR/push.
- **`prepare` resta** in `package.json` (serve alla CI per buildare `dist/` durante `npm pack`; non viene eseguito quando si installa il tarball).
- **Versioning:** riportare il manifest a `0.1.14` → prossima release `0.1.15`, considerata la **prima release installabile**. Le versioni precedenti sono **alpha**, mai distribuite (solo l'autore): **nessun riferimento** ad esse in docs/sito/README.
- Il **sito** ([[aether-pages-site]]) e il README adottano i comandi finali e si pubblicano **da 0.1.15 in poi** (quando l'asset esiste).

## Architettura

### 1. Workflow CI — `.github/workflows/release-asset.yml`

```yaml
name: release-asset
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
        with: { node-version: 20, cache: npm }
      - run: npm ci                 # builda dist/ via prepare (sulla CI: nessun leak)
      - run: npm pack               # -> aether-core-<version>.tgz (include dist/)
      - run: mv aether-core-*.tgz aether-core.tgz   # nome fisso per /latest/download
      - run: gh release upload "${{ github.event.release.tag_name }}" aether-core.tgz --clobber
        env: { GH_TOKEN: ${{ secrets.GITHUB_TOKEN }} }
```

Risultato: ogni Release ha l'asset `aether-core.tgz`, quindi esiste sempre
`https://github.com/MichelePolo/Aether/releases/latest/download/aether-core.tgz`.

> Nota: `npm ci` esegue `prepare` (build) perché `prepare` gira su install-da-cartella; va bene, è ciò che produce `dist/` prima di `npm pack`. In alternativa `npm ci && npm run build` esplicito — equivalente; si usa `npm ci` + `npm pack` (pack ri-builda via prepack/prepare, idempotente).

### 2. Perché il tarball azzera il bug

`npm i -g <tarball>` **non** invoca `prepare` (gira solo su git-dep, publish, pack, e install-da-cartella-senza-args — **non** sui tarball). Quindi: nessun build all'install, nessun `npm_config_global` leak, nessun esbuild/vite richiesti sul client. Il tarball contiene già `dist/` (via `files:["dist"]`), e l'install installa solo le **dependencies** runtime (`better-sqlite3` scarica il prebuilt nativo). Il `bin` `aether → dist/cli.cjs` viene linkato. Verificato in locale: `npm pack` + `npm i -g ./aether-core.tgz` → `aether --help` funziona (è il percorso che il Task 3 dell'installer aveva già validato).

### 3. Comandi d'install finali

```bash
# npm / pnpm / bun
npm  i   -g https://github.com/MichelePolo/Aether/releases/latest/download/aether-core.tgz
pnpm add -g https://github.com/MichelePolo/Aether/releases/latest/download/aether-core.tgz
bun  add -g https://github.com/MichelePolo/Aether/releases/latest/download/aether-core.tgz
```
- `install.sh` / `install.ps1`: check Node ≥ 20 → `npm i -g <TARBALL_URL>` → `aether daemon start --open`. (Sostituiscono il `github:#semver:*`.)
- Costante `TARBALL_URL = https://github.com/MichelePolo/Aether/releases/latest/download/aether-core.tgz`.
- **Da verificare nel piano:** `bun add -g <tgz-url>`. npm e pnpm supportano l'install di tarball da URL con certezza; se bun non lo supporta, per quel solo canale si documenta `npm`/`pnpm` o il fallback.

### 4. Fix versioning

`.release-please-manifest.json`: `{ ".": "0.1.14" }` (da `0.1.0`). Così il prossimo merge della release-PR di release-please bumpa a **0.1.15** e tagga `v0.1.15`. La release `v0.1.0` resta in storia (orfana, innocua). `release-please-config.json` resta con `include-component-in-tag:false` (i tag `v*` vanno bene; è ciò che vogliamo).

## Data flow (install via npm, esempio)

1. `npm i -g <tarball-url>` → npm scarica `aether-core.tgz`.
2. npm scompatta: `package.json` + `dist/` (prebuilt) + installa le `dependencies` runtime (no devDeps, no build). `better-sqlite3` → prebuilt nativo.
3. `bin: aether` linkato nel prefix globale.
4. `aether daemon start --open` → avvia `dist/server.cjs`, apre il browser.

## Error handling / edge cases

- **Prefix globale root-owned** (`/usr/local`): `npm i -g` richiede sudo, oppure prefix utente (`npm config set prefix ~/.npm-global`). Documentato nel troubleshooting (non è il nostro bug, è la classica permission del prefix).
- **`better-sqlite3` senza prebuilt** per la piattaforma → compila (servono build tools). Documentato (già nel troubleshooting esistente).
- **Prima della 0.1.15:** l'asset non esiste ancora, quindi i comandi vanno resi pubblici (sito/README) **contestualmente al rilascio 0.1.15**. Non si documentano versioni precedenti né workaround "transitori": 0.1.15 è la prima release installabile.
- **`gh release upload --clobber`**: sovrascrive se l'asset esiste già (re-run idempotente).

## Testing

- **Locale (riproduce l'esito utente):** `npm ci` → `npm pack` → in una dir pulita `npm i -g ./aether-core.tgz` (prefix utente, niente sudo) → `aether --help` stampa l'help; `aether --port 3001 daemon start` parte (3000 occupata da openwebui). Poi `aether daemon stop` + `npm rm -g aether-core` per cleanup.
- **Workflow YAML:** validazione sintattica (`node -e` parse / o `actionlint` se disponibile); l'esecuzione reale si valida al primo `release: published`.
- **Script install:** `bash -n scripts/install/install.sh`; `shellcheck` se disponibile.
- Le suite esistenti (`npm run lint`, `npm run test:run`) restano verdi: le modifiche sono CI/docs/manifest + 2 script, nessun codice runtime.

## Out of scope (YAGNI)

- Branch `release` con `dist` committato (scartato a favore del tarball).
- Pubblicazione su registry npm.
- Firma/notarizzazione del tarball.
- Auto-update; il re-install rifà l'install dell'ultima release.
- Refactor del workflow `release-please.yml` esistente (lasciato com'è; aggiungiamo un workflow separato).

## File toccati (riepilogo)

- **Create:** `.github/workflows/release-asset.yml`.
- **Modify:** `.release-please-manifest.json` (→ 0.1.14), `scripts/install/install.sh` + `install.ps1` (URL tarball), `README.md` (comandi). Il **sito** (`/tmp/aether-site` → `install.html` + troubleshooting) si aggiorna nel ciclo del sito, non qui.
