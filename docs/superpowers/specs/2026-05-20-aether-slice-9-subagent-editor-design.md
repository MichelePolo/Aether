# Aether — Slice 9: Sub-agent Skills/Tools Editor (Design)

**Branch:** `feat/slice-9-subagent-editor`
**Date:** 2026-05-20
**Depends on:** slices 0–8 (Modal, useDialog, addFlows, useSubAgentsStore, etc.)

## Goal

Expose the existing `skills` and `tools` fields on a `SubAgentRecord` through a frontend UI, plus add inline editing for `name` and `systemInstruction`. The data model has supported these since slice 6, but the slice-6 sidebar only let the user set the name + system instruction at creation. Slice 9 lets the user inspect and edit every field of an existing sub-agent.

## Non-goals

- Backend changes. The PUT endpoint, store action, and types are already in place.
- A separate full-screen page or route. The editor lives entirely in a modal mounted from `App.tsx`.
- A bulk import/export of sub-agents (out of scope; if needed, a future slice modelled on slice 4 profiles).
- Drag-and-drop reordering of skills/tools. Slice 9 ships only Add and Remove.
- Inline editing of an individual skill name (you delete + re-add). Tool fields are similarly add-only — to change `version`, delete and re-add.
- Validation beyond what the existing `addFlows` enforce. No dedup, no length caps beyond what zod schemas already impose.
- Confirmation dialogs before removing a single skill/tool. The action is small and reversible by re-adding; one click is enough.
- Dirty tracking, "Discard changes?" prompts, or a global Save button. Every action persists on confirm.

## Decisions log

| # | Decision | Chosen | Rationale |
|---|---|---|---|
| 1 | Editor surface | Dedicated `SubAgentEditModal` mounted from App.tsx | Modal gives breathing room for the 4-field form without inflating the sidebar |
| 2 | Save semantics | Per-action, persists immediately | Reuses existing `useDialog.prompt` + `addFlows`; no dirty tracking, no race conditions |
| 3 | Open trigger | Click on the sub-agent row in `SubAgentsSection` | Matches the SessionsSection pattern (row = click); discoverable |
| 4 | Tool add flow | Reuse `addToolFlow` from slice 5 (name → version → online confirm) | Consistent with sidebar context tool flow; no custom UI |
| 5 | Skill add flow | Reuse `addSkillFlow` from slice 5 | Same |
| 6 | Tool `id` generation | Client-side via `crypto.randomUUID()` in the addFlow callback | Sub-agent PUT takes the full array as-is; the server doesn't mint per-tool ids |
| 7 | Persistence of `editingSubAgentId` | In-memory only on `useUiStore` (not localStorage) | Closing the app closes the editor — matches other modals |
| 8 | Optimistic update pattern | Modal's local `record` updates immediately; rollback on PUT failure | Snappy UX; consistent with slice-4 / slice-7 patterns |
| 9 | Remove confirmation | None (single click removes a skill/tool) | Cheap to re-add; full confirmation would feel heavy |
| 10 | Backend changes | None | Data model + PUT route + store action all shipped in slice 6 |

## Architecture

### Library

No new third-party deps. All primitives already in the codebase:
- `Modal` (slice 0)
- `useDialog` + `dialog.prompt({ multiline })` (slice 0 / 5)
- `addSkillFlow` + `addToolFlow` from `src/lib/context/addFlows.ts` (slice 5)
- `useSubAgentsStore.update(id, partial)` (slice 6)
- `subagentsApi.get(id)` (slice 6; verify it exists)
- `StatusDot` (slice 0)

### Frontend (`src/`)

| Path | Role |
|---|---|
| `stores/ui.store.ts` | **MODIFY**: add `editingSubAgentId: string \| null` + `openSubAgentEditor(id)` + `closeSubAgentEditor()` |
| `stores/ui.store.test.ts` | **MODIFY**: cover the new state |
| `components/subagents/SubAgentEditModal.tsx` | **NEW**: the modal. On open, fetches record via `subagentsApi.get`. Renders `NameRow`, `SystemInstructionRow`, `<SkillsListEditor>`, `<ToolsListEditor>` |
| `components/subagents/SubAgentEditModal.test.tsx` | **NEW** |
| `components/subagents/SkillsListEditor.tsx` | **NEW**: pure presentational + + Add button driving `addSkillFlow` |
| `components/subagents/SkillsListEditor.test.tsx` | **NEW** |
| `components/subagents/ToolsListEditor.tsx` | **NEW**: same shape but for tools, drives `addToolFlow` and mints `id` |
| `components/subagents/ToolsListEditor.test.tsx` | **NEW** |
| `components/sidebar/SubAgentsSection.tsx` | **MODIFY**: row becomes clickable → calls `openSubAgentEditor`; × stops propagation |
| `components/sidebar/SubAgentsSection.test.tsx` | **MODIFY**: cover the new click handler + propagation behaviour |
| `App.tsx` | **MODIFY**: mount `<SubAgentEditModal />` (returns null when `editingSubAgentId === null`) |
| `App.test.tsx` | **MODIFY** (small): no new test needed beyond store reset |
| `integration/subagent-edit.integration.test.tsx` | **NEW** |

### E2E

One Playwright test in `e2e/smoke.spec.ts`: create sub-agent → click row → modal opens → rename + add skill → close → sidebar reflects the new name.

### Backend

**No changes.** The PUT endpoint, the `useSubAgentsStore.update` action, and `subagentsApi.get/update` were all shipped in slice 6.

## Types

No new types. The modal works with the existing:

```ts
// from server/domain/subagents/subagents.types.ts (re-exported)
export interface SubAgentRecord {
  name: string;
  systemInstruction: string;
  skills: string[];
  tools: Tool[];
  createdAt: number;
  updatedAt: number;
}
```

### `useUiStore` extension

```ts
interface UiState {
  // ... existing fields
  editingSubAgentId: string | null;          // initial: null

  openSubAgentEditor(id: string): void;
  closeSubAgentEditor(): void;
}
```

Initial value `null`. Not persisted to localStorage.

## Data flow

### Open

```
Row click in SubAgentsSection
   ↓
useUiStore.openSubAgentEditor(id)
   ↓
SubAgentEditModal subscribes via useUiStore selector → re-renders
   ↓
useEffect on id change → subagentsApi.get(id) → setRecord(result)
   ↓
Renders title + four sections
```

### Per-field action

```
"Rename" button → dialog.prompt({ defaultValue: record.name, required: true })
   ↓
On confirm: persist({ name: newName })

persist(partial) =
   1. const prev = record;
   2. setRecord({ ...record, ...partial });
   3. await useSubAgentsStore.update(id, partial);
   4. on error: setRecord(prev); // store already sets `error`
```

`update()` from slice 6 already PATCHes and reconciles `useSubAgentsStore.list` (the meta list). The modal's `setRecord` provides the additional local-state freshness for fields not surfaced by the meta (`skills`, `tools`, `systemInstruction`).

### Skills add/remove

```
+ Add → addSkillFlow(dialog, async (name) => persist({ skills: [...record.skills, name] }))
× row → persist({ skills: record.skills.filter((_, i) => i !== index) })
```

### Tools add/remove

```
+ Add → addToolFlow(dialog, async (input) => {
  const tool: Tool = { id: crypto.randomUUID(), ...input };
  await persist({ tools: [...record.tools, tool] });
})
× row → persist({ tools: record.tools.filter((t) => t.id !== tool.id) })
```

### Close

```
Modal × button OR Escape OR backdrop click
   ↓
useUiStore.closeSubAgentEditor()
   ↓
Modal returns null; local record state discarded; next open re-fetches.
```

## Component composition

### `SubAgentEditModal`

```tsx
export function SubAgentEditModal() {
  const id = useUiStore((s) => s.editingSubAgentId);
  const close = useUiStore((s) => s.closeSubAgentEditor);
  const update = useSubAgentsStore((s) => s.update);
  const error = useSubAgentsStore((s) => s.error);
  const clearError = useSubAgentsStore((s) => s.clearError);
  const dialog = useDialog();

  const [record, setRecord] = useState<(SubAgentRecord & { id: string }) | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) {
      setRecord(null);
      setLoadError(null);
      return;
    }
    setRecord(null);
    setLoadError(null);
    subagentsApi.get(id)
      .then(setRecord)
      .catch((e) => setLoadError(e instanceof Error ? e.message : 'Failed to load'));
  }, [id]);

  if (!id) return null;

  const persist = async (partial: Partial<SubAgentRecord>) => {
    if (!record) return;
    const prev = record;
    setRecord({ ...record, ...partial });
    try {
      await update(id, partial);
    } catch {
      setRecord(prev);
    }
  };

  // ... handlers for rename, edit systemInstruction, skills add/remove, tools add/remove

  return (
    <Modal open onClose={close} title={record?.name ?? 'Sub-agent'} className="max-w-2xl">
      {/* error pill + content */}
    </Modal>
  );
}
```

### `SkillsListEditor`

Props-driven, no store coupling:

```tsx
interface SkillsListEditorProps {
  skills: string[];
  onAdd: (name: string) => Promise<void> | void;
  onRemove: (index: number) => Promise<void> | void;
}
```

Renders: header `"Skills [N]"`, one row per skill with hover ×, + Add button at bottom that calls `addSkillFlow(dialog, onAdd)`.

### `ToolsListEditor`

```tsx
interface ToolsListEditorProps {
  tools: Tool[];
  onAdd: (tool: Tool) => Promise<void> | void;
  onRemove: (id: string) => Promise<void> | void;
}
```

Same shape but for tools. + Add wraps `addToolFlow(dialog, async (input) => { onAdd({ id: crypto.randomUUID(), ...input }); })`.

### `SubAgentsSection` (modified)

```tsx
<div
  key={sa.id}
  onClick={() => openSubAgentEditor(sa.id)}
  className="group ... cursor-pointer ..."
>
  <span className="truncate">{sa.name}</span>
  <div className="hidden group-hover:flex gap-1">
    <button
      onClick={(e) => {
        e.stopPropagation();
        handleDelete(sa.id, sa.name);
      }}
      aria-label={`Delete ${sa.name}`}
    >×</button>
  </div>
</div>
```

`e.stopPropagation()` on the × is the only subtle bit — without it, clicking × would also open the modal.

## Error handling

| Source | Behaviour |
|---|---|
| `subagentsApi.get(id)` fails on open | Modal shows "Failed to load sub-agent: <message>" inline; no retry button; user closes |
| `update()` fails | `useSubAgentsStore` sets `error`; modal shows it in an error pill; local `record` rolled back |
| User opens for deleted id | `get()` 404 → "Sub-agent not found" message; close still works |
| `dialog.prompt` cancelled | The flow returns null/false; no API call; no state change |
| Closing the modal mid-PUT | The PUT completes server-side; local state is discarded; next open re-fetches |
| Two rapid clicks (e.g. add A then add B before A's PUT finishes) | Each click reads the closure-captured `record`; the last PUT wins. In normal user flow this is essentially impossible because the prompt dialog blocks until the user responds. We accept this limit and don't add a queue. |
| `crypto.randomUUID()` collision with an existing tool id | Astronomically improbable; we don't guard against it |

## Persistence

- `editingSubAgentId` in `useUiStore`: in-memory only.
- Sub-agent fields (`name`, `systemInstruction`, `skills`, `tools`): persisted by the existing `useSubAgentsStore.update` → PUT `/api/subagents/:id` → `data/subagents.json` via JsonStore (slice 6).
- No new server-side state.

## Testing

### Unit / component (Vitest + RTL + MSW)

`SubAgentEditModal.test.tsx`:
- Returns null when `editingSubAgentId === null`.
- On open: fetches via MSW handler, renders name as title.
- "Loading…" appears while the fetch is pending.
- Rename click → prompt → on confirm calls `update(id, { name })` and updates local title.
- Edit system instruction click → multiline prompt → calls `update(id, { systemInstruction })`.
- Fetch failure → "Failed to load sub-agent" message.
- Close button calls `useUiStore.closeSubAgentEditor`.

`SkillsListEditor.test.tsx`:
- Empty state when `skills: []`.
- One row per skill.
- + Add opens prompt → on confirm calls `onAdd(name)`; cancelled prompt does NOT call.
- × on a row calls `onRemove(index)`.

`ToolsListEditor.test.tsx`:
- Empty state.
- One row per tool with name + version + StatusDot.
- + Add runs the 3-step `addToolFlow` → calls `onAdd(tool)` with a fresh `id` and the right fields.
- × on a row calls `onRemove(id)`.

`SubAgentsSection.test.tsx` (extend):
- Click on row calls `useUiStore.openSubAgentEditor(id)`.
- Click on × button does NOT open the editor (propagation stopped).
- Existing tests still pass.

`ui.store.test.ts` (extend):
- `editingSubAgentId` default null; `openSubAgentEditor(id)` sets; `closeSubAgentEditor()` clears.

### Integration (RTL + MSW)

`subagent-edit.integration.test.tsx`:
- Mount `<App />`, seed one sub-agent in the store and a GET handler.
- Click row → modal opens, GET called, fields rendered.
- Click Rename → fill prompt → submit → PATCH intercepted with `{ name: 'new' }`.
- Click + Add skill → prompt → confirm → PATCH intercepted with the new skills array.
- Close modal — disappears.

### E2E (Playwright)

`subagent edit: rename + add skill via modal`:
1. Create a sub-agent via the existing sidebar `+ New sub-agent` (or seed via `POST /api/subagents`).
2. Click the row → modal opens.
3. Click Rename → fill new name → confirm → modal title updates.
4. Click + Add skill → fill name → confirm → row appears in modal.
5. Close modal.
6. Sidebar shows the renamed sub-agent.

### Coverage target (≥80%)

- `SubAgentEditModal.tsx`
- `SkillsListEditor.tsx`
- `ToolsListEditor.tsx`

## Risks

| Risk | Mitigation |
|---|---|
| `subagentsApi.get(id)` doesn't exist on the FE | Verified in spec — slice 6 shipped it. If somehow absent, add a one-liner mirroring `profiles.api.get`. |
| Local `record` state diverges from `useSubAgentsStore.list` after `update()` | The store reconciles its own list; the modal updates `record` optimistically. If a discrepancy appears, closing + reopening re-fetches. |
| Bigger sub-agent records (many skills/tools) make the modal scroll | The modal's content area is scrollable via the existing `Modal` primitive's overflow handling. |
| Tool id collisions | `crypto.randomUUID()` collision probability is effectively zero. |
| User opens the modal during streaming dispatch | Both can run; the dispatch doesn't read sub-agent records mid-stream (only at the start of each dispatch). Edits made now will take effect on the next dispatch. |
| User edits a sub-agent while it's the active `@mention` in flight | Same as above; safe. |

## Definition of Done

- All new FE unit / component / integration tests green.
- `e2e/smoke.spec.ts` gains 1 test; total 12.
- `npm run lint` clean.
- Coverage ≥80% on `SubAgentEditModal.tsx`, `SkillsListEditor.tsx`, `ToolsListEditor.tsx`.
- Sidebar row click opens the modal; per-action edits persist; sidebar reflects the new name after rename.
- One PR on `feat/slice-9-subagent-editor` against `main`.
