# Spettro Invisibile — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reskin Aether with the "Spettro Invisibile" palette — zinc surfaces + three semantic accents (disclosure violet / manipulation orange / heritage-CLI green) replacing the single green accent — with **zero functional changes**.

**Architecture:** Drive everything from `src/styles/theme.css` tokens. Surfaces keep their existing token *names* (only values change → most components need no edit). The single `--color-accent` is split into `--color-disclosure` / `--color-manipulation` / `--color-cli`; every `accent` className in components is remapped to the correct semantic token. Add a `.glass` utility + hover-glow utilities in `components.css`. Text already matches (`zinc-100`=`#F4F4F5`, `zinc-400`=`#A1A1AA`) so text needs no change.

**Tech Stack:** Tailwind CSS v4 (`@theme` tokens → `bg-/text-/border-<name>` + `/NN` opacity), React 19, Vitest (frontend project, jsdom). Verify with `npx tsc --noEmit` and `npx vitest run --project frontend`.

**Constraint:** Presentation only. No changes to handlers, state, data-flow, or functional markup. The ONLY test edits allowed are color-class assertions (e.g. `bg-accent`).

**Note on TDD:** A color reskin has no behavior to test-first. The per-task verification gate is therefore: `tsc` clean + the affected frontend tests still green (updating only color-class assertions) + final manual visual check. Commit after each task.

---

## Semantic mapping (decision table — applied across all tasks)

Rule: **reveal/state/identity/metadata/selection** → `disclosure` (violet). **action/alters state/active input focus/armable control** → `manipulation` (orange). **raw CLI/tool output text** → `cli` (green). Decorative → `zinc` (neutral).

---

### Task 1: Token foundation (`theme.css`)

**Files:**
- Modify: `src/styles/theme.css`

- [ ] **Step 1: Replace the `@theme` body**

Replace the surface scale values, keep border/status/fonts, repoint `--color-accent`, and add the three semantic accents:

```css
@theme {
  /* Surfaces — "Spettro Invisibile" zinc scale (void → ether) */
  --color-surface-0: #09090B;
  --color-surface-1: #09090B;
  --color-surface-2: #18181B;
  --color-surface-3: #1F1F23;
  --color-surface-4: #27272A;
  --color-surface-5: #3F3F46;

  /* Status colors — unchanged (state, not brand) */
  --color-status-online: #22c55e;
  --color-status-connecting: #eab308;
  --color-status-offline: #71717a;
  --color-status-error: #ef4444;

  /* Borders — unchanged */
  --color-border-subtle: #27272A;
  --color-border-default: #3F3F46;

  /* Semantic accents */
  --color-disclosure: #B388FF;   /* reveal the invisible */
  --color-manipulation: #FF6D00; /* act / alter state */
  --color-cli: #00E676;          /* raw CLI/tool output ONLY */
  /* Safety net for any not-yet-migrated usage; target is zero `accent` left. */
  --color-accent: #FF6D00;

  /* Typography — unchanged */
  --font-sans: "Inter", system-ui, sans-serif;
  --font-mono: "JetBrains Mono", monospace;
}
```

- [ ] **Step 2: Verify build/type-check**

Run: `npx tsc --noEmit`
Expected: exit 0. (Tailwind generates `bg-disclosure`, `text-manipulation`, `bg-cli`, etc.)

- [ ] **Step 3: Commit**

```bash
git add src/styles/theme.css
git commit -m "feat(theme): Spettro Invisibile tokens (zinc surfaces + 3 semantic accents)"
```

---

### Task 2: CSS utilities (`components.css`)

**Files:**
- Modify: `src/styles/components.css`

- [ ] **Step 1: Add glass + hover-glow utilities and update the chat scrollbar accent**

In the `@layer components { … }` block add:

```css
  /* Glassmorphism — bars & overlays only (never chat bubbles / code). */
  .glass { background: color-mix(in oklab, var(--color-surface-2) 72%, transparent); backdrop-filter: blur(7px); }
  /* Hover "energy": illuminate the border in the element's semantic color. */
  .glow-manip { transition: box-shadow .15s, border-color .15s; }
  .glow-manip:hover { border-color: var(--color-manipulation); box-shadow: 0 0 0 1px var(--color-manipulation), 0 0 12px -3px var(--color-manipulation); }
  .glow-disc { transition: box-shadow .15s, border-color .15s; }
  .glow-disc:hover { border-color: var(--color-disclosure); box-shadow: 0 0 0 1px var(--color-disclosure), 0 0 12px -3px var(--color-disclosure); }
  @media (prefers-reduced-motion: reduce) { .glow-manip, .glow-disc { transition: none; } }
```

And change the chat scrollbar hover thumb (currently `var(--color-accent)`) to disclosure:

```css
  .chat-scroll::-webkit-scrollbar-thumb:hover { background: var(--color-disclosure); }
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: exit 0.

- [ ] **Step 3: Commit**

```bash
git add src/styles/components.css
git commit -m "feat(theme): glass + hover-glow utilities; disclosure scrollbar"
```

---

### Task 3: Chat surface remap

**Files:** `src/components/chat/MessageBubble.tsx`, `MessageInput.tsx`, `StreamingIndicator.tsx`, `ToolCallBanner.tsx`, `AttachmentDropZone.tsx`, `ComposerModelPill.tsx`, `EmptyState.tsx`

Apply these exact `className` replacements (left → right):

**MessageBubble.tsx**
- `:57` sender label (assistant identity → disclosure): `text-accent/80` → `text-disclosure/80`
- `:68` user bubble (your input/action → manipulation): `bg-accent/10 border border-accent/25` → `bg-manipulation/10 border border-manipulation/30`
- `:123` reasoning button (reveal → disclosure): `hover:text-accent` → `hover:text-disclosure`
- `:160` Resume button (action → manipulation): `bg-accent/20 hover:bg-accent/30` → `bg-manipulation/20 hover:bg-manipulation/30`

**MessageInput.tsx**
- `:137` composer focus (action surface → manipulation): `focus-within:border-accent/50 focus-within:ring-1 focus-within:ring-accent/40` → `focus-within:border-manipulation/50 focus-within:ring-1 focus-within:ring-manipulation/40`
- `:180` Thinking toggle active (reveal → disclosure): `bg-accent/15 text-accent` → `bg-disclosure/15 text-disclosure`
- `:213` Send button (action → manipulation): `bg-accent/20 hover:bg-accent/30 text-accent` → `bg-manipulation/20 hover:bg-manipulation/30 text-manipulation`

**StreamingIndicator.tsx**
- `:5` blinking cursor (model producing → disclosure): `bg-accent` → `bg-disclosure`

**ToolCallBanner.tsx**
- `:15` tool-call banner (action in progress → manipulation): `border-accent/40` → `border-manipulation/40`

**AttachmentDropZone.tsx**
- `:48` drop overlay (injecting content → manipulation): `bg-accent/10 border-2 border-dashed border-accent` → `bg-manipulation/10 border-2 border-dashed border-manipulation`
- `:50` drop label: `border border-accent/40 … text-accent` → `border border-manipulation/40 … text-manipulation`

**ComposerModelPill.tsx**
- `:73` active model check (selection indicator → disclosure): `isActive ? 'text-accent'` → `isActive ? 'text-disclosure'`

**EmptyState.tsx**
- `:5` brand label (identity → disclosure): `text-accent` → `text-disclosure`

- [ ] **Step 1: Apply all replacements above.**
- [ ] **Step 2: Type-check** — Run: `npx tsc --noEmit` → exit 0.
- [ ] **Step 3: Tests** — Run: `npx vitest run --project frontend src/components/chat` → all green (no color-class assertions exist in chat tests; behavior unchanged).
- [ ] **Step 4: Commit**

```bash
git add src/components/chat
git commit -m "feat(theme): remap chat accents (manipulation actions / disclosure reveals)"
```

---

### Task 4: Reasoning & metadata (disclosure)

**Files:** `src/components/reasoning/ReasoningDrawer.tsx`, `ReasoningStepCard.tsx`, `ConfidenceBar.tsx`

Reasoning is the disclosure surface. `ConfidenceBar` has a remap; the drawer/step get *new* disclosure accents (additive, not behavioral).

- `ConfidenceBar.tsx:21` (metadata reveal → disclosure): `bg-accent` → `bg-disclosure`
- `ReasoningDrawer.tsx` header `<span className="mono-label">Reasoning</span>`: add disclosure color → `className="mono-label text-disclosure"`.
- `ReasoningStepCard.tsx` step-type label (the small uppercase `type` text): add `text-disclosure` to that label's className, and tint the card border on hover via `glow-disc` on the card root. (Read the file; apply to the existing label span + card container — do not change structure.)

- [ ] **Step 1: Apply the changes above** (read each file first; change only color classNames, keep markup/logic).
- [ ] **Step 2: Type-check** — `npx tsc --noEmit` → exit 0.
- [ ] **Step 3: Tests** — `npx vitest run --project frontend src/components/reasoning` → green.
- [ ] **Step 4: Commit**

```bash
git add src/components/reasoning
git commit -m "feat(theme): disclosure accents for reasoning & confidence"
```

---

### Task 5: Sidebar remap

**Files:** `SessionsSection.tsx`, `BreakpointsSection.tsx`, `BuiltinMcpToggles.tsx`, `McpServersSection.tsx`, `SubAgentsSection.tsx`, `SystemProtocolSection.tsx`, `WorkspacesSection.tsx`, `SubAgentEditModal.tsx` (all under `src/components/sidebar/` except the modal under `src/components/subagents/`)

- `SessionsSection.tsx:29` active session (selection indicator → disclosure): `'bg-accent/10 border-accent/40 text-accent'` → `'bg-disclosure/10 border-disclosure/40 text-disclosure'`
- `BreakpointsSection.tsx:58` active mode segment (execution control → manipulation): `'bg-accent text-black'` → `'bg-manipulation text-black'`
- `BuiltinMcpToggles.tsx:60` enabled tool (armed capability → manipulation): `'bg-accent/20 text-accent border-accent/40'` → `'bg-manipulation/20 text-manipulation border-manipulation/40'`
- `McpServersSection.tsx:95` refresh icon (action → manipulation): `text-accent hover:text-white` → `text-manipulation hover:text-white`
- `SubAgentsSection.tsx:70` hover border (interactive → manipulation glow): `hover:border-accent/40` → `hover:border-manipulation/40`
- `SystemProtocolSection.tsx:17` system-prompt textarea focus (disclosure surface → disclosure): `focus:border-accent` → `focus:border-disclosure`
- `WorkspacesSection.tsx:46` "+ add" link (action → manipulation): `text-accent hover:underline` → `text-manipulation hover:underline`
- `WorkspacesSection.tsx:62` active workspace (selection → disclosure): `'bg-accent/10 border-accent/40 text-accent'` → `'bg-disclosure/10 border-disclosure/40 text-disclosure'`
- `SubAgentEditModal.tsx:104` and `:120` "+ add skill/tool" links (action → manipulation): `text-accent hover:text-white` → `text-manipulation hover:text-white`

- [ ] **Step 1: Apply all replacements above.**
- [ ] **Step 2: Type-check** — `npx tsc --noEmit` → exit 0.
- [ ] **Step 3: Tests** — `npx vitest run --project frontend src/components/sidebar src/components/subagents` → green.
- [ ] **Step 4: Commit**

```bash
git add src/components/sidebar src/components/subagents
git commit -m "feat(theme): remap sidebar accents (disclosure selections / manipulation controls)"
```

---

### Task 6: Modals & UI primitives

**Files:** `profiles/KeyVaultModal.tsx`, `profiles/ProfilesTable.tsx`, `providers/OllamaEndpointsModal.tsx`, `palette/SnippetHighlight.tsx`, `ui/Button.tsx`, `ui/PromptDialog.tsx`, `ui/focus.ts`, `App.tsx`; test: `ui/Button.test.tsx`

- `KeyVaultModal.tsx:150` input focus (active input → manipulation): `focus:ring-accent/60` → `focus:ring-manipulation/60`
- `KeyVaultModal.tsx:163` Save (action → manipulation): `bg-accent/15 text-accent hover:bg-accent/25` → `bg-manipulation/15 text-manipulation hover:bg-manipulation/25`
- `ProfilesTable.tsx:56` active row (selection → disclosure): `'bg-accent/5'` → `'bg-disclosure/5'`
- `ProfilesTable.tsx:60` active check (selection → disclosure): `text-accent` → `text-disclosure`
- `ProfilesTable.tsx:61` active name (selection → disclosure): `'text-accent font-bold'` → `'text-disclosure font-bold'`
- `ProfilesTable.tsx:70` Apply button (action → manipulation): `bg-accent/10 text-accent hover:bg-accent/20` → `bg-manipulation/10 text-manipulation hover:bg-manipulation/20`
- `OllamaEndpointsModal.tsx:105` and `:145` Save/Add (action → manipulation): `bg-accent/15 text-accent hover:bg-accent/25` → `bg-manipulation/15 text-manipulation hover:bg-manipulation/25`
- `SnippetHighlight.tsx:39` search match (reveal → disclosure): `bg-accent/30 text-white` → `bg-disclosure/30 text-white`
- `Button.tsx:11` primary (action → manipulation): `'bg-accent text-black hover:bg-accent/90'` → `'bg-manipulation text-black hover:bg-manipulation/90'`
- `PromptDialog.tsx:49` input focus (active input → manipulation): `focus:border-accent` → `focus:border-manipulation`
- `focus.ts:2` generic focus ring (active focus → manipulation): `focus-visible:ring-accent/70` → `focus-visible:ring-manipulation/70`
- `App.tsx:76` skip link (action → manipulation): `focus:bg-accent focus:text-black` → `focus:bg-manipulation focus:text-black`

- [ ] **Step 1: Apply all replacements above.**

- [ ] **Step 2: Update the Button color-class assertion**

In `src/components/ui/Button.test.tsx`, find the assertion checking the primary variant class (it references `bg-accent`) and change it to `bg-manipulation`. Read the file to get the exact matcher; update only that string.

- [ ] **Step 3: Type-check** — `npx tsc --noEmit` → exit 0.
- [ ] **Step 4: Tests** — `npx vitest run --project frontend src/components/ui src/components/profiles src/components/providers src/components/palette` → green (incl. updated Button test).
- [ ] **Step 5: Commit**

```bash
git add src/components/ui src/components/profiles src/components/providers src/components/palette src/App.tsx
git commit -m "feat(theme): remap modals & UI primitives; update Button color assertion"
```

---

### Task 7: Glassmorphism on bars & overlays

**Files:** `layout/TopBar.tsx`, `layout/Sidebar.tsx`, `reasoning/ReasoningDrawer.tsx`, `chat/ApprovalGate.tsx`, `palette/CommandPalette.tsx`, `layout/DialogHost.tsx` (apply only if it renders a panel surface)

Add the `glass` class to the bar/overlay surface elements (read each file; append `glass` to the existing surface container's className — keep all other classes and markup):
- TopBar header (`h-12 … bg-surface-2 …`) → add `glass`.
- Sidebar header (`h-12 … bg-surface-3 …`) → add `glass`.
- ReasoningDrawer `<aside>` (`bg-surface-2 …`) → add `glass`.
- ApprovalGate modal panel surface → add `glass`.
- CommandPalette panel surface → add `glass`.
- DialogHost modal panel surface (if present) → add `glass`.

Do **not** add `glass` to chat bubbles, code blocks, or the message thread.

- [ ] **Step 1: Apply `glass` to the surfaces above.**
- [ ] **Step 2: Type-check** — `npx tsc --noEmit` → exit 0.
- [ ] **Step 3: Tests** — `npx vitest run --project frontend src/components/layout src/components/chat src/components/palette` → green.
- [ ] **Step 4: Commit**

```bash
git add src/components/layout src/components/reasoning src/components/chat src/components/palette
git commit -m "feat(theme): subtle glassmorphism on top bars and overlays"
```

---

### Task 8: Full verification

**Files:** none (verification)

- [ ] **Step 1: No stray `accent` left** — Run: `grep -rn "accent" src/ --include="*.tsx" --include="*.ts" --include="*.css" | grep -v "\.test\." | grep -v "color-accent"` → Expected: empty (every component usage migrated; only the `--color-accent` safety-net token remains in `theme.css`).
- [ ] **Step 2: Type-check** — `npx tsc --noEmit` → exit 0.
- [ ] **Step 3: Full frontend suite** — `npx vitest run --project frontend` → all green.
- [ ] **Step 4: Manual visual check** (user, in browser via `npm run dev`): zinc surfaces over `#09090B`; **Invia/Approva** orange; **reasoning/thinking/labels/metadata** violet; **Terminal/tool raw output** green; hover-glow on manipulable borders; glass on the three top bars + overlays; long chat/code blocks remain flat & legible.

---

## Self-Review

- **Spec coverage:** §1a surfaces → Task 1. §1b accents → Task 1. §1c status unchanged → Task 1 (kept). §2 mapping → Tasks 3–6 (every grep hit assigned). §3 glass → Tasks 2 (+7 apply). §4 hover energy → Task 2 (utilities) applied via `glow-*` (Sidebar:70 uses it; add to other manipulable surfaces opportunistically). §5 fonts unchanged → no task (correct). §6 files → Tasks 1–7. §7 testing → Task 8.
- **Placeholder scan:** none — every edit has exact file:line + before→after.
- **Type consistency:** token names (`disclosure`/`manipulation`/`cli`) identical across all tasks; surface token names unchanged so untouched components keep working.
- **Coverage gap noted:** `StatusDot`/`status-online` intentionally NOT changed (state, not brand) — per spec §1c.
