# Site Content & Layout Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax. This is a STATIC site: "verification" = render in the browser (local server + screenshot) + zero console errors, not unit tests.

**Goal:** Reposition the presentation site as a study tool for understanding LLM agents — concrete product-voice manifesto, a "Cosa capisci" concept grid, a "Lezioni dal campo" band, screenshots re-tied to concepts (+ skill-smith).

**Architecture:** Edit `site/index.html` + `site/assets/style.css` on `feat/pages-site`; keep the existing glassmorphism language. Verify each section by serving `site/` locally and screenshotting. Deploy by rebuilding the orphan `gh-pages` from `site/` (admin-only ruleset — owner bypass).

**Tech Stack:** static HTML5 + CSS3 (existing tokens/glass), no framework. Local check: `python3 -m http.server`. Screenshots via the browser tool.

## Global Constraints

- Copy is **Italian**, **product voice** (plain, concrete, second person "tu"), no cosmic metaphors, no superlatives. Verbatim copy for hero/manifesto/cards/lessons is in the spec (`docs/superpowers/specs/2026-07-01-site-content-redesign-design.md`).
- **Motto kept** ("Aether — Disclosure & Manipulation"), recontextualized to learning.
- Keep the **glassmorphism** design (tokens, `.glass`, aurora) unchanged except styles the new sections need.
- **No app/code changes**; `install.html` content unchanged (shares CSS only).
- Deploy: rebuild orphan `gh-pages` from `site/`; push is admin-bypass on the locked branch. Verify `https://michelepolo.github.io/Aether/` after.
- Local verify recipe (used by every task): `cd site && python3 -m http.server 8113 --bind 127.0.0.1` (background), navigate `http://127.0.0.1:8113/index.html`, screenshot, `list_console_messages` (expect none), stop server with `fuser -k 8113/tcp`.

---

## Task 1: Hero tagline + rewritten manifesto

**Files:**
- Modify: `site/index.html` (hero `<p class="tag">`; the `#manifesto` section body)

- [ ] **Step 1: Replace the hero tagline**

In `<header class="hero wrap">`, replace the `<p class="tag">…</p>` text with:
```
Uno studio local-first per vedere come lavorano davvero gli agenti LLM — e imparare mettendoci le mani.
```

- [ ] **Step 2: Replace the manifesto body**

In `<section id="manifesto" class="wrap manifesto">`, keep `<p class="mono-label">Manifesto</p>` and the `<h2>`; replace ALL the `<p>` paragraphs (the 8 ether paragraphs) with the 5 approved paragraphs (spec §"Copy — Manifesto"), using `<strong class="c-disc">Disclosure</strong>` / `<strong class="c-manip">Manipulation</strong>` for those two lead-ins and `<em>` for the italicised phrases. First paragraph gets `class="intro"`.

- [ ] **Step 3: Verify**

Serve + screenshot `index.html`. Expected: hero shows the new tagline; manifesto is ~5 tight paragraphs, no ether metaphor; console clean.

- [ ] **Step 4: Commit**
```bash
git add site/index.html
git commit -m "content(site): product-voice manifesto + education tagline"
```

---

## Task 2: "Cosa capisci" concept grid (replaces the palette triplet)

**Files:**
- Modify: `site/index.html` (remove the "Spettro Invisibile" section; add the concept section)
- Modify: `site/assets/style.css` (4-up grid)

**Interfaces:**
- Produces: a `<section>` with `<div class="concepts">` containing 4 `<div class="card">` (classes `c1..c4` for the top-edge hue).

- [ ] **Step 1: Remove the palette-triplet section**

Delete the whole `<section>` that starts with `<p class="mono-label">Spettro Invisibile</p>` … through its closing `</section>`.

- [ ] **Step 2: Add the concept section**

Immediately after the manifesto section, insert:
```html
<section class="wrap">
  <p class="mono-label">Cosa capisci con Aether</p>
  <h2>Gli agenti, smontati</h2>
  <div class="concepts">
    <div class="card c1"><p class="mono-label c-disc">System Prompt</p><h3>Cosa riceve il modello</h3><p>Le istruzioni, il contesto e i tool che il modello riceve davvero — di solito invisibili. In Aether vedi il <em>system prompt assemblato</em> di ogni dispatch: capisci come il framing cambia le risposte.</p></div>
    <div class="card c2"><p class="mono-label c-manip">Tools · MCP</p><h3>Cosa può fare</h3><p>Le funzioni che l'agente può chiamare: filesystem, shell, qualunque server MCP. Le colleghi a 1 clic e vedi ogni tool call con il suo output, distinti dal resto: capisci <em>quando</em> e <em>perché</em> usa uno strumento.</p></div>
    <div class="card c3"><p class="mono-label c-cli">Skills &amp; agenti</p><h3>Come si compone</h3><p>Competenze e procedure riutilizzabili. Componi skill, sub-agent e swarm — c'è persino <code>skill-smith</code>, un agente che ti aiuta a scriverne di nuove. Capisci a strutturare capacità invece di ripetere prompt.</p></div>
    <div class="card c4"><p class="mono-label c-disc">Gate &amp; approvazioni</p><h3>Chi tiene il controllo</h3><p>Il controllo sulle azioni irreversibili. Metti i tool in auto o gate e approvi con la preview del diff: capisci a far correre l'agente senza perderne il controllo.</p></div>
  </div>
</section>
```

- [ ] **Step 3: Add the grid CSS**

Append to `style.css`:
```css
.concepts { display:grid; grid-template-columns:repeat(2,1fr); gap:1.1rem; margin-top:1.25rem; }
.concepts .card h3 { margin:.25rem 0 .5rem; font-size:1.08rem; }
.concepts .card::before { content:""; position:absolute; inset:0 0 auto 0; height:3px; }
.concepts .card.c1::before, .concepts .card.c4::before { background:var(--disclosure); box-shadow:0 0 22px -1px var(--disclosure); }
.concepts .card.c2::before { background:var(--manipulation); box-shadow:0 0 22px -1px var(--manipulation); }
.concepts .card.c3::before { background:var(--cli); box-shadow:0 0 22px -1px var(--cli); }
@media (max-width:720px){ .concepts { grid-template-columns:1fr; } }
```

- [ ] **Step 4: Verify + LIVE COPY CHECKPOINT**

Serve + screenshot. Expected: a 2×2 glass grid with coloured top edges; no palette-triplet section remains; console clean. **Show the screenshot to the user and refine the 4 cards' copy together before committing.**

- [ ] **Step 5: Commit**
```bash
git add site/index.html site/assets/style.css
git commit -m "content(site): 'Cosa capisci' concept grid; drop palette triplet"
```

---

## Task 3: "Lezioni dal campo" band

**Files:**
- Modify: `site/index.html` (new section after the concept grid)
- Modify: `site/assets/style.css` (`.lessons`)

- [ ] **Step 1: Add the band**

After the concept section:
```html
<section class="wrap">
  <p class="mono-label">Lezioni dal campo</p>
  <h2>Best practice, non teoria</h2>
  <ol class="lessons">
    <li><strong>Brainstorm prima del codice.</strong> Un piano concordato e guidato dai test batte l'intuizione — gli agenti di Aether stessi partono da questa regola.</li>
    <li><strong>Sub-agent isolati.</strong> Compito stretto, contesto stretto: il lavoro in parallelo è affidabile quando non c'è stato condiviso.</li>
    <li><strong>Gate prima di toccare il mondo.</strong> File, shell e git passano da un'approvazione con preview; l'agente è libero fino a lì.</li>
    <li><strong>Il contesto è una risorsa.</strong> Rooting per-workspace e tool mirati, invece di dare tutto a tutti.</li>
  </ol>
</section>
```

- [ ] **Step 2: Add CSS (quieter than the grid — reads as "notes")**
```css
.lessons { list-style:none; counter-reset:l; margin:1.25rem 0 0; padding:0; display:grid; gap:.9rem; }
.lessons li { counter-increment:l; position:relative; padding:.2rem 0 .2rem 2.6rem; color:var(--text-dim); max-width:70ch; }
.lessons li::before { content:counter(l,decimal-leading-zero); position:absolute; left:0; top:.15rem; font-family:var(--font-mono); font-size:.85rem; color:var(--text-faint); }
.lessons strong { color:#fff; }
```

- [ ] **Step 3: Verify + commit**

Serve + screenshot (expected: a numbered, quiet list; console clean).
```bash
git add site/index.html site/assets/style.css
git commit -m "content(site): 'Lezioni dal campo' best-practices band"
```

---

## Task 4: Re-tie screenshots to concepts + add skill-smith

**Files:**
- Create: `site/assets/img/detail-skill-smith.png` (from `docs/Skill-Smith.png`)
- Modify: `site/index.html` (Dettagli section; carousel/detail captions)

- [ ] **Step 1: Move the screenshot into the site assets**
```bash
git mv docs/Skill-Smith.png site/assets/img/detail-skill-smith.png 2>/dev/null || { mkdir -p site/assets/img; cp docs/Skill-Smith.png site/assets/img/detail-skill-smith.png; git add site/assets/img/detail-skill-smith.png; git rm --cached docs/Skill-Smith.png 2>/dev/null || true; }
```
(Note: `docs/Skill-Smith.png` is untracked, so a plain `cp` + `git add` on the destination is enough; leave the original in `docs/` if preferred.)

- [ ] **Step 2: Add the skill-smith detail figure**

In the `<div class="details">` grid, add as the first figure:
```html
<figure class="shot">
  <img src="assets/img/detail-skill-smith.png" alt="Editor del sub-agent skill-smith: nome, system instruction, modello, skill e tool" />
  <figcaption><span class="c-cli">Skills &amp; agenti</span>: <code>skill-smith</code> — un sub-agent che scrive skill con te. Ne vedi (e modifichi) la <span class="c-disc">system instruction</span>: sub-agent → system prompt → skill.</figcaption>
</figure>
```

- [ ] **Step 3: Re-tie the other captions to concepts**

Prefix the relevant carousel/detail captions with the concept they demonstrate (keep existing wording after): overview → "Tools"; reasoning + opus + detail-prompt → "System Prompt"/"Disclosure" (already); manip + detail-tools → "Gate & approvazioni"; detail-skills → "Skills & agenti"; detail-providers → "Tools/multi-provider". Keep it light — one concept word per caption.

- [ ] **Step 4: Verify + commit**

Serve + screenshot; check the new detail image loads (200) and captions read as evidence. 
```bash
git add site/index.html site/assets/img/detail-skill-smith.png
git commit -m "content(site): tie screenshots to concepts; add skill-smith detail"
```

---

## Task 5: Full verify + deploy

- [ ] **Step 1: Full browser pass**

Serve `site/`. Screenshot `index.html` (desktop + a narrow resize for mobile) and `install.html` (shared CSS unaffected). Confirm: no palette-triplet, new manifesto + concept grid + lessons + skill-smith, aurora/glass intact, **zero console errors**, images all 200.

- [ ] **Step 2: Deploy**
```bash
SITE_TREE=$(git rev-parse feat/pages-site:site)
COMMIT=$(git commit-tree "$SITE_TREE" -m "deploy: content redesign (education-first)")
git branch -f gh-pages "$COMMIT"
git push -f origin gh-pages
git push origin feat/pages-site
```

- [ ] **Step 3: Confirm live**

Poll `https://michelepolo.github.io/Aether/` until it serves "Cosa capisci" and `detail-skill-smith.png` returns 200.

---

## Self-review (esito)

- **Spec coverage:** hero tagline + manifesto (Task 1) ✓; concept grid replacing triplet (Task 2) ✓; lessons band (Task 3) ✓; skill-smith + caption re-tie (Task 4) ✓; deploy on locked branch via bypass (Task 5) ✓. Voice/motto/glass constraints carried in Global Constraints ✓.
- **Placeholders:** none — exact copy, HTML, and CSS are inline per step.
- **Consistency:** class names `.concepts`/`.card.c1..c4` and `.lessons` used identically in HTML (Task 2/3) and CSS (Task 2/3); image path `assets/img/detail-skill-smith.png` identical in Task 4 move + figure.
- **Live checkpoint:** Task 2 Step 4 pauses for user copy edits on the 4 cards before committing, per the user's request to edit them live.
