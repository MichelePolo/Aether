# Session approvals panel — design

> Status: approved (brainstorming) — ready for implementation plan.
> Date: 2026-06-13.

## Problem

When the user approves a gated MCP tool call with the **"sticky"** checkbox, that
tool's `qualifiedName` is remembered for the rest of the session and future calls
of it are **auto-approved** without a gate. Today these session approvals are
invisible and not individually revocable: they live only in client memory
(`chat.store` → `stickyApprovals: Set<string>`), reset on reload, and the only
control is an unwired `clearStickyApprovals()`.

The user wants to **see** the active session approvals and **revoke** them
(individually or all at once) without reloading.

## Scope

- **In scope:** surface the session sticky approvals in the UI and let the user
  remove one or clear all. "Modify" here means **revoke** — a `Set<string>` of
  names has nothing else to edit.
- **Out of scope:** persistence (they stay volatile/session-only by design),
  any backend/API, and the persistent per-tool auto-approve policy (that already
  has its own UI on the MCP tool cards).

## Decisions (from brainstorming)

- Placement: a **"Session approvals" sub-block inside the existing Breakpoints
  section** of the sidebar — co-locating all approval controls.
- Names shown verbatim as `qualifiedName` (consistent with `McpToolCard`).

## Design

### Store — `src/stores/chat.store.ts`

`stickyApprovals: Set<string>`, `addStickyApproval`, `clearStickyApprovals`
already exist. Add **one** action:

```ts
removeStickyApproval: (qualifiedName: string) => void;
```

Implemented immutably like `addStickyApproval` (clone the Set, delete the entry,
set state).

### UI — `src/components/sidebar/BreakpointsSection.tsx`

Below the category rows (safe / dangerous / external), add a **Session
approvals** sub-block that reads `stickyApprovals` from the chat store:

- Header with a `[n]` count and a short help tooltip ("Auto-approvals that last
  only for this session; cleared on reload").
- **Empty:** a muted line, e.g. "No session approvals".
- **Non-empty:** one row per `qualifiedName` with a **×** button calling
  `removeStickyApproval(name)`.
- A **"Clear all"** button (shown only when non-empty) calling
  `clearStickyApprovals()`.

The block renders deterministically by iterating the Set in a stable order
(e.g. sorted) so tests and the view are predictable.

### i18n — `src/i18n/en.ts`

New keys under `breakpoints.sessionApprovals.*`: `heading`, `empty`, `clearAll`,
`help`, following the existing string style.

## Testing

- **`chat.store`:** `removeStickyApproval` removes only the named entry and leaves
  the rest; `clearStickyApprovals` empties the set. (Add the missing coverage for
  `removeStickyApproval`.)
- **`BreakpointsSection`:** renders the sticky list; the × button calls
  `removeStickyApproval` with the right name; "Clear all" calls
  `clearStickyApprovals`; the empty state renders when the set is empty.

## Notes / risks

- Purely client-side and additive: no migration, route, or backend change.
- The sub-block must not interfere with the existing category-policy rows or
  their tests in `BreakpointsSection`.
