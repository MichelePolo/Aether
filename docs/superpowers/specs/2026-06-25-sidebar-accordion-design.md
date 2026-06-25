# Sidebar ad Accordion — Design Spec

> Status: approved (brainstorming) · Date: 2026-06-25 · Topic: razionalizzazione UI sidebar sinistra

## Goal

Ridurre il "rumore" visivo della sidebar sinistra di Aether raggruppando le 12 sezioni piatte attuali in **6 gruppi accordion**, ciascuno con lo stesso linguaggio visivo della barra di reasoning: **icona, titolo, chevron**, corpo collassabile. Lo stato aperto/chiuso è persistito per gruppo; i default valgono solo al primo avvio.

Nessun cambiamento al *contenuto* o al comportamento delle sezioni: cambia solo come sono raggruppate, intestate e collassate.

## Stato attuale (punto di partenza)

- `src/App.tsx` monta 12 componenti `*Section` piatti dentro `<Sidebar>` (`src/components/layout/Sidebar.tsx`), separati da `space-y-6`.
- Ogni Section rende un proprio titolo `.mono-label`. **Non esiste** alcuna primitiva accordion/collapsible: il pattern icona/titolo/chevron vive solo in `src/components/reasoning/ReasoningStepCard.tsx` (stato `open` **interno/uncontrolled**).
- "Session Approvals" **non è un componente**: è un secondo blocco etichettato dentro `BreakpointsSection.tsx` (che rende sia "Breakpoints" sia "Session Approvals").
- Le preferenze UI sono centralizzate in `src/stores/ui.store.ts`, persistite a mano con helper `readBool`/`writeBool` su chiavi `aether.*`, idratate una volta da `initFromStorage()` (chiamato all'avvio in `App.tsx`). Nessun `persist` middleware.

## Architettura (Approccio A — primitiva condivisa + stato in `ui.store`)

### Nuovi componenti

**`src/components/sidebar/SidebarAccordion.tsx`** — primitiva presentazionale, **controlled**.

```ts
import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';

export interface SidebarAccordionProps {
  icon: LucideIcon;
  title: string;
  open: boolean;
  onToggle: () => void;
  actions?: ReactNode;   // slot opzionale a destra, prima del chevron
  children: ReactNode;
}
```

- Header = `<button type="button">` con: `<Icon size>` · `<span>` titolo (stile `mono-label`) · `flex-1` spacer · `actions?` · `Chevron` (`ChevronDown` se aperto, `ChevronRight` se chiuso).
- `aria-expanded={open}`; corpo con `id` collegato via `aria-controls`; il corpo è montato **solo quando `open`** (come `ReasoningStepCard`).
- Lo slot `actions` non deve propagare il click all'header: gli elementi azione sono renderizzati **fuori** dal `<button>` (header come `<div>` flex contenente il `<button>` di toggle + il nodo `actions` come sibling), così un click sull'azione non fa toggle. (Niente `<button>` annidati — invalido in HTML.)
- Estetica allineata a `ReasoningStepCard`: `rounded`, `bg-surface-3`/`border-border-subtle`, padding coerente.

**`src/components/sidebar/SidebarGroups.tsx`** — composizione dei 6 gruppi.

- Legge `sidebarGroups` e `toggleSidebarGroup` da `ui.store`.
- Rende 6 `<SidebarAccordion>` con icona/titolo/`open`/`onToggle` e, dentro, le Section esistenti come `children`.
- Per i gruppi single-item, popola lo slot `actions` con l'azione hoistata (contatore sessioni / "+ Add workspace…" / refresh provider) usando direttamente le azioni di store già disponibili.
- Sostituisce in `App.tsx` i 12 import + 12 tag Section con un singolo `<SidebarGroups />`.

### Stato & persistenza (estensione additiva di `ui.store.ts`)

```ts
// stato
sidebarGroups: Record<string, boolean>;
// azione
toggleSidebarGroup: (id: string) => void;   // flip + persist
```

- Default (primo avvio):
  ```ts
  const SIDEBAR_GROUP_DEFAULTS = {
    sessions: true,
    systemProtocol: false,
    skillsAgents: true,
    tools: false,
    workspaces: false,
    providers: true,
  };
  ```
- Persistenza su **una sola chiave** `aether.sidebarGroups` (JSON dell'intera mappa), con helper `readJson`/`writeJson` accanto a `readBool`/`writeBool` (stesso try/catch difensivo).
- `initFromStorage()` idrata facendo **merge sui default**: `{ ...SIDEBAR_GROUP_DEFAULTS, ...(parsed ?? {}) }`. Così una chiave salvata parziale, assente o corrotta non rompe nulla e un gruppo aggiunto in futuro eredita il suo default.
- `toggleSidebarGroup(id)` calcola la mappa aggiornata, la scrive con `writeJson`, e fa `set`.

## Mappatura gruppi

| # | Gruppo (default) | id | Icona (lucide) | Section contenute | Titoli interni |
|---|---|---|---|---|---|
| 1 | SESSIONS (aperto) | `sessions` | `MessagesSquare` | `SessionsSection` | rimosso "Sessions"; contatore `[N]` → slot `actions` |
| 2 | SYSTEM PROTOCOL (chiuso) | `systemProtocol` | `ScrollText` | `SystemProtocolSection` | rimosso "System Protocol" |
| 3 | SKILLS & AGENTS (aperto) | `skillsAgents` | `Bot` | `SkillsSection`, `SubAgentsSection`, `SwarmsSection`, `SchedulesSection` | **mantenuti** (sub-blocchi etichettati) |
| 4 | TOOLS (chiuso) | `tools` | `Wrench` | `ToolsSection`, `BuiltinMcpToggles`, `McpServersSection`, `BreakpointsSection` | **mantenuti** |
| 5 | WORKSPACES (chiuso) | `workspaces` | `FolderTree` | `WorkspacesSection` | rimosso "Workspaces"; "+ Add workspace…" → slot `actions` |
| 6 | PROVIDERS (aperto) | `providers` | `Plug` | `ProviderAuthSection` | rimosso "Providers"; refresh button → slot `actions` |

Note:
- **Comportamento accordion = indipendente** (multi-open): più gruppi possono essere aperti insieme; i default lo confermano.
- **`BreakpointsSection` non si tocca**: rende già i due blocchi etichettati "Breakpoints" e "Session Approvals", che soddisfano le due voci elencate sotto TOOLS senza alcuno split.
- **Gruppi single-item** (1, 2, 5, 6): si rimuove la riga-titolo interna (la fornisce l'header accordion) e, dove presente, l'azione adiacente si sposta nello slot `actions` dell'header → nessun bottone orfano, zero duplicazione del titolo.
- **Gruppi multi-item** (3, 4): le Section figlie mantengono i loro `.mono-label` come intestazioni dei blocchi impilati.
- Le icone sono la scelta proposta e approvata; restano facili da cambiare (una riga in `SidebarGroups.tsx`).

## Data flow

1. `App.tsx` chiama `useUiStore.initFromStorage()` all'avvio (già esistente) → idrata `sidebarGroups` dal localStorage mergiato sui default.
2. `SidebarGroups` legge `sidebarGroups[id]` per ogni accordion e passa `open` + `onToggle={() => toggleSidebarGroup(id)}`.
3. Click sull'header → `toggleSidebarGroup` → persist su `aether.sidebarGroups` + re-render → corpo montato/smontato.
4. Click su un'azione nello slot `actions` → azione di store dedicata (apri browser workspace / refresh provider), **senza** toggle del gruppo.

## Error handling / edge cases

- `localStorage` non disponibile o JSON corrotto → `readJson` ritorna `null` in `catch` → si usano i default. `writeJson` ignora gli errori (come `writeBool`).
- Chiave salvata con sottoinsieme di gruppi → merge sui default copre i mancanti.
- Nessun rischio di regressione sul contenuto delle Section: la logica interna non cambia.

## Testing

- **`SidebarAccordion.test.tsx`**: `open=false` non monta il corpo; click sull'header chiama `onToggle`; `aria-expanded` riflette `open`; un click su un elemento nello slot `actions` **non** chiama `onToggle`.
- **`ui.store.test.ts`** (estensione): `toggleSidebarGroup` flippa il valore e persiste su `aether.sidebarGroups`; `initFromStorage` fa merge sui default per chiave assente / parziale / JSON corrotto.
- **`SidebarGroups.test.tsx`**: i 6 gruppi sono renderizzati con i titoli attesi; i default di apertura sono corretti; un gruppo chiuso non monta il contenuto della sua Section (smoke).
- **Section esistenti**: i test restano verdi; si aggiornano solo le asserzioni che cercavano i titoli rimossi nei single-item (es. eventuale `getByText('Sessions'|'Workspaces'|'Providers'|'System Protocol')`).
- Coverage: `src/stores/**` e `src/components/**` toccati restano ≥ 80% (soglia progetto).

## Out of scope (YAGNI)

- Nessun accordion annidato (deciso: blocchi piatti etichettati, un solo livello di collasso).
- Nessun drag-to-reorder dei gruppi, nessuna larghezza ridimensionabile, nessuna ricerca dentro la sidebar.
- Nessun refactoring non correlato delle Section oltre alla rimozione del titolo ridondante e all'hoist dell'azione.
- Nessuna libreria accordion di terze parti (Radix ecc.): si resta sulla primitiva hand-rolled, coerente col reasoning bar.

## File toccati (riepilogo)

- **Create:** `src/components/sidebar/SidebarAccordion.tsx` (+ test), `src/components/sidebar/SidebarGroups.tsx` (+ test).
- **Modify:** `src/stores/ui.store.ts` (+ test), `src/App.tsx` (compone `<SidebarGroups />`), e i 4 single-item Section (`SessionsSection`, `SystemProtocolSection`, `WorkspacesSection`, `ProviderAuthSection`) per rimuovere il titolo interno e hoistare l'azione.
