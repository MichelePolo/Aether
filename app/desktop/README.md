# Aether Desktop

Applicazione Electron isolata per Aether. Il processo principale ospita lo
stesso backend Express del core su `127.0.0.1` e una porta effimera, poi carica
la SPA in una finestra Electron con `contextIsolation` e senza integrazione
Node nel renderer. La porta 3000 non viene usata dal desktop.

Dipendenze, lockfile e `node_modules` desktop vivono esclusivamente qui:

```bash
cd app/desktop
npm install
npm run dev
```

`npm run dev` compila il core, aggiorna la sua copia locale e ricompila
`better-sqlite3` per l'ABI di Electron. I dati dell'app vengono conservati
nella cartella `userData` di Electron (`data/` per SQLite e `library/` per
skill e agenti), separati dai dati dell'esecuzione web/CLI.

## Comandi

| Comando | Scopo |
| --- | --- |
| `npm run dev` | Compila il core e apre l'app desktop. |
| `npm run package` | Crea una directory Linux non compressa in `dist/`. |
| `npm run dist` | Produce l'AppImage Linux. |
| `npm run dist:win` | Produce l'installer NSIS Windows x64 (`.exe`). |
| `npm run dist:mac:x64` | Produce l'immagine disco macOS per Mac Intel (`.dmg`). |
| `npm run dist:mac:arm64` | Produce l'immagine disco macOS per Apple Silicon (`.dmg`). |
| `npm run lint` | Controlla la sintassi dei processi Electron. |

Il `package.json` e il `package-lock.json` nella radice del repository non
vengono modificati dal lavoro desktop.

## Distribuzione

Gli installer vengono creati su runner nativi da `desktop-package.yml`: Windows
x64 su Windows, macOS Intel su `macos-15-intel`, Apple Silicon su `macos-latest`
e Linux (`.AppImage` + `.deb`) su Ubuntu.

Il workflow ha due modalità:

- **CI** (PR / push / dispatch): ogni installer è caricato come artefatto del run
  ed è scaricabile dalla pagina del run GitHub Actions (richiede login, scade).
- **Release**: quando `release-please` pubblica una release su `main`, richiama
  questo workflow (`workflow_call`, gate `release_created`) che rinomina ogni
  installer con un nome stabile e lo allega alla GitHub Release. Così il minisito
  può linkare permalink `releases/latest/download/<nome>`, esattamente come per il
  tarball precompilato. I nomi stabili sono:
  - `Aether-windows-x64.exe`
  - `Aether-macos-arm64.dmg` · `Aether-macos-x64.dmg`
  - `Aether-linux-x86_64.AppImage` · `Aether-linux-amd64.deb`

Gli installer non sono ancora firmati né notarizzati. Windows mostrerà quindi
un avviso SmartScreen e macOS richiederà un'apertura esplicita da Gatekeeper;
per rimuoverli serviranno rispettivamente un certificato Authenticode e le
credenziali Apple Developer per firma e notarizzazione.
