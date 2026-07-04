# Site i18n — language selector + English translation

**Date:** 2026-07-04
**Branch:** `feat/pages-site-i18n` (off `feat/pages-site`)
**Status:** design approved

## Goal

The Aether minisite (published to GitHub Pages from `site/`, mirrored to the
`gh-pages` branch root) is currently Italian-only. Add a language selector — the
classic flag combobox — to the top nav, and prepare a full English version.
Selecting the UK flag switches to the English site; selecting the Italian flag
switches back. Page context is preserved across the switch (install page stays
on the install page).

## Constraints

- **Static, no build step, no framework.** Vanilla HTML/CSS/JS. No bundler,
  no third-party i18n library, no server-side negotiation.
- **Cross-platform.** The user runs on Windows/macOS/Linux. Flag *emoji* do not
  render on Windows (no flag glyphs), so flags MUST be inline SVG.
- **Graceful degradation.** The site already degrades without JS (tabs,
  carousel). The language selector must too.
- **Preserve existing URLs.** Italian stays at the existing root paths; no
  redirects, no renaming of current pages.

## Chosen approach: separate localized pages

Italian remains the default at the root. English lives in a sibling `en/`
folder. The selector is a set of plain `<a href>` links that navigate between
the two language twins of the current page.

Rejected alternative — runtime JS string-swap: would require re-keying the
markup-dense hand-authored HTML into a flat dictionary (losing inline
`<span class="c-disc">`, `<code>`, `<em>` structure), needs JS for English to
appear at all (flash of Italian), and is fragile. Duplication of two rarely
changing marketing pages is the honest, standard trade-off for a static
multilingual site.

## File structure

```
site/
  index.html            IT  (lang="it")  — existing content + selector in nav
  install.html          IT  (lang="it")  — existing content + selector in nav
  en/
    index.html          EN  (lang="en")  — full translation of index.html
    install.html        EN  (lang="en")  — full translation of install.html
  assets/
    style.css           shared  (+ selector styles)
    main.js             shared  (+ language-aware UI strings + selector JS)
    img/                shared, unchanged
  .nojekyll             unchanged
```

`en/` pages reference shared assets via `../assets/...` and `../assets/img/...`.

## The language selector

A compact dropdown appended to the `.nav .links` group on **all four pages**,
built on native `<details>`/`<summary>` so it works without JS.

- `<summary>`: current-language inline-SVG flag + 2-letter code (`IT` / `EN`),
  plus a caret. Styled to match the frosted-glass theme.
- Menu: two `<a href>` options, each `flag + language name`:
  - `🇮🇹 Italiano` → the Italian twin of the current page
  - `🇬🇧 English`  → the English twin of the current page
- The current language option is marked with `aria-current="true"` and a
  checkmark; its link targets the current page (harmless no-op).
- Flags are inline SVG (Italian tricolore; UK Union Jack), ~16×12px, rounded.

### Cross-link map

| Current page        | 🇮🇹 Italiano →      | 🇬🇧 English →       |
|---------------------|--------------------|--------------------|
| `index.html`        | `index.html`       | `en/index.html`    |
| `install.html`      | `install.html`     | `en/install.html`  |
| `en/index.html`     | `../index.html`    | `index.html`       |
| `en/install.html`   | `../install.html`  | `install.html`     |

### Accessibility

- `<details>` is keyboard-operable natively.
- The selector gets an accessible name (e.g. `aria-label="Language / Lingua"`).
- Current language marked via `aria-current`.

## Internal links & metadata in `en/` pages

- `<html lang="en">`.
- Nav/footer internal links resolve **within `en/`**: e.g. English nav
  "Install" → `install.html` (relative to `en/`), "Manifesto" →
  `index.html#manifesto`. GitHub and Blog links are unchanged absolute URLs.
- `<title>`, `<meta name="description">`, and OG tags translated to English;
  `og:image` path becomes `../assets/img/hero.png`.
- Each page (all four) gets `hreflang` alternates in `<head>`:
  ```html
  <link rel="alternate" hreflang="it" href="…/index.html" />
  <link rel="alternate" hreflang="en" href="…/en/index.html" />
  <link rel="alternate" hreflang="x-default" href="…/index.html" />
  ```
  Using relative hrefs consistent across the pair.

## Shared `main.js` becomes language-aware

`main.js` currently hardcodes Italian UI strings not present in the HTML:
- copy button: `'copia'`, `'copiato ✓'`, `'copia a mano'`
- carousel dot aria-label: `'Vai alla slide N'`

Add a small string table keyed by language, selected from
`document.documentElement.lang` (`'en'` → English, otherwise Italian):

```js
const L = (document.documentElement.lang || 'it').slice(0, 2);
const T = {
  it: { copy: 'copia', copied: 'copiato ✓', copyManual: 'copia a mano', slide: 'Vai alla slide ' },
  en: { copy: 'copy',   copied: 'copied ✓',  copyManual: 'copy manually', slide: 'Go to slide ' },
}[L === 'en' ? 'en' : 'it'];
```

The carousel prev/next aria-labels (`Precedente`/`Successivo`) live in the HTML,
so they are translated per-page in the English HTML, not in JS.

New selector JS enhancement (progressive): close the open `<details>` on
outside-click and after a selection. Guarded so absence of the element is a
no-op; site still works if JS fails.

## Translation guidance

- Full, natural English — not literal.
- Brand tagline **Disclosure & Manipulation** stays as-is (already English).
- Technical terms stay in established form: system prompt, tool call, gate,
  breakpoint, MCP, sub-agent, swarm, dispatch, workspace, provider names.
- `skill-smith` stays literal.
- Idiom `L'appetito vien mangiando` → `Appetite comes with eating.`
- Node prerequisite, commands, code blocks: unchanged (code is language-neutral;
  only surrounding prose translates).

## Deployment

`gh-pages` mirrors `site/` at the root; the publish/copy step recurses into
subfolders, so `en/` lands at `<pages-url>/en/` with no workflow change.
Publishing is deferred until 0.1.15 (per project notes); this work lands on the
branch and ships when the site is next published.

## Out of scope (YAGNI)

- No localStorage persistence of language choice.
- No geo/Accept-Language auto-detection or redirects.
- No build tooling or i18n framework.
- No additional languages beyond IT/EN.

## Success criteria

1. All four pages render correctly; IT pages unchanged in content aside from the
   new selector.
2. Selector appears in the nav on every page, shows the current language, and
   switches to the correct twin page (same page, other language).
3. Flags render identically on Windows/macOS/Linux (inline SVG).
4. Selector is usable via keyboard and works without JS (native `<details>`).
5. Copy/carousel UI strings appear in English on `en/` pages.
6. English translation reads naturally; no leftover Italian in `en/` prose.
7. `hreflang` alternates present and correct on all pages.
