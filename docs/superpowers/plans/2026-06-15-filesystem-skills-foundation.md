# Filesystem Skills — Foundation (Plan 1 of 2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn Aether "skills" from label-only entries into Anthropic-style filesystem skills (a directory + `SKILL.md` + resources), discovered from `${AETHER_DATA_DIR}/skills/`, toggled/pinned from the UI, injected into the prompt via hybrid progressive-disclosure, with default skills seeded on boot and manually-created drafts promotable.

**Architecture:** A new backend domain `server/domain/skills/` owns a filesystem scan (source of truth for *existence*) plus a `skill_state` table (source of truth for *enabled/pinned*). `SkillsService` merges material skills + drafts; existing label skills stay in `context_skills` untouched. `DispatchService` asks `SkillsService` for active material skills and passes them to `assemble()`, which renders name+description for discovery (model reads `SKILL.md` via the filesystem MCP) and inlines the full `SKILL.md` only for pinned skills. The frontend gets a `skills.store` + `skills.api`; `SkillsSection` shows one visual list (label skills from `context.store` + material skills/drafts from `skills.store`).

**Tech Stack:** TypeScript (strict), Express, better-sqlite3, React 19 + Zustand, Tailwind v4, Vitest. No new dependencies (a tiny hand-rolled YAML-frontmatter parser avoids pulling in `js-yaml`).

**Scope note — what Plan 1 does NOT include:** the AI-assisted generation session (dedicated `DispatchService` chat with brainstorming + skill-creator that writes into `.drafts/`). That is Plan 2, built on this foundation. Plan 1 still delivers fully working software: copy a skill dir in → see/enable/pin it → it reaches the model; drop a dir into `.drafts/` → review/promote it.

**Deviation from spec (deliberate):** spec §5.2 says `SkillsService.list()` merges label + material into one list. For clean mutation routing (label skills are index-based via the existing `context_skills`; material skills are slug-based) the **backend `list()` returns material skills + drafts only**, and the **frontend `SkillsSection` concatenates** label skills (from `context.store`) with material skills (from `skills.store`) for the single visual list. Same UX, simpler and non-leaky types.

---

## File structure (Plan 1)

**Backend — new module `server/domain/skills/`:**
- `skills.types.ts` — `MaterialSkill`, `DraftSkill`, `SkillStateRow`, `SkillsList`, `PromptMaterialSkill`.
- `skills.paths.ts` — `skillsDirFor(dataDir)`, `draftsDirFor(dataDir)`, `defaultsDir()`.
- `frontmatter.ts` — `parseFrontmatter(md)`.
- `discovery.ts` — `discoverMaterialDirs(skillsDir)`, `discoverDraftDirs(skillsDir)`.
- `skill-state.store.ts` — `SkillStateStore` (the `skill_state` table).
- `skills.service.ts` — `SkillsService` (merge, setEnabled/setPinned, listDrafts, promote, remove, getActiveForPrompt).
- `seed.ts` — `seedDefaultSkills(defaultsDir, skillsDir)`.
- Colocated `*.test.ts` for `frontmatter`, `discovery`, `skill-state.store`, `skills.service`, `seed`.

**Backend — other:**
- `server/db/migrations/015_skill_state.sql` — new table.
- `server/skills/defaults/brainstorming/SKILL.md` — seeded default.
- `server/skills/defaults/skill-creator/SKILL.md` — seeded default.
- `server/routes/skills.routes.ts` (+ `.test.ts`) — `/api/skills`.
- Modify `server/domain/dispatch/prompt-assembler.ts` (+ `.test.ts`) — hybrid block.
- Modify `server/domain/dispatch/dispatch.service.ts` — inject `SkillsService`, pass material skills.
- Modify `server/index.ts` — construct `SkillStateStore`/`SkillsService`, seed defaults, wire deps.
- Modify `server/app.ts` — `AppDeps` field + conditional mount.
- Modify `package.json` — copy `server/skills/defaults` into `dist/` at build.

**Frontend:**
- `src/lib/api/skills.api.ts` — HTTP client.
- `src/stores/skills.store.ts` — Zustand store (optimistic).
- Modify `src/components/sidebar/SkillsSection.tsx` — unified list + material + drafts + fs-MCP warning.
- Modify `src/App.tsx` — init the skills store.
- Modify `src/i18n/en.ts` — strings.

---

## Phase A — Backend domain: types, parsing, discovery

### Task 1: Migration — `skill_state` table

**Files:**
- Create: `server/db/migrations/015_skill_state.sql`

- [ ] **Step 1: Write the migration**

```sql
-- Material (filesystem) skills track only their toggle state here; existence is
-- the directory on disk under ${AETHER_DATA_DIR}/skills/. Slug = directory name.
-- enabled: injected into the prompt at all; pinned: full SKILL.md inlined (vs
-- progressive disclosure). Material skills default to disabled.
CREATE TABLE skill_state (
  slug    TEXT PRIMARY KEY,
  enabled INTEGER NOT NULL DEFAULT 0,
  pinned  INTEGER NOT NULL DEFAULT 0
);
```

- [ ] **Step 2: Verify it applies**

Run: `npx vitest run server/domain/profiles/profiles.store.test.ts`
Expected: PASS — `makeTestDb()` applies all migrations including 015; an existing store test exercising the migrated DB still passes, proving the new SQL is valid.

- [ ] **Step 3: Commit**

```bash
git add server/db/migrations/015_skill_state.sql
git commit -m "feat(skills): migration for skill_state table"
```

---

### Task 2: Domain types

**Files:**
- Create: `server/domain/skills/skills.types.ts`

- [ ] **Step 1: Write the types**

```ts
/** A skill backed by a directory with a SKILL.md under the skills dir. */
export interface MaterialSkill {
  /** Slug = directory name = `name:` in SKILL.md frontmatter. */
  name: string;
  enabled: boolean;
  pinned: boolean;
  /** From frontmatter; undefined when the dir is invalid. */
  description?: string;
  /** Set when the directory is NOT a valid skill; human-readable reason. */
  invalid?: string;
}

/** A directory sitting in `.drafts/` awaiting review/promote. */
export interface DraftSkill {
  name: string;
  description?: string;
  invalid?: string;
}

/** Row shape of the `skill_state` table. */
export interface SkillStateRow {
  slug: string;
  enabled: boolean;
  pinned: boolean;
}

/** Response of GET /api/skills (material skills only; label skills stay in context). */
export interface SkillsList {
  skills: MaterialSkill[];
  drafts: DraftSkill[];
}

/** What DispatchService hands to the prompt assembler for an enabled material skill. */
export interface PromptMaterialSkill {
  name: string;
  description: string;
  pinned: boolean;
  /** Absolute path to the skill directory, used in the read-from-disk note. */
  dir: string;
  /** Full SKILL.md content; present only when pinned (inlined). */
  body?: string;
}
```

- [ ] **Step 2: Type-check**

Run: `npm run lint`
Expected: PASS (no errors).

- [ ] **Step 3: Commit**

```bash
git add server/domain/skills/skills.types.ts
git commit -m "feat(skills): domain types"
```

---

### Task 3: Path helpers

**Files:**
- Create: `server/domain/skills/skills.paths.ts`

- [ ] **Step 1: Write the helpers**

```ts
import path from 'node:path';

/** Root of material skills: ${dataDir}/skills */
export function skillsDirFor(dataDir: string): string {
  return path.join(dataDir, 'skills');
}

/** Staging area for generated/manual drafts: ${dataDir}/skills/.drafts */
export function draftsDirFor(dataDir: string): string {
  return path.join(skillsDirFor(dataDir), '.drafts');
}

/**
 * Bundled default skills shipped with the app. In dev __dirname is
 * server/domain/skills; in the esbuild prod bundle (dist/server.cjs) __dirname
 * is dist/. We mirror how migrations resolve: build copies server/skills/defaults
 * to dist/skills/defaults (see package.json build). Try the dev path first, then
 * the prod path.
 */
export function defaultsDir(): string {
  // dev: server/domain/skills/ -> ../../skills/defaults = server/skills/defaults
  const devPath = path.resolve(__dirname, '..', '..', 'skills', 'defaults');
  // prod: dist/ + skills/defaults
  const prodPath = path.resolve(__dirname, 'skills', 'defaults');
  return require('node:fs').existsSync(devPath) ? devPath : prodPath;
}
```

- [ ] **Step 2: Type-check**

Run: `npm run lint`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add server/domain/skills/skills.paths.ts
git commit -m "feat(skills): path helpers"
```

---

### Task 4: Frontmatter parser

**Files:**
- Create: `server/domain/skills/frontmatter.ts`
- Test: `server/domain/skills/frontmatter.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { parseFrontmatter } from './frontmatter';

describe('parseFrontmatter', () => {
  it('extracts name and description from a YAML frontmatter block', () => {
    const md = ['---', 'name: my-skill', 'description: Does a thing', '---', '', '# Body'].join('\n');
    expect(parseFrontmatter(md)).toEqual({ name: 'my-skill', description: 'Does a thing' });
  });

  it('strips surrounding quotes from values', () => {
    const md = ['---', 'name: "quoted"', "description: 'single'", '---'].join('\n');
    expect(parseFrontmatter(md)).toEqual({ name: 'quoted', description: 'single' });
  });

  it('returns {} when there is no frontmatter block', () => {
    expect(parseFrontmatter('# Just a heading\n')).toEqual({});
  });

  it('returns {} when the opening fence is not on the first line', () => {
    expect(parseFrontmatter('\n---\nname: x\n---')).toEqual({});
  });

  it('ignores keys other than name/description', () => {
    const md = ['---', 'name: a', 'version: 2', 'description: b', '---'].join('\n');
    expect(parseFrontmatter(md)).toEqual({ name: 'a', description: 'b' });
  });

  it('returns partial result when description is missing', () => {
    const md = ['---', 'name: only-name', '---'].join('\n');
    expect(parseFrontmatter(md)).toEqual({ name: 'only-name' });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run server/domain/skills/frontmatter.test.ts`
Expected: FAIL — `parseFrontmatter` is not defined / module not found.

- [ ] **Step 3: Write minimal implementation**

```ts
export interface Frontmatter {
  name?: string;
  description?: string;
}

const FENCE = '---';

/**
 * Parse the leading YAML frontmatter of a Markdown document, restricted to the
 * `name` and `description` scalar keys. Intentionally tiny — no nested YAML, no
 * new dependency. Returns {} when there is no well-formed leading block.
 */
export function parseFrontmatter(md: string): Frontmatter {
  const lines = md.split(/\r?\n/);
  if (lines[0]?.trim() !== FENCE) return {};
  const end = lines.indexOf(FENCE, 1);
  if (end === -1) return {};

  const out: Frontmatter = {};
  for (let i = 1; i < end; i++) {
    const line = lines[i];
    const sep = line.indexOf(':');
    if (sep === -1) continue;
    const key = line.slice(0, sep).trim();
    if (key !== 'name' && key !== 'description') continue;
    const value = unquote(line.slice(sep + 1).trim());
    if (value) out[key] = value;
  }
  return out;
}

function unquote(s: string): string {
  if (s.length >= 2 && ((s[0] === '"' && s.at(-1) === '"') || (s[0] === "'" && s.at(-1) === "'"))) {
    return s.slice(1, -1);
  }
  return s;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run server/domain/skills/frontmatter.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add server/domain/skills/frontmatter.ts server/domain/skills/frontmatter.test.ts
git commit -m "feat(skills): YAML frontmatter parser"
```

---

### Task 5: Discovery (scan skills dir + drafts dir)

**Files:**
- Create: `server/domain/skills/discovery.ts`
- Test: `server/domain/skills/discovery.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { discoverMaterialDirs, discoverDraftDirs } from './discovery';

function makeSkill(root: string, slug: string, frontmatter: string | null): void {
  const dir = path.join(root, slug);
  mkdirSync(dir, { recursive: true });
  if (frontmatter !== null) writeFileSync(path.join(dir, 'SKILL.md'), frontmatter);
}

let root: string;
beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), 'skills-'));
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('discoverMaterialDirs', () => {
  it('returns [] when the skills dir does not exist', () => {
    expect(discoverMaterialDirs(path.join(root, 'nope'))).toEqual([]);
  });

  it('discovers a valid skill with name+description', () => {
    makeSkill(root, 'alpha', '---\nname: alpha\ndescription: First\n---\n# A');
    expect(discoverMaterialDirs(root)).toEqual([
      { name: 'alpha', description: 'First', invalid: undefined },
    ]);
  });

  it('marks a dir without SKILL.md invalid', () => {
    mkdirSync(path.join(root, 'beta'));
    const [s] = discoverMaterialDirs(root);
    expect(s.name).toBe('beta');
    expect(s.invalid).toMatch(/SKILL\.md/);
  });

  it('marks a dir invalid when frontmatter lacks name or description', () => {
    makeSkill(root, 'gamma', '---\nname: gamma\n---\n');
    const [s] = discoverMaterialDirs(root);
    expect(s.invalid).toMatch(/description/);
  });

  it('marks a dir invalid when frontmatter name != directory name', () => {
    makeSkill(root, 'delta', '---\nname: wrong\ndescription: d\n---\n');
    const [s] = discoverMaterialDirs(root);
    expect(s.invalid).toMatch(/match/);
  });

  it('skips dot-directories (e.g. .drafts) and files', () => {
    makeSkill(root, '.drafts', null);
    writeFileSync(path.join(root, 'README.md'), 'x');
    makeSkill(root, 'eps', '---\nname: eps\ndescription: e\n---\n');
    expect(discoverMaterialDirs(root).map((s) => s.name)).toEqual(['eps']);
  });

  it('sorts results by name', () => {
    makeSkill(root, 'zeta', '---\nname: zeta\ndescription: z\n---\n');
    makeSkill(root, 'alpha', '---\nname: alpha\ndescription: a\n---\n');
    expect(discoverMaterialDirs(root).map((s) => s.name)).toEqual(['alpha', 'zeta']);
  });
});

describe('discoverDraftDirs', () => {
  it('returns [] when .drafts does not exist', () => {
    expect(discoverDraftDirs(root)).toEqual([]);
  });

  it('discovers draft directories under .drafts', () => {
    const drafts = path.join(root, '.drafts');
    makeSkill(drafts, 'wip', '---\nname: wip\ndescription: W\n---\n');
    expect(discoverDraftDirs(root)).toEqual([
      { name: 'wip', description: 'W', invalid: undefined },
    ]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run server/domain/skills/discovery.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```ts
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { parseFrontmatter } from './frontmatter';

export interface DiscoveredSkill {
  name: string;
  description?: string;
  invalid?: string;
}

/** Validate one directory as a skill, returning a DiscoveredSkill. */
function inspect(dir: string, slug: string): DiscoveredSkill {
  const skillMd = path.join(dir, 'SKILL.md');
  if (!existsSync(skillMd)) {
    return { name: slug, invalid: 'Missing SKILL.md' };
  }
  const fm = parseFrontmatter(readFileSync(skillMd, 'utf8'));
  if (!fm.name || !fm.description) {
    return { name: slug, invalid: 'SKILL.md frontmatter must set name and description' };
  }
  if (fm.name !== slug) {
    return { name: slug, invalid: `Frontmatter name "${fm.name}" must match directory name "${slug}"` };
  }
  return { name: slug, description: fm.description, invalid: undefined };
}

/** List immediate subdirectories of `parent`, excluding dot-directories. */
function subdirs(parent: string): string[] {
  if (!existsSync(parent)) return [];
  return readdirSync(parent, { withFileTypes: true })
    .filter((e) => e.isDirectory() && !e.name.startsWith('.'))
    .map((e) => e.name)
    .sort();
}

/** Discover material skills under the skills dir (dot-dirs like .drafts excluded). */
export function discoverMaterialDirs(skillsDir: string): DiscoveredSkill[] {
  return subdirs(skillsDir).map((slug) => inspect(path.join(skillsDir, slug), slug));
}

/** Discover draft skills under skillsDir/.drafts. */
export function discoverDraftDirs(skillsDir: string): DiscoveredSkill[] {
  const drafts = path.join(skillsDir, '.drafts');
  return subdirs(drafts).map((slug) => inspect(path.join(drafts, slug), slug));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run server/domain/skills/discovery.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/domain/skills/discovery.ts server/domain/skills/discovery.test.ts
git commit -m "feat(skills): filesystem discovery for skills and drafts"
```

---

## Phase B — State store & service

### Task 6: `SkillStateStore`

**Files:**
- Create: `server/domain/skills/skill-state.store.ts`
- Test: `server/domain/skills/skill-state.store.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { SkillStateStore } from './skill-state.store';
import { makeTestDb } from '@/server/test/test-db';
import type { DatabaseHandle } from '@/server/db/database';

let db: DatabaseHandle;
let store: SkillStateStore;

beforeEach(() => {
  db = makeTestDb();
  store = new SkillStateStore(db);
});
afterEach(() => db.close());

describe('SkillStateStore', () => {
  it('returns defaults (disabled, unpinned) for an unknown slug', () => {
    expect(store.get('ghost')).toEqual({ slug: 'ghost', enabled: false, pinned: false });
  });

  it('setEnabled upserts and persists', () => {
    store.setEnabled('alpha', true);
    expect(store.get('alpha')).toEqual({ slug: 'alpha', enabled: true, pinned: false });
  });

  it('setPinned upserts and persists independently of enabled', () => {
    store.setPinned('alpha', true);
    expect(store.get('alpha')).toEqual({ slug: 'alpha', enabled: false, pinned: true });
  });

  it('setEnabled then setPinned preserves both flags', () => {
    store.setEnabled('alpha', true);
    store.setPinned('alpha', true);
    expect(store.get('alpha')).toEqual({ slug: 'alpha', enabled: true, pinned: true });
  });

  it('readAll returns a map of all known rows', () => {
    store.setEnabled('a', true);
    store.setPinned('b', true);
    const all = store.readAll();
    expect(all.get('a')).toEqual({ slug: 'a', enabled: true, pinned: false });
    expect(all.get('b')).toEqual({ slug: 'b', enabled: false, pinned: true });
  });

  it('remove deletes the row', () => {
    store.setEnabled('a', true);
    store.remove('a');
    expect(store.get('a')).toEqual({ slug: 'a', enabled: false, pinned: false });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run server/domain/skills/skill-state.store.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```ts
import type { DatabaseHandle } from '@/server/db/database';
import type { SkillStateRow } from './skills.types';

interface Row {
  slug: string;
  enabled: number;
  pinned: number;
}

/** Persists the enabled/pinned toggle state of material (filesystem) skills. */
export class SkillStateStore {
  constructor(private readonly db: DatabaseHandle) {}

  get(slug: string): SkillStateRow {
    const row = this.db
      .prepare('SELECT slug, enabled, pinned FROM skill_state WHERE slug = ?')
      .get(slug) as Row | undefined;
    if (!row) return { slug, enabled: false, pinned: false };
    return { slug, enabled: row.enabled === 1, pinned: row.pinned === 1 };
  }

  readAll(): Map<string, SkillStateRow> {
    const rows = this.db.prepare('SELECT slug, enabled, pinned FROM skill_state').all() as Row[];
    const map = new Map<string, SkillStateRow>();
    for (const r of rows) {
      map.set(r.slug, { slug: r.slug, enabled: r.enabled === 1, pinned: r.pinned === 1 });
    }
    return map;
  }

  setEnabled(slug: string, enabled: boolean): void {
    this.upsert(slug, { enabled });
  }

  setPinned(slug: string, pinned: boolean): void {
    this.upsert(slug, { pinned });
  }

  remove(slug: string): void {
    this.db.prepare('DELETE FROM skill_state WHERE slug = ?').run(slug);
  }

  private upsert(slug: string, patch: { enabled?: boolean; pinned?: boolean }): void {
    const cur = this.get(slug);
    const enabled = patch.enabled ?? cur.enabled;
    const pinned = patch.pinned ?? cur.pinned;
    this.db
      .prepare(
        `INSERT INTO skill_state (slug, enabled, pinned) VALUES (?, ?, ?)
         ON CONFLICT(slug) DO UPDATE SET enabled = excluded.enabled, pinned = excluded.pinned`,
      )
      .run(slug, enabled ? 1 : 0, pinned ? 1 : 0);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run server/domain/skills/skill-state.store.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/domain/skills/skill-state.store.ts server/domain/skills/skill-state.store.test.ts
git commit -m "feat(skills): skill_state store"
```

---

### Task 7: `SkillsService` — list, toggle, pin, getActiveForPrompt

**Files:**
- Create: `server/domain/skills/skills.service.ts`
- Test: `server/domain/skills/skills.service.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { SkillsService } from './skills.service';
import { SkillStateStore } from './skill-state.store';
import { makeTestDb } from '@/server/test/test-db';
import type { DatabaseHandle } from '@/server/db/database';

function makeSkill(root: string, slug: string, description: string): void {
  const dir = path.join(root, slug);
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, 'SKILL.md'), `---\nname: ${slug}\ndescription: ${description}\n---\n# ${slug}`);
}

let db: DatabaseHandle;
let dataDir: string;
let skillsDir: string;
let service: SkillsService;

beforeEach(() => {
  db = makeTestDb();
  dataDir = mkdtempSync(path.join(tmpdir(), 'data-'));
  skillsDir = path.join(dataDir, 'skills');
  mkdirSync(skillsDir, { recursive: true });
  service = new SkillsService(new SkillStateStore(db), dataDir);
});
afterEach(() => {
  db.close();
  rmSync(dataDir, { recursive: true, force: true });
});

describe('SkillsService.list', () => {
  it('merges discovered skills with their stored state (default disabled)', () => {
    makeSkill(skillsDir, 'alpha', 'First');
    const { skills } = service.list();
    expect(skills).toEqual([
      { name: 'alpha', enabled: false, pinned: false, description: 'First', invalid: undefined },
    ]);
  });

  it('reflects enabled/pinned state', () => {
    makeSkill(skillsDir, 'alpha', 'First');
    service.setEnabled('alpha', true);
    service.setPinned('alpha', true);
    expect(service.list().skills[0]).toMatchObject({ name: 'alpha', enabled: true, pinned: true });
  });

  it('includes invalid skills but never marks them enabled', () => {
    mkdirSync(path.join(skillsDir, 'broken'));
    const [s] = service.list().skills;
    expect(s.invalid).toBeTruthy();
    expect(s.enabled).toBe(false);
  });

  it('lists drafts from .drafts', () => {
    makeSkill(path.join(skillsDir, '.drafts'), 'wip', 'Work');
    expect(service.list().drafts).toEqual([{ name: 'wip', description: 'Work', invalid: undefined }]);
  });
});

describe('SkillsService.getActiveForPrompt', () => {
  it('returns only enabled + valid skills with absolute dir', () => {
    makeSkill(skillsDir, 'alpha', 'First');
    makeSkill(skillsDir, 'beta', 'Second');
    service.setEnabled('alpha', true);
    const active = service.getActiveForPrompt();
    expect(active).toEqual([
      { name: 'alpha', description: 'First', pinned: false, dir: path.join(skillsDir, 'alpha'), body: undefined },
    ]);
  });

  it('includes the SKILL.md body only when pinned', () => {
    makeSkill(skillsDir, 'alpha', 'First');
    service.setEnabled('alpha', true);
    service.setPinned('alpha', true);
    const [a] = service.getActiveForPrompt();
    expect(a.body).toContain('# alpha');
  });
});

describe('SkillsService.promote', () => {
  it('moves a draft into the skills dir (disabled)', () => {
    makeSkill(path.join(skillsDir, '.drafts'), 'wip', 'Work');
    service.promote('wip');
    expect(service.list().skills.map((s) => s.name)).toContain('wip');
    expect(service.list().drafts).toEqual([]);
  });

  it('throws when a skill with the same slug already exists', () => {
    makeSkill(skillsDir, 'wip', 'Existing');
    makeSkill(path.join(skillsDir, '.drafts'), 'wip', 'Draft');
    expect(() => service.promote('wip')).toThrow(/exists/i);
  });

  it('throws when the draft is invalid', () => {
    mkdirSync(path.join(skillsDir, '.drafts', 'bad'), { recursive: true });
    expect(() => service.promote('bad')).toThrow(/invalid/i);
  });
});

describe('SkillsService.remove', () => {
  it('deletes the directory and the state row', () => {
    makeSkill(skillsDir, 'alpha', 'First');
    service.setEnabled('alpha', true);
    service.remove('alpha');
    expect(service.list().skills).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run server/domain/skills/skills.service.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```ts
import { existsSync, readFileSync, renameSync, rmSync } from 'node:fs';
import path from 'node:path';
import { ValidationError, NotFoundError } from '@/server/lib/errors';
import { discoverMaterialDirs, discoverDraftDirs } from './discovery';
import { skillsDirFor } from './skills.paths';
import type { SkillStateStore } from './skill-state.store';
import type { MaterialSkill, DraftSkill, SkillsList, PromptMaterialSkill } from './skills.types';

export class SkillsService {
  private readonly skillsDir: string;

  constructor(
    private readonly state: SkillStateStore,
    dataDir: string,
  ) {
    this.skillsDir = skillsDirFor(dataDir);
  }

  list(): SkillsList {
    const stateMap = this.state.readAll();
    const skills: MaterialSkill[] = discoverMaterialDirs(this.skillsDir).map((d) => {
      const st = stateMap.get(d.name);
      const valid = !d.invalid;
      return {
        name: d.name,
        description: d.description,
        invalid: d.invalid,
        enabled: valid ? (st?.enabled ?? false) : false,
        pinned: valid ? (st?.pinned ?? false) : false,
      };
    });
    const drafts: DraftSkill[] = discoverDraftDirs(this.skillsDir);
    return { skills, drafts };
  }

  setEnabled(slug: string, enabled: boolean): void {
    this.requireValid(slug);
    this.state.setEnabled(slug, enabled);
  }

  setPinned(slug: string, pinned: boolean): void {
    this.requireValid(slug);
    this.state.setPinned(slug, pinned);
  }

  getActiveForPrompt(): PromptMaterialSkill[] {
    return this.list()
      .skills.filter((s) => s.enabled && !s.invalid)
      .map((s) => {
        const dir = path.join(this.skillsDir, s.name);
        return {
          name: s.name,
          description: s.description ?? '',
          pinned: s.pinned,
          dir,
          body: s.pinned ? readFileSync(path.join(dir, 'SKILL.md'), 'utf8') : undefined,
        };
      });
  }

  promote(slug: string): void {
    const draft = discoverDraftDirs(this.skillsDir).find((d) => d.name === slug);
    if (!draft) throw new NotFoundError(`draft ${slug}`);
    if (draft.invalid) throw new ValidationError(`Draft "${slug}" is invalid: ${draft.invalid}`);
    const dest = path.join(this.skillsDir, slug);
    if (existsSync(dest)) throw new ValidationError(`A skill named "${slug}" already exists`);
    renameSync(path.join(this.skillsDir, '.drafts', slug), dest);
  }

  remove(slug: string): void {
    const dir = path.join(this.skillsDir, slug);
    if (!existsSync(dir)) throw new NotFoundError(`skill ${slug}`);
    rmSync(dir, { recursive: true, force: true });
    this.state.remove(slug);
  }

  private requireValid(slug: string): void {
    const found = this.list().skills.find((s) => s.name === slug);
    if (!found) throw new NotFoundError(`skill ${slug}`);
    if (found.invalid) throw new ValidationError(`Skill "${slug}" is invalid: ${found.invalid}`);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run server/domain/skills/skills.service.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/domain/skills/skills.service.ts server/domain/skills/skills.service.test.ts
git commit -m "feat(skills): SkillsService (list/toggle/pin/promote/remove/getActiveForPrompt)"
```

---

## Phase C — Default skills + seeding

### Task 8: Bundle the two default skills

**Files:**
- Create: `server/skills/defaults/brainstorming/SKILL.md`
- Create: `server/skills/defaults/skill-creator/SKILL.md`

> These are complete, valid skill files (frontmatter `name` matches the directory). The bodies below are self-contained and usable. They can later be enriched with the fuller upstream superpowers/skill-creator text without changing any code.

- [ ] **Step 1: Write `brainstorming/SKILL.md`**

```markdown
---
name: brainstorming
description: Turn a rough idea into a validated design through one-question-at-a-time dialogue before any implementation. Use when deciding what a new skill or feature should do.
---

# Brainstorming Ideas Into Designs

Help turn an idea into a fully formed design through collaborative dialogue.

## Process
1. Explore the current context first (files, goals, constraints).
2. Ask clarifying questions ONE at a time. Prefer multiple-choice. Focus on purpose, constraints, and success criteria.
3. Propose 2-3 approaches with trade-offs and a recommendation.
4. Present the design in sections scaled to their complexity; get approval on each.
5. Only after approval, hand off to implementation.

## Principles
- One question at a time — do not overwhelm.
- YAGNI: cut unnecessary features.
- Always explore alternatives before settling.
- Validate incrementally: present, get approval, move on.
```

- [ ] **Step 2: Write `skill-creator/SKILL.md`**

```markdown
---
name: skill-creator
description: Create a new, self-contained skill — a directory with a SKILL.md plus any referenced resources, reference docs, and scripts. Use when generating a skill's files from an agreed design.
---

# Skill Creator

Generate a self-contained skill directory from an agreed design.

## What a skill is
A directory whose entry point is `SKILL.md`. The SKILL.md has YAML frontmatter
with `name` (must equal the directory name) and `description`, followed by the
instructions. It may reference sibling files: `resources/`, `references/`,
`scripts/`. Everything the skill needs must live inside its own directory.

## Procedure
1. Choose a kebab-case slug; create `<slug>/`.
2. Write `<slug>/SKILL.md` with frontmatter (`name: <slug>`, a one-line
   `description` that states WHEN to use it) and a focused body.
3. Add only the resources the skill actually needs; reference them by relative path.
4. Keep the SKILL.md tight — push depth into referenced files for progressive disclosure.

## Quality bar
- `name` in frontmatter matches the directory name exactly.
- `description` is specific about when the skill applies (triggers).
- No external/absolute paths — the directory is self-contained.
```

- [ ] **Step 3: Verify both parse as valid skills**

Run: `npx vitest run server/domain/skills/discovery.test.ts`
Expected: PASS (existing tests still green — this step just confirms nothing broke; the files are exercised by the seed test in Task 9).

- [ ] **Step 4: Commit**

```bash
git add server/skills/defaults
git commit -m "feat(skills): bundle default brainstorming + skill-creator skills"
```

---

### Task 9: Seed defaults into the data dir

**Files:**
- Create: `server/domain/skills/seed.ts`
- Test: `server/domain/skills/seed.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { seedDefaultSkills } from './seed';

let defaults: string;
let skillsDir: string;

beforeEach(() => {
  const base = mkdtempSync(path.join(tmpdir(), 'seed-'));
  defaults = path.join(base, 'defaults');
  skillsDir = path.join(base, 'skills');
  mkdirSync(path.join(defaults, 'brainstorming'), { recursive: true });
  writeFileSync(path.join(defaults, 'brainstorming', 'SKILL.md'), '---\nname: brainstorming\ndescription: d\n---\n');
});
afterEach(() => {
  rmSync(path.dirname(defaults), { recursive: true, force: true });
});

describe('seedDefaultSkills', () => {
  it('copies default skills into an empty skills dir', () => {
    seedDefaultSkills(defaults, skillsDir);
    expect(existsSync(path.join(skillsDir, 'brainstorming', 'SKILL.md'))).toBe(true);
  });

  it('does NOT overwrite an existing skill of the same slug', () => {
    mkdirSync(path.join(skillsDir, 'brainstorming'), { recursive: true });
    writeFileSync(path.join(skillsDir, 'brainstorming', 'SKILL.md'), 'USER EDIT');
    seedDefaultSkills(defaults, skillsDir);
    expect(readFileSync(path.join(skillsDir, 'brainstorming', 'SKILL.md'), 'utf8')).toBe('USER EDIT');
  });

  it('is a no-op (no throw) when the defaults dir is missing', () => {
    expect(() => seedDefaultSkills(path.join(defaults, 'nope'), skillsDir)).not.toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run server/domain/skills/seed.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```ts
import { existsSync, mkdirSync, readdirSync, cpSync } from 'node:fs';
import path from 'node:path';

/**
 * Copy bundled default skills into the data dir's skills folder. Idempotent and
 * non-destructive: a default is copied only when no directory of the same slug
 * already exists (user edits and removals are preserved). No-op when the
 * defaults dir is absent (e.g. a stripped deployment).
 */
export function seedDefaultSkills(defaultsDir: string, skillsDir: string): void {
  if (!existsSync(defaultsDir)) return;
  mkdirSync(skillsDir, { recursive: true });
  for (const entry of readdirSync(defaultsDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const dest = path.join(skillsDir, entry.name);
    if (existsSync(dest)) continue;
    cpSync(path.join(defaultsDir, entry.name), dest, { recursive: true });
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run server/domain/skills/seed.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/domain/skills/seed.ts server/domain/skills/seed.test.ts
git commit -m "feat(skills): idempotent default-skills seeding"
```

---

### Task 10: Ship defaults to the prod bundle

**Files:**
- Modify: `package.json` (the `build` script)

- [ ] **Step 1: Append the copy step to the build script**

In `package.json`, the `build` script currently ends with:
```
&& rm -rf dist/db/migrations && mkdir -p dist/db && cp -R server/db/migrations dist/db/
```
Append (mirrors how migrations ship; runtime resolves `dist/skills/defaults` via `defaultsDir()`):
```
&& rm -rf dist/skills && mkdir -p dist/skills && cp -R server/skills/defaults dist/skills/
```

So the tail becomes:
```
... cp -R server/db/migrations dist/db/ && rm -rf dist/skills && mkdir -p dist/skills && cp -R server/skills/defaults dist/skills/
```

- [ ] **Step 2: Verify the build produces the assets**

Run: `npm run build && ls dist/skills/defaults`
Expected: directory listing shows `brainstorming` and `skill-creator`.

- [ ] **Step 3: Commit**

```bash
git add package.json
git commit -m "build(skills): copy default skills into dist"
```

---

## Phase D — Prompt assembly (hybrid consumption)

### Task 11: Hybrid skills block in the prompt assembler

**Files:**
- Modify: `server/domain/dispatch/prompt-assembler.ts`
- Test: `server/domain/dispatch/prompt-assembler.test.ts` (create if absent; otherwise append)

- [ ] **Step 1: Write the failing test**

```ts
import { assemble } from './prompt-assembler';
import type { AetherContext } from '@/server/domain/context/context.types';
import type { PromptMaterialSkill } from '@/server/domain/skills/skills.types';

const baseCtx: AetherContext = {
  systemInstruction: 'You are Aether.',
  skills: [{ name: 'legacy-a', enabled: true }, { name: 'legacy-off', enabled: false }],
  tools: [],
  mcpServers: [],
};

describe('assemble — hybrid skills', () => {
  it('renders only enabled label skills when no material skills (unchanged behavior)', () => {
    const out = assemble(baseCtx, null, 'hi', null);
    expect(out.systemInstruction).toContain('# Active Skills');
    expect(out.systemInstruction).toContain('- legacy-a');
    expect(out.systemInstruction).not.toContain('legacy-off');
  });

  it('renders a non-pinned material skill as name: description plus a read-from-disk note', () => {
    const material: PromptMaterialSkill[] = [
      { name: 'pdf', description: 'Work with PDFs', pinned: false, dir: '/data/skills/pdf', body: undefined },
    ];
    const out = assemble(baseCtx, null, 'hi', null, [], material);
    expect(out.systemInstruction).toContain('- pdf: Work with PDFs');
    expect(out.systemInstruction).toContain('/data/skills/pdf/SKILL.md');
    expect(out.systemInstruction).not.toContain('## Skill: pdf');
  });

  it('inlines the full SKILL.md body for a pinned material skill', () => {
    const material: PromptMaterialSkill[] = [
      { name: 'pdf', description: 'Work with PDFs', pinned: true, dir: '/data/skills/pdf', body: '# PDF\nUse pdfplumber.' },
    ];
    const out = assemble(baseCtx, null, 'hi', null, [], material);
    expect(out.systemInstruction).toContain('## Skill: pdf');
    expect(out.systemInstruction).toContain('Use pdfplumber.');
  });

  it('includes material skill names in the returned skills array', () => {
    const material: PromptMaterialSkill[] = [
      { name: 'pdf', description: 'd', pinned: false, dir: '/d/pdf', body: undefined },
    ];
    const out = assemble(baseCtx, null, 'hi', null, [], material);
    expect(out.skills).toEqual(['legacy-a', 'pdf']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run server/domain/dispatch/prompt-assembler.test.ts`
Expected: FAIL — `assemble` does not accept a 6th argument / output lacks the material rendering.

- [ ] **Step 3: Edit `prompt-assembler.ts`**

Replace the imports block, `withSkillsBlock`, and `assemble` as follows. Add the import:
```ts
import type { PromptMaterialSkill } from '@/server/domain/skills/skills.types';
```

Replace `withSkillsBlock` with `buildSkillsBlock` + a new `withSkillsBlock`:
```ts
function buildSkillsBlock(labelNames: string[], material: PromptMaterialSkill[]): string {
  if (labelNames.length === 0 && material.length === 0) return '';
  const nonPinned = material.filter((m) => !m.pinned);
  const pinned = material.filter((m) => m.pinned);

  const header: string[] = ['# Active Skills'];
  for (const n of labelNames) header.push(`- ${n}`);
  for (const m of nonPinned) header.push(`- ${m.name}: ${m.description}`);
  const parts: string[] = [header.join('\n')];

  if (nonPinned.length > 0) {
    const list = nonPinned.map((m) => `- ${m.name}: ${m.dir}/SKILL.md`).join('\n');
    parts.push(
      'For the skills above with a description, the full instructions and any referenced ' +
        'files live on disk. When a skill is relevant, read its SKILL.md (and the files it ' +
        'points to) via the filesystem before acting:\n' +
        list,
    );
  }
  for (const m of pinned) {
    parts.push(`## Skill: ${m.name}\n\n${(m.body ?? '').trim()}`);
  }
  return parts.join('\n\n');
}

function withSkillsBlock(
  systemInstruction: string,
  labelNames: string[],
  material: PromptMaterialSkill[],
): string {
  const block = buildSkillsBlock(labelNames, material);
  if (!block) return systemInstruction;
  return [systemInstruction.trim(), block].filter(Boolean).join('\n\n');
}
```

Replace `assemble` to thread material skills through and add them to the returned `skills`:
```ts
export function assemble(
  ctx: AetherContext,
  subAgent: SubAgentRecord | null,
  parsedMessage: string,
  resolvedName: string | null,
  mcpTools: ProviderToolDecl[] = [],
  materialSkills: PromptMaterialSkill[] = [],
): AssembledPrompt {
  const materialNames = materialSkills.map((m) => m.name);
  if (!subAgent) {
    const labels = activeSkillNames(ctx.skills);
    return {
      systemInstruction: withSkillsBlock(ctx.systemInstruction, labels, materialSkills),
      skills: dedupStrings([...labels, ...materialNames]),
      tools: ctx.tools,
      message: parsedMessage,
      subAgent: null,
      mcpTools,
    };
  }
  const baseSys = [
    ctx.systemInstruction.trim(),
    `# Sub-agent: ${subAgent.name}`,
    subAgent.systemInstruction.trim(),
  ]
    .filter(Boolean)
    .join('\n\n');
  const labels = dedupStrings([...activeSkillNames(ctx.skills), ...subAgent.skills]);
  const tools = dedupToolsById([...ctx.tools, ...subAgent.tools]);
  return {
    systemInstruction: withSkillsBlock(baseSys, labels, materialSkills),
    skills: dedupStrings([...labels, ...materialNames]),
    tools,
    message: parsedMessage,
    subAgent: resolvedName,
    mcpTools,
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run server/domain/dispatch/prompt-assembler.test.ts`
Expected: PASS.

- [ ] **Step 5: Run the dispatch suite to confirm no regressions**

Run: `npx vitest run server/domain/dispatch`
Expected: PASS (existing `assemble` callers unaffected — the new param defaults to `[]`).

- [ ] **Step 6: Commit**

```bash
git add server/domain/dispatch/prompt-assembler.ts server/domain/dispatch/prompt-assembler.test.ts
git commit -m "feat(skills): hybrid progressive-disclosure block in prompt assembler"
```

---

### Task 12: Feed active material skills from DispatchService

**Files:**
- Modify: `server/domain/dispatch/dispatch.service.ts`
- Test: `server/domain/dispatch/dispatch.service.test.ts` (append one test)

- [ ] **Step 1: Write the failing test**

Append inside the existing `describe('DispatchService', ...)`. It wires a stub `skillsService` and asserts its active material skill reaches the assembled system instruction. Use the existing `makeService` helper but extend it to accept a `skillsService`:

```ts
it('injects active material skills into the system instruction', async () => {
  const skillsService = {
    getActiveForPrompt: () => [
      { name: 'pdf', description: 'Work with PDFs', pinned: false, dir: '/d/pdf', body: undefined },
    ],
  };
  const { service, sessionId, contextStore } = await makeService({ chunks: ['ok'] });
  // makeService must pass skillsService into new DispatchService({ ..., skillsService })
  // (see Step 3). Spy on the provider to capture the system instruction:
  const seen: string[] = [];
  service._captureSystemInstruction = (s: string) => seen.push(s);
  void contextStore;
  const { emitter } = createCollectorEmitter();
  await service.handle({ sessionId, message: 'hi', skillsService } as never, emitter, new AbortController().signal);
  expect(seen.join('\n')).toContain('- pdf: Work with PDFs');
});
```

> NOTE for the implementer: the exact capture mechanism depends on how the existing tests assert the provider request. Prefer reusing the test's existing way of inspecting the `ProviderRequest.systemInstruction` (e.g. the FakeProvider records the last request, or a spy). Replace the `_captureSystemInstruction` placeholder with that existing mechanism — do not add new production hooks just for the test. If the FakeProvider already exposes the last request, assert on `provider.lastRequest.systemInstruction`.

- [ ] **Step 2: Inspect how the existing suite captures the provider request**

Run: `npx vitest run server/domain/dispatch/dispatch.service.test.ts -t "system"` and read `server/domain/dispatch/providers/fake.provider.ts`.
Expected: identify the existing way the system instruction / provider request is observable, and rewrite the Step 1 assertion to use it. Run the test to confirm it FAILS (material skill not yet injected).

- [ ] **Step 3: Wire `SkillsService` into `DispatchService`**

In `dispatch.service.ts`:
1. Add to the deps interface (`DispatchServiceDeps`) an optional field:
```ts
skillsService?: { getActiveForPrompt(): import('@/server/domain/skills/skills.types').PromptMaterialSkill[] };
```
2. Store it on the instance in the constructor (mirror the other deps).
3. Where it currently calls `assemble(...)`, compute and pass material skills:
```ts
const materialSkills = this.skillsService?.getActiveForPrompt() ?? [];
const assembled = assemble(context, matchedSubAgent, effectiveStripped, mention.name, mcpToolDecls, materialSkills);
```
(Use the actual local variable names already present at the existing `assemble(...)` call site — keep every existing argument identical, only append `materialSkills`.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run server/domain/dispatch/dispatch.service.test.ts`
Expected: PASS (new test green; all prior tests still green since `skillsService` is optional and defaults to no material skills).

- [ ] **Step 5: Commit**

```bash
git add server/domain/dispatch/dispatch.service.ts server/domain/dispatch/dispatch.service.test.ts
git commit -m "feat(skills): dispatch feeds active material skills to the assembler"
```

---

## Phase E — Routes & wiring

### Task 13: `/api/skills` routes

**Files:**
- Create: `server/routes/skills.routes.ts`
- Test: `server/routes/skills.routes.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import express from 'express';
import request from 'supertest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createSkillsRoutes } from './skills.routes';
import { SkillsService } from '@/server/domain/skills/skills.service';
import { SkillStateStore } from '@/server/domain/skills/skill-state.store';
import { makeTestDb } from '@/server/test/test-db';
import { errorMiddleware } from '@/server/lib/error-middleware'; // if the project exposes one; else inline (see note)

function makeSkill(root: string, slug: string, description: string): void {
  const dir = path.join(root, slug);
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, 'SKILL.md'), `---\nname: ${slug}\ndescription: ${description}\n---\n# ${slug}`);
}

function makeApp(dataDir: string) {
  const db = makeTestDb();
  const service = new SkillsService(new SkillStateStore(db), dataDir);
  const app = express();
  app.use(express.json());
  app.use('/api/skills', createSkillsRoutes(service));
  // Error middleware: mirror server/app.ts. If no shared export exists, copy the
  // 10-line middleware from server/app.ts here.
  app.use((err: any, _req: any, res: any, _next: any) => {
    const status = typeof err?.status === 'number' ? err.status : 500;
    res.status(status).json({ error: { code: err?.code ?? 'INTERNAL', message: err?.message } });
  });
  return { app, db };
}

let dataDir: string;
beforeEach(() => {
  dataDir = mkdtempSync(path.join(tmpdir(), 'data-'));
  mkdirSync(path.join(dataDir, 'skills'), { recursive: true });
});
afterEach(() => rmSync(dataDir, { recursive: true, force: true }));

describe('skills routes', () => {
  it('GET /api/skills returns skills + drafts', async () => {
    makeSkill(path.join(dataDir, 'skills'), 'alpha', 'First');
    const { app } = makeApp(dataDir);
    const res = await request(app).get('/api/skills');
    expect(res.status).toBe(200);
    expect(res.body.skills[0]).toMatchObject({ name: 'alpha', enabled: false });
    expect(res.body.drafts).toEqual([]);
  });

  it('PATCH /api/skills/:slug/enabled toggles', async () => {
    makeSkill(path.join(dataDir, 'skills'), 'alpha', 'First');
    const { app } = makeApp(dataDir);
    const res = await request(app).patch('/api/skills/alpha/enabled').send({ enabled: true });
    expect(res.status).toBe(200);
    const list = await request(app).get('/api/skills');
    expect(list.body.skills[0].enabled).toBe(true);
  });

  it('PATCH /api/skills/:slug/pinned toggles', async () => {
    makeSkill(path.join(dataDir, 'skills'), 'alpha', 'First');
    const { app } = makeApp(dataDir);
    const res = await request(app).patch('/api/skills/alpha/pinned').send({ pinned: true });
    expect(res.status).toBe(200);
  });

  it('400 on invalid body', async () => {
    makeSkill(path.join(dataDir, 'skills'), 'alpha', 'First');
    const { app } = makeApp(dataDir);
    const res = await request(app).patch('/api/skills/alpha/enabled').send({ enabled: 'yes' });
    expect(res.status).toBe(400);
  });

  it('POST /api/skills/promote moves a draft', async () => {
    makeSkill(path.join(dataDir, 'skills', '.drafts'), 'wip', 'Work');
    const { app } = makeApp(dataDir);
    const res = await request(app).post('/api/skills/promote').send({ slug: 'wip' });
    expect(res.status).toBe(200);
    const list = await request(app).get('/api/skills');
    expect(list.body.skills.map((s: any) => s.name)).toContain('wip');
  });

  it('DELETE /api/skills/:slug removes', async () => {
    makeSkill(path.join(dataDir, 'skills'), 'alpha', 'First');
    const { app } = makeApp(dataDir);
    const res = await request(app).delete('/api/skills/alpha');
    expect(res.status).toBe(204);
  });
});
```

> NOTE: check whether the repo already has a reusable error middleware export. The exploration showed it inlined in `server/app.ts` (lines ~190-203). If there is no shared export, copy that middleware inline in the test (as above) and in `makeApp`. Do NOT create a new production module for it in this plan.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run server/routes/skills.routes.test.ts`
Expected: FAIL — `createSkillsRoutes` not found.

- [ ] **Step 3: Write minimal implementation**

```ts
import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { ValidationError } from '@/server/lib/errors';
import type { SkillsService } from '@/server/domain/skills/skills.service';

function asyncHandler(fn: (req: Request, res: Response, next: NextFunction) => Promise<void>) {
  return (req: Request, res: Response, next: NextFunction) => {
    fn(req, res, next).catch(next);
  };
}

const EnabledBody = z.object({ enabled: z.boolean() });
const PinnedBody = z.object({ pinned: z.boolean() });
const PromoteBody = z.object({ slug: z.string().min(1) });

export function createSkillsRoutes(service: SkillsService): Router {
  const router = Router();

  router.get(
    '/',
    asyncHandler(async (_req, res) => {
      res.json(service.list());
    }),
  );

  router.patch(
    '/:slug/enabled',
    asyncHandler(async (req, res) => {
      const parsed = EnabledBody.safeParse(req.body);
      if (!parsed.success) throw new ValidationError('Invalid enabled body', parsed.error);
      service.setEnabled(req.params.slug, parsed.data.enabled);
      res.json({ status: 'ok' });
    }),
  );

  router.patch(
    '/:slug/pinned',
    asyncHandler(async (req, res) => {
      const parsed = PinnedBody.safeParse(req.body);
      if (!parsed.success) throw new ValidationError('Invalid pinned body', parsed.error);
      service.setPinned(req.params.slug, parsed.data.pinned);
      res.json({ status: 'ok' });
    }),
  );

  router.post(
    '/promote',
    asyncHandler(async (req, res) => {
      const parsed = PromoteBody.safeParse(req.body);
      if (!parsed.success) throw new ValidationError('Invalid promote body', parsed.error);
      service.promote(parsed.data.slug);
      res.json({ status: 'ok' });
    }),
  );

  router.delete(
    '/:slug',
    asyncHandler(async (req, res) => {
      service.remove(req.params.slug);
      res.status(204).end();
    }),
  );

  return router;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run server/routes/skills.routes.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/routes/skills.routes.ts server/routes/skills.routes.test.ts
git commit -m "feat(skills): /api/skills routes"
```

---

### Task 14: Mount routes in `createApp`

**Files:**
- Modify: `server/app.ts`

- [ ] **Step 1: Add the dep + mount**

1. Import the factory near the other route imports:
```ts
import { createSkillsRoutes } from './routes/skills.routes';
```
2. Add to `AppDeps`:
```ts
skillsService?: import('./domain/skills/skills.service').SkillsService;
```
3. Mount near the other context/mcp routes (after the mcp mount block):
```ts
if (deps.skillsService) {
  app.use('/api/skills', createSkillsRoutes(deps.skillsService));
}
```

- [ ] **Step 2: Type-check**

Run: `npm run lint`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add server/app.ts
git commit -m "feat(skills): mount /api/skills in createApp"
```

---

### Task 15: Construct + seed + wire in `bootstrap()`

**Files:**
- Modify: `server/index.ts`

- [ ] **Step 1: Add imports**

```ts
import { SkillStateStore } from './domain/skills/skill-state.store';
import { SkillsService } from './domain/skills/skills.service';
import { seedDefaultSkills } from './domain/skills/seed';
import { defaultsDir, skillsDirFor } from './domain/skills/skills.paths';
```

- [ ] **Step 2: Seed defaults right after migrations**

Immediately after the `applyMigrations(...)` block in `bootstrap()`:
```ts
seedDefaultSkills(defaultsDir(), skillsDirFor(cfg.dataDir));
```

- [ ] **Step 3: Construct the store + service**

After `const mcpRegistry = new McpRegistry(...)` (where other stores are built):
```ts
const skillStateStore = new SkillStateStore(db);
const skillsService = new SkillsService(skillStateStore, cfg.dataDir);
```

- [ ] **Step 4: Pass into `createApp` and `DispatchService`**

1. Add `skillsService,` to the object passed to `createApp({ ... })`.
2. Find where `new DispatchService({ ... })` is constructed and add `skillsService,` to its deps (the field added in Task 12).

- [ ] **Step 5: Smoke-test boot with the Fake provider**

Run: `AETHER_FAKE_PROVIDER=1 AETHER_DATA_DIR=$(mktemp -d) timeout 8 npx tsx server/index.ts || true`
Expected: server logs startup without errors; the temp data dir gets a `skills/brainstorming/SKILL.md` and `skills/skill-creator/SKILL.md`. Verify with: `ls "$AETHER_DATA_DIR"/skills` is not practical inline — instead confirm no boot error and that Task 16 (frontend) shows the two defaults.

> If `timeout`/background launch is awkward in your environment, skip the manual smoke here and rely on Task 19's full app launch.

- [ ] **Step 6: Type-check + commit**

Run: `npm run lint`
Expected: PASS.
```bash
git add server/index.ts
git commit -m "feat(skills): construct, seed, and wire SkillsService in bootstrap"
```

---

## Phase F — Frontend

### Task 16: API client

**Files:**
- Create: `src/lib/api/skills.api.ts`

- [ ] **Step 1: Write the client**

```ts
import type { SkillsList } from '@/server/domain/skills/skills.types';

async function jsonRes<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.error?.message ?? res.statusText);
  }
  return res.json() as Promise<T>;
}

export const skillsApi = {
  list: (): Promise<SkillsList> => fetch('/api/skills').then(jsonRes<SkillsList>),

  setEnabled: async (slug: string, enabled: boolean): Promise<void> => {
    await fetch(`/api/skills/${encodeURIComponent(slug)}/enabled`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ enabled }),
    }).then(jsonRes);
  },

  setPinned: async (slug: string, pinned: boolean): Promise<void> => {
    await fetch(`/api/skills/${encodeURIComponent(slug)}/pinned`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ pinned }),
    }).then(jsonRes);
  },

  promote: async (slug: string): Promise<void> => {
    await fetch('/api/skills/promote', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ slug }),
    }).then(jsonRes);
  },

  remove: async (slug: string): Promise<void> => {
    const res = await fetch(`/api/skills/${encodeURIComponent(slug)}`, { method: 'DELETE' });
    if (!res.ok) throw new Error(res.statusText);
  },
};
```

- [ ] **Step 2: Type-check + commit**

Run: `npm run lint`
Expected: PASS.
```bash
git add src/lib/api/skills.api.ts
git commit -m "feat(skills): frontend API client"
```

---

### Task 17: Zustand store (optimistic)

**Files:**
- Create: `src/stores/skills.store.ts`
- Test: `src/stores/skills.store.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { vi } from 'vitest';
import type { MaterialSkill } from '@/server/domain/skills/skills.types';

vi.mock('@/src/lib/api/skills.api', () => ({
  skillsApi: {
    list: vi.fn(),
    setEnabled: vi.fn(),
    setPinned: vi.fn(),
    promote: vi.fn(),
    remove: vi.fn(),
  },
}));

import { skillsApi } from '@/src/lib/api/skills.api';
import { useSkillsStore } from './skills.store';

const m = (over: Partial<MaterialSkill>): MaterialSkill => ({
  name: 'alpha', enabled: false, pinned: false, description: 'd', invalid: undefined, ...over,
});

beforeEach(() => {
  useSkillsStore.setState({ skills: [], drafts: [], isLoading: false, error: null });
  vi.clearAllMocks();
});

describe('useSkillsStore', () => {
  it('init loads skills + drafts', async () => {
    (skillsApi.list as any).mockResolvedValue({ skills: [m({})], drafts: [] });
    await useSkillsStore.getState().init();
    expect(useSkillsStore.getState().skills).toHaveLength(1);
  });

  it('toggleEnabled optimistically flips then calls API', async () => {
    useSkillsStore.setState({ skills: [m({ enabled: false })] });
    (skillsApi.setEnabled as any).mockResolvedValue(undefined);
    await useSkillsStore.getState().toggleEnabled('alpha');
    expect(useSkillsStore.getState().skills[0].enabled).toBe(true);
    expect(skillsApi.setEnabled).toHaveBeenCalledWith('alpha', true);
  });

  it('toggleEnabled rolls back on API error', async () => {
    useSkillsStore.setState({ skills: [m({ enabled: false })] });
    (skillsApi.setEnabled as any).mockRejectedValue(new Error('boom'));
    await expect(useSkillsStore.getState().toggleEnabled('alpha')).rejects.toThrow();
    expect(useSkillsStore.getState().skills[0].enabled).toBe(false);
  });

  it('togglePinned optimistically flips then calls API', async () => {
    useSkillsStore.setState({ skills: [m({ pinned: false })] });
    (skillsApi.setPinned as any).mockResolvedValue(undefined);
    await useSkillsStore.getState().togglePinned('alpha');
    expect(useSkillsStore.getState().skills[0].pinned).toBe(true);
  });

  it('promote calls API then refreshes', async () => {
    useSkillsStore.setState({ drafts: [{ name: 'wip', description: 'w', invalid: undefined }] });
    (skillsApi.promote as any).mockResolvedValue(undefined);
    (skillsApi.list as any).mockResolvedValue({ skills: [m({ name: 'wip' })], drafts: [] });
    await useSkillsStore.getState().promote('wip');
    expect(skillsApi.promote).toHaveBeenCalledWith('wip');
    expect(useSkillsStore.getState().skills.map((s) => s.name)).toContain('wip');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/stores/skills.store.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```ts
import { create } from 'zustand';
import type { MaterialSkill, DraftSkill } from '@/server/domain/skills/skills.types';
import { skillsApi } from '@/src/lib/api/skills.api';

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

interface SkillsState {
  skills: MaterialSkill[];
  drafts: DraftSkill[];
  isLoading: boolean;
  error: string | null;
  init: () => Promise<void>;
  refresh: () => Promise<void>;
  toggleEnabled: (slug: string) => Promise<void>;
  togglePinned: (slug: string) => Promise<void>;
  promote: (slug: string) => Promise<void>;
  remove: (slug: string) => Promise<void>;
}

export const useSkillsStore = create<SkillsState>((set, get) => ({
  skills: [],
  drafts: [],
  isLoading: false,
  error: null,

  init: async () => {
    set({ isLoading: true, error: null });
    try {
      const { skills, drafts } = await skillsApi.list();
      set({ skills, drafts, isLoading: false });
    } catch (e) {
      set({ isLoading: false, error: errMsg(e) });
    }
  },

  refresh: async () => {
    const { skills, drafts } = await skillsApi.list();
    set({ skills, drafts });
  },

  toggleEnabled: async (slug) => {
    const prev = get().skills;
    const target = prev.find((s) => s.name === slug);
    if (!target) return;
    const next = !target.enabled;
    set({ skills: prev.map((s) => (s.name === slug ? { ...s, enabled: next } : s)) });
    try {
      await skillsApi.setEnabled(slug, next);
    } catch (e) {
      set({ skills: prev, error: errMsg(e) });
      throw e;
    }
  },

  togglePinned: async (slug) => {
    const prev = get().skills;
    const target = prev.find((s) => s.name === slug);
    if (!target) return;
    const next = !target.pinned;
    set({ skills: prev.map((s) => (s.name === slug ? { ...s, pinned: next } : s)) });
    try {
      await skillsApi.setPinned(slug, next);
    } catch (e) {
      set({ skills: prev, error: errMsg(e) });
      throw e;
    }
  },

  promote: async (slug) => {
    try {
      await skillsApi.promote(slug);
      await get().refresh();
    } catch (e) {
      set({ error: errMsg(e) });
      throw e;
    }
  },

  remove: async (slug) => {
    const prev = get().skills;
    set({ skills: prev.filter((s) => s.name !== slug) });
    try {
      await skillsApi.remove(slug);
    } catch (e) {
      set({ skills: prev, error: errMsg(e) });
      throw e;
    }
  },
}));
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/stores/skills.store.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/stores/skills.store.ts src/stores/skills.store.test.ts
git commit -m "feat(skills): frontend Zustand store"
```

---

### Task 18: i18n strings

**Files:**
- Modify: `src/i18n/en.ts`

- [ ] **Step 1: Add a `skills` section to the `messages` object**

```ts
  skills: {
    heading: 'Skills',
    materialBadge: 'material',
    labelBadge: 'label',
    invalidBadge: 'invalid',
    enable: 'Enable',
    pin: 'Pin (inline full instructions)',
    pinned: 'Pinned',
    remove: 'Remove skill',
    removeConfirm: 'Remove "{name}"? This deletes its directory on disk.',
    drafts: 'Drafts',
    promote: 'Review & promote',
    promoteConfirm: 'Promote "{name}" into your active skills?',
    fsMcpOffWarning: 'Enable the Filesystem MCP so the model can read skill files.',
    empty: 'No skills yet. Copy a skill directory into your skills folder.',
  },
```

- [ ] **Step 2: Type-check + commit**

Run: `npm run lint`
Expected: PASS.
```bash
git add src/i18n/en.ts
git commit -m "feat(skills): i18n strings"
```

---

### Task 19: Rebuild `SkillsSection` — unified list, material toggles, drafts, fs-MCP warning

**Files:**
- Modify: `src/components/sidebar/SkillsSection.tsx`
- Modify: `src/App.tsx` (init the skills store)

- [ ] **Step 1: Init the skills store in `App.tsx`**

Mirror the existing init pattern: import `useSkillsStore`, pull `initSkills = useSkillsStore((s) => s.init)`, call `initSkills()` inside the mount `useEffect`, and add `initSkills` to its dependency array (exactly like `initBuiltinMcp`).

- [ ] **Step 2: Rewrite `SkillsSection.tsx`**

The component keeps the existing label-skill behavior (via `context.store`) and appends material skills + drafts (via `skills.store`). The single visual list = label skills then material skills.

```tsx
import type { Skill } from '@/server/domain/context/context.types';
import { addSkillFlow } from '@/src/lib/context/addFlows';
import { useContextStore } from '@/src/stores/context.store';
import { useSkillsStore } from '@/src/stores/skills.store';
import { useBuiltinMcpStore } from '@/src/stores/builtinMcp.store'; // confirm the exact store name/path
import { useDialog } from '@/src/hooks/useDialog';
import { t } from '@/src/i18n/t';

const EMPTY_SKILLS: Skill[] = [];

export function SkillsSection() {
  const context = useContextStore((s) => s.context);
  const labelSkills = context?.skills ?? EMPTY_SKILLS;
  const addSkill = useContextStore((s) => s.addSkill);
  const updateSkillAt = useContextStore((s) => s.updateSkillAt);
  const toggleSkillAt = useContextStore((s) => s.toggleSkillAt);
  const removeSkillAt = useContextStore((s) => s.removeSkillAt);

  const materialSkills = useSkillsStore((s) => s.skills);
  const drafts = useSkillsStore((s) => s.drafts);
  const toggleEnabled = useSkillsStore((s) => s.toggleEnabled);
  const togglePinned = useSkillsStore((s) => s.togglePinned);
  const promote = useSkillsStore((s) => s.promote);
  const removeMaterial = useSkillsStore((s) => s.remove);

  // Filesystem MCP must be on for progressive disclosure to work.
  const fsMcpEnabled = useBuiltinMcpStore((s) =>
    s.items?.some((i) => i.transport === 'filesystem' && i.enabled) ?? false,
  );
  const needsFsWarning =
    !fsMcpEnabled && materialSkills.some((s) => s.enabled && !s.pinned && !s.invalid);

  const dialog = useDialog();
  const handleAdd = () => addSkillFlow(dialog, addSkill);

  const handleEditLabel = async (index: number, current: string) => {
    const name = await dialog.prompt({ title: 'Edit Skill', label: 'Skill name', defaultValue: current, required: true });
    if (name) await updateSkillAt(index, name).catch(() => {});
  };
  const handleRemoveLabel = async (index: number, current: string) => {
    const ok = await dialog.confirm({ title: 'Remove skill', message: `Remove "${current}"?`, destructive: true });
    if (ok) await removeSkillAt(index).catch(() => {});
  };
  const handleRemoveMaterial = async (slug: string) => {
    const ok = await dialog.confirm({
      title: 'Remove skill',
      message: t('skills.removeConfirm', { name: slug }),
      destructive: true,
    });
    if (ok) await removeMaterial(slug).catch(() => {});
  };
  const handlePromote = async (slug: string) => {
    const ok = await dialog.confirm({ title: 'Promote', message: t('skills.promoteConfirm', { name: slug }) });
    if (ok) await promote(slug).catch(() => {});
  };

  const enabledCount = labelSkills.filter((s) => s.enabled).length + materialSkills.filter((s) => s.enabled).length;
  const total = labelSkills.length + materialSkills.length;

  return (
    <section>
      <div className="flex items-center justify-between mb-2">
        <div className="mono-label">{t('skills.heading')}</div>
        <span className="text-[10px] text-zinc-600">[{enabledCount}/{total}]</span>
      </div>

      {needsFsWarning && (
        <div role="alert" className="mb-2 p-1.5 rounded border border-status-warning/40 text-[10px] text-status-warning">
          {t('skills.fsMcpOffWarning')}
        </div>
      )}

      <div className="space-y-1">
        {/* Label (legacy) skills — unchanged behavior */}
        {labelSkills.map((skill, i) => (
          <div
            key={`label-${i}-${skill.name}`}
            data-skill-row
            role="button"
            tabIndex={0}
            onClick={() => toggleSkillAt(i).catch(() => {})}
            aria-pressed={skill.enabled}
            className={`group flex items-center justify-between p-1.5 rounded bg-zinc-900 border border-border-subtle text-[10px] font-mono cursor-pointer ${
              skill.enabled ? 'text-zinc-400 hover:border-manipulation/40' : 'text-zinc-600 line-through opacity-60'
            }`}
          >
            <span className="truncate">
              <span className="text-zinc-600 mr-1">[{t('skills.labelBadge')}]</span>
              {skill.name}
            </span>
            <div className="hidden group-hover:flex gap-1">
              <button onClick={(e) => { e.stopPropagation(); handleEditLabel(i, skill.name); }} aria-label={`Edit ${skill.name}`} className="hover:text-white">✎</button>
              <button onClick={(e) => { e.stopPropagation(); handleRemoveLabel(i, skill.name); }} aria-label={`Remove ${skill.name}`} className="hover:text-status-error">×</button>
            </div>
          </div>
        ))}

        {/* Material (filesystem) skills */}
        {materialSkills.map((skill) => (
          <div
            key={`material-${skill.name}`}
            data-skill-row
            className={`group flex items-center justify-between p-1.5 rounded bg-zinc-900 border border-border-subtle text-[10px] font-mono ${
              skill.invalid ? 'text-status-error' : skill.enabled ? 'text-zinc-400' : 'text-zinc-600'
            }`}
          >
            <button
              type="button"
              disabled={!!skill.invalid}
              onClick={() => toggleEnabled(skill.name).catch(() => {})}
              aria-pressed={skill.enabled}
              aria-label={`${t('skills.enable')} ${skill.name}`}
              className="flex-1 text-left truncate disabled:cursor-not-allowed"
              title={skill.invalid ?? skill.description}
            >
              <span className="text-zinc-600 mr-1">[{skill.invalid ? t('skills.invalidBadge') : t('skills.materialBadge')}]</span>
              <span className={skill.enabled && !skill.invalid ? '' : 'line-through opacity-60'}>{skill.name}</span>
            </button>
            {!skill.invalid && (
              <div className="flex items-center gap-1">
                <button
                  onClick={() => togglePinned(skill.name).catch(() => {})}
                  aria-pressed={skill.pinned}
                  aria-label={`${t('skills.pin')} ${skill.name}`}
                  className={skill.pinned ? 'text-manipulation' : 'text-zinc-600 hover:text-zinc-300'}
                  title={t('skills.pin')}
                >
                  📌
                </button>
                <button onClick={() => handleRemoveMaterial(skill.name)} aria-label={`${t('skills.remove')} ${skill.name}`} className="hover:text-status-error">×</button>
              </div>
            )}
          </div>
        ))}

        {labelSkills.length === 0 && materialSkills.length === 0 && (
          <p className="text-[10px] text-zinc-600">{t('skills.empty')}</p>
        )}

        <button onClick={handleAdd} aria-label="Add skill" className="w-full p-1 border border-dashed border-border-subtle rounded text-[10px] text-zinc-600 hover:text-zinc-400 transition-colors mt-2">
          + Deploy New Skill
        </button>
      </div>

      {/* Drafts awaiting review/promote */}
      {drafts.length > 0 && (
        <div className="mt-3">
          <div className="mono-label mb-1">{t('skills.drafts')}</div>
          <div className="space-y-1">
            {drafts.map((d) => (
              <div key={`draft-${d.name}`} className="flex items-center justify-between p-1.5 rounded bg-zinc-900 border border-dashed border-border-subtle text-[10px] font-mono text-zinc-500">
                <span className="truncate" title={d.invalid ?? d.description}>{d.name}</span>
                <button disabled={!!d.invalid} onClick={() => handlePromote(d.name)} className="text-manipulation hover:underline disabled:opacity-40 disabled:no-underline">
                  {t('skills.promote')}
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
```

> IMPLEMENTER NOTES:
> - Confirm the builtin-MCP store's exact module path, hook name, and shape (the exploration referenced `initBuiltinMcp` in `App.tsx`). Adjust the `useBuiltinMcpStore`/`fsMcpEnabled` selector to the real shape. If exposing `filesystem enabled` from that store is awkward, derive it from whatever field holds builtin transports; keep the `needsFsWarning` logic identical.
> - Tailwind color tokens (`status-warning`, `manipulation`, `border-subtle`) are existing project tokens used elsewhere in this file — reuse them; do not invent new ones.

- [ ] **Step 3: Type-check**

Run: `npm run lint`
Expected: PASS.

- [ ] **Step 4: Manual verification (full app)**

Run: `AETHER_FAKE_PROVIDER=1 npm run dev` then open http://localhost:3000.
Expected: the Skills sidebar section lists `brainstorming` and `skill-creator` as `[material]`, disabled. Toggling one enables it; the count `[n/total]` updates. With the Filesystem MCP off and a material skill enabled (not pinned), the warning banner shows.

- [ ] **Step 5: Commit**

```bash
git add src/components/sidebar/SkillsSection.tsx src/App.tsx
git commit -m "feat(skills): unified Skills section with material skills, pin, drafts, fs-MCP warning"
```

---

## Phase G — Full verification

### Task 20: Full suite, lint, coverage, manual draft→promote

**Files:** none (verification only)

- [ ] **Step 1: Type-check the whole project**

Run: `npm run lint`
Expected: PASS (zero errors).

- [ ] **Step 2: Run the full test suite**

Run: `npm run test:run`
Expected: PASS (all backend + frontend tests).

- [ ] **Step 3: Coverage on the new domain**

Run: `npm run test:coverage`
Expected: PASS — thresholds (80%) hold for `server/domain/skills/**`, `src/stores/**`, `src/lib/**`.

- [ ] **Step 4: Manual end-to-end — draft promote**

With `AETHER_FAKE_PROVIDER=1 npm run dev` running, create a valid draft on disk:
`<data dir>/skills/.drafts/demo/SKILL.md` containing:
```
---
name: demo
description: A demo skill
---
# Demo
```
Reload the sidebar (or trigger the skills store `init`/`refresh`). Expected: `demo` appears under **Drafts** with **Review & promote**. Click it → confirm → `demo` moves into the main list as `[material]`, disabled. Enable + pin it, send a chat message, and confirm (via the model's view / logs) the SKILL.md body is inlined under `## Skill: demo`.

- [ ] **Step 5: Final commit (if any tweaks were needed)**

```bash
git add -A
git commit -m "test(skills): full-suite verification for filesystem skills foundation"
```

---

## Self-review (completed during planning)

- **Spec coverage:** §1 decisions → Tasks 1-19; §3 data model → Tasks 1,2,6,7; §4 layout+seeding → Tasks 3,8,9,10,15; §5 backend → Tasks 4-7,13-15; §6 hybrid assembly + fs-MCP warning → Tasks 11,12,19; §7 generation session → **deferred to Plan 2** (documented); §8 frontend → Tasks 16-19; §9 testing → every task is TDD + Task 20; §10 out-of-scope respected (no per-profile override, no script execution, no SKILL.md editing in UI).
- **Placeholder scan:** the only "implementer notes" are about confirming an existing store's exact shape (builtin-MCP) and the existing provider-request capture mechanism in the dispatch test — both reference real code to read, not unfinished work; all production code is complete.
- **Type consistency:** `MaterialSkill`/`DraftSkill`/`SkillsList`/`PromptMaterialSkill`/`SkillStateRow` are defined in Task 2 and used unchanged in Tasks 6,7,11,12,16,17; `SkillsService` method names (`list`, `setEnabled`, `setPinned`, `getActiveForPrompt`, `promote`, `remove`) are consistent across Tasks 7,12,13,15; route paths match between Tasks 13,14,16.
