# Session Approvals Panel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the user see the session "sticky" auto-approvals and revoke them (one or all) from a sub-block inside the sidebar Breakpoints section.

**Architecture:** Purely client-side. `chat.store` already holds `stickyApprovals: Set<string>` with `addStickyApproval`/`clearStickyApprovals`; add a `removeStickyApproval`. `BreakpointsSection` reads the set and renders a list with per-row revoke (×) + a Clear all button. New i18n strings under `breakpoints.sessionApprovals.*`.

**Tech Stack:** React 19 + Zustand, Vitest + Testing Library (frontend `jsdom` project), i18n via `t()`.

---

## File Structure

- **Modify:** `src/stores/chat.store.ts` — add `removeStickyApproval` (interface + impl).
- **Modify:** `src/i18n/en.ts` — add `breakpoints.sessionApprovals.*` strings.
- **Modify:** `src/components/sidebar/BreakpointsSection.tsx` — render the Session approvals sub-block.
- **Test:** `src/stores/chat.store.test.ts`, `src/components/sidebar/BreakpointsSection.test.tsx`.

---

## Task 1: Store — `removeStickyApproval`

**Files:**
- Modify: `src/stores/chat.store.ts`
- Test: `src/stores/chat.store.test.ts`

- [ ] **Step 1: Write the failing test**

Append inside the existing `describe('useChatStore stickyApprovals', ...)` block in `src/stores/chat.store.test.ts` (it already resets state per test):

```ts
  it('removeStickyApproval removes only the named tool', () => {
    useChatStore.getState().addStickyApproval('fs.write_file');
    useChatStore.getState().addStickyApproval('git.git_commit');
    useChatStore.getState().removeStickyApproval('fs.write_file');
    const sticky = useChatStore.getState().stickyApprovals;
    expect(sticky.has('fs.write_file')).toBe(false);
    expect(sticky.has('git.git_commit')).toBe(true);
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/stores/chat.store.test.ts -t "removeStickyApproval"`
Expected: FAIL — `removeStickyApproval is not a function`.

- [ ] **Step 3: Add the action to the interface**

In `src/stores/chat.store.ts`, in the `ChatState` interface, add the new method next to the existing sticky actions:

```ts
  addStickyApproval: (qualifiedName: string) => void;
  removeStickyApproval: (qualifiedName: string) => void;
  clearStickyApprovals: () => void;
```

- [ ] **Step 4: Implement the action**

In the same file, add the implementation right after `addStickyApproval`:

```ts
  removeStickyApproval: (qualifiedName) =>
    set((s) => {
      const next = new Set(s.stickyApprovals);
      next.delete(qualifiedName);
      return { stickyApprovals: next };
    }),
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run src/stores/chat.store.test.ts`
Expected: PASS (whole file).

- [ ] **Step 6: Commit**

```bash
git add src/stores/chat.store.ts src/stores/chat.store.test.ts
git commit -m "feat(chat): removeStickyApproval action"
```

---

## Task 2: i18n strings

**Files:**
- Modify: `src/i18n/en.ts`

- [ ] **Step 1: Add the strings**

In `src/i18n/en.ts`, inside the existing `breakpoints` object (which currently has `heading` and `helpText`), add a `sessionApprovals` block:

```ts
  breakpoints: {
    heading: 'Breakpoints',
    helpText:
      'Tools are auto-classified by name. "Safe" runs without prompts; "Dangerous" (file writes, shell exec, git push/rebase/reset) and "External" (override-only, for API calls) gate via the approval modal.',
    sessionApprovals: {
      heading: 'Session approvals',
      empty: 'No session approvals.',
      clearAll: 'Clear all',
      help: 'Tools you auto-approved for this session only. Cleared on reload.',
    },
  },
```

- [ ] **Step 2: Type-check**

Run: `npm run lint`
Expected: clean (the i18n object is strongly typed; this confirms the new keys are well-formed).

- [ ] **Step 3: Commit**

```bash
git add src/i18n/en.ts
git commit -m "i18n: session approvals strings"
```

---

## Task 3: UI — Session approvals sub-block

**Files:**
- Modify: `src/components/sidebar/BreakpointsSection.tsx`
- Test: `src/components/sidebar/BreakpointsSection.test.tsx`

- [ ] **Step 1: Write the failing tests**

Append to `src/components/sidebar/BreakpointsSection.test.tsx`. Add `useChatStore` to the imports at the top of the file:

```ts
import { useChatStore } from '@/src/stores/chat.store';
```

Then append these tests after the existing ones (inside the top-level `describe('BreakpointsSection', ...)`):

```ts
  it('shows the empty state when there are no session approvals', () => {
    useChatStore.getState().reset();
    render(<BreakpointsSection />);
    expect(screen.getByText('No session approvals.')).toBeInTheDocument();
  });

  it('lists session approvals and revokes one on ×', () => {
    useChatStore.getState().reset();
    useChatStore.getState().addStickyApproval('fs.write_file');
    useChatStore.getState().addStickyApproval('git.git_commit');
    render(<BreakpointsSection />);

    expect(screen.getAllByTestId('session-approval-row').length).toBe(2);
    fireEvent.click(screen.getByRole('button', { name: 'Revoke fs.write_file' }));

    expect(screen.queryByText('fs.write_file')).not.toBeInTheDocument();
    expect(screen.getByText('git.git_commit')).toBeInTheDocument();
  });

  it('Clear all revokes every session approval', () => {
    useChatStore.getState().reset();
    useChatStore.getState().addStickyApproval('fs.write_file');
    useChatStore.getState().addStickyApproval('git.git_commit');
    render(<BreakpointsSection />);

    fireEvent.click(screen.getByRole('button', { name: 'Clear all' }));
    expect(screen.getByText('No session approvals.')).toBeInTheDocument();
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/components/sidebar/BreakpointsSection.test.tsx -t "session approval"`
Expected: FAIL — the empty text / rows / buttons don't exist yet.

- [ ] **Step 3: Add the store wiring**

In `src/components/sidebar/BreakpointsSection.tsx`, add the import near the other imports:

```ts
import { useChatStore } from '@/src/stores/chat.store';
```

Inside the `BreakpointsSection` component, after the existing `policy`/`setCategoryMode` selectors, add:

```ts
  const stickyApprovals = useChatStore((s) => s.stickyApprovals);
  const removeStickyApproval = useChatStore((s) => s.removeStickyApproval);
  const clearStickyApprovals = useChatStore((s) => s.clearStickyApprovals);
  const stickyNames = [...stickyApprovals].sort();
```

- [ ] **Step 4: Render the sub-block**

In the same file, insert this block immediately before the closing `</section>` tag (after the category-rows `<div className="space-y-1">…</div>`):

```tsx
      <div className="mt-4">
        <div className="flex items-center gap-2 mb-2">
          <span className="mono-label">{t('breakpoints.sessionApprovals.heading')}</span>
          <span className="text-[10px] text-zinc-600">[{stickyNames.length}]</span>
          <Tooltip label={t('breakpoints.sessionApprovals.help')}>
            <button
              type="button"
              aria-label="What are session approvals?"
              className="text-zinc-600 hover:text-zinc-300 text-[10px]"
            >
              ?
            </button>
          </Tooltip>
        </div>
        {stickyNames.length === 0 ? (
          <div className="text-[10px] text-zinc-600 font-mono italic">
            {t('breakpoints.sessionApprovals.empty')}
          </div>
        ) : (
          <div className="space-y-1">
            {stickyNames.map((name) => (
              <div
                key={name}
                data-testid="session-approval-row"
                className="flex items-center gap-2 p-1.5 bg-zinc-900 border border-border-subtle rounded text-[10px] font-mono"
              >
                <span className="text-zinc-300 flex-1 truncate">{name}</span>
                <button
                  type="button"
                  aria-label={`Revoke ${name}`}
                  onClick={() => removeStickyApproval(name)}
                  className="text-zinc-500 hover:text-status-error"
                >
                  ×
                </button>
              </div>
            ))}
            <button
              type="button"
              onClick={() => clearStickyApprovals()}
              className="w-full p-1 border border-dashed border-border-subtle rounded text-[10px] text-zinc-600 hover:text-zinc-400 transition-colors mt-2"
            >
              {t('breakpoints.sessionApprovals.clearAll')}
            </button>
          </div>
        )}
      </div>
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run src/components/sidebar/BreakpointsSection.test.tsx`
Expected: PASS (whole file — the original category tests still pass).

- [ ] **Step 6: Commit**

```bash
git add src/components/sidebar/BreakpointsSection.tsx src/components/sidebar/BreakpointsSection.test.tsx
git commit -m "feat(ui): session approvals sub-block with per-tool + clear-all revoke"
```

---

## Task 4: Full verification

- [ ] **Step 1: Type-check**

Run: `npm run lint`
Expected: clean.

- [ ] **Step 2: Full suite**

Run: `npx vitest run`
Expected: all pass.

- [ ] **Step 3: Commit (only if fixups were needed)**

```bash
git add -A
git commit -m "test: session approvals panel fixups"
```

---

## Self-review notes (author)

- **Spec coverage:** store `removeStickyApproval` (Task 1), i18n (Task 2), sub-block with list + per-row revoke + clear-all + empty state inside Breakpoints (Task 3), verification (Task 4). All spec requirements mapped.
- **Type consistency:** `removeStickyApproval(qualifiedName: string): void` and the existing `addStickyApproval`/`clearStickyApprovals` names are used identically across store, tests, and component. `stickyApprovals` is a `Set<string>`; the component iterates a sorted copy for deterministic rendering/tests.
- **No placeholders:** every step shows the exact code/commands.
- **No backend/migration/route changes** — the data is intentionally session-only and client-side.
