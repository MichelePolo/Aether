# Aether Slice 9 — Sub-agent Editor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expose existing `skills` and `tools` fields on `SubAgentRecord` through a frontend modal (plus inline editing for `name` and `systemInstruction`), so users can fully manage sub-agents created in slice 6.

**Architecture:** A new `SubAgentEditModal` mounts in `App.tsx` and renders when `useUiStore.editingSubAgentId` is non-null. On open it fetches the full record via `subagentsApi.get(id)`. Each field change persists immediately via `useSubAgentsStore.update(id, partial)` (no global Save button). Skills/tools list editors are dedicated presentational components driven by the slice-5 `addSkillFlow`/`addToolFlow`. Backend is untouched.

**Tech Stack:** Zustand 5, MSW 2, Vitest 4.1.6, RTL + user-event, Playwright. Existing `Modal`, `useDialog`, `addFlows`, `useSubAgentsStore`. No new third-party deps.

**Reference spec:** `docs/superpowers/specs/2026-05-20-aether-slice-9-subagent-editor-design.md`

**Branch:** `feat/slice-9-subagent-editor` (already checked out; spec already committed)

**Lavora con un solo branch dall'inizio alla fine; ogni Task termina con un commit verde su questo branch.**

---

## File structure (NEW unless marked MODIFY)

```
src/
  stores/
    ui.store.ts                                      # MODIFY: +editingSubAgentId + open/close
    ui.store.test.ts                                 # MODIFY: cover new state
  components/subagents/
    SubAgentEditModal.tsx                            # NEW
    SubAgentEditModal.test.tsx                       # NEW
    SkillsListEditor.tsx                             # NEW
    SkillsListEditor.test.tsx                        # NEW
    ToolsListEditor.tsx                              # NEW
    ToolsListEditor.test.tsx                         # NEW
  components/sidebar/
    SubAgentsSection.tsx                             # MODIFY: row click + stopPropagation
    SubAgentsSection.test.tsx                        # MODIFY: cover new click handler
  App.tsx                                            # MODIFY: mount <SubAgentEditModal />
  integration/
    subagent-edit.integration.test.tsx               # NEW

e2e/
  smoke.spec.ts                                      # MODIFY: append edit-modal test
```

**Backend:** unchanged.

---

## Phase A — Pre-flight

### Task A1: Verify branch + clean tree

- [ ] **Step 1: Run**

```bash
git rev-parse --abbrev-ref HEAD
git status --porcelain
```

Expected: branch `feat/slice-9-subagent-editor`; second command empty.

No commit.

---

## Phase B — `useUiStore` extension

### Task B1: Add `editingSubAgentId` + open/close

**Files:**
- Modify: `src/stores/ui.store.ts`
- Modify: `src/stores/ui.store.test.ts`

- [ ] **Step 1: Append failing tests in `src/stores/ui.store.test.ts`**

Inside the existing `describe('useUiStore', ...)`:

```ts
it('editingSubAgentId defaults to null', () => {
  expect(useUiStore.getState().editingSubAgentId).toBeNull();
});

it('openSubAgentEditor sets the id; closeSubAgentEditor clears it', () => {
  useUiStore.getState().openSubAgentEditor('SA1');
  expect(useUiStore.getState().editingSubAgentId).toBe('SA1');
  useUiStore.getState().closeSubAgentEditor();
  expect(useUiStore.getState().editingSubAgentId).toBeNull();
});
```

- [ ] **Step 2: Run, expect FAIL**

```bash
npx vitest run src/stores/ui.store.test.ts
```

- [ ] **Step 3: Modify `src/stores/ui.store.ts`**

Add to the `UiState` interface (after `profilesModalOpen` and similar fields):

```ts
  editingSubAgentId: string | null;

  openSubAgentEditor: (id: string) => void;
  closeSubAgentEditor: () => void;
```

Add to the `initial` object:

```ts
  editingSubAgentId: null as string | null,
```

Add the actions in the `create` body (alongside `openProfilesModal` / `closeProfilesModal`):

```ts
  openSubAgentEditor: (id) => set({ editingSubAgentId: id }),
  closeSubAgentEditor: () => set({ editingSubAgentId: null }),
```

- [ ] **Step 4: Run, expect PASS**

```bash
npx vitest run src/stores/ui.store.test.ts
```

- [ ] **Step 5: Lint + commit**

```bash
npm run lint
git add src/stores/ui.store.ts src/stores/ui.store.test.ts
git commit -m "feat(slice-9): useUiStore +editingSubAgentId + open/close"
```

---

## Phase C — `SkillsListEditor`

### Task C1: Presentational skills list with + Add and × per item

**Files:**
- Create: `src/components/subagents/SkillsListEditor.tsx`
- Create: `src/components/subagents/SkillsListEditor.test.tsx`

- [ ] **Step 1: Failing tests**

```tsx
// src/components/subagents/SkillsListEditor.test.tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SkillsListEditor } from './SkillsListEditor';
import { DialogHost } from '@/src/components/layout/DialogHost';

describe('SkillsListEditor', () => {
  it('shows empty state when skills=[]', () => {
    render(<SkillsListEditor skills={[]} onAdd={() => {}} onRemove={() => {}} />);
    expect(screen.getByText(/no skills/i)).toBeInTheDocument();
  });

  it('renders one row per skill', () => {
    render(
      <SkillsListEditor
        skills={['layout', 'color']}
        onAdd={() => {}}
        onRemove={() => {}}
      />,
    );
    expect(screen.getByText('layout')).toBeInTheDocument();
    expect(screen.getByText('color')).toBeInTheDocument();
  });

  it('+ Add opens prompt; on confirm calls onAdd with the typed name', async () => {
    const onAdd = vi.fn().mockResolvedValue(undefined);
    const user = userEvent.setup();
    render(
      <>
        <DialogHost />
        <SkillsListEditor skills={[]} onAdd={onAdd} onRemove={() => {}} />
      </>,
    );
    await user.click(screen.getByRole('button', { name: /add skill/i }));
    const input = await screen.findByLabelText(/skill name/i);
    await user.type(input, 'new-skill');
    await user.click(screen.getByRole('button', { name: /confirm/i }));
    expect(onAdd).toHaveBeenCalledWith('new-skill');
  });

  it('× on a row calls onRemove with the index', async () => {
    const onRemove = vi.fn();
    const user = userEvent.setup();
    render(<SkillsListEditor skills={['a', 'b']} onAdd={() => {}} onRemove={onRemove} />);
    await user.hover(screen.getByText('a'));
    await user.click(screen.getAllByRole('button', { name: /remove skill/i })[0]);
    expect(onRemove).toHaveBeenCalledWith(0);
  });
});
```

- [ ] **Step 2: Run, expect FAIL**

```bash
npx vitest run src/components/subagents/SkillsListEditor.test.tsx
```

- [ ] **Step 3: Implement `src/components/subagents/SkillsListEditor.tsx`**

```tsx
import { addSkillFlow } from '@/src/lib/context/addFlows';
import { useDialog } from '@/src/hooks/useDialog';

export interface SkillsListEditorProps {
  skills: string[];
  onAdd: (name: string) => Promise<void> | void;
  onRemove: (index: number) => Promise<void> | void;
}

export function SkillsListEditor({ skills, onAdd, onRemove }: SkillsListEditorProps) {
  const dialog = useDialog();

  const handleAdd = () =>
    addSkillFlow(dialog, async (name) => {
      await onAdd(name);
    });

  return (
    <section>
      <div className="flex items-center justify-between mb-2">
        <div className="mono-label">Skills</div>
        <span className="text-[10px] text-zinc-600">[{skills.length}]</span>
      </div>
      <div className="space-y-1">
        {skills.length === 0 ? (
          <div className="text-[10px] text-zinc-600 font-mono italic">No skills.</div>
        ) : (
          skills.map((skill, i) => (
            <div
              key={`${i}-${skill}`}
              className="group flex items-center justify-between p-1.5 rounded bg-zinc-900 border border-border-subtle text-[10px] font-mono text-zinc-400"
            >
              <span className="truncate">{skill}</span>
              <button
                type="button"
                aria-label={`Remove skill ${skill}`}
                onClick={() => onRemove(i)}
                className="hidden group-hover:inline hover:text-red-400 text-zinc-500"
              >
                ×
              </button>
            </div>
          ))
        )}
        <button
          type="button"
          onClick={handleAdd}
          aria-label="Add skill"
          className="w-full p-1 border border-dashed border-border-subtle rounded text-[10px] text-zinc-600 hover:text-zinc-400 transition-colors mt-2"
        >
          + Add skill
        </button>
      </div>
    </section>
  );
}
```

- [ ] **Step 4: Run, expect PASS**

```bash
npx vitest run src/components/subagents/SkillsListEditor.test.tsx
```

- [ ] **Step 5: Lint + commit**

```bash
npm run lint
git add src/components/subagents/SkillsListEditor.tsx src/components/subagents/SkillsListEditor.test.tsx
git commit -m "feat(slice-9): add SkillsListEditor (props-driven; reuses addSkillFlow)"
```

---

## Phase D — `ToolsListEditor`

### Task D1: Presentational tools list with + Add (3-step flow) and × per item

**Files:**
- Create: `src/components/subagents/ToolsListEditor.tsx`
- Create: `src/components/subagents/ToolsListEditor.test.tsx`

- [ ] **Step 1: Failing tests**

```tsx
// src/components/subagents/ToolsListEditor.test.tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ToolsListEditor } from './ToolsListEditor';
import { DialogHost } from '@/src/components/layout/DialogHost';
import type { Tool } from '@/src/types/context.types';

const sample: Tool[] = [
  { id: 't1', name: 'figma', version: '1.0.0', status: 'online' },
  { id: 't2', name: 'photoshop', version: '2.4', status: 'offline' },
];

describe('ToolsListEditor', () => {
  it('shows empty state when tools=[]', () => {
    render(<ToolsListEditor tools={[]} onAdd={() => {}} onRemove={() => {}} />);
    expect(screen.getByText(/no tools/i)).toBeInTheDocument();
  });

  it('renders one row per tool with name + version', () => {
    render(<ToolsListEditor tools={sample} onAdd={() => {}} onRemove={() => {}} />);
    expect(screen.getByText('figma')).toBeInTheDocument();
    expect(screen.getByText(/1\.0\.0/)).toBeInTheDocument();
    expect(screen.getByText('photoshop')).toBeInTheDocument();
  });

  it('+ Add runs the 3-step flow → calls onAdd with a tool having a fresh id', async () => {
    const onAdd = vi.fn().mockResolvedValue(undefined);
    const user = userEvent.setup();
    render(
      <>
        <DialogHost />
        <ToolsListEditor tools={[]} onAdd={onAdd} onRemove={() => {}} />
      </>,
    );
    await user.click(screen.getByRole('button', { name: /add tool/i }));
    const nameInput = await screen.findByLabelText(/^name$/i);
    await user.type(nameInput, 'figma');
    await user.click(screen.getByRole('button', { name: /confirm/i }));
    const versionInput = await screen.findByLabelText(/version/i);
    await user.clear(versionInput);
    await user.type(versionInput, '2.0.0');
    await user.click(screen.getByRole('button', { name: /confirm/i }));
    // Confirm dialog asks Online / Offline. Default labels: 'Online' / 'Offline'.
    await user.click(screen.getByRole('button', { name: /online/i }));
    expect(onAdd).toHaveBeenCalledTimes(1);
    const tool = onAdd.mock.calls[0][0] as Tool;
    expect(tool.name).toBe('figma');
    expect(tool.version).toBe('2.0.0');
    expect(tool.status).toBe('online');
    expect(typeof tool.id).toBe('string');
    expect(tool.id.length).toBeGreaterThan(0);
  });

  it('× on a row calls onRemove with the tool id', async () => {
    const onRemove = vi.fn();
    const user = userEvent.setup();
    render(<ToolsListEditor tools={sample} onAdd={() => {}} onRemove={onRemove} />);
    await user.hover(screen.getByText('figma'));
    await user.click(screen.getAllByRole('button', { name: /remove tool/i })[0]);
    expect(onRemove).toHaveBeenCalledWith('t1');
  });
});
```

- [ ] **Step 2: Run, expect FAIL**

```bash
npx vitest run src/components/subagents/ToolsListEditor.test.tsx
```

- [ ] **Step 3: Implement `src/components/subagents/ToolsListEditor.tsx`**

```tsx
import { addToolFlow } from '@/src/lib/context/addFlows';
import { useDialog } from '@/src/hooks/useDialog';
import { StatusDot } from '@/src/components/ui/StatusDot';
import type { Tool } from '@/src/types/context.types';

export interface ToolsListEditorProps {
  tools: Tool[];
  onAdd: (tool: Tool) => Promise<void> | void;
  onRemove: (id: string) => Promise<void> | void;
}

export function ToolsListEditor({ tools, onAdd, onRemove }: ToolsListEditorProps) {
  const dialog = useDialog();

  const handleAdd = () =>
    addToolFlow(dialog, async (input) => {
      const tool: Tool = { id: crypto.randomUUID(), ...input };
      await onAdd(tool);
    });

  return (
    <section>
      <div className="flex items-center justify-between mb-2">
        <div className="mono-label">Tools</div>
        <span className="text-[10px] text-zinc-600">[{tools.length}]</span>
      </div>
      <div className="space-y-1">
        {tools.length === 0 ? (
          <div className="text-[10px] text-zinc-600 font-mono italic">No tools.</div>
        ) : (
          tools.map((tool) => (
            <div
              key={tool.id}
              className="group flex items-center justify-between p-1.5 rounded bg-zinc-900 border border-border-subtle text-[10px] font-mono text-zinc-400"
            >
              <div className="flex items-center gap-2 truncate">
                <span className="truncate">{tool.name}</span>
                <span className="text-zinc-600">{tool.version}</span>
              </div>
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  aria-label={`Remove tool ${tool.name}`}
                  onClick={() => onRemove(tool.id)}
                  className="hidden group-hover:inline hover:text-red-400 text-zinc-500"
                >
                  ×
                </button>
                <StatusDot status={tool.status} label={tool.name} />
              </div>
            </div>
          ))
        )}
        <button
          type="button"
          onClick={handleAdd}
          aria-label="Add tool"
          className="w-full p-1 border border-dashed border-border-subtle rounded text-[10px] text-zinc-600 hover:text-zinc-400 transition-colors mt-2"
        >
          + Add tool
        </button>
      </div>
    </section>
  );
}
```

- [ ] **Step 4: Run, expect PASS**

```bash
npx vitest run src/components/subagents/ToolsListEditor.test.tsx
```

- [ ] **Step 5: Lint + commit**

```bash
npm run lint
git add src/components/subagents/ToolsListEditor.tsx src/components/subagents/ToolsListEditor.test.tsx
git commit -m "feat(slice-9): add ToolsListEditor (props-driven; reuses addToolFlow + mint id)"
```

---

## Phase E — `SubAgentEditModal`

### Task E1: The modal that pulls everything together

**Files:**
- Create: `src/components/subagents/SubAgentEditModal.tsx`
- Create: `src/components/subagents/SubAgentEditModal.test.tsx`

- [ ] **Step 1: Failing tests**

```tsx
// src/components/subagents/SubAgentEditModal.test.tsx
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { server } from '@/src/test/msw-server';
import { SubAgentEditModal } from './SubAgentEditModal';
import { DialogHost } from '@/src/components/layout/DialogHost';
import { useUiStore } from '@/src/stores/ui.store';
import { useSubAgentsStore } from '@/src/stores/subagents.store';

beforeEach(() => {
  useUiStore.getState()._reset();
  useSubAgentsStore.getState()._reset();
});

function renderModal() {
  return render(
    <>
      <DialogHost />
      <SubAgentEditModal />
    </>,
  );
}

describe('SubAgentEditModal', () => {
  it('renders nothing when editingSubAgentId is null', () => {
    const { container } = renderModal();
    expect(container.querySelector('[role="dialog"]')).toBeNull();
  });

  it('fetches and renders the sub-agent when opened', async () => {
    server.use(
      http.get('http://localhost/api/subagents/SA1', () =>
        HttpResponse.json({
          id: 'SA1',
          name: 'designer',
          systemInstruction: 'You design.',
          skills: ['layout'],
          tools: [{ id: 't1', name: 'figma', version: '1.0.0', status: 'online' }],
          createdAt: 1,
          updatedAt: 2,
        }),
      ),
    );
    useUiStore.setState({ editingSubAgentId: 'SA1' });
    renderModal();
    await waitFor(() => expect(screen.getByText('designer')).toBeInTheDocument());
    expect(screen.getByText('You design.')).toBeInTheDocument();
    expect(screen.getByText('layout')).toBeInTheDocument();
    expect(screen.getByText('figma')).toBeInTheDocument();
  });

  it('Rename → prompt → confirm → calls store.update with new name', async () => {
    server.use(
      http.get('http://localhost/api/subagents/SA1', () =>
        HttpResponse.json({
          id: 'SA1', name: 'designer', systemInstruction: '', skills: [], tools: [],
          createdAt: 1, updatedAt: 2,
        }),
      ),
    );
    useUiStore.setState({ editingSubAgentId: 'SA1' });
    const updateSpy = vi.spyOn(useSubAgentsStore.getState(), 'update').mockResolvedValue(undefined);
    const user = userEvent.setup();
    renderModal();
    await waitFor(() => expect(screen.getByText('designer')).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: /rename/i }));
    const input = await screen.findByLabelText(/^name$/i);
    await user.clear(input);
    await user.type(input, 'newname');
    await user.click(screen.getByRole('button', { name: /confirm/i }));
    await waitFor(() => expect(updateSpy).toHaveBeenCalledWith('SA1', { name: 'newname' }));
  });

  it('Edit system instruction calls update with the new value', async () => {
    server.use(
      http.get('http://localhost/api/subagents/SA1', () =>
        HttpResponse.json({
          id: 'SA1', name: 'd', systemInstruction: 'old', skills: [], tools: [],
          createdAt: 1, updatedAt: 2,
        }),
      ),
    );
    useUiStore.setState({ editingSubAgentId: 'SA1' });
    const updateSpy = vi.spyOn(useSubAgentsStore.getState(), 'update').mockResolvedValue(undefined);
    const user = userEvent.setup();
    renderModal();
    await waitFor(() => expect(screen.getByText('old')).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: /edit system instruction/i }));
    const ta = await screen.findByLabelText(/system instruction/i);
    await user.clear(ta);
    await user.type(ta, 'newsys');
    await user.click(screen.getByRole('button', { name: /confirm/i }));
    await waitFor(() => expect(updateSpy).toHaveBeenCalledWith('SA1', { systemInstruction: 'newsys' }));
  });

  it('shows "Failed to load" when GET fails', async () => {
    server.use(
      http.get('http://localhost/api/subagents/SA1', () =>
        HttpResponse.json({ error: { message: 'Boom' } }, { status: 500 }),
      ),
    );
    useUiStore.setState({ editingSubAgentId: 'SA1' });
    renderModal();
    await waitFor(() => expect(screen.getByText(/failed to load/i)).toBeInTheDocument());
  });

  it('close button calls closeSubAgentEditor', async () => {
    server.use(
      http.get('http://localhost/api/subagents/SA1', () =>
        HttpResponse.json({
          id: 'SA1', name: 'designer', systemInstruction: '', skills: [], tools: [],
          createdAt: 1, updatedAt: 2,
        }),
      ),
    );
    useUiStore.setState({ editingSubAgentId: 'SA1' });
    const closeSpy = vi.spyOn(useUiStore.getState(), 'closeSubAgentEditor');
    const user = userEvent.setup();
    renderModal();
    await waitFor(() => expect(screen.getByText('designer')).toBeInTheDocument());
    await user.keyboard('{Escape}');
    expect(closeSpy).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run, expect FAIL**

```bash
npx vitest run src/components/subagents/SubAgentEditModal.test.tsx
```

- [ ] **Step 3: Implement `src/components/subagents/SubAgentEditModal.tsx`**

```tsx
import { useEffect, useState } from 'react';
import { Modal } from '@/src/components/ui/Modal';
import { useUiStore } from '@/src/stores/ui.store';
import { useSubAgentsStore } from '@/src/stores/subagents.store';
import { useDialog } from '@/src/hooks/useDialog';
import { subagentsApi } from '@/src/lib/api/subagents.api';
import type { SubAgentRecord } from '@/src/types/subagent.types';
import type { Tool } from '@/src/types/context.types';
import { SkillsListEditor } from './SkillsListEditor';
import { ToolsListEditor } from './ToolsListEditor';

type FullRecord = SubAgentRecord & { id: string };

export function SubAgentEditModal() {
  const id = useUiStore((s) => s.editingSubAgentId);
  const close = useUiStore((s) => s.closeSubAgentEditor);
  const update = useSubAgentsStore((s) => s.update);
  const error = useSubAgentsStore((s) => s.error);
  const clearError = useSubAgentsStore((s) => s.clearError);
  const dialog = useDialog();

  const [record, setRecord] = useState<FullRecord | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) {
      setRecord(null);
      setLoadError(null);
      return;
    }
    setRecord(null);
    setLoadError(null);
    subagentsApi
      .get(id)
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

  const handleRename = async () => {
    if (!record) return;
    const name = await dialog.prompt({
      title: 'Rename sub-agent',
      label: 'Name',
      defaultValue: record.name,
      required: true,
    });
    if (name) await persist({ name });
  };

  const handleEditSystem = async () => {
    if (!record) return;
    const text = await dialog.prompt({
      title: 'Edit system instruction',
      label: 'System instruction',
      defaultValue: record.systemInstruction,
      multiline: true,
    });
    if (text !== null) await persist({ systemInstruction: text });
  };

  return (
    <Modal open onClose={close} title={record?.name ?? 'Sub-agent'} className="max-w-2xl">
      {loadError ? (
        <div className="p-2 rounded bg-status-error/10 border border-status-error/40 text-status-error text-xs">
          Failed to load: {loadError}
        </div>
      ) : record === null ? (
        <div className="text-xs text-zinc-500 italic">Loading…</div>
      ) : (
        <div className="space-y-4">
          {error && (
            <div className="p-1.5 rounded bg-status-error/10 border border-status-error/40 text-status-error text-[10px] flex items-center gap-2">
              <span className="flex-1">⚠ {error}</span>
              <button
                type="button"
                aria-label="Dismiss error"
                onClick={clearError}
                className="hover:text-white"
              >
                ×
              </button>
            </div>
          )}

          <section>
            <div className="flex items-center justify-between mb-1">
              <div className="mono-label">Name</div>
              <button
                type="button"
                onClick={handleRename}
                className="text-[10px] text-accent hover:text-white"
              >
                Rename
              </button>
            </div>
            <div className="p-1.5 rounded bg-zinc-900 border border-border-subtle text-xs font-mono text-zinc-300">
              {record.name}
            </div>
          </section>

          <section>
            <div className="flex items-center justify-between mb-1">
              <div className="mono-label">System Instruction</div>
              <button
                type="button"
                onClick={handleEditSystem}
                aria-label="Edit system instruction"
                className="text-[10px] text-accent hover:text-white"
              >
                Edit
              </button>
            </div>
            <pre className="p-1.5 rounded bg-zinc-900 border border-border-subtle text-[10px] font-mono text-zinc-400 whitespace-pre-wrap min-h-[40px]">
              {record.systemInstruction || <span className="italic text-zinc-600">(empty)</span>}
            </pre>
          </section>

          <SkillsListEditor
            skills={record.skills}
            onAdd={(name) => persist({ skills: [...record.skills, name] })}
            onRemove={(idx) =>
              persist({ skills: record.skills.filter((_, i) => i !== idx) })
            }
          />

          <ToolsListEditor
            tools={record.tools}
            onAdd={(tool: Tool) => persist({ tools: [...record.tools, tool] })}
            onRemove={(toolId) =>
              persist({ tools: record.tools.filter((t) => t.id !== toolId) })
            }
          />
        </div>
      )}
    </Modal>
  );
}
```

- [ ] **Step 4: Run, expect PASS**

```bash
npx vitest run src/components/subagents/SubAgentEditModal.test.tsx
```

- [ ] **Step 5: Lint + commit**

```bash
npm run lint
git add src/components/subagents/SubAgentEditModal.tsx src/components/subagents/SubAgentEditModal.test.tsx
git commit -m "feat(slice-9): add SubAgentEditModal (fetch + per-action persist)"
```

---

## Phase F — `SubAgentsSection` row click

### Task F1: Row click opens modal; × stops propagation

**Files:**
- Modify: `src/components/sidebar/SubAgentsSection.tsx`
- Modify: `src/components/sidebar/SubAgentsSection.test.tsx`

- [ ] **Step 1: Append failing tests**

```tsx
import { useUiStore } from '@/src/stores/ui.store';

// Add to the existing beforeEach if not already:
//   useUiStore.getState()._reset();

it('clicking on a row opens the editor for that sub-agent', async () => {
  useSubAgentsStore.setState({
    list: [{ id: 's1', name: 'designer', createdAt: 1, updatedAt: 1 }],
    hydrated: true,
  });
  const user = userEvent.setup();
  renderSection();
  await user.click(screen.getByText('designer'));
  expect(useUiStore.getState().editingSubAgentId).toBe('s1');
});

it('clicking on the × button does NOT open the editor', async () => {
  useSubAgentsStore.setState({
    list: [{ id: 's1', name: 'designer', createdAt: 1, updatedAt: 1 }],
    hydrated: true,
  });
  const user = userEvent.setup();
  renderSection();
  await user.hover(screen.getByText('designer'));
  await user.click(screen.getByRole('button', { name: /delete designer/i }));
  // The confirm dialog appears; close it to avoid bleeding into next tests
  await user.click(screen.getByRole('button', { name: /cancel/i }));
  expect(useUiStore.getState().editingSubAgentId).toBeNull();
});
```

- [ ] **Step 2: Run, expect FAIL**

```bash
npx vitest run src/components/sidebar/SubAgentsSection.test.tsx
```

- [ ] **Step 3: Modify `SubAgentsSection.tsx`**

Add an import + selector:

```tsx
import { useUiStore } from '@/src/stores/ui.store';

// In the component body:
const openSubAgentEditor = useUiStore((s) => s.openSubAgentEditor);
```

Update the row JSX. Find the existing `<div>` that wraps each sub-agent row (look for `key={sa.id}`). Add `onClick` to that div and `e.stopPropagation()` to the delete button:

```tsx
list.map((sa) => (
  <div
    key={sa.id}
    onClick={() => openSubAgentEditor(sa.id)}
    className="group flex items-center justify-between p-1.5 rounded bg-zinc-900 border border-border-subtle text-[10px] font-mono text-zinc-400 cursor-pointer hover:border-accent/40"
  >
    <span className="truncate">{sa.name}</span>
    <div className="hidden group-hover:flex gap-1">
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          handleDelete(sa.id, sa.name);
        }}
        aria-label={`Delete ${sa.name}`}
        className="hover:text-red-400"
      >
        ×
      </button>
    </div>
  </div>
))
```

The `cursor-pointer` + `hover:border-accent/40` are visual affordances that the row is clickable.

- [ ] **Step 4: Run, expect PASS + suite + lint**

```bash
npx vitest run src/components/sidebar/SubAgentsSection.test.tsx
npx vitest run src
npm run lint
```

Expected: ALL PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/sidebar/SubAgentsSection.tsx src/components/sidebar/SubAgentsSection.test.tsx
git commit -m "feat(slice-9): SubAgentsSection row click opens editor; delete stops propagation"
```

---

## Phase G — `App.tsx` mount

### Task G1: Mount `<SubAgentEditModal />` in App

**Files:**
- Modify: `src/App.tsx`

- [ ] **Step 1: Read current `App.tsx`**

Find where other modals are mounted (e.g., `<ProfilesModal />`, `<CommandPalette />`).

- [ ] **Step 2: Modify `src/App.tsx`**

Add import:

```tsx
import { SubAgentEditModal } from '@/src/components/subagents/SubAgentEditModal';
```

Mount the modal next to the other top-level modals (the exact position doesn't matter — it returns null when closed). For example, after `<ProfilesModal />`:

```tsx
<ProfilesModal />
<SubAgentEditModal />
<CommandPalette />
{/* ... other top-level mounts */}
```

- [ ] **Step 3: Run full FE suite (no regressions)**

```bash
npx vitest run src
npm run lint
```

- [ ] **Step 4: Commit**

```bash
git add src/App.tsx
git commit -m "feat(slice-9): App.tsx mounts SubAgentEditModal"
```

---

## Phase H — Integration test

### Task H1: App-level: open modal, rename, add skill

**Files:**
- Create: `src/integration/subagent-edit.integration.test.tsx`

- [ ] **Step 1: Write the test**

```tsx
// src/integration/subagent-edit.integration.test.tsx
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { server } from '@/src/test/msw-server';
import App from '@/src/App';
import { useUiStore } from '@/src/stores/ui.store';
import { useSessionsStore } from '@/src/stores/sessions.store';
import { useProfilesStore } from '@/src/stores/profiles.store';
import { useContextStore } from '@/src/stores/context.store';
import { useSubAgentsStore } from '@/src/stores/subagents.store';
import { useMcpStore } from '@/src/stores/mcp.store';
import { useProvidersStore } from '@/src/stores/providers.store';

beforeEach(() => {
  useUiStore.getState()._reset();
  useSessionsStore.getState()._reset();
  useProfilesStore.getState()._reset();
  useContextStore.getState()._reset();
  useSubAgentsStore.getState()._reset();
  useMcpStore.getState()._reset();
  useProvidersStore.getState()._reset();
  localStorage.clear();
});

describe('subagent edit integration', () => {
  it('row click opens modal; rename PATCHes; add skill PATCHes', async () => {
    server.use(
      http.get('http://localhost/api/subagents', () =>
        HttpResponse.json({
          subAgents: [{ id: 'SA1', name: 'designer', createdAt: 1, updatedAt: 1 }],
        }),
      ),
      http.get('http://localhost/api/subagents/SA1', () =>
        HttpResponse.json({
          id: 'SA1',
          name: 'designer',
          systemInstruction: '',
          skills: [],
          tools: [],
          createdAt: 1,
          updatedAt: 1,
        }),
      ),
    );

    let lastPatch: unknown = null;
    server.use(
      http.put('http://localhost/api/subagents/SA1', async ({ request }) => {
        lastPatch = await request.json();
        return HttpResponse.json({ id: 'SA1', name: 'designer', createdAt: 1, updatedAt: 2 });
      }),
    );

    const user = userEvent.setup();
    render(<App />);

    // Wait for the sub-agent to appear in the sidebar
    await waitFor(() => expect(useSubAgentsStore.getState().list).toHaveLength(1));

    // Click the row
    await user.click(screen.getByText('designer'));

    // Modal opens and fetches the record
    await waitFor(() => expect(screen.getAllByText('designer').length).toBeGreaterThan(0));

    // Rename
    await user.click(screen.getByRole('button', { name: /rename/i }));
    const nameInput = await screen.findByLabelText(/^name$/i);
    await user.clear(nameInput);
    await user.type(nameInput, 'sculptor');
    await user.click(screen.getByRole('button', { name: /confirm/i }));
    await waitFor(() => {
      expect((lastPatch as { name?: string })?.name).toBe('sculptor');
    });

    // Add skill
    await user.click(screen.getByRole('button', { name: /add skill/i }));
    const skillInput = await screen.findByLabelText(/skill name/i);
    await user.type(skillInput, 'clay');
    await user.click(screen.getByRole('button', { name: /confirm/i }));
    await waitFor(() => {
      expect((lastPatch as { skills?: string[] })?.skills).toEqual(['clay']);
    });
  });
});
```

- [ ] **Step 2: Run, expect PASS**

```bash
npx vitest run src/integration/subagent-edit.integration.test.tsx
```

- [ ] **Step 3: Lint + commit**

```bash
npm run lint
git add src/integration/subagent-edit.integration.test.tsx
git commit -m "test(slice-9): integration — row click opens modal; rename + add skill"
```

---

## Phase I — Playwright e2e

### Task I1: smoke test: open modal, rename, add skill

**Files:**
- Modify: `e2e/smoke.spec.ts`

- [ ] **Step 1: Append the test**

Append at the end of `e2e/smoke.spec.ts`:

```ts
test('subagent edit: open modal, rename + add skill', async ({ page, request }) => {
  // Seed a sub-agent via the API
  const created = await request.post('/api/subagents', {
    data: { name: 'designer' },
  }).then((r) => r.json()) as { id: string };

  await page.goto('/');
  await expect(page.getByText('AETHER_CORE')).toBeVisible();

  // Sidebar shows the sub-agent
  const sidebar = page.getByRole('complementary', { name: /sidebar/i });
  await expect(sidebar.getByText('designer')).toBeVisible();

  // Click the row → modal opens
  await sidebar.getByText('designer').click();
  const modal = page.getByRole('dialog');
  await expect(modal).toBeVisible();

  // Rename
  await modal.getByRole('button', { name: /rename/i }).click();
  const promptDialog = page.getByRole('dialog').last();
  const nameInput = promptDialog.getByLabel('Name', { exact: true });
  await nameInput.fill('sculptor');
  await promptDialog.getByRole('button', { name: /confirm/i }).click();

  // Modal title updates
  await expect(modal.getByText('sculptor')).toBeVisible({ timeout: 5000 });

  // Add skill
  await modal.getByRole('button', { name: /add skill/i }).click();
  const skillPromptDialog = page.getByRole('dialog').last();
  const skillInput = skillPromptDialog.getByLabel('Skill name', { exact: true });
  await skillInput.fill('clay');
  await skillPromptDialog.getByRole('button', { name: /confirm/i }).click();

  // Skill row appears in the modal
  await expect(modal.getByText('clay')).toBeVisible({ timeout: 5000 });

  // Cleanup
  await request.delete(`/api/subagents/${created.id}`).catch(() => {});
});
```

If `getByLabel('Skill name', { exact: true })` matches multiple elements (e.g. another "Rename foo" button substring-collision), the test may need adjusting. The `exact: true` should fix it. If not, scope inside `skillPromptDialog` first.

- [ ] **Step 2: Lint**

```bash
npm run lint
```

- [ ] **Step 3: Run Playwright (port 3000 expected free)**

```bash
npx playwright test e2e/smoke.spec.ts -g "subagent edit:"
```

Expected: 1 test PASS.

- [ ] **Step 4: Run full Playwright suite (no regressions)**

```bash
npx playwright test
```

Expected: 12/12 PASS.

If port 3000 is occupied, document and skip the run.

- [ ] **Step 5: Commit**

```bash
git add e2e/smoke.spec.ts
git commit -m "test(slice-9): playwright — open edit modal, rename + add skill"
```

---

## Phase J — Final verification + PR

### Task J1: lint + tests + push + PR

- [ ] **Step 1: Lint**

```bash
npm run lint
```

- [ ] **Step 2: Vitest full**

```bash
npm run test:run
```

Expected: ALL PASS.

- [ ] **Step 3: Coverage**

```bash
npm run test:coverage
```

Expected: ≥80% on `SubAgentEditModal.tsx`, `SkillsListEditor.tsx`, `ToolsListEditor.tsx`.

- [ ] **Step 4: Push**

```bash
git push -u origin feat/slice-9-subagent-editor
```

- [ ] **Step 5: Open PR**

```bash
gh pr create --base main --title "feat(slice-9): sub-agent skills/tools editor" --body "$(cat <<'EOF'
## Summary
- New `SubAgentEditModal` mounted in `App.tsx`; opens when `useUiStore.editingSubAgentId` is non-null.
- Sub-agent row in sidebar becomes clickable → opens the editor (the × delete button uses `stopPropagation`).
- Modal fetches the full record via `subagentsApi.get(id)` and renders four sections: Name / System Instruction / Skills / Tools.
- Per-action persistence: Rename and Edit system instruction use `useDialog.prompt`; Skills/Tools use the slice-5 `addSkillFlow`/`addToolFlow` flows. Every change calls `useSubAgentsStore.update(id, partial)` immediately. No global Save button.
- `crypto.randomUUID()` mints tool `id`s client-side (the sub-agent PUT takes the full array as-is).
- Zero backend changes.

## Test plan
- [x] `npm run lint` clean
- [x] `npm run test:run` all green
- [x] `npx playwright test` 12/12 passing
- [x] Coverage on new files

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

Expected: PR URL printed.

---

## Definition of Done

- All new FE unit / component / integration tests green.
- `e2e/smoke.spec.ts` has 12 tests.
- `npm run lint` clean.
- Coverage ≥80% on `SubAgentEditModal.tsx`, `SkillsListEditor.tsx`, `ToolsListEditor.tsx`.
- Sidebar row click opens the modal; rename + add skill persist; sidebar reflects the new name after rename.
- One PR on `feat/slice-9-subagent-editor` against `main`.
