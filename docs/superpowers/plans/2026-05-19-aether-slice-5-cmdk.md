# Aether Slice 5 — Command Palette + Shortcuts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `cmdk`-driven command palette + four global keyboard shortcuts (⌘K, Esc, ⌘N, ⌘B) that drive existing store actions across sessions, profiles, UI toggles, and context. No backend changes; no new API endpoints.

**Architecture:** Central `useCommands()` hook reads all four stores (sessions/profiles/ui/context) and returns a flat `Command[]` with optional shortcut hints. Global `keydown` listeners installed once via `useGlobalShortcuts()` mounted in `App.tsx`. `useUiStore` gains `paletteOpen` + `sidebarOpen` state (the latter migrated out of `App.tsx` local state and persisted to localStorage). Sidebar add-flows extracted into `src/lib/context/addFlows.ts` so palette commands and sidebar buttons share one source of truth. `PromptDialog` gains a `multiline` flag so "Edit system protocol" can use a textarea.

**Tech Stack:** Zustand 5, cmdk 1.1.1, Vitest 4.1.6, RTL, user-event, MSW 2, Playwright. `lucide-react` icons. Existing `useDialog` from slice 0. Pattern collaudati da slice 2a / 2b / 3 / 4.

**Reference spec:** `docs/superpowers/specs/2026-05-19-aether-slice-5-cmdk-design.md`

**Branch:** `feat/slice-5-cmdk` (already checked out; spec already committed)

**Lavora con un solo branch dall'inizio alla fine; ogni Task termina con un commit verde su questo branch.**

---

## File structure (NEW unless marked MODIFY)

```
src/
  types/
    command.types.ts                            # NEW
  hooks/
    useKeyboardShortcut.ts                      # NEW
    useKeyboardShortcut.test.ts                 # NEW
    useGlobalShortcuts.ts                       # NEW
    useGlobalShortcuts.test.ts                  # NEW
    useCommands.ts                              # NEW
    useCommands.test.ts                         # NEW
    useDialog.ts                                # MODIFY: PromptOptions +multiline
  lib/context/
    addFlows.ts                                 # NEW (extracted from sections)
    addFlows.test.ts                            # NEW
  components/ui/
    PromptDialog.tsx                            # MODIFY: +multiline prop
    PromptDialog.test.tsx                       # MODIFY: +multiline tests
  components/layout/
    DialogHost.tsx                              # MODIFY: forward multiline
  components/palette/
    CommandItem.tsx                             # NEW
    CommandItem.test.tsx                        # NEW
    CommandPalette.tsx                          # NEW
    CommandPalette.test.tsx                     # NEW
  components/sidebar/
    SkillsSection.tsx                           # MODIFY: use addSkillFlow
    ToolsSection.tsx                            # MODIFY: use addToolFlow
    McpServersSection.tsx                       # MODIFY: use addMcpFlow
  stores/
    ui.store.ts                                 # MODIFY: +paletteOpen +sidebarOpen +toggleThinking
    ui.store.test.ts                            # MODIFY: new tests
  integration/
    palette.integration.test.tsx                # NEW
  App.tsx                                       # MODIFY: read sidebarOpen from store, mount palette + shortcuts
  App.test.tsx                                  # MODIFY: +palette presence test

e2e/
  smoke.spec.ts                                 # MODIFY: +palette golden-path test
```

No backend files modified. No new API endpoints.

---

## Phase A — Pre-flight

### Task A1: Verify branch and clean working tree

- [ ] **Step 1: Confirm branch + clean tree**

Run:

```bash
git rev-parse --abbrev-ref HEAD
git status --porcelain
```

Expected: branch is `feat/slice-5-cmdk`; the second command outputs nothing.

No commit in this task — pre-flight only.

---

## Phase B — PromptDialog multiline support

### Task B1: `PromptDialog` accepts `multiline` and renders `<textarea>`

**Files:**
- Modify: `src/components/ui/PromptDialog.tsx`
- Modify: `src/components/ui/PromptDialog.test.tsx`

- [ ] **Step 1: Append failing tests**

Append to the existing `describe('PromptDialog', ...)` block in `src/components/ui/PromptDialog.test.tsx`:

```tsx
  it('renders a textarea when multiline=true', () => {
    render(
      <PromptDialog
        open
        title="T"
        label="L"
        multiline
        onConfirm={() => {}}
        onCancel={() => {}}
      />,
    );
    const ta = screen.getByLabelText('L');
    expect(ta.tagName).toBe('TEXTAREA');
  });

  it('submits via the form button in multiline mode (Enter inserts newline)', async () => {
    const onConfirm = vi.fn();
    const user = userEvent.setup();
    render(
      <PromptDialog
        open
        title="T"
        label="L"
        multiline
        onConfirm={onConfirm}
        onCancel={() => {}}
      />,
    );
    const ta = screen.getByLabelText('L');
    await user.type(ta, 'line1{Enter}line2');
    await user.click(screen.getByRole('button', { name: /confirm/i }));
    expect(onConfirm).toHaveBeenCalledWith('line1\nline2');
  });
```

Make sure `screen`, `userEvent`, `vi` are imported (they should already be at the top — if not, add `import userEvent from '@testing-library/user-event';` and `import { vi } from 'vitest';`).

- [ ] **Step 2: Run tests — expect FAIL**

```bash
npx vitest run src/components/ui/PromptDialog.test.tsx
```

Expected: the two new tests FAIL (either rendering an `<input>` or unrecognised `multiline` prop).

- [ ] **Step 3: Implement multiline support**

Replace the contents of `src/components/ui/PromptDialog.tsx` with:

```tsx
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Modal } from './Modal';
import { Button } from './Button';

export interface PromptDialogProps {
  open: boolean;
  title: string;
  label: string;
  defaultValue?: string;
  placeholder?: string;
  required?: boolean;
  multiline?: boolean;
  onConfirm: (value: string) => void;
  onCancel: () => void;
}

export function PromptDialog({
  open,
  title,
  label,
  defaultValue = '',
  placeholder,
  required = false,
  multiline = false,
  onConfirm,
  onCancel,
}: PromptDialogProps) {
  const [value, setValue] = useState(defaultValue);
  const inputRef = useRef<HTMLInputElement | HTMLTextAreaElement>(null);

  useEffect(() => {
    if (open) {
      setValue(defaultValue);
      setTimeout(() => inputRef.current?.focus(), 10);
    }
  }, [open, defaultValue]);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (required && !value.trim()) return;
    onConfirm(value);
  };

  const canConfirm = !required || value.trim().length > 0;
  const fieldClass =
    'mt-1 w-full bg-zinc-900 border border-border-subtle rounded px-2 py-1.5 text-sm text-white outline-none focus:border-accent';

  return (
    <Modal open={open} onClose={onCancel} title={title}>
      <form onSubmit={submit} className="space-y-4">
        <label className="block">
          <span className="mono-label">{label}</span>
          {multiline ? (
            <textarea
              ref={inputRef as React.RefObject<HTMLTextAreaElement>}
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder={placeholder}
              rows={8}
              className={`${fieldClass} font-mono text-xs resize-y min-h-[160px]`}
            />
          ) : (
            <input
              ref={inputRef as React.RefObject<HTMLInputElement>}
              type="text"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder={placeholder}
              className={fieldClass}
            />
          )}
        </label>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onCancel}>Cancel</Button>
          <Button type="submit" disabled={!canConfirm}>Confirm</Button>
        </div>
      </form>
    </Modal>
  );
}
```

- [ ] **Step 4: Run tests — expect PASS**

```bash
npx vitest run src/components/ui/PromptDialog.test.tsx
```

Expected: all tests PASS (previous 7 + new 2 = 9).

- [ ] **Step 5: Commit**

```bash
git add src/components/ui/PromptDialog.tsx src/components/ui/PromptDialog.test.tsx
git commit -m "feat(slice-5): PromptDialog +multiline flag (renders textarea)"
```

---

### Task B2: `useDialog.prompt` forwards `multiline` to DialogHost

**Files:**
- Modify: `src/hooks/useDialog.ts`
- Modify: `src/components/layout/DialogHost.tsx`

- [ ] **Step 1: Update `useDialog.ts`**

Replace the `PromptOptions` type in `src/hooks/useDialog.ts` with:

```ts
type PromptOptions = {
  title: string;
  label: string;
  defaultValue?: string;
  placeholder?: string;
  required?: boolean;
  multiline?: boolean;
};
```

No other changes in this file — the spread (`...opts`) inside `prompt()` already forwards new fields.

- [ ] **Step 2: Update `DialogHost.tsx`**

Replace `src/components/layout/DialogHost.tsx` with:

```tsx
import { useDialog } from '@/src/hooks/useDialog';
import { PromptDialog } from '@/src/components/ui/PromptDialog';
import { ConfirmDialog } from '@/src/components/ui/ConfirmDialog';

export function DialogHost() {
  const { current } = useDialog();
  if (!current) return null;

  if (current.kind === 'prompt') {
    return (
      <PromptDialog
        open
        title={current.title}
        label={current.label}
        defaultValue={current.defaultValue}
        placeholder={current.placeholder}
        required={current.required}
        multiline={current.multiline}
        onConfirm={(v) => current.resolve(v)}
        onCancel={current.cancel}
      />
    );
  }

  return (
    <ConfirmDialog
      open
      title={current.title}
      message={current.message}
      confirmLabel={current.confirmLabel}
      cancelLabel={current.cancelLabel}
      destructive={current.destructive}
      onConfirm={() => current.resolve(true)}
      onCancel={current.cancel}
    />
  );
}
```

- [ ] **Step 3: Verify existing tests still pass**

```bash
npx vitest run src/components/layout/DialogHost.test.tsx src/hooks
```

Expected: PASS (no behavioural change for callers that don't use `multiline`).

- [ ] **Step 4: Commit**

```bash
git add src/hooks/useDialog.ts src/components/layout/DialogHost.tsx
git commit -m "feat(slice-5): useDialog.prompt forwards multiline to DialogHost"
```

---

## Phase C — `useUiStore` extension

### Task C1: `paletteOpen` + `sidebarOpen` + `toggleThinking` + localStorage hydration

**Files:**
- Modify: `src/stores/ui.store.ts`
- Modify: `src/stores/ui.store.test.ts`

- [ ] **Step 1: Append failing tests**

Append to `src/stores/ui.store.test.ts` (inside the existing `describe('useUiStore', ...)` block; if the existing test file doesn't have that block, wrap appropriately):

```ts
  it('paletteOpen defaults false; open/close/toggle work', () => {
    const s = useUiStore.getState();
    expect(s.paletteOpen).toBe(false);
    s.openPalette();
    expect(useUiStore.getState().paletteOpen).toBe(true);
    s.closePalette();
    expect(useUiStore.getState().paletteOpen).toBe(false);
    s.togglePalette();
    expect(useUiStore.getState().paletteOpen).toBe(true);
    s.togglePalette();
    expect(useUiStore.getState().paletteOpen).toBe(false);
  });

  it('sidebarOpen defaults true; toggle flips and persists', () => {
    const s = useUiStore.getState();
    expect(s.sidebarOpen).toBe(true);
    s.toggleSidebar();
    expect(useUiStore.getState().sidebarOpen).toBe(false);
    expect(localStorage.getItem('aether.sidebarOpen')).toBe('0');
    s.setSidebarOpen(true);
    expect(useUiStore.getState().sidebarOpen).toBe(true);
    expect(localStorage.getItem('aether.sidebarOpen')).toBe('1');
  });

  it('initFromStorage hydrates sidebarOpen from "0" and falls back to true on garbage', () => {
    localStorage.setItem('aether.sidebarOpen', '0');
    useUiStore.getState().initFromStorage();
    expect(useUiStore.getState().sidebarOpen).toBe(false);

    localStorage.setItem('aether.sidebarOpen', 'garbage');
    useUiStore.getState().initFromStorage();
    expect(useUiStore.getState().sidebarOpen).toBe(true);

    localStorage.removeItem('aether.sidebarOpen');
    useUiStore.getState().initFromStorage();
    expect(useUiStore.getState().sidebarOpen).toBe(true);
  });

  it('toggleThinking flips thinkingEnabled and persists', () => {
    expect(useUiStore.getState().thinkingEnabled).toBe(false);
    useUiStore.getState().toggleThinking();
    expect(useUiStore.getState().thinkingEnabled).toBe(true);
    expect(localStorage.getItem('aether.thinkingEnabled')).toBe('1');
    useUiStore.getState().toggleThinking();
    expect(useUiStore.getState().thinkingEnabled).toBe(false);
    expect(localStorage.getItem('aether.thinkingEnabled')).toBe('0');
  });
```

Add `beforeEach(() => { localStorage.clear(); useUiStore.getState()._reset(); })` if not already present.

- [ ] **Step 2: Run tests — expect FAIL**

```bash
npx vitest run src/stores/ui.store.test.ts
```

Expected: the four new tests FAIL — `openPalette` / `togglePalette` / `sidebarOpen` / `toggleSidebar` / `toggleThinking` not defined.

- [ ] **Step 3: Replace `src/stores/ui.store.ts`**

```ts
import { create } from 'zustand';

const THINKING_KEY = 'aether.thinkingEnabled';
const SIDEBAR_KEY = 'aether.sidebarOpen';

interface UiState {
  reasoningDrawerOpen: boolean;
  thinkingEnabled: boolean;
  focusedMessageId: string | null;
  profilesModalOpen: boolean;
  paletteOpen: boolean;
  sidebarOpen: boolean;

  toggleReasoningDrawer: () => void;
  openReasoningDrawer: () => void;
  closeReasoningDrawer: () => void;
  setThinkingEnabled: (v: boolean) => void;
  toggleThinking: () => void;
  setFocusedMessageId: (id: string | null) => void;
  openProfilesModal: () => void;
  closeProfilesModal: () => void;
  openPalette: () => void;
  closePalette: () => void;
  togglePalette: () => void;
  setSidebarOpen: (v: boolean) => void;
  toggleSidebar: () => void;
  initFromStorage: () => void;
  _reset: () => void;
}

const initial = {
  reasoningDrawerOpen: false,
  thinkingEnabled: false,
  focusedMessageId: null as string | null,
  profilesModalOpen: false,
  paletteOpen: false,
  sidebarOpen: true,
};

function readBool(key: string, fallback: boolean): boolean {
  try {
    const v = localStorage.getItem(key);
    if (v === '1') return true;
    if (v === '0') return false;
    return fallback;
  } catch {
    return fallback;
  }
}

function writeBool(key: string, v: boolean): void {
  try {
    localStorage.setItem(key, v ? '1' : '0');
  } catch {
    // ignore
  }
}

export const useUiStore = create<UiState>((set, get) => ({
  ...initial,
  _reset: () => set(initial),

  toggleReasoningDrawer: () =>
    set((s) => ({ reasoningDrawerOpen: !s.reasoningDrawerOpen })),
  openReasoningDrawer: () => set({ reasoningDrawerOpen: true }),
  closeReasoningDrawer: () =>
    set({ reasoningDrawerOpen: false, focusedMessageId: null }),

  setThinkingEnabled: (v) => {
    writeBool(THINKING_KEY, v);
    set({ thinkingEnabled: v });
  },
  toggleThinking: () => {
    const next = !get().thinkingEnabled;
    writeBool(THINKING_KEY, next);
    set({ thinkingEnabled: next });
  },

  setFocusedMessageId: (id) => set({ focusedMessageId: id }),

  openProfilesModal: () => set({ profilesModalOpen: true }),
  closeProfilesModal: () => set({ profilesModalOpen: false }),

  openPalette: () => set({ paletteOpen: true }),
  closePalette: () => set({ paletteOpen: false }),
  togglePalette: () => set((s) => ({ paletteOpen: !s.paletteOpen })),

  setSidebarOpen: (v) => {
    writeBool(SIDEBAR_KEY, v);
    set({ sidebarOpen: v });
  },
  toggleSidebar: () => {
    const next = !get().sidebarOpen;
    writeBool(SIDEBAR_KEY, next);
    set({ sidebarOpen: next });
  },

  initFromStorage: () =>
    set({
      thinkingEnabled: readBool(THINKING_KEY, false),
      sidebarOpen: readBool(SIDEBAR_KEY, true),
    }),
}));
```

- [ ] **Step 4: Run tests — expect PASS**

```bash
npx vitest run src/stores/ui.store.test.ts
```

Expected: PASS (existing + new tests).

- [ ] **Step 5: Commit**

```bash
git add src/stores/ui.store.ts src/stores/ui.store.test.ts
git commit -m "feat(slice-5): useUiStore +paletteOpen +sidebarOpen +toggleThinking + localStorage"
```

---

## Phase D — Command type + keyboard-shortcut hook

### Task D1: `Command` type

**Files:**
- Create: `src/types/command.types.ts`

- [ ] **Step 1: Create the file**

```ts
import type { ComponentType, SVGProps } from 'react';

export type CommandGroup = 'sessions' | 'profiles' | 'ui' | 'context';

export interface Command {
  id: string;
  group: CommandGroup;
  label: string;
  icon?: ComponentType<SVGProps<SVGSVGElement>>;
  shortcut?: string;
  run: () => void | Promise<void>;
}
```

- [ ] **Step 2: Lint**

```bash
npm run lint
```

Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add src/types/command.types.ts
git commit -m "feat(slice-5): add Command type"
```

---

### Task D2: `useKeyboardShortcut` hook

**Files:**
- Create: `src/hooks/useKeyboardShortcut.ts`
- Create: `src/hooks/useKeyboardShortcut.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
// src/hooks/useKeyboardShortcut.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useKeyboardShortcut, __setIsMacForTests } from './useKeyboardShortcut';

function fireKey(init: KeyboardEventInit) {
  const ev = new KeyboardEvent('keydown', { cancelable: true, ...init });
  window.dispatchEvent(ev);
  return ev;
}

beforeEach(() => {
  __setIsMacForTests(true);
});
afterEach(() => {
  __setIsMacForTests(null);
});

describe('useKeyboardShortcut', () => {
  it('fires handler on plain key (no mod)', () => {
    const handler = vi.fn();
    renderHook(() => useKeyboardShortcut({ key: 'escape' }, handler));
    fireKey({ key: 'Escape' });
    expect(handler).toHaveBeenCalledOnce();
  });

  it('fires on Cmd+K when isMac=true', () => {
    const handler = vi.fn();
    renderHook(() => useKeyboardShortcut({ key: 'k', mod: true }, handler));
    fireKey({ key: 'k', metaKey: true });
    expect(handler).toHaveBeenCalledOnce();
  });

  it('does NOT fire on Ctrl+K when isMac=true', () => {
    const handler = vi.fn();
    renderHook(() => useKeyboardShortcut({ key: 'k', mod: true }, handler));
    fireKey({ key: 'k', ctrlKey: true });
    expect(handler).not.toHaveBeenCalled();
  });

  it('fires on Ctrl+K when isMac=false', () => {
    __setIsMacForTests(false);
    const handler = vi.fn();
    renderHook(() => useKeyboardShortcut({ key: 'k', mod: true }, handler));
    fireKey({ key: 'k', ctrlKey: true });
    expect(handler).toHaveBeenCalledOnce();
  });

  it('calls preventDefault when it fires', () => {
    const handler = vi.fn();
    renderHook(() => useKeyboardShortcut({ key: 'k', mod: true }, handler));
    const ev = fireKey({ key: 'k', metaKey: true });
    expect(ev.defaultPrevented).toBe(true);
  });

  it('does not fire when enabled=false', () => {
    const handler = vi.fn();
    renderHook(() => useKeyboardShortcut({ key: 'escape' }, handler, false));
    fireKey({ key: 'Escape' });
    expect(handler).not.toHaveBeenCalled();
  });

  it('cleans up on unmount', () => {
    const handler = vi.fn();
    const { unmount } = renderHook(() => useKeyboardShortcut({ key: 'escape' }, handler));
    unmount();
    fireKey({ key: 'Escape' });
    expect(handler).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run tests — expect FAIL**

```bash
npx vitest run src/hooks/useKeyboardShortcut.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement the hook**

```ts
// src/hooks/useKeyboardShortcut.ts
import { useEffect } from 'react';

export interface ShortcutBinding {
  /** Lowercase key, e.g. "k", "n", "b", "escape". */
  key: string;
  /** Cross-platform modifier: true → Cmd on Mac, Ctrl elsewhere. Default false. */
  mod?: boolean;
}

let isMac =
  typeof navigator !== 'undefined' && /mac/i.test(navigator.platform);

/** Test-only override. Pass `null` to restore. */
export function __setIsMacForTests(v: boolean | null): void {
  if (v === null) {
    isMac =
      typeof navigator !== 'undefined' && /mac/i.test(navigator.platform);
  } else {
    isMac = v;
  }
}

export function useKeyboardShortcut(
  binding: ShortcutBinding,
  handler: (e: KeyboardEvent) => void,
  enabled: boolean = true,
): void {
  useEffect(() => {
    if (!enabled) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() !== binding.key.toLowerCase()) return;
      if (binding.mod) {
        const want = isMac ? e.metaKey && !e.ctrlKey : e.ctrlKey && !e.metaKey;
        if (!want) return;
      } else if (e.metaKey || e.ctrlKey) {
        return;
      }
      e.preventDefault();
      handler(e);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [binding.key, binding.mod, enabled, handler]);
}
```

- [ ] **Step 4: Run tests — expect PASS**

```bash
npx vitest run src/hooks/useKeyboardShortcut.test.ts
```

Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add src/hooks/useKeyboardShortcut.ts src/hooks/useKeyboardShortcut.test.ts
git commit -m "feat(slice-5): useKeyboardShortcut hook (Mac/Win cross-platform)"
```

---

## Phase E — Global shortcuts composition

### Task E1: `useGlobalShortcuts`

**Files:**
- Create: `src/hooks/useGlobalShortcuts.ts`
- Create: `src/hooks/useGlobalShortcuts.test.ts`

- [ ] **Step 1: Write failing tests**

```tsx
// src/hooks/useGlobalShortcuts.test.ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useGlobalShortcuts } from './useGlobalShortcuts';
import { useUiStore } from '@/src/stores/ui.store';
import { useSessionsStore } from '@/src/stores/sessions.store';
import { __setIsMacForTests } from './useKeyboardShortcut';

function fireKey(init: KeyboardEventInit) {
  window.dispatchEvent(new KeyboardEvent('keydown', { cancelable: true, ...init }));
}

beforeEach(() => {
  __setIsMacForTests(true);
  useUiStore.getState()._reset();
  useSessionsStore.getState()._reset();
  localStorage.clear();
});
afterEach(() => __setIsMacForTests(null));

describe('useGlobalShortcuts', () => {
  it('Cmd+K toggles paletteOpen', () => {
    renderHook(() => useGlobalShortcuts());
    act(() => fireKey({ key: 'k', metaKey: true }));
    expect(useUiStore.getState().paletteOpen).toBe(true);
    act(() => fireKey({ key: 'k', metaKey: true }));
    expect(useUiStore.getState().paletteOpen).toBe(false);
  });

  it('Escape closes palette only when open', () => {
    renderHook(() => useGlobalShortcuts());
    act(() => fireKey({ key: 'Escape' }));
    // No effect when palette closed
    expect(useUiStore.getState().paletteOpen).toBe(false);

    act(() => useUiStore.getState().openPalette());
    act(() => fireKey({ key: 'Escape' }));
    expect(useUiStore.getState().paletteOpen).toBe(false);
  });

  it('Cmd+B toggles sidebar', () => {
    renderHook(() => useGlobalShortcuts());
    expect(useUiStore.getState().sidebarOpen).toBe(true);
    act(() => fireKey({ key: 'b', metaKey: true }));
    expect(useUiStore.getState().sidebarOpen).toBe(false);
  });

  it('Cmd+N calls sessions.create', () => {
    const spy = vi.spyOn(useSessionsStore.getState(), 'create').mockResolvedValue(
      { id: 'x', title: 'untitled', createdAt: 0, updatedAt: 0 } as never,
    );
    renderHook(() => useGlobalShortcuts());
    act(() => fireKey({ key: 'n', metaKey: true }));
    expect(spy).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run tests — expect FAIL**

```bash
npx vitest run src/hooks/useGlobalShortcuts.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// src/hooks/useGlobalShortcuts.ts
import { useCallback } from 'react';
import { useUiStore } from '@/src/stores/ui.store';
import { useSessionsStore } from '@/src/stores/sessions.store';
import { useKeyboardShortcut } from './useKeyboardShortcut';

export function useGlobalShortcuts(): void {
  const togglePalette = useUiStore((s) => s.togglePalette);
  const closePalette = useUiStore((s) => s.closePalette);
  const paletteOpen = useUiStore((s) => s.paletteOpen);
  const toggleSidebar = useUiStore((s) => s.toggleSidebar);
  const createSession = useSessionsStore((s) => s.create);

  const onCmdK = useCallback(() => togglePalette(), [togglePalette]);
  const onEscape = useCallback(() => closePalette(), [closePalette]);
  const onCmdB = useCallback(() => toggleSidebar(), [toggleSidebar]);
  const onCmdN = useCallback(() => {
    createSession().catch(() => {});
  }, [createSession]);

  useKeyboardShortcut({ key: 'k', mod: true }, onCmdK);
  useKeyboardShortcut({ key: 'escape' }, onEscape, paletteOpen);
  useKeyboardShortcut({ key: 'b', mod: true }, onCmdB);
  useKeyboardShortcut({ key: 'n', mod: true }, onCmdN);
}
```

- [ ] **Step 4: Run tests — expect PASS**

```bash
npx vitest run src/hooks/useGlobalShortcuts.test.ts
```

Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/hooks/useGlobalShortcuts.ts src/hooks/useGlobalShortcuts.test.ts
git commit -m "feat(slice-5): useGlobalShortcuts (CmdK/Esc/CmdB/CmdN)"
```

---

## Phase F — Context add-flow extraction + sidebar refactor

### Task F1: `addFlows.ts` shared module

**Files:**
- Create: `src/lib/context/addFlows.ts`
- Create: `src/lib/context/addFlows.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
// src/lib/context/addFlows.test.ts
import { describe, it, expect, vi } from 'vitest';
import { addSkillFlow, addToolFlow, addMcpFlow } from './addFlows';

type Dialog = {
  prompt: ReturnType<typeof vi.fn>;
  confirm: ReturnType<typeof vi.fn>;
};

function makeDialog(answers: Array<string | null | boolean>): Dialog {
  const queue = [...answers];
  return {
    prompt: vi.fn(async () => queue.shift() as string | null),
    confirm: vi.fn(async () => queue.shift() as boolean),
  };
}

describe('addSkillFlow', () => {
  it('calls addSkill with the name', async () => {
    const dialog = makeDialog(['my skill']);
    const addSkill = vi.fn().mockResolvedValue(undefined);
    await addSkillFlow(dialog as never, addSkill);
    expect(addSkill).toHaveBeenCalledWith('my skill');
  });

  it('aborts when cancelled', async () => {
    const dialog = makeDialog([null]);
    const addSkill = vi.fn();
    await addSkillFlow(dialog as never, addSkill);
    expect(addSkill).not.toHaveBeenCalled();
  });
});

describe('addToolFlow', () => {
  it('chains name → version → online confirm', async () => {
    const dialog = makeDialog(['tool', '2.0.0', true]);
    const addTool = vi.fn().mockResolvedValue(undefined);
    await addToolFlow(dialog as never, addTool);
    expect(addTool).toHaveBeenCalledWith({ name: 'tool', version: '2.0.0', status: 'online' });
  });

  it('falls back to offline when confirm=false', async () => {
    const dialog = makeDialog(['t', '1', false]);
    const addTool = vi.fn().mockResolvedValue(undefined);
    await addToolFlow(dialog as never, addTool);
    expect(addTool).toHaveBeenCalledWith({ name: 't', version: '1', status: 'offline' });
  });

  it('aborts if any prompt cancelled', async () => {
    const dialog = makeDialog(['t', null]);
    const addTool = vi.fn();
    await addToolFlow(dialog as never, addTool);
    expect(addTool).not.toHaveBeenCalled();
  });
});

describe('addMcpFlow', () => {
  it('chains name → url', async () => {
    const dialog = makeDialog(['srv', 'http://x']);
    const add = vi.fn().mockResolvedValue(undefined);
    await addMcpFlow(dialog as never, add);
    expect(add).toHaveBeenCalledWith({ name: 'srv', url: 'http://x', status: 'connecting' });
  });

  it('aborts if url cancelled', async () => {
    const dialog = makeDialog(['srv', null]);
    const add = vi.fn();
    await addMcpFlow(dialog as never, add);
    expect(add).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run tests — expect FAIL**

```bash
npx vitest run src/lib/context/addFlows.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// src/lib/context/addFlows.ts
import type { Tool, McpServerConfig } from '@/src/types/context.types';
import type { useDialog } from '@/src/hooks/useDialog';

type DialogApi = Pick<ReturnType<typeof useDialog>, 'prompt' | 'confirm'>;

export async function addSkillFlow(
  dialog: DialogApi,
  addSkill: (name: string) => Promise<void>,
): Promise<void> {
  const name = await dialog.prompt({ title: 'Add Skill', label: 'Skill name', required: true });
  if (!name) return;
  await addSkill(name).catch(() => {});
}

export async function addToolFlow(
  dialog: DialogApi,
  addTool: (input: Omit<Tool, 'id'>) => Promise<void>,
): Promise<void> {
  const name = await dialog.prompt({ title: 'Register Tool', label: 'Name', required: true });
  if (!name) return;
  const version = await dialog.prompt({
    title: 'Register Tool',
    label: 'Version',
    defaultValue: '1.0.0',
    required: true,
  });
  if (!version) return;
  const isOnline = await dialog.confirm({
    title: 'Register Tool',
    message: `Set status of ${name} to ONLINE? (Cancel = offline)`,
    confirmLabel: 'Online',
    cancelLabel: 'Offline',
  });
  await addTool({ name, version, status: isOnline ? 'online' : 'offline' }).catch(() => {});
}

export async function addMcpFlow(
  dialog: DialogApi,
  addMcpServer: (input: Omit<McpServerConfig, 'id'>) => Promise<void>,
): Promise<void> {
  const name = await dialog.prompt({ title: 'Add MCP Server', label: 'Name', required: true });
  if (!name) return;
  const url = await dialog.prompt({
    title: 'Add MCP Server',
    label: 'URL',
    defaultValue: 'http://localhost:8080/mcp',
    required: true,
  });
  if (!url) return;
  await addMcpServer({ name, url, status: 'connecting' }).catch(() => {});
}
```

- [ ] **Step 4: Run tests — expect PASS**

```bash
npx vitest run src/lib/context/addFlows.test.ts
```

Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/context/addFlows.ts src/lib/context/addFlows.test.ts
git commit -m "feat(slice-5): extract addSkill/Tool/Mcp flows into shared module"
```

---

### Task F2: Refactor sidebar sections to use `addFlows`

**Files:**
- Modify: `src/components/sidebar/SkillsSection.tsx`
- Modify: `src/components/sidebar/ToolsSection.tsx`
- Modify: `src/components/sidebar/McpServersSection.tsx`

- [ ] **Step 1: Update `SkillsSection.tsx`**

Replace the `handleAdd` definition in `src/components/sidebar/SkillsSection.tsx` so the file's `handleAdd` becomes:

```tsx
  const handleAdd = () => addSkillFlow(dialog, addSkill);
```

…and add the import at the top:

```tsx
import { addSkillFlow } from '@/src/lib/context/addFlows';
```

The rest of the file (state, JSX, edit/remove logic) is unchanged.

- [ ] **Step 2: Update `ToolsSection.tsx`**

Replace `handleAdd` body and imports the same way:

```tsx
import { addToolFlow } from '@/src/lib/context/addFlows';

// inside the component:
  const handleAdd = () => addToolFlow(dialog, addTool);
```

The rest is unchanged.

- [ ] **Step 3: Update `McpServersSection.tsx`**

```tsx
import { addMcpFlow } from '@/src/lib/context/addFlows';

// inside the component:
  const handleAdd = () => addMcpFlow(dialog, addMcpServer);
```

The rest is unchanged.

- [ ] **Step 4: Run section + addFlows tests**

```bash
npx vitest run src/components/sidebar src/lib/context
```

Expected: PASS — existing section tests already exercise the add flow via the same dialog queue, so they should keep passing.

- [ ] **Step 5: Commit**

```bash
git add src/components/sidebar/SkillsSection.tsx src/components/sidebar/ToolsSection.tsx src/components/sidebar/McpServersSection.tsx
git commit -m "refactor(slice-5): sidebar sections delegate add flows to shared module"
```

---

## Phase G — `useCommands` hook

### Task G1: `useCommands` derives the catalog from stores

**Files:**
- Create: `src/hooks/useCommands.ts`
- Create: `src/hooks/useCommands.test.ts`

- [ ] **Step 1: Write failing tests**

```tsx
// src/hooks/useCommands.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useCommands } from './useCommands';
import { useUiStore } from '@/src/stores/ui.store';
import { useSessionsStore } from '@/src/stores/sessions.store';
import { useProfilesStore } from '@/src/stores/profiles.store';
import { useContextStore } from '@/src/stores/context.store';

beforeEach(() => {
  useUiStore.getState()._reset();
  useSessionsStore.getState()._reset();
  useProfilesStore.getState()._reset();
  useContextStore.getState()._reset();
});

function ids(cmds: { id: string }[]): string[] {
  return cmds.map((c) => c.id);
}

describe('useCommands', () => {
  it('always includes static commands', () => {
    const { result } = renderHook(() => useCommands());
    expect(ids(result.current)).toEqual(
      expect.arrayContaining([
        'sessions.new',
        'profiles.open',
        'profiles.saveNew',
        'ui.toggleSidebar',
        'ui.toggleThinking',
        'ui.openReasoning',
        'context.addSkill',
        'context.addTool',
        'context.addMcp',
        'context.editSystem',
      ]),
    );
  });

  it('omits rename/delete when no active session', () => {
    const { result } = renderHook(() => useCommands());
    expect(ids(result.current)).not.toEqual(expect.arrayContaining(['sessions.rename', 'sessions.delete']));
  });

  it('includes rename/delete + switch-to-others when active session set', () => {
    useSessionsStore.setState({
      sessions: [
        { id: 'a', title: 'Alpha', createdAt: 1, updatedAt: 1 },
        { id: 'b', title: 'Beta', createdAt: 2, updatedAt: 2 },
      ] as never,
      activeSessionId: 'a',
      hydrated: true,
    });
    const { result } = renderHook(() => useCommands());
    const list = ids(result.current);
    expect(list).toContain('sessions.rename');
    expect(list).toContain('sessions.delete');
    expect(list).toContain('sessions.switch.b');
    expect(list).not.toContain('sessions.switch.a');
  });

  it('includes profiles.apply.<id> excluding active profile', () => {
    useProfilesStore.setState({
      profiles: [
        { id: 'p1', name: 'One', createdAt: 0, updatedAt: 0 },
        { id: 'p2', name: 'Two', createdAt: 0, updatedAt: 0 },
      ],
      activeProfileId: 'p1',
      hydrated: true,
    });
    const list = ids(renderHook(() => useCommands()).result.current);
    expect(list).toContain('profiles.apply.p2');
    expect(list).not.toContain('profiles.apply.p1');
  });

  it('omits ui.openReasoning when drawer already open', () => {
    useUiStore.setState({ reasoningDrawerOpen: true });
    const list = ids(renderHook(() => useCommands()).result.current);
    expect(list).not.toContain('ui.openReasoning');
  });

  it('attaches shortcut hints', () => {
    const { result } = renderHook(() => useCommands());
    const newSession = result.current.find((c) => c.id === 'sessions.new');
    const sidebar = result.current.find((c) => c.id === 'ui.toggleSidebar');
    expect(newSession?.shortcut).toBeTruthy();
    expect(sidebar?.shortcut).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run tests — expect FAIL**

```bash
npx vitest run src/hooks/useCommands.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```tsx
// src/hooks/useCommands.ts
import { useMemo } from 'react';
import {
  Plus,
  MessageSquare,
  Pencil,
  Trash2,
  FolderOpen,
  Save,
  Layers,
  PanelLeft,
  Brain,
  Lightbulb,
  Sparkles,
  Wrench,
  Plug,
  FileText,
} from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';
import type { Command } from '@/src/types/command.types';
import { useUiStore } from '@/src/stores/ui.store';
import { useSessionsStore } from '@/src/stores/sessions.store';
import { useProfilesStore } from '@/src/stores/profiles.store';
import { useContextStore } from '@/src/stores/context.store';
import { useDialog } from '@/src/hooks/useDialog';
import { addSkillFlow, addToolFlow, addMcpFlow } from '@/src/lib/context/addFlows';

const IS_MAC =
  typeof navigator !== 'undefined' && /mac/i.test(navigator.platform);
const MOD = IS_MAC ? '⌘' : 'Ctrl+';

export function useCommands(): Command[] {
  const sessions = useSessionsStore(
    useShallow((s) => ({
      list: s.sessions,
      activeId: s.activeSessionId,
      create: s.create,
      setActive: s.setActive,
      rename: s.rename,
      remove: s.delete,
    })),
  );
  const profiles = useProfilesStore(
    useShallow((s) => ({
      list: s.profiles,
      activeId: s.activeProfileId,
      save: s.saveCurrent,
      apply: s.apply,
    })),
  );
  const ui = useUiStore(
    useShallow((s) => ({
      drawerOpen: s.reasoningDrawerOpen,
      openDrawer: s.openReasoningDrawer,
      toggleSidebar: s.toggleSidebar,
      toggleThinking: s.toggleThinking,
      openProfilesModal: s.openProfilesModal,
    })),
  );
  const ctx = useContextStore(
    useShallow((s) => ({
      ctx: s.context,
      addSkill: s.addSkill,
      addTool: s.addTool,
      addMcp: s.addMcpServer,
      setSystem: s.setSystemInstruction,
    })),
  );
  const dialog = useDialog();

  return useMemo<Command[]>(() => {
    const out: Command[] = [];

    // Sessions
    out.push({
      id: 'sessions.new',
      group: 'sessions',
      label: 'New session',
      icon: Plus,
      shortcut: `${MOD}N`,
      run: async () => {
        await sessions.create();
      },
    });
    for (const s of sessions.list) {
      if (s.id === sessions.activeId) continue;
      out.push({
        id: `sessions.switch.${s.id}`,
        group: 'sessions',
        label: `Switch to: ${s.title || 'untitled'}`,
        icon: MessageSquare,
        run: () => sessions.setActive(s.id),
      });
    }
    if (sessions.activeId) {
      const activeId = sessions.activeId;
      const current = sessions.list.find((s) => s.id === activeId);
      out.push({
        id: 'sessions.rename',
        group: 'sessions',
        label: 'Rename current session',
        icon: Pencil,
        run: async () => {
          const name = await dialog.prompt({
            title: 'Rename session',
            label: 'Title',
            defaultValue: current?.title ?? '',
            required: true,
          });
          if (name) await sessions.rename(activeId, name);
        },
      });
      out.push({
        id: 'sessions.delete',
        group: 'sessions',
        label: 'Delete current session',
        icon: Trash2,
        run: async () => {
          const ok = await dialog.confirm({
            title: 'Delete session',
            message: `Delete "${current?.title ?? 'this session'}"?`,
            destructive: true,
          });
          if (ok) await sessions.remove(activeId);
        },
      });
    }

    // Profiles
    out.push({
      id: 'profiles.open',
      group: 'profiles',
      label: 'Open profiles manager',
      icon: FolderOpen,
      run: () => ui.openProfilesModal(),
    });
    out.push({
      id: 'profiles.saveNew',
      group: 'profiles',
      label: 'Save current as new profile…',
      icon: Save,
      run: async () => {
        const name = await dialog.prompt({
          title: 'Save profile',
          label: 'Name',
          required: true,
        });
        if (name) await profiles.save(name);
      },
    });
    for (const p of profiles.list) {
      if (p.id === profiles.activeId) continue;
      out.push({
        id: `profiles.apply.${p.id}`,
        group: 'profiles',
        label: `Apply profile: ${p.name}`,
        icon: Layers,
        run: () => profiles.apply(p.id),
      });
    }

    // UI
    out.push({
      id: 'ui.toggleSidebar',
      group: 'ui',
      label: 'Toggle sidebar',
      icon: PanelLeft,
      shortcut: `${MOD}B`,
      run: () => ui.toggleSidebar(),
    });
    out.push({
      id: 'ui.toggleThinking',
      group: 'ui',
      label: 'Toggle thinking',
      icon: Brain,
      run: () => ui.toggleThinking(),
    });
    if (!ui.drawerOpen) {
      out.push({
        id: 'ui.openReasoning',
        group: 'ui',
        label: 'Open reasoning drawer',
        icon: Lightbulb,
        run: () => ui.openDrawer(),
      });
    }

    // Context
    out.push({
      id: 'context.addSkill',
      group: 'context',
      label: 'Add skill…',
      icon: Sparkles,
      run: () => addSkillFlow(dialog, ctx.addSkill),
    });
    out.push({
      id: 'context.addTool',
      group: 'context',
      label: 'Add tool…',
      icon: Wrench,
      run: () => addToolFlow(dialog, ctx.addTool),
    });
    out.push({
      id: 'context.addMcp',
      group: 'context',
      label: 'Add MCP server…',
      icon: Plug,
      run: () => addMcpFlow(dialog, ctx.addMcp),
    });
    out.push({
      id: 'context.editSystem',
      group: 'context',
      label: 'Edit system protocol',
      icon: FileText,
      run: async () => {
        const cur = ctx.ctx?.systemInstruction ?? '';
        const text = await dialog.prompt({
          title: 'Edit system protocol',
          label: 'System instruction',
          defaultValue: cur,
          multiline: true,
        });
        if (text !== null) await ctx.setSystem(text);
      },
    });

    return out;
  }, [sessions, profiles, ui, ctx, dialog]);
}
```

- [ ] **Step 4: Run tests — expect PASS**

```bash
npx vitest run src/hooks/useCommands.test.ts
```

Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/hooks/useCommands.ts src/hooks/useCommands.test.ts
git commit -m "feat(slice-5): useCommands derives palette catalog from stores"
```

---

## Phase H — Palette presentation

### Task H1: `<CommandItem />`

**Files:**
- Create: `src/components/palette/CommandItem.tsx`
- Create: `src/components/palette/CommandItem.test.tsx`

- [ ] **Step 1: Write failing test**

```tsx
// src/components/palette/CommandItem.test.tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Plus } from 'lucide-react';
import { CommandItem } from './CommandItem';

describe('CommandItem', () => {
  it('renders label and shortcut hint when present', () => {
    render(<CommandItem label="New session" shortcut="⌘N" icon={Plus} />);
    expect(screen.getByText('New session')).toBeInTheDocument();
    expect(screen.getByText('⌘N')).toBeInTheDocument();
  });

  it('omits shortcut element when absent', () => {
    render(<CommandItem label="X" />);
    expect(screen.queryByTestId('command-item-shortcut')).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests — expect FAIL**

```bash
npx vitest run src/components/palette/CommandItem.test.tsx
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```tsx
// src/components/palette/CommandItem.tsx
import type { ComponentType, SVGProps } from 'react';

export interface CommandItemProps {
  label: string;
  shortcut?: string;
  icon?: ComponentType<SVGProps<SVGSVGElement>>;
}

export function CommandItem({ label, shortcut, icon: Icon }: CommandItemProps) {
  return (
    <div className="flex items-center gap-2 w-full text-xs">
      {Icon && <Icon className="w-3 h-3 text-zinc-500 shrink-0" aria-hidden />}
      <span className="flex-1 truncate text-zinc-200">{label}</span>
      {shortcut && (
        <span
          data-testid="command-item-shortcut"
          className="font-mono text-[10px] text-zinc-500 ml-2"
        >
          {shortcut}
        </span>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Run tests — expect PASS**

```bash
npx vitest run src/components/palette/CommandItem.test.tsx
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/palette/CommandItem.tsx src/components/palette/CommandItem.test.tsx
git commit -m "feat(slice-5): add CommandItem presentational component"
```

---

### Task H2: `<CommandPalette />`

**Files:**
- Create: `src/components/palette/CommandPalette.tsx`
- Create: `src/components/palette/CommandPalette.test.tsx`

- [ ] **Step 1: Write failing tests**

```tsx
// src/components/palette/CommandPalette.test.tsx
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CommandPalette } from './CommandPalette';
import { useUiStore } from '@/src/stores/ui.store';
import * as commandsModule from '@/src/hooks/useCommands';
import type { Command } from '@/src/types/command.types';

const sampleRun = vi.fn(async () => {});
const throwingRun = vi.fn(async () => {
  throw new Error('boom');
});

const fakeCommands: Command[] = [
  { id: 'sessions.new', group: 'sessions', label: 'New session', shortcut: '⌘N', run: sampleRun },
  { id: 'profiles.open', group: 'profiles', label: 'Open profiles manager', run: sampleRun },
  { id: 'ui.toggleSidebar', group: 'ui', label: 'Toggle sidebar', run: throwingRun },
];

beforeEach(() => {
  useUiStore.getState()._reset();
  sampleRun.mockClear();
  throwingRun.mockClear();
  vi.spyOn(commandsModule, 'useCommands').mockReturnValue(fakeCommands);
});

describe('CommandPalette', () => {
  it('renders nothing when paletteOpen=false', () => {
    const { container } = render(<CommandPalette />);
    expect(container.querySelector('[cmdk-root]')).toBeNull();
  });

  it('renders dialog when paletteOpen=true with group headings', () => {
    useUiStore.setState({ paletteOpen: true });
    render(<CommandPalette />);
    expect(screen.getByPlaceholderText(/type a command/i)).toBeInTheDocument();
    expect(screen.getByText(/sessions/i)).toBeInTheDocument();
    expect(screen.getByText(/profiles/i)).toBeInTheDocument();
    expect(screen.getByText(/ui/i)).toBeInTheDocument();
  });

  it('Enter on highlighted item runs and closes palette', async () => {
    useUiStore.setState({ paletteOpen: true });
    const user = userEvent.setup();
    render(<CommandPalette />);
    // cmdk auto-selects the first item; press Enter
    await user.keyboard('{Enter}');
    expect(sampleRun).toHaveBeenCalled();
    expect(useUiStore.getState().paletteOpen).toBe(false);
  });

  it('error-throwing run still closes palette', async () => {
    useUiStore.setState({ paletteOpen: true });
    const user = userEvent.setup();
    render(<CommandPalette />);
    await user.click(screen.getByText('Toggle sidebar'));
    expect(throwingRun).toHaveBeenCalled();
    expect(useUiStore.getState().paletteOpen).toBe(false);
  });

  it('shows empty message when nothing matches', async () => {
    useUiStore.setState({ paletteOpen: true });
    const user = userEvent.setup();
    render(<CommandPalette />);
    await user.type(screen.getByPlaceholderText(/type a command/i), 'zzznomatch');
    expect(screen.getByText(/no matching commands/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run tests — expect FAIL**

```bash
npx vitest run src/components/palette/CommandPalette.test.tsx
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```tsx
// src/components/palette/CommandPalette.tsx
import { Command as Cmdk } from 'cmdk';
import { useUiStore } from '@/src/stores/ui.store';
import { useCommands } from '@/src/hooks/useCommands';
import { CommandItem } from './CommandItem';
import type { Command, CommandGroup } from '@/src/types/command.types';

const GROUP_LABEL: Record<CommandGroup, string> = {
  sessions: 'Sessions',
  profiles: 'Profiles',
  ui: 'UI',
  context: 'Context',
};

const GROUP_ORDER: CommandGroup[] = ['sessions', 'profiles', 'ui', 'context'];

function groupBy(cmds: Command[]): Record<CommandGroup, Command[]> {
  const out: Record<CommandGroup, Command[]> = {
    sessions: [],
    profiles: [],
    ui: [],
    context: [],
  };
  for (const c of cmds) out[c.group].push(c);
  return out;
}

export function CommandPalette() {
  const open = useUiStore((s) => s.paletteOpen);
  const close = useUiStore((s) => s.closePalette);
  const commands = useCommands();

  if (!open) return null;

  const groups = groupBy(commands);

  const runCmd = async (cmd: Command) => {
    try {
      await cmd.run();
    } catch {
      // store owns error display
    } finally {
      close();
    }
  };

  return (
    <Cmdk.Dialog
      open={open}
      onOpenChange={(v) => (v ? null : close())}
      label="Command palette"
      className="fixed inset-0 z-50 flex items-start justify-center pt-[15vh] bg-black/60"
      contentClassName="w-full max-w-xl bg-surface-2 border border-border-subtle rounded-lg shadow-2xl overflow-hidden"
    >
      <Cmdk.Input
        autoFocus
        placeholder="Type a command…"
        className="w-full px-3 py-2 bg-surface-3 border-b border-border-subtle text-sm text-white outline-none placeholder:text-zinc-500"
      />
      <Cmdk.List className="max-h-80 overflow-y-auto p-1">
        <Cmdk.Empty className="px-3 py-4 text-center text-xs text-zinc-500">
          No matching commands
        </Cmdk.Empty>
        {GROUP_ORDER.map((g) =>
          groups[g].length === 0 ? null : (
            <Cmdk.Group
              key={g}
              heading={GROUP_LABEL[g]}
              className="px-1 py-1 [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1 [&_[cmdk-group-heading]]:text-[10px] [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-widest [&_[cmdk-group-heading]]:text-zinc-500 [&_[cmdk-group-heading]]:font-mono"
            >
              {groups[g].map((c) => (
                <Cmdk.Item
                  key={c.id}
                  value={`${c.label} ${c.id}`}
                  onSelect={() => runCmd(c)}
                  className="px-2 py-1.5 rounded cursor-pointer data-[selected=true]:bg-surface-3"
                >
                  <CommandItem label={c.label} shortcut={c.shortcut} icon={c.icon} />
                </Cmdk.Item>
              ))}
            </Cmdk.Group>
          ),
        )}
      </Cmdk.List>
    </Cmdk.Dialog>
  );
}
```

Note: cmdk's `<Command.Dialog>` accepts `contentClassName` for the inner content surface in v1.1.

- [ ] **Step 4: Run tests — expect PASS**

```bash
npx vitest run src/components/palette/CommandPalette.test.tsx
```

Expected: PASS (5 tests).

If `data-[selected=true]:bg-surface-3` isn't recognised by Tailwind, replace with a plain `hover:bg-surface-3` class — cmdk also exposes `[cmdk-item]` data-selected via DOM attribute and Tailwind's arbitrary variant should work, but the fallback is safe.

- [ ] **Step 5: Commit**

```bash
git add src/components/palette/CommandPalette.tsx src/components/palette/CommandPalette.test.tsx
git commit -m "feat(slice-5): add CommandPalette (cmdk-based, groups + runCmd wrapper)"
```

---

## Phase I — App integration

### Task I1: `App.tsx` reads `sidebarOpen` from store, mounts palette + shortcuts

**Files:**
- Modify: `src/App.tsx`
- Modify: `src/App.test.tsx`

- [ ] **Step 1: Append failing test**

Append to `src/App.test.tsx` inside the existing `describe('App', ...)` block:

```tsx
  it('mounts CommandPalette (closed by default)', () => {
    render(<App />);
    expect(screen.queryByPlaceholderText(/type a command/i)).toBeNull();
  });

  it('opens CommandPalette when ui.store flips paletteOpen', async () => {
    render(<App />);
    act(() => {
      useUiStore.getState().openPalette();
    });
    await waitFor(() => {
      expect(screen.getByPlaceholderText(/type a command/i)).toBeInTheDocument();
    });
  });
```

- [ ] **Step 2: Run tests — expect FAIL**

```bash
npx vitest run src/App.test.tsx
```

Expected: FAIL — `CommandPalette` not mounted.

- [ ] **Step 3: Replace `src/App.tsx`**

```tsx
import { useEffect } from 'react';
import { AppShell } from '@/src/components/layout/AppShell';
import { TopBar } from '@/src/components/layout/TopBar';
import { Sidebar } from '@/src/components/layout/Sidebar';
import { DialogHost } from '@/src/components/layout/DialogHost';
import { SessionsSection } from '@/src/components/sidebar/SessionsSection';
import { SystemProtocolSection } from '@/src/components/sidebar/SystemProtocolSection';
import { SkillsSection } from '@/src/components/sidebar/SkillsSection';
import { ToolsSection } from '@/src/components/sidebar/ToolsSection';
import { McpServersSection } from '@/src/components/sidebar/McpServersSection';
import { ConnectionFooter } from '@/src/components/sidebar/ConnectionFooter';
import { ChatView } from '@/src/components/chat/ChatView';
import { ReasoningDrawer } from '@/src/components/reasoning/ReasoningDrawer';
import { ProfilesModal } from '@/src/components/profiles/ProfilesModal';
import { CommandPalette } from '@/src/components/palette/CommandPalette';
import { useContextStore } from '@/src/stores/context.store';
import { useSessionsStore } from '@/src/stores/sessions.store';
import { useUiStore } from '@/src/stores/ui.store';
import { useProfilesStore } from '@/src/stores/profiles.store';
import { useGlobalShortcuts } from '@/src/hooks/useGlobalShortcuts';

export default function App() {
  const sidebarOpen = useUiStore((s) => s.sidebarOpen);
  const toggleSidebar = useUiStore((s) => s.toggleSidebar);
  const initContext = useContextStore((s) => s.init);
  const initSessions = useSessionsStore((s) => s.init);
  const initUi = useUiStore((s) => s.initFromStorage);
  const initProfiles = useProfilesStore((s) => s.init);

  useEffect(() => {
    initContext();
    initSessions();
    initUi();
    initProfiles();
  }, [initContext, initSessions, initUi, initProfiles]);

  useGlobalShortcuts();

  return (
    <>
      <DialogHost />
      <AppShell
        sidebarOpen={sidebarOpen}
        sidebar={
          <Sidebar
            header={
              <span className="font-mono text-sm tracking-tight text-white font-bold">
                AETHER_CORE
              </span>
            }
            footer={<ConnectionFooter />}
          >
            <SessionsSection />
            <SystemProtocolSection />
            <SkillsSection />
            <ToolsSection />
            <McpServersSection />
          </Sidebar>
        }
      >
        <TopBar
          title="Aether Dev Studio"
          sidebarOpen={sidebarOpen}
          onToggleSidebar={toggleSidebar}
        />
        <ChatView />
      </AppShell>
      <ReasoningDrawer />
      <ProfilesModal />
      <CommandPalette />
    </>
  );
}
```

- [ ] **Step 4: Run tests — expect PASS**

```bash
npx vitest run src/App.test.tsx
```

Expected: PASS (existing 4 + new 2 = 6).

- [ ] **Step 5: Commit**

```bash
git add src/App.tsx src/App.test.tsx
git commit -m "feat(slice-5): App.tsx mounts CommandPalette + shortcuts; sidebarOpen from store"
```

---

## Phase J — Integration test

### Task J1: ⌘K → run "New session" via palette

**Files:**
- Create: `src/integration/palette.integration.test.tsx`

- [ ] **Step 1: Write the test**

```tsx
// src/integration/palette.integration.test.tsx
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { server } from '@/src/test/msw-server';
import App from '@/src/App';
import { useUiStore } from '@/src/stores/ui.store';
import { useSessionsStore } from '@/src/stores/sessions.store';
import { useProfilesStore } from '@/src/stores/profiles.store';
import { useContextStore } from '@/src/stores/context.store';

beforeEach(() => {
  useUiStore.getState()._reset();
  useSessionsStore.getState()._reset();
  useProfilesStore.getState()._reset();
  useContextStore.getState()._reset();
  localStorage.clear();
});

describe('palette integration', () => {
  it('⌘K opens palette; running "New session" hits the API', async () => {
    let createCalled = false;
    server.use(
      http.post('http://localhost/api/sessions', () => {
        createCalled = true;
        return HttpResponse.json(
          { id: 'sX', title: 'untitled', createdAt: 1, updatedAt: 1 },
          { status: 201 },
        );
      }),
    );
    const user = userEvent.setup();
    render(<App />);

    await act(async () => {
      window.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'k', metaKey: true, cancelable: true }),
      );
    });

    expect(await screen.findByPlaceholderText(/type a command/i)).toBeInTheDocument();
    await user.type(screen.getByPlaceholderText(/type a command/i), 'new session');
    await user.keyboard('{Enter}');

    await waitFor(() => expect(createCalled).toBe(true));
    expect(useUiStore.getState().paletteOpen).toBe(false);
  });

  it('⌘B toggles sidebar visibility', async () => {
    render(<App />);
    expect(useUiStore.getState().sidebarOpen).toBe(true);
    await act(async () => {
      window.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'b', metaKey: true, cancelable: true }),
      );
    });
    expect(useUiStore.getState().sidebarOpen).toBe(false);
  });
});
```

- [ ] **Step 2: Run test — expect PASS**

```bash
npx vitest run src/integration/palette.integration.test.tsx
```

Expected: PASS (both tests).

- [ ] **Step 3: Commit**

```bash
git add src/integration/palette.integration.test.tsx
git commit -m "test(slice-5): integration — palette ⌘K opens + ⌘B toggles sidebar"
```

---

## Phase K — E2E

### Task K1: Playwright golden-path test

**Files:**
- Modify: `e2e/smoke.spec.ts`

- [ ] **Step 1: Append the test**

Append this test inside `e2e/smoke.spec.ts` (after the `profiles: save → apply roundtrip` test, before the `reasoning: thinking on emits steps + opens drawer` test):

```ts
test('palette: ⌘K → new session via palette', async ({ page, request }) => {
  // wipe sessions
  const list = await request.get('/api/sessions').then((r) => r.json());
  for (const s of list.sessions as { id: string }[]) {
    await request.delete(`/api/sessions/${s.id}`);
  }
  await page.addInitScript(() => {
    localStorage.removeItem('aether.activeSessionId');
  });

  await page.goto('/');
  // Allow init() to settle
  await expect(page.getByText('AETHER_CORE')).toBeVisible();

  // Open palette via Cmd+K (Meta on Mac, Control elsewhere — Playwright supports Meta on all)
  await page.keyboard.press('Meta+K');
  const input = page.getByPlaceholder(/type a command/i);
  await expect(input).toBeVisible({ timeout: 5000 });

  await input.fill('new session');
  await page.keyboard.press('Enter');

  // Palette closes
  await expect(input).toHaveCount(0, { timeout: 5000 });

  // A new session row appears in the sidebar
  const sidebar = page.getByRole('complementary', { name: /sidebar/i });
  await expect(sidebar.getByRole('button', { name: /untitled/i }).first()).toBeVisible({
    timeout: 5000,
  });
});
```

- [ ] **Step 2: Run Playwright**

```bash
npx playwright test
```

Expected: PASS (8 tests now: 7 existing + 1 new).

If port 3000 is occupied locally, document the limitation in the PR and run the full suite in CI / on machine where port is free.

- [ ] **Step 3: Commit**

```bash
git add e2e/smoke.spec.ts
git commit -m "test(slice-5): playwright — ⌘K opens palette and creates session"
```

---

## Phase L — Final verification + PR

### Task L1: Verify all green, push, open PR

- [ ] **Step 1: Lint**

```bash
npm run lint
```

Expected: PASS (tsc --noEmit clean).

- [ ] **Step 2: Vitest full**

```bash
npm run test:run
```

Expected: ALL PASS. Tests count grows by the new files in this slice.

- [ ] **Step 3: Coverage**

```bash
npm run test:coverage
```

Expected: lines ≥80% on `src/hooks/useCommands.ts`, `src/hooks/useKeyboardShortcut.ts`, `src/hooks/useGlobalShortcuts.ts`, `src/components/palette/CommandPalette.tsx`.

- [ ] **Step 4: Playwright (optional locally, required in CI)**

```bash
npx playwright test
```

Expected: 8 tests PASS. If skipped locally, note in PR.

- [ ] **Step 5: Push branch**

```bash
git push -u origin feat/slice-5-cmdk
```

- [ ] **Step 6: Open PR**

```bash
gh pr create --title "feat(slice-5): command palette + shortcuts" --body "$(cat <<'EOF'
## Summary
- `cmdk`-driven command palette (⌘K) covering Sessions / Profiles / UI / Context
- Global shortcuts: ⌘K (palette), Esc (close), ⌘N (new session), ⌘B (toggle sidebar)
- `useUiStore` gains `paletteOpen` + `sidebarOpen` (localStorage); sidebar state migrated out of `App.tsx` local `useState`
- Shared `src/lib/context/addFlows.ts` so palette commands and sidebar buttons stay in sync
- `PromptDialog` gains `multiline` flag for "Edit system protocol"

## Test plan
- [x] `npm run lint` clean
- [x] `npm run test:run` — all green
- [x] `npm run test:coverage` — ≥80% on new files
- [ ] Playwright — palette golden-path test included; run once port 3000 is free

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

Expected: PR URL printed.

---

## Definition of Done

- All new unit + component + integration tests green.
- `npm run lint` clean.
- Coverage ≥80% on `useCommands.ts`, `useKeyboardShortcut.ts`, `useGlobalShortcuts.ts`, `CommandPalette.tsx`.
- Sidebar toggle button still works (sourced from store now).
- Manual smoke via `npm run dev`: ⌘K opens palette; typing filters; Enter on each command runs without console errors; ⌘N creates session; ⌘B toggles sidebar; Esc closes palette.
- Single PR on `feat/slice-5-cmdk` against `main`.
