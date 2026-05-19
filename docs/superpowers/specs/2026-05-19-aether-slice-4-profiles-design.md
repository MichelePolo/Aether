# Aether Slice 4 — Profiles + Import/Export

**Date:** 2026-05-19
**Status:** Approved (brainstorming phase)
**Owner:** Michele
**Reference specs:**
- `docs/superpowers/specs/2026-05-17-aether-rewrite-design.md`
- `docs/superpowers/specs/2026-05-18-aether-slice-2a-chat-streaming-design.md`
- `docs/superpowers/specs/2026-05-18-aether-slice-2b-multi-session-design.md`
- `docs/superpowers/specs/2026-05-18-aether-slice-3-reasoning-design.md`

## Goal

Aggiungere ad Aether un sistema di **profili** — snapshot nominati di `AetherContext` + UI prefs — con persistenza JSON server-side, applicazione esplicita al context corrente, e import/export di singoli profili come file `.json`.

1. **Backend** — Nuovo `ProfilesStore` (JsonStore-backed) + 7 endpoint CRUD/import su `/api/profiles`. Nessun endpoint dedicato per export (il client serializza un `GET /:id` e triggera download).
2. **Frontend** — Nuovo `useProfilesStore` (Zustand) con `activeProfileId` persistito in localStorage; `apply` orchestra `useContextStore.bulkOverwrite` + `useUiStore.setThinkingEnabled` + set active. Nuovo `useExportImport` hook per file IO.
3. **UI** — Pulsante in TopBar che mostra il nome del profilo attivo (o "Profiles" se nessuno); click apre il modal **Profiles Manager** con tabella di profili e azioni per riga (Apply / Save here / Rename / Export / Delete) + toolbar (Save current as new, Import).
4. **Profile shape** — `{ name, createdAt, updatedAt, context: AetherContext, thinkingEnabled: boolean }`. UI prefs include solo `thinkingEnabled` per ora; struttura estensibile.
5. **Active profile semantics** — Etichetta non-binding: applicare un profilo NON crea un legame live. Modifiche successive al context o all'UI pref non aggiornano il profilo. L'utente deve esplicitamente "Save here" per persistere.
6. **Import** — Sempre salva come nuovo profilo (no auto-apply). Nome collision suffixed automaticamente (`(1)`, `(2)`, ...) lato server.
7. **Reload** — `activeProfileId` ricaricato da localStorage; se obsoleto, fallback a `null`. `context` e `thinkingEnabled` persistono indipendentemente (rispettivamente data/context.json e localStorage).

## Non-goals (in 4)

- "Dirty" detection del profilo attivo (no badge "modified").
- Versioning / history dei profili: ogni save sovrascrive.
- Bulk export / multi-profile zip.
- Sharing / cloud sync / encryption.
- Profile templates predefiniti / seed al primo boot.
- Migrazione da localStorage legacy (no legacy data verificato).
- Conflict detection cross-tab.
- Profile description / tags.
- Auto-apply su import.
- Cancellazione attivo che reverte il context al default (context resta com'è).

## Design decisions (brainstorming outcome)

| Decision | Choice | Reasoning |
|---|---|---|
| Cosa snapshotta un profilo | `AetherContext` + `thinkingEnabled` | Coerente con concetto "Environment" + cattura preferenza UI key dello slice 3. Sessioni separate. |
| Active profile tracking | `activeProfileId` persistito in localStorage | Single source of truth client-side; backend non sa di "active". Permette UI di evidenziare il profilo applicato. |
| Apply orchestration | Client-side (useProfilesStore.apply) | UI prefs sono client-only → il client DEVE coordinare. Backend resta agnostico. |
| Auto-sync active ↔ current | NO | Modifiche locali non aggiornano il profilo. Previene loss di setup salvati. Save esplicita via "Save here". |
| Import behavior | Save as new, no auto-apply | Sicuro contro perdita context corrente. Utente decide quando applicare. |
| Delete active | Confirm + clear activeProfileId; context invariato | Coerente con UX standard (delete non sovrascrive lo stato in uso). |
| UI placement | TopBar button → modal "Profiles Manager" | Sidebar già densa (Sessions + 4 sezioni). Modal offre spazio tabulare per actions. |
| UI prefs storage in profile | Flat field `thinkingEnabled: boolean` | YAGNI: una sola pref oggi. Refactor a `uiPrefs: {...}` quando ne aggiungiamo altre. |
| Name collision policy | Server-side automatic suffix `(N)` | Zero round-trip, idempotente, niente prompt utente. |
| Export format | Client-side JSON download | Server non si occupa di Content-Disposition; più testabile e flessibile. |
| Schema strictness on import | `.passthrough()` su ProfileImportSchema | Forward-compatible: profili futuri con campi extra non crashano. |

## Architecture

### Backend (`server/`)

```
server/
  domain/
    profiles/
      profiles.types.ts                  # NEW
      profiles.schema.ts                 # NEW
      profiles.schema.test.ts            # NEW
      profiles.store.ts                  # NEW
      profiles.store.test.ts             # NEW
  routes/
    profiles.routes.ts                   # NEW
    profiles.routes.test.ts              # NEW
  app.ts                                 # MODIFY: AppDeps +profilesStore
  app.test.ts                            # MODIFY (small)
  index.ts                               # MODIFY: instantiate ProfilesStore
```

#### Types

```ts
// server/domain/profiles/profiles.types.ts
import type { AetherContext } from '@/server/domain/context/context.types';

export interface ProfileRecord {
  name: string;
  createdAt: number;
  updatedAt: number;
  context: AetherContext;
  thinkingEnabled: boolean;
}

export interface ProfileMeta {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
}

export type ProfilesFile = Record<string, ProfileRecord>;
```

#### Schema

```ts
// profiles.schema.ts
import { z } from 'zod';
import { AetherContextSchema } from '@/server/domain/context/context.schema';

export const ProfileRecordSchema = z.object({
  name: z.string().min(1).max(100),
  createdAt: z.number(),
  updatedAt: z.number(),
  context: AetherContextSchema,
  thinkingEnabled: z.boolean(),
});

export const ProfilesFileSchema = z.record(z.string(), ProfileRecordSchema);

// Looser shape for import — allows files from older/different sources.
export const ProfileImportSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  context: AetherContextSchema,
  thinkingEnabled: z.boolean().optional(),
}).passthrough();
```

#### `ProfilesStore` API

```ts
class ProfilesStore {
  constructor(filePath: string);

  listProfiles(): Promise<ProfileMeta[]>;                                    // sorted updatedAt desc
  read(id: string): Promise<ProfileRecord | null>;
  create(input: { name: string; context: AetherContext; thinkingEnabled: boolean }): Promise<ProfileMeta>;
  update(id: string, patch: Partial<Omit<ProfileRecord, 'createdAt'>>): Promise<ProfileMeta>;
  rename(id: string, name: string): Promise<ProfileMeta>;
  delete(id: string): Promise<void>;
}
```

`create()`:
- Generates `id = randomUUID()`, `createdAt = updatedAt = Date.now()`.
- Applies **name collision suffixing**: if `input.name` already exists in any profile's name (case-sensitive), suffix becomes `"name (1)"`, `"name (2)"`, etc. until unique. Implementato come helper `findUniqueName(existing: Map<id, ProfileRecord>, desired: string): string`.

`update()`:
- Throws `NotFoundError` on missing id.
- Bumps `updatedAt = Date.now()`.
- Validates patched `name` if provided (non-empty, ≤100).
- Cannot patch `createdAt` (Omit).

`rename()`: shortcut to `update(id, {name})`.

`delete()`: throws `NotFoundError` on missing id.

#### Routes

```
GET    /api/profiles                  → 200 { profiles: ProfileMeta[] }
POST   /api/profiles                  → 201 ProfileMeta
                                        body: { name: string, context: AetherContext, thinkingEnabled: boolean }
GET    /api/profiles/:id              → 200 ProfileRecord                | 404
PUT    /api/profiles/:id              → 200 ProfileMeta                  | 400 | 404
                                        body: ProfileRecord (full overwrite; createdAt preserved server-side)
PATCH  /api/profiles/:id              → 200 ProfileMeta                  | 400 | 404
                                        body: { name } (rename only in slice 4)
DELETE /api/profiles/:id              → 204                              | 404
POST   /api/profiles/import           → 201 ProfileMeta                  | 400
                                        body: ProfileImportSchema (loose, defaults applied)
```

**PUT** semantics: server preserves `createdAt` even if the body provides a different one (defensive — clients shouldn't be able to rewrite history).

**POST /import**:
1. zod parse with `ProfileImportSchema.passthrough()` — extra fields stripped silently.
2. Default `name` = `'Imported profile'` if absent.
3. Default `thinkingEnabled` = `false` if absent.
4. Apply name-collision suffixing.
5. Create profile, return 201 ProfileMeta.

### Frontend (`src/`)

```
src/
  types/profile.types.ts                       # NEW
  lib/api/
    profiles.api.ts                            # NEW
    profiles.api.test.ts                       # NEW
  stores/
    profiles.store.ts                          # NEW
    profiles.store.test.ts                     # NEW
    context.store.ts                           # MODIFY: +getCurrentContext getter
    context.store.test.ts                      # MODIFY
    ui.store.ts                                # MODIFY: +profilesModalOpen/open/close
    ui.store.test.ts                           # MODIFY
  hooks/
    useExportImport.ts                         # NEW
    useExportImport.test.ts                    # NEW
  components/
    profiles/
      ProfilesButton.tsx                       # NEW
      ProfilesButton.test.tsx                  # NEW
      ProfilesModal.tsx                        # NEW
      ProfilesModal.test.tsx                   # NEW
      ProfilesTable.tsx                        # NEW
      ProfilesTable.test.tsx                   # NEW
    layout/
      TopBar.tsx                               # MODIFY: mount ProfilesButton
      TopBar.test.tsx                          # MODIFY
  App.tsx                                      # MODIFY: initProfiles in useEffect
  App.test.tsx                                 # MODIFY
  test/msw-handlers.ts                         # MODIFY: default /api/profiles* handlers
```

#### Types (FE re-export)

```ts
// src/types/profile.types.ts
export type {
  ProfileRecord,
  ProfileMeta,
} from '@/server/domain/profiles/profiles.types';
```

#### `profiles.api`

```ts
export const profilesApi = {
  list: () => Promise<ProfileMeta[]>;
  get: (id: string) => Promise<ProfileRecord>;       // throws on 404
  create: (input: { name: string; context: AetherContext; thinkingEnabled: boolean }) => Promise<ProfileMeta>;
  update: (id: string, body: ProfileRecord) => Promise<ProfileMeta>;
  rename: (id: string, name: string) => Promise<ProfileMeta>;
  delete: (id: string) => Promise<void>;
  importJson: (parsed: unknown) => Promise<ProfileMeta>;   // POST /import
};
```

Error shape: `throw new Error(body.error?.message ?? 'HTTP <status>')` (same pattern of slice 2b).

#### `useUiStore` extensions

```ts
interface UiState {
  // ... existing (reasoningDrawerOpen, thinkingEnabled, focusedMessageId)
  profilesModalOpen: boolean;                       // NEW
  openProfilesModal: () => void;                    // NEW
  closeProfilesModal: () => void;                   // NEW
  // ... existing methods
}
```

`profilesModalOpen` defaults to `false`. Not persisted to localStorage (always closed at boot).

#### `useContextStore` extension

```ts
getCurrentContext(): AetherContext | null;   // returns s.context (null pre-hydration)
```

Used by `profiles.store.saveCurrent` and `saveCurrentToActive` to capture current state without round-trip.

#### `useProfilesStore` shape

```ts
const STORAGE_KEY = 'aether.activeProfileId';

interface ProfilesState {
  profiles: ProfileMeta[];           // updatedAt desc
  activeProfileId: string | null;
  hydrated: boolean;
  error: string | null;

  init: () => Promise<void>;
  saveCurrent: (name: string) => Promise<ProfileMeta>;
  saveCurrentToActive: () => Promise<void>;          // PUT to activeProfileId
  saveCurrentTo: (id: string) => Promise<void>;      // PUT to specific id (used by "Save here" on any row)
  apply: (id: string) => Promise<void>;
  rename: (id: string, name: string) => Promise<void>;
  delete: (id: string) => Promise<void>;
  exportProfile: (id: string) => Promise<void>;
  importFile: (file: File) => Promise<ProfileMeta>;
  clearError: () => void;
  _reset: () => void;
}
```

##### `init()`

```
try:
  profiles = await profilesApi.list()
  sortedProfiles = sortByUpdatedDesc(profiles)
  stored = localStorage.getItem(STORAGE_KEY)
  activeId = (stored && sortedProfiles.some(p => p.id === stored)) ? stored : null
  if (activeId === null && stored !== null) localStorage.removeItem(STORAGE_KEY)
  set({ profiles: sortedProfiles, activeProfileId: activeId, hydrated: true, error: null })
catch e:
  set({ profiles:[], activeProfileId:null, hydrated:true, error: errMsg(e) })
```

##### `saveCurrent(name)`

```
ctx = useContextStore.getState().getCurrentContext()
if (!ctx) { set({error:'Context not loaded'}); throw ... }
thinkingEnabled = useUiStore.getState().thinkingEnabled
try:
  meta = await profilesApi.create({ name, context: ctx, thinkingEnabled })
  set((s) => ({ profiles: [meta, ...s.profiles], error: null }))
  return meta
catch e:
  set({ error: errMsg(e) })
  throw
```

##### `saveCurrentToActive()`

```
activeId = get().activeProfileId
if (!activeId) { set({error:'No active profile'}); throw ... }
return get().saveCurrentTo(activeId)
```

##### `saveCurrentTo(id)`

```
ctx = useContextStore.getState().getCurrentContext()
if (!ctx) { set({error:'Context not loaded'}); throw ... }
thinkingEnabled = useUiStore.getState().thinkingEnabled

existing = get().profiles.find(p => p.id === id)
if (!existing) { set({error:'Profile not found'}); throw ... }

body: ProfileRecord = {
  name: existing.name,
  createdAt: existing.createdAt,
  updatedAt: Date.now(),   // server bumps anyway, but include to satisfy schema
  context: ctx,
  thinkingEnabled,
}
try:
  meta = await profilesApi.update(id, body)
  set((s) => ({
    profiles: sortByUpdatedDesc(s.profiles.map(p => p.id === id ? meta : p)),
    error: null,
  }))
catch e:
  set({ error: errMsg(e) })
  throw
```

##### `apply(id)`

```
try:
  record = await profilesApi.get(id)
  await useContextStore.getState().bulkOverwriteFromProfile(record.context)
       // bulkOverwriteFromProfile is a thin wrapper around the existing
       // useContextStore.bulkOverwrite optimistic flow; alternatively call
       // contextApi.bulkOverwrite directly and setState manually. Whichever
       // results in useContextStore.state.context being set.
  useUiStore.getState().setThinkingEnabled(record.thinkingEnabled)
  localStorage.setItem(STORAGE_KEY, id)
  set({ activeProfileId: id, error: null })
catch e:
  // if 404, clear stale active
  if (errIs404(e)) {
    localStorage.removeItem(STORAGE_KEY)
    if (get().activeProfileId === id) set({ activeProfileId: null })
    // refresh list
    await get().init()
  }
  set({ error: errMsg(e) })
  throw
```

**Note on `bulkOverwriteFromProfile`**: this is a new minor action on `useContextStore` (or we reuse the existing `bulkOverwrite` if its signature already matches). The existing `useContextStore.bulkOverwrite(ctx)` from slice 1 already does:
1. PUT `/api/context` with the new ctx
2. setState `context: response`

So `apply` simply calls `useContextStore.getState().bulkOverwrite(record.context)` directly. No new action needed on context store. ✓

##### `rename(id, name)`

```
prev = get().profiles
optimistic = prev.map(p => p.id === id ? {...p, name} : p)
set({ profiles: optimistic, error: null })
try:
  await profilesApi.rename(id, name)
catch e:
  set({ profiles: prev, error: errMsg(e) })
  throw
```

##### `delete(id)`

(Confirm dialog handled by the component.)

```
try:
  await profilesApi.delete(id)
catch e:
  set({ error: errMsg(e) })
  throw
wasActive = get().activeProfileId === id
set((s) => ({ profiles: s.profiles.filter(p => p.id !== id), error: null }))
if (wasActive) {
  localStorage.removeItem(STORAGE_KEY)
  set({ activeProfileId: null })
}
```

##### `exportProfile(id)`

```
try:
  record = await profilesApi.get(id)
  const json = JSON.stringify(record, null, 2)
  const safeName = record.name.replace(/[^a-zA-Z0-9-_.]/g, '_')
  useExportImport.triggerDownload(`aether-profile-${safeName}-${Date.now()}.json`, json)
catch e:
  set({ error: errMsg(e) })
  throw
```

##### `importFile(file)`

```
if (file.size > 5 * 1024 * 1024) { set({error:'File too large (max 5MB)'}); throw ... }
let parsed: unknown
try:
  const text = await file.text()
  parsed = JSON.parse(text)
catch:
  set({ error: 'Invalid JSON' }); throw
try:
  meta = await profilesApi.importJson(parsed)
  set((s) => ({ profiles: [meta, ...s.profiles], error: null }))
  return meta
catch e:
  set({ error: errMsg(e) })
  throw
```

#### `useExportImport`

```ts
export function useExportImport() {
  const triggerDownload = useCallback((filename: string, content: string) => {
    const blob = new Blob([content], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }, []);

  const pickFile = useCallback((accept: string): Promise<File | null> => {
    return new Promise((resolve) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = accept;
      input.style.display = 'none';
      document.body.appendChild(input);
      input.addEventListener('change', () => {
        const file = input.files?.[0] ?? null;
        document.body.removeChild(input);
        resolve(file);
      }, { once: true });
      // Note: 'cancel' event not universally supported. We accept that
      // a cancel without selection leaves the promise pending until the
      // input is GC'd. The DOM cleanup is best-effort.
      input.click();
    });
  }, []);

  return { triggerDownload, pickFile };
}
```

Tests mock `URL.createObjectURL` and use `fireEvent.change(input, {target:{files:[mockFile]}})` to drive `pickFile`.

#### Components

**`ProfilesButton`** (in TopBar):
```tsx
const active = useProfilesStore((s) =>
  s.activeProfileId ? s.profiles.find(p => p.id === s.activeProfileId) ?? null : null
);
const open = useUiStore((s) => s.openProfilesModal);

const label = active ? truncate(active.name, 20) : 'Profiles';

<button aria-label="Open profiles manager" onClick={open}>
  <FolderOpen size={14}/> {label}
</button>
```

**`ProfilesModal`**:
```tsx
const open = useUiStore((s) => s.profilesModalOpen);
const close = useUiStore((s) => s.closeProfilesModal);
if (!open) return null;
// uses existing Modal primitive from slice 0
<Modal title="Profiles" onClose={close}>
  <toolbar>
    + Save current as new   |   ↑ Import   |   error pill (if any)
  </toolbar>
  <ProfilesTable .../>
</Modal>
```

**`ProfilesTable`**:
```tsx
<table>
  <thead>Name / Created / Updated / Actions</thead>
  <tbody>
    {profiles.map(p => (
      <tr key={p.id} className={p.id === activeId ? 'active' : ''}>
        <td>
          {p.id === activeId && <CheckIcon/>}
          {p.name}
        </td>
        <td>{formatDate(p.createdAt)}</td>
        <td>{formatDate(p.updatedAt)}</td>
        <td>
          <button onClick={() => onApply(p.id)}>Apply</button>
          <button onClick={() => onSaveHere(p.id)}>Save here</button>
          <button onClick={() => onRename(p.id, p.name)}>Rename</button>
          <button onClick={() => onExport(p.id)}>Export</button>
          <button onClick={() => onDelete(p.id, p.name)}>Delete</button>
        </td>
      </tr>
    ))}
  </tbody>
</table>
```

Empty state: `<tr><td colSpan>"No profiles yet — click 'Save current as new' to create one"</td></tr>`.

**`TopBar` change**: add `<ProfilesButton/>` between title and existing sidebar toggle. Layout: `[title] [...spacer] [profile button] [toggle sidebar]`.

### App.tsx wiring

```tsx
useEffect(() => {
  initContext();
  initSessions();
  initUi();
  initProfiles();   // NEW
}, [initContext, initSessions, initUi, initProfiles]);

// ... AppShell as before, ChatView, ReasoningDrawer, plus:
<ProfilesModal />
```

`ProfilesModal` mounts always but renders null when closed (same pattern as `ReasoningDrawer`).

## Data flow

(See brainstorming Sezione 3 for full traces. Summary:)

- **Boot cold (empty)**: `init()` → empty list, no active. TopBar shows "Profiles".
- **Boot warm (stored active valid)**: TopBar shows active name; context + thinkingEnabled already persisted independently so no re-apply needed.
- **Boot warm (stored obsolete)**: clear localStorage, fallback null.
- **Save current as new**: prompt name → POST → prepend to list. No auto-apply.
- **Apply**: GET full record → bulkOverwrite context (PUT /api/context) → setThinkingEnabled (localStorage) → localStorage activeProfileId → setState. Sidebar sections re-render via existing useContextStore selectors. MessageInput Brain icon reflects new state.
- **Save here / Save changes to active**: PUT /api/profiles/:id with current state snapshot. activeProfileId invariato.
- **Rename**: optimistic + PATCH + rollback. TopBar nome aggiornato se attivo.
- **Delete**: confirm → DELETE → filter out → if active, clear active+localStorage. Context invariato.
- **Export**: GET full → JSON.stringify → Blob download with sanitized filename.
- **Import**: pickFile → JSON.parse → POST /import → prepend. Save-as-new (no auto-apply).
- **Reload**: independent persistence (context via context.json, thinkingEnabled via localStorage, activeProfileId via localStorage). No coordinated re-apply needed.

## Error handling & edge cases

(See brainstorming Sezione 4 for full table.)

Key invariants:

1. **All non-streaming errors → inline error pill** in `ProfilesModal` (same pattern as `useSessionsStore.error` from slice 2b). Auto-clear su next successful action.
2. **`apply` 404 path**: clear stale active + refresh list + error pill.
3. **`saveCurrent` without hydrated context**: early return + error pill 'Context not loaded'.
4. **Import invalid JSON (client-side)**: error pill 'Invalid JSON', no server roundtrip.
5. **Import 400 (zod validation)**: error pill 'Invalid profile shape: <details>'.
6. **Import file > 5MB**: error pill 'File too large (max 5MB)', no server roundtrip.
7. **Name collision**: server-side auto-suffix `(N)`, no client-side prompt.
8. **`PUT` body extra fields**: server-side zod schema strict on PUT (no passthrough); client always sends exact `ProfileRecord` shape.
9. **`POST /import` accepts extra fields**: `.passthrough()` — forward-compat with future schema additions.
10. **Concurrent saves**: JsonStore + p-queue → atomic; last write wins on shared profile.
11. **Filename sanitization**: client regex `[^a-zA-Z0-9-_.]` → `_`. Safe across OSes.

## Testing strategy

### Backend

| File | Cosa testa | Tipo |
|---|---|---|
| `profiles.schema.test.ts` | ProfileRecord/Import/File parses; rejects empty/long name; .passthrough() accepts extras | unit |
| `profiles.store.test.ts` | listProfiles ordered; read returns null on miss; create generates UUID + collision suffix `(1)/(2)`; update bumps updatedAt + validates name; rename shortcut; delete + NotFound; persists across instances | unit |
| `profiles.routes.test.ts` | supertest CRUD + import; 400/404 paths; PUT preserves createdAt; PATCH name only; import without name fills default; import suffix collisions | integration |
| `app.test.ts` (MODIFY) | profilesStore dep wires routes | integration |

### Frontend

| File | Cosa testa | Tipo |
|---|---|---|
| `profiles.api.test.ts` | list/get/create/update/rename/delete/importJson happy + error paths | unit (MSW) |
| `profiles.store.test.ts` | init (empty / valid stored / obsolete stored / error); saveCurrent reads from context+ui store, POSTs, prepends; saveCurrentToActive PUTs current state; saveCurrentTo arbitrary id; apply GETs + bulkOverwrites + setThinkingEnabled + setActive + localStorage; apply 404 path (clear+refresh); rename optimistic + rollback; delete + clear active; exportProfile triggers download (mocked); importFile reads + parses + POSTs; importFile invalid JSON; importFile too large | unit |
| `useExportImport.test.ts` | triggerDownload creates blob + clicks anchor (mocked URL.createObjectURL); pickFile resolves File via simulated change; pickFile sanitizer | unit |
| `context.store.test.ts` (MODIFY) | getCurrentContext returns context or null | unit |
| `ui.store.test.ts` (MODIFY) | profilesModalOpen + open/close actions | unit |
| `ProfilesButton.test.tsx` | "Profiles" when no active; active name truncated 20 char; click opens modal | unit |
| `ProfilesTable.test.tsx` | empty state ("No profiles yet"); rows sorted updatedAt desc; active highlighted; buttons call props with id | unit |
| `ProfilesModal.test.tsx` | closed → null; open → table visible; toolbar buttons trigger flows (mock useDialog + pickFile); error pill | unit (RTL + MSW + DialogHost) |
| `TopBar.test.tsx` (MODIFY) | mounts ProfilesButton | unit |
| `App.test.tsx` (MODIFY) | smoke: ProfilesButton visible; init calls profilesStore.init | smoke |

### E2E (Playwright)

`e2e/smoke.spec.ts` aggiunge: cleanup → open modal → save current as new → row visible → apply → TopBar shows profile name.

```ts
test('profiles: save → apply roundtrip', async ({ page, request }) => {
  const list = await request.get('/api/profiles').then((r) => r.json());
  for (const p of (list.profiles as { id: string }[])) {
    await request.delete(`/api/profiles/${p.id}`);
  }
  await page.goto('/');
  await page.getByRole('button', { name: /open profiles manager/i }).click();
  await expect(page.getByRole('dialog', { name: /profiles/i })).toBeVisible();
  await page.getByRole('button', { name: /save current as new/i }).click();
  await page.getByRole('textbox').last().fill('e2e profile');
  await page.getByRole('button', { name: /ok|save|confirm/i }).last().click();
  await expect(page.getByText('e2e profile')).toBeVisible({ timeout: 5000 });
  await page.getByRole('button', { name: /apply/i }).first().click();
  await expect(page.getByRole('button', { name: /open profiles manager/i })).toContainText('e2e profile');
});
```

### Coverage thresholds

Invariate (80%). Nuovi file ricadono in folder gated.

### TDD ordering

```
1. RED   profiles.types + schema (zod)
2. GREEN
3. RED   profiles.store (CRUD + name collision)
4. GREEN
5. RED   profiles.routes (supertest CRUD + import)
6. GREEN + wire app.ts AppDeps + index.ts bootstrap
7. RED   profiles.api FE
8. GREEN
9. RED   useUiStore +profilesModalOpen
10. GREEN
11. RED   context.store +getCurrentContext
12. GREEN
13. RED   useExportImport
14. GREEN
15. RED   profiles.store FE
16. GREEN
17. RED   ProfilesButton
18. GREEN
19. RED   ProfilesTable
20. GREEN
21. RED   ProfilesModal
22. GREEN
23. RED   TopBar +ProfilesButton mount
24. GREEN
25. RED   App.tsx smoke +initProfiles
26. GREEN
27. SMOKE Playwright roundtrip
```

## Risks & mitigations

| Risk | Mitigation |
|---|---|
| `apply` partial failure (context PUT ok, then crash before setActive) | Reload mostra context nuovo + activeProfileId vecchio (cosmetic mismatch). Rare; documentato. |
| Multi-tab divergence | Single-tab assumed; last-write-wins on shared file via p-queue. |
| Export filename invalid chars | Client-side `[^a-zA-Z0-9-_.]` → `_`. |
| Import schema breaking changes | `.passthrough()` strips extras; required fields enforced; graceful UX-degrade. |
| Profile JSON > 1MB Express limit | 413 from Express; error pill suggerisce di splittare. Out-of-scope to raise limit. |
| Accidental delete of important profile | Confirm dialog (destructive). Same UX as Sessions delete (slice 2b). |
| `apply` mid-stream | NO guard. Risposta in volo non interrotta; prossimo dispatch usa nuovo context. Documentato. |

## Data model summary

```ts
// On disk (data/profiles.json)
{
  "<uuid-1>": {
    "name": "Coding mode",
    "createdAt": 1779...,
    "updatedAt": 1779...,
    "context": { systemInstruction, skills, tools, mcpServers },
    "thinkingEnabled": true
  },
  "<uuid-2>": { ... }
}

// Wire (HTTP)
GET    /api/profiles               → { profiles: ProfileMeta[] }
GET    /api/profiles/:id           → ProfileRecord
POST   /api/profiles               → 201 ProfileMeta
PUT    /api/profiles/:id           → 200 ProfileMeta
PATCH  /api/profiles/:id           → 200 ProfileMeta  (name only in slice 4)
DELETE /api/profiles/:id           → 204
POST   /api/profiles/import        → 201 ProfileMeta

// Frontend (useProfilesStore)
profiles: ProfileMeta[]
activeProfileId: string | null     // localStorage persisted
hydrated: boolean
error: string | null
```

## Open items

- **Active-profile dirty indicator**: future. Derived `isDirty` via deep-equal current vs profile snapshot.
- **PATCH widening**: in slice 4 supporta solo `{name}`. Future could allow partial patches of context/thinkingEnabled.
- **TopBar layout**: dettaglio implementativo (probabilmente button tra title e toggle sidebar).

## Approval

Spec approvata in brainstorming session 2026-05-19. Tutte le 5 sezioni (backend, frontend, data flow, error handling, testing) confermate.

**Next:** invocare `superpowers:writing-plans` per generare il piano implementativo TDD.
