# One-line Installer (pi.dev-style) — Design Spec

> Status: approved (brainstorming) · Date: 2026-06-25 · Topic: copy-paste install across 5 channels

## Goal

Offrire l'installazione di Aether con comandi copia-incolla in stile pi.dev, su **5 canali**: `curl` (macOS/Linux), `powershell` (Windows), `npm`, `pnpm`, `bun`. Tutti installano da una **release** del repo **pubblico** `MichelePolo/Aether`, senza alcun registry npm. Dopo l'install (per i canali curl/powershell) Aether si avvia e apre il browser.

## Decisioni fissate (dal brainstorming)

- **Node è un prerequisito accettabile** sul client (gli script bootstrap lo verificano; auto-install solo best-effort con conferma).
- **Nessun registry**: il repo è pubblico, quindi si installa da **git URL** (`github:MichelePolo/Aether`). `private: true` resta in `package.json` (blocca solo `npm publish`, non l'install da git).
- **5 canali, 1 meccanismo** (Approccio A): il vero installer è `<pm> i -g github:MichelePolo/Aether#semver:*`, dove lo script `prepare` builda `dist/` durante l'install. curl/powershell sono wrapper sottili (check Node → quel comando → avvio).
- `#semver:*` aggancia il **tag di release** con versione più alta (coerente con "data una release", evita `main` instabile).
- **Post-install** (curl/powershell): `aether daemon start --open` → avvia il daemon e apre il browser.
- **Build cross-platform** è prerequisito abilitante: oggi il `build` usa coreutils POSIX (`rm -rf`, `mkdir -p`, `cp -R`) e quoting di shell fragile, che rompe su Windows nudo. Va reso portabile perché `prepare` lo esegue sulla macchina di ogni utente.

## Stato attuale (punto di partenza)

- Pipeline release = **release-please** (`.github/workflows/release-please.yml`): tagga e pubblica una GitHub Release (sorgente + note), **nessun artefatto** allegato.
- `package.json`: `private: true`, `name: aether-core`, `bin: { aether: "dist/cli.cjs" }`. Build:
  `vite build && esbuild server/index.ts … && esbuild …aether-shell… && esbuild …aether-git… && esbuild cli/index.ts … && rm -rf dist/db/migrations && mkdir -p dist/db && cp -R server/db/migrations dist/db/ && rm -rf dist/skills && mkdir -p dist/skills && cp -R server/skills/defaults dist/skills/`.
- `start: node dist/server.cjs`; `smoke:prod: node scripts/smoke-prod.mjs`.
- `better-sqlite3` è nativo: in install normale (Node 20 x64) scarica un prebuilt, niente compilatore; fallback a compilazione solo se nessun prebuilt combacia.
- CLI `aether`: `daemon start|stop|status|restart` (server su 127.0.0.1, gira `dist/server.cjs`) + modalità prompt one-shot.
- CI (`ci.yml`): job `prod-bundle` builda + `smoke:prod` **solo su ubuntu-latest**.

## Architettura

### 1. Build cross-platform — `scripts/build.mjs`

Spostare l'intera build in un singolo script Node, eliminando shell e quoting:

- Invoca **esbuild via JS API** (`import { build } from 'esbuild'`) per i 4 bundle: `server/index.ts` → `dist/server.cjs` (cjs, `packages: 'external'`, banner `import_meta_url`, `define` per `import.meta.url`, sourcemap); `server/mcp/builtin/aether-shell.ts` → `dist/server/mcp/builtin/aether-shell.js` (esm); `server/mcp/builtin/aether-git.ts` → `dist/server/mcp/builtin/aether-git.js` (esm); `cli/index.ts` → `dist/cli.cjs` (cjs, banner `#!/usr/bin/env node`).
- Invoca **vite build** programmaticamente (`import { build } from 'vite'`) per la SPA.
- Copie asset con `node:fs`: `fs.rmSync(dest, { recursive: true, force: true })`, `fs.mkdirSync(dest, { recursive: true })`, `fs.cpSync(src, dest, { recursive: true })` per `server/db/migrations` → `dist/db/migrations` e `server/skills/defaults` → `dist/skills`.
- `package.json`: `"build": "node scripts/build.mjs"`. Anche `clean` passa a `node` (`fs.rmSync` su `dist`, `coverage`, `playwright-report`) o resta come-è (dev-only, fuori scope-critico — lo portiamo comunque a Node per coerenza).
- Path costruiti con `node:path` (`path.join`) per separatori corretti su Windows.

L'esecuzione resta equivalente all'output attuale (stessi file in `dist/`). Verificabile con `smoke:prod`.

### 2. `package.json`

- `"prepare": "npm run build"` — npm esegue `prepare` sull'install da git URL (clona → installa devDeps → builda → impacchetta onorando `files` → installa). È il cardine del meccanismo. Gira anche su `npm install` in dev (rebuild): trade-off accettato.
- `"files": ["dist"]` — il tarball include l'output buildato (server, SPA, CLI, migrazioni, skill). `package.json` è sempre incluso; `bin` punta dentro `dist/`.
- `"engines": { "node": ">=20" }` — warning su Node vecchio.
- `private: true` invariato. `bin: { aether: "dist/cli.cjs" }` invariato.

Costo noto: l'install da git scarica tutte le devDeps per buildare (minuti + MB temporanei). Accettabile per il "no registry".

### 3. CLI — `aether daemon start --open`

- Estendere il parser args della CLI per riconoscere `--open` su `daemon start`.
- Dopo `startDaemon()`, se `--open`: aprire il browser sull'URL del daemon (`http://127.0.0.1:<port>`), leggendo la porta dal risultato di `startDaemon`/endpoint file.
- Apertura cross-platform **senza dipendenze**: helper `openBrowser(url)` che fa spawn dell'opener per piattaforma — `cmd /c start "" <url>` (Windows), `open <url>` (macOS), `xdg-open <url>` (Linux); errori non fatali (stampa l'URL come fallback).
- Opzionale (nice-to-have, non bloccante): alias `aether up` = `daemon start --open`.

### 4. Script bootstrap — `scripts/install/install.sh` e `install.ps1`

Logica identica nelle due varianti:

1. **Check Node ≥ 20.** Se assente o troppo vecchio: messaggio chiaro con link/comando. *Best-effort opzionale con conferma*: su Windows proporre `winget install OpenJS.NodeJS.LTS`; su macOS `brew install node`; su Linux istruzione (nodesource/nvm). **Mai install silenzioso.**
2. Eseguire `npm i -g github:MichelePolo/Aether#semver:*`.
3. Eseguire `aether daemon start --open`.
4. Gestione errori: uscita non-zero con messaggio leggibile a ogni step (Node mancante, install fallito, avvio fallito).

`install.ps1` è PowerShell nativo: **non richiede Git Bash** perché la build (sez. 1) è cross-platform.

Hosting: serviti via `raw.githubusercontent.com/MichelePolo/Aether/main/scripts/install/install.{sh,ps1}`.

### 5. Documentazione — i 5 one-liner

In README (nuova sezione "Install") e, se presente, sul sito:

```bash
# macOS / Linux
curl -fsSL https://raw.githubusercontent.com/MichelePolo/Aether/main/scripts/install/install.sh | bash

# Windows (PowerShell)
powershell -c "irm https://raw.githubusercontent.com/MichelePolo/Aether/main/scripts/install/install.ps1 | iex"

# npm / pnpm / bun  (poi: aether daemon start --open)
npm  i   -g github:MichelePolo/Aether#semver:*
pnpm add -g github:MichelePolo/Aether#semver:*
bun  add -g github:MichelePolo/Aether#semver:*
```

## Data flow (install via curl, esempio)

1. `curl … install.sh | bash` → lo script parte sul client.
2. Verifica Node ≥ 20 (eventuale offerta install con conferma).
3. `npm i -g github:MichelePolo/Aether#semver:*` → npm risolve il tag di release più alto, clona, installa devDeps, esegue `prepare` (`node scripts/build.mjs` → `dist/`), impacchetta `files:["dist"]`, installa globalmente con `bin: aether`. `better-sqlite3` scarica il prebuilt.
4. `aether daemon start --open` → avvia `dist/server.cjs` su 127.0.0.1:<port>, apre il browser.

## Error handling / edge cases

- **Node assente/vecchio** → messaggio chiaro + offerta best-effort con conferma; exit non-zero se l'utente rifiuta.
- **`better-sqlite3` senza prebuilt** (arch/Node insolito) → fallback compilazione: documentare che servono build tools (MSVC+Python / Xcode CLT / build-essential). Non gestito dallo script; solo documentato.
- **`openBrowser` fallisce** (headless/SSH) → non fatale, stampa l'URL.
- **Porta occupata** → comportamento esistente di `startDaemon` (riportare lo stato; non peggiorare).
- **JS API esbuild/vite**: errori di build → exit non-zero con stack (così `prepare` fallisce visibilmente sul client).

## Testing

- **CI matrix cross-OS** (massima priorità): estendere il job `prod-bundle` di `ci.yml` a `windows-latest` + `macos-latest` oltre a `ubuntu-latest` (matrix), eseguendo `npm ci` + `npm run build` + `npm run smoke:prod`. Cattura le regressioni di portabilità del build alla radice.
- **Unit (vitest backend)**: (a) l'helper di copia asset di `build.mjs` su `os.tmpdir()` (crea sorgenti, copia, asserisce presenza/contenuto); (b) `openBrowser(url)` — selezione del comando per `process.platform` con spawn mockato, e non-fataleità su errore; (c) parsing di `--open` su `daemon start`.
- **Script install**: `shellcheck` su `install.sh` (job CI lint opzionale); smoke manuale per `install.ps1` (difficile da e2e-are).
- Le suite esistenti restano verdi: la modifica al build non cambia gli output di `dist/`.

## Out of scope (YAGNI)

- Binari self-contained / Node SEA / pkg (deciso: Node è prerequisito).
- Pubblicazione su npm pubblico o GitHub Packages (deciso: no registry).
- Auto-update in background (re-eseguire il one-liner aggiorna; nessun updater dedicato).
- Auto-install silenzioso di Node (solo offerta con conferma).
- Firma/notarizzazione (nessun binario distribuito).
- Desktop shortcut / servizio di sistema (avvio via `aether daemon start`).

## File toccati (riepilogo)

- **Create:** `scripts/build.mjs`, `scripts/install/install.sh`, `scripts/install/install.ps1`, test per copy-asset e `openBrowser`.
- **Modify:** `package.json` (`build`/`clean` → node, `prepare`, `files`, `engines`), `cli/index.ts` (+ `--open`, helper `openBrowser`), `cli/daemon.ts` se serve esporre la porta, `.github/workflows/ci.yml` (matrix OS), `README.md` (sezione Install).
