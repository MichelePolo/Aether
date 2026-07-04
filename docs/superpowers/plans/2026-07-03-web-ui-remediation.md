# Web UI Remediation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remediate the Aether web-UI audit — lift muted text to WCAG AA (readability priority), fix theming/a11y/forms/perf gaps, and two functional bugs — while preserving the Aether aesthetic.

**Architecture:** React 19 SPA + Tailwind CSS v4. Theme tokens in `src/styles/theme.css` (`@theme`), shared classes in `src/styles/components.css`, global bits in `src/index.css`. Semantic text tokens replace low-contrast raw `zinc-*` usages. Native `<dialog>` via `src/components/ui/Modal.tsx`. Zustand stores.

**Tech Stack:** TypeScript strict (`tsc --noEmit` = lint), Vitest **frontend** project (jsdom, globals on), React Testing Library, Tailwind v4.

**Spec:** `docs/superpowers/specs/2026-07-03-web-ui-remediation-design.md`

## Global Constraints

- `npm run lint` (`tsc --noEmit`) MUST stay green — the only lint step.
- Tailwind v4: colors declared as `--color-<name>` in `@theme` generate `text-<name>`/`bg-<name>`/`border-<name>` utilities.
- **Preserve the Aether feeling:** NEVER change accent hues (`--color-disclosure` #B388FF, `--color-manipulation` #FF6D00, `--color-cli` #00E676) or the zinc surface scale; keep mono uppercase tracked labels; the gray hierarchy stays 3-tiered, only its luminance floor rises.
- Text-contrast target: **WCAG AA ≥ 4.5:1** measured against the darkest surface a token appears on (`#09090B`).
- `@/*` imports from repo root; tests colocated `*.test.ts(x)`; avoid `.ts`/`.tsx` basename collisions; frontend project = jsdom.
- Commit trailer: `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.
- Branch: `feat/web-ui-remediation`. Live instance for visual checks: `npm run dev` → http://localhost:3000 (HMR on).

## Text-token values (fixed — used across Phase R)

```
--color-fg-strong  #f4f4f5   headings / active / emphasis   (~16:1)
--color-fg-base    #d4d4d8   body copy                      (~12:1)
--color-fg-dim     #a1a1aa   labels / meta / mono-label     (~6.9:1)
--color-fg-faint   #8b8b93   dimmest still-readable tier    (~5.2:1 on #18181B, ~5.9:1 on #09090B)
```

---

## Phase R — Readability & theming

### Task 1: Semantic text tokens + AA guard + sidebar migration (R1)

**Files:**
- Modify: `src/styles/theme.css` (add fg tokens to `@theme`)
- Modify: `src/styles/components.css:11` (`.mono-label`)
- Modify: all files under `src/components/sidebar/**` using `text-zinc-600` / small `text-zinc-500`
- Create: `src/styles/text-contrast.test.ts`

**Interfaces:**
- Produces: Tailwind utilities `text-fg-strong` / `text-fg-base` / `text-fg-dim` / `text-fg-faint`.

- [ ] **Step 1: Write the failing AA test** — `src/styles/text-contrast.test.ts`

```ts
import fs from 'node:fs';
import path from 'node:path';

// Pull the --color-fg-* values straight from the theme so this guards the real CSS.
function readFgTokens(): Record<string, string> {
  const css = fs.readFileSync(path.resolve(__dirname, 'theme.css'), 'utf8');
  const out: Record<string, string> = {};
  for (const m of css.matchAll(/--color-(fg-[a-z]+):\s*(#[0-9a-fA-F]{6})/g)) out[m[1]] = m[2];
  return out;
}
function lum(hex: string): number {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const f = (v: number) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
  const [r, g, b] = c.map(f);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function ratio(fg: string, bg: string): number {
  const a = lum(fg), b = lum(bg);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

describe('text tokens meet WCAG AA on the dark surfaces', () => {
  const tokens = readFgTokens();
  it('defines all four fg tiers', () => {
    expect(Object.keys(tokens).sort()).toEqual(['fg-base', 'fg-dim', 'fg-faint', 'fg-strong']);
  });
  for (const bg of ['#09090B', '#18181B']) {
    it(`each fg token is >= 4.5:1 on ${bg}`, () => {
      for (const [name, hex] of Object.entries(tokens)) {
        expect(ratio(hex, bg), `${name} (${hex}) on ${bg}`).toBeGreaterThanOrEqual(4.5);
      }
    });
  }
});
```

- [ ] **Step 2: Run it, verify it fails** — `npx vitest run --project frontend src/styles/text-contrast.test.ts` → FAIL ("defines all four fg tiers" — tokens absent).

- [ ] **Step 3: Add the tokens** — in `src/styles/theme.css`, inside `@theme`, after the `--color-disclosure`/`--color-manipulation`/`--color-cli` block:

```css
  /* Text scale — AA (>=4.5:1) on the darkest surface (#09090B). Preserves the
     3-tier layered-gray hierarchy; only the muted floor rises above zinc-600. */
  --color-fg-strong: #f4f4f5; /* headings / active / emphasis */
  --color-fg-base:   #d4d4d8; /* body copy */
  --color-fg-dim:    #a1a1aa; /* labels / meta / mono-label */
  --color-fg-faint:  #8b8b93; /* dimmest still-readable tier (was zinc-600) */
```

- [ ] **Step 4: Run it, verify it passes** — `npx vitest run --project frontend src/styles/text-contrast.test.ts` → PASS.

- [ ] **Step 5: Repoint `.mono-label`** — `src/styles/components.css:11`:

```css
  .mono-label   { @apply font-mono text-[10px] uppercase tracking-widest text-fg-dim; }
```

- [ ] **Step 6: Migrate the sidebar's failing grays.** In every file under `src/components/sidebar/`, replace low-contrast text classes per this mapping (leave `zinc-200/300/400` — already AA):
  - `text-zinc-600` → `text-fg-faint` (secondary/decorative meta) **or** `text-fg-dim` when it labels an actionable/important element — use judgment per element.
  - `text-zinc-500` used on small/`text-[10px]`/`text-xs` text → `text-fg-dim`.
  Find them with: `grep -rn "text-zinc-600\|text-zinc-500" src/components/sidebar/`. Example (`SidebarGroups.tsx`): `className="text-[10px] text-zinc-600"` → `className="text-[10px] text-fg-faint"`.

- [ ] **Step 7: Verify live + lint** — `npm run lint` clean; on http://localhost:3000 open the sidebar and confirm the section labels, workspace/session meta, and counts are comfortably legible (no longer near-invisible gray), and the layered hierarchy still reads (strong > base > dim > faint). Adjust any element that reads too flat by choosing `fg-dim` vs `fg-faint`.

- [ ] **Step 8: Commit**

```bash
git add src/styles/theme.css src/styles/components.css src/styles/text-contrast.test.ts src/components/sidebar
git commit -m "feat(theme): AA text-contrast tokens; lift sidebar muted grays to readable floor"
```

### Task 2: Global theming CSS — color-scheme meta, root scrollbar, reduced-transparency, accent-color (R2/R3/R4/R6)

**Files:** Modify `index.html` (head), `src/styles/components.css` (global scrollbar + glass), `src/index.css` (`:root`).

- [ ] **Step 1: color-scheme meta** — `index.html`, after the `theme-color` meta:

```html
    <meta name="color-scheme" content="dark" />
```

- [ ] **Step 2: Promote the global scrollbar to standard properties** — in `src/styles/components.css`, replace the `/* Custom scrollbar (global, subtle) */` block (the four bare `::-webkit-scrollbar` rules) with:

```css
/* Custom scrollbar (global, subtle) — standard properties first so Firefox/Safari
   get the thin themed scrollbar too; WebKit pseudo-elements as a legacy fallback. */
:root { scrollbar-width: thin; scrollbar-color: var(--color-border-default) transparent; }
@supports not (scrollbar-color: auto) {
  ::-webkit-scrollbar { width: 4px; }
  ::-webkit-scrollbar-track { background: transparent; }
  ::-webkit-scrollbar-thumb { background: var(--color-border-default); border-radius: 4px; }
  ::-webkit-scrollbar-thumb:hover { background: #444; }
}
```

- [ ] **Step 3: prefers-reduced-transparency for glass** — in `src/styles/components.css`, right after the `.glass` `@supports` block:

```css
  /* Respect the user preference (not just support): opaque surface when the OS
     asks to reduce transparency, even where backdrop-filter is supported. */
  @media (prefers-reduced-transparency: reduce) {
    .glass { background: var(--color-surface-2) !important; backdrop-filter: none; }
  }
```

- [ ] **Step 4: accent-color** — `src/index.css`, extend the `:root` block:

```css
:root {
  color-scheme: dark;
  accent-color: var(--color-disclosure);
}
```

- [ ] **Step 5: Verify** — `npm run lint` clean; `npm run build` succeeds; live: native checkboxes (e.g. `ApprovalGate`, `McpToolCard`) render brand-purple; toggle OS "reduce transparency" and confirm bars/modals go opaque. Add a DOM assertion test only if a `*.test` already covers `index.html`/CSS (otherwise visual + build suffice).

- [ ] **Step 6: Commit**

```bash
git add index.html src/styles/components.css src/index.css
git commit -m "fix(theme): color-scheme meta, app-wide standard scrollbar, reduced-transparency glass, brand accent-color"
```

### Task 3: prefers-reduced-motion for looping animations (R5)

**Files:** Modify `src/components/ui/StatusDot.tsx`, `src/components/chat/StreamingIndicator.tsx`, `src/components/sidebar/SidebarGroups.tsx`, `src/components/git/GitSwimlanesView.tsx`, `src/components/git/GitDiffPanel.tsx`, `src/components/git/ChangesView.tsx`. (Blanket CSS fallback in `src/styles/components.css`.)

- [ ] **Step 1: Add a blanket guard** — in `src/styles/components.css`, at the end of the `@layer components { … }` block's sibling area (top level, near the glow reduced-motion rule):

```css
/* Looping, non-essential animations must stop when the user asks for reduced motion. */
@media (prefers-reduced-motion: reduce) {
  .animate-spin, .animate-pulse { animation: none; }
}
```

- [ ] **Step 2: (Optional, preferred) swap raw utilities to motion-safe variants** for the spinner/pulse sites so reduced-motion users still get a static affordance. Read each file and change e.g. `animate-spin` → `motion-safe:animate-spin` on: `StatusDot.tsx:10` (`animate-pulse` for `connecting`), `StreamingIndicator.tsx:5` (`animate-pulse`), `SidebarGroups.tsx:105` (`animate-spin`), `GitSwimlanesView.tsx:88,108`, `GitDiffPanel.tsx:87`, `ChangesView.tsx:109` (`animate-spin`). The Step-1 blanket rule already covers correctness; this step is polish (keeps opacity/state visible without motion).

- [ ] **Step 3: Verify** — `npm run lint` clean; live with OS reduced-motion on: spinners/pulses stop animating (no infinite motion), state still legible.

- [ ] **Step 4: Commit**

```bash
git add src/styles/components.css src/components/ui/StatusDot.tsx src/components/chat/StreamingIndicator.tsx src/components/sidebar/SidebarGroups.tsx src/components/git
git commit -m "fix(a11y): stop looping spin/pulse animations under prefers-reduced-motion"
```

### Task 4: forced-colors differentiators (R7)

**Files:** Modify `src/components/ui/StatusDot.tsx`, `src/styles/components.css`.

- [ ] **Step 1: Status differentiation beyond color.** Read `src/components/ui/StatusDot.tsx`. Under `@media (forced-colors: active)` the color+glow that distinguishes online/offline/connecting/error collapses. Give each state a non-color cue: add a per-status CSS class (e.g. `data-status="online"`) and, in `components.css`:

```css
@media (forced-colors: active) {
  /* Restore state distinction when system colors flatten backgrounds. */
  [data-status="online"]     { outline: 2px solid CanvasText; }
  [data-status="connecting"] { outline: 2px dotted CanvasText; }
  [data-status="error"]      { outline: 2px double CanvasText; }
  [data-status="offline"]    { outline: 1px solid GrayText; }
  /* Hover feedback (box-shadow is stripped in forced-colors). */
  .glow-manip:hover, .glow-disc:hover { outline: 2px solid Highlight; box-shadow: none; }
}
```

  Add `data-status={status}` to the `StatusDot` root element so the selectors match.

- [ ] **Step 2: Verify** — `npm run lint` clean; if a Windows/high-contrast environment is available, confirm the four states differ; otherwise verify the DOM carries `data-status` and the CSS is present (build).

- [ ] **Step 3: Commit**

```bash
git add src/components/ui/StatusDot.tsx src/styles/components.css
git commit -m "fix(a11y): forced-colors differentiators for StatusDot states and glow hover"
```

### Task 5: Resolve dead font tokens (R8)

**Files:** Modify `src/styles/theme.css`; either add `@font-face`/a fontsource import (self-host) or drop the unused names.

- [ ] **Step 1: Decide + implement.** `--font-sans: "Inter", …` / `--font-mono: "JetBrains Mono", …` reference fonts that are never loaded (no `@font-face`, no link, no package). Per spec [D4], **self-host**: add the `@fontsource/inter` and `@fontsource/jetbrains-mono` packages (`npm i @fontsource/inter @fontsource/jetbrains-mono`), import their CSS (with `font-display: swap`) in `src/main.tsx` (or `src/index.css`), e.g. `import '@fontsource/inter/400.css'; import '@fontsource/inter/600.css'; import '@fontsource/jetbrains-mono/400.css'; import '@fontsource/jetbrains-mono/700.css';`. If adding deps is undesirable, INSTEAD delete the unused family names so the tokens read `--font-sans: system-ui, sans-serif;` / `--font-mono: ui-monospace, monospace;` (honest fallback). Pick one; note which in the commit.

- [ ] **Step 2: Verify** — `npm run lint` clean; `npm run build` succeeds; live: text renders in Inter/JetBrains (if self-hosted) with no FOUT flash of invisible text (swap). Confirm no network request to an external font host (self-hosted only).

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json src/main.tsx src/styles/theme.css
git commit -m "fix(theme): self-host Inter/JetBrains Mono (font-display:swap) so type tokens actually render"
```

---

## Phase B — Functional bug: dropped attachment errors

### Task 6: Surface chat attachment errors near the composer (B1)

**Files:** Modify `src/components/chat/MessageInput.tsx`; Test `src/components/chat/MessageInput.attachment-error.test.tsx`.

**Interfaces:**
- Consumes: `useChatStore` selector `s.error` (string | null), already set by `queueAttachments` (`chat.store.ts:205,219,225`).

- [ ] **Step 1: Write the failing test** — `src/components/chat/MessageInput.attachment-error.test.tsx`. Render `MessageInput`, seed the chat store with an error, assert it renders in a `role="alert"`.

```tsx
import { render, screen } from '@testing-library/react';
import { MessageInput } from './MessageInput';
import { useChatStore } from '@/src/stores/chat.store';

it('renders a queued attachment error in a role=alert region', () => {
  useChatStore.setState({ error: 'a.pdf is too large — total attachments must stay under 10 MB.' });
  render(<MessageInput />);
  const alert = screen.getByRole('alert');
  expect(alert).toHaveTextContent(/too large/i);
});
```

(If `MessageInput` needs props/providers to render, mirror the existing `MessageInput.test.tsx` harness.)

- [ ] **Step 2: Run it, verify it fails** — `npx vitest run --project frontend src/components/chat/MessageInput.attachment-error.test.tsx` → FAIL (no alert).

- [ ] **Step 3: Implement.** Read `MessageInput.tsx`. Add `const error = useChatStore((s) => s.error);` and render, just above the composer input row:

```tsx
{error && (
  <div role="alert" className="mb-1 px-2 py-1 rounded bg-status-error/15 text-status-error text-xs font-mono">
    {error}
  </div>
)}
```

Ensure the error clears on the next successful queue/submit: confirm `queueAttachments`/send path sets `error: null` on success (add `set({ error: null })` at the start of a successful queue if not already present — check `chat.store.ts`).

- [ ] **Step 4: Run it, verify it passes** — same command → PASS.

- [ ] **Step 5: Verify live** — drop 6 files / an oversized file / an unsupported type onto the composer; the error message appears and is announced.

- [ ] **Step 6: Commit**

```bash
git add src/components/chat/MessageInput.tsx src/components/chat/MessageInput.attachment-error.test.tsx
git commit -m "fix(chat): surface dropped attachment-cap errors in a role=alert region"
```

---

## Phase A — Accessibility & dialogs

### Task 7: Modal dismissal routes through dialog.close() (focus restore) + useDialog idempotence (A1)

**Files:** Modify `src/components/ui/Modal.tsx`, `src/hooks/useDialog.ts`; Test `src/components/ui/Modal.focus.test.tsx`.

- [ ] **Step 1: Write the failing test** — `src/components/ui/Modal.focus.test.tsx`: an unmount-based Modal restores focus to the trigger on Escape.

```tsx
import { useState } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Modal } from './Modal';

function Harness() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button onClick={() => setOpen(true)}>open</button>
      {open && <Modal open onClose={() => setOpen(false)} title="T"><p>body</p></Modal>}
    </>
  );
}

it('restores focus to the trigger after Escape (unmount-based dialog)', async () => {
  const user = userEvent.setup();
  render(<Harness />);
  const trigger = screen.getByRole('button', { name: 'open' });
  trigger.focus();
  await user.click(trigger);
  await user.keyboard('{Escape}');
  expect(trigger).toHaveFocus();
});
```

(jsdom implements `<dialog>` `close`/`showModal` in recent versions; if `showModal` is unsupported in the test env, the `setAttribute('open')` fallback path still fires the manual Escape handler — assert focus restore regardless.)

- [ ] **Step 2: Run it, verify it fails** — `npx vitest run --project frontend src/components/ui/Modal.focus.test.tsx` → FAIL (focus lost — Escape calls `onClose()`, component unmounts, `close` event never fires).

- [ ] **Step 3: Fix Modal** — `src/components/ui/Modal.tsx`: the manual Escape handler and backdrop handler must call `dialogRef.current?.close()` (which fires the native `close` event that already restores focus), NOT `onClose()` directly. Replace lines 68-72 (Escape) and 78-83 (backdrop):

```tsx
  // Manual Escape fallback: route through .close() so the single `close`
  // listener owns onClose()+focus restore (works for unmount-based dialogs too).
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        const d = dialogRef.current;
        if (d?.open) d.close();
        else onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const onBackdropMouseDown = (e: React.MouseEvent<HTMLDialogElement>) => {
    if (!dismissOnBackdrop) return;
    if (e.target === e.currentTarget) {
      const d = dialogRef.current;
      if (d?.open) d.close();
      else onClose();
    }
  };
```

(The native `close`-event handler at lines 50-63 stays as the single place that calls `onClose()` + restores focus.)

- [ ] **Step 4: Make useDialog idempotent (defense-in-depth)** — `src/hooks/useDialog.ts`: guard `resolve`/`cancel` so a double-fire can't `dequeue()` twice. In BOTH `prompt` and `confirm`, wrap with a `settled` flag:

```ts
      let settled = false;
      enqueue({
        kind: 'prompt', id, ...opts,
        resolve: (v) => { if (settled) return; settled = true; resolve(v); dequeue(); },
        cancel: () => { if (settled) return; settled = true; resolve(null); dequeue(); },
      });
```

(and the analogous change in `confirm`, resolving `false` in `cancel`).

- [ ] **Step 5: Run it, verify it passes** — Modal focus test → PASS; run `src/hooks/useDialog.test.ts` and any `Modal.test.tsx` → still green.

- [ ] **Step 6: Verify live** — open a prompt/confirm (e.g. rename a workspace), press Escape / click the backdrop; focus returns to the triggering control; queued dialogs don't get skipped.

- [ ] **Step 7: Commit**

```bash
git add src/components/ui/Modal.tsx src/hooks/useDialog.ts src/components/ui/Modal.focus.test.tsx
git commit -m "fix(a11y): route Modal Esc/backdrop through dialog.close() so focus is restored; make useDialog idempotent"
```

### Task 8: Debounce/exclude streaming text from live regions (A2)

**Files:** Modify `src/components/chat/MessageList.tsx`, `src/components/chat/MessageBubble.tsx` (or the streaming bubble wrapper), `src/components/reasoning/LiveThinkingBlock.tsx`, `src/components/chat/MessageInput.tsx` (token chip).

- [ ] **Step 1: Write the failing test** — in a new `src/components/chat/MessageList.live.test.tsx`: while a message is streaming, the container's `aria-live` is not re-announcing growing text — assert the actively-streaming bubble wrapper carries `aria-live="off"` (and the container keeps `role="log"` without a redundant `aria-live`).

```tsx
import { render } from '@testing-library/react';
import { MessageList } from './MessageList';
import { useChatStore } from '@/src/stores/chat.store';

it('marks the streaming bubble aria-live=off and drops redundant aria-live on the log', () => {
  const id = 'm1';
  useChatStore.setState({ messages: [{ id, role: 'model', text: 'partial', timestamp: 0 }], streamingId: id });
  const { container } = render(<MessageList onRetry={() => {}} />);
  const log = container.querySelector('[role="log"]')!;
  expect(log.getAttribute('aria-live')).toBeNull(); // role=log implies polite; explicit is redundant
  expect(container.querySelector('[aria-live="off"]')).not.toBeNull(); // streaming wrapper opts out
});
```

- [ ] **Step 2: Run it, verify it fails** — FAIL (container has explicit `aria-live="polite"`, no `off` wrapper).

- [ ] **Step 3: Implement** — in `MessageList.tsx`: remove the redundant `aria-live="polite"` on the `role="log"` container; add `aria-live={id === streamingId ? 'off' : undefined}` on each bubble wrapper `div` (select `streamingId` via `useChatStore((s) => s.streamingId)`). Emit one polite completion signal on finalize: a visually-hidden `<span role="status">` that gets "Response complete" set when streaming ends (wire off the store's `streamingId` transitioning to null — a small effect in `MessageList` or `ChatView`).
  - `LiveThinkingBlock.tsx:8`: remove `aria-live` (reasoning text is supplementary; announcing every token is spammy). Optionally add a sibling `role="status"` "Assistant is thinking…" set once when thinking starts.
  - `MessageInput.tsx:204`: remove `aria-live` from the `~{tokens} tokens` chip (ambient info).

- [ ] **Step 4: Run it, verify it passes** — live test → PASS; existing chat tests green.

- [ ] **Step 5: Commit**

```bash
git add src/components/chat/MessageList.tsx src/components/chat/MessageBubble.tsx src/components/reasoning/LiveThinkingBlock.tsx src/components/chat/MessageInput.tsx src/components/chat/MessageList.live.test.tsx
git commit -m "fix(a11y): stop live-region spam during streaming; one completion announcement"
```

### Task 9: Expose @mention autocomplete as an ARIA combobox (A3)

**Files:** Modify `src/components/chat/MessageInput.tsx`, `src/components/chat/MentionPopover.tsx`.

- [ ] **Step 1: Write the failing test** — `src/components/chat/MessageInput.mention.test.tsx`: when the mention popover is open, the textarea exposes combobox semantics.

```tsx
// Render MessageInput, type '@' to open the popover (mirror existing mention tests
// for how the popover is triggered), then:
const textarea = screen.getByRole('combobox');
expect(textarea).toHaveAttribute('aria-expanded', 'true');
expect(textarea).toHaveAttribute('aria-controls'); // points at the listbox id
expect(textarea).toHaveAttribute('aria-activedescendant'); // the highlighted option id
```

(Read the existing mention test / `MentionPopover.tsx` first to reproduce the open-trigger and option id scheme.)

- [ ] **Step 2: Run it, verify it fails** — FAIL (textarea has no combobox role/attrs).

- [ ] **Step 3: Implement** — on the composer `<textarea>` (`MessageInput.tsx:154`): add `role="combobox"`, `aria-autocomplete="list"`, `aria-expanded={mention.open}`, `aria-controls={LISTBOX_ID}` (a stable id also set on the popover's `role="listbox"` element), and `aria-activedescendant={mention.open ? optionId(mention.index) : undefined}`. In `MentionPopover.tsx`, give the listbox `id={LISTBOX_ID}` and each option a stable `id={optionId(i)}` matching `aria-activedescendant`. Keep focus on the textarea (arrow keys already handled).

- [ ] **Step 4: Run it, verify it passes** — PASS; existing mention tests green.

- [ ] **Step 5: Commit**

```bash
git add src/components/chat/MessageInput.tsx src/components/chat/MentionPopover.tsx src/components/chat/MessageInput.mention.test.tsx
git commit -m "fix(a11y): expose @mention autocomplete as an ARIA combobox (activedescendant)"
```

### Task 10: Dialog polish — lightbox name, aria-labelledby, closedby (A4/A5/A6)

**Files:** Modify `src/components/chat/AttachmentLightbox.tsx`, `src/components/ui/Modal.tsx`.

- [ ] **Step 1: Write the failing test** — extend `src/components/ui/Modal.test.tsx` (or a new `Modal.a11y.test.tsx`): a Modal with a `title` uses `aria-labelledby` pointing at the visible title element (not a duplicated `aria-label`).

```tsx
it('labels the dialog via aria-labelledby referencing the visible title', () => {
  render(<Modal open onClose={() => {}} title="Settings"><p>x</p></Modal>);
  const dlg = document.querySelector('dialog')!;
  const labelledby = dlg.getAttribute('aria-labelledby');
  expect(labelledby).toBeTruthy();
  expect(document.getElementById(labelledby!)).toHaveTextContent('Settings');
  expect(dlg).not.toHaveAttribute('aria-label');
});
```

- [ ] **Step 2: Run it, verify it fails** — FAIL (uses `aria-label`).

- [ ] **Step 3: Implement** — `Modal.tsx`: give the title `<div>` an `id` (e.g. `useId()`), set `aria-labelledby={titleId}` on the `<dialog>` (drop `aria-label={title}`) when `title` is present; add `closedby="any"` to the `<dialog>` and gate the manual backdrop `onMouseDown` fallback behind `!('closedBy' in HTMLDialogElement.prototype)`. `AttachmentLightbox.tsx:53`: pass a `title` (the attachment filename) or `aria-label="Image preview"`.

- [ ] **Step 4: Run it, verify it passes** — PASS; Modal/lightbox tests green.

- [ ] **Step 5: Commit**

```bash
git add src/components/ui/Modal.tsx src/components/chat/AttachmentLightbox.tsx src/components/ui/Modal.test.tsx
git commit -m "fix(a11y): aria-labelledby for Modal title, name the lightbox dialog, adopt closedby=any"
```

---

## Phase F — Forms & validation

### Task 11: Accessible validation in PromptDialog (F1)

**Files:** Modify `src/components/ui/PromptDialog.tsx`; Test `src/components/ui/PromptDialog.validation.test.tsx`.

- [ ] **Step 1: Write the failing test** — `src/components/ui/PromptDialog.validation.test.tsx`: a required field shows no error before interaction, and after blurring empty exposes `aria-invalid` + an announced error.

```tsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PromptDialog } from './PromptDialog';

it('announces a required-field error only after interaction', async () => {
  const user = userEvent.setup();
  render(<PromptDialog open title="T" label="Name" required onConfirm={() => {}} onCancel={() => {}} />);
  const input = screen.getByLabelText(/name/i);
  expect(input).toHaveAttribute('aria-invalid', 'false'); // not eager
  await user.click(input);
  await user.tab(); // blur while empty
  expect(input).toHaveAttribute('aria-invalid', 'true');
  expect(input).toHaveAccessibleDescription(/required/i); // via aria-describedby error node
});
```

- [ ] **Step 2: Run it, verify it fails** — FAIL (no `aria-invalid`, no accessible description, label not associated).

- [ ] **Step 3: Implement** — `PromptDialog.tsx`: associate the label with the field (`htmlFor`/`id`), add the native `required` attribute, track a `touched` state (set on blur), compute `showError = required && touched && !value.trim()`, set `aria-invalid={showError}`, add an error node `<span id={errId} className="text-status-error text-xs">Required</span>` referenced by `aria-describedby={showError ? errId : undefined}`, and add a required marker (`*`) to the label. Keep the disabled-Confirm behavior. Style invalid state with `aria-[invalid=true]:border-status-error` (Tailwind arbitrary variant) so the visual matches after interaction.

- [ ] **Step 4: Run it, verify it passes** — PASS.

- [ ] **Step 5: Verify live** — any add/rename flow (e.g. new workspace) shows a required marker, no eager error, and a clear announced error when submitted/blurred empty.

- [ ] **Step 6: Commit**

```bash
git add src/components/ui/PromptDialog.tsx src/components/ui/PromptDialog.validation.test.tsx
git commit -m "fix(forms): accessible after-interaction validation + required marker in PromptDialog"
```

### Task 12: KeyVault autocomplete=off + placeholder-label fixes (F2/F3)

**Files:** Modify `src/components/profiles/KeyVaultModal.tsx`, `src/components/swarms/SwarmEditModal.tsx`, `src/components/schedules/ScheduleEditModal.tsx`, `src/components/chat/MessageInput.tsx`.

- [ ] **Step 1: Write the failing test** — `src/components/profiles/KeyVaultModal.autocomplete.test.tsx`: the secret input opts out of autofill.

```tsx
// Render KeyVaultModal (mirror its existing test harness), locate the key input:
const input = screen.getByLabelText(/anthropic key/i); // or by placeholder/role
expect(input).toHaveAttribute('autocomplete', 'off');
```

- [ ] **Step 2: Run it, verify it fails** — FAIL (no autocomplete attribute).

- [ ] **Step 3: Implement** — `KeyVaultModal.tsx:141-151`: add `autoComplete="off"` (and `name="aether-provider-key"` non-credential-y name) to the key `<input>` in both password and revealed-text modes. Then add persistent labels (`<label>` or a visible label element, not placeholder-only) to: `SwarmEditModal.tsx:42` name input, `ScheduleEditModal.tsx` fields, and give the `MessageInput.tsx` composer `<textarea>` an `aria-label="Message"` (or an associated visually-hidden `<label>`).

- [ ] **Step 4: Run it, verify it passes** — PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/profiles/KeyVaultModal.tsx src/components/swarms/SwarmEditModal.tsx src/components/schedules/ScheduleEditModal.tsx src/components/chat/MessageInput.tsx src/components/profiles/KeyVaultModal.autocomplete.test.tsx
git commit -m "fix(forms): autocomplete=off on the API-key field; real labels over placeholders"
```

---

## Phase P — Performance / INP

### Task 13: Memoize MessageBubble (P1)

**Files:** Modify `src/components/chat/MessageBubble.tsx`; Test `src/components/chat/MessageBubble.memo.test.tsx`.

- [ ] **Step 1: Write the failing test** — appending a chunk to the streaming message does not re-run a sibling bubble's body.

```tsx
import { render } from '@testing-library/react';
import { MessageBubble } from './MessageBubble';
import { useChatStore } from '@/src/stores/chat.store';

it('does not re-render a sibling bubble when another message streams', () => {
  const a = 'a', b = 'b';
  useChatStore.setState({
    messages: [{ id: a, role: 'user', text: 'hi', timestamp: 0 }, { id: b, role: 'model', text: '', timestamp: 1 }],
    streamingId: b,
  });
  let renders = 0;
  const Probe = ({ id }: { id: string }) => { renders++; return <MessageBubble id={id} />; };
  const Wrapped = React.memo(Probe); // if MessageBubble is memoized, its parent wrapper won't re-invoke on unrelated store changes
  render(<Wrapped id={a} />);
  const before = renders;
  useChatStore.getState().appendChunk(b, 'more');
  expect(renders).toBe(before); // sibling 'a' not re-rendered
});
```

(If a render-count probe is awkward, assert instead that `MessageBubble` is a memo component: `expect((MessageBubble as any).$$typeof).toBe(Symbol.for('react.memo'))`.)

- [ ] **Step 2: Run it, verify it fails** — FAIL (not memoized).

- [ ] **Step 3: Implement** — `MessageBubble.tsx`: wrap the export in `React.memo`:

```tsx
import { memo, useState } from 'react';
// ...
export const MessageBubble = memo(function MessageBubble({ id, onRetry }: MessageBubbleProps) {
  // ...existing body...
});
```

- [ ] **Step 4: Run it, verify it passes** — PASS; existing MessageBubble tests green.

- [ ] **Step 5: Commit**

```bash
git add src/components/chat/MessageBubble.tsx src/components/chat/MessageBubble.memo.test.tsx
git commit -m "perf(chat): memoize MessageBubble to stop O(N) sibling re-renders per streamed chunk"
```

### Task 14: Normalize chat store to messagesById (P2)

**Files:** Modify `src/stores/chat.store.ts`, `src/components/chat/MessageBubble.tsx`; Test extends `src/stores/chat.store.test.ts`.

**Interfaces:**
- Produces: `messagesById: Record<string, Message>` on the store, kept in sync with `messages`; `MessageBubble` selects `s.messagesById[id]`.

- [ ] **Step 1: Write the failing test** — in `chat.store.test.ts`: `messagesById` mirrors `messages` and `appendChunk` is O(1) on the single id.

```ts
it('keeps messagesById in sync and appendChunk touches only the target id', () => {
  const s = useChatStore.getState();
  useChatStore.setState({ messages: [{ id: 'x', role: 'model', text: 'a', timestamp: 0 }], messagesById: { x: { id: 'x', role: 'model', text: 'a', timestamp: 0 } } });
  useChatStore.getState().appendChunk('x', 'b');
  expect(useChatStore.getState().messagesById['x'].text).toBe('ab');
  expect(useChatStore.getState().messages.find((m) => m.id === 'x')!.text).toBe('ab');
});
```

- [ ] **Step 2: Run it, verify it fails** — FAIL (`messagesById` undefined).

- [ ] **Step 3: Implement** — add `messagesById: Record<string, Message>` to `ChatState` and initial state (`{}`). Every reducer that mutates `messages` must update both. Introduce a helper to derive/patch:

```ts
function withMessages(next: Message[]): { messages: Message[]; messagesById: Record<string, Message> } {
  const byId: Record<string, Message> = {};
  for (const m of next) byId[m.id] = m;
  return { messages: next, messagesById: byId };
}
```

Use `withMessages(...)` in the reducers that replace the array (create/append/finalize/reset/hydrate). For the hot path `appendChunk`, patch both cheaply:

```ts
  appendChunk: (id, text) =>
    set((s) => {
      const cur = s.messagesById[id];
      if (!cur) return s;
      const updated = { ...cur, text: cur.text + text };
      return {
        messages: s.messages.map((m) => (m.id === id ? updated : m)),
        messagesById: { ...s.messagesById, [id]: updated },
      };
    }),
```

Then in `MessageBubble.tsx:37`: `const message = useChatStore((s) => s.messagesById[id]);` (O(1)).

- [ ] **Step 4: Run it, verify it passes** — PASS; full chat store + MessageBubble + MessageList tests green.

- [ ] **Step 5: Verify live** — a long conversation still renders/streams correctly; no missing/duplicated bubbles.

- [ ] **Step 6: Commit**

```bash
git add src/stores/chat.store.ts src/components/chat/MessageBubble.tsx src/stores/chat.store.test.ts
git commit -m "perf(chat): normalize store to messagesById for O(1) bubble selection"
```

### Task 15: Reasoning drawer — skip work while closed + content-visibility (P3/P4)

**Files:** Modify `src/components/reasoning/ReasoningDrawer.tsx`, `src/components/reasoning/ReasoningStepCard.tsx`.

- [ ] **Step 1: Write the failing test** — `src/components/reasoning/ReasoningDrawer.closed.test.tsx`: while closed, the drawer doesn't run its heavy selector (assert it renders nothing/does not call the reverse+find). Simplest observable: when `open` is false, the drawer renders no step content.

```tsx
// Read ReasoningDrawer.tsx for how `open` is sourced (useUiStore). Set open=false,
// seed messages with reasoning, render, and assert no step cards are present:
expect(container.querySelector('[data-testid="reasoning-step"]')).toBeNull();
```

- [ ] **Step 2: Run it, verify it fails** — FAIL if the drawer currently renders step content while translated off-screen (verify by reading the file; if it already returns null when closed, skip P3 and keep only P4).

- [ ] **Step 3: Implement** — `ReasoningDrawer.tsx`: early-return `null` (or skip the `useMemo` reverse+find) when `!open`; if a store-maintained `lastModelMessageId` is easy, prefer it over `[...messages].reverse().find(...)`. `ReasoningStepCard.tsx`: wrap each card's outer element with `style={{ contentVisibility: 'auto', containIntrinsicSize: 'auto 120px' }}` (mirror `MessageList.tsx:40`).

- [ ] **Step 4: Run it, verify it passes** — PASS; reasoning tests green.

- [ ] **Step 5: Commit**

```bash
git add src/components/reasoning/ReasoningDrawer.tsx src/components/reasoning/ReasoningStepCard.tsx src/components/reasoning/ReasoningDrawer.closed.test.tsx
git commit -m "perf(reasoning): skip drawer work while closed; content-visibility on step cards"
```

### Task 16: rAF-batch autoscroll (P5)

**Files:** Modify `src/hooks/useAutoScroll.ts`; Test `src/hooks/useAutoScroll.test.ts`.

- [ ] **Step 1: Write the failing test** — multiple synchronous dep changes cause at most one scroll write per frame.

```ts
// Drive the hook via a test component; mock requestAnimationFrame; trigger several
// dep updates in one tick and assert scrollTop is written once per frame, not per update.
```

(Mirror any existing hook-test harness. If a render harness is heavy, assert the hook schedules via `requestAnimationFrame` rather than writing `scrollTop` synchronously.)

- [ ] **Step 2: Run it, verify it fails** — FAIL (writes synchronously each dep change).

- [ ] **Step 3: Implement** — `useAutoScroll.ts`: in the scroll-to-bottom effect, coalesce writes with rAF:

```ts
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (userScrolledUpRef.current) return;
    const raf = requestAnimationFrame(() => { el.scrollTop = el.scrollHeight; });
    return () => cancelAnimationFrame(raf);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
```

- [ ] **Step 4: Run it, verify it passes** — PASS.

- [ ] **Step 5: Verify live** — streaming still auto-scrolls smoothly; typing during a burst stays responsive.

- [ ] **Step 6: Commit**

```bash
git add src/hooks/useAutoScroll.ts src/hooks/useAutoScroll.test.ts
git commit -m "perf(chat): rAF-batch autoscroll writes to avoid a forced reflow per chunk"
```

---

## Final verification

- [ ] `npm run lint` → clean
- [ ] `npm run test:run` → all green
- [ ] `npm run build` → succeeds; `npm audit` unchanged
- [ ] Live pass on http://localhost:3000: sidebar text legible (AA), no live-region spam with a screen reader during streaming, dialogs restore focus on Esc/backdrop, reduced-motion/reduced-transparency respected, native controls brand-accented.
- [ ] Open a PR from `feat/web-ui-remediation` summarizing the workstreams.
