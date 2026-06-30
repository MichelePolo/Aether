# One-line Installer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Installare Aether con comandi copia-incolla su 5 canali (curl/powershell/npm/pnpm/bun) da release del repo pubblico, senza registry.

**Architecture:** Un solo meccanismo (install globale da git URL con `prepare` che builda `dist/`), 5 ingressi: curl/powershell sono wrapper sottili (check Node → install → `aether daemon start --open`); npm/pnpm/bun installano direttamente `github:MichelePolo/Aether#semver:*`. Prerequisito abilitante: build reso cross-platform (Node, niente shell POSIX) e tag di release portati a semver puro.

**Tech Stack:** Node 20, esbuild/vite JS API, npm git-specifier install, release-please, GitHub Actions, bash + PowerShell.

## Global Constraints

- Alias import `@/*` dalla radice repo.
- Lint = `npm run lint` (`tsc --noEmit`, strict, `noUnusedLocals`/`noUnusedParameters`): pulito.
- Test colocati `*.test.ts`; Vitest `globals` ON — non importare `describe/it/expect/vi`. Project `backend` include `cli/**/*.test.ts`. Coverage ≥ 80% su `cli/**`.
- Repo pubblico: `github:MichelePolo/Aether`. `private: true` resta in package.json (blocca solo `publish`, non l'install da git).
- Install globale = `<pm> i -g github:MichelePolo/Aether#semver:*`. `#semver:*` aggancia il tag semver più alto.
- Tag di release devono essere semver puri (`v0.1.15`) — via release-please `include-component-in-tag: false`. I canali npm/pnpm/bun si attivano dal primo rilascio col nuovo formato.
- Node ≥ 20 sul client (script bootstrap: check + istruzione; nessun auto-install silenzioso).
- Post-install curl/powershell: `aether daemon start --open` (avvia + apre browser).
- `scripts/**` NON è coperto da vitest → la build cross-platform si verifica con `npm run build` + `npm run smoke:prod` (idealmente su CI multi-OS), non con unit test.

---

## Task 1: Build cross-platform (`scripts/build.mjs`)

**Files:**
- Create: `scripts/build.mjs`, `scripts/clean.mjs`
- Modify: `package.json` (script `build`, `clean`)

**Interfaces:**
- Produces: `npm run build` produce gli stessi output di prima in `dist/` (`dist/server.cjs`, SPA `dist/index.html` + assets, `dist/cli.cjs`, `dist/server/mcp/builtin/aether-shell.js`, `dist/server/mcp/builtin/aether-git.js`, `dist/db/migrations/`, `dist/skills/defaults/`) ma senza dipendere da shell POSIX.

- [ ] **Step 1: Scrivere `scripts/build.mjs`**

```js
import { build as esbuildBuild } from 'esbuild';
import { build as viteBuild } from 'vite';
import { rmSync, mkdirSync, cpSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const p = (...s) => join(root, ...s);

async function run() {
  // 1. SPA — vite empties dist/ (emptyOutDir default) then writes the client build.
  await viteBuild();

  // 2. Server / CLI / builtin-MCP bundles (esbuild JS API), written into dist/.
  await esbuildBuild({
    entryPoints: ['server/index.ts'],
    bundle: true, platform: 'node', format: 'cjs',
    packages: 'external', sourcemap: true,
    outfile: 'dist/server.cjs',
    banner: { js: "const import_meta_url=require('url').pathToFileURL(__filename).href" },
    define: { 'import.meta.url': 'import_meta_url' },
  });
  await esbuildBuild({
    entryPoints: ['server/mcp/builtin/aether-shell.ts'],
    bundle: true, platform: 'node', format: 'esm',
    outfile: 'dist/server/mcp/builtin/aether-shell.js',
  });
  await esbuildBuild({
    entryPoints: ['server/mcp/builtin/aether-git.ts'],
    bundle: true, platform: 'node', format: 'esm',
    outfile: 'dist/server/mcp/builtin/aether-git.js',
  });
  await esbuildBuild({
    entryPoints: ['cli/index.ts'],
    bundle: true, platform: 'node', format: 'cjs',
    packages: 'external', sourcemap: true,
    outfile: 'dist/cli.cjs',
    banner: { js: '#!/usr/bin/env node' },
  });

  // 3. Runtime assets the bundles read at runtime (no shell: node:fs only).
  rmSync(p('dist/db/migrations'), { recursive: true, force: true });
  mkdirSync(p('dist/db'), { recursive: true });
  cpSync(p('server/db/migrations'), p('dist/db/migrations'), { recursive: true });

  rmSync(p('dist/skills'), { recursive: true, force: true });
  mkdirSync(p('dist/skills'), { recursive: true });
  cpSync(p('server/skills/defaults'), p('dist/skills/defaults'), { recursive: true });
}

run().catch((err) => { console.error(err); process.exit(1); });
```

- [ ] **Step 2: Scrivere `scripts/clean.mjs`**

```js
import { rmSync } from 'node:fs';
for (const target of ['dist', 'server.js', 'coverage', 'playwright-report']) {
  rmSync(target, { recursive: true, force: true });
}
```

- [ ] **Step 3: Aggiornare gli script in `package.json`**

Sostituire la riga `"build": "vite build && esbuild …"` con:
```json
    "build": "node scripts/build.mjs",
```
e la riga `"clean": "rm -rf dist server.js coverage playwright-report"` con:
```json
    "clean": "node scripts/clean.mjs",
```

- [ ] **Step 4: Verificare la build e lo smoke**

Run: `npm run build`
Expected: termina senza errori; esistono `dist/server.cjs`, `dist/index.html`, `dist/cli.cjs`, `dist/server/mcp/builtin/aether-shell.js`, `dist/server/mcp/builtin/aether-git.js`, `dist/db/migrations/001_*.sql`, `dist/skills/defaults/`.

Run: `npm run smoke:prod`
Expected: PASS (il bundle serve `GET /api/health`).

Run: `npm run lint`
Expected: pulito.

- [ ] **Step 5: Commit**

```bash
git add scripts/build.mjs scripts/clean.mjs package.json
git commit -m "build(web): cross-platform build via scripts/build.mjs (no POSIX shell deps)"
```

---

## Task 2: CLI `aether daemon start --open`

**Files:**
- Create: `cli/open.ts`, `cli/open.test.ts`
- Modify: `cli/args.ts`, `cli/args.test.ts`, `cli/index.ts`

**Interfaces:**
- Consumes: `startDaemon(deps)` → `{ already: boolean; pid: number; port: number }` (esistente in `cli/daemon.ts`).
- Produces: `export function openBrowser(url: string, platform?: NodeJS.Platform): void` (best-effort, non lancia); `CliFlags.open: boolean`; `aether daemon start --open` avvia il daemon e apre il browser su `http://127.0.0.1:<port>`.

- [ ] **Step 1: Scrivere il test di `openBrowser` (RED)**

`cli/open.test.ts`:
```ts
import { openBrowser } from './open';

vi.mock('node:child_process', () => ({
  spawn: vi.fn(() => ({ on: vi.fn(), unref: vi.fn() })),
}));
import { spawn } from 'node:child_process';

describe('openBrowser', () => {
  beforeEach(() => { (spawn as unknown as ReturnType<typeof vi.fn>).mockClear(); });

  it('uses cmd /c start on win32', () => {
    openBrowser('http://x', 'win32');
    expect(spawn).toHaveBeenCalledWith('cmd', ['/c', 'start', '', 'http://x'], expect.any(Object));
  });

  it('uses open on darwin', () => {
    openBrowser('http://x', 'darwin');
    expect(spawn).toHaveBeenCalledWith('open', ['http://x'], expect.any(Object));
  });

  it('uses xdg-open on linux', () => {
    openBrowser('http://x', 'linux');
    expect(spawn).toHaveBeenCalledWith('xdg-open', ['http://x'], expect.any(Object));
  });

  it('never throws if spawn throws', () => {
    (spawn as unknown as ReturnType<typeof vi.fn>).mockImplementationOnce(() => { throw new Error('boom'); });
    expect(() => openBrowser('http://x', 'linux')).not.toThrow();
  });
});
```

- [ ] **Step 2: Eseguire il test → FAIL**

Run: `npm run test -- cli/open.test.ts`
Expected: FAIL — `Cannot find module './open'`.

- [ ] **Step 3: Implementare `cli/open.ts`**

```ts
import { spawn } from 'node:child_process';

/**
 * Open a URL in the default browser, cross-platform. Best-effort: failures
 * (headless/SSH, missing opener) are swallowed — callers still print the URL.
 */
export function openBrowser(url: string, platform: NodeJS.Platform = process.platform): void {
  const [cmd, args]: [string, string[]] =
    platform === 'win32' ? ['cmd', ['/c', 'start', '', url]]
    : platform === 'darwin' ? ['open', [url]]
    : ['xdg-open', [url]];
  try {
    const child = spawn(cmd, args, { stdio: 'ignore', detached: true });
    child.on('error', () => { /* non-fatal */ });
    child.unref();
  } catch {
    /* non-fatal */
  }
}
```

- [ ] **Step 4: Eseguire il test → PASS**

Run: `npm run test -- cli/open.test.ts`
Expected: PASS (4 test).

- [ ] **Step 5: Aggiungere il flag `--open` al parser (`cli/args.ts`)**

In `CliFlags` aggiungere il campo:
```ts
  open: boolean;
```
Cambiare l'inizializzazione `const flags: CliFlags = { json: false };` in:
```ts
  const flags: CliFlags = { json: false, open: false };
```
Nel loop, dopo il ramo `if (arg === '--json') { flags.json = true; }`, aggiungere:
```ts
    } else if (arg === '--open') {
      flags.open = true;
```
(inserire come ulteriore `else if` prima di `VALUE_FLAGS`).

- [ ] **Step 6: Test del parsing `--open` (`cli/args.test.ts`)**

Aggiungere in `cli/args.test.ts`:
```ts
it('parses --open as a boolean flag', () => {
  const a = parseArgs(['daemon', 'start', '--open']);
  expect(a.command).toBe('daemon');
  expect(a.daemonAction).toBe('start');
  expect(a.flags.open).toBe(true);
});

it('defaults open to false', () => {
  expect(parseArgs(['daemon', 'status']).flags.open).toBe(false);
});
```

Run: `npm run test -- cli/args.test.ts`
Expected: PASS.

- [ ] **Step 7: Cablare in `cli/index.ts`**

Aggiungere l'import in testa:
```ts
import { openBrowser } from './open';
```
Nel `case 'start':` sostituire il corpo con:
```ts
      case 'start': {
        const r = await startDaemon(deps);
        writer.out(
          r.already
            ? `already running on port ${r.port}\n`
            : `started (pid ${r.pid}) on port ${r.port}\n`,
        );
        if (args.flags.open) {
          const url = `http://127.0.0.1:${r.port}`;
          writer.out(`opening ${url}\n`);
          openBrowser(url);
        }
        return 0;
      }
```
Aggiornare la riga usage in `helpText()`:
```ts
    '  aether daemon start [--open] | stop | status | restart',
```

- [ ] **Step 8: Verifica completa**

Run: `npm run test -- cli/` then `npm run lint`
Expected: tutti i test cli verdi; lint pulito.

- [ ] **Step 9: Commit**

```bash
git add cli/open.ts cli/open.test.ts cli/args.ts cli/args.test.ts cli/index.ts
git commit -m "feat(cli): aether daemon start --open (start + open browser, cross-platform)"
```

---

## Task 3: Metadati di pacchetto per l'install da git

**Files:**
- Modify: `package.json` (`prepare`, `files`, `engines`)

**Interfaces:**
- Consumes: `npm run build` (Task 1).
- Produces: `npm install -g github:MichelePolo/Aether#…` builda via `prepare` e installa il bin `aether`; il tarball impacchettato contiene `dist/`.

- [ ] **Step 1: Aggiungere i campi a `package.json`**

Aggiungere nello `scripts` (accanto a `build`):
```json
    "prepare": "npm run build",
```
Aggiungere a top-level dell'oggetto (es. dopo `"version"`):
```json
  "files": ["dist"],
  "engines": { "node": ">=20" },
```
(`private: true` e `bin` restano invariati.)

> Nota trade-off: `prepare` gira anche su `npm install`/`npm ci` in dev e in CI (rebuild). Accettato: è il prezzo dell'install-da-git senza registry.

- [ ] **Step 2: Verificare il packaging end-to-end in locale**

Questo replica ciò che fa l'install globale (prepare → files → bin) senza rete/tag.

Run:
```bash
npm pack
```
Expected: crea `aether-core-<version>.tgz`; l'output di `npm pack` (o `tar -tzf aether-core-*.tgz`) elenca `package/dist/server.cjs`, `package/dist/cli.cjs`, `package/dist/index.html`, `package/dist/db/migrations/…`, `package/dist/skills/defaults/…`, `package/package.json`.

Run:
```bash
npm install -g ./aether-core-*.tgz
aether --help
```
Expected: stampa l'help della CLI (conferma che `bin: aether → dist/cli.cjs` è installato — verifica empiricamente che `private: true` NON blocca l'install globale).

Cleanup:
```bash
npm rm -g aether-core
rm -f aether-core-*.tgz
```

- [ ] **Step 3: Lint**

Run: `npm run lint`
Expected: pulito.

- [ ] **Step 4: Commit**

```bash
git add package.json
git commit -m "build(web): package metadata for git-URL global install (prepare/files/engines)"
```

---

## Task 4: Tag di release semver (release-please)

**Files:**
- Modify: `release-please-config.json`

**Interfaces:**
- Produces: i prossimi tag di release sono `vX.Y.Z` (semver puro), che `#semver:*` riconosce.

- [ ] **Step 1: Aggiungere `include-component-in-tag: false`**

In `release-please-config.json`, dentro l'oggetto del package `"."`, aggiungere la chiave:
```json
      "include-component-in-tag": false,
```
Risultato atteso del file:
```json
{
  "$schema": "https://raw.githubusercontent.com/googleapis/release-please/main/schemas/config.json",
  "packages": {
    ".": {
      "release-type": "node",
      "changelog-path": "CHANGELOG.md",
      "bump-minor-pre-major": true,
      "bump-patch-for-minor-pre-major": true,
      "include-component-in-tag": false,
      "draft": false,
      "prerelease": false
    }
  }
}
```

- [ ] **Step 2: Validare il JSON**

Run: `node -e "JSON.parse(require('fs').readFileSync('release-please-config.json','utf8')); console.log('ok')"`
Expected: stampa `ok`.

> Comportamento atteso: al prossimo merge della release-PR, release-please taggherà `v0.1.15` (anziché `aether-core-v0.1.15`). I vecchi tag `aether-core-v*` restano in storia ma sono ignorati da `#semver:*`. Finché non esce il primo tag `v*`, i canali npm/pnpm/bun non hanno un tag semver da agganciare (atteso, transitorio).

- [ ] **Step 3: Commit**

```bash
git add release-please-config.json
git commit -m "ci: release-please emits pure-semver tags (vX.Y.Z) for #semver:* installs"
```

---

## Task 5: Script bootstrap `install.sh` + `install.ps1`

**Files:**
- Create: `scripts/install/install.sh`, `scripts/install/install.ps1`

**Interfaces:**
- Consumes: `aether daemon start --open` (Task 2); install globale da git (Task 3/4).
- Produces: due script self-contained che fanno check Node → install globale → avvio+browser.

- [ ] **Step 1: Scrivere `scripts/install/install.sh`**

```sh
#!/usr/bin/env sh
# Aether installer (macOS / Linux). Usage:
#   curl -fsSL https://raw.githubusercontent.com/MichelePolo/Aether/main/scripts/install/install.sh | bash
set -e

REPO="github:MichelePolo/Aether#semver:*"
MIN_NODE=20

err() { printf 'aether-install: %s\n' "$1" >&2; }

# 1. Node check
if ! command -v node >/dev/null 2>&1; then
  err "Node.js >= ${MIN_NODE} is required but was not found."
  err "Install it from https://nodejs.org (or: brew install node / your distro's package manager), then re-run."
  exit 1
fi
NODE_MAJOR=$(node -p 'process.versions.node.split(".")[0]')
if [ "$NODE_MAJOR" -lt "$MIN_NODE" ]; then
  err "Node.js >= ${MIN_NODE} required, found $(node -v)."
  exit 1
fi

# 2. Install globally from the latest release tag
echo "Installing Aether (${REPO}) ..."
npm install -g "$REPO"

# 3. Start the daemon and open the browser
echo "Starting Aether ..."
aether daemon start --open
```

- [ ] **Step 2: Scrivere `scripts/install/install.ps1`**

```powershell
#requires -Version 5
# Aether installer (Windows). Usage:
#   powershell -c "irm https://raw.githubusercontent.com/MichelePolo/Aether/main/scripts/install/install.ps1 | iex"
$ErrorActionPreference = 'Stop'
$Repo = 'github:MichelePolo/Aether#semver:*'
$MinNode = 20

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  Write-Host "aether-install: Node.js >= $MinNode is required but was not found." -ForegroundColor Yellow
  Write-Host "Install it (e.g. 'winget install OpenJS.NodeJS.LTS') then re-run." -ForegroundColor Yellow
  exit 1
}
$major = [int](((node -v) -replace '^v','') -split '\.')[0]
if ($major -lt $MinNode) {
  Write-Error "aether-install: Node.js >= $MinNode required, found $(node -v)."
  exit 1
}

Write-Host "Installing Aether ($Repo) ..."
npm install -g $Repo
if ($LASTEXITCODE -ne 0) { Write-Error "aether-install: npm install failed."; exit 1 }

Write-Host "Starting Aether ..."
aether daemon start --open
```

- [ ] **Step 3: Verificare la sintassi degli script**

Run: `sh -n scripts/install/install.sh`
Expected: nessun output, exit 0 (sintassi POSIX valida).

Run (se `shellcheck` è disponibile): `shellcheck -s sh scripts/install/install.sh`
Expected: nessun warning bloccante. (Se shellcheck non è installato, saltare e annotarlo.)

Run (se `pwsh` è disponibile): `pwsh -NoProfile -Command "[void][System.Management.Automation.Language.Parser]::ParseFile((Resolve-Path scripts/install/install.ps1), [ref]$null, [ref]$null); 'ok'"`
Expected: stampa `ok`. (Se pwsh non è disponibile su questa macchina, saltare e annotare che la verifica `.ps1` è manuale.)

- [ ] **Step 4: Commit**

```bash
git add scripts/install/install.sh scripts/install/install.ps1
git commit -m "feat(install): curl + powershell bootstrap scripts (check Node, install, start --open)"
```

---

## Task 6: CI cross-OS per la build

**Files:**
- Modify: `.github/workflows/ci.yml` (job `prod-bundle`)

**Interfaces:**
- Produces: il job `prod-bundle` gira su ubuntu + windows + macOS, eseguendo build + smoke su ciascuno (guard di regressione per la portabilità del build).

- [ ] **Step 1: Convertire il job `prod-bundle` in matrix**

Sostituire l'intero job `prod-bundle:` in `.github/workflows/ci.yml` con:
```yaml
  prod-bundle:
    name: prod-bundle (${{ matrix.os }})
    runs-on: ${{ matrix.os }}
    strategy:
      fail-fast: false
      matrix:
        os: [ubuntu-latest, windows-latest, macos-latest]
    steps:
      - uses: actions/checkout@v5

      - uses: actions/setup-node@v5
        with:
          node-version: 20
          cache: npm

      - name: Install dependencies
        run: npm ci

      - name: Build
        run: npm run build

      - name: Smoke-test the production bundle
        run: npm run smoke:prod
```

- [ ] **Step 2: Validare lo YAML**

Run: `node -e "const y=require('fs').readFileSync('.github/workflows/ci.yml','utf8'); if(!y.includes('windows-latest')||!y.includes('macos-latest')) throw new Error('matrix missing'); console.log('ok')"`
Expected: `ok`.

> La verifica reale (build verde su Windows/macOS) avviene quando il workflow gira su GitHub dopo il push.

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/ci.yml
git commit -m "ci: build + smoke the prod bundle on windows + macos + linux"
```

---

## Task 7: Sezione "Install" nel README

**Files:**
- Modify: `README.md`

**Interfaces:**
- Produces: documentazione dei 5 one-liner + prerequisiti + come avviare.

- [ ] **Step 1: Aggiungere la sezione Install**

Inserire in `README.md`, subito prima della sezione `## Run locally` (riga ~50), il blocco:
```markdown
## Install (one-liner)

**Prerequisite:** Node.js 20+ (the install builds from source; `better-sqlite3`
fetches a prebuilt native binary on most platforms).

```bash
# macOS / Linux
curl -fsSL https://raw.githubusercontent.com/MichelePolo/Aether/main/scripts/install/install.sh | bash

# Windows (PowerShell)
powershell -c "irm https://raw.githubusercontent.com/MichelePolo/Aether/main/scripts/install/install.ps1 | iex"

# npm / pnpm / bun  (then: aether daemon start --open)
npm  i   -g github:MichelePolo/Aether#semver:*
pnpm add -g github:MichelePolo/Aether#semver:*
bun  add -g github:MichelePolo/Aether#semver:*
```

The curl/PowerShell scripts check Node, install the latest release globally, then
run `aether daemon start --open` (starts the local server and opens the browser).
The npm/pnpm/bun commands install the same release tag (`#semver:*`); afterwards
run `aether daemon start --open` yourself. To build from a clone instead, see
**Run locally** below.
```

- [ ] **Step 2: Verifica**

Run: `grep -n "Install (one-liner)" README.md`
Expected: trova la nuova sezione.

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs: one-line install section (curl/powershell/npm/pnpm/bun)"
```

---

## Self-review (esito)

- **Copertura spec:** build cross-platform `scripts/build.mjs` (Task 1) ✓; `package.json` prepare/files/engines (Task 3) ✓; `private:true` resta + verifica empirica install globale (Task 3 Step 2) ✓; CLI `daemon start --open` + `openBrowser` cross-platform (Task 2) ✓; tag semver via release-please (Task 4) ✓; install.sh/ps1 con check Node + install + start (Task 5) ✓; 5 one-liner documentati (Task 7) ✓; CI matrix multi-OS (Task 6) ✓; `#semver:*` + nota transitoria (Task 4) ✓.
- **Testing aderente al layout:** unit dove vitest raccoglie (`cli/**` → open/args); build verificata via `npm run build` + `smoke:prod` (scripts/ non coperto da vitest); CI matrix come guard cross-OS; sintassi script via `sh -n`/shellcheck/pwsh-parse.
- **Placeholder scan:** nessun TBD/TODO; ogni step di codice mostra il codice completo.
- **Type/teste consistency:** `openBrowser(url, platform?)` definito in Task 2 e usato in `cli/index.ts` stessa task; `CliFlags.open` definito (args.ts) e usato (index.ts) coerentemente; `startDaemon` ritorna `{already,pid,port}` (esistente) usato per l'URL `http://127.0.0.1:<port>`; `#semver:*` e `github:MichelePolo/Aether` identici tra Task 5 e Task 7.
- **Rischi noti gestiti:** `private:true` → verificato in Task 3 Step 2 (npm pack + install globale del tarball); formato tag → risolto in Task 4 con nota di transizione; `prepare` su ogni `npm ci` → trade-off documentato.
