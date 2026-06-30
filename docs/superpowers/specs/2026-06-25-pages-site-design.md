# Aether GitHub Pages Site — Design Spec

> Status: approved (brainstorming) · Date: 2026-06-25 · Topic: presentation site (landing manifesto + download/troubleshooting)

## Goal

Un sito di presentazione statico per Aether su **GitHub Pages**, con due pagine: una **landing** col Manifesto arricchita da screenshot, e una pagina **Download & Troubleshooting** con i comandi di installazione, il primo avvio e la risoluzione dei problemi comuni (es. porta 3000 occupata). Solo HTML/CSS/JS, look & feel di Aether con la palette reale.

## Decisioni fissate (dal brainstorming)

- **Deploy:** branch **`gh-pages`** orfano, contenente solo il sito (GitHub Pages "Deploy from branch: gh-pages /root"). Nessun workflow Actions. Lo **spec e il plan** (markdown) vivono invece su `main` via il branch `feat/pages-site`.
- **Struttura:** 2 pagine che condividono CSS/JS (Approccio A).
- **Screenshot:** reali, catturati dall'app (Fake provider, offline), **+ una immagine Gemini esistente** (`docs/Gemini_Generated_Image_*.png`) come hero artistica.
- **Tech:** HTML + CSS + JS vanilla. Nessun build, nessun framework, nessun tracker/analytics.
- **Palette reale** (da `src/styles/theme.css`): surface-0 `#09090B`, surface-2 `#18181B`, surface-3 `#1F1F23`, border-subtle `#27272A`, border-default `#3F3F46`; **disclosure (viola) `#B388FF`**, **manipulation (arancio) `#FF6D00`**, **cli (verde) `#00E676`**; status-online `#22c55e`, status-error `#ef4444`. Font: **Inter** (sans) + **JetBrains Mono** (mono).

## Struttura file (root del branch `gh-pages`)

```
index.html            # landing + manifesto + screenshot
install.html          # download (5 comandi) + primo avvio + troubleshooting
assets/
  style.css           # palette Aether, layout condiviso
  main.js             # copy-to-clipboard, tab dei 5 canali, smooth-scroll
  img/
    hero.png          # immagine Gemini esistente (hero)
    shot-chat.png     # chat + reasoning drawer (Disclosure)
    shot-sidebar.png  # sidebar accordion
    shot-approval.png # approval gate / breakpoint (Manipulation)
    shot-cli.png      # output CLI / terminale (opzionale 5° shot)
    favicon.svg
.nojekyll             # GitHub Pages serve i file as-is (niente Jekyll)
```

Ogni unità ha una responsabilità chiara: `style.css` = tema+layout (nessun JS), `main.js` = interazioni minime (nessuno stato globale), le due pagine = contenuto. `main.js` degrada con grazia se JS è disattivato (i comandi restano selezionabili a mano; le tab mostrano tutti i canali).

## Look & feel

- Dark-only (come l'app). Sfondo `#09090B`; superfici `#18181B`/`#1F1F23`; bordi `#27272A`; testo `zinc-200/400`.
- Accenti **semantici**: viola `#B388FF` per Disclosure (rivelare), arancio `#FF6D00` per Manipulation (azione/CTA primaria), verde `#00E676` SOLO per output CLI/terminale.
- `mono-label`: JetBrains Mono, uppercase, `letter-spacing` ampio, colore tenue — per le intestazioni di sezione, come nell'app.
- Glow sottile sugli accenti (box-shadow morbida), bordi 1px, raggi arrotondati coerenti con l'app.
- Font via Google Fonts (`Inter`, `JetBrains Mono`) con fallback `system-ui`/`monospace`.
- Responsivo basilare: layout a colonna singola sotto ~720px; griglie screenshot/card che collassano.

## Pagina 1 — Landing (`index.html`)

1. **Hero**: `hero.png` come sfondo/affianco; titolo `AETHER` (mono) + sottotitolo "Disclosure & Manipulation"; tagline "Osservazione e controllo degli LLM"; due CTA — **Install** (arancio → `install.html`) e **GitHub** (viola → repo).
2. **Manifesto**: il testo integrale fornito dall'utente (vedi Appendice A), reso in paragrafi/sezioni leggibili; le parole-chiave *Disclosure* (viola), *Manipulation* (arancio), *CLI* (verde) evidenziate con la palette semantica. Nessuna modifica al testo.
3. **Tripletta palette**: tre card (viola/arancio/verde) che spiegano "Spettro Invisibile" — Disclosure / Manipulation / CLI heritage.
4. **Galleria screenshot**: gli screenshot reali con didascalie brevi che legano ogni vista a un concetto (chat+reasoning → Disclosure; approval gate → Manipulation; CLI → heritage).
5. **Footer** (vedi sezione comune).

## Pagina 2 — Download & Troubleshooting (`install.html`)

- **Install** — i 5 comandi con tab (curl / powershell / npm / pnpm / bun) e bottone "copia". Prerequisito: **Node.js 20+**. Comandi (verbatim):
  - curl: `curl -fsSL https://raw.githubusercontent.com/MichelePolo/Aether/main/scripts/install/install.sh | bash`
  - powershell: `powershell -c "irm https://raw.githubusercontent.com/MichelePolo/Aether/main/scripts/install/install.ps1 | iex"`
  - npm: `npm i -g https://github.com/MichelePolo/Aether/releases/latest/download/aether-core.tgz`
  - pnpm: `pnpm add -g https://github.com/MichelePolo/Aether/releases/latest/download/aether-core.tgz`
  - bun: `bun add -g https://github.com/MichelePolo/Aether/releases/latest/download/aether-core.tgz`
- **Primo avvio** — `aether daemon start --open` apre `http://localhost:3000`; `aether daemon status` / `aether daemon stop`. (curl/powershell avviano e aprono il browser automaticamente.)
- **Troubleshooting** (contenuti accurati, derivati dal codice):
  - **Porta 3000 occupata** → `PORT=3001 aether daemon start --open`, oppure `aether --port 3001 daemon start --open`; in dev da clone: `PORT=3001 npm run dev`. (Il server fa bind su `PORT`, default 3000.)
  - **Node mancante o < 20** → installa Node ≥ 20 (winget `OpenJS.NodeJS.LTS` / `brew install node` / nodejs.org). Gli script di install lo verificano e si fermano con un messaggio chiaro.
  - **Errore di build di `better-sqlite3`** (nessun prebuilt per la piattaforma) → servono build tools: Windows = "Visual Studio Build Tools" (workload C++) + Python; macOS = Xcode Command Line Tools; Linux = `build-essential` + python3.
  - **`EACCES`/permesso negato sull'install `-g`** → il prefix globale di npm è di proprietà di root; usa un prefix utente: `npm config set prefix ~/.local`, aggiungi `~/.local/bin` al PATH, poi ri-esegui. È un caveat di permessi del sistema, non un bug dell'installer.
  - **Il browser non si apre** (SSH/headless) → apri manualmente l'URL stampato (`http://localhost:3000`).

## Footer & meta (comune alle due pagine)

- Footer: link **GitHub repo** (`https://github.com/MichelePolo/Aether`), link al blog **`https://michelepolo.github.io/Journey/`**, e la riga "Disclosure & Manipulation".
- `<title>` + meta description per pagina; `favicon.svg`; Open Graph minimale (og:title, og:description, og:image = hero) per anteprime social.
- Nessuna analytics, nessun tracker, nessun cookie.

## Cattura screenshot (procedura)

1. Avvio dev server offline: `AETHER_FAKE_PROVIDER=1 npm run dev` (porta 3000).
2. Via il browser tool: navigo e catturo 3-5 viste — chat con reasoning drawer aperto, sidebar con accordion, approval gate (se attivabile col Fake provider) o pannello breakpoints, e una vista con output in stile CLI. Risoluzione desktop (es. 1280×800), ritagli puliti.
3. Salvo i PNG in `assets/img/` sul branch `gh-pages`.

## Testing / verifica

- Apro `index.html` e `install.html` nel browser (file:// o server statico) e verifico: render corretto, palette coerente, **copy-button** funzionante (clipboard), **tab dei canali** funzionanti, link footer corretti (repo + blog), layout mobile a colonna singola, **zero errori in console**.
- Validazione rapida: nessun link rotto, immagini presenti, `.nojekyll` presente.

## Out of scope (YAGNI)

- Nessun framework / generatore statico / bundler.
- Nessuna dark/light toggle (dark-only come l'app).
- Nessun dominio custom (CNAME) salvo richiesta successiva.
- Nessuna i18n del sito (una sola lingua, in linea col manifesto fornito).
- Nessun form/contatti/newsletter.

## File toccati (riepilogo)

- **Su `main` (branch `feat/pages-site`):** questo spec + il plan in `docs/superpowers/`.
- **Su `gh-pages` (orphan):** `index.html`, `install.html`, `assets/style.css`, `assets/main.js`, `assets/img/*`, `.nojekyll`.

## Appendice A — Testo del Manifesto (verbatim)

> **Benvenuti in Aether: Disclosure & Manipulation**
>
> **Come l'etere in natura**, una sostanza sottile e onnipresente che pervade lo spazio, Aether è l'interfaccia invisibile che si intreccia con i tuoi agenti LLM, portando alla luce i loro processi più profondi e nascosti.
>
> **Come l'etere in filosofia**, il quinto elemento puro e immutabile che unisce e dà forma, Aether è il ponte che connette il tuo controllo con il vasto potenziale dell'intelligenza artificiale, rivelando il contesto e permettendoti di manipolarlo.
>
> Il cuore di Aether risiede nel nostro motto: **Disclosure e Manipulation**. Non ci limitiamo a mostrarti le risposte; ti sveliamo il "perché" e ti diamo i mezzi per intervenire. Con Aether, il "pensiero" dell'agente diventa trasparente, permettendoti di esplorare il contesto, i system prompt, i token in elaborazione e i metadati con una chiarezza senza precedenti.
>
> Ma non ci fermiamo qui. Aether ti conferisce un potere di manipolazione completo. Puoi iniettare contesti personalizzati, sovrascrivere variabili, impostare breakpoint e persino prendere il controllo diretto tramite l'interfaccia a riga di comando integrata. Il controllo è nelle tue mani.
>
> Uniamo le funzionalità di una riga di comando (CLI) con la fluidità di una chat web moderna. L'output grezzo del terminale è chiaramente distinguibile, onorando l'heritage CLI per la sua efficienza e precisione, mentre i pannelli di ragionamento e pensiero sono evidenziati visivamente per un'analisi approfondita. È la perfetta fusione tra controllo di basso livello ed esperienza utente intuitiva.
>
> Il nostro design non è solo estetico, è semantico. La palette "Spettro Invisibile" usa il viola per svelare l'invisibile (Disclosure), l'arancione per indicare l'azione (Manipulation) e il verde per l'eredità CLI. È un'interfaccia pensata per chi non si accontenta delle superfici, ma vuole scendere in profondità.
>
> Aether è più di un semplice strumento di osservazione: è l'etere che rende visibile e manipolabile l'invisibile mondo dell'intelligenza artificiale. È il controllo che hai sempre desiderato sul tuo potenziale.
>
> Benvenuto in Aether. Osservazione e controllo degli LLM.
