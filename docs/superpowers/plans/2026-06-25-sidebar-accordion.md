# Sidebar Accordion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Raggruppare le 12 sezioni piatte della sidebar sinistra in 6 gruppi accordion (icona, titolo, chevron) con stato aperto/chiuso persistito per gruppo.

**Architecture:** Approccio A — una primitiva presentazionale **controlled** `SidebarAccordion` (clone visivo di `ReasoningStepCard`), stato dei gruppi centralizzato in `ui.store` con persistenza su una singola chiave JSON `aether.sidebarGroups`, e un componente di composizione `SidebarGroups` che monta le Section esistenti dentro i 6 accordion. Le Section single-item perdono il titolo ridondante e cedono la loro azione allo slot `actions` dell'header.

**Tech Stack:** React 19, Zustand, Tailwind v4, lucide-react, Vitest + Testing Library. Spec: `docs/superpowers/specs/2026-06-25-sidebar-accordion-design.md`.

## Global Constraints

- **Alias import** `@/*` dalla radice repo (es. `@/src/stores/ui.store`).
- **Lint = `npm run lint`** (`tsc --noEmit`, strict, `noUnusedLocals`/`noUnusedParameters`): rimuovere ogni variabile/import che diventa inutilizzato.
- **Test colocati** `*.test.tsx`; Vitest `globals` attivi (no import di `describe/it/expect`). Comando singolo file: `npm run test -- <path>`.
- **Coverage ≥ 80%** su `src/stores/**`, `src/lib/**`, `src/components/**` toccati.
- **Accordion indipendenti** (multi-open): più gruppi aperti insieme.
- **Default primo avvio:** `sessions:true, systemProtocol:false, skillsAgents:true, tools:false, workspaces:false, providers:true`.
- **Persistenza** su singola chiave `aether.sidebarGroups` (JSON), merge sui default in `initFromStorage()`.
- **Nessun cambiamento al contenuto/comportamento delle Section** oltre alla rimozione del titolo ridondante e all'hoist dell'azione nei single-item.

---

## Task 1: `SidebarAccordion` primitiva (controlled)

**Files:**
- Create: `src/components/sidebar/SidebarAccordion.tsx`
- Test: `src/components/sidebar/SidebarAccordion.test.tsx`

**Interfaces:**
- Produces:
  ```ts
  export interface SidebarAccordionProps {
    icon: LucideIcon;            // import type { LucideIcon } from 'lucide-react'
    title: string;
    open: boolean;
    onToggle: () => void;
    actions?: ReactNode;         // slot a destra, prima del chevron; click NON fa toggle
    children: ReactNode;
  }
  export function SidebarAccordion(props: SidebarAccordionProps): JSX.Element
  ```
  Header = riga flex con un `<button>` (icona + titolo) che fa toggle, lo slot `actions` come sibling, e un `<button>` chevron (aria-label Expand/Collapse) che fa anch'esso toggle. Il corpo è montato solo quando `open`.

- [ ] **Step 1: Write the failing test**

`src/components/sidebar/SidebarAccordion.test.tsx`:
```tsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Wrench } from 'lucide-react';
import { SidebarAccordion } from './SidebarAccordion';

function setup(open: boolean) {
  const onToggle = vi.fn();
  render(
    <SidebarAccordion
      icon={Wrench}
      title="Tools"
      open={open}
      onToggle={onToggle}
      actions={<button type="button">act</button>}
    >
      <div>body-content</div>
    </SidebarAccordion>,
  );
  return { onToggle };
}

describe('SidebarAccordion', () => {
  it('mounts the body only when open', () => {
    const { rerender } = render(
      <SidebarAccordion icon={Wrench} title="Tools" open={false} onToggle={() => {}}>
        <div>body-content</div>
      </SidebarAccordion>,
    );
    expect(screen.queryByText('body-content')).not.toBeInTheDocument();
    rerender(
      <SidebarAccordion icon={Wrench} title="Tools" open={true} onToggle={() => {}}>
        <div>body-content</div>
      </SidebarAccordion>,
    );
    expect(screen.getByText('body-content')).toBeInTheDocument();
  });

  it('clicking the title button calls onToggle', async () => {
    const { onToggle } = setup(false);
    await userEvent.click(screen.getByRole('button', { name: /tools/i }));
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it('clicking the chevron calls onToggle', async () => {
    const { onToggle } = setup(true);
    await userEvent.click(screen.getByRole('button', { name: /collapse/i }));
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it('clicking an action does NOT toggle', async () => {
    const { onToggle } = setup(true);
    await userEvent.click(screen.getByRole('button', { name: 'act' }));
    expect(onToggle).not.toHaveBeenCalled();
  });

  it('reflects open state via aria-expanded on the title button', () => {
    setup(true);
    expect(screen.getByRole('button', { name: /tools/i })).toHaveAttribute('aria-expanded', 'true');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- src/components/sidebar/SidebarAccordion.test.tsx`
Expected: FAIL — `Cannot find module './SidebarAccordion'`.

- [ ] **Step 3: Write the implementation**

`src/components/sidebar/SidebarAccordion.tsx`:
```tsx
import { type ReactNode } from 'react';
import { ChevronDown, ChevronRight, type LucideIcon } from 'lucide-react';

export interface SidebarAccordionProps {
  icon: LucideIcon;
  title: string;
  open: boolean;
  onToggle: () => void;
  actions?: ReactNode;
  children: ReactNode;
}

export function SidebarAccordion({
  icon: Icon,
  title,
  open,
  onToggle,
  actions,
  children,
}: SidebarAccordionProps) {
  const Chevron = open ? ChevronDown : ChevronRight;
  const bodyId = `sidebar-group-${title.replace(/\s+/g, '-').toLowerCase()}`;

  return (
    <section className="rounded bg-surface-3 border border-border-subtle">
      <div className="flex items-center gap-2 p-2">
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={open}
          aria-controls={bodyId}
          className="flex items-center gap-2 flex-1 min-w-0 text-left"
        >
          <Icon size={12} aria-hidden="true" className="shrink-0 text-zinc-500" />
          <span className="mono-label truncate">{title}</span>
        </button>
        {actions && <div className="shrink-0 flex items-center gap-1">{actions}</div>}
        <button
          type="button"
          onClick={onToggle}
          aria-label={open ? 'Collapse' : 'Expand'}
          className="shrink-0 text-zinc-500 hover:text-zinc-300"
        >
          <Chevron size={12} aria-hidden="true" />
        </button>
      </div>
      {open && (
        <div id={bodyId} className="px-2 pb-2">
          {children}
        </div>
      )}
    </section>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- src/components/sidebar/SidebarAccordion.test.tsx`
Expected: PASS (5 test). Poi `npm run lint` pulito.

- [ ] **Step 5: Commit**

```bash
git add src/components/sidebar/SidebarAccordion.tsx src/components/sidebar/SidebarAccordion.test.tsx
git commit -m "feat(web): SidebarAccordion primitive (controlled, icon/title/chevron + actions slot)"
```

---

## Task 2: `ui.store` — stato `sidebarGroups` + persistenza

**Files:**
- Modify: `src/stores/ui.store.ts`
- Test: `src/stores/ui.store.test.ts`

**Interfaces:**
- Produces (su `UiState`):
  ```ts
  sidebarGroups: Record<string, boolean>;
  toggleSidebarGroup: (id: string) => void;
  ```
  Export costante `SIDEBAR_GROUP_DEFAULTS: Record<string, boolean>`. Persistenza su `localStorage['aether.sidebarGroups']` (JSON). `initFromStorage()` idrata `sidebarGroups` con `{ ...SIDEBAR_GROUP_DEFAULTS, ...parsed }`.

- [ ] **Step 1: Write the failing test**

Aggiungere a `src/stores/ui.store.test.ts` (in fondo, nuovo `describe`):
```ts
import { useUiStore, SIDEBAR_GROUP_DEFAULTS } from './ui.store';

describe('sidebarGroups', () => {
  beforeEach(() => {
    localStorage.clear();
    useUiStore.getState()._reset();
  });

  it('initial state equals the defaults', () => {
    expect(useUiStore.getState().sidebarGroups).toEqual(SIDEBAR_GROUP_DEFAULTS);
  });

  it('toggleSidebarGroup flips the value and persists it', () => {
    useUiStore.getState().toggleSidebarGroup('tools'); // default false -> true
    expect(useUiStore.getState().sidebarGroups.tools).toBe(true);
    expect(JSON.parse(localStorage.getItem('aether.sidebarGroups')!).tools).toBe(true);
  });

  it('initFromStorage merges persisted values over defaults', () => {
    localStorage.setItem('aether.sidebarGroups', JSON.stringify({ sessions: false }));
    useUiStore.getState().initFromStorage();
    const g = useUiStore.getState().sidebarGroups;
    expect(g.sessions).toBe(false);        // persisted override
    expect(g.providers).toBe(true);        // missing key -> default
  });

  it('initFromStorage falls back to defaults on corrupt JSON', () => {
    localStorage.setItem('aether.sidebarGroups', '{not json');
    useUiStore.getState().initFromStorage();
    expect(useUiStore.getState().sidebarGroups).toEqual(SIDEBAR_GROUP_DEFAULTS);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- src/stores/ui.store.test.ts`
Expected: FAIL — `SIDEBAR_GROUP_DEFAULTS` non esportato / `toggleSidebarGroup` undefined.

- [ ] **Step 3: Implementation**

In `src/stores/ui.store.ts`:

(a) Vicino alle altre costanti chiave (dopo `AETHER_MODE_KEY`):
```ts
const SIDEBAR_GROUPS_KEY = 'aether.sidebarGroups';

export const SIDEBAR_GROUP_DEFAULTS: Record<string, boolean> = {
  sessions: true,
  systemProtocol: false,
  skillsAgents: true,
  tools: false,
  workspaces: false,
  providers: true,
};

function readSidebarGroups(): Record<string, boolean> {
  try {
    const v = localStorage.getItem(SIDEBAR_GROUPS_KEY);
    const parsed = v ? (JSON.parse(v) as Partial<Record<string, boolean>>) : {};
    return { ...SIDEBAR_GROUP_DEFAULTS, ...parsed };
  } catch {
    return { ...SIDEBAR_GROUP_DEFAULTS };
  }
}
```

(b) Nell'interfaccia `UiState`, accanto agli altri campi:
```ts
  sidebarGroups: Record<string, boolean>;
  toggleSidebarGroup: (id: string) => void;
```

(c) In `const initial = { ... }`:
```ts
  sidebarGroups: { ...SIDEBAR_GROUP_DEFAULTS },
```

(d) Nelle azioni dello store (accanto a `toggleSidebar`):
```ts
  toggleSidebarGroup: (id) => {
    const next = { ...get().sidebarGroups, [id]: !get().sidebarGroups[id] };
    try {
      localStorage.setItem(SIDEBAR_GROUPS_KEY, JSON.stringify(next));
    } catch {
      // ignore
    }
    set({ sidebarGroups: next });
  },
```

(e) In `initFromStorage: () => set({ ... })`, aggiungere la riga:
```ts
      sidebarGroups: readSidebarGroups(),
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- src/stores/ui.store.test.ts`
Expected: PASS. Poi `npm run lint` pulito.

- [ ] **Step 5: Commit**

```bash
git add src/stores/ui.store.ts src/stores/ui.store.test.ts
git commit -m "feat(web): ui.store sidebarGroups state + persisted toggle (merge-on-defaults)"
```

---

## Task 3: `SidebarGroups` + wiring in `App.tsx` + strip titoli/azioni single-item

**Files:**
- Create: `src/components/sidebar/SidebarGroups.tsx`
- Test: `src/components/sidebar/SidebarGroups.test.tsx`
- Modify: `src/App.tsx`
- Modify: `src/components/sidebar/SessionsSection.tsx`, `.../SystemProtocolSection.tsx`, `.../WorkspacesSection.tsx`, `.../ProviderAuthSection.tsx`
- Modify (test): `.../SessionsSection.test.tsx`, `.../WorkspacesSection.test.tsx`, `.../ProviderAuthSection.test.tsx`

**Interfaces:**
- Consumes: `SidebarAccordion` (Task 1); `useUiStore().sidebarGroups` + `toggleSidebarGroup` (Task 2); `useSessionsStore`, `useProviderAuthStore`, e `useUiStore().openWorkspaceBrowser` per gli `actions`.
- Produces: `export function SidebarGroups(): JSX.Element` — i 6 accordion. Sostituisce in `App.tsx` i 12 tag Section.

> Questo task è atomico per non lasciare software rotto: spostare un'azione fuori da una Section e renderla in `SidebarGroups` devono avvenire insieme.

- [ ] **Step 1: Strip dei titoli/azioni dalle 4 Section single-item**

`SessionsSection.tsx` — rimuovere la riga titolo+contatore. Sostituire:
```tsx
    <section>
      <div className="flex items-center justify-between mb-2">
        <div className="mono-label">Sessions</div>
        <span className="text-[10px] text-zinc-600">[{sessions.length}]</span>
      </div>

      {error && (
```
con:
```tsx
    <section>
      {error && (
```
(Lasciare invariato `const sessions = useSessionsStore((s) => s.sessions);` — è ancora usato in `sessions.map(...)`.)

`SystemProtocolSection.tsx` — rimuovere la riga:
```tsx
      <div className="mono-label mb-2">System Protocol</div>
```

`WorkspacesSection.tsx` — rimuovere la riga titolo+bottone:
```tsx
      <div className="flex items-center justify-between mb-2">
        <span className="mono-label">Workspaces</span>
        <button
          type="button"
          onClick={openBrowser}
          className="text-[10px] text-manipulation hover:underline"
        >
          + Add workspace…
        </button>
      </div>
```
Poi rimuovere il selettore ora inutilizzato `const openBrowser = useUiStore((s) => s.openWorkspaceBrowser);` **e** l'import `import { useUiStore } from '@/src/stores/ui.store';` (non più usato in quel file).

`ProviderAuthSection.tsx` — rimuovere la riga titolo+refresh:
```tsx
      <div className="flex items-center justify-between mb-2">
        <div className="mono-label">Providers</div>
        <button
          type="button"
          aria-label="Refresh provider auth"
          onClick={() => refresh().catch(() => {})}
          className={cn(
            'text-zinc-400 hover:text-white transition-colors',
            loading && 'animate-spin',
          )}
        >
          <RefreshCw size={10} />
        </button>
      </div>
```
Poi rimuovere i selettori ora inutilizzati `const loading = useProviderAuthStore((s) => s.loading);` e `const refresh = useProviderAuthStore((s) => s.refresh);`, e togliere `RefreshCw` dall'import lucide (lasciare `Settings2`): `import { Settings2 } from 'lucide-react';`. **Lasciare `cn`** (usato altrove nel file).

- [ ] **Step 2: Write the failing test (SidebarGroups)**

`src/components/sidebar/SidebarGroups.test.tsx`:
```tsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SidebarGroups } from './SidebarGroups';
import { useUiStore } from '@/src/stores/ui.store';
import { useSessionsStore } from '@/src/stores/sessions.store';
import { useProviderAuthStore } from '@/src/stores/providerAuth.store';

beforeEach(() => {
  localStorage.clear();
  useUiStore.getState()._reset();
  useSessionsStore.getState()._reset();
});

describe('SidebarGroups', () => {
  it('renders all six group headers', () => {
    render(<SidebarGroups />);
    for (const name of [/sessions/i, /system protocol/i, /skills & agents/i, /tools/i, /workspaces/i, /providers/i]) {
      expect(screen.getByRole('button', { name })).toBeInTheDocument();
    }
  });

  it('honors default open/closed state (System Protocol closed → its textarea not mounted)', () => {
    render(<SidebarGroups />);
    // System Protocol default closed: the section body (textarea) is not mounted
    expect(screen.queryByLabelText('System instruction')).not.toBeInTheDocument();
  });

  it('shows the session count in the Sessions header actions', () => {
    useSessionsStore.setState({ sessions: [], activeSessionId: null, hydrated: true });
    render(<SidebarGroups />);
    expect(screen.getByText('[0]')).toBeInTheDocument();
  });

  it('toggling a closed group mounts its content', async () => {
    render(<SidebarGroups />);
    await userEvent.click(screen.getByRole('button', { name: /system protocol/i }));
    expect(screen.getByLabelText('System instruction')).toBeInTheDocument();
  });

  it('clicking + Add workspace… opens the workspace browser', async () => {
    const spy = vi.spyOn(useUiStore.getState(), 'openWorkspaceBrowser');
    render(<SidebarGroups />);
    await userEvent.click(screen.getByRole('button', { name: /add workspace/i }));
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('clicking the provider refresh calls refresh', async () => {
    const refreshSpy = vi.fn().mockResolvedValue(undefined);
    useProviderAuthStore.setState({ refresh: refreshSpy });
    render(<SidebarGroups />);
    await userEvent.click(screen.getByRole('button', { name: /refresh provider auth/i }));
    expect(refreshSpy).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npm run test -- src/components/sidebar/SidebarGroups.test.tsx`
Expected: FAIL — `Cannot find module './SidebarGroups'`.

- [ ] **Step 4: Implement `SidebarGroups`**

`src/components/sidebar/SidebarGroups.tsx`:
```tsx
import { MessagesSquare, ScrollText, Bot, Wrench, FolderTree, Plug, RefreshCw } from 'lucide-react';
import { useUiStore } from '@/src/stores/ui.store';
import { useSessionsStore } from '@/src/stores/sessions.store';
import { useProviderAuthStore } from '@/src/stores/providerAuth.store';
import { cn } from '@/src/lib/cn';
import { SidebarAccordion } from './SidebarAccordion';
import { SessionsSection } from './SessionsSection';
import { SystemProtocolSection } from './SystemProtocolSection';
import { SkillsSection } from './SkillsSection';
import { SubAgentsSection } from './SubAgentsSection';
import { SwarmsSection } from './SwarmsSection';
import { SchedulesSection } from './SchedulesSection';
import { ToolsSection } from './ToolsSection';
import { BuiltinMcpToggles } from './BuiltinMcpToggles';
import { McpServersSection } from './McpServersSection';
import { BreakpointsSection } from './BreakpointsSection';
import { WorkspacesSection } from './WorkspacesSection';
import { ProviderAuthSection } from './ProviderAuthSection';

export function SidebarGroups() {
  const groups = useUiStore((s) => s.sidebarGroups);
  const toggle = useUiStore((s) => s.toggleSidebarGroup);
  const sessionCount = useSessionsStore((s) => s.sessions.length);
  const openWorkspaceBrowser = useUiStore((s) => s.openWorkspaceBrowser);
  const refreshProviders = useProviderAuthStore((s) => s.refresh);
  const providersLoading = useProviderAuthStore((s) => s.loading);

  return (
    <div className="space-y-2">
      <SidebarAccordion
        icon={MessagesSquare}
        title="Sessions"
        open={groups.sessions}
        onToggle={() => toggle('sessions')}
        actions={<span className="text-[10px] text-zinc-600">[{sessionCount}]</span>}
      >
        <SessionsSection />
      </SidebarAccordion>

      <SidebarAccordion
        icon={ScrollText}
        title="System Protocol"
        open={groups.systemProtocol}
        onToggle={() => toggle('systemProtocol')}
      >
        <SystemProtocolSection />
      </SidebarAccordion>

      <SidebarAccordion
        icon={Bot}
        title="Skills & Agents"
        open={groups.skillsAgents}
        onToggle={() => toggle('skillsAgents')}
      >
        <div className="space-y-6">
          <SkillsSection />
          <SubAgentsSection />
          <SwarmsSection />
          <SchedulesSection />
        </div>
      </SidebarAccordion>

      <SidebarAccordion
        icon={Wrench}
        title="Tools"
        open={groups.tools}
        onToggle={() => toggle('tools')}
      >
        <div className="space-y-6">
          <ToolsSection />
          <BuiltinMcpToggles />
          <McpServersSection />
          <BreakpointsSection />
        </div>
      </SidebarAccordion>

      <SidebarAccordion
        icon={FolderTree}
        title="Workspaces"
        open={groups.workspaces}
        onToggle={() => toggle('workspaces')}
        actions={
          <button
            type="button"
            onClick={openWorkspaceBrowser}
            className="text-[10px] text-manipulation hover:underline"
          >
            + Add workspace…
          </button>
        }
      >
        <WorkspacesSection />
      </SidebarAccordion>

      <SidebarAccordion
        icon={Plug}
        title="Providers"
        open={groups.providers}
        onToggle={() => toggle('providers')}
        actions={
          <button
            type="button"
            aria-label="Refresh provider auth"
            onClick={() => refreshProviders().catch(() => {})}
            className={cn('text-zinc-400 hover:text-white transition-colors', providersLoading && 'animate-spin')}
          >
            <RefreshCw size={10} />
          </button>
        }
      >
        <ProviderAuthSection />
      </SidebarAccordion>
    </div>
  );
}
```

- [ ] **Step 5: Wire into `App.tsx`**

In `src/App.tsx`: rimuovere i 12 import delle Section (righe ~7–22) e i 12 tag tra `<Sidebar ...>` e `</Sidebar>` (righe ~107–118), sostituendoli con un singolo import e un singolo tag.

Aggiungere l'import:
```tsx
import { SidebarGroups } from '@/src/components/sidebar/SidebarGroups';
```
Sostituire il blocco children della `<Sidebar>`:
```tsx
            <SessionsSection />
            <SystemProtocolSection />
            <SkillsSection />
            <ToolsSection />
            <BuiltinMcpToggles />
            <BreakpointsSection />
            <WorkspacesSection />
            <McpServersSection />
            <SubAgentsSection />
            <SwarmsSection />
            <SchedulesSection />
            <ProviderAuthSection />
```
con:
```tsx
            <SidebarGroups />
```
Rimuovere gli import ora inutilizzati in `App.tsx`: `SessionsSection, SystemProtocolSection, SkillsSection, ToolsSection, McpServersSection, BreakpointsSection, WorkspacesSection, SubAgentsSection, SwarmsSection, SchedulesSection, ProviderAuthSection, BuiltinMcpToggles`. (Verificare con `npm run lint` che nessuno di questi sia usato altrove in `App.tsx`.)

- [ ] **Step 6: Aggiornare i test delle Section che cercavano titoli/azioni rimossi**

`SessionsSection.test.tsx` — rimuovere le due asserzioni sul titolo e sul contatore (ora in `SidebarGroups`):
```tsx
    expect(screen.getByText(/Sessions/i)).toBeInTheDocument();
    expect(screen.getByText('[0]')).toBeInTheDocument();
```
(lasciare il resto del test invariato.)

`WorkspacesSection.test.tsx` — rimuovere l'intero test ora spostato:
```tsx
  it('clicking + Add workspace… opens the browser modal', () => {
    render(<WorkspacesSection />);
    fireEvent.click(screen.getByRole('button', { name: /add workspace/i }));
    ...
  });
```
Se `fireEvent` resta inutilizzato dopo la rimozione, togliere il suo import.

`ProviderAuthSection.test.tsx` — rimuovere il test ora spostato:
```tsx
  it('clicking the refresh button calls useProviderAuthStore.refresh', async () => {
    ...
    expect(refreshSpy).toHaveBeenCalledTimes(1);
  });
```

(`SystemProtocolSection.test.tsx` non richiede modifiche: asserisce solo su `getByLabelText('System instruction')`, che non cambia.)

- [ ] **Step 7: Run test to verify it passes**

Run: `npm run test -- src/components/sidebar/SidebarGroups.test.tsx`
Expected: PASS (6 test).

- [ ] **Step 8: Full suite + lint**

Run: `npm run test:run` → tutte verdi (incluse le Section aggiornate).
Run: `npm run lint` → zero errori (nessun import/variabile inutilizzato).

- [ ] **Step 9: Commit**

```bash
git add src/components/sidebar/SidebarGroups.tsx src/components/sidebar/SidebarGroups.test.tsx src/App.tsx \
  src/components/sidebar/SessionsSection.tsx src/components/sidebar/SystemProtocolSection.tsx \
  src/components/sidebar/WorkspacesSection.tsx src/components/sidebar/ProviderAuthSection.tsx \
  src/components/sidebar/SessionsSection.test.tsx src/components/sidebar/WorkspacesSection.test.tsx \
  src/components/sidebar/ProviderAuthSection.test.tsx
git commit -m "feat(web): group sidebar into 6 accordions; hoist single-item titles/actions"
```

---

## Task 4: Verifica finale + smoke manuale

- [ ] **Step 1: Lint + suite intera** — `npm run lint` (zero errori) e `npm run test:run` (tutte verdi).
- [ ] **Step 2: Smoke manuale** — `npm run dev`, sidebar:
  - i 6 gruppi appaiono come accordion (icona, titolo, chevron);
  - default corretti (Sessions / Skills & Agents / Providers aperti; System Protocol / Tools / Workspaces chiusi);
  - apri/chiudi qualche gruppo, **reload**, lo stato è ricordato;
  - le azioni nell'header funzionano (contatore sessioni aggiornato, "+ Add workspace…" apre il browser, refresh provider gira) e **non** fanno toggle del gruppo;
  - dentro Skills & Agents e Tools le sotto-sezioni mostrano i loro titoli; dentro i gruppi single-item non c'è titolo duplicato.
- [ ] **Step 3: Commit** (se servono micro-fix dallo smoke) `chore: polish sidebar accordion after smoke`.

---

## Self-review (esito)

- **Copertura spec:** SidebarAccordion controlled (Task 1) ✓; ui.store sidebarGroups + persistenza merge-on-defaults (Task 2) ✓; SidebarGroups + 6 gruppi + mappatura icone/contenuti (Task 3) ✓; strip titoli single-item + hoist azioni in `actions` (Task 3 Step 1+4) ✓; multi-item mantengono i sotto-titoli (Task 3 Step 4) ✓; BreakpointsSection intatta dentro TOOLS ✓; default open/closed (Task 2 const + Task 3 test) ✓; persistenza per-gruppo + reload (Task 4 smoke) ✓; testing (Task 1/2/3) ✓.
- **Placeholder scan:** nessun TBD/TODO; ogni step di codice mostra il codice completo.
- **Type consistency:** `SidebarAccordionProps` (Task 1) usato identico in `SidebarGroups` (Task 3); `sidebarGroups`/`toggleSidebarGroup`/`SIDEBAR_GROUP_DEFAULTS` (Task 2) usati coerentemente in Task 3 test e store test; gli id dei gruppi (`sessions, systemProtocol, skillsAgents, tools, workspaces, providers`) coincidono tra default, store e `SidebarGroups`.
- **Non-regressione:** il contenuto delle Section non cambia; gli unici test toccati sono le 3 asserzioni/​test spostati in `SidebarGroups.test`.
