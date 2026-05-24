# Aether Slice 24 — UX/A11y Fixes (design spec)

**Date:** 2026-05-24
**Branch:** `feat/slice-24-ux-fixes`
**Source:** `UX_REVIEW.md` (component-by-component review, ~50 items across P1/P2/P3).

## Goal

Execute every UX/accessibility item catalogued in `UX_REVIEW.md` — including new-feature suggestions (Shiki syntax highlighting, lightbox prev/next, drawer animation, help tooltips) — as a single bundled slice. Resolve the Italian/English mix by extracting strings into `src/i18n/en.ts` (no framework). Land foundational primitives first (`<Modal>` → `<dialog>`, Popover-based `<Tooltip>`, focus-visible) so downstream component fixes can lean on them.

## Scope decisions

| Decision | Choice |
|---|---|
| Slice shape | Single bundled slice. One spec, one plan, one PR. |
| Severity scope | P1 + P2 + P3 (everything). |
| i18n | Centralized `src/i18n/en.ts` map + `t(key)` helper. No framework. |
| New-feature inclusions | In scope: Shiki, prev/next lightbox nav, drawer slide animation, help tooltips. |
| `<Modal>` rebuild | Native `<dialog>` with `showModal()` + `::backdrop` + `closedby="any"`. JS fallback for older Safari. |
| Backdrop in ApprovalGate | **No-op** (was Reject — footgun). |
| New SQLite migration | **010_attachment_dims.sql** adds `width` / `height` columns to `message_attachments`. |

## Architecture

### Foundational primitives (Section 1)

- **`src/components/ui/Modal.tsx`** — rebuilt on `<dialog>`:
  - `<dialog ref={…} className="…">` with `showModal()` / `close()` via ref.
  - `::backdrop` styled in `src/index.css` (dim + blur).
  - `closedby="any"` for light-dismiss where Modal is invoked with `dismissOnBackdrop`; otherwise omit so the backdrop is non-dismissing.
  - Sets `inert` on `#app-shell` and `<body class="overflow-hidden">` while open via a small `useEffect`.
  - Focus returns to trigger automatically (native `<dialog>` behavior).
  - Polyfill check for Safari < 17: feature-detect `'closedby' in HTMLDialogElement.prototype` and fall back to a `mousedown` outside-click listener.
- **`src/components/ui/Tooltip.tsx`** — Popover-API-based:
  - Wrapper `<span>` carries `popovertarget="tt-<id>"`; tooltip body is `<div popover="auto" id="tt-<id>">…</div>` portaled below.
  - On focus-visible, programmatically open via `el.showPopover()` (`interesttarget` is still origin-trial-only; we use the manual fallback uniformly for now).
  - Cleans up listeners on unmount.
- **`src/components/ui/Button.tsx`** + `IconButton.tsx` — base classes gain `focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/70 focus-visible:ring-offset-2 focus-visible:ring-offset-surface-1` (token shared via `src/components/ui/focus.ts` constant so sidebar row buttons can re-use the same class string).
- **`src/i18n/en.ts`** — single object map:
  ```ts
  export const messages = {
    messageInput: { placeholder: 'Type a message. Enter to send, Shift+Enter for newline.' },
    messageBubble: { streamInterrupted: 'Stream interrupted:', interrupted: 'Interrupted · ~{tokens} tokens', resume: 'Resume', showReasoning: 'Show reasoning' },
    sessionsSection: { fallbackTitle: 'New session', newSession: '+ New Session', deleteIrreversible: 'This will delete all messages in this session.' },
    chatView: { emptyState: 'No active session. Create one from the sidebar.' },
    workspaceChip: { noWorkspace: 'no workspace' },
    breakpoints: { helpText: 'Tools are auto-classified by name. "Safe" runs without prompts; "Dangerous" (file writes, shell exec, git push/rebase/reset) and "External" (override-only, for API calls) gate via the approval modal.' },
  } as const;
  ```
  - Helper: `t('messageInput.placeholder')` walks the dot-path; missing key returns the key string + `console.warn` (dev only).
- **`src/index.css`** — `:root { color-scheme: dark; }` + the `::backdrop` style.
- **Skip-link** in `src/App.tsx`: a `sr-only-focusable` `<a href="#message-input">Skip to message input</a>` at the top of the `<AppShell>`.

### Chat experience (Section 2)

- **`MessageInput.tsx`**
  - Textarea wrapper gets `id="message-input"` (skip-link target).
  - `field-sizing: content` via Tailwind arbitrary value, with JS fallback for older browsers (`onInput` sets `style.height = scrollHeight + 'px'` capped at 12 rows).
  - Token counter chip: `~{Math.ceil(value.length/4)} tokens` rendered in `aria-live="polite"`.
  - `t('messageInput.placeholder')` instead of literal Italian.
  - Vision-blocked Send button: `<Tooltip label="…">` + inline status text under the input.
  - Paste-image inline toast (`useUiStore.toast({ message: 'Pasted image attached' })` — new `toast` action with auto-dismiss in 3s).
  - Send/Stop swap wrapped in `motion-safe:transition-all motion-safe:duration-150`.
- **`MessageBubble.tsx`**
  - `max-w-[80%]` → `max-w-[65ch]`.
  - Token tooltip becomes `<Tooltip>`.
  - Italian → `t(…)`.
  - User messages: keep `whitespace-pre-wrap`, no markdown. Documented in a 1-line comment.
  - Show-reasoning emoji wrapped in `<span aria-hidden="true">`.
  - Markdown perf: while `isStreaming`, render plain text + StreamingIndicator. On first non-streaming render, switch to `<ReactMarkdown>`. Memoized `<ReactMarkdown>` keyed by message id.
  - Image dims: read `attachment.width` / `attachment.height` (new fields, see Section 6 migration); fall back to `aspect-ratio: 1 / 1` placeholder.
- **`AttachmentDropZone.tsx`**
  - Full-overlay drop hint when `active`: a centered card "Drop files to attach (max 5, 10 MB total)".
  - Listens to `useUiStore` modal flags and ignores drag events while any modal is open.
- **`AttachmentLightbox.tsx`**
  - `alt={a.name}`.
  - Prev/Next: read `useChatStore` for the parent message's attachments, build a cycling array, ←/→ keys + on-screen buttons.
  - Download / Open-in-new-tab buttons in a footer toolbar.
  - Dims displayed when known.
- **`MentionPopover.tsx`**
  - CSS anchor positioning: `position-anchor: --mention-anchor; position-try: flip-block;` (with `position` fallback for non-supporting browsers).
  - `scrollIntoView({ block: 'nearest' })` on active index change.
- **`MessageContextMenu.tsx`**
  - Viewport clamp: `Math.min(x, window.innerWidth - menuWidth - 8)`, same for y.
  - `<menu role="menu">` + `role="menuitem"` items.
  - `MessageBubble` listens for Shift+F10 on focus and opens menu at bubble's top-right.
  - On close, `previouslyFocused?.focus()`.

### Sidebar polish (Section 3)

- **Cross-section pattern** (apply to all `src/components/sidebar/*Section.tsx`):
  - `<nav>` or `<section role="group">` with `aria-labelledby="<section>-heading"`.
  - Header gets `id="<section>-heading"`.
  - Active row: `aria-current="true"`.
  - Hover-only actions → `group-focus-within:flex` (kept on hover too).
  - `@media (hover: none)` query in CSS keeps actions visible.
  - Row content text: new `text-mono-body` token (~11–12 px) defined in tailwind config; `text-[10px]` reserved for headers.
- **`Sidebar.tsx`**: replace `scrollbar-hide` with `scrollbar-width: thin`; add header dividers.
- **`SessionsSection.tsx`**: lucide `Download` / `Pencil` / `Trash2` icons; error banner `role="alert"`; delete confirm copy adds irreversibility line; New-Session disabled tooltip.
- **`WorkspacesSection.tsx`**: per-row rename (pencil); left-truncated path (`direction: rtl`); active-workspace highlight; delete via `useDialog().confirm`; "+ Add workspace…" → `<Button variant="ghost" size="sm">`.
- **`BreakpointsSection.tsx`**: radio-group `[AUTO|GATE]`; "?" help button with Popover content from `t('breakpoints.helpText')`.
- **`McpServersSection.tsx`**: lucide `Power`/`RefreshCw`/`X` ≥ 14 px on ≥ 24×24 buttons; reconnect banner `aria-live="polite"`; per-server error `role="alert"`; explicit "(no tools available)" empty state.
- **`ProviderAuthSection.tsx`**: status dots gain `aria-label`.
- **`BuiltinMcpToggles.tsx`**: toggle becomes `role="switch"` + `aria-checked`.

### Modals + ApprovalGate hardening (Section 4)

- **`ApprovalGate.tsx`**
  - Migrate to `<Modal>`.
  - Backdrop click → no-op (override Modal's `dismissOnBackdrop={false}` here).
  - Default focus on Reject; DOM order Reject-first then Approve.
  - Category badge: uppercase + letter-spaced.
  - 60-second countdown header text, refreshed every 1s via `useEffect` + `setInterval`.
  - Args `<pre tabindex="0">`.
  - Sticky checkbox label gets lucide `Clock` icon.
- **`DiffView.tsx`**
  - Gutter `<div>` per line for line numbers.
  - Shiki via dynamic import (`import('shiki')`) on first render; language inferred from `path` extension; result cached at module scope.
  - Toolbar header with path label + "Copy newText" + "Copy diff" buttons (`navigator.clipboard.writeText`).
- **`WorkspaceBrowserModal.tsx`**
  - Migrate to `<Modal>`.
  - 📁 emoji `aria-hidden="true"`.
  - Breadcrumb: split `currentPath` on `/`, each segment a `<button>`; drop standalone "↑ Up" once breadcrumb is in place.
  - Keyboard nav: ↑/↓ moves a `selectedIndex` state; Enter descends; Backspace goes up; Esc closes via Modal.
  - Form Enter submits.
  - Empty-dir hint text.
  - Unsaved-name guard: track `nameTouched` flag; if true + close requested, run `useDialog().confirm`.
- **`KeyVaultModal.tsx`**
  - Lucide `Eye`/`EyeOff` icons for reveal/hide buttons.
  - Reveal countdown text updates every 1s.
  - "Confirm clear?" replaced with `<ConfirmDialog>`.
  - `autoFocus` prop → `useEffect` + `ref.focus()`.
  - Save button `aria-busy={saving}`.
  - Info-row tooltip via `<Tooltip>`.
- **`ProfilesModal.tsx`**
  - Action buttons → standardized `<Button>` variants.
  - Error banner `role="alert"`.
  - Empty state.
  - Delete confirm copy enumerates what's lost.
  - Table horizontal scroll affordance: soft right-edge fade + `← scroll →` hint when overflow exists.
- **`SubAgentEditModal.tsx`**
  - Single in-modal form replacing the chained `dialog.prompt()` flow. Name input + system-instruction textarea + skills/tools editor sections inline.

### Command palette + reasoning (Section 5)

- **`CommandPalette.tsx`**: backdrop adds `backdrop-blur-sm`; placeholder hints at Esc-exits-search; `<kbd>⌘K</kbd>` in empty-state.
- **`CommandItem.tsx`**: shortcut display uses `<kbd>` elements.
- **`SnippetHighlight.tsx`**: explicit `<mark>` styling (`bg-accent/30 text-accent`).
- **`ReasoningDrawer.tsx`**: slide-in transform transition (motion-safe); `<aside aria-labelledby="reasoning-heading">` + `sr-only` h2; focus moves to drawer header on open, returns to message bubble on close.
- **`ConfidenceBar.tsx`**: `role="progressbar"` + aria-value attrs.
- **`LiveThinkingBlock.tsx`**: wrap in `aria-live="polite"`.
- **`ProviderSelector.tsx`**: explicit label; option suffix lists capabilities.
- **`TokenChip.tsx`**: `aria-label="Context size: N tokens"`; refine zustand selector to a memoized derived value.
- **`StatusDot.tsx`**: `aria-label` carrying status; visible `sr-only` span.

### Layout + performance + theming (Section 6)

- **`AppShell.tsx`**: drop `role="main"`; mount skip-link; sidebar collapse via `display: none` (kept mounted).
- **`TopBar.tsx`**: right cluster wrapped in `<div className="ml-auto flex items-center gap-2">`; `⌘K` chip next to title.
- **`Sidebar.tsx`**: thin scrollbar + section dividers (already noted).
- **`MessageList.tsx`**: container `role="log" aria-live="polite"`; child wrappers `content-visibility: auto; contain-intrinsic-size: auto 200px;`.
- **View Transitions**: `setActive(id)` and `openReasoningDrawer()` wrapped in `document.startViewTransition?.(...)` with fallback.
- **Color tokens migration**: in the components touched by this slice, replace raw `bg-zinc-9*` with `bg-surface-*` per a documented mapping table (added to `CLAUDE.md`).
- **CLS hygiene + new migration**:
  - **`server/db/migrations/010_attachment_dims.sql`**: `ALTER TABLE message_attachments ADD COLUMN width INTEGER; ADD COLUMN height INTEGER;`.
  - **`server/domain/history/history.store.ts`**: persist + return width/height in attachment reads.
  - **`server/routes/attachments.routes.ts`**: on POST, if `mime` starts with `image/`, measure via `image-size` package (already installed if available, else add `image-size@^2`). Store the result.
  - **FE attachment.types + chat.store**: include width/height in the `MessageAttachment` shape; rendered `<img>` uses them.
- **`<head>`**: `<meta name="theme-color" content="#0a0a0a">`.

### Testing strategy (Section 7)

**Server (vitest)**
- `attachments.routes.test.ts` +2: upload extracts width/height; GET returns dims.
- `migrate.test.ts`: bump to `[1..10]`.
- `history.store.test.ts` +1: appendAttachment persists width/height.

**Frontend (vitest + RTL + MSW)** — targeted, only new behaviors:
- `Modal.test.tsx` rewritten: 6 cases (open/close, ESC, backdrop dismiss, focus restore, `inert`, body scroll-lock).
- `Tooltip.test.tsx`: 3 cases (hover, focus-visible, ESC dismiss).
- `i18n.test.ts`: 2 cases (t() returns string, missing key returns key + warn).
- `ApprovalGate.test.tsx` +3: backdrop no-op, default focus Reject, countdown decrements.
- `WorkspaceBrowserModal.test.tsx` +3: breadcrumb segment navigates, ↑/↓ moves selection, unsaved-name guard.
- `KeyVaultModal.test.tsx` +2: reveal countdown visible, ConfirmDialog used for clear.
- `MessageInput.test.tsx` +3: textarea auto-grows, token chip updates, vision tooltip is Popover.
- `MessageBubble.test.tsx` +2: markdown not re-parsed while streaming, image renders with explicit dims.
- `BreakpointsSection.test.tsx` +1: radio group reflects current mode.
- `WorkspacesSection.test.tsx` +1: per-row rename flow.
- `DiffView.test.tsx` +2: line numbers, copy button.
- `AttachmentLightbox.test.tsx`: 3 cases (alt is filename, arrow keys cycle, Download triggers navigation).
- `MessageContextMenu.test.tsx` +1: clamped position near viewport edge.
- `ReasoningDrawer.test.tsx` +1: focus moves to header on open.

**Integration**
- `dialog-focus-return.integration.test.tsx`: open KeyVaultModal from sidebar → close → trigger focused.
- `i18n-coverage.integration.test.tsx`: render `<App />`, assert known Italian strings absent.

**Playwright** (extend `e2e/smoke.spec.ts`)
- ApprovalGate ESC closes.
- WorkspaceBrowserModal breadcrumb navigates.

**Out of scope**
- Visual snapshot tests.
- Color-contrast / WCAG audits (manual, post-merge).
- Animation timing (subjective verification).

## Error handling

| Scenario | Behavior |
|---|---|
| Shiki import fails | DiffView renders without highlighting (plain `<pre>`); console.warn once. |
| `image-size` measurement fails on upload | Persist with NULL width/height; FE falls back to `aspect-ratio: 1 / 1`. |
| `<dialog>` polyfill needed (Safari < 17) | Modal uses `mousedown` outside-click listener; `inert` polyfill via global `aria-hidden` toggle. |
| `i18n.t()` missing key | Returns the key string; `console.warn` in dev only. |
| `field-sizing: content` unsupported | JS auto-resize fallback runs. |
| `document.startViewTransition` unsupported | Direct state update; no transition. |
| `position-try` (anchor positioning) unsupported | Static `position: absolute` rendering; popovers don't auto-flip. |

## Acceptance criteria

1. Every modal in the app uses the native `<dialog>` element with focus trap, `inert` background, and body scroll lock.
2. No component uses `title=` for tooltip content. `<Tooltip>` is Popover-based.
3. Every interactive primitive (`Button`, `IconButton`, sidebar row buttons, dropdowns) shows a visible focus-visible ring.
4. All user-facing strings are in English (Italian strings removed). New `src/i18n/en.ts` map + `t()` helper drives them.
5. `ApprovalGate` backdrop is non-dismissing; default focus is Reject; a 60-second countdown is visible.
6. `WorkspaceBrowserModal` has a clickable breadcrumb, ↑/↓ keyboard nav, and a discard-unsaved-name guard.
7. `KeyVaultModal` uses `Eye`/`EyeOff` icons, shows a reveal-countdown, and uses `ConfirmDialog` for clear.
8. `DiffView` shows line numbers + Shiki syntax highlighting + copy buttons.
9. `AttachmentLightbox` supports prev/next via ←/→ keys and download.
10. Sidebar action buttons use lucide icons (no character glyphs); rows reveal on hover OR focus-within; touch devices keep them visible.
11. Message list announces new assistant messages via `role="log" aria-live="polite"`.
12. Image attachments render with explicit `width`/`height` (migration 010 persists dims).
13. View Transitions wrap session-switch and drawer-open.
14. `prefers-reduced-motion` honored everywhere.
15. Migration test asserts `[1..10]`.

## Out of scope

- New i18n languages (just English consolidation).
- Light mode (color-scheme stays dark).
- Re-skinning sidebar visual hierarchy beyond what's listed (still single-column, mono-label).
- Workspace-scoped breakpoints or tool policies (already deliberately deferred).
- WebMCP / Web LLM features.

## Branch

`feat/slice-24-ux-fixes` — created on top of `main` at SHA `c5e9986` (slice 23 merge).
