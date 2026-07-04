# Spec — Web UI remediation

**Date:** 2026-07-03
**Branch:** `feat/web-ui-remediation`
**Source:** modern-web-guidance audit of the Aether React SPA (`src/`), 2026-07-03 — 5 axes (readability/theming, accessibility/dialogs, forms, INP/perf) + 2 functional bugs.

## Goal

Remediate the web UI audit in one phased effort. **Priority: sidebar/app text readability** — the two most-used muted-gray tiers fail WCAG contrast on the near-black surfaces. Lift them to WCAG AA (4.5:1) while preserving the Aether aesthetic (layered-gray hierarchy, mono uppercase tracked labels, spectral accent hues, dark zinc surfaces, glass). Then address the theming, accessibility, forms, and performance findings, plus two real functional bugs.

A live dev instance (`npm run dev`, http://localhost:3000, HMR on) is used to visually verify the readability/theming changes as they land.

## Global constraints

- `npm run lint` (`tsc --noEmit`) MUST stay green — it is the only lint step.
- Tailwind CSS v4; theme tokens live in `src/styles/theme.css` (`@theme` block); shared classes in `src/styles/components.css`.
- `@/*` imports from repo root; tests colocated `*.test.ts(x)`; Vitest **frontend** project = jsdom, globals on; avoid `.ts`/`.tsx` basename collisions.
- **Preserve the Aether feeling:** never change the accent hues (`--color-disclosure` #B388FF, `--color-manipulation` #FF6D00, `--color-cli` #00E676) or the dark zinc surface scale; keep mono uppercase tracked labels; the gray hierarchy stays 3-tiered — only its luminance floor rises.
- Commit trailer: `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.
- Work on `feat/web-ui-remediation` (branched from `main` @ 0.1.21+).

## Decisions

- **[D1] Semantic text tokens over raw-class edits.** Introduce `--color-text-*` tokens in `@theme` and migrate low-contrast usages to them, rather than remapping raw `zinc-*` classes in place. Rationale: one source of truth, AA guaranteed by construction, extensible app-wide. Rejected: scattered raw remap (no reuse, drifts).
- **[D2] Strict WCAG AA (4.5:1)** for all body/label text, measured against the **darkest surface a token appears on** (`#09090B`). No "large text 3:1" exceptions — the small 10px mono labels are the main offenders and must clear 4.5:1.
- **[D3] Muted floor = `#8b8b93`.** The dimmest still-readable tier: 5.2:1 on `#18181B`, 5.9:1 on `#09090B`. Replaces the unreadable `zinc-600` (#52525b, 2.29:1). Preserves a muted feel with AA margin.
- **[D4] Fonts:** the `"Inter"`/`"JetBrains Mono"` token names are referenced but never loaded (no `@font-face`/link) — every render falls back to `system-ui`/`monospace`. **Decision: self-host both** (`font-display: swap`, via a fontsource package or local `@font-face`) so the intended type identity actually renders. (If self-hosting proves heavy in the plan, the fallback is to drop the unused names — flagged for the plan.)

## Text-token system (Workstream R core)

Add to `src/styles/theme.css` `@theme`:

```css
  /* Text scale — AA (>=4.5:1) on the darkest surface (#09090B) it appears on.
     Preserves the 3-tier layered-gray hierarchy; only the muted floor rises. */
  --color-text-primary:   #f4f4f5; /* zinc-100  ~16:1  headings / active / emphasis */
  --color-text-secondary: #d4d4d8; /* zinc-300  ~12:1  body copy */
  --color-text-tertiary:  #a1a1aa; /* zinc-400  ~6.9:1 labels, meta, mono-label */
  --color-text-muted:     #8b8b93; /* custom    ~5.2:1 dimmest still-readable tier */
```

Then:
- `src/styles/components.css:11` `.mono-label` → `text-[color:var(--color-text-tertiary)]` (from `text-zinc-500`).
- Migrate sidebar usages: `text-zinc-600` (31×) → the muted token (or the tertiary token where it's a real label); small `text-zinc-500` → the tertiary token. Leave `zinc-300`/`400`/`200` (already AA).
- **Utility naming (plan decides the exact mechanism):** Tailwind v4 turns `--color-text-muted` into the utility `text-text-muted` (prefix `text-` + color name `text-muted`), which is awkward. Options: (a) name the tokens with a non-colliding prefix — e.g. `--color-fg-strong/-/-dim/-faint` → clean `text-fg-*` utilities; or (b) keep `--color-text-*` and apply via the CSS variable in `components.css` (`.mono-label { color: var(--color-text-tertiary) }`) + arbitrary values `text-[var(--color-text-muted)]` in TSX. Recommended: option (a) `--color-fg-*` for clean utilities. The four values in the token block above are fixed regardless of the chosen names.
- The migration is **mechanical per class**, but each changed element must be eyeballed on the live instance to confirm it reads as intended (not just "lighter").

**AA regression guard:** add a small unit test asserting each `--color-text-*` value meets ≥4.5:1 against `#09090B` and `#18181B` (pure contrast math; catches a future token edit that dips below AA).

## Workstreams & findings

### R · Readability & theming (priority)
- **R1** Text tokens + sidebar migration + `.mono-label` (above). [D1/D2/D3]
- **R2** `index.html:6` — add `<meta name="color-scheme" content="dark">` (prevents light-canvas flash before CSS loads; `color-scheme:dark` already set in `src/index.css`).
- **R3** `src/styles/components.css:44` — promote `scrollbar-width: thin` + `scrollbar-color` to `:root` so all ~19 scroll containers get the thin themed scrollbar on Firefox/Safari (currently WebKit-only globally); keep the WebKit block behind `@supports not (scrollbar-color: auto)`, matching `.chat-scroll`.
- **R4** `src/styles/components.css:22` — add `@media (prefers-reduced-transparency: reduce) { .glass { background: var(--color-surface-2); backdrop-filter: none; } }`.
- **R5** Guard looping animations with `prefers-reduced-motion`: `StatusDot.tsx:10` (pulse), `StreamingIndicator.tsx:5` (pulse), `SidebarGroups.tsx:105` + git spinners (`GitSwimlanesView.tsx:88,108`, `GitDiffPanel.tsx:87`, `ChangesView.tsx:109`) (spin). Prefer Tailwind `motion-safe:`/`motion-reduce:` variants, or a blanket `@media (prefers-reduced-motion: reduce) { .animate-spin, .animate-pulse { animation: none } }`.
- **R6** `:root { accent-color: var(--color-disclosure); }` so native checkboxes render brand-purple.
- **R7** `forced-colors` differentiators: `StatusDot` states differ by color only (+glow on `online`) → add a shape/`outline`/icon differentiator under `@media (forced-colors: active)`; `.glow-manip`/`.glow-disc` hover uses `box-shadow` (stripped in forced-colors) → add an `outline` hover under forced-colors.
- **R8** Fonts per [D4].

### B · Functional bugs (fast, high-impact)
- **B1** Dropped attachment errors — `src/stores/chat.store.ts:205,219,225` set `error` (too-many / unsupported-type / >10MB) but **no component reads it**. Render `useChatStore(s => s.error)` near the composer (`MessageInput.tsx`) in a `role="alert"` region; clear on next successful queue/submit.
- (Modal focus-restore bug is B-class but lives in Workstream A since it's the dialog infra.)

### A · Accessibility & dialogs
- **A1 [functional bug]** `src/components/ui/Modal.tsx:81,71` — backdrop-click and the Esc fallback call `onClose()` directly; focus-restore + overflow reset live only in the native `close` handler (`:53-63`). For unmount-based dialogs (all `DialogHost` prompts/confirms, `AttachmentLightbox`) the component unmounts before `dialog.close()` fires → focus never restored; for toggle-based (`ProfilesModal`) `onClose()` fires twice → `useDialog` can double-`dequeue` and drop the next dialog. Fix: backdrop/Esc call `dialogRef.current?.close()` only; the single `close` listener owns `onClose()`+restore. Make `useDialog` `resolve`/`cancel` idempotent as defense-in-depth.
- **A2** Streaming live-region spam: `LiveThinkingBlock.tsx:8` (`aria-live` on token stream), `MessageList.tsx:32` (`role="log"` + redundant `aria-live`, re-announces growing text), `MessageInput.tsx:204` (token-count chip). Fix: drop redundant `aria-live` on `role=log`; set the actively-streaming bubble to `aria-live="off"` and emit one polite "response complete" at finalize; remove/`off` the thinking + token-count live regions (ambient info), optionally a low-frequency "Assistant is thinking…" status.
- **A3** `@mention` combobox: `MessageInput.tsx` textarea + `MentionPopover.tsx` — add `role="combobox"`, `aria-expanded`, `aria-controls`, `aria-autocomplete="list"`, and `aria-activedescendant` tracking the highlighted option id.
- **A4** `AttachmentLightbox.tsx:53` — pass a `title`/`aria-label` (e.g. filename) so the dialog has an accessible name.
- **A5** `aria-labelledby` over duplicated `aria-label` where a visible title exists (`Modal.tsx:89`, `KeyVaultModal.tsx:144`); consider a heading for the Modal title bar.
- **A6** Adopt declarative `closedby="any"` on the `<dialog>` with the manual mousedown/keydown fallback gated behind `!('closedBy' in HTMLDialogElement.prototype)`.

### F · Forms & validation
- **F1** `src/components/ui/PromptDialog.tsx` (shared primitive behind most add/rename flows) — replace custom `required && !value.trim()` with native `required`, `:user-invalid` styling, `aria-invalid` synced after interaction (blur/input), an error node via `aria-describedby`, and an upfront required marker. Applies the `validate-input-after-interaction` + `accessible-error-announcement` + `required-field-feedback` guides.
- **F2** `KeyVaultModal.tsx:144` — `autocomplete="off"` on the secret input (both password and revealed-text modes) so password managers don't offer to save it.
- **F3** Real labels where placeholders are the sole visible label (`SwarmEditModal.tsx:42`, `ScheduleEditModal.tsx` fields, `MessageInput.tsx` textarea `aria-label`/`<label>`).

### P · Performance / INP
- **P1** `src/components/chat/MessageBubble.tsx` — wrap in `React.memo` (props already stable via `useCallback` in `ChatView`). Kills (N-1) unnecessary bubble re-renders per streamed chunk.
- **P2** `src/stores/chat.store.ts` — normalize to `messagesById: Record<string, Message>` alongside the ordered id array; `MessageBubble` selects `s.messagesById[id]` (O(1)); `appendChunk` becomes an O(1) object replace. Eliminates the O(N²)-per-chunk selector scans.
- **P3** `src/components/reasoning/ReasoningDrawer.tsx:13` — early-return `null` (or skip heavy selectors) when `!open`; replace `[...messages].reverse().find(...)` with a store-maintained `lastModelMessageId`.
- **P4** `ReasoningDrawer` step list / `ReasoningStepCard` — apply `content-visibility: auto` + `contain-intrinsic-size` (mirror `MessageList.tsx:40`).
- **P5** `src/hooks/useAutoScroll.ts:22` — rAF-batch the `scrollTop` write so bursty streams cause at most one forced reflow per frame.

## Testing strategy

Vitest **frontend** (jsdom), TDD where behavior is observable:
- **R1** contrast-math unit test: every `--color-text-*` ≥4.5:1 vs `#09090B` and `#18181B`. Migration itself verified live (visual).
- **B1** rendering the composer with a queued oversized attachment shows the error text in a `role="alert"`.
- **A1** opening then Esc/backdrop-dismissing a `DialogHost`-mounted dialog restores focus to the trigger; `useDialog` doesn't drop the next queued dialog (no double-dequeue).
- **A2** the streaming bubble carries `aria-live="off"`; a single completion announcement is emitted.
- **F1** required field: no eager error before interaction; `aria-invalid=true` + announced error after blur when empty.
- **P1** render-count test: appending a chunk to the streaming message does not re-render sibling `MessageBubble`s (React Testing Library render spy / `React.Profiler` or a memo-equality assertion).
- Theming visual items (R2–R8, A4–A6, F2–F3) verified on the live instance + build/type-check; where a DOM attribute is assertable (color-scheme meta, `autocomplete`, `aria-*`, `closedby`) add a light assertion.

## Phasing

1. **R** — Readability & theming (tokens + sidebar migration first; watch live).
2. **B** — Dropped attachment errors.
3. **A** — Accessibility & dialogs (Modal focus bug leads).
4. **F** — Forms & validation.
5. **P** — Performance / INP.

Readability + the two functional bugs (B1, A1) land first for the biggest visible/UX wins.

## Out of scope

- The marketing `site/` (separate static site, reviewed earlier).
- Light theme / theme toggle (app is deliberately dark-only).
- Restructuring the store beyond the `messagesById` normalization P2 needs.
- New features; any refactor beyond what a listed finding requires.
