# Library Directory Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move Aether's authorable material (skills now, agents later) into a dedicated, data-agnostic per-user library directory, with a one-time automatic boot relocation.

**Architecture:** A new `libraryDir` config value (OS app-data default, `AETHER_LIBRARY_DIR` override) becomes the home of `skills/` (relocated from `${dataDir}/skills`) and a reserved `agents/` dir. A boot-time migration moves an existing `${dataDir}/skills` to the new location using the existing EXDEV-safe `moveDirSync`. The SQLite DB, key vault and daemon file stay in `dataDir`.

**Tech Stack:** Node.js (`node:os`, `node:path`, `node:fs`), TypeScript (strict, `noEmit`), Vitest (backend project, node env, globals on), better-sqlite3 (unchanged here).

## Global Constraints

- Cross-platform: Windows / macOS / Linux. Use `node:path` joins, never hardcode separators. Path comparisons must not assume POSIX.
- Brand dir name: `Aether` on Windows/macOS, `aether` (lowercase) on Linux.
- `AETHER_LIBRARY_DIR` overrides the default location entirely.
- Library dir is independent of `AETHER_DATA_DIR`. DB (`aether.sqlite`), key vault, daemon file remain in `dataDir`.
- Relocation is automatic on first boot, idempotent, requires no user action.
- TypeScript strict with `noUnusedLocals`/`noUnusedParameters`. `npm run lint` (tsc --noEmit) is the type-check gate.
- Tests colocated as `*.test.ts`; Vitest globals (`describe/it/expect`) need no import. Run backend tests with `--project backend`.
- Import alias: `@/*` is the repo root.

---

### Task 1: `defaultLibraryDir()` resolver + config wiring

**Files:**
- Create: `server/lib/library-dir.ts`
- Create: `server/lib/library-dir.test.ts`
- Modify: `server/config.ts` (add `libraryDir` to `AppConfig` + `loadConfig`)
- Modify: `.env.example`, `README.md` (document `AETHER_LIBRARY_DIR`)

**Interfaces:**
- Produces: `defaultLibraryDir(opts?: { platform?: NodeJS.Platform; env?: NodeJS.ProcessEnv; homedir?: string }): string`
- Produces: `AppConfig.libraryDir: string`

- [ ] **Step 1: Write the failing test**

Create `server/lib/library-dir.test.ts`:

```ts
import path from 'node:path';
import { defaultLibraryDir } from './library-dir';

describe('defaultLibraryDir', () => {
  it('uses %APPDATA%/Aether on Windows when APPDATA is set', () => {
    const r = defaultLibraryDir({
      platform: 'win32',
      env: { APPDATA: 'C:\\Users\\me\\AppData\\Roaming' },
      homedir: 'C:\\Users\\me',
    });
    expect(r).toBe(path.join('C:\\Users\\me\\AppData\\Roaming', 'Aether'));
  });

  it('falls back to ~/AppData/Roaming/Aether on Windows without APPDATA', () => {
    const r = defaultLibraryDir({ platform: 'win32', env: {}, homedir: 'C:\\Users\\me' });
    expect(r).toBe(path.join('C:\\Users\\me', 'AppData', 'Roaming', 'Aether'));
  });

  it('uses ~/Library/Application Support/Aether on macOS', () => {
    const r = defaultLibraryDir({ platform: 'darwin', env: {}, homedir: '/Users/me' });
    expect(r).toBe(path.join('/Users/me', 'Library', 'Application Support', 'Aether'));
  });

  it('uses $XDG_DATA_HOME/aether on Linux when set', () => {
    const r = defaultLibraryDir({ platform: 'linux', env: { XDG_DATA_HOME: '/custom/share' }, homedir: '/home/me' });
    expect(r).toBe(path.join('/custom/share', 'aether'));
  });

  it('falls back to ~/.local/share/aether on Linux without XDG_DATA_HOME', () => {
    const r = defaultLibraryDir({ platform: 'linux', env: {}, homedir: '/home/me' });
    expect(r).toBe(path.join('/home/me', '.local', 'share', 'aether'));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run --project backend server/lib/library-dir.test.ts`
Expected: FAIL — `Cannot find module './library-dir'`.

- [ ] **Step 3: Write minimal implementation**

Create `server/lib/library-dir.ts`:

```ts
import os from 'node:os';
import path from 'node:path';

export interface LibraryDirOpts {
  platform?: NodeJS.Platform;
  env?: NodeJS.ProcessEnv;
  homedir?: string;
}

/**
 * Resolve the default per-user library directory using OS app-data conventions.
 * `AETHER_LIBRARY_DIR` (handled in config) overrides this entirely.
 * Options are injectable so the resolver is testable on any host OS.
 */
export function defaultLibraryDir(opts: LibraryDirOpts = {}): string {
  const platform = opts.platform ?? os.platform();
  const env = opts.env ?? process.env;
  const home = opts.homedir ?? os.homedir();

  if (platform === 'win32') {
    const appData = env.APPDATA && env.APPDATA.trim() !== ''
      ? env.APPDATA
      : path.join(home, 'AppData', 'Roaming');
    return path.join(appData, 'Aether');
  }
  if (platform === 'darwin') {
    return path.join(home, 'Library', 'Application Support', 'Aether');
  }
  const xdg = env.XDG_DATA_HOME && env.XDG_DATA_HOME.trim() !== ''
    ? env.XDG_DATA_HOME
    : path.join(home, '.local', 'share');
  return path.join(xdg, 'aether');
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run --project backend server/lib/library-dir.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Wire `libraryDir` into config**

In `server/config.ts`, add the import after line 2:

```ts
import { defaultLibraryDir } from './lib/library-dir';
```

Add to the `AppConfig` interface (after `dataDir: string;`):

```ts
  libraryDir: string;
```

Add to the object returned by `loadConfig()` (after the `dataDir:` line):

```ts
    libraryDir: process.env.AETHER_LIBRARY_DIR ?? defaultLibraryDir(),
```

- [ ] **Step 6: Document the env var**

In `.env.example`, after the `# AETHER_DATA_DIR="./data"` line add:

```
# Directory for authorable material (skills, future agents). Defaults to the OS
# per-user app-data dir (%APPDATA%/Aether, ~/Library/Application Support/Aether,
# ${XDG_DATA_HOME:-~/.local/share}/aether).
# AETHER_LIBRARY_DIR=""
```

In `README.md`, add a row to the env-var table right after the `AETHER_DATA_DIR` row:

```
| `AETHER_LIBRARY_DIR` | Directory for skills (and future agents) | OS app-data dir |
```

- [ ] **Step 7: Type-check**

Run: `npm run lint`
Expected: no errors.

- [ ] **Step 8: Commit**

```bash
git add server/lib/library-dir.ts server/lib/library-dir.test.ts server/config.ts .env.example README.md
git commit -m "feat(config): add libraryDir (OS app-data default, AETHER_LIBRARY_DIR override)"
```

---

### Task 2: Path helpers — `libraryDir` semantics + `agentsDirFor`

**Files:**
- Modify: `server/domain/skills/skills.paths.ts`
- Modify: `server/domain/skills/skills.paths.test.ts`
- Modify: `server/domain/skills/skills.service.ts:14-19` (constructor param rename)

**Interfaces:**
- Consumes: nothing new.
- Produces: `skillsDirFor(libraryDir: string): string` (= `${libraryDir}/skills`), `draftsDirFor(libraryDir: string): string` (= `${libraryDir}/skills/.drafts`), `agentsDirFor(libraryDir: string): string` (= `${libraryDir}/agents`).

- [ ] **Step 1: Write the failing test**

In `server/domain/skills/skills.paths.test.ts`, change the import on line 3 to include `agentsDirFor`:

```ts
import { skillsDirFor, draftsDirFor, agentsDirFor, defaultsDir } from './skills.paths';
```

Add this test inside the `describe('skills paths', ...)` block (after the `draftsDirFor` test):

```ts
  it('agentsDirFor joins agents under the library dir', () => {
    expect(agentsDirFor('/lib')).toBe(path.join('/lib', 'agents'));
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run --project backend server/domain/skills/skills.paths.test.ts`
Expected: FAIL — `agentsDirFor is not a function` (or import error).

- [ ] **Step 3: Add `agentsDirFor` and relabel params**

In `server/domain/skills/skills.paths.ts`, replace the `skillsDirFor` and `draftsDirFor` functions (lines 7-15) with:

```ts
/** Root of material skills: ${libraryDir}/skills */
export function skillsDirFor(libraryDir: string): string {
  return path.join(libraryDir, 'skills');
}

/** Staging area for generated/manual drafts: ${libraryDir}/skills/.drafts */
export function draftsDirFor(libraryDir: string): string {
  return path.join(skillsDirFor(libraryDir), '.drafts');
}

/** Reserved home for future file-based agents: ${libraryDir}/agents */
export function agentsDirFor(libraryDir: string): string {
  return path.join(libraryDir, 'agents');
}
```

- [ ] **Step 4: Rename the SkillsService constructor param**

In `server/domain/skills/skills.service.ts`, change the constructor (lines 14-20) from `dataDir` to `libraryDir`:

```ts
  constructor(
    private readonly state: SkillStateStore,
    libraryDir: string,
  ) {
    this.skillsDir = skillsDirFor(libraryDir);
    this.draftsDir = draftsDirFor(libraryDir);
  }
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run --project backend server/domain/skills/`
Expected: PASS (existing skills tests + the new `agentsDirFor` test).

- [ ] **Step 6: Type-check**

Run: `npm run lint`
Expected: no errors. (`index.ts:198` still passes `cfg.dataDir` here — it is a `string`, so it type-checks; Task 4 switches it to `cfg.libraryDir`.)

- [ ] **Step 7: Commit**

```bash
git add server/domain/skills/skills.paths.ts server/domain/skills/skills.paths.test.ts server/domain/skills/skills.service.ts
git commit -m "feat(skills): library-dir path helpers + agentsDirFor"
```

---

### Task 3: One-time skills relocation migration

**Files:**
- Create: `server/domain/skills/relocate.ts`
- Create: `server/domain/skills/relocate.test.ts`

**Interfaces:**
- Consumes: `moveDirSync(src, dest, rename?)` from `@/server/lib/move-dir` (already handles EXDEV / Windows lock fallbacks; `rename` is injectable for tests), `skillsDirFor` from `./skills.paths`.
- Produces: `relocateSkillsDir(dataDir: string, libraryDir: string): boolean` — returns `true` if a move happened, `false` otherwise.

- [ ] **Step 1: Write the failing test**

Create `server/domain/skills/relocate.test.ts`:

```ts
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { relocateSkillsDir } from './relocate';

function tmp(): string {
  return mkdtempSync(path.join(os.tmpdir(), 'aether-reloc-'));
}

describe('relocateSkillsDir', () => {
  it('moves ${dataDir}/skills to ${libraryDir}/skills on first boot', () => {
    const data = tmp();
    const lib = tmp();
    mkdirSync(path.join(data, 'skills', 'my-skill'), { recursive: true });
    writeFileSync(path.join(data, 'skills', 'my-skill', 'SKILL.md'), '# mine');

    const moved = relocateSkillsDir(data, lib);

    expect(moved).toBe(true);
    expect(existsSync(path.join(data, 'skills'))).toBe(false);
    expect(readFileSync(path.join(lib, 'skills', 'my-skill', 'SKILL.md'), 'utf8')).toBe('# mine');
    rmSync(data, { recursive: true, force: true });
    rmSync(lib, { recursive: true, force: true });
  });

  it('is a no-op when ${dataDir}/skills does not exist', () => {
    const data = tmp();
    const lib = tmp();
    expect(relocateSkillsDir(data, lib)).toBe(false);
    expect(existsSync(path.join(lib, 'skills'))).toBe(false);
    rmSync(data, { recursive: true, force: true });
    rmSync(lib, { recursive: true, force: true });
  });

  it('is a no-op when ${libraryDir}/skills already exists (idempotent second boot)', () => {
    const data = tmp();
    const lib = tmp();
    mkdirSync(path.join(data, 'skills'), { recursive: true });
    mkdirSync(path.join(lib, 'skills'), { recursive: true });
    expect(relocateSkillsDir(data, lib)).toBe(false);
    // source left untouched because destination already exists
    expect(existsSync(path.join(data, 'skills'))).toBe(true);
    rmSync(data, { recursive: true, force: true });
    rmSync(lib, { recursive: true, force: true });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run --project backend server/domain/skills/relocate.test.ts`
Expected: FAIL — `Cannot find module './relocate'`.

- [ ] **Step 3: Write minimal implementation**

Create `server/domain/skills/relocate.ts`:

```ts
import { existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { moveDirSync } from '@/server/lib/move-dir';
import { skillsDirFor } from './skills.paths';

/**
 * One-time relocation of the skills directory from the legacy location under
 * `${dataDir}/skills` to `${libraryDir}/skills`. Runs at boot, before seeding.
 *
 * Idempotent: it only moves when the destination is absent and the legacy
 * source exists, so it fires exactly once across the app's lifetime. Returns
 * whether a move happened (for logging). `moveDirSync` handles cross-volume
 * (EXDEV) and Windows lock fallbacks.
 */
export function relocateSkillsDir(dataDir: string, libraryDir: string): boolean {
  const legacy = skillsDirFor(dataDir);
  const target = skillsDirFor(libraryDir);
  if (existsSync(target) || !existsSync(legacy)) return false;
  mkdirSync(path.dirname(target), { recursive: true });
  moveDirSync(legacy, target);
  return true;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run --project backend server/domain/skills/relocate.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Type-check**

Run: `npm run lint`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add server/domain/skills/relocate.ts server/domain/skills/relocate.test.ts
git commit -m "feat(skills): one-time boot relocation of skills dir to libraryDir"
```

---

### Task 4: Wire relocation + library dir into bootstrap

**Files:**
- Modify: `server/index.ts` (imports near line 49; bootstrap body near lines 56-62 and 198)

**Interfaces:**
- Consumes: `relocateSkillsDir` (Task 3), `agentsDirFor`/`skillsDirFor` (Task 2), `cfg.libraryDir` (Task 1).
- Produces: nothing for later tasks (terminal wiring task).

- [ ] **Step 1: Update imports**

In `server/index.ts`, change line 49 from:

```ts
import { defaultsDir, skillsDirFor } from './domain/skills/skills.paths';
```

to:

```ts
import { defaultsDir, skillsDirFor, agentsDirFor } from './domain/skills/skills.paths';
import { relocateSkillsDir } from './domain/skills/relocate';
```

Add `mkdirSync` to the existing `node:fs` import if one exists; otherwise add near the other node imports at the top of the file:

```ts
import { mkdirSync } from 'node:fs';
```

(Check the top of `index.ts` first — if `node:fs` is already imported, add `mkdirSync` to that import list instead of duplicating.)

- [ ] **Step 2: Relocate + seed into the library dir**

In `server/index.ts`, replace line 62:

```ts
  seedDefaultSkills(defaultsDir(), skillsDirFor(cfg.dataDir));
```

with:

```ts
  if (relocateSkillsDir(cfg.dataDir, cfg.libraryDir)) {
    console.log(`[skills] relocated skills dir to ${skillsDirFor(cfg.libraryDir)}`);
  }
  mkdirSync(agentsDirFor(cfg.libraryDir), { recursive: true });
  seedDefaultSkills(defaultsDir(), skillsDirFor(cfg.libraryDir));
```

- [ ] **Step 3: Point SkillsService at the library dir**

In `server/index.ts`, change line 198 from:

```ts
  const skillsService = new SkillsService(skillStateStore, cfg.dataDir);
```

to:

```ts
  const skillsService = new SkillsService(skillStateStore, cfg.libraryDir);
```

- [ ] **Step 4: Type-check**

Run: `npm run lint`
Expected: no errors.

- [ ] **Step 5: Run the full backend test suite**

Run: `npx vitest run --project backend`
Expected: PASS (no regressions; library-dir, skills.paths, relocate suites green).

- [ ] **Step 6: Manual boot smoke (Fake provider, throwaway dirs)**

Run:

```bash
AETHER_DATA_DIR=$(mktemp -d) AETHER_LIBRARY_DIR=$(mktemp -d) AETHER_FAKE_PROVIDER=1 npm run dev
```

Expected: server boots without error; the `AETHER_LIBRARY_DIR` contains `skills/` (seeded defaults) and an empty `agents/`. Stop the server (Ctrl-C).

- [ ] **Step 7: Commit**

```bash
git add server/index.ts
git commit -m "feat(boot): relocate skills + seed into libraryDir, reserve agents dir"
```

---

## Self-Review

**Spec coverage:**
- A. Location resolution + config → Task 1 ✓
- B. Layout + path helpers (`skillsDirFor` semantics, `agentsDirFor`) → Task 2 ✓
- C. One-time relocation migration (boot order, EXDEV via `moveDirSync`, idempotency) → Task 3 (logic) + Task 4 (boot order) ✓
- D. Wiring; DB/vault stay in dataDir; agents dir created; SkillsService at libraryDir → Task 4 ✓
- E. Testing (resolver per-OS, relocation idempotent/no-op, seeding into new location) → Tasks 1/3 unit tests + Task 4 full-suite + smoke ✓

**Note vs spec:** The spec said `moveDirSync` would be "extracted and extended for EXDEV." It already lives at `@/server/lib/move-dir` and already handles EXDEV plus Windows lock codes with copy+remove (and an injectable `rename`). No extraction needed — Task 3 consumes it directly.

**Placeholder scan:** none — every code/step is concrete.

**Type consistency:** `defaultLibraryDir(opts)`, `skillsDirFor/draftsDirFor/agentsDirFor(libraryDir)`, `relocateSkillsDir(dataDir, libraryDir): boolean`, `AppConfig.libraryDir` — names/signatures consistent across Tasks 1-4.
