# Aether GitHub Pages Site Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (inline) — this is a static visual site with live screenshot capture, best built and reviewed in-session against a browser. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Pubblicare un sito statico (landing col Manifesto + pagina Download/Troubleshooting) per Aether su GitHub Pages, branch `gh-pages`.

**Architecture:** Due pagine HTML che condividono `assets/style.css` (palette Aether) e `assets/main.js` (copy-button, tab, smooth-scroll). Screenshot reali catturati dall'app live + una hero generata. Nessun build/framework. Spec/plan su `main` (branch `feat/pages-site`); il sito sul branch orfano `gh-pages`.

**Tech Stack:** HTML5, CSS3 (custom properties), JS vanilla. Google Fonts (Inter, JetBrains Mono). GitHub Pages (deploy from branch).

## Global Constraints

- Palette (verbatim da `src/styles/theme.css`): surface-0 `#09090B`, surface-2 `#18181B`, surface-3 `#1F1F23`, border-subtle `#27272A`, border-default `#3F3F46`, text zinc; **disclosure `#B388FF`** (viola/reveal), **manipulation `#FF6D00`** (arancio/azione/CTA primaria), **cli `#00E676`** (verde/SOLO output terminale); status-online `#22c55e`, status-error `#ef4444`.
- Font: Inter (sans) + JetBrains Mono (mono), via Google Fonts, fallback `system-ui`/`monospace`.
- Repo URL: `https://github.com/MichelePolo/Aether`. Blog footer: `https://michelepolo.github.io/Journey/`.
- Dark-only. Nessun tracker/analytics/cookie. Responsivo basilare (colonna singola < 720px).
- I 5 comandi install e i contenuti troubleshooting: ESATTI come da spec (`docs/superpowers/specs/2026-06-25-pages-site-design.md`).
- Manifesto: testo verbatim dalla spec Appendice A — nessuna modifica.
- Sito serve i file as-is: includere `.nojekyll`.

---

## Task 1: Cattura screenshot reali dall'app

**Files:**
- Output (fuori dal repo, sopravvive ai cambi branch): `/tmp/aether-shots/shot-*.png`

**Interfaces:**
- Produces: PNG desktop (≈1280×800) delle viste chiave, più la hero copiata da `docs/`.

- [ ] **Step 1: Avviare l'app con i provider reali**

L'utente ha Anthropic (Opus via OAuth) e Ollama (`qwen3.6`, `gemma4-coding`). Avviare SENZA Fake provider così i provider reali vengono rilevati:
```bash
mkdir -p /tmp/aether-shots
npm run dev   # http://localhost:3000  (no AETHER_FAKE_PROVIDER)
```
Atteso nel log: `[providers] anthropic: oauth` e i modelli Ollama scoperti.

- [ ] **Step 2: Catturare le viste col browser tool**

Navigare `http://localhost:3000` e catturare (full-page o ritaglio pulito):
1. `shot-chat.png` — una chat con il **reasoning drawer aperto** (Disclosure): inviare un prompt che produce ragionamento (thinking on), aprire il drawer.
2. `shot-sidebar.png` — la **sidebar con gli accordion** (Sessions/Skills&Agents/Providers aperti).
3. `shot-manip.png` — vista "Manipulation": **approval gate** se attivabile (tool gated), altrimenti il **pannello Breakpoints/Tools** o il System Protocol editabile.
4. `shot-cli.png` — output in stile terminale (es. un tool call con output, o il blocco assembled-prompt/reasoning step) per l'**heritage CLI** (verde).
5. (opz.) `shot-providers.png` — il selettore provider che mostra Anthropic + i modelli Ollama (`qwen3.6`/`gemma4-coding`), a riprova del multi-provider.

Salvare i PNG in `/tmp/aether-shots/`.

- [ ] **Step 3: Copiare la hero generata**
```bash
cp docs/Gemini_Generated_Image_h6wth0h6wth0h6wt.png /tmp/aether-shots/hero.png
```
(Scegliere tra le due immagini Gemini quella più adatta come hero; rinominare in `hero.png`.)

- [ ] **Step 4: Mostrare gli screenshot all'utente e confermare**

Presentare le immagini catturate all'utente (è al computer e vuole vederle). Se ne vuole di diverse/aggiuntive, ricatturare prima di procedere. Fermare il dev server quando soddisfatti.

---

## Task 2: Costruire i file del sito

**Files:**
- Create: `index.html`, `install.html`, `assets/style.css`, `assets/main.js` (in una working dir; pubblicati su `gh-pages` nel Task 3)

**Interfaces:**
- Consumes: gli screenshot del Task 1.
- Produces: il sito statico completo, apribile via `file://` o server statico.

- [ ] **Step 1: `assets/style.css` — tema e layout**

Definire le custom properties della palette e gli stili condivisi:
```css
:root{
  --surface-0:#09090B; --surface-2:#18181B; --surface-3:#1F1F23;
  --border-subtle:#27272A; --border-default:#3F3F46;
  --disclosure:#B388FF; --manipulation:#FF6D00; --cli:#00E676;
  --text:#e4e4e7; --text-dim:#a1a1aa; --text-faint:#71717a;
  --font-sans:"Inter",system-ui,sans-serif; --font-mono:"JetBrains Mono",monospace;
}
*{box-sizing:border-box} html{scroll-behavior:smooth}
body{margin:0;background:var(--surface-0);color:var(--text);font-family:var(--font-sans);line-height:1.6}
.mono-label{font-family:var(--font-mono);text-transform:uppercase;letter-spacing:.18em;font-size:.7rem;color:var(--text-faint)}
.wrap{max-width:1040px;margin:0 auto;padding:0 1.25rem}
a{color:var(--disclosure);text-decoration:none} a:hover{text-decoration:underline}
.btn{display:inline-block;padding:.7rem 1.2rem;border-radius:.5rem;font-weight:600;border:1px solid var(--border-default)}
.btn-primary{background:var(--manipulation);color:#1a0d00;border-color:transparent}
.btn-ghost{color:var(--disclosure);border-color:var(--disclosure)}
.card{background:var(--surface-2);border:1px solid var(--border-subtle);border-radius:.75rem;padding:1.25rem}
code,pre,.cmd{font-family:var(--font-mono)}
.cmd{background:#0c0c0f;border:1px solid var(--border-subtle);border-radius:.5rem;padding:.75rem 1rem;color:var(--cli);overflow-x:auto;position:relative}
/* accent helpers */
.c-disc{color:var(--disclosure)} .c-manip{color:var(--manipulation)} .c-cli{color:var(--cli)}
@media (max-width:720px){.grid,.triplet,.gallery{grid-template-columns:1fr!important}}
```
Aggiungere: header/nav sticky con logo `AETHER` (mono) + link (Manifesto, Install, GitHub); hero con immagine; griglie `.triplet` (3 col) e `.gallery` (2 col) per card e screenshot; footer; glow sottile (`box-shadow:0 0 24px -8px var(--accent)`) sugli accenti. Reggere il responsive con `@media`.

- [ ] **Step 2: `index.html` — landing**

Struttura (palette semantica + manifesto verbatim dalla spec Appendice A):
- `<head>`: title "Aether — Disclosure & Manipulation", meta description, OG (title/description/image=assets/img/hero.png), preconnect+link Google Fonts, `assets/style.css`, favicon.
- Header/nav.
- **Hero**: `assets/img/hero.png` + `AETHER` + "Disclosure & Manipulation" + tagline "Osservazione e controllo degli LLM" + CTA `.btn-primary` "Install" (→ install.html) e `.btn-ghost` "GitHub" (→ repo).
- **Manifesto**: il testo integrale (Appendice A della spec) in paragrafi; evidenziare *Disclosure*→`.c-disc`, *Manipulation*→`.c-manip`, *CLI/terminale*→`.c-cli`.
- **Triplet palette**: 3 `.card` (viola/arancio/verde) con bordo/heading del colore, spiegando "Spettro Invisibile".
- **Gallery**: gli screenshot (`assets/img/shot-*.png`) in `.gallery` con didascalie che legano vista→concetto.
- Footer (Step 4).

- [ ] **Step 3: `install.html` — download & troubleshooting**

- `<head>` come sopra, title "Aether — Install & Troubleshooting".
- Header/nav.
- **Install**: prerequisito "Node.js 20+". Tab dei 5 canali (curl/powershell/npm/pnpm/bun); ogni pannello un `.cmd` con bottone "copia". Comandi verbatim:
  - `curl -fsSL https://raw.githubusercontent.com/MichelePolo/Aether/main/scripts/install/install.sh | bash`
  - `powershell -c "irm https://raw.githubusercontent.com/MichelePolo/Aether/main/scripts/install/install.ps1 | iex"`
  - `npm i -g github:MichelePolo/Aether#semver:*`
  - `pnpm add -g github:MichelePolo/Aether#semver:*`
  - `bun add -g github:MichelePolo/Aether#semver:*`
- **Primo avvio**: `.cmd` `aether daemon start --open` → apre `http://localhost:3000`; `aether daemon status` / `aether daemon stop`.
- **Troubleshooting** (una `.card` per voce, contenuti verbatim dalla spec):
  - Porta 3000 occupata → `PORT=3001 aether daemon start --open` / `aether --port 3001 daemon start --open` / dev `PORT=3001 npm run dev`.
  - Node mancante o < 20 → installa Node ≥ 20 (winget `OpenJS.NodeJS.LTS` / `brew install node` / nodejs.org).
  - Errore build `better-sqlite3` → build tools (VS Build Tools C++ + Python / Xcode CLT / build-essential+python3).
  - npm/pnpm/bun installano `main` invece della release → `#semver:*` aggancia il primo tag `v0.1.x`; nota transitoria; curl/powershell non affetti.
  - Browser non si apre (SSH/headless) → apri manualmente `http://localhost:3000`.
- Footer (Step 4).

- [ ] **Step 4: Footer condiviso (in entrambe le pagine)**

```html
<footer class="wrap">
  <p class="mono-label">Disclosure &amp; Manipulation</p>
  <a href="https://github.com/MichelePolo/Aether">GitHub</a> ·
  <a href="https://michelepolo.github.io/Journey/">Blog</a>
</footer>
```

- [ ] **Step 5: `assets/main.js` — interazioni minime**

```js
// copy-to-clipboard sui blocchi .cmd con [data-copy]
document.querySelectorAll('[data-copy]').forEach((btn) => {
  btn.addEventListener('click', async () => {
    const text = btn.closest('.cmd-block')?.querySelector('code')?.innerText ?? '';
    try { await navigator.clipboard.writeText(text); btn.textContent = 'copiato ✓'; }
    catch { btn.textContent = 'copia manuale'; }
    setTimeout(() => { btn.textContent = 'copia'; }, 1500);
  });
});
// tab dei canali install: bottoni [data-tab] -> pannelli [data-panel]
const tabs = document.querySelectorAll('[data-tab]');
tabs.forEach((t) => t.addEventListener('click', () => {
  const key = t.getAttribute('data-tab');
  tabs.forEach((x) => x.classList.toggle('active', x === t));
  document.querySelectorAll('[data-panel]').forEach((p) =>
    p.toggleAttribute('hidden', p.getAttribute('data-panel') !== key));
}));
```
Degrado senza JS: tutti i pannelli `[data-panel]` visibili di default (lo `hidden` lo imposta il JS dopo il load → senza JS si vedono tutti i comandi); i `.cmd` restano selezionabili a mano.

- [ ] **Step 6: Verifica nel browser (working dir)**

Aprire `index.html` e `install.html` nel browser tool. Verificare: render + palette coerenti, copy-button copia il comando giusto, tab cambiano pannello, link footer (repo + blog) corretti, immagini presenti, layout mobile a colonna singola (resize), **zero errori in console**. Correggere e ripetere finché pulito.

---

## Task 3: Pubblicare sul branch orfano `gh-pages`

**Files:**
- Create (su `gh-pages`): `index.html`, `install.html`, `assets/style.css`, `assets/main.js`, `assets/img/*`, `.nojekyll`

- [ ] **Step 1: Creare il branch orfano e assemblare**

Dalla working dir col sito pronto e gli screenshot in `/tmp/aether-shots/`:
```bash
git checkout --orphan gh-pages
git rm -rf --cached . >/dev/null 2>&1 || true
# pulire la working tree dai file del repo (restano i file del sito che copieremo)
```
Assemblare la struttura: mettere `index.html`, `install.html`, `assets/style.css`, `assets/main.js` alla root; creare `assets/img/` e copiarci `/tmp/aether-shots/hero.png` + `shot-*.png`; creare `.nojekyll` vuoto.

> Nota esecuzione: poiché il branch orfano svuota il contesto del repo, è più sicuro costruire i file del sito in `/tmp/aether-site/` durante il Task 2, poi qui copiarli nella working tree pulita del branch `gh-pages`.

- [ ] **Step 2: Commit**

```bash
git add index.html install.html assets .nojekyll
git commit -m "feat(site): Aether presentation site (landing manifesto + install/troubleshooting)"
```

- [ ] **Step 3: Push e abilitazione Pages**

```bash
git push -u origin gh-pages
```
Poi (HITL, lato utente): GitHub → Settings → Pages → "Deploy from a branch" → `gh-pages` / `/ (root)`. L'URL sarà `https://michelepolo.github.io/Aether/`.

- [ ] **Step 4: Verifica finale**

Dopo l'attivazione, aprire l'URL Pages (o riaprire i file localmente) e riconfermare: entrambe le pagine, navigazione, copy/tab, immagini caricate, link footer, nessun 404 sugli asset (path relativi corretti per il sotto-percorso `/Aether/`).

---

## Self-review (esito)

- **Copertura spec:** struttura file (Task 2/3) ✓; palette/look (Task 2 Step 1, Global Constraints) ✓; landing+manifesto+triplet+gallery (Task 2 Step 2) ✓; install 5-canali+primo avvio+troubleshooting (Task 2 Step 3) ✓; footer+blog+meta/OG (Task 2 Step 4 / heads) ✓; screenshot reali+hero (Task 1) ✓; `.nojekyll`+gh-pages orphan (Task 3) ✓; verifica browser (Task 2 Step 6, Task 3 Step 4) ✓.
- **Placeholder scan:** i contenuti testuali (manifesto, comandi, troubleshooting) sono verbatim nella spec referenziata; il codice JS/CSS chiave è completo; l'HTML è descritto per sezioni con sorgenti esatte (esecuzione inline, non subagent context-less).
- **Path coerenti:** asset referenziati come `assets/...` relativi → funzionano sotto `/Aether/` su Pages; immagini in `assets/img/` con nomi `hero.png`/`shot-*.png` coerenti tra Task 1, 2, 3.
- **Rischi:** lo screenshot "Manipulation" dipende dall'attivabilità del gate (fallback Breakpoints/Tools, già previsto); path relativi vs base-path Pages (verificato in Task 3 Step 4).
