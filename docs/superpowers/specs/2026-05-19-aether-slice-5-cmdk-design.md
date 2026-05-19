# Aether — Slice 5: Command Palette + Shortcuts (Design)

**Branch:** `feat/slice-5-cmdk`
**Date:** 2026-05-19
**Depends on:** slices 0–4 (UI primitives, dialog system, sessions store, profiles store, context store, ui store).

## Goal

Add a `cmdk`-driven command palette and a small set of global keyboard shortcuts that drive existing store actions across sessions, profiles, UI toggles, and context. Slice 5 must not introduce any new backend route or persistence layer.

## Non-goals

- Recently-used commands ranking / persistence.
- Per-route or dynamically-registered commands. All commands derive from store state.
- Theming variants. The palette uses existing theme tokens.
- Sub-palette modes ("press Enter, get a second list"). The catalog is flat.
- Search across messages or session content. Only command labels are searched.

## Decisions log

| # | Decision | Chosen | Rationale |
|---|---|---|---|
| 1 | Command scope | Sessions + Profiles + UI toggles + direct Context actions | Maximises perceived value while staying inside one slice |
| 2 | Registry pattern | Central declaration via `useCommands()` | Pure hook = trivial to test; no React-context plumbing |
| 3 | Global shortcuts | ⌘K (open), Esc (close), ⌘N (new session), ⌘B (toggle sidebar) | Minimal, matches industry conventions, avoids browser conflicts |
| 4 | Focus behaviour | Shortcuts always active (incl. in inputs); `preventDefault` on match | VS Code / Linear / Raycast convention |
| 5 | List shape | Flat list, one entry per session/profile | Single search input, no state machine, cmdk handles scoring |
| 6 | Context navigation | Direct actions (Add skill / tool / MCP, Edit system protocol) | Uniform with other actions, useful regardless of sidebar state |
| 7 | Recents | None | YAGNI; cmdk scoring is sufficient |
| 8 | Sidebar state ownership | Moved into `useUiStore` (was `App.tsx` `useState`) | Required so a global shortcut can toggle it |
| 9 | Run wrapper | `try { run() } catch {} finally { closePalette() }` | Stores already own their error state; palette must always close |
| 10 | Hidden vs disabled | Inapplicable commands are filtered out | Simpler keyboard nav, cleaner list |

## Architecture

### Library

[`cmdk@1.1.1`](https://cmdk.paco.me) is already in `dependencies`. It supplies:

- `<Command.Dialog>` — modal wrapper with focus trap
- `<Command.Input>` — search input
- `<Command.List>` / `<Command.Group>` / `<Command.Item>` — list + grouping
- `<Command.Empty>` — empty state
- Built-in fuzzy filter & up/down keyboard nav

We do **not** override its filter. We rely on its `value` matching against each item's `value` prop (set to the command label).

### State

`useUiStore` (existing, slice 2b) gains:

```ts
// state
paletteOpen: boolean;       // not persisted
sidebarOpen: boolean;       // persisted to localStorage, default true

// actions
openPalette(): void;
closePalette(): void;
togglePalette(): void;
setSidebarOpen(open: boolean): void;
toggleSidebar(): void;
```

`sidebarOpen` is hydrated on `initFromStorage()` (existing init action), key `aether.sidebarOpen`. Mirrors the existing `thinkingEnabled` persistence pattern.

### File layout

**New files**

| Path | Responsibility |
|---|---|
| `src/types/command.types.ts` | `Command` type — `{ id, group, label, icon?, shortcut?, run }` |
| `src/hooks/useCommands.ts` | Pure hook returning `Command[]` from the four stores |
| `src/hooks/useKeyboardShortcut.ts` | Attach a single `keydown` listener; cross-platform (Cmd vs Ctrl) |
| `src/hooks/useGlobalShortcuts.ts` | Composes the four ⌘K / Esc / ⌘N / ⌘B handlers |
| `src/components/palette/CommandPalette.tsx` | The palette dialog itself |
| `src/components/palette/CommandItem.tsx` | One row: icon + label + optional `⌘N` hint |
| `src/lib/context/addFlows.ts` | Shared add-skill / add-tool / add-mcp prompt chains (consumed by both sidebar sections and palette commands) |

**Modified files**

| Path | Change |
|---|---|
| `src/stores/ui.store.ts` | Add `paletteOpen` + `sidebarOpen` state and actions; hydrate `sidebarOpen` |
| `src/App.tsx` | Remove local `sidebarOpen` `useState`; read from store; mount `<CommandPalette />`; call `useGlobalShortcuts()` |
| `src/components/layout/TopBar.tsx` | `onToggleSidebar` now calls `useUiStore.toggleSidebar` (prop wiring source changes) |
| `src/components/ui/PromptDialog.tsx` | Add `multiline?: boolean` prop; renders `<textarea>` when true |
| `src/components/sidebar/SkillsSection.tsx` | Replace inline `handleAdd` with `addSkillFlow` from `lib/context/addFlows.ts` |
| `src/components/sidebar/ToolsSection.tsx` | Replace inline `handleAdd` with `addToolFlow` |
| `src/components/sidebar/McpServersSection.tsx` | Replace inline `handleAdd` with `addMcpFlow` |
| `e2e/smoke.spec.ts` | Append palette golden-path test |

No backend changes. No new API endpoints. No new MSW handlers.

## Types

```ts
// src/types/command.types.ts
import type { ComponentType, SVGProps } from 'react';

export type CommandGroup = 'sessions' | 'profiles' | 'ui' | 'context';

export interface Command {
  /** Stable id; for per-item commands, `${prefix}.${entityId}`. */
  id: string;
  group: CommandGroup;
  label: string;
  /** Optional Lucide icon component. */
  icon?: ComponentType<SVGProps<SVGSVGElement>>;
  /** Display-only shortcut hint, e.g. "⌘N". Does not register a binding. */
  shortcut?: string;
  /** Side-effect on Enter. May be async; rejection is swallowed by the palette. */
  run: () => void | Promise<void>;
}
```

## Hooks

### `useKeyboardShortcut`

```ts
// src/hooks/useKeyboardShortcut.ts
interface ShortcutBinding {
  /** Lowercase, e.g. "k", "n", "b", "escape" */
  key: string;
  /** Cross-platform: true means Cmd on Mac, Ctrl elsewhere. Default false. */
  mod?: boolean;
}

export function useKeyboardShortcut(
  binding: ShortcutBinding,
  handler: (e: KeyboardEvent) => void,
  enabled?: boolean,
): void;
```

Implementation:

- Mac detection: `navigator.platform.toLowerCase().includes('mac')` once, at module scope (cheap, no SSR).
- On `keydown` window listener: compare `event.key.toLowerCase()` to `binding.key`, and (if `mod`) the active modifier (`metaKey` on Mac, `ctrlKey` otherwise).
- When matched: call `event.preventDefault()` then `handler(event)`.
- `enabled` defaults to `true`; when `false`, the listener is removed.

### `useGlobalShortcuts`

Composes four `useKeyboardShortcut` calls:

| Binding | Action | Enabled when |
|---|---|---|
| `⌘/Ctrl + K` | `togglePalette()` | always |
| `Escape` | `closePalette()` | `paletteOpen === true` |
| `⌘/Ctrl + N` | `sessions.createSession()` then `setActive(new.id)` | always |
| `⌘/Ctrl + B` | `toggleSidebar()` | always |

`Escape` is intentionally scoped — when the palette is closed, other components (Modal, drawer) keep ownership of Escape.

### `useCommands`

Pure hook. Reads from `useSessionsStore`, `useProfilesStore`, `useUiStore`, `useContextStore` via shallow selectors. Returns a stable `Command[]`. Re-derives only when relevant state slices change.

Pseudocode:

```ts
export function useCommands(): Command[] {
  const sessions = useSessionsStore(useShallow(s => ({
    list: s.sessions, activeId: s.activeSessionId,
    create: s.createSession, setActive: s.setActive,
    rename: s.rename, remove: s.delete,
  })));
  const profiles = useProfilesStore(useShallow(s => ({
    list: s.profiles, activeId: s.activeProfileId,
    save: s.saveCurrent, apply: s.apply,
  })));
  const ui = useUiStore(useShallow(s => ({
    drawerOpen: s.reasoningDrawerOpen,
    openDrawer: s.openReasoningDrawer,
    toggleSidebar: s.toggleSidebar,
    thinking: s.thinkingEnabled,
    toggleThinking: s.toggleThinking,
    openProfilesModal: s.openProfilesModal,
  })));
  const ctx = useContextStore(useShallow(s => ({
    addSkill: s.addSkill,
    addTool: s.addTool,
    addMcp: s.addMcpServer,
    setSystem: s.setSystemInstruction,
  })));
  const dialog = useDialog();

  return useMemo(() => {
    const out: Command[] = [];
    /* push sessions group */
    /* push profiles group */
    /* push ui group */
    /* push context group */
    return out;
  }, [sessions, profiles, ui, ctx, dialog]);
}
```

Concrete contents per group — see **Command catalog** below.

## Command catalog

Notation: `id` · "label" · group · shortcut hint · icon · `run`.

### Sessions

| id | label | shortcut | icon | run | visible when |
|---|---|---|---|---|---|
| `sessions.new` | "New session" | ⌘N | `lucide:Plus` | `create()` then `setActive(new.id)` | always |
| `sessions.switch.<id>` | "Switch to: {title}" | — | `lucide:MessageSquare` | `setActive(id)` | one per session, excluding `activeSessionId` |
| `sessions.rename` | "Rename current session" | — | `lucide:Pencil` | `dialog.prompt` → `rename(activeId, name)` | `activeSessionId != null` |
| `sessions.delete` | "Delete current session" | — | `lucide:Trash2` | `dialog.confirm(destructive)` → `delete(activeId)` | `activeSessionId != null` |

### Profiles

| id | label | shortcut | icon | run | visible when |
|---|---|---|---|---|---|
| `profiles.open` | "Open profiles manager" | — | `lucide:FolderOpen` | `openProfilesModal()` | always |
| `profiles.saveNew` | "Save current as new profile…" | — | `lucide:Save` | `dialog.prompt` → `saveCurrent(name)` | always |
| `profiles.apply.<id>` | "Apply profile: {name}" | — | `lucide:Layers` | `apply(id)` | one per profile, excluding `activeProfileId` |

### UI

| id | label | shortcut | icon | run | visible when |
|---|---|---|---|---|---|
| `ui.toggleSidebar` | "Toggle sidebar" | ⌘B | `lucide:PanelLeft` | `toggleSidebar()` | always |
| `ui.toggleThinking` | "Toggle thinking" | — | `lucide:Brain` | `toggleThinking()` | always |
| `ui.openReasoning` | "Open reasoning drawer" | — | `lucide:Lightbulb` | `openReasoningDrawer()` | `reasoningDrawerOpen === false` |

### Context

The palette commands here reuse the exact prompt chains already implemented in `SkillsSection`, `ToolsSection`, and `McpServersSection`. They wrap those chains so they are reachable from anywhere.

| id | label | shortcut | icon | run | visible when |
|---|---|---|---|---|---|
| `context.addSkill` | "Add skill…" | — | `lucide:Sparkles` | `dialog.prompt(name)` → `addSkill(name)` | always |
| `context.addTool` | "Add tool…" | — | `lucide:Wrench` | `dialog.prompt(name)` → `dialog.prompt(version, default "1.0.0")` → `dialog.confirm(online)` → `addTool({ name, version, status })` | always |
| `context.addMcp` | "Add MCP server…" | — | `lucide:Plug` | `dialog.prompt(name)` → `dialog.prompt(url, default "http://localhost:8080/mcp")` → `addMcpServer({ name, url, status: 'connecting' })` | always |
| `context.editSystem` | "Edit system protocol" | — | `lucide:FileText` | `dialog.prompt({ multiline: true, defaultValue: current })` → `setSystemInstruction(text)` | always |

> **PromptDialog `multiline` flag:** slice 0's `PromptDialog` currently supports a single-line input. `context.editSystem` requires multiline. We extend `PromptDialog` with a `multiline?: boolean` prop (renders `<textarea>` instead of `<input>` when true). Single-line callers are unaffected.

> **Refactor opportunity (do it):** the two-step add flows duplicate logic between sidebar sections and palette commands. Extract a tiny helper module — `src/lib/context/addFlows.ts` — exposing `addSkillFlow`, `addToolFlow`, `addMcpFlow` that take `(dialog, store)` and run the prompt chain. Both call sites consume it. Verified by existing section tests + new palette tests.

## Components

### `<CommandPalette />`

- Reads `paletteOpen` + `closePalette` from `useUiStore`.
- Reads commands via `useCommands()`.
- Renders nothing when `paletteOpen === false`.
- When open, renders `cmdk`'s `<Command.Dialog>` with:
  - `<Command.Input>` placeholder: "Type a command…"
  - `<Command.List>` containing one `<Command.Group heading="Sessions|Profiles|UI|Context">` per non-empty group
  - `<Command.Empty>` text: "No matching commands"
- Each item rendered via `<CommandItem>`; on select → wrapped runner.
- Wrapped runner:
  ```ts
  const runCmd = async (cmd: Command) => {
    try { await cmd.run(); } catch { /* store owns error */ }
    finally { closePalette(); }
  };
  ```
- Focus management: `<Command.Dialog>` traps focus + restores on close.

### `<CommandItem />`

Pure presentational. Props: `{ icon?, label, shortcut? }`. Layout: `icon` (12px) · `label` (flex-1) · `shortcut` (right-aligned, muted text).

Class palette uses existing tokens (`bg-surface-2`, `border-border-subtle`, `text-zinc-300`, `text-accent` on highlight) so the visual matches `Sidebar` / `Modal`.

## Data flow

```
User keystroke
   │
   ▼
useGlobalShortcuts (window keydown)
   │
   ├─ ⌘K  → ui.togglePalette()
   ├─ Esc → ui.closePalette()        (only when paletteOpen)
   ├─ ⌘N  → sessions.create() + setActive()
   └─ ⌘B  → ui.toggleSidebar()
   │
   ▼
ui.paletteOpen flips → App.tsx re-renders <CommandPalette open=true />
   │
   ▼
useCommands() reads stores → returns Command[]
   │
   ▼
cmdk filters by query, user Enter → runCmd(cmd)
   │
   ▼
cmd.run() (async)  ────────────────► store action ──► API call ──► state update
                                                                       │
                                                                       ▼
                                                              closePalette() (finally)
```

## Error handling

| Error source | Behaviour |
|---|---|
| Store action throws | Caught in `runCmd`. Store has already set its own `error` field (rendered by existing sidebar / modal error pills). Palette still closes. |
| `dialog.prompt` cancelled | Resolves to `null`; command returns early without running the store action. |
| Network failure during `apply` / `saveCurrent` | Same as above — handled by store. |
| Unhandled rejection inside `run` | Swallowed. Intentional — the palette is fire-and-forget; user re-opens if needed. |

## Persistence

- `paletteOpen` — never persisted.
- `sidebarOpen` — localStorage key `aether.sidebarOpen`, value `"1"` / `"0"`, hydrated in `useUiStore.initFromStorage`. Default `true` if absent / invalid.
- No new server-side persistence.

## Testing

### Unit (Vitest)

`src/hooks/useKeyboardShortcut.test.ts`
- Registers handler on mount; removes on unmount.
- Fires on matching `keydown` (Mac path: `metaKey` true).
- Fires on matching `keydown` (non-Mac path: `ctrlKey` true). Patch `navigator.platform` per test via `vi.stubGlobal`.
- Does **not** fire when modifier is wrong / key is wrong.
- Calls `preventDefault` when it fires.
- Honours `enabled === false`.

`src/hooks/useCommands.test.ts`
- All four groups present when stores populated.
- `sessions.switch.<id>` excludes active session.
- `profiles.apply.<id>` excludes active profile.
- `sessions.rename` + `sessions.delete` absent when `activeSessionId === null`.
- `ui.openReasoning` absent when `reasoningDrawerOpen === true`.
- `sessions.new` carries shortcut `"⌘N"`; `ui.toggleSidebar` carries `"⌘B"`.

`src/stores/ui.store.test.ts` (extend)
- `paletteOpen` default `false`; `open` / `close` / `toggle` work.
- `sidebarOpen` default `true`; `toggle` flips; `initFromStorage` hydrates from `"0"` → `false`; corrupted value falls back to default.

### Component (RTL + user-event)

`src/components/palette/CommandPalette.test.tsx`
- Renders nothing when `paletteOpen === false`.
- Renders dialog + input when `paletteOpen === true`.
- Group headings render for non-empty groups only.
- Typing "new" narrows the list (cmdk filtering smoke).
- Enter on highlighted item calls its `run` and closes palette.
- Esc closes palette without running.
- Error-throwing `run` still closes palette.
- Empty-list query shows `<Command.Empty>` text.

`src/components/palette/CommandItem.test.tsx`
- Renders label + shortcut when present.
- Omits shortcut span when absent.

### Integration (RTL + MSW)

`src/integration/palette.test.tsx` (new)
- Mount `<App />`, simulate ⌘K → palette opens.
- Run "New session" → MSW POST `/api/sessions` intercepted, new active session reflected in sidebar.
- Run "Apply profile: X" → MSW GET `/api/profiles/X` → context store hydrates → `thinkingEnabled` flips. Assert resulting UI state.
- ⌘B toggles sidebar visibility.
- ⌘N pressed while the chat textarea is focused → still creates session (focus-active path).

### E2E (Playwright)

Append one test to `e2e/smoke.spec.ts`:
- `palette: ⌘K → new session via palette` — open palette, type "new", Enter, assert new session row in sidebar.

> ⌘N / ⌘B are not covered in E2E (covered by integration). The single E2E test guards the rendering + keyboard path.

### Coverage

Per rewrite-spec DoD: ≥80% lines on `useCommands.ts`, `useKeyboardShortcut.ts`, `useGlobalShortcuts.ts`, `CommandPalette.tsx`.

## Cross-platform notes

- Modifier detection at module load: `const IS_MAC = /mac/i.test(navigator.platform)`. Used by `useKeyboardShortcut` and by shortcut-hint strings (`"⌘K"` on Mac, `"Ctrl+K"` elsewhere).
- Browser conflicts:
  - ⌘N (Mac) = New window. We `preventDefault` and own it inside the app; acceptable on focused tab.
  - ⌘B (Mac) = Show/hide bookmarks bar in Safari. Same handling.
  - ⌘K (Mac/Chrome) = Focus address bar. Same handling.
- These are documented in the spec because users may notice the OS-level shortcut no longer fires while the Aether tab is focused.

## Risks

| Risk | Mitigation |
|---|---|
| Existing components rely on `App.tsx` local `sidebarOpen` | Single consumer (`TopBar` via prop). Migration is a one-file refactor verified by existing `TopBar.test.tsx`. |
| `cmdk` v1.1.1 API drift | Pinned in `package.json`; tests cover real DOM behaviour. |
| ⌘N inside chat textarea breaks line-break composition | We `preventDefault`; users who want a newline inside chat use Shift+Enter (already the chat pattern). |
| Future shortcut explosion | Spec freezes Slice 5 at four shortcuts. Additions require their own RFC. |

## Definition of Done

- All new unit / component / integration tests green.
- `e2e/smoke.spec.ts` has 8 tests (7 existing + 1 new) and passes.
- `npm run lint` clean.
- Coverage ≥80% on the new files.
- Manual smoke via `npm run dev`: ⌘K opens palette, every command in catalog runs without console errors.
- One PR on `feat/slice-5-cmdk` against `main`, squash-friendly history.
