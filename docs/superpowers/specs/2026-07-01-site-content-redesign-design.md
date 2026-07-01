# Aether site — content & layout redesign (education-first)

**Status:** design approved 2026-07-01. Next: implementation plan (writing-plans).

## Goal

Reposition the presentation site (`site/` on `feat/pages-site`, live at
https://michelepolo.github.io/Aether/) from a poetic product pitch to a
**study/training tool for understanding how LLM agents actually work**. Keep the
existing glassmorphism design language; change the **content and information
architecture**. The current manifesto is strong but reads artificial (ether
metaphor + brochure superlatives) — replace it with a concrete, product-voice
manifesto and add a learning-oriented centerpiece.

## Positioning & voice

- **Audience:** people who work with AI and want to understand *how agents work*
  — System Prompt, Tools, Skills, Gates — rather than guess at prompts.
- **Motto kept, recontextualized to learning:** *Disclosure* = see how agents
  really work (to understand them); *Manipulation* = get hands-on, experiment,
  to learn.
- **Voice:** product voice — plain, concrete, second person ("tu"). No cosmic
  metaphors, no superlatives. Specific beats clever. (Italian, per the site.)

## Page structure (order)

1. **Hero** — brand image + headline (motto unchanged) + rewritten tagline.
2. **Manifesto** — ~4 concrete paragraphs (replaces the 8 flowery ones).
3. **"Cosa capisci con Aether"** — NEW centerpiece: a 4-card concept grid.
4. **"Lezioni dal campo"** — NEW band: 3–4 real best-practices.
5. **Aether dal vivo** (carousel) + **Dettagli** — kept; captions re-tied so each
   screenshot is *evidence for a concept*, not a showcase. Add `skill-smith`.
6. **Footer** — unchanged.
7. The old **"Spettro Invisibile" palette triplet** is REMOVED as a standalone
   section (its meaning is absorbed by the manifesto's Disclosure/Manipulation +
   the concept grid); the palette rationale survives only implicitly in the design.

## Copy — Hero tagline

> Uno studio local-first per vedere come lavorano davvero gli agenti LLM — e
> imparare mettendoci le mani.

(Headline stays: "Aether — Disclosure & Manipulation".)

## Copy — Manifesto (verbatim, approved)

> La maggior parte degli strumenti AI ti mostra la risposta e nasconde tutto il
> resto. Aether fa il contrario.
>
> È uno studio agentico **local-first** e **multi-provider** (Anthropic, OpenAI,
> Gemini, Ollama e endpoint compatibili), pensato per una cosa sola: **capire
> come lavora davvero un agente LLM** — e imparare usandolo.
>
> **Disclosure.** Di solito un agente è una scatola nera: vedi l'output, non il
> perché. Aether apre la scatola — il *system prompt assemblato* di ogni
> richiesta, il contesto, gli step di ragionamento, ogni tool call con il suo
> output, i token. Non indovini più cosa guida le risposte: lo osservi.
>
> **Manipulation.** Si capisce facendo. Breakpoint sui tool, gate con preview
> prima delle azioni irreversibili, iniezione di contesto, controllo dalla CLI.
> Cambi una variabile e vedi l'effetto: è così che si impara.
>
> Aether è per chi lavora con l'AI e vuole smettere di tirare a indovinare coi
> prompt — per capire *sul serio* System Prompt, Tools, Skills e Gate, e le best
> practice che emergono costruendo software agentico.

## Copy — "Cosa capisci con Aether" (4 cards: cos'è → in Aether)

1. **System Prompt** — Le istruzioni, il contesto e i tool che il modello riceve
   davvero, di solito invisibili. In Aether vedi il *system prompt assemblato* di
   ogni dispatch (context, subagent, dichiarazioni dei tool): capisci come il
   framing cambia le risposte.
2. **Tools (MCP)** — Le funzioni che l'agente può chiamare: filesystem, shell,
   qualunque server MCP. In Aether li colleghi a 1 clic e vedi ogni tool call con
   il suo output, distinti dal resto: capisci *quando* e *perché* l'agente usa uno
   strumento.
3. **Skills & agenti** — Competenze e procedure riutilizzabili che estendono
   l'agente. In Aether componi skill, sub-agent e swarm — c'è persino
   `skill-smith`, un agente che ti aiuta a scriverne di nuove. Capisci a
   strutturare capacità invece di ripetere prompt.
4. **Gate & approvazioni** — Il controllo sulle azioni irreversibili. In Aether
   metti i tool in auto o gate, approvi con la preview del diff (timeout 24h):
   capisci a far correre l'agente senza perderne il controllo.

Layout: reuse the existing `.triplet`→ now a 4-up grid (`.card` glass, colored
top-edge glow reusing disclosure/manip/cli hues cycled across the 4 cards).

## Copy — "Lezioni dal campo" (best-practices band, 3–4)

Real lessons from building Aether (and dev in general), each one thing Aether
itself embodies:

- **Brainstorm prima del codice.** Un piano concordato e guidato dai test batte
  l'intuizione — gli agenti di Aether stessi partono da questa regola.
- **Sub-agent isolati.** Compito stretto, contesto stretto: il lavoro in
  parallelo è affidabile quando non c'è stato condiviso.
- **Gate prima di toccare il mondo.** File, shell e git passano da
  un'approvazione con preview; l'agente è libero fino a lì.
- **Il contesto è una risorsa.** Rooting per-workspace e tool mirati invece di
  dare tutto a tutti.

Layout: a distinct band (not glass cards) — e.g. a stacked list with mono
eyebrows, quieter than the concept grid so it reads as "notes," not features.

## Screenshots — re-tie to concepts

- Carousel + Details keep the existing images; **rewrite captions** so each names
  the concept it demonstrates (System Prompt / Tools / Skills / Gate).
- **Add** `skill-smith`: move `docs/Skill-Smith.png` → `site/assets/img/detail-skill-smith.png`
  and place it in **Dettagli** (portrait ~340px crop, matching the other detail
  panels), tied to **Skills & agenti** — caption links sub-agent → system
  instruction → skill (it doubles as a System-Prompt disclosure example).

## Non-goals

- No change to the glassmorphism design language (colors, glass, aurora) beyond
  what the new sections need.
- No new site pages; `install.html` content unchanged (only shares the CSS).
- No code/app changes — this is the static presentation site only.

## Files touched

- `site/index.html` — hero tagline, manifesto, new concept grid, new lessons band,
  remove palette-triplet section, re-tie captions, add skill-smith detail.
- `site/assets/style.css` — styles for the 4-up concept grid and the lessons band
  (reusing existing tokens/glass; keep code blocks solid — N/A here).
- `site/assets/img/detail-skill-smith.png` — new (from `docs/Skill-Smith.png`).
- Redeploy: rebuild orphan `gh-pages` from `site/` (admin-only ruleset — owner
  bypass), enable/confirm live.
