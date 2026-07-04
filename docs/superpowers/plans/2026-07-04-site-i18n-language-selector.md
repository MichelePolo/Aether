# Site i18n — Language Selector + English Translation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a flag-based language selector to the Aether minisite nav and ship a full English version of both pages, defaulting to Italian.

**Architecture:** Static, no-build GitHub Pages site. Italian stays at the root (`site/index.html`, `site/install.html`); English lives in `site/en/`. A native `<details>` dropdown in the nav links the two language twins of the current page. Flags are inline SVG (cross-platform). Shared `assets/style.css` and `assets/main.js` gain selector styles and language-aware UI strings.

**Tech Stack:** Vanilla HTML5, CSS (custom properties, glassmorphism), plain ES (no framework, no bundler, no deps).

## Global Constraints

- **No build step / no framework / no dependencies.** Hand-edited static files only.
- **Italian is the default at the root.** Do not rename or move `site/index.html` / `site/install.html`; only add to their `<head>` and nav.
- **English lives under `site/en/`** and references shared assets via `../assets/...`.
- **Flags MUST be inline SVG** (emoji flags fail on Windows). Italian = tricolore, English = Union Jack.
- **Selector must work without JS** (native `<details>`), and be keyboard-operable.
- **Node prerequisite text stays "Node.js 22+"** in install copy (matches the existing site).
- **Brand tagline "Disclosure & Manipulation" stays verbatim** (already English). Technical terms stay in established form: system prompt, tool call, gate, breakpoint, MCP, sub-agent, swarm, dispatch, workspace, `skill-smith`, provider names.
- **No localStorage, no geo/Accept-Language detection, no redirects, no i18n library.**
- All work on branch `feat/pages-site-i18n` (already created off `feat/pages-site`).

**Verification note:** this is a static marketing site with no unit-test framework. "Tests" here are deterministic `grep` assertions plus a local static-server smoke check. Run the static server from `site/`:
`python3 -m http.server 8099 --directory site` (stop with Ctrl-C when done).

---

### Task 1: Language selector infrastructure + wire into the two Italian pages

Adds the selector styles to `style.css`, makes `main.js` language-aware and adds the dropdown-close enhancement, then inserts the selector markup and `hreflang` alternates into both Italian pages. After this task the Italian pages show a working selector; the "English" option points at `en/…` pages that arrive in Tasks 2–3 (interim 404 is expected and acceptable).

**Files:**
- Modify: `site/assets/style.css` (append selector block at end)
- Modify: `site/assets/main.js` (top: string table; body: swap 4 string literals; end: selector-close enhancement)
- Modify: `site/index.html` (`<head>`: add hreflang; `.nav .links`: append selector)
- Modify: `site/install.html` (`<head>`: add hreflang; `.nav .links`: append selector)

**Interfaces:**
- Produces: the `<details class="lang">` markup pattern and the `.lang` / `.lang-menu` CSS classes reused verbatim by Tasks 2–3. Produces `document.documentElement.lang`-driven string selection in `main.js` (Italian pages keep `lang="it"`, so behavior is unchanged for them).

- [ ] **Step 1: Append the selector styles to `site/assets/style.css`**

Append this block at the very end of the file:

```css

/* ---- language selector (native <details> dropdown) ---- */
.nav .links .lang { position:relative; }
.nav .links .lang > summary {
  list-style:none; cursor:pointer; display:inline-flex; align-items:center; gap:.4rem;
  padding:.25rem .5rem; border-radius:.5rem; border:1px solid var(--edge);
  background:rgba(255,255,255,.04); color:var(--text-dim); user-select:none;
}
.nav .links .lang > summary::-webkit-details-marker { display:none; }
.nav .links .lang > summary::marker { content:""; }
.nav .links .lang > summary:hover { color:#fff; }
.nav .links .lang[open] > summary { color:#fff; border-color:var(--disclosure); }
.lang .caret { font-size:.7rem; line-height:1; }
.lang .flag { width:18px; height:12px; border-radius:2px; display:inline-block; flex:0 0 auto;
              box-shadow:0 0 0 1px rgba(255,255,255,.12) inset; }
.lang-menu {
  position:absolute; right:0; top:calc(100% + .4rem); margin:0; padding:.3rem; list-style:none;
  min-width:9.5rem; border-radius:.6rem; border:1px solid var(--edge);
  background:rgba(24,24,27,.94);
  -webkit-backdrop-filter:blur(14px) saturate(150%); backdrop-filter:blur(14px) saturate(150%);
  box-shadow:0 12px 30px -12px rgba(0,0,0,.8); z-index:30;
}
.lang-menu li { margin:0; }
.lang-menu a {
  display:flex; align-items:center; gap:.55rem; padding:.4rem .5rem; border-radius:.4rem;
  color:var(--text-dim); font-size:.82rem;
}
.lang-menu a:hover { background:rgba(255,255,255,.06); color:#fff; text-decoration:none; }
.lang-menu a[aria-current="page"] { color:#fff; }
.lang-menu a[aria-current="page"]::after { content:"✓"; margin-left:auto; color:var(--cli); }
```

- [ ] **Step 2: Make `site/assets/main.js` language-aware — add the string table at the top**

Insert at the very top of the file, before the existing `// Copy-to-clipboard…` comment:

```js
// UI strings that live in JS (not in the HTML) — chosen by <html lang>.
const LANG = ((document.documentElement.lang || 'it').slice(0, 2) === 'en') ? 'en' : 'it';
const STR = {
  it: { copy: 'copia', copied: 'copiato ✓', copyManual: 'copia a mano', slide: 'Vai alla slide ' },
  en: { copy: 'copy',  copied: 'copied ✓',  copyManual: 'copy manually', slide: 'Go to slide ' },
}[LANG];
```

- [ ] **Step 3: Swap the four hardcoded Italian literals in `main.js`**

Replace exactly these four occurrences:

1. `btn.textContent = 'copiato ✓';` → `btn.textContent = STR.copied;`
2. `btn.textContent = 'copia a mano';` → `btn.textContent = STR.copyManual;`
3. `setTimeout(() => { btn.textContent = 'copia'; }, 1500);` → `setTimeout(() => { btn.textContent = STR.copy; }, 1500);`
4. `b.setAttribute('aria-label', 'Vai alla slide ' + (i + 1));` → `b.setAttribute('aria-label', STR.slide + (i + 1));`

- [ ] **Step 4: Add the selector-close enhancement at the end of `main.js`**

Append at the end of the file:

```js

// Language selector (<details class="lang">): close on outside-click and Escape.
// Native <details> already toggles on summary click and links navigate on their
// own; this only tidies the UX. Without JS the dropdown still opens/closes.
const langEl = document.querySelector('details.lang');
if (langEl) {
  document.addEventListener('click', (e) => {
    if (langEl.open && !langEl.contains(e.target)) langEl.open = false;
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') langEl.open = false;
  });
}
```

- [ ] **Step 5: Add `hreflang` alternates to `site/index.html` `<head>`**

Insert immediately after the `<link rel="icon" …>` line:

```html
  <link rel="alternate" hreflang="it" href="index.html" />
  <link rel="alternate" hreflang="en" href="en/index.html" />
  <link rel="alternate" hreflang="x-default" href="index.html" />
```

- [ ] **Step 6: Add the selector to `site/index.html` nav**

In `<nav class="nav">`, inside `<div class="links">`, append the selector as the last child (after the Blog link):

```html
      <details class="lang">
        <summary aria-label="Lingua / Language">
          <svg class="flag" viewBox="0 0 3 2" aria-hidden="true"><rect width="1" height="2" fill="#009246"/><rect width="1" height="2" x="1" fill="#fff"/><rect width="1" height="2" x="2" fill="#ce2b37"/></svg>
          <span>IT</span><span class="caret" aria-hidden="true">▾</span>
        </summary>
        <ul class="lang-menu">
          <li><a href="index.html" aria-current="page"><svg class="flag" viewBox="0 0 3 2" aria-hidden="true"><rect width="1" height="2" fill="#009246"/><rect width="1" height="2" x="1" fill="#fff"/><rect width="1" height="2" x="2" fill="#ce2b37"/></svg> Italiano</a></li>
          <li><a href="en/index.html"><svg class="flag" viewBox="0 0 60 30" aria-hidden="true"><rect width="60" height="30" fill="#012169"/><path d="M0,0 L60,30 M60,0 L0,30" stroke="#fff" stroke-width="6"/><path d="M0,0 L60,30 M60,0 L0,30" stroke="#C8102E" stroke-width="3"/><rect x="25" width="10" height="30" fill="#fff"/><rect y="10" width="60" height="10" fill="#fff"/><rect x="27" width="6" height="30" fill="#C8102E"/><rect y="12" width="60" height="6" fill="#C8102E"/></svg> English</a></li>
        </ul>
      </details>
```

- [ ] **Step 7: Add `hreflang` alternates to `site/install.html` `<head>`**

Insert immediately after the `<link rel="icon" …>` line:

```html
  <link rel="alternate" hreflang="it" href="install.html" />
  <link rel="alternate" hreflang="en" href="en/install.html" />
  <link rel="alternate" hreflang="x-default" href="install.html" />
```

- [ ] **Step 8: Add the selector to `site/install.html` nav**

In `<nav class="nav">`, inside `<div class="links">`, append as the last child (identical to Step 6 — the Italian install page also points its English option at `en/install.html`):

```html
      <details class="lang">
        <summary aria-label="Lingua / Language">
          <svg class="flag" viewBox="0 0 3 2" aria-hidden="true"><rect width="1" height="2" fill="#009246"/><rect width="1" height="2" x="1" fill="#fff"/><rect width="1" height="2" x="2" fill="#ce2b37"/></svg>
          <span>IT</span><span class="caret" aria-hidden="true">▾</span>
        </summary>
        <ul class="lang-menu">
          <li><a href="install.html" aria-current="page"><svg class="flag" viewBox="0 0 3 2" aria-hidden="true"><rect width="1" height="2" fill="#009246"/><rect width="1" height="2" x="1" fill="#fff"/><rect width="1" height="2" x="2" fill="#ce2b37"/></svg> Italiano</a></li>
          <li><a href="en/install.html"><svg class="flag" viewBox="0 0 60 30" aria-hidden="true"><rect width="60" height="30" fill="#012169"/><path d="M0,0 L60,30 M60,0 L0,30" stroke="#fff" stroke-width="6"/><path d="M0,0 L60,30 M60,0 L0,30" stroke="#C8102E" stroke-width="3"/><rect x="25" width="10" height="30" fill="#fff"/><rect y="10" width="60" height="10" fill="#fff"/><rect x="27" width="6" height="30" fill="#C8102E"/><rect y="12" width="60" height="6" fill="#C8102E"/></svg> English</a></li>
        </ul>
      </details>
```

- [ ] **Step 9: Verify the edits are correct**

Run:
```bash
grep -c 'details class="lang"' site/index.html site/install.html
grep -c 'hreflang' site/index.html site/install.html
grep -n "STR.copied\|STR.copyManual\|STR.copy;\|STR.slide" site/assets/main.js
grep -n "details.lang" site/assets/main.js
grep -c "language selector" site/assets/style.css
```
Expected: each HTML file reports `1` for the selector and `3` hreflang lines; `main.js` shows all four `STR.*` usages plus the `details.lang` handler; `style.css` reports `1`.

- [ ] **Step 10: Smoke-test in the browser (Italian pages)**

Start the static server: `python3 -m http.server 8099 --directory site` (background it or use a second shell). Open `http://localhost:8099/index.html`. Confirm:
- The selector shows the Italian flag + `IT` in the nav, right-aligned with the other links.
- Clicking it opens a menu with 🇮🇹 Italiano (checkmarked) and 🇬🇧 English.
- Clicking outside closes it; Escape closes it.
- "English" points to `/en/index.html` (404 for now — expected).
- On `install.html`, "English" points to `/en/install.html`.
Stop the server when done.

- [ ] **Step 11: Commit**

```bash
git add site/assets/style.css site/assets/main.js site/index.html site/install.html
git commit -m "feat(site): language selector in nav + i18n-ready shared assets

Native <details> flag dropdown (inline SVG, cross-platform), language-aware
UI strings in main.js keyed off <html lang>, and hreflang alternates on the
Italian pages. English option targets en/ pages (added next)."
```

---

### Task 2: English homepage — `site/en/index.html`

Full English translation of `index.html`, `lang="en"`, assets referenced via `../assets/`, selector current-language = English, `hreflang` alternates pointing back up to the root.

**Files:**
- Create: `site/en/index.html`

**Interfaces:**
- Consumes: the `.lang` / `.lang-menu` markup + CSS and the `STR.en` table from Task 1.
- Produces: the English homepage that the Italian page's selector links to; establishes the `en/` nav/footer link conventions reused by Task 3.

- [ ] **Step 1: Create `site/en/index.html` with the full translated content**

Create the file with exactly this content:

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Aether — Disclosure &amp; Manipulation</title>
  <meta name="description" content="Aether: an agentic, local-first, multi-provider dev studio to observe and control LLMs. Disclosure & Manipulation." />
  <meta property="og:title" content="Aether — Disclosure & Manipulation" />
  <meta property="og:description" content="Observing and controlling LLMs. Local-first, multi-provider, agentic." />
  <meta property="og:image" content="../assets/img/hero.png" />
  <meta property="og:type" content="website" />
  <link rel="icon" href="../assets/img/favicon.svg" type="image/svg+xml" />
  <link rel="alternate" hreflang="it" href="../index.html" />
  <link rel="alternate" hreflang="en" href="index.html" />
  <link rel="alternate" hreflang="x-default" href="../index.html" />
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;700&display=swap" rel="stylesheet" />
  <link rel="stylesheet" href="../assets/style.css" />
</head>
<body>
  <div class="aurora" aria-hidden="true"><span class="a"></span><span class="b"></span><span class="c"></span></div>
  <div class="grain" aria-hidden="true"></div>

  <nav class="nav">
    <span class="brand">AETHER<span class="dot">_</span>CORE</span>
    <div class="links">
      <a href="#manifesto">Manifesto</a>
      <a href="install.html">Install</a>
      <a href="https://github.com/MichelePolo/Aether">GitHub</a>
      <a href="https://michelepolo.github.io/Journey/">Blog</a>
      <details class="lang">
        <summary aria-label="Lingua / Language">
          <svg class="flag" viewBox="0 0 60 30" aria-hidden="true"><rect width="60" height="30" fill="#012169"/><path d="M0,0 L60,30 M60,0 L0,30" stroke="#fff" stroke-width="6"/><path d="M0,0 L60,30 M60,0 L0,30" stroke="#C8102E" stroke-width="3"/><rect x="25" width="10" height="30" fill="#fff"/><rect y="10" width="60" height="10" fill="#fff"/><rect x="27" width="6" height="30" fill="#C8102E"/><rect y="12" width="60" height="6" fill="#C8102E"/></svg>
          <span>EN</span><span class="caret" aria-hidden="true">▾</span>
        </summary>
        <ul class="lang-menu">
          <li><a href="../index.html"><svg class="flag" viewBox="0 0 3 2" aria-hidden="true"><rect width="1" height="2" fill="#009246"/><rect width="1" height="2" x="1" fill="#fff"/><rect width="1" height="2" x="2" fill="#ce2b37"/></svg> Italiano</a></li>
          <li><a href="index.html" aria-current="page"><svg class="flag" viewBox="0 0 60 30" aria-hidden="true"><rect width="60" height="30" fill="#012169"/><path d="M0,0 L60,30 M60,0 L0,30" stroke="#fff" stroke-width="6"/><path d="M0,0 L60,30 M60,0 L0,30" stroke="#C8102E" stroke-width="3"/><rect x="25" width="10" height="30" fill="#fff"/><rect y="10" width="60" height="10" fill="#fff"/><rect x="27" width="6" height="30" fill="#C8102E"/><rect y="12" width="60" height="6" fill="#C8102E"/></svg> English</a></li>
        </ul>
      </details>
    </div>
  </nav>

  <header class="hero wrap">
    <img src="../assets/img/hero.png" alt="Aether — Disclosure & Manipulation for LLMs" />
    <h1>Aether <span class="c-disc">Disclosure</span> &amp; <span class="c-manip">Manipulation</span></h1>
    <p class="tag">A local-first studio to see how LLM agents really work — and to learn by getting your hands on them.</p>
    <div class="cta">
      <a class="btn btn-primary" href="install.html">Install</a>
      <a class="btn btn-ghost" href="https://github.com/MichelePolo/Aether">GitHub</a>
    </div>
  </header>

  <main>
    <section id="manifesto" class="wrap manifesto">
      <p class="mono-label">Manifesto</p>
      <h2><span class="c-disc">Disclosure</span> &amp; <span class="c-manip">Manipulation</span></h2>

      <p class="intro">Most AI tools show you the answer and hide everything else. Aether does the opposite.</p>

      <p>It's a <strong>local-first</strong>, <strong>multi-provider</strong> agentic studio (Anthropic, OpenAI, Gemini, Ollama and compatible endpoints), built for one thing: <strong>to understand how an LLM agent really works</strong> — and to learn by using it.</p>

      <p><strong class="c-disc">Disclosure.</strong> An agent is usually a black box: you see the output, not the why. Aether opens the box — the <em>assembled system prompt</em> of every request, the context, the reasoning steps, every tool call with its output, the tokens. You no longer guess what drives the answers: you observe it.</p>

      <p><strong class="c-manip">Manipulation.</strong> You understand by doing. Breakpoints on tools, gates with a preview before irreversible actions, context injection, control from the CLI. Change a variable and see the effect: that's how you learn.</p>

      <p>Aether is for people who work with AI and want to stop guessing at prompts — to <em>really</em> understand System Prompt, Tools, Skills and Gates, and the best practices that emerge from building agentic software.</p>
    </section>

    <section class="wrap">
      <p class="mono-label">What you understand with Aether</p>
      <h2>Agents, taken apart</h2>
      <div class="concepts">
        <div class="card c1">
          <p class="mono-label c-disc">System Prompt</p>
          <h3>What the model receives</h3>
          <p>The instructions, context and tools the model actually receives — usually invisible. In Aether you see the <em>assembled system prompt</em> of every dispatch: you understand how framing changes the answers.</p>
        </div>
        <div class="card c2">
          <p class="mono-label c-manip">Tools · MCP</p>
          <h3>What it can do</h3>
          <p>The functions the agent can call: filesystem, shell, any MCP server. You connect them in 1 click and see every tool call with its output, distinct from the rest: you understand <em>when</em> and <em>why</em> it uses a tool.</p>
        </div>
        <div class="card c3">
          <p class="mono-label c-cli">Skills &amp; agents</p>
          <h3>How it's composed</h3>
          <p>Reusable skills and procedures. You compose skills, sub-agents and swarms — there's even <code>skill-smith</code>, an agent that helps you write new ones. You learn to structure capabilities instead of repeating prompts.</p>
        </div>
        <div class="card c4">
          <p class="mono-label c-disc">Gates &amp; approvals</p>
          <h3>Who stays in control</h3>
          <p>Control over irreversible actions. You set tools to auto or gate and approve with a diff preview: you learn to let the agent run without losing control of it.</p>
        </div>
      </div>
    </section>

    <section class="wrap">
      <p class="mono-label">Lessons from the field</p>
      <h2>Best practices, not theory</h2>
      <ol class="lessons">
        <li><strong>Brainstorm before code.</strong> An agreed, test-driven plan beats intuition. Using Obra's Superpowers skills is no longer optional: Aether's own agents would want to start from this rule, and all of Aether is built this way.</li>
        <li><strong>Isolated sub-agents.</strong> Narrow task, narrow context: parallel work is reliable when you don't share too much context — anything extra is noise in the session.</li>
        <li><strong>Gate before touching the world.</strong> File, shell and git are embedded tools by default (integrated via MCP) and pass through an approval with a preview: the LLM is free up to that point.</li>
        <li><strong>Context is a resource.</strong> Per-workspace rooting, conversation forks and targeted tools — instead of giving everything to everyone everywhere.</li>
      </ol>
    </section>

    <section class="wrap">
      <p class="mono-label">What's still missing</p>
      <h2>The roadmap</h2>
      <ul class="roadmap">
        <li><strong>AST</strong> — read code as a syntax tree, not as text: reason about program structure, not strings.</li>
        <li><strong>LSP</strong> — hook up Language Servers: diagnostics, definitions and references from the IDE, fed straight to the agent.</li>
        <li><strong>Ingestion &amp; RAG</strong> — index documents and codebases and retrieve only the relevant pieces as context, instead of pasting everything.</li>
        <li><strong>Additional tools</strong> — more embedded tools beyond filesystem, shell and git.</li>
        <li><strong>Multi-provider integration tests</strong> — end-to-end tests across multiple LLM providers, to guarantee behavioral parity.</li>
        <li><strong>Remote control</strong> — drive the daemon and sessions remotely, not just from localhost.</li>
        <li><strong>LDAP authentication</strong> — login via a corporate directory, for team use.</li>
      </ul>
      <p class="roadmap-quote">Appetite comes with eating.</p>
    </section>

    <section class="wrap">
      <p class="mono-label">In action</p>
      <h2>Aether live</h2>
      <p class="lead">Real screenshots: an <span class="c-cli">Ollama</span> and <span class="c-disc">Anthropic</span> agent working under your gaze.</p>
      <div class="carousel">
        <div class="carousel-track">
          <figure class="shot">
            <img src="../assets/img/shot-overview.png" alt="Aether: accordion sidebar, chat with a local model and tool calls" />
            <figcaption>Accordion sidebar, real chat and distinguishable <span class="c-cli">tool calls</span> — all in one workspace.</figcaption>
          </figure>
          <figure class="shot">
            <img src="../assets/img/shot-reasoning.png" alt="Reasoning drawer: context, tools, dispatch, validation with tokens and timings" />
            <figcaption><span class="c-disc">Disclosure</span>: the reasoning drawer shows context, tools, dispatch, tokens and metadata.</figcaption>
          </figure>
          <figure class="shot">
            <img src="../assets/img/shot-opus.png" alt="Claude Opus 4.8 admitting its own mistakes, with the reasoning drawer open" />
            <figcaption><span class="c-disc">Disclosure</span> with <span class="c-disc">Claude Opus 4.8</span>: the agent admits its own mistakes — reasoning and tools in plain sight, nothing hidden.</figcaption>
          </figure>
          <figure class="shot">
            <img src="../assets/img/shot-manip.png" alt="Tools and Breakpoints panel with auto/gate toggles" />
            <figcaption><span class="c-manip">Manipulation</span>: breakpoints, tool gates and coding tools — the control is yours.</figcaption>
          </figure>
          <figure class="shot">
            <img src="../assets/img/shot-swimlanes.png" alt="Git Swimlanes: repo history with per-branch swimlanes and inferred PRs" />
            <figcaption>Git Swimlanes: the repo history visualized — branches, inferred PRs and on-demand diffs, inside Aether.</figcaption>
          </figure>
        </div>
        <button class="carousel-btn prev" aria-label="Previous">‹</button>
        <button class="carousel-btn next" aria-label="Next">›</button>
        <div class="carousel-dots" aria-label="Slides"></div>
      </div>
    </section>

    <section class="wrap">
      <p class="mono-label">A closer look</p>
      <h2>Details</h2>
      <div class="carousel details-carousel">
        <div class="carousel-track">
          <div class="slide">
            <figure class="shot">
              <img src="../assets/img/detail-skill-smith.png" alt="skill-smith sub-agent editor: name, system instruction, model, skills and tools" />
              <figcaption><span class="c-cli">Skills &amp; agents</span>: <code>skill-smith</code> — a sub-agent that writes skills with you. You see (and edit) its <span class="c-disc">system instruction</span>: sub-agent → system prompt → skill.</figcaption>
            </figure>
          </div>
          <div class="slide">
            <figure class="shot">
              <img src="../assets/img/detail-prompt.png" alt="Reasoning drawer: context, assembled system prompt and tools" />
              <figcaption><span class="c-disc">Disclosure</span>: the assembled system prompt, revealed — context, prompt and tools.</figcaption>
            </figure>
          </div>
          <div class="slide">
            <figure class="shot">
              <img src="../assets/img/detail-tools.png" alt="Tools: coding tools, auto/gate breakpoints and session approvals" />
              <figcaption><span class="c-manip">Manipulation</span>: breakpoints (auto/gate) and session approvals — you decide what the agent can do.</figcaption>
            </figure>
          </div>
          <div class="slide">
            <figure class="shot">
              <img src="../assets/img/detail-skills.png" alt="Skills & Agents: skills, sub-agents, swarms and schedules" />
              <figcaption>Skills, sub-agents, swarms and schedules: the composable agent.</figcaption>
            </figure>
          </div>
          <div class="slide">
            <figure class="shot">
              <img src="../assets/img/detail-providers.png" alt="Provider selector: Anthropic Opus/Sonnet/Haiku and local Ollama models" />
              <figcaption>Multi-provider: <span class="c-disc">Anthropic</span> (Opus/Sonnet/Haiku) and local <span class="c-cli">Ollama</span> in one click.</figcaption>
            </figure>
          </div>
        </div>
        <button class="carousel-btn prev" aria-label="Previous">‹</button>
        <button class="carousel-btn next" aria-label="Next">›</button>
        <div class="carousel-dots" aria-label="Slides"></div>
      </div>
    </section>
  </main>

  <footer>
    <div class="wrap">
      <p class="mono-label"><span class="c-disc">Disclosure</span> &amp; <span class="c-manip">Manipulation</span></p>
      <div class="links">
        <a href="https://github.com/MichelePolo/Aether">GitHub</a>
        <a href="install.html">Install &amp; Troubleshooting</a>
        <a href="https://michelepolo.github.io/Journey/">Blog</a>
      </div>
      <p class="credit">Aether — Observing and controlling LLMs.</p>
    </div>
  </footer>

  <script src="../assets/main.js"></script>
</body>
</html>
```

- [ ] **Step 2: Verify structure and links**

Run:
```bash
grep -c 'lang="en"' site/en/index.html                       # expect 1
grep -c '\.\./assets/' site/en/index.html                    # expect >= 8 (css, js, favicon, og, 10 imgs)
grep -o 'href="../index.html"' site/en/index.html | head -1  # selector Italiano link present
grep -c 'aria-current="page"' site/en/index.html             # expect 1 (English is current)
grep -ci 'class="tag"' site/en/index.html                    # expect 1
! grep -n 'assets/img' site/en/index.html | grep -v '\.\./'  # no root-relative asset paths leaked
```
Expected: `lang="en"` once, no leaked root-relative `assets/` paths (the `!`-prefixed grep should exit 0, i.e. find none).

- [ ] **Step 3: Smoke-test in the browser**

With the static server running (`python3 -m http.server 8099 --directory site`), open `http://localhost:8099/en/index.html`. Confirm:
- Page renders identically to the Italian homepage (same layout, aurora, cards, carousels) but in English.
- Images load (assets resolve via `../assets/`).
- Selector shows the UK flag + `EN`; menu has 🇮🇹 Italiano → goes to the Italian homepage, 🇬🇧 English checkmarked.
- Carousels advance; copy of any command isn't on this page (no cmd blocks here) — fine.
- No Italian text remains in the prose.

- [ ] **Step 4: Commit**

```bash
git add site/en/index.html
git commit -m "feat(site): English homepage (en/index.html)

Full English translation of the manifesto homepage; assets via ../assets,
selector current-language EN, hreflang alternates back to the root."
```

---

### Task 3: English install page — `site/en/install.html`

Full English translation of `install.html`. Code blocks and commands are language-neutral and stay byte-identical; only prose, headings, labels, code comments, the copy-button text, and carousel/nav aria-labels translate.

**Files:**
- Create: `site/en/install.html`

**Interfaces:**
- Consumes: the `.lang` markup + CSS and `STR.en` table from Task 1; the `en/` nav/footer link conventions from Task 2.

- [ ] **Step 1: Create `site/en/install.html` with the full translated content**

Create the file with exactly this content:

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Aether — Install &amp; Troubleshooting</title>
  <meta name="description" content="Install Aether with one command (curl, powershell, npm, pnpm, bun). First run and troubleshooting: port in use, Node, better-sqlite3." />
  <meta property="og:title" content="Aether — Install & Troubleshooting" />
  <meta property="og:description" content="One command to install Aether. Plus first run and troubleshooting." />
  <meta property="og:image" content="../assets/img/hero.png" />
  <meta property="og:type" content="website" />
  <link rel="icon" href="../assets/img/favicon.svg" type="image/svg+xml" />
  <link rel="alternate" hreflang="it" href="../install.html" />
  <link rel="alternate" hreflang="en" href="install.html" />
  <link rel="alternate" hreflang="x-default" href="../install.html" />
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;700&display=swap" rel="stylesheet" />
  <link rel="stylesheet" href="../assets/style.css" />
</head>
<body>
  <div class="aurora" aria-hidden="true"><span class="a"></span><span class="b"></span><span class="c"></span></div>
  <div class="grain" aria-hidden="true"></div>

  <nav class="nav">
    <a class="brand" href="index.html" style="text-decoration:none">AETHER<span class="dot">_</span>CORE</a>
    <div class="links">
      <a href="index.html#manifesto">Manifesto</a>
      <a href="install.html">Install</a>
      <a href="https://github.com/MichelePolo/Aether">GitHub</a>
      <a href="https://michelepolo.github.io/Journey/">Blog</a>
      <details class="lang">
        <summary aria-label="Lingua / Language">
          <svg class="flag" viewBox="0 0 60 30" aria-hidden="true"><rect width="60" height="30" fill="#012169"/><path d="M0,0 L60,30 M60,0 L0,30" stroke="#fff" stroke-width="6"/><path d="M0,0 L60,30 M60,0 L0,30" stroke="#C8102E" stroke-width="3"/><rect x="25" width="10" height="30" fill="#fff"/><rect y="10" width="60" height="10" fill="#fff"/><rect x="27" width="6" height="30" fill="#C8102E"/><rect y="12" width="60" height="6" fill="#C8102E"/></svg>
          <span>EN</span><span class="caret" aria-hidden="true">▾</span>
        </summary>
        <ul class="lang-menu">
          <li><a href="../install.html"><svg class="flag" viewBox="0 0 3 2" aria-hidden="true"><rect width="1" height="2" fill="#009246"/><rect width="1" height="2" x="1" fill="#fff"/><rect width="1" height="2" x="2" fill="#ce2b37"/></svg> Italiano</a></li>
          <li><a href="install.html" aria-current="page"><svg class="flag" viewBox="0 0 60 30" aria-hidden="true"><rect width="60" height="30" fill="#012169"/><path d="M0,0 L60,30 M60,0 L0,30" stroke="#fff" stroke-width="6"/><path d="M0,0 L60,30 M60,0 L0,30" stroke="#C8102E" stroke-width="3"/><rect x="25" width="10" height="30" fill="#fff"/><rect y="10" width="60" height="10" fill="#fff"/><rect x="27" width="6" height="30" fill="#C8102E"/><rect y="12" width="60" height="6" fill="#C8102E"/></svg> English</a></li>
        </ul>
      </details>
    </div>
  </nav>

  <main>
    <section class="wrap">
      <p class="mono-label">Install</p>
      <h2>One command, and you're in</h2>
      <p class="prereq">Prerequisite: <strong>Node.js 22+</strong> — the install downloads a <strong>prebuilt tarball</strong> (no build on the client); <code>better-sqlite3</code> downloads a prebuilt native binary on most platforms.</p>

      <div class="tabs">
        <button class="tab" data-tab="curl">curl · macOS/Linux</button>
        <button class="tab" data-tab="powershell">PowerShell · Windows</button>
        <button class="tab" data-tab="npm">npm</button>
        <button class="tab" data-tab="pnpm">pnpm</button>
        <button class="tab" data-tab="bun">bun</button>
      </div>

      <div class="cmd-block" data-panel="curl">
        <pre class="cmd"><span class="prompt">$ </span>curl -fsSL https://raw.githubusercontent.com/MichelePolo/Aether/main/scripts/install/install.sh | bash</pre>
        <button class="copy" data-copy>copy</button>
      </div>
      <div class="cmd-block" data-panel="powershell">
        <pre class="cmd"><span class="prompt">&gt; </span>powershell -c "irm https://raw.githubusercontent.com/MichelePolo/Aether/main/scripts/install/install.ps1 | iex"</pre>
        <button class="copy" data-copy>copy</button>
      </div>
      <div class="cmd-block" data-panel="npm">
        <pre class="cmd"><span class="prompt">$ </span>npm i -g https://github.com/MichelePolo/Aether/releases/latest/download/aether-core.tgz</pre>
        <button class="copy" data-copy>copy</button>
      </div>
      <div class="cmd-block" data-panel="pnpm">
        <pre class="cmd"><span class="prompt">$ </span>pnpm add -g https://github.com/MichelePolo/Aether/releases/latest/download/aether-core.tgz</pre>
        <button class="copy" data-copy>copy</button>
      </div>
      <div class="cmd-block" data-panel="bun">
        <pre class="cmd"><span class="prompt">$ </span>bun add -g https://github.com/MichelePolo/Aether/releases/latest/download/aether-core.tgz</pre>
        <button class="copy" data-copy>copy</button>
      </div>

      <p class="prereq" style="margin-top:1rem">curl and PowerShell verify Node, install the latest release and start Aether, opening the browser. With npm/pnpm/bun, run <code>aether daemon start --open</code> yourself after the install.</p>
    </section>

    <section class="wrap">
      <p class="mono-label">First run</p>
      <h2>Start and open</h2>
      <div class="cmd-block">
        <pre class="cmd"><span class="prompt">$ </span>aether daemon start --open   <span class="prompt"># start the server and open http://localhost:3000</span>
<span class="prompt">$ </span>aether daemon status         <span class="prompt"># running/stopped + pid + port</span>
<span class="prompt">$ </span>aether daemon stop</pre>
        <button class="copy" data-copy>copy</button>
      </div>
    </section>

    <section class="wrap">
      <p class="mono-label">Uninstall</p>
      <h2>Remove Aether</h2>
      <div class="cmd-block">
        <pre class="cmd"><span class="prompt">$ </span>aether daemon stop            <span class="prompt"># stop the server, if running</span>
<span class="prompt">$ </span>npm  rm -g aether-core        <span class="prompt"># pnpm: pnpm rm -g · bun: bun rm -g</span></pre>
        <button class="copy" data-copy>copy</button>
      </div>
      <p class="prereq" style="margin-top:1rem">Once the package is removed, the <code>aether</code> command disappears. Local data (sessions, SQLite DB, encrypted keys) lives in the <code>data/</code> folder you started the daemon from — or in <code>$AETHER_DATA_DIR</code> if you set it. To delete it entirely: <code>rm -rf data</code> in that folder.</p>
    </section>

    <section class="wrap">
      <p class="mono-label">Troubleshooting</p>
      <h2>If something's off</h2>
      <div class="tshoot">
        <div class="card">
          <h3>Port 3000 is already in use</h3>
          <p>Aether binds to the <code>PORT</code> variable (default 3000). Pick another one:</p>
          <div class="cmd-block">
            <pre class="cmd"><span class="prompt">$ </span>PORT=3001 aether daemon start --open
<span class="prompt">$ </span>aether --port 3001 daemon start --open
<span class="prompt"># from a clone, in dev:</span>
<span class="prompt">$ </span>PORT=3001 npm run dev</pre>
            <button class="copy" data-copy>copy</button>
          </div>
        </div>

        <div class="card">
          <h3>Node missing or &lt; 20</h3>
          <p>You need Node.js ≥ 20. Install it and re-run: <code>winget install OpenJS.NodeJS.LTS</code> (Windows), <code>brew install node</code> (macOS), or from <a href="https://nodejs.org">nodejs.org</a>. The install scripts check for it and stop with a clear message.</p>
        </div>

        <div class="card">
          <h3><code>better-sqlite3</code> build error</h3>
          <p>If there's no prebuilt binary for your platform, it's compiled and you need build tools: <strong>Windows</strong> = "Visual Studio Build Tools" (C++ workload) + Python; <strong>macOS</strong> = Xcode Command Line Tools (<code>xcode-select --install</code>); <strong>Linux</strong> = <code>build-essential</code> + <code>python3</code>.</p>
        </div>

        <div class="card">
          <h3><code>EACCES</code> / permission denied on the global install</h3>
          <p>If npm's global prefix is owned by root, the <code>-g</code> install can fail with <code>EACCES</code>. Use a user prefix (no sudo):</p>
          <div class="cmd-block">
            <pre class="cmd"><span class="prompt">$ </span>npm config set prefix ~/.local
<span class="prompt"># add ~/.local/bin to your PATH, then re-run the install</span></pre>
            <button class="copy" data-copy>copy</button>
          </div>
        </div>

        <div class="card">
          <h3>The browser doesn't open (SSH/headless)</h3>
          <p>Opening the browser is best-effort. If it doesn't start, open the printed URL manually: <code>http://localhost:3000</code> (or the port you chose).</p>
        </div>
      </div>
    </section>
  </main>

  <footer>
    <div class="wrap">
      <p class="mono-label"><span class="c-disc">Disclosure</span> &amp; <span class="c-manip">Manipulation</span></p>
      <div class="links">
        <a href="https://github.com/MichelePolo/Aether">GitHub</a>
        <a href="index.html">Manifesto</a>
        <a href="https://michelepolo.github.io/Journey/">Blog</a>
      </div>
      <p class="credit">Aether — Observing and controlling LLMs.</p>
    </div>
  </footer>

  <script src="../assets/main.js"></script>
</body>
</html>
```

- [ ] **Step 2: Verify structure, links, and that commands are unchanged**

Run:
```bash
grep -c 'lang="en"' site/en/install.html                    # expect 1
grep -c 'data-copy>copy<' site/en/install.html              # expect 9 (all copy buttons in English)
grep -c 'aria-current="page"' site/en/install.html          # expect 1
grep -F 'aether-core.tgz' site/en/install.html | wc -l      # expect 3 (npm/pnpm/bun commands intact)
! grep -n 'assets/img\|"assets/\|href="assets' site/en/install.html | grep -v '\.\./'   # no leaked root paths
```
Cross-check the commands byte-for-byte against the Italian source (only prose/comments should differ):
```bash
diff <(grep -oE 'aether daemon [a-z ]+|PORT=3001[^<]*|npm i -g[^<]*|pnpm add -g[^<]*|bun add -g[^<]*' site/install.html) \
     <(grep -oE 'aether daemon [a-z ]+|PORT=3001[^<]*|npm i -g[^<]*|pnpm add -g[^<]*|bun add -g[^<]*' site/en/install.html)
```
Expected: the `diff` shows no differences in the command payloads.

- [ ] **Step 3: Smoke-test in the browser**

With the static server running, open `http://localhost:8099/en/install.html`. Confirm:
- Renders in English; tabs switch panels; the copy button reads "copy" and shows "copied ✓" on click.
- The selector's Italiano option → `../install.html` (the Italian install page); English is checkmarked.
- Nav "Manifesto" → `index.html#manifesto` (English homepage); footer "Manifesto" → English homepage.
- No Italian prose remains.

- [ ] **Step 4: Commit**

```bash
git add site/en/install.html
git commit -m "feat(site): English install & troubleshooting page (en/install.html)

Full English translation; commands unchanged, copy-button text and prose
translated, selector + hreflang wired for the en/ pair."
```

---

### Task 4: Cross-linking regression check + finalize

A whole-site pass confirming every language switch lands on the correct twin, no link 404s within the site, and the Italian pages are unchanged except for the two intended additions.

**Files:** none (verification + optional fixes only)

- [ ] **Step 1: Confirm the four-way cross-link map**

Run:
```bash
echo "IT index -> EN:";     grep -o 'href="en/index.html"'      site/index.html
echo "IT install -> EN:";   grep -o 'href="en/install.html"'    site/install.html
echo "EN index -> IT:";     grep -o 'href="../index.html"'      site/en/index.html
echo "EN install -> IT:";   grep -o 'href="../install.html"'    site/en/install.html
```
Expected: one match on each line — the selector twins point to the same page in the other language.

- [ ] **Step 2: Confirm the Italian pages only gained the selector + hreflang**

Run:
```bash
git diff feat/pages-site -- site/index.html site/install.html | grep '^-' | grep -v '^---'
```
Expected: **no** removed content lines (`-` lines) other than none — the diff should be purely additive (selector block + 3 hreflang lines per page). If any real content line was removed, restore it.

- [ ] **Step 3: Link-check the whole `site/` tree with the static server**

With `python3 -m http.server 8099 --directory site` running, verify each page returns 200:
```bash
for p in index.html install.html en/index.html en/install.html; do
  printf '%s -> ' "$p"; curl -s -o /dev/null -w '%{http_code}\n' "http://localhost:8099/$p"
done
```
Expected: all four print `200`.

- [ ] **Step 4: Final browser pass with GIF (optional, recommended)**

Load `http://localhost:8099/index.html`, switch IT→EN via the selector, navigate to Install, switch EN→IT, confirming page context is preserved each time. Optionally record with the browser gif tool as `site-i18n-switch.gif` for the PR.

- [ ] **Step 5: Stop the static server**

Stop the `python3 -m http.server` process you started (Ctrl-C, or kill the specific PID you launched — do not pkill node/other processes).

- [ ] **Step 6: Final commit (only if Step 2/3 required a fix; otherwise skip)**

```bash
git add -A site/
git commit -m "fix(site): i18n cross-link corrections from regression pass"
```

---

## Notes for the implementer

- The two English pages are near-identical in structure to their Italian twins — translate prose, keep every `class`, `id`, `data-*`, image `src` (with `../` prefix), and command payload identical.
- The Union Jack SVG is a deliberately simplified (symmetric-diagonal) rendering — correct at 18px, no clip-paths, so it never collides on IDs when it appears twice on a page.
- Deployment (`site/` → `gh-pages` root) already recurses into subfolders; `en/` needs no workflow change. Publishing stays deferred until the next site release.
