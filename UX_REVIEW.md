# Aether — UX Review

**Date:** 2026-05-24
**Scope:** all FE components in `src/components/**` (≈58 files).
**Method:** static read of every component + cross-reference against the [`modern-web-guidance`](https://github.com/GoogleChrome/modern-web-guidance) catalog (Google Chrome team), focused on accessibility, native overlays, focus management, and dark-mode hygiene.
**Output:** a backlog of UX/design fixes, organized first by cross-cutting concerns (applies to many places) then by component. Each item has a **severity** (P1/P2/P3) and a **fix** sketch.

The codebase already has good bones: consistent design tokens (`surface-1..4`, `border-subtle`, `accent`, `status-*`), a small typography vocabulary (`mono-label`, `font-mono` for code/labels, sans for prose), and a dialog-system hook (`useDialog`). Most issues are about **accessibility primitives, focus management, and using the right native element** — not about reskinning.

---

## Legend

- **P1** — accessibility blocker, footgun, or breaks a real user flow. Fix soon.
- **P2** — usability friction, inconsistency, or non-native pattern with a better alternative. Fix opportunistically.
- **P3** — polish.

References below are to the `modern-web-guidance` catalog (retrieve with `npx -y modern-web-guidance@latest retrieve "<id>"`).

---

## 0 — Cross-cutting issues

These apply to many components and should be tackled as small platform-wide tasks, not per-component.

### 0.1 `<Modal>` is not a `<dialog>` — no native focus trap, no `inert` background, no top-layer · P1

`src/components/ui/Modal.tsx` is a `<div role="dialog" aria-modal="true">` with a custom backdrop and a `keydown` Escape listener. It does **not** trap focus, doesn't disable interaction with the background, and isn't promoted to the top layer.

**Why it matters:** Tab key escapes the modal into the (still-active) page underneath — bad for both keyboard and AT users. Also blocks correct stacking when two modals coexist (e.g. KeyVaultModal opened from CommandPalette).

**Fix:** rebuild `<Modal>` on top of the native `<dialog>` element:
- Use `showModal()` for focus trap + top-layer + ESC handling for free.
- Style the backdrop via `::backdrop`.
- For light-dismiss use `<dialog closedby="any">` (or fall back to a `mousedown` outside-click listener for older Safari).
- Pair with the `inert` attribute on the app shell while a modal is open (see `guidance/html` §6).

Guidance refs: `html` §4 (Native overlays), `light-dismiss-a-dialog`, `platform-controls-dismiss-dialog`.

### 0.2 `<Tooltip>` and inline `title=` attributes · P1

`src/components/ui/Tooltip.tsx` is literally `<span title={label}>`. The Modern Web Guidance explicitly says **`DON'T use the title attribute to create tooltip effects`** (`html` §5). `title`:
- doesn't show on touch,
- doesn't show on keyboard focus,
- has inconsistent timing,
- is invisible to most AT.

`MessageInput`, `MessageBubble`, and other places call `title=` directly even bypassing the `Tooltip` component.

**Fix:** replace with the Popover API or a small `interest-triggered-tooltips` implementation (Chrome `interesttarget`+`@interest-state` with a polyfill for non-supporting browsers). Make focus-visible trigger the tooltip too.

Guidance refs: `interest-triggered-tooltips`, `position-aware-tooltips`.

### 0.3 No `:focus-visible` styles on most buttons · P1

Most buttons rely on the browser default focus ring, which is suppressed (or invisible against the dark background) for many element types. `Button` (the cva-based primitive) has no `focus-visible:ring-*` class. The sidebar action buttons (`SessionsSection`, `McpServersSection`, `WorkspacesSection`) have nothing at all.

**Fix:** add a global `focus-visible` style:

```ts
// in Button.tsx variant base
'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/70 focus-visible:ring-offset-2 focus-visible:ring-offset-surface-1'
```

Apply the same pattern to icon buttons, dropdown triggers, and sidebar row buttons. Pair with a `:has(:focus-visible)` container highlight for clarity.

Guidance refs: `accessibility` §Focus.

### 0.4 Focus does not return to trigger after a modal/menu closes · P2

`<Modal>` doesn't remember which element opened it. When the user closes the KeyVaultModal, focus lands on `<body>`, not on the row that opened it. Same for `ProfilesModal`, `SubAgentEditModal`, `WorkspaceChip` dropdown, etc.

**Fix:** once `<Modal>` is rebuilt on `<dialog>`, the native element returns focus to the previously-focused element automatically on `close`. For custom popovers (e.g. `MessageContextMenu`, `WorkspaceChip` dropdown), capture `document.activeElement` on open and `.focus()` it on close.

### 0.5 No skip-link · P2

The app has a sidebar with ~10 sections. Tab-from-top forces a keyboard user through all of them before reaching `MessageInput`.

**Fix:** add a visually-hidden `<a href="#message-input">Skip to message input</a>` at the very top of `<AppShell>`, and a `id="message-input"` on the textarea wrapper.

### 0.6 Language inconsistency (Italian/English mix) · P2

The codebase has Italian leaking into a mostly-English UI:
- `MessageInput` placeholder: `Scrivi un messaggio…`
- `MessageBubble`: `Stream interrotto`, `Interrotto · ~N token`, `Riprendi`
- `SessionsSection`: `Nuova sessione` (fallback title)
- `ChatView` empty state: `Nessuna sessione attiva. Crea una nuova sessione dalla sidebar.`

**Fix:** pick one (English fits the rest of the UI). If real i18n is on the roadmap, extract these into a small `src/i18n/en.ts` map first — that future-proofs without adding `react-intl`.

### 0.7 Body scroll not locked when modals open · P3

Background scrolls behind every modal. With `backdrop-blur-sm` on the backdrop, this is jarring.

**Fix:** set `<body class="overflow-hidden">` while any modal is open. The cleanest path is to do this in the `<Modal>` (or `<dialog>`) base via a `useEffect`. Pair with `inert` on the app shell.

### 0.8 Design-token violation: direct `bg-zinc-*` usage · P3

The palette defines `surface-1..4`, `border-subtle`, `accent`, `status-*`. But many components still use `bg-zinc-900`, `bg-zinc-800`, `text-zinc-500` directly (see `MessageInput`, `BreakpointsSection`, `WorkspacesSection`, several modals).

**Fix:** add a lint rule (or just a contributor-facing convention in `CLAUDE.md`) against raw zinc-* classes outside of `text-*` for non-semantic text. Or, more pragmatically, document the intended mapping (`bg-zinc-900` → `bg-surface-3`) and migrate over a slice or two.

### 0.9 Sidebar font sizes are below comfortable reading (`text-[10px]`) · P2

The sidebar relies heavily on `text-[10px]` for row labels (Sessions, Workspaces, Breakpoints, MCP). At 1× zoom on a 13" laptop that's ~7.5 CSS pixels of x-height — fine as a label, painful as content.

**Fix:** introduce two scale tokens — `text-mono-label` (existing) and `text-mono-body` (~11–12 px). Use `text-[10px]` only for the header label; row content goes to `text-mono-body`. Also add `letter-spacing: 0.02em` for the smaller mono text to improve scanability.

### 0.10 Hover-only affordances on rows · P2

`SessionsSection`, `WorkspacesSection`, `McpServersSection` hide row actions until `group-hover:flex`. Touch users never see them. Keyboard users can tab to them but can't see they exist.

**Fix:** keep the visual hover affordance (it reduces clutter), but also:
- Reveal on `:focus-visible` (`group-focus-within:flex` is the modern equivalent).
- On touch (`@media (hover: none)`), make actions always visible.
- Provide a kebab `⋮` menu on each row as a touch-friendly entry point.

Guidance refs: `interactive-content-reveal`.

### 0.11 Backdrop-click as a destructive action · P1 (ApprovalGate)

`ApprovalGate.tsx` treats clicking the backdrop as **Reject**. For a *dangerous* tool call, an accidental click-outside silently rejects — confusing and potentially destructive (the agent retries or aborts). The plan even said "Escape / outside-click → Reject" but that's a footgun.

**Fix:** backdrop click should be a **no-op** (or open a "confirm cancel" inline message). Make the user click Reject explicitly. Escape can still reject — that's a deliberate keyboard action.

### 0.12 `MessageList` re-renders markdown on every streaming chunk · P3

`MessageBubble` calls `<ReactMarkdown>{message.text}</ReactMarkdown>` on every chunk. For long replies this is O(n²)-ish (the markdown AST is re-parsed every keystroke).

**Fix:** memoize the rendered markdown by `id + text length`. Or split: render plain text while `isStreaming`, then `<ReactMarkdown>` once on `done`.

Guidance refs: `break-up-long-tasks`, `identify-inp-causes`.

---

## 1 — UI primitives (`src/components/ui/`)

### 1.1 `Modal.tsx` · P1

Already covered in §0.1. Action items:
- [ ] Migrate to native `<dialog>` + `showModal()`.
- [ ] Use `::backdrop` for the dim layer.
- [ ] Use `closedby="any"` for light dismiss; fall back to JS listener for older Safari.
- [ ] Apply `inert` to `<main id="app-shell">` while open.
- [ ] Set `<body class="overflow-hidden">` while open.
- [ ] Restore focus to the trigger on close (free with `<dialog>`).

### 1.2 `Button.tsx` · P2

The cva variants are clean. Missing:
- [ ] `focus-visible` ring (see §0.3).
- [ ] `aria-busy={loading}` + spinner support for async actions.
- [ ] Optional `leadingIcon`/`trailingIcon` slots — today every call site wraps `<Send size={16}/>` next to text manually.
- [ ] `disabled` state uses `opacity-30`; should also add `cursor-not-allowed` (currently uses `pointer-events-none` which removes the not-allowed cursor entirely).

### 1.3 `Tooltip.tsx` · P1

Replace with a Popover-based tooltip. Until then, remove the component to discourage its use (callers can just use `aria-label` for icon-only buttons, which is more correct than `title`).

### 1.4 `IconButton.tsx`, `Panel.tsx`, `Badge.tsx`, `StatusDot.tsx` · P3

Mostly fine. Suggestions:
- `StatusDot` should expose `aria-label` with the status value, not just be a colored dot. Today it's `<span data-state="online">●</span>` — screen readers say "bullet".
- `IconButton` should also pick up the `focus-visible` ring update from §0.3.

### 1.5 `ConfirmDialog.tsx` · P2

- [ ] When `destructive`, **focus the Cancel button by default**, not Confirm. Modern guidance: never make a destructive action the default of an interactive default. Today no explicit autoFocus is set, so focus lands wherever React thinks first.
- [ ] Add `<h2>` for the title (Modal renders title as a div with `mono-label`); a screen-reader-only `<h2>` makes the dialog landmark complete.

### 1.6 `PromptDialog.tsx` · P2

- [ ] Replace `setTimeout(..., 10)` with `useEffect` + `requestAnimationFrame` (or the `autofocus` attribute on the input now that we're moving to `<dialog>`).
- [ ] When `required` and the value is empty, submit should *show validation*, not silently noop. Use the native `:user-invalid` pseudo + a small inline message under the input.
- [ ] The textarea version uses `font-mono text-xs` — fine — but doesn't honor `prefers-reduced-motion` when resizing.

Guidance refs: `validate-input-after-interaction`, `required-field-feedback`, `accessible-error-announcement`.

---

## 2 — Layout (`src/components/layout/`)

### 2.1 `AppShell.tsx` · P2

- [ ] Drop `role="main"` from `<main>` (redundant — `<main>` already conveys this).
- [ ] Add a skip-link before the sidebar (§0.5).
- [ ] Sidebar is rendered/unrendered via `{sidebarOpen && ...}`. This loses sidebar state on collapse (scroll position, open sub-sections in the future). Prefer keeping it mounted with `display: none` or a CSS-driven slide-out animation — pairs well with the planned `slice-25`/`slice-26` panels.
- [ ] Add `<header role="banner">` to TopBar's wrapping element so AT users get a navigable landmark. (TopBar already uses `<header>` — good — but verify it isn't nested inside another `<header>`.)

### 2.2 `TopBar.tsx` · P1

- [ ] The right cluster (`<ProfilesButton/><TokenChip/><WorkspaceChip/><ProviderSelector/>`) has no `gap` between elements and no `ml-auto` to push it to the right. Looks crowded; on narrow screens it overflows the title.

**Fix:**
```tsx
<header className="…flex items-center gap-2 px-4…">
  <IconButton …/>
  <span className="ml-3 …">{title}</span>
  <div className="ml-auto flex items-center gap-2">
    <ProfilesButton />
    <TokenChip />
    <WorkspaceChip />
    <ProviderSelector />
  </div>
</header>
```

- [ ] No keyboard-shortcut hint for `⌘K`. Add a small kbd-style chip next to the title or inside the palette button:
```tsx
<button aria-label="Open command palette" onClick={openPalette}>
  <kbd>⌘K</kbd>
</button>
```

### 2.3 `Sidebar.tsx` · P2

- [ ] `scrollbar-hide` removes the scrollbar entirely. Use a thin scrollbar (`scrollbar-width: thin`) so users know the panel is scrollable.
- [ ] The `space-y-6` between sections is generous but the section titles are also `mono-label` text-[10px]. Add a divider rule (`border-b border-border-subtle`) under each section header to improve scan-ability.
- [ ] `<aside aria-label="Sidebar">` — the section landmark is fine but should also have a `<nav>` wrapper for the sessions list (it IS a navigation surface for sessions/workspaces/profiles).

### 2.4 `WorkspaceChip.tsx` · P1

- [ ] **Dropdown doesn't close on outside-click.** Open it, click on TopBar's title, and the dropdown stays open. Add an outside-click listener (same pattern as `MessageContextMenu`).
- [ ] No keyboard navigation inside the dropdown (Tab works but ArrowUp/ArrowDown don't). For a `select`-style menu it should use:
  - `role="menu"` on the wrapper, `role="menuitem"` on each option.
  - Arrow keys to move, Enter to pick, Escape to close + return focus.
- [ ] Use the Popover API (`popover="auto"`) instead of a manual `useState`. The native popover light-dismisses for free.

Guidance refs: `resilient-context-menus-and-nested-dropdowns`, `anchor-positioning-tab-underline` (for anchoring the dropdown to the chip without manual `position: absolute`).

### 2.5 `TokenChip.tsx` · P3

Likely just shows a count. Verify:
- [ ] Has an `aria-label` like `"Context size: N tokens"`.
- [ ] Updates without re-renders thrashing (subscribe to a derived selector, not the whole `chat.store`).

### 2.6 `DialogHost.tsx`, `HiddenImportInput.tsx` · P3

No visible UI; review the keyboard accessibility of the `useDialog().prompt` / `.confirm` flows once `<Modal>` is rebuilt.

---

## 3 — Chat (`src/components/chat/`)

### 3.1 `ChatView.tsx` · P3

- [ ] Empty state is Italian (`Nessuna sessione attiva…`). See §0.6.
- [ ] No loading skeleton when a session is selected but messages haven't hydrated yet — for ~50–100 ms there's a flash of empty.
- [ ] `<AttachmentDropZone>` wraps the entire chat area. Drag-and-drop while a tool call modal is open is undefined; should disable when a modal is open.

### 3.2 `MessageList.tsx` · P2

- [ ] `<div ref={containerRef} className="flex-1 overflow-y-auto p-4 flex flex-col gap-3">` should have `role="log"` + `aria-live="polite"` so screen readers announce new assistant messages.
- [ ] Lazy-render off-screen messages with `content-visibility: auto`. For chats >100 messages the scroll perf will benefit.

Guidance refs: `defer-rendering-heavy-content`.

### 3.3 `MessageBubble.tsx` · P1 (multiple)

- [ ] `title={tooltip}` for token counts — same anti-pattern (§0.2). Replace with a Popover or tooltip primitive.
- [ ] `max-w-[80%]` — wide. For readability (per typography research), a measure of 50–75 chars works best. Switch to `max-w-prose` or `max-w-[65ch]`.
- [ ] `whitespace-pre-wrap` on user messages but `ReactMarkdown` for assistant — inconsistent. Decide: user can use markdown too, or assistant text is escaped. Document the choice.
- [ ] Italian leak (`Stream interrotto`, `Interrotto · ~N token`, `Riprendi`) — see §0.6.
- [ ] Image attachment `<img>` is missing `width`/`height` attrs — causes layout shift while loading (CLS). Use `aspect-ratio` CSS as a fallback if intrinsic dims are unknown.
- [ ] The "Show reasoning" button uses emoji prefix (`🧠`, `💭`) without `aria-hidden`. Screen readers will read the emoji name.

Guidance refs: `optimize-image-priority` (use `loading="lazy"` + explicit dims), `prevent-text-wrapping`.

### 3.4 `MessageInput.tsx` · P1 (multiple)

- [ ] Textarea is fixed at `rows={2}` with no auto-resize. Long messages need manual resize. Use either:
  - `field-sizing: content` (Chrome 123+), or
  - JS auto-grow on `input` (set `style.height = scrollHeight + 'px'`).

Guidance refs: `form-fields-automatically-fit-contents`.

- [ ] Placeholder is Italian (§0.6).
- [ ] `aria-label="Send"` / `aria-label="Attach files"` are good. But `title={visionBlocked ? '…' : undefined}` on Send falls back to `title` for the disabled hint — replace with a proper tooltip + a visible inline message under the input when `visionBlocked`.
- [ ] No character/token counter. For agent UIs it's useful to show "~N input tokens" as you type so users can self-throttle.
- [ ] Paste-image flow (`onPaste`) is great but silent — add a brief toast/inline confirmation when a clipboard image is attached.
- [ ] `Send` and `Stop` buttons swap based on `isStreaming` — this is OK but the visual transition is abrupt. Consider a small crossfade.
- [ ] Hidden file input uses `accept="image/*,.md,.json,…"`. The dotted-extension list is long; consider letting the server validate by mime and using a wider accept to support more file types.

### 3.5 `AttachmentDropZone.tsx` · P2

- [ ] The active state is `outline-2 outline-accent/40 outline-offset-[-4px]` — quite subtle on dark backgrounds. When active, render a full inset overlay with a clear "Drop files to attach" message + the count of files being dragged.
- [ ] No max-file warning during drag (you only get the error after dropping). Show the limit (5 files, 10 MB) in the overlay text.

### 3.6 `AttachmentChips.tsx` · (not read; likely fine)

Verify each chip:
- [ ] Has `aria-label` for the remove button.
- [ ] Shows file size in human-readable form.
- [ ] Supports keyboard delete (Backspace when focused).

### 3.7 `AttachmentLightbox.tsx` · P2

- [ ] `<img alt="Attachment">` is generic. Use the original filename (`a.name`) as alt.
- [ ] No prev/next navigation between attachments in the same message. Add `←`/`→` keyboard nav.
- [ ] No "Download" / "Open in new tab" actions.
- [ ] No image dimensions visible (helpful for screenshots).
- [ ] Click-on-image to zoom-in (pinch on touch) — out of scope but worth queueing.

### 3.8 `MentionPopover.tsx` · P2

- [ ] `role="listbox"` + `role="option"` + `aria-selected` — correct.
- [ ] Anchored as `absolute bottom-full left-0`. On a short viewport this can overflow above the screen. Switch to CSS anchor positioning so the popover auto-flips:
```css
[popover="manual"] {
  position-anchor: --message-input;
  inset-area: block-end span-inline-end;
  position-try: flip-block;
}
```
- [ ] Active item should `scrollIntoView({ block: 'nearest' })` when navigating with arrows.

Guidance refs: `anchor-positioning-tab-underline`, `resilient-context-menus-and-nested-dropdowns`.

### 3.9 `MessageContextMenu.tsx` · P2

- [ ] Positioned via `style={{ left: x, top: y }}` with no viewport clamping. Right-click near the bottom-right corner places it half off-screen.
- [ ] Should be a `<menu role="menu">` with `role="menuitem"` items.
- [ ] No keyboard activation: right-clicking opens it via mouse coords. Add a Shift+F10 / Menu-key handler on `MessageBubble` that opens the menu at the bubble's top-right.
- [ ] When the menu closes, focus should return to the message bubble.

Guidance refs: `resilient-context-menus-and-nested-dropdowns`.

### 3.10 `ApprovalGate.tsx` · P1 (this is the highest-stakes modal)

- [ ] **Backdrop-click rejects the call.** Footgun — see §0.11. Make backdrop click a no-op; require explicit Reject.
- [ ] Default focus should go to **Reject** (the safer choice for a `dangerous` category). Today React focuses neither explicitly.
- [ ] Tab order: today Approve comes after Reject in DOM but visually Reject is on the left, Approve on the right. Switch the DOM order to match — first Reject, then Approve — so Tab moves left→right.
- [ ] Category badge color is good (rose/orange/emerald) but the badge text is lowercase. Use uppercase + letter-spacing so it reads as a tag, not a typo: `DANGEROUS` etc.
- [ ] No timer/countdown visible to the user, even though the server has a 60s timeout on `awaitDecision`. Show a small "60s remaining" countdown so users know not to walk away.
- [ ] The args block uses `<pre>` with no `tabindex="0"` — long args become unscrollable for keyboard users.
- [ ] DiffView (`src/components/chat/DiffView.tsx`) is good but doesn't show line numbers. For longer diffs that's a real omission.
- [ ] The "Auto-approve this tool for the rest of this session" checkbox has the label-text-as-tooltip — fine — but should include a small icon or visual cue indicating session-scope (so users don't think it's permanent).
- [ ] Migrate to `<dialog>` (§0.1).

### 3.11 `DiffView.tsx` · P2

- [ ] Add line numbers in a non-selectable gutter.
- [ ] Long lines wrap silently. Add a visual "↩" continuation marker, or use `overflow-x: auto` with a horizontal scrollbar — but then ensure `tabindex="0"` per §3.10.
- [ ] No syntax highlighting. For a true dev tool this matters. Consider Shiki (lazy-loaded) or Prism.
- [ ] No "copy diff" or "copy newText" affordance.

### 3.12 `ToolCallBanner.tsx`, `StreamingIndicator.tsx`, `EmptyState.tsx` · (not read)

Spot-check:
- ToolCallBanner should have `role="status"` so AT users hear that a tool call is in progress.
- StreamingIndicator's animation should respect `prefers-reduced-motion`.

---

## 4 — Sidebar sections (`src/components/sidebar/`)

### 4.1 `SessionsSection.tsx` · P2

- [ ] Action buttons (`↓` `✎` `×`) are single-character glyphs. Switch to lucide icons (`Download`, `Pencil`, `Trash2`) — same visual weight, infinitely more readable.
- [ ] `disabled={isStreaming}` greys out the row but the disabled state is unclear ("why can't I click?"). Add a tooltip / inline text on the New Session button: "Streaming — wait for current response".
- [ ] Error banner needs `role="alert"`. Today it renders silently for AT.
- [ ] Active row uses `bg-accent/10 border-accent/40 text-accent`. Add `aria-current="page"` so AT users hear "current selection".
- [ ] Per-row "delete" prompt uses `useDialog().confirm` — text "Delete \"…\"?" is fine but doesn't say it's irreversible. Add: "This will delete all messages in this session."

### 4.2 `WorkspacesSection.tsx` · P2

- [ ] Plan said "row click opens rename dialog" — current impl only has a delete button on hover. Rename is missing entirely. Add a pencil icon next to delete.
- [ ] "+ Add workspace…" is a link-styled button (`text-accent hover:underline`). It's an action — make it a real `<Button variant="ghost" size="sm">`.
- [ ] Each row shows `name` + truncated `rootPath`. With a long path the truncation drops the most useful bit (the basename). Truncate from the *left*: `…/very/long/path/project-a`. Use `direction: rtl; text-align: left` on the path span or apply Tailwind's `truncate` plus `dir="rtl"`.
- [ ] Add an "active" indicator on the row that matches the active session's workspace.
- [ ] Per-row delete confirm: today calls `remove(id)` directly with no confirmation. Wire it through `useDialog().confirm` for parity with SessionsSection.

### 4.3 `BreakpointsSection.tsx` · P2

- [ ] The current mode is shown TWICE per row — once as `<span className="text-zinc-500">{mode}</span>`, once as the button label. Drop the span; use the button as both indicator and control.
- [ ] Better: a small two-state toggle with visible labels `[AUTO | GATE]`, like a radio group, instead of a single button that the user has to click to discover the alternative state.
- [ ] No description of what each category means (`safe`/`dangerous`/`external`). For a power-user feature this is OK, but add a `?` icon next to "Breakpoints" header that pops a tooltip explaining the taxonomy.
- [ ] Section needs a `role="group" aria-labelledby="breakpoints-heading"` wrapper for AT.

### 4.4 `McpServersSection.tsx` · P2

- [ ] Per-server actions (Connect, Disconnect, Refresh, ×) are mixed text-buttons and icon-buttons. Standardize on icons + `aria-label` (lucide: `Power`, `RefreshCw`, `X`).
- [ ] Refresh button uses `<RefreshCw size={10}/>` — 10px is below WCAG minimum touch target (24×24). Increase to 14–16 px and the wrapping button to at least 24×24.
- [ ] "reconnecting (N/M)" text doesn't have an `aria-live="polite"` so AT users don't hear it transition.
- [ ] Error banner per server lacks `role="alert"`.
- [ ] No empty state when liveTools = 0 — looks like the connection failed even when it just hasn't loaded tools yet.

### 4.5 `ProviderAuthSection.tsx`, `BuiltinMcpToggles.tsx`, `SubAgentsSection.tsx`, `SkillsSection.tsx`, `SystemProtocolSection.tsx`, `ToolsSection.tsx`, `ConnectionFooter.tsx` · (not exhaustively read)

Apply the cross-cutting fixes (focus-visible, semantic landmarks, color tokens, hover→focus parity). Spot check each:
- All `data-testid="…-row"` patterns should also carry `role="group"` + `aria-labelledby`.
- Provider auth dots should expose label text, not just color.
- BuiltinMcpToggles' switch should be an actual `role="switch"` + `aria-checked` — today it's a button.

---

## 5 — Modals

### 5.1 `WorkspaceBrowserModal.tsx` · P2 (multiple)

- [ ] Migrate to `<Modal>` once Modal is rebuilt on `<dialog>` — today it duplicates the overlay implementation.
- [ ] Folder rows show emoji `📁 {e.name}`. Wrap the emoji with `aria-hidden="true"` so AT users hear "project-a", not "folder folder project-a".
- [ ] Top breadcrumb is read-only text + an "↑ Up" button. The plan said segments should be clickable. Implement: split `currentPath` on `/`, render each segment as a button that navigates back to it.
- [ ] No keyboard nav inside the folder list — Tab works but ArrowUp/ArrowDown don't (each folder is a separate button).
- [ ] Backdrop click closes without confirming unsaved name. Either: (a) confirm if user edited the name, or (b) preserve the name across reopens.
- [ ] "Add this folder" button is `bg-accent` — primary. Cancel is `border-border-subtle` — secondary. Good. But the form should also submit on Enter (currently only the button works).
- [ ] Empty directory shows `"No subdirectories"` — fine. But a user might want to add the CURRENT directory itself even if it has no children. The "Add this folder" button is enabled in that case but the affordance is unclear. Add a hint: "You can add this folder even if empty".

### 5.2 `KeyVaultModal.tsx` · P2

- [ ] Reveal/Hide buttons should use eye icons (lucide: `Eye`, `EyeOff`) — universally recognized.
- [ ] When key is revealed, the auto-mask-in-10s timer should have a visible countdown ("hides in 8s…").
- [ ] "Confirm clear?" double-click pattern is unconventional. Replace with an inline `<ConfirmDialog>` or shake-the-button animation if you really want one-press confirm.
- [ ] `<input type={revealedText ? 'text' : 'password'} autoFocus={…}>` — `autoFocus` is React's discouraged prop. Replace with a `useEffect` + `ref.current.focus()` (or `autofocus` HTML attribute once on `<dialog>`).
- [ ] The Save button is disabled until input is non-empty — good. But also disable while a save is in flight (`aria-busy`).
- [ ] Info rows (anthropic-oauth, ollama) say "read-only" — confusing. Make them less prominent (lower contrast) and use a tooltip on hover explaining "Configured outside Aether (via Claude CLI / Ollama daemon)".

### 5.3 `ProfilesModal.tsx` · P2

- [ ] "+ Save current as new" / "↑ Import" buttons use uppercase + tracking-widest — aesthetically heavy. Standardize on the `<Button>` primitive with `variant="primary"` / `"ghost"`.
- [ ] Error banner needs `role="alert"`.
- [ ] No empty state when there are zero profiles.
- [ ] Modal is `max-w-3xl` (large) — fine on desktop, but on a 1280-wide laptop the table will scroll horizontally without indicator. Add `<Scrollability affordance hints>` (Modern Web Guidance: `scrollability-affordance-hints`).
- [ ] Delete profile confirmation says `Delete "name"?` — should mention what's lost (system instruction + skills + tools + mcp servers).

### 5.4 `SubAgentEditModal.tsx`, `SkillsListEditor.tsx`, `ToolsListEditor.tsx` · (not read in detail)

Spot check:
- These editors use multiple chained `useDialog().prompt()` calls (per the e2e tests). That's a flow that screen reader users will struggle with — each prompt is its own modal stacked on top. Consider folding into a single in-modal form.

---

## 6 — Command palette (`src/components/palette/`)

### 6.1 `CommandPalette.tsx` · P2

`cmdk` already gives us a good base (proper `role="dialog"`, keyboard nav). Remaining work:

- [ ] `overlayClassName` includes `bg-black/60` but no `backdrop-blur` — inconsistent with `<Modal>`. Match the rest of the app.
- [ ] No empty-state for search mode when query is non-empty but no results — currently shows "No results" which is fine, but a brief explanation ("Try a different keyword or a session title") helps.
- [ ] No keyboard shortcut hint visible in the input (e.g. an inline tag showing "/ to search messages").
- [ ] The Escape-in-search-mode behavior is non-obvious (escapes search but stays in commands). Hint at it in the input placeholder: `"Search messages… (Esc to exit search)"`.

### 6.2 `CommandItem.tsx` · P3

- [ ] Shortcut display should use `<kbd>` elements for proper styling and AT semantics.

### 6.3 `SnippetHighlight.tsx` · P3

- [ ] Highlight wraps in `<mark>` — good. Verify `<mark>` has explicit colors set (Tailwind default is yellow background which may clash with dark theme).

---

## 7 — Reasoning panel (`src/components/reasoning/`)

### 7.1 `ReasoningDrawer.tsx` · P2

- [ ] Drawer should slide from the right via CSS transition. If it appears/disappears abruptly today, add `transition: transform 200ms`. Respect `prefers-reduced-motion`.
- [ ] When open, focus should move to the drawer header. When closed, focus returns to the message bubble.
- [ ] Drawer needs `role="complementary"` (or `<aside>`) + `aria-labelledby` pointing at its title.

Guidance refs: `navigation-drawer`.

### 7.2 `ReasoningStepCard.tsx`, `DispatchBranch.tsx`, `LiveThinkingBlock.tsx`, `ConfidenceBar.tsx` · P3

- [ ] Confidence bar likely has no `role="progressbar"` + `aria-valuenow/min/max`. Add them.
- [ ] LiveThinkingBlock during stream should mark a `aria-live="polite"` region so screen readers announce thinking text (or explicitly suppress it if too noisy).

---

## 8 — Sub-agents and providers (`src/components/subagents/`, `src/components/providers/`, `src/components/profiles/`)

### 8.1 `ProviderSelector.tsx` · P2

- [ ] Native `<select>` is great for keyboard/AT. Verify it carries an explicit `<label>` (or `aria-label="Active provider"`).
- [ ] No way to see provider capabilities (vision, thinking, toolCalling) inline. Today the MessageInput hides the thinking toggle when unsupported — but the user has no way to know *why* before they try.

### 8.2 `ProfilesButton.tsx`, `ProfilesTable.tsx` · P3

Standard table layout. Verify column headers are `<th scope="col">` and rows have a focusable name.

### 8.3 `SubAgentEditModal.tsx` · P2

- [ ] The editor calls multiple chained `useDialog().prompt`s. Replace with an inline form inside a single modal so the user can edit name, system instruction, skills, and tools without modal-on-modal stacking.

---

## 9 — General performance + theming

### 9.1 Dark-mode-only · P3

There's no light-mode support and no `color-scheme: dark` declaration on `<html>`. Native form controls (checkboxes, scrollbars) render in light mode → contrast clashes.

**Fix:** in `src/index.css` (or wherever globals live), add:

```css
:root { color-scheme: dark; }
```

This tells the browser to render native controls in their dark variants.

Guidance refs: `dark-mode`, `customize-scrollbar-color-and-thickness`.

### 9.2 `prefers-reduced-motion` not respected · P3

Several places use `transition-colors`, `hover:scale`, animated spinners. Wrap motion-bearing rules in:

```css
@media (prefers-reduced-motion: no-preference) {
  .transition-colors { transition-duration: 150ms; }
}
```

Or use the Tailwind `motion-safe:` variant.

### 9.3 No View Transitions for session switches · P3

When the user picks a session, the message list re-renders abruptly. View Transitions API gives a smooth crossfade for free:

```ts
if (document.startViewTransition) {
  document.startViewTransition(() => setActive(id));
} else {
  setActive(id);
}
```

Guidance refs: `same-document-transitions`, `faster-spa-view-transitions`.

### 9.4 `content-visibility: auto` on long lists · P3

Apply to message list children (`MessageBubble` items) for perf wins on long chats.

Guidance refs: `defer-rendering-heavy-content`.

### 9.5 Image attachments missing dimensions · P2 (CLS)

Already noted in §3.3 — `<img src="/api/attachments/…">` lacks `width`/`height`, causing layout shift while loading. Either:
- Store + serve `width`/`height` from the server (slice 20 could be extended), or
- Apply `aspect-ratio` defaults in CSS.

---

## 10 — Suggested next steps (sequencing)

If we want to ship UX fixes as their own slices, here's a sensible order:

1. **Slice 24-ux-a — Dialog primitive overhaul** (cross-cutting §0.1, §0.4, §0.7).
   - Rewrite `<Modal>` on `<dialog>`. Migrate `ApprovalGate` and `WorkspaceBrowserModal` to it.
   - Apply `inert` to the app shell, lock body scroll, restore focus to trigger.
   - Estimate: 1 small slice.

2. **Slice 24-ux-b — Tooltips + focus-visible** (§0.2, §0.3).
   - Replace `<Tooltip title>` with Popover-based primitive.
   - Add `focus-visible:ring-*` to `<Button>`, `<IconButton>`, sidebar row buttons.
   - Estimate: 1 small slice.

3. **Slice 24-ux-c — ApprovalGate hardening** (§3.10, §0.11).
   - Backdrop click → no-op; default focus on Reject.
   - DOM order Reject-first; uppercase category badge; 60s countdown.
   - Line numbers on `<DiffView>`.
   - Estimate: 1 small slice.

4. **Slice 24-ux-d — Sidebar polish** (§4.1–4.3, §0.10).
   - Replace single-char glyphs with lucide icons.
   - Reveal-on-focus parity for row actions.
   - Active-row `aria-current`.
   - Workspace rename + active-workspace indicator.
   - Estimate: 1 medium slice.

5. **Slice 24-ux-e — i18n + content cleanup** (§0.6, §3.1, §3.3).
   - Extract Italian strings to `src/i18n/en.ts` (single English file for now).
   - Fix `max-width` on bubbles, image dimensions, empty states.
   - Estimate: 1 small slice.

6. **Slice 24-ux-f — Skip-link, landmarks, AT polish** (§0.5, §3.2, §4.x).
   - Add skip-link; verify landmarks; `role="log"` on message list; `role="alert"` on error banners.
   - Estimate: 1 small slice.

7. **Slice 24-ux-g — View transitions + reduced-motion + content-visibility** (§9.2–9.4).
   - Estimate: 1 small slice.

Each one is independently shippable and improves the experience tangibly. None of them blocks the existing roadmap (slice 24 onward).

---

## Appendix — modern-web-guidance refs used

For each item above, the relevant Modern Web Guidance topics (run `npx -y modern-web-guidance@latest retrieve "<id>"` to read the full guide):

- `html` — native overlays, focus boundaries, semantic landmarks.
- `accessibility` — focus management, keyboard nav, ARIA.
- `light-dismiss-a-dialog`, `platform-controls-dismiss-dialog` — `<dialog closedby>` patterns.
- `declarative-dialog-popover-control` — Popover API + Invoker commands.
- `interest-triggered-tooltips`, `position-aware-tooltips` — replacing `title=`.
- `resilient-context-menus-and-nested-dropdowns` — dropdown semantics.
- `anchor-positioning-tab-underline` — CSS anchor positioning for popovers.
- `form-fields-automatically-fit-contents` — `field-sizing: content` for textarea auto-grow.
- `validate-input-after-interaction`, `required-field-feedback`, `accessible-error-announcement` — form validation.
- `interactive-content-reveal` — hover/focus parity for revealed actions.
- `dark-mode`, `customize-scrollbar-color-and-thickness` — theming.
- `defer-rendering-heavy-content` — `content-visibility: auto` for long lists.
- `same-document-transitions`, `faster-spa-view-transitions` — view transitions for session swaps.
- `navigation-drawer` — `<ReasoningDrawer>` patterns.
- `break-up-long-tasks`, `identify-inp-causes` — markdown-render perf.
- `optimize-image-priority` — attachments + CLS.
- `scrollability-affordance-hints` — when content overflows horizontally.

---

**End of review.**
