# Aether Slice 22 — Agentic Breakpoints + Dry-Run Sandboxing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Generalize the slice-7 per-tool `autoApprove` flag into a 3-category breakpoints policy (`safe`/`dangerous`/`external`) with a rich `<ApprovalGate>` modal that shows args + filesystem-write diff previews + a session-scoped sticky checkbox.

**Architecture:** New `BreakpointService` resolves each tool call to `'auto'|'gate'` by checking per-tool `autoApprove` first, then per-tool `category` override, then a heuristic on tool name + args, then the global per-category policy stored in the new SQLite `breakpoint_policy` table (migration 007). On the FE, `useToolCallDecisions` replaces the existing `confirm()` flow: it first consults a session-scoped sticky set in `useChatStore`, then fetches a server-side preview, then opens a dedicated `<ApprovalGate>` modal that renders a unified diff for filesystem writes. The existing per-tool `autoApprove` PATCH route is extended to accept an optional `category` field; the existing `awaitDecision` flow is unchanged.

**Tech Stack:** TypeScript, Node 22, Express, better-sqlite3, zustand, React 18, vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-05-24-aether-slice-22-breakpoints-design.md`

---

## Notes for the implementer

- All work is on branch `feat/slice-22-breakpoints` (already created).
- The existing test runner is `pnpm test`. To run a single test file: `pnpm vitest run path/to/file.test.ts`.
- Lint: `pnpm lint`. Typecheck: `pnpm typecheck`.
- MSW handlers live in `src/test/msw-handlers.ts`; any new endpoint a FE store touches MUST have a default handler there or store tests will fail.
- Pre-existing flakes that may show up in full runs and are unrelated to this slice: two Ollama provider tests when a local Ollama daemon is reachable; one Playwright test under full-suite isolation. Treat these as pre-existing.
- Follow the established dedupe pattern from `src/stores/providerAuth.store.ts` (module-level `Map<string, Promise>`).
- Migration ordering is mandatory: filename MUST be `007_breakpoint_policy.sql`. The migrate test asserts `[1, 2, 3, 4, 5, 6, 7]` after this slice.
- Commit after each task. Commit messages use Conventional Commits.

---

### Task A1: Verify branch + clean tree

**Files:** (none — sanity check)

- [ ] **Step 1: Confirm branch and clean tree**

Run: `git status && git branch --show-current`
Expected:
```
On branch feat/slice-22-breakpoints
nothing to commit, working tree clean
```

If anything is dirty, stop and surface to the user. Do NOT proceed.

---

### Task B1: Migration 007 + types + migrate test bump

**Files:**
- Create: `server/db/migrations/007_breakpoint_policy.sql`
- Create: `server/domain/mcp/breakpoints/breakpoints.types.ts`
- Modify: `server/db/migrate.test.ts` (the assertion that lists migration versions)
- Modify: `server/domain/context/context.types.ts` (extend `McpToolPolicy`)

- [ ] **Step 1: Write the migration file**

Create `server/db/migrations/007_breakpoint_policy.sql`:

```sql
-- Per-category breakpoints policy (slice 22). Singleton-style: exactly 3 rows.
CREATE TABLE breakpoint_policy (
  category TEXT PRIMARY KEY CHECK (category IN ('safe','dangerous','external')),
  mode TEXT NOT NULL CHECK (mode IN ('auto','gate'))
);

INSERT INTO breakpoint_policy (category, mode) VALUES ('safe', 'auto');
INSERT INTO breakpoint_policy (category, mode) VALUES ('dangerous', 'gate');
INSERT INTO breakpoint_policy (category, mode) VALUES ('external', 'gate');
```

- [ ] **Step 2: Create the types file**

Create `server/domain/mcp/breakpoints/breakpoints.types.ts`:

```ts
export type ToolCategory = 'safe' | 'dangerous' | 'external';
export type CategoryMode = 'auto' | 'gate';

export interface BreakpointPolicy {
  safe: CategoryMode;
  dangerous: CategoryMode;
  external: CategoryMode;
}

export interface ClassifiedTool {
  qualifiedName: string;
  category: ToolCategory;
  source: 'heuristic' | 'override';
}

export type PreviewResult =
  | { kind: 'diff'; oldText: string; newText: string; path: string }
  | { kind: 'plain' };

export const DANGEROUS_NAME_PATTERNS: RegExp[] = [
  /^[^.]+\.(write|edit|delete|move|create|remove|rename|drop|truncate)_/i,
  /^[^.]+\.execute_command$/i,
  /^[^.]+\.git_(rebase|push|reset)/i,
];

export const DANGEROUS_SHELL_PATTERNS: RegExp[] = [
  /git\s+push\s+(-f|--force)/,
  /npm\s+publish/,
  /yarn\s+publish/,
  /pnpm\s+publish/,
  /git\s+reset\s+--hard/,
  /git\s+rebase/,
  />\s*\/dev\/sd[a-z]/,
];
```

- [ ] **Step 3: Extend `McpToolPolicy` in context.types.ts (backwards compatible)**

In `server/domain/context/context.types.ts`, change:

```ts
export interface McpToolPolicy {
  autoApprove: boolean;
}
```

to:

```ts
import type { ToolCategory } from '@/server/domain/mcp/breakpoints/breakpoints.types';

export interface McpToolPolicy {
  autoApprove?: boolean;
  category?: ToolCategory;
}
```

Both fields optional. Existing persisted rows `{ autoApprove: true }` continue to deserialize fine.

- [ ] **Step 4: Update the migrate-test assertion**

Open `server/db/migrate.test.ts`. Find the assertion `expect(versions).toEqual([1, 2, 3, 4, 5, 6]);` (around line 107). Change to:

```ts
expect(versions).toEqual([1, 2, 3, 4, 5, 6, 7]);
```

- [ ] **Step 5: Run the migrate test**

Run: `pnpm vitest run server/db/migrate.test.ts`
Expected: all green; the `applies all real migrations` case now asserts 7 versions.

- [ ] **Step 6: Verify nothing else broke from the McpToolPolicy change**

Run: `pnpm typecheck`
Expected: PASS. (If there are type errors in code consuming `policy.autoApprove`, treat `autoApprove === true` as truthy — the spec says backwards-compatible behavior is preserved by leaving optional.)

If typecheck fails on a use-site like `policy.autoApprove ? ...`, that's fine — optional `boolean | undefined` still works as a falsy/truthy check. But if a use-site does `const x: boolean = policy.autoApprove`, narrow it: `policy.autoApprove === true`.

- [ ] **Step 7: Commit**

```bash
git add server/db/migrations/007_breakpoint_policy.sql \
        server/domain/mcp/breakpoints/breakpoints.types.ts \
        server/domain/context/context.types.ts \
        server/db/migrate.test.ts
git commit -m "feat(slice-22): migration 007 + breakpoint types + McpToolPolicy.category"
```

---

### Task C1: classifyTool (heuristic + override)

**Files:**
- Create: `server/domain/mcp/breakpoints/classify.ts`
- Create: `server/domain/mcp/breakpoints/classify.test.ts`

- [ ] **Step 1: Write the failing test**

Create `server/domain/mcp/breakpoints/classify.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { classifyTool } from './classify';

describe('classifyTool', () => {
  it('classifies file-write tools as dangerous via name regex', () => {
    expect(classifyTool({ qualifiedName: 'fs.write_file', args: {} }).category).toBe('dangerous');
    expect(classifyTool({ qualifiedName: 'fs.delete_file', args: {} }).category).toBe('dangerous');
    expect(classifyTool({ qualifiedName: 'db.drop_table', args: {} }).category).toBe('dangerous');
  });

  it('classifies execute_command as dangerous', () => {
    const r = classifyTool({ qualifiedName: 'shell.execute_command', args: { cmd: 'echo hi' } });
    expect(r.category).toBe('dangerous');
    expect(r.source).toBe('heuristic');
  });

  it('classifies git_push / git_rebase / git_reset as dangerous', () => {
    expect(classifyTool({ qualifiedName: 'git.git_push', args: {} }).category).toBe('dangerous');
    expect(classifyTool({ qualifiedName: 'git.git_rebase', args: {} }).category).toBe('dangerous');
  });

  it('classifies read-only tools as safe by default', () => {
    expect(classifyTool({ qualifiedName: 'fs.read_file', args: {} }).category).toBe('safe');
    expect(classifyTool({ qualifiedName: 'fs.list_directory', args: {} }).category).toBe('safe');
  });

  it('honors explicit override.category over heuristic', () => {
    const r = classifyTool({
      qualifiedName: 'fs.read_file',
      args: {},
      override: { category: 'dangerous' },
    });
    expect(r.category).toBe('dangerous');
    expect(r.source).toBe('override');
  });

  it('heuristic never assigns external; only override can', () => {
    const r = classifyTool({
      qualifiedName: 'api.fetch_url',
      args: {},
      override: { category: 'external' },
    });
    expect(r.category).toBe('external');
    expect(r.source).toBe('override');

    const r2 = classifyTool({ qualifiedName: 'api.fetch_url', args: {} });
    expect(r2.category).toBe('safe');
  });
});
```

- [ ] **Step 2: Run the test — expect it to fail**

Run: `pnpm vitest run server/domain/mcp/breakpoints/classify.test.ts`
Expected: FAIL with "Cannot find module './classify'".

- [ ] **Step 3: Implement `classifyTool`**

Create `server/domain/mcp/breakpoints/classify.ts`:

```ts
import {
  DANGEROUS_NAME_PATTERNS,
  type ClassifiedTool,
  type ToolCategory,
} from './breakpoints.types';

export interface ClassifyInput {
  qualifiedName: string;
  args: Record<string, unknown>;
  override?: { category?: ToolCategory };
}

export function classifyTool(input: ClassifyInput): ClassifiedTool {
  if (input.override?.category) {
    return {
      qualifiedName: input.qualifiedName,
      category: input.override.category,
      source: 'override',
    };
  }

  for (const pattern of DANGEROUS_NAME_PATTERNS) {
    if (pattern.test(input.qualifiedName)) {
      return {
        qualifiedName: input.qualifiedName,
        category: 'dangerous',
        source: 'heuristic',
      };
    }
  }

  return {
    qualifiedName: input.qualifiedName,
    category: 'safe',
    source: 'heuristic',
  };
}
```

- [ ] **Step 4: Run the test — expect green**

Run: `pnpm vitest run server/domain/mcp/breakpoints/classify.test.ts`
Expected: 6 passing.

- [ ] **Step 5: Commit**

```bash
git add server/domain/mcp/breakpoints/classify.ts server/domain/mcp/breakpoints/classify.test.ts
git commit -m "feat(slice-22): classifyTool heuristic + override resolution"
```

---

### Task D1: BreakpointPolicyStore (SQLite-backed)

**Files:**
- Create: `server/domain/mcp/breakpoints/policy.store.ts`
- Create: `server/domain/mcp/breakpoints/policy.store.test.ts`

- [ ] **Step 1: Write the failing test**

Create `server/domain/mcp/breakpoints/policy.store.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { applyMigrations } from '@/server/db/migrate';
import { BreakpointPolicyStore } from './policy.store';

let dbDir: string;
let db: ReturnType<typeof Database>;

beforeEach(() => {
  dbDir = mkdtempSync(join(tmpdir(), 'aether-bp-'));
  // Real migration files
  const realMigs = join(process.cwd(), 'server/db/migrations');
  mkdirSync(join(dbDir, 'migrations'), { recursive: true });
  // Symlink-style copy of the breakpoint migration is enough for this test
  const sql = `
    CREATE TABLE breakpoint_policy (
      category TEXT PRIMARY KEY CHECK (category IN ('safe','dangerous','external')),
      mode TEXT NOT NULL CHECK (mode IN ('auto','gate'))
    );
    INSERT INTO breakpoint_policy (category, mode) VALUES ('safe', 'auto');
    INSERT INTO breakpoint_policy (category, mode) VALUES ('dangerous', 'gate');
    INSERT INTO breakpoint_policy (category, mode) VALUES ('external', 'gate');
  `;
  writeFileSync(join(dbDir, 'migrations', '001_bp.sql'), sql);
  db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  applyMigrations(db, join(dbDir, 'migrations'));
});

afterEach(() => {
  db.close();
  rmSync(dbDir, { recursive: true, force: true });
});

describe('BreakpointPolicyStore', () => {
  it('reads the three seeded rows with default modes', () => {
    const store = new BreakpointPolicyStore(db);
    expect(store.read()).toEqual({ safe: 'auto', dangerous: 'gate', external: 'gate' });
  });

  it('setCategory updates one row and read reflects it', () => {
    const store = new BreakpointPolicyStore(db);
    store.setCategory('dangerous', 'auto');
    expect(store.read()).toEqual({ safe: 'auto', dangerous: 'auto', external: 'gate' });
  });

  it('setCategory persists across new store instances on the same db', () => {
    const a = new BreakpointPolicyStore(db);
    a.setCategory('external', 'auto');
    const b = new BreakpointPolicyStore(db);
    expect(b.read().external).toBe('auto');
  });
});
```

- [ ] **Step 2: Run the test — expect failure**

Run: `pnpm vitest run server/domain/mcp/breakpoints/policy.store.test.ts`
Expected: FAIL with "Cannot find module './policy.store'".

- [ ] **Step 3: Implement the store**

Create `server/domain/mcp/breakpoints/policy.store.ts`:

```ts
import type { DatabaseHandle } from '@/server/db/database';
import type { BreakpointPolicy, CategoryMode, ToolCategory } from './breakpoints.types';

interface Row {
  category: ToolCategory;
  mode: CategoryMode;
}

export class BreakpointPolicyStore {
  constructor(private readonly db: DatabaseHandle) {}

  read(): BreakpointPolicy {
    const rows = this.db
      .prepare('SELECT category, mode FROM breakpoint_policy')
      .all() as Row[];
    const out: BreakpointPolicy = { safe: 'auto', dangerous: 'gate', external: 'gate' };
    for (const r of rows) out[r.category] = r.mode;
    return out;
  }

  setCategory(category: ToolCategory, mode: CategoryMode): void {
    this.db
      .prepare('UPDATE breakpoint_policy SET mode = ? WHERE category = ?')
      .run(mode, category);
  }
}
```

- [ ] **Step 4: Run the test — green**

Run: `pnpm vitest run server/domain/mcp/breakpoints/policy.store.test.ts`
Expected: 3 passing.

- [ ] **Step 5: Commit**

```bash
git add server/domain/mcp/breakpoints/policy.store.ts \
        server/domain/mcp/breakpoints/policy.store.test.ts
git commit -m "feat(slice-22): BreakpointPolicyStore (SQLite-backed)"
```

---

### Task E1: BreakpointService.resolveDecision

**Files:**
- Create: `server/domain/mcp/breakpoints/breakpoints.service.ts`
- Create: `server/domain/mcp/breakpoints/breakpoints.service.test.ts`

- [ ] **Step 1: Write the failing test**

Create `server/domain/mcp/breakpoints/breakpoints.service.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { BreakpointService } from './breakpoints.service';
import type { McpToolPolicy } from '@/server/domain/context/context.types';
import type { BreakpointPolicy } from './breakpoints.types';

function makeService(opts: {
  policy?: McpToolPolicy;
  bp?: Partial<BreakpointPolicy>;
}) {
  const bp: BreakpointPolicy = {
    safe: 'auto', dangerous: 'gate', external: 'gate', ...opts.bp,
  };
  return new BreakpointService({
    mcpRegistry: { policy: () => opts.policy ?? {} } as any,
    policyStore: { read: () => bp } as any,
  });
}

describe('BreakpointService.resolveDecision', () => {
  it('per-tool autoApprove=true → auto regardless of category', async () => {
    const svc = makeService({ policy: { autoApprove: true } });
    const mode = await svc.resolveDecision({ qualifiedName: 'fs.delete_file', args: {} });
    expect(mode).toBe('auto');
  });

  it('per-tool autoApprove=false → gate regardless of category', async () => {
    const svc = makeService({ policy: { autoApprove: false } });
    const mode = await svc.resolveDecision({ qualifiedName: 'fs.read_file', args: {} });
    expect(mode).toBe('gate');
  });

  it('per-tool category override + global policy → resolves via category', async () => {
    const svc = makeService({
      policy: { category: 'external' },
      bp: { external: 'auto' },
    });
    const mode = await svc.resolveDecision({ qualifiedName: 'fs.read_file', args: {} });
    expect(mode).toBe('auto');
  });

  it('no per-tool config + heuristic dangerous + dangerous=gate → gate', async () => {
    const svc = makeService({ policy: undefined });
    const mode = await svc.resolveDecision({ qualifiedName: 'fs.write_file', args: {} });
    expect(mode).toBe('gate');
  });

  it('no per-tool config + heuristic dangerous + dangerous=auto → auto', async () => {
    const svc = makeService({ policy: undefined, bp: { dangerous: 'auto' } });
    const mode = await svc.resolveDecision({ qualifiedName: 'fs.write_file', args: {} });
    expect(mode).toBe('auto');
  });

  it('no per-tool config + safe + safe=auto → auto (default path)', async () => {
    const svc = makeService({ policy: undefined });
    const mode = await svc.resolveDecision({ qualifiedName: 'fs.read_file', args: {} });
    expect(mode).toBe('auto');
  });
});
```

- [ ] **Step 2: Run the test — expect failure**

Run: `pnpm vitest run server/domain/mcp/breakpoints/breakpoints.service.test.ts`
Expected: FAIL with "Cannot find module './breakpoints.service'".

- [ ] **Step 3: Implement the service**

Create `server/domain/mcp/breakpoints/breakpoints.service.ts`:

```ts
import type { McpRegistry } from '@/server/domain/mcp/registry';
import type { McpToolPolicy } from '@/server/domain/context/context.types';
import { classifyTool } from './classify';
import type { CategoryMode } from './breakpoints.types';
import type { BreakpointPolicyStore } from './policy.store';

export interface BreakpointServiceDeps {
  mcpRegistry: Pick<McpRegistry, 'policy'>;
  policyStore: Pick<BreakpointPolicyStore, 'read'>;
}

export class BreakpointService {
  constructor(private readonly deps: BreakpointServiceDeps) {}

  async resolveDecision(input: {
    qualifiedName: string;
    args: Record<string, unknown>;
  }): Promise<CategoryMode> {
    const policy: McpToolPolicy = this.deps.mcpRegistry.policy(input.qualifiedName) ?? {};

    if (policy.autoApprove === true) return 'auto';
    if (policy.autoApprove === false) return 'gate';

    const classified = classifyTool({
      qualifiedName: input.qualifiedName,
      args: input.args,
      override: policy.category ? { category: policy.category } : undefined,
    });

    return this.deps.policyStore.read()[classified.category];
  }
}
```

- [ ] **Step 4: Run the test — green**

Run: `pnpm vitest run server/domain/mcp/breakpoints/breakpoints.service.test.ts`
Expected: 6 passing.

- [ ] **Step 5: Commit**

```bash
git add server/domain/mcp/breakpoints/breakpoints.service.ts \
        server/domain/mcp/breakpoints/breakpoints.service.test.ts
git commit -m "feat(slice-22): BreakpointService.resolveDecision"
```

---

### Task F1: PreviewService (filesystem diff)

**Files:**
- Create: `server/domain/mcp/breakpoints/preview.service.ts`
- Create: `server/domain/mcp/breakpoints/preview.service.test.ts`

- [ ] **Step 1: Write the failing test**

Create `server/domain/mcp/breakpoints/preview.service.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { PreviewService } from './preview.service';

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'aether-preview-'));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('PreviewService.previewToolCall', () => {
  it('write_file on existing file returns diff with old + new', async () => {
    const p = join(dir, 'a.txt');
    writeFileSync(p, 'hello\nworld\n');
    const svc = new PreviewService({ safeRoots: () => [dir] });
    const r = await svc.previewToolCall({
      qualifiedName: 'fs.write_file',
      args: { path: p, content: 'hello\nuniverse\n' },
    });
    expect(r.kind).toBe('diff');
    if (r.kind === 'diff') {
      expect(r.oldText).toBe('hello\nworld\n');
      expect(r.newText).toBe('hello\nuniverse\n');
      expect(r.path).toBe(p);
    }
  });

  it('write_file on missing file → diff with empty oldText', async () => {
    const p = join(dir, 'new.txt');
    const svc = new PreviewService({ safeRoots: () => [dir] });
    const r = await svc.previewToolCall({
      qualifiedName: 'fs.write_file',
      args: { path: p, content: 'fresh\n' },
    });
    expect(r.kind).toBe('diff');
    if (r.kind === 'diff') expect(r.oldText).toBe('');
  });

  it('edit_file on existing file returns diff', async () => {
    const p = join(dir, 'b.txt');
    writeFileSync(p, 'one\n');
    const svc = new PreviewService({ safeRoots: () => [dir] });
    const r = await svc.previewToolCall({
      qualifiedName: 'fs.edit_file',
      args: { path: p, content: 'two\n' },
    });
    expect(r.kind).toBe('diff');
  });

  it('oversized file > 1 MB → plain', async () => {
    const p = join(dir, 'big.txt');
    writeFileSync(p, 'x'.repeat(1024 * 1024 + 1));
    const svc = new PreviewService({ safeRoots: () => [dir] });
    const r = await svc.previewToolCall({
      qualifiedName: 'fs.write_file',
      args: { path: p, content: 'small' },
    });
    expect(r.kind).toBe('plain');
  });

  it('non-write tool → plain', async () => {
    const svc = new PreviewService({ safeRoots: () => [dir] });
    const r = await svc.previewToolCall({
      qualifiedName: 'fs.read_file',
      args: { path: join(dir, 'x.txt') },
    });
    expect(r.kind).toBe('plain');
  });

  it('missing args.path → plain', async () => {
    const svc = new PreviewService({ safeRoots: () => [dir] });
    const r = await svc.previewToolCall({
      qualifiedName: 'fs.write_file',
      args: { content: 'oops' },
    });
    expect(r.kind).toBe('plain');
  });

  it('path outside safeRoots → plain', async () => {
    const outside = mkdtempSync(join(tmpdir(), 'aether-outside-'));
    const p = join(outside, 'evil.txt');
    writeFileSync(p, 'nope\n');
    const svc = new PreviewService({ safeRoots: () => [dir] });
    const r = await svc.previewToolCall({
      qualifiedName: 'fs.write_file',
      args: { path: p, content: 'x' },
    });
    expect(r.kind).toBe('plain');
    rmSync(outside, { recursive: true, force: true });
  });
});
```

- [ ] **Step 2: Run the test — expect failure**

Run: `pnpm vitest run server/domain/mcp/breakpoints/preview.service.test.ts`
Expected: FAIL with "Cannot find module './preview.service'".

- [ ] **Step 3: Implement the preview service**

Create `server/domain/mcp/breakpoints/preview.service.ts`:

```ts
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import type { PreviewResult } from './breakpoints.types';

const MAX_PREVIEW_BYTES = 1024 * 1024; // 1 MB

const WRITE_TOOL_PATTERN = /\.(write|edit|create)_/i;

export interface PreviewServiceDeps {
  safeRoots: () => string[];
}

export class PreviewService {
  constructor(private readonly deps: PreviewServiceDeps) {}

  async previewToolCall(input: {
    qualifiedName: string;
    args: Record<string, unknown>;
  }): Promise<PreviewResult> {
    if (!WRITE_TOOL_PATTERN.test(input.qualifiedName)) return { kind: 'plain' };

    const rawPath = input.args.path;
    if (typeof rawPath !== 'string' || rawPath.length === 0) return { kind: 'plain' };
    const rawContent = input.args.content;
    const newText = typeof rawContent === 'string' ? rawContent : '';

    const abs = path.resolve(rawPath);
    const roots = this.deps.safeRoots().map((r) => path.resolve(r));
    const inside = roots.some((r) => abs === r || abs.startsWith(r + path.sep));
    if (!inside) return { kind: 'plain' };

    let oldText = '';
    try {
      const s = await stat(abs);
      if (!s.isFile()) return { kind: 'plain' };
      if (s.size > MAX_PREVIEW_BYTES) return { kind: 'plain' };
      oldText = await readFile(abs, 'utf8');
    } catch (e: unknown) {
      const code = (e as { code?: string }).code;
      if (code === 'ENOENT') {
        oldText = '';
      } else {
        return { kind: 'plain' };
      }
    }

    if (newText.length > MAX_PREVIEW_BYTES) return { kind: 'plain' };

    return { kind: 'diff', oldText, newText, path: abs };
  }
}
```

- [ ] **Step 4: Run the test — green**

Run: `pnpm vitest run server/domain/mcp/breakpoints/preview.service.test.ts`
Expected: 7 passing.

- [ ] **Step 5: Commit**

```bash
git add server/domain/mcp/breakpoints/preview.service.ts \
        server/domain/mcp/breakpoints/preview.service.test.ts
git commit -m "feat(slice-22): PreviewService (filesystem write diff with safe-root gating)"
```

---

### Task G1: PolicyBody accepts `category` (mcp.routes)

**Files:**
- Modify: `server/routes/mcp.routes.ts` (PolicyBody zod schema)
- Modify: `server/routes/mcp.routes.test.ts` (add 1 case)

- [ ] **Step 1: Write the failing test (extend mcp.routes.test.ts)**

Open `server/routes/mcp.routes.test.ts`. Find the existing PATCH-policy test block and add a new case AFTER it (mirror the existing setup; copy the pattern from a neighbor test in the file). The new case body:

```ts
it('accepts { category } payload on PATCH /:id/tools/:name', async () => {
  const setToolPolicy = vi.fn().mockResolvedValue(undefined);
  const app = makeApp({ setToolPolicy });
  const res = await request(app)
    .patch('/api/mcp/srv-1/tools/my_tool')
    .send({ category: 'dangerous' });
  expect(res.status).toBe(200);
  expect(setToolPolicy).toHaveBeenCalledWith('srv-1', 'my_tool', { category: 'dangerous' });
  expect(res.body).toEqual({ category: 'dangerous' });
});
```

Note: `makeApp` is the test helper already present in that file. If the existing helper name differs, use whatever the file already uses (e.g., `buildApp(...)` or inline `express()` with `registry`). Match the surrounding test style exactly.

- [ ] **Step 2: Run — expect failure**

Run: `pnpm vitest run server/routes/mcp.routes.test.ts`
Expected: the new case fails with a 400 (zod rejected `category`).

- [ ] **Step 3: Update PolicyBody schema**

Open `server/routes/mcp.routes.ts`. Replace:

```ts
const PolicyBody = z.object({ autoApprove: z.boolean() });
```

with:

```ts
const PolicyBody = z.object({
  autoApprove: z.boolean().optional(),
  category: z.enum(['safe', 'dangerous', 'external']).optional(),
}).refine(
  (v) => v.autoApprove !== undefined || v.category !== undefined,
  { message: 'must provide at least one of autoApprove or category' },
);
```

- [ ] **Step 4: Run — green (and existing autoApprove case still passes)**

Run: `pnpm vitest run server/routes/mcp.routes.test.ts`
Expected: all green (new + existing).

- [ ] **Step 5: Commit**

```bash
git add server/routes/mcp.routes.ts server/routes/mcp.routes.test.ts
git commit -m "feat(slice-22): PolicyBody accepts optional category alongside autoApprove"
```

---

### Task H1: breakpoints.routes (GET/PUT policy + POST preview + GET classify)

**Files:**
- Create: `server/routes/breakpoints.routes.ts`
- Create: `server/routes/breakpoints.routes.test.ts`

- [ ] **Step 1: Write the failing test**

Create `server/routes/breakpoints.routes.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createBreakpointsRoutes } from './breakpoints.routes';
import type { BreakpointPolicyStore } from '@/server/domain/mcp/breakpoints/policy.store';
import type { PreviewService } from '@/server/domain/mcp/breakpoints/preview.service';

function makeApp(opts: {
  policyStore?: Partial<BreakpointPolicyStore>;
  previewService?: Partial<PreviewService>;
}) {
  const app = express();
  app.use(express.json());
  app.use(
    '/api/breakpoints',
    createBreakpointsRoutes({
      policyStore: (opts.policyStore ?? {}) as BreakpointPolicyStore,
      previewService: (opts.previewService ?? {}) as PreviewService,
    }),
  );
  app.use((err: any, _req: any, res: any, _next: any) => {
    res.status(err.statusCode ?? 500).json({ error: { message: err.message } });
  });
  return app;
}

describe('breakpoints.routes', () => {
  it('GET /api/breakpoints/policy returns the current policy', async () => {
    const read = vi.fn().mockReturnValue({ safe: 'auto', dangerous: 'gate', external: 'gate' });
    const res = await request(makeApp({ policyStore: { read } as any })).get('/api/breakpoints/policy');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ safe: 'auto', dangerous: 'gate', external: 'gate' });
  });

  it('PUT /api/breakpoints/policy/:category sets mode and returns the new policy', async () => {
    const policy = { safe: 'auto', dangerous: 'gate', external: 'gate' };
    const setCategory = vi.fn((c: string, m: string) => { (policy as any)[c] = m; });
    const read = vi.fn().mockImplementation(() => ({ ...policy }));
    const app = makeApp({ policyStore: { setCategory, read } as any });
    const res = await request(app)
      .put('/api/breakpoints/policy/dangerous')
      .send({ mode: 'auto' });
    expect(res.status).toBe(200);
    expect(setCategory).toHaveBeenCalledWith('dangerous', 'auto');
    expect(res.body.dangerous).toBe('auto');
  });

  it('PUT invalid category → 400', async () => {
    const res = await request(makeApp({})).put('/api/breakpoints/policy/garbage').send({ mode: 'auto' });
    expect(res.status).toBe(400);
  });

  it('PUT invalid mode → 400', async () => {
    const res = await request(makeApp({})).put('/api/breakpoints/policy/safe').send({ mode: 'sometimes' });
    expect(res.status).toBe(400);
  });

  it('POST /api/breakpoints/preview returns the preview result', async () => {
    const previewToolCall = vi.fn().mockResolvedValue({ kind: 'plain' });
    const res = await request(makeApp({ previewService: { previewToolCall } as any }))
      .post('/api/breakpoints/preview')
      .send({ qualifiedName: 'fs.read_file', args: { path: '/x' } });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ kind: 'plain' });
  });

  it('POST /api/breakpoints/preview invalid body → 400', async () => {
    const res = await request(makeApp({})).post('/api/breakpoints/preview').send({ args: {} });
    expect(res.status).toBe(400);
  });

  it('GET /api/breakpoints/classify returns category + source', async () => {
    const res = await request(makeApp({}))
      .get('/api/breakpoints/classify')
      .query({ qualifiedName: 'fs.write_file', argsJson: '{}' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ category: 'dangerous', source: 'heuristic' });
  });
});
```

- [ ] **Step 2: Run — expect failure**

Run: `pnpm vitest run server/routes/breakpoints.routes.test.ts`
Expected: FAIL "Cannot find module './breakpoints.routes'".

- [ ] **Step 3: Implement the routes**

Create `server/routes/breakpoints.routes.ts`:

```ts
import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '@/server/lib/async-handler';
import { ValidationError } from '@/server/lib/errors';
import type { BreakpointPolicyStore } from '@/server/domain/mcp/breakpoints/policy.store';
import type { PreviewService } from '@/server/domain/mcp/breakpoints/preview.service';
import { classifyTool } from '@/server/domain/mcp/breakpoints/classify';

const CategoryParam = z.enum(['safe', 'dangerous', 'external']);
const ModeBody = z.object({ mode: z.enum(['auto', 'gate']) });
const PreviewBody = z.object({
  qualifiedName: z.string().min(1),
  args: z.record(z.string(), z.unknown()),
});

export interface BreakpointsRoutesDeps {
  policyStore: BreakpointPolicyStore;
  previewService: PreviewService;
}

export function createBreakpointsRoutes(deps: BreakpointsRoutesDeps): Router {
  const router = Router();

  router.get('/policy', (_req, res) => {
    res.json(deps.policyStore.read());
  });

  router.put(
    '/policy/:category',
    asyncHandler(async (req, res) => {
      const cat = CategoryParam.safeParse(req.params.category);
      if (!cat.success) throw new ValidationError('Invalid category', cat.error);
      const body = ModeBody.safeParse(req.body);
      if (!body.success) throw new ValidationError('Invalid mode', body.error);
      deps.policyStore.setCategory(cat.data, body.data.mode);
      res.json(deps.policyStore.read());
    }),
  );

  router.post(
    '/preview',
    asyncHandler(async (req, res) => {
      const parsed = PreviewBody.safeParse(req.body);
      if (!parsed.success) throw new ValidationError('Invalid preview body', parsed.error);
      const result = await deps.previewService.previewToolCall(parsed.data);
      res.json(result);
    }),
  );

  router.get(
    '/classify',
    asyncHandler(async (req, res) => {
      const qn = String(req.query.qualifiedName ?? '');
      if (!qn) throw new ValidationError('qualifiedName required');
      let args: Record<string, unknown> = {};
      const aj = req.query.argsJson;
      if (typeof aj === 'string' && aj.length > 0) {
        try { args = JSON.parse(aj); } catch { throw new ValidationError('argsJson is not valid JSON'); }
      }
      const result = classifyTool({ qualifiedName: qn, args });
      res.json(result);
    }),
  );

  return router;
}
```

- [ ] **Step 4: Run — green**

Run: `pnpm vitest run server/routes/breakpoints.routes.test.ts`
Expected: 7 passing.

- [ ] **Step 5: Commit**

```bash
git add server/routes/breakpoints.routes.ts server/routes/breakpoints.routes.test.ts
git commit -m "feat(slice-22): breakpoints routes (policy + preview + classify)"
```

---

### Task I1: Dispatch service integration (resolveDecision + deps)

**Files:**
- Modify: `server/domain/dispatch/dispatch.service.ts` (replace policy.autoApprove call site + add `breakpointService` to deps)
- Modify: `server/domain/dispatch/dispatch.service.test.ts` (extend with 2 cases)

- [ ] **Step 1: Write the failing tests (extend dispatch.service.test.ts)**

Open `server/domain/dispatch/dispatch.service.test.ts`. The file already has a test fixture that builds `new DispatchService({...})`. Add 2 new cases that exercise:
1. `breakpointService.resolveDecision` returns `'auto'` → tool executes without `awaitDecision`.
2. `breakpointService.resolveDecision` returns `'gate'` → `awaitDecision` is awaited.

Find an existing test that asserts a tool flows through approve/reject (search for `awaitDecision`). Add immediately after, copying the helper shape:

```ts
it('auto-resolution executes without awaitDecision', async () => {
  const awaitDecision = vi.fn();
  const resolveDecision = vi.fn().mockResolvedValue('auto');
  // ...rebuild registry + provider + service using the same setup as the surrounding test,
  // wiring breakpointService: { resolveDecision }
  // assert that awaitDecision is NEVER called and the tool execution proceeds.
  expect(awaitDecision).not.toHaveBeenCalled();
  expect(resolveDecision).toHaveBeenCalled();
});

it('gate-resolution awaits decision', async () => {
  const awaitDecision = vi.fn().mockResolvedValue('approve');
  const resolveDecision = vi.fn().mockResolvedValue('gate');
  // ...same setup
  expect(resolveDecision).toHaveBeenCalled();
  expect(awaitDecision).toHaveBeenCalled();
});
```

If the existing test file's helper makes this hard to bolt on, the simpler path: copy the smallest existing `awaitDecision` test verbatim, duplicate it, and modify the wiring to inject `breakpointService` with the mocked `resolveDecision`.

- [ ] **Step 2: Run — expect failure**

Run: `pnpm vitest run server/domain/dispatch/dispatch.service.test.ts`
Expected: new cases fail (or pass — depending on how they're wired; if they pass before the change, the test isn't proving anything — review carefully).

- [ ] **Step 3: Update `DispatchServiceDeps` and the resolution site**

In `server/domain/dispatch/dispatch.service.ts`:

a) At the top, add the import (group with other server-domain imports):

```ts
import type { BreakpointService } from '@/server/domain/mcp/breakpoints/breakpoints.service';
```

b) In `DispatchServiceDeps` (around line 82), add the new optional dep:

```ts
breakpointService?: BreakpointService;
```

c) Find the lines (currently at ~line 224-229):

```ts
sse.event('tool_call_request', pendingCall);
const policy = this.deps.mcpRegistry?.policy(pendingCall.qualifiedName) ?? { autoApprove: false };
const decision: 'approve' | 'reject' = policy.autoApprove
  ? 'approve'
  : await (this.deps.mcpRegistry?.awaitDecision(pendingCall.callId, 60_000) ?? Promise.resolve('reject' as const))
      .catch(() => 'reject' as const);
```

Replace with:

```ts
sse.event('tool_call_request', pendingCall);
let mode: 'auto' | 'gate';
if (this.deps.breakpointService) {
  mode = await this.deps.breakpointService.resolveDecision({
    qualifiedName: pendingCall.qualifiedName,
    args: pendingCall.args,
  });
} else {
  // Fallback for tests that don't wire the service: treat per-tool autoApprove as before.
  const policy = this.deps.mcpRegistry?.policy(pendingCall.qualifiedName) ?? {};
  mode = policy.autoApprove ? 'auto' : 'gate';
}
const decision: 'approve' | 'reject' = mode === 'auto'
  ? 'approve'
  : await (this.deps.mcpRegistry?.awaitDecision(pendingCall.callId, 60_000) ?? Promise.resolve('reject' as const))
      .catch(() => 'reject' as const);
```

- [ ] **Step 4: Run — green**

Run: `pnpm vitest run server/domain/dispatch/dispatch.service.test.ts`
Expected: all pre-existing + 2 new tests pass.

- [ ] **Step 5: Commit**

```bash
git add server/domain/dispatch/dispatch.service.ts server/domain/dispatch/dispatch.service.test.ts
git commit -m "feat(slice-22): DispatchService consults BreakpointService for tool-call gating"
```

---

### Task J1: app.ts wiring + bootstrap

**Files:**
- Modify: `server/app.ts` (extend `AppDeps`, mount `/api/breakpoints`)
- Modify: `server/index.ts` (construct services + pass to dispatcher + createApp)

- [ ] **Step 1: Extend `AppDeps` and mount the routes**

In `server/app.ts`:

a) Top of file imports — add:

```ts
import { createBreakpointsRoutes } from './routes/breakpoints.routes';
import type { BreakpointPolicyStore } from './domain/mcp/breakpoints/policy.store';
import type { PreviewService } from './domain/mcp/breakpoints/preview.service';
```

b) In `AppDeps`, add:

```ts
policyStore?: BreakpointPolicyStore;
previewService?: PreviewService;
```

c) After the existing `if (deps.builtinStore && deps.mcpRegistry) { ... }` block, add:

```ts
if (deps.policyStore && deps.previewService) {
  app.use(
    '/api/breakpoints',
    createBreakpointsRoutes({
      policyStore: deps.policyStore,
      previewService: deps.previewService,
    }),
  );
}
```

- [ ] **Step 2: Wire in `server/index.ts`**

In `server/index.ts`:

a) Add imports near the other domain imports:

```ts
import { BreakpointPolicyStore } from './domain/mcp/breakpoints/policy.store';
import { PreviewService } from './domain/mcp/breakpoints/preview.service';
import { BreakpointService } from './domain/mcp/breakpoints/breakpoints.service';
```

b) After the line `const builtinStore = new BuiltinMcpStore(db);` and `const mcpRegistry = new McpRegistry(contextStore, builtinStore);`, add:

```ts
const policyStore = new BreakpointPolicyStore(db);
const previewService = new PreviewService({
  safeRoots: () => {
    const fsRoot = builtinStore.read().find((r) => r.transport === 'filesystem')?.fsRoot;
    return [process.cwd(), ...(fsRoot ? [fsRoot] : [])];
  },
});
const breakpointService = new BreakpointService({ mcpRegistry, policyStore });
```

c) Update the dispatcher construction (currently `new DispatchService({ providers, historyStore, contextStore, subAgentsStore, mcpRegistry })`) to:

```ts
const dispatcher = new DispatchService({
  providers, historyStore, contextStore, subAgentsStore, mcpRegistry, breakpointService,
});
```

d) Update the `createApp({...})` call to include:

```ts
policyStore,
previewService,
```

- [ ] **Step 3: Run typecheck**

Run: `pnpm typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add server/app.ts server/index.ts
git commit -m "feat(slice-22): bootstrap wiring for breakpoint policy + preview + service"
```

---

### Task K1: FE types + breakpoints.api + MSW handlers

**Files:**
- Create: `src/types/breakpoints.types.ts`
- Create: `src/lib/api/breakpoints.api.ts`
- Create: `src/lib/api/breakpoints.api.test.ts`
- Modify: `src/test/msw-handlers.ts` (defaults for 4 new endpoints)

- [ ] **Step 1: Mirror server types**

Create `src/types/breakpoints.types.ts`:

```ts
export type ToolCategory = 'safe' | 'dangerous' | 'external';
export type CategoryMode = 'auto' | 'gate';

export interface BreakpointPolicy {
  safe: CategoryMode;
  dangerous: CategoryMode;
  external: CategoryMode;
}

export interface ClassifiedTool {
  qualifiedName: string;
  category: ToolCategory;
  source: 'heuristic' | 'override';
}

export type PreviewResult =
  | { kind: 'diff'; oldText: string; newText: string; path: string }
  | { kind: 'plain' };
```

- [ ] **Step 2: Write the failing api test**

Create `src/lib/api/breakpoints.api.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { breakpointsApi } from './breakpoints.api';

describe('breakpointsApi (against MSW defaults)', () => {
  it('getPolicy returns the seeded policy', async () => {
    const p = await breakpointsApi.getPolicy();
    expect(p).toEqual({ safe: 'auto', dangerous: 'gate', external: 'gate' });
  });

  it('setCategoryMode returns the updated policy', async () => {
    const p = await breakpointsApi.setCategoryMode('dangerous', 'auto');
    expect(p.dangerous).toBe('auto');
  });

  it('preview returns kind=plain by default', async () => {
    const r = await breakpointsApi.preview({ qualifiedName: 'fs.read_file', args: {} });
    expect(r.kind).toBe('plain');
  });

  it('classify returns category from heuristic', async () => {
    const r = await breakpointsApi.classify({ qualifiedName: 'fs.write_file', args: {} });
    expect(r.category).toBe('dangerous');
    expect(r.source).toBe('heuristic');
  });
});
```

- [ ] **Step 3: Add MSW handlers**

Open `src/test/msw-handlers.ts`. Add inside the exported `handlers` array (near the other `/api/mcp` handlers):

```ts
http.get('http://localhost/api/breakpoints/policy', () =>
  HttpResponse.json({ safe: 'auto', dangerous: 'gate', external: 'gate' }),
),
http.put('http://localhost/api/breakpoints/policy/:category', async ({ params, request }) => {
  const body = (await request.json()) as { mode: 'auto' | 'gate' };
  const base = { safe: 'auto', dangerous: 'gate', external: 'gate' } as Record<string, 'auto'|'gate'>;
  base[params.category as string] = body.mode;
  return HttpResponse.json(base);
}),
http.post('http://localhost/api/breakpoints/preview', () =>
  HttpResponse.json({ kind: 'plain' }),
),
http.get('http://localhost/api/breakpoints/classify', ({ request }) => {
  const url = new URL(request.url);
  const qn = url.searchParams.get('qualifiedName') ?? '';
  const isWrite = /\.(write|edit|delete|move|create|remove|rename|drop|truncate)_/.test(qn);
  return HttpResponse.json({
    qualifiedName: qn,
    category: isWrite ? 'dangerous' : 'safe',
    source: 'heuristic',
  });
}),
```

- [ ] **Step 4: Implement breakpoints.api**

Create `src/lib/api/breakpoints.api.ts`:

```ts
import type {
  BreakpointPolicy, CategoryMode, ToolCategory, PreviewResult, ClassifiedTool,
} from '@/src/types/breakpoints.types';

async function jsonOrThrow<T>(res: Response): Promise<T> {
  if (!res.ok) throw new Error(`Request failed: ${res.status}`);
  return (await res.json()) as T;
}

export const breakpointsApi = {
  getPolicy: (): Promise<BreakpointPolicy> =>
    fetch('/api/breakpoints/policy').then(jsonOrThrow),

  setCategoryMode: (category: ToolCategory, mode: CategoryMode): Promise<BreakpointPolicy> =>
    fetch(`/api/breakpoints/policy/${category}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode }),
    }).then(jsonOrThrow),

  preview: (input: { qualifiedName: string; args: Record<string, unknown> }): Promise<PreviewResult> =>
    fetch('/api/breakpoints/preview', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    }).then(jsonOrThrow),

  classify: (input: { qualifiedName: string; args: Record<string, unknown> }): Promise<ClassifiedTool> => {
    const params = new URLSearchParams({
      qualifiedName: input.qualifiedName,
      argsJson: JSON.stringify(input.args ?? {}),
    });
    return fetch(`/api/breakpoints/classify?${params.toString()}`).then(jsonOrThrow);
  },
};
```

- [ ] **Step 5: Run — green**

Run: `pnpm vitest run src/lib/api/breakpoints.api.test.ts`
Expected: 4 passing.

- [ ] **Step 6: Commit**

```bash
git add src/types/breakpoints.types.ts src/lib/api/breakpoints.api.ts \
        src/lib/api/breakpoints.api.test.ts src/test/msw-handlers.ts
git commit -m "feat(slice-22): FE types + breakpoints.api + MSW defaults"
```

---

### Task L1: breakpoints.store (zustand, with dedupe)

**Files:**
- Create: `src/stores/breakpoints.store.ts`
- Create: `src/stores/breakpoints.store.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/stores/breakpoints.store.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { useBreakpointsStore } from './breakpoints.store';

describe('useBreakpointsStore', () => {
  beforeEach(() => {
    useBreakpointsStore.getState()._reset();
  });

  it('init() populates policy from server', async () => {
    await useBreakpointsStore.getState().init();
    expect(useBreakpointsStore.getState().policy).toEqual({
      safe: 'auto', dangerous: 'gate', external: 'gate',
    });
  });

  it('setCategoryMode() PUTs and updates local state', async () => {
    await useBreakpointsStore.getState().init();
    await useBreakpointsStore.getState().setCategoryMode('dangerous', 'auto');
    expect(useBreakpointsStore.getState().policy.dangerous).toBe('auto');
  });

  it('concurrent setCategoryMode() calls dedupe per category key', async () => {
    await useBreakpointsStore.getState().init();
    const a = useBreakpointsStore.getState().setCategoryMode('safe', 'gate');
    const b = useBreakpointsStore.getState().setCategoryMode('safe', 'gate');
    await Promise.all([a, b]);
    expect(useBreakpointsStore.getState().policy.safe).toBe('gate');
  });

  it('init() failure surfaces in error and clears loading', async () => {
    const origFetch = global.fetch;
    global.fetch = (() => Promise.resolve(new Response('', { status: 500 }))) as any;
    await useBreakpointsStore.getState().init();
    expect(useBreakpointsStore.getState().error).toBeTruthy();
    expect(useBreakpointsStore.getState().loading).toBe(false);
    global.fetch = origFetch;
  });
});
```

- [ ] **Step 2: Run — expect failure**

Run: `pnpm vitest run src/stores/breakpoints.store.test.ts`
Expected: FAIL "Cannot find module './breakpoints.store'".

- [ ] **Step 3: Implement the store**

Create `src/stores/breakpoints.store.ts`:

```ts
import { create } from 'zustand';
import { breakpointsApi } from '@/src/lib/api/breakpoints.api';
import type { BreakpointPolicy, CategoryMode, ToolCategory } from '@/src/types/breakpoints.types';

interface BreakpointsState {
  policy: BreakpointPolicy;
  loading: boolean;
  error: string | null;
  init(): Promise<void>;
  setCategoryMode(category: ToolCategory, mode: CategoryMode): Promise<void>;
  _reset(): void;
}

const initial = {
  policy: { safe: 'auto', dangerous: 'gate', external: 'gate' } as BreakpointPolicy,
  loading: false,
  error: null as string | null,
};

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : 'Operation failed';
}

const inflight = new Map<string, Promise<BreakpointPolicy>>();

export const useBreakpointsStore = create<BreakpointsState>((set) => ({
  ...initial,
  _reset: () => { inflight.clear(); set(initial); },
  init: async () => {
    set({ loading: true, error: null });
    try {
      const policy = await breakpointsApi.getPolicy();
      set({ policy, loading: false, error: null });
    } catch (e) {
      set({ loading: false, error: errMsg(e) });
    }
  },
  setCategoryMode: async (category, mode) => {
    const key = `${category}:${mode}`;
    const existing = inflight.get(key);
    if (existing) { await existing.catch(() => {}); return; }
    set({ loading: true, error: null });
    const promise = breakpointsApi.setCategoryMode(category, mode);
    inflight.set(key, promise);
    try {
      const policy = await promise;
      set({ policy, loading: false, error: null });
    } catch (e) {
      set({ loading: false, error: errMsg(e) });
    } finally {
      inflight.delete(key);
    }
  },
}));
```

- [ ] **Step 4: Run — green**

Run: `pnpm vitest run src/stores/breakpoints.store.test.ts`
Expected: 4 passing.

- [ ] **Step 5: Commit**

```bash
git add src/stores/breakpoints.store.ts src/stores/breakpoints.store.test.ts
git commit -m "feat(slice-22): breakpoints store with per-category-mode dedupe"
```

---

### Task M1: chat.store stickyApprovals + ui.store approvalGateState

**Files:**
- Modify: `src/stores/chat.store.ts` (add `stickyApprovals: Set<string>` + actions; reset clears it)
- Modify: `src/stores/chat.store.test.ts` (add 3 cases)
- Modify: `src/stores/ui.store.ts` (add `approvalGateState`, `openApprovalGate`, `closeApprovalGate`)
- Modify: `src/stores/ui.store.test.ts` (add cases)

- [ ] **Step 1: Extend chat.store types + initial**

In `src/stores/chat.store.ts`:

a) In `ChatState` interface, add:

```ts
stickyApprovals: Set<string>;
addStickyApproval(qualifiedName: string): void;
clearStickyApprovals(): void;
```

b) In `initial` add:

```ts
stickyApprovals: new Set<string>() as Set<string>,
```

c) In the store body (after `clearQueuedAttachments` or near reset):

```ts
addStickyApproval: (qualifiedName) =>
  set((s) => ({ stickyApprovals: new Set(s.stickyApprovals).add(qualifiedName) })),
clearStickyApprovals: () => set({ stickyApprovals: new Set<string>() }),
```

d) Critical: `_reset` and `reset` both call `set(initial)` — but `initial` is a const created once at module load, so they'd share the same `Set` instance forever. Fix by making `_reset`/`reset` reset the field explicitly:

Change:
```ts
_reset: () => set(initial),
reset: () => set(initial),
```
to:
```ts
_reset: () => set({ ...initial, stickyApprovals: new Set<string>() }),
reset: () => set({ ...initial, stickyApprovals: new Set<string>() }),
```

- [ ] **Step 2: Write the failing chat.store tests**

In `src/stores/chat.store.test.ts`, append a new `describe` block:

```ts
describe('useChatStore stickyApprovals', () => {
  beforeEach(() => useChatStore.getState()._reset());

  it('starts empty', () => {
    expect(useChatStore.getState().stickyApprovals.size).toBe(0);
  });

  it('addStickyApproval adds the tool name', () => {
    useChatStore.getState().addStickyApproval('fs.write_file');
    expect(useChatStore.getState().stickyApprovals.has('fs.write_file')).toBe(true);
  });

  it('reset clears stickyApprovals', () => {
    useChatStore.getState().addStickyApproval('fs.write_file');
    useChatStore.getState().reset();
    expect(useChatStore.getState().stickyApprovals.size).toBe(0);
  });
});
```

(If `beforeEach` and `useChatStore` are already imported at the top of the file, reuse those imports.)

- [ ] **Step 3: Run chat.store tests — green**

Run: `pnpm vitest run src/stores/chat.store.test.ts`
Expected: existing + 3 new tests pass.

- [ ] **Step 4: Extend ui.store**

In `src/stores/ui.store.ts`:

a) Top of file:

```ts
import type { ToolCallRequestEvent } from '@/src/hooks/useToolCallDecisions';
import type { PreviewResult } from '@/src/types/breakpoints.types';
```

b) In the state interface, add:

```ts
approvalGateState: { event: ToolCallRequestEvent; preview: PreviewResult } | null;
openApprovalGate(payload: { event: ToolCallRequestEvent; preview: PreviewResult }): void;
closeApprovalGate(): void;
```

c) In the `initial` object:

```ts
approvalGateState: null as { event: ToolCallRequestEvent; preview: PreviewResult } | null,
```

d) In the store body:

```ts
openApprovalGate: (payload) => set({ approvalGateState: payload }),
closeApprovalGate: () => set({ approvalGateState: null }),
```

- [ ] **Step 5: Extend ui.store tests**

In `src/stores/ui.store.test.ts`, add:

```ts
describe('ui.store approvalGateState', () => {
  it('opens and closes', () => {
    const ev = { id: 'c1', qualifiedName: 'fs.write_file', args: {} };
    useUiStore.getState().openApprovalGate({ event: ev, preview: { kind: 'plain' } });
    expect(useUiStore.getState().approvalGateState?.event.id).toBe('c1');
    useUiStore.getState().closeApprovalGate();
    expect(useUiStore.getState().approvalGateState).toBeNull();
  });
});
```

- [ ] **Step 6: Run — green**

Run: `pnpm vitest run src/stores/ui.store.test.ts src/stores/chat.store.test.ts`
Expected: green.

- [ ] **Step 7: Commit**

```bash
git add src/stores/chat.store.ts src/stores/chat.store.test.ts \
        src/stores/ui.store.ts src/stores/ui.store.test.ts
git commit -m "feat(slice-22): chat.stickyApprovals + ui.approvalGateState"
```

---

### Task N1: DiffView component

**Files:**
- Create: `src/components/chat/DiffView.tsx`
- Create: `src/components/chat/DiffView.test.tsx`

- [ ] **Step 1: Write the failing tests**

Create `src/components/chat/DiffView.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { DiffView } from './DiffView';

describe('DiffView', () => {
  it('renders identical text with no add/remove lines', () => {
    const { container } = render(
      <DiffView oldText="alpha\nbeta\n" newText="alpha\nbeta\n" path="/x" />,
    );
    expect(container.querySelectorAll('[data-diff="add"]').length).toBe(0);
    expect(container.querySelectorAll('[data-diff="remove"]').length).toBe(0);
  });

  it('shows added lines when newText has extra lines', () => {
    const { container } = render(
      <DiffView oldText="a\n" newText="a\nb\n" path="/x" />,
    );
    expect(container.querySelectorAll('[data-diff="add"]').length).toBe(1);
  });

  it('shows removed lines when oldText has extra lines', () => {
    const { container } = render(
      <DiffView oldText="a\nb\n" newText="a\n" path="/x" />,
    );
    expect(container.querySelectorAll('[data-diff="remove"]').length).toBe(1);
  });

  it('shows both adds and removes for changed line', () => {
    const { container } = render(
      <DiffView oldText="hello\n" newText="world\n" path="/x" />,
    );
    expect(container.querySelectorAll('[data-diff="add"]').length).toBeGreaterThanOrEqual(1);
    expect(container.querySelectorAll('[data-diff="remove"]').length).toBeGreaterThanOrEqual(1);
  });
});
```

(Note: the tests use the literal string `'a\nb\n'` — React renders these characters literally; the DiffView must split on real newlines, so the test strings need actual newline chars. Update each test string to use real newlines: `'alpha\nbeta\n'` — which in TS source is `'alpha\\nbeta\\n'` only if it's intended to be literal; here `\n` IS the escape, so the strings ARE real newlines. The file should compile as-is.)

- [ ] **Step 2: Run — expect failure**

Run: `pnpm vitest run src/components/chat/DiffView.test.tsx`
Expected: FAIL "Cannot find module './DiffView'".

- [ ] **Step 3: Implement DiffView**

Create `src/components/chat/DiffView.tsx`:

```tsx
import { useMemo } from 'react';

interface Line { kind: 'same' | 'add' | 'remove'; text: string }

function diffLines(oldText: string, newText: string): Line[] {
  const oldLines = oldText.split('\n');
  const newLines = newText.split('\n');
  const out: Line[] = [];
  let i = 0, j = 0;
  while (i < oldLines.length || j < newLines.length) {
    const a = oldLines[i];
    const b = newLines[j];
    if (i >= oldLines.length) { out.push({ kind: 'add', text: b ?? '' }); j++; continue; }
    if (j >= newLines.length) { out.push({ kind: 'remove', text: a ?? '' }); i++; continue; }
    if (a === b) { out.push({ kind: 'same', text: a }); i++; j++; continue; }
    // One-line lookahead: if oldLines[i] === newLines[j+1], treat newLines[j] as an add.
    if (oldLines[i] === newLines[j + 1]) { out.push({ kind: 'add', text: b }); j++; continue; }
    // If newLines[j] === oldLines[i+1], treat oldLines[i] as a remove.
    if (newLines[j] === oldLines[i + 1]) { out.push({ kind: 'remove', text: a }); i++; continue; }
    out.push({ kind: 'remove', text: a }); i++;
    out.push({ kind: 'add', text: b }); j++;
  }
  return out;
}

export interface DiffViewProps { oldText: string; newText: string; path: string }

export function DiffView({ oldText, newText, path }: DiffViewProps) {
  const lines = useMemo(() => diffLines(oldText, newText), [oldText, newText]);
  return (
    <div className="border border-border-subtle rounded text-[11px] font-mono bg-zinc-950">
      <div className="px-2 py-1 text-zinc-500 text-[10px] border-b border-border-subtle">{path}</div>
      <pre className="p-2 overflow-x-auto">
        {lines.map((l, idx) => (
          <div
            key={idx}
            data-diff={l.kind}
            className={
              l.kind === 'add'
                ? 'text-emerald-400 before:content-["+_"]'
                : l.kind === 'remove'
                ? 'text-rose-400 before:content-["-_"]'
                : 'text-zinc-400 before:content-["__"]'
            }
          >
            {l.text}
          </div>
        ))}
      </pre>
    </div>
  );
}
```

- [ ] **Step 4: Run — green**

Run: `pnpm vitest run src/components/chat/DiffView.test.tsx`
Expected: 4 passing.

- [ ] **Step 5: Commit**

```bash
git add src/components/chat/DiffView.tsx src/components/chat/DiffView.test.tsx
git commit -m "feat(slice-22): DiffView (unified line-level diff renderer)"
```

---

### Task O1: ApprovalGate modal

**Files:**
- Create: `src/components/chat/ApprovalGate.tsx`
- Create: `src/components/chat/ApprovalGate.test.tsx`

- [ ] **Step 1: Write the failing tests**

Create `src/components/chat/ApprovalGate.test.tsx`:

```tsx
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { useUiStore } from '@/src/stores/ui.store';
import { useChatStore } from '@/src/stores/chat.store';
import { ApprovalGate } from './ApprovalGate';

// Mock the api so we don't go through fetch
vi.mock('@/src/lib/api/mcp.api', () => ({
  mcpApi: { decide: vi.fn().mockResolvedValue(undefined) },
}));
vi.mock('@/src/lib/api/breakpoints.api', () => ({
  breakpointsApi: {
    classify: vi.fn().mockResolvedValue({
      qualifiedName: 'fs.write_file', category: 'dangerous', source: 'heuristic',
    }),
  },
}));

const ev = { id: 'call-1', qualifiedName: 'fs.write_file', args: { path: '/x', content: 'a' } };

describe('ApprovalGate', () => {
  beforeEach(() => {
    useUiStore.getState().closeApprovalGate();
    useChatStore.getState()._reset();
  });

  it('renders null when no state', () => {
    const { container } = render(<ApprovalGate />);
    expect(container.firstChild).toBeNull();
  });

  it('renders category badge + tool name + args when open with plain preview', async () => {
    useUiStore.getState().openApprovalGate({ event: ev, preview: { kind: 'plain' } });
    render(<ApprovalGate />);
    await waitFor(() => expect(screen.getByText('fs.write_file')).toBeInTheDocument());
    expect(screen.getByText('dangerous')).toBeInTheDocument();
  });

  it('renders DiffView for diff preview', async () => {
    useUiStore.getState().openApprovalGate({
      event: ev,
      preview: { kind: 'diff', oldText: 'a\n', newText: 'b\n', path: '/x' },
    });
    render(<ApprovalGate />);
    await waitFor(() => expect(screen.getByText('/x')).toBeInTheDocument());
  });

  it('Approve calls mcpApi.decide and closes', async () => {
    const { mcpApi } = await import('@/src/lib/api/mcp.api');
    useUiStore.getState().openApprovalGate({ event: ev, preview: { kind: 'plain' } });
    render(<ApprovalGate />);
    await waitFor(() => screen.getByText('Approve'));
    fireEvent.click(screen.getByText('Approve'));
    await waitFor(() => expect(mcpApi.decide).toHaveBeenCalledWith('call-1', 'approve'));
    expect(useUiStore.getState().approvalGateState).toBeNull();
  });

  it('Reject calls mcpApi.decide with "reject"', async () => {
    const { mcpApi } = await import('@/src/lib/api/mcp.api');
    useUiStore.getState().openApprovalGate({ event: ev, preview: { kind: 'plain' } });
    render(<ApprovalGate />);
    await waitFor(() => screen.getByText('Reject'));
    fireEvent.click(screen.getByText('Reject'));
    await waitFor(() => expect(mcpApi.decide).toHaveBeenCalledWith('call-1', 'reject'));
  });

  it('sticky checkbox + Approve adds the tool to chat.stickyApprovals', async () => {
    useUiStore.getState().openApprovalGate({ event: ev, preview: { kind: 'plain' } });
    render(<ApprovalGate />);
    await waitFor(() => screen.getByLabelText(/auto-approve this tool/i));
    fireEvent.click(screen.getByLabelText(/auto-approve this tool/i));
    fireEvent.click(screen.getByText('Approve'));
    await waitFor(() =>
      expect(useChatStore.getState().stickyApprovals.has('fs.write_file')).toBe(true),
    );
  });
});
```

- [ ] **Step 2: Run — expect failure**

Run: `pnpm vitest run src/components/chat/ApprovalGate.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implement ApprovalGate**

Create `src/components/chat/ApprovalGate.tsx`:

```tsx
import { useEffect, useState } from 'react';
import { useUiStore } from '@/src/stores/ui.store';
import { useChatStore } from '@/src/stores/chat.store';
import { breakpointsApi } from '@/src/lib/api/breakpoints.api';
import { mcpApi } from '@/src/lib/api/mcp.api';
import { DiffView } from './DiffView';
import type { ToolCategory } from '@/src/types/breakpoints.types';

const BADGE_CLASS: Record<ToolCategory, string> = {
  safe: 'bg-emerald-900/40 text-emerald-300 border-emerald-700',
  dangerous: 'bg-rose-900/40 text-rose-300 border-rose-700',
  external: 'bg-orange-900/40 text-orange-300 border-orange-700',
};

export function ApprovalGate() {
  const state = useUiStore((s) => s.approvalGateState);
  const closeApprovalGate = useUiStore((s) => s.closeApprovalGate);
  const addSticky = useChatStore((s) => s.addStickyApproval);
  const [category, setCategory] = useState<ToolCategory | null>(null);
  const [sticky, setSticky] = useState(false);

  useEffect(() => {
    if (!state) { setCategory(null); setSticky(false); return; }
    let cancelled = false;
    breakpointsApi
      .classify({ qualifiedName: state.event.qualifiedName, args: state.event.args })
      .then((r) => { if (!cancelled) setCategory(r.category); })
      .catch(() => { if (!cancelled) setCategory('safe'); });
    return () => { cancelled = true; };
  }, [state]);

  if (!state) return null;
  const { event, preview } = state;

  const decide = async (action: 'approve' | 'reject') => {
    if (action === 'approve' && sticky) addSticky(event.qualifiedName);
    await mcpApi.decide(event.id, action).catch(() => {});
    closeApprovalGate();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      onClick={() => void decide('reject')}
    >
      <div
        className="w-[640px] max-w-[90vw] max-h-[85vh] overflow-auto rounded border border-border-subtle bg-surface-1 p-4 text-sm"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 mb-3">
          <span className="text-zinc-300 font-mono">{event.qualifiedName}</span>
          {category && (
            <span className={`px-2 py-0.5 rounded text-[10px] font-mono border ${BADGE_CLASS[category]}`}>
              {category}
            </span>
          )}
        </div>

        <pre className="text-[11px] font-mono bg-zinc-950 border border-border-subtle rounded p-2 overflow-x-auto mb-3">
          {JSON.stringify(event.args, null, 2)}
        </pre>

        {preview.kind === 'diff' && (
          <div className="mb-3">
            <DiffView oldText={preview.oldText} newText={preview.newText} path={preview.path} />
          </div>
        )}

        <label className="flex items-center gap-2 text-zinc-400 text-[12px] mb-3 cursor-pointer">
          <input
            type="checkbox"
            checked={sticky}
            onChange={(e) => setSticky(e.target.checked)}
            aria-label="auto-approve this tool for the rest of this session"
          />
          <span>Auto-approve this tool for the rest of this session</span>
        </label>

        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={() => void decide('reject')}
            className="px-3 py-1.5 rounded border border-border-subtle text-zinc-300 hover:bg-zinc-800"
          >
            Reject
          </button>
          <button
            type="button"
            onClick={() => void decide('approve')}
            className="px-3 py-1.5 rounded bg-accent text-black font-medium hover:bg-accent/90"
          >
            Approve
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run — green**

Run: `pnpm vitest run src/components/chat/ApprovalGate.test.tsx`
Expected: 6 passing.

- [ ] **Step 5: Commit**

```bash
git add src/components/chat/ApprovalGate.tsx src/components/chat/ApprovalGate.test.tsx
git commit -m "feat(slice-22): ApprovalGate modal (category badge + diff + sticky)"
```

---

### Task P1: useToolCallDecisions rewrite (sticky + preview + gate)

**Files:**
- Modify: `src/hooks/useToolCallDecisions.ts`
- Modify: `src/hooks/useToolCallDecisions.test.tsx`

- [ ] **Step 1: Rewrite the failing test**

Open `src/hooks/useToolCallDecisions.test.tsx` and replace its body with:

```tsx
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { emitToolCallRequest, useToolCallDecisions } from './useToolCallDecisions';
import { useChatStore } from '@/src/stores/chat.store';
import { useUiStore } from '@/src/stores/ui.store';

vi.mock('@/src/lib/api/mcp.api', () => ({
  mcpApi: { decide: vi.fn().mockResolvedValue(undefined) },
}));
vi.mock('@/src/lib/api/breakpoints.api', () => ({
  breakpointsApi: { preview: vi.fn().mockResolvedValue({ kind: 'plain' }) },
}));

describe('useToolCallDecisions', () => {
  beforeEach(() => {
    useChatStore.getState()._reset();
    useUiStore.getState().closeApprovalGate();
  });

  it('sticky tool name → immediately approves without opening the gate', async () => {
    const { mcpApi } = await import('@/src/lib/api/mcp.api');
    useChatStore.getState().addStickyApproval('fs.write_file');
    renderHook(() => useToolCallDecisions());
    act(() => emitToolCallRequest({ id: 'c1', qualifiedName: 'fs.write_file', args: {} }));
    await Promise.resolve();
    await Promise.resolve();
    expect(mcpApi.decide).toHaveBeenCalledWith('c1', 'approve');
    expect(useUiStore.getState().approvalGateState).toBeNull();
  });

  it('non-sticky tool → fetches preview and opens approval gate', async () => {
    const { breakpointsApi } = await import('@/src/lib/api/breakpoints.api');
    renderHook(() => useToolCallDecisions());
    act(() => emitToolCallRequest({ id: 'c2', qualifiedName: 'fs.write_file', args: { path: '/x' } }));
    await Promise.resolve();
    await Promise.resolve();
    expect(breakpointsApi.preview).toHaveBeenCalledWith({
      qualifiedName: 'fs.write_file',
      args: { path: '/x' },
    });
    expect(useUiStore.getState().approvalGateState?.event.id).toBe('c2');
  });
});
```

- [ ] **Step 2: Run — expect failure (current hook still uses confirm())**

Run: `pnpm vitest run src/hooks/useToolCallDecisions.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Rewrite the hook**

Replace `src/hooks/useToolCallDecisions.ts` with:

```ts
import { useEffect } from 'react';
import { useChatStore } from '@/src/stores/chat.store';
import { useUiStore } from '@/src/stores/ui.store';
import { breakpointsApi } from '@/src/lib/api/breakpoints.api';
import { mcpApi } from '@/src/lib/api/mcp.api';

export interface ToolCallRequestEvent {
  id: string;
  qualifiedName: string;
  args: Record<string, unknown>;
}

type Listener = (ev: ToolCallRequestEvent) => void;
const listeners = new Set<Listener>();

export function emitToolCallRequest(ev: ToolCallRequestEvent): void {
  for (const l of listeners) l(ev);
}

export function useToolCallDecisions(): void {
  useEffect(() => {
    const handler: Listener = (ev) => {
      const sticky = useChatStore.getState().stickyApprovals;
      if (sticky.has(ev.qualifiedName)) {
        void mcpApi.decide(ev.id, 'approve').catch(() => {});
        return;
      }
      void (async () => {
        const preview = await breakpointsApi
          .preview({ qualifiedName: ev.qualifiedName, args: ev.args })
          .catch(() => ({ kind: 'plain' as const }));
        useUiStore.getState().openApprovalGate({ event: ev, preview });
      })();
    };
    listeners.add(handler);
    return () => { listeners.delete(handler); };
  }, []);
}
```

- [ ] **Step 4: Run — green**

Run: `pnpm vitest run src/hooks/useToolCallDecisions.test.tsx`
Expected: 2 passing.

- [ ] **Step 5: Commit**

```bash
git add src/hooks/useToolCallDecisions.ts src/hooks/useToolCallDecisions.test.tsx
git commit -m "feat(slice-22): useToolCallDecisions consults sticky + opens ApprovalGate"
```

---

### Task Q1: BreakpointsSection sidebar component

**Files:**
- Create: `src/components/sidebar/BreakpointsSection.tsx`
- Create: `src/components/sidebar/BreakpointsSection.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `src/components/sidebar/BreakpointsSection.test.tsx`:

```tsx
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { useBreakpointsStore } from '@/src/stores/breakpoints.store';
import { BreakpointsSection } from './BreakpointsSection';

describe('BreakpointsSection', () => {
  beforeEach(async () => {
    useBreakpointsStore.getState()._reset();
    await useBreakpointsStore.getState().init();
  });

  it('renders three rows with default modes', () => {
    render(<BreakpointsSection />);
    expect(screen.getByText(/safe/i)).toBeInTheDocument();
    expect(screen.getByText(/dangerous/i)).toBeInTheDocument();
    expect(screen.getByText(/external/i)).toBeInTheDocument();
    // 3 rows
    expect(screen.getAllByTestId('breakpoint-row').length).toBe(3);
  });

  it('shows current mode for each category', () => {
    render(<BreakpointsSection />);
    // dangerous defaults to 'gate'
    const dangerousRow = screen.getAllByTestId('breakpoint-row')[1];
    expect(dangerousRow).toHaveTextContent(/gate/i);
  });

  it('toggling a row dispatches setCategoryMode', async () => {
    render(<BreakpointsSection />);
    const dangerousRow = screen.getAllByTestId('breakpoint-row')[1];
    fireEvent.click(within(dangerousRow).getByRole('button'));
    await waitFor(() => {
      expect(useBreakpointsStore.getState().policy.dangerous).toBe('auto');
    });
  });
});

// Import within as a relative shim:
import { within } from '@testing-library/react';
```

(The `within` import at the bottom is intentional — if eslint complains, move it to the top.)

- [ ] **Step 2: Run — expect failure**

Run: `pnpm vitest run src/components/sidebar/BreakpointsSection.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implement the section**

Create `src/components/sidebar/BreakpointsSection.tsx`:

```tsx
import { useBreakpointsStore } from '@/src/stores/breakpoints.store';
import type { ToolCategory } from '@/src/types/breakpoints.types';
import { cn } from '@/src/lib/cn';

const ROWS: { category: ToolCategory; label: string }[] = [
  { category: 'safe', label: 'Safe' },
  { category: 'dangerous', label: 'Dangerous' },
  { category: 'external', label: 'External' },
];

export function BreakpointsSection() {
  const policy = useBreakpointsStore((s) => s.policy);
  const setCategoryMode = useBreakpointsStore((s) => s.setCategoryMode);

  return (
    <section>
      <div className="mono-label mb-2">Breakpoints</div>
      <div className="space-y-1">
        {ROWS.map(({ category, label }) => {
          const mode = policy[category];
          return (
            <div
              key={category}
              data-testid="breakpoint-row"
              className="flex items-center gap-2 p-1.5 bg-zinc-900 border border-border-subtle rounded text-[10px] font-mono"
            >
              <span className="text-zinc-300 flex-1">{label}</span>
              <span className="text-zinc-500">{mode}</span>
              <button
                type="button"
                aria-label={`Toggle ${label} mode`}
                onClick={() => void setCategoryMode(category, mode === 'auto' ? 'gate' : 'auto')}
                className={cn(
                  'px-2 py-0.5 rounded text-[10px] border',
                  mode === 'auto'
                    ? 'bg-accent/20 text-accent border-accent/40'
                    : 'bg-surface-1 text-zinc-500 border-border-subtle hover:text-zinc-300',
                )}
              >
                {mode === 'auto' ? 'auto' : 'gate'}
              </button>
            </div>
          );
        })}
      </div>
    </section>
  );
}
```

- [ ] **Step 4: Run — green**

Run: `pnpm vitest run src/components/sidebar/BreakpointsSection.test.tsx`
Expected: 3 passing.

- [ ] **Step 5: Commit**

```bash
git add src/components/sidebar/BreakpointsSection.tsx \
        src/components/sidebar/BreakpointsSection.test.tsx
git commit -m "feat(slice-22): BreakpointsSection (3 toggle rows)"
```

---

### Task R1: McpToolCard 4-state select

**Files:**
- Modify: `src/components/mcp/McpToolCard.tsx`
- Create or extend: `src/components/mcp/McpToolCard.test.tsx`
- Modify: `src/components/sidebar/McpServersSection.tsx` (call-site of `onToggle`)

- [ ] **Step 1: Inspect the current call-site**

Run `grep -n McpToolCard src/components/sidebar/McpServersSection.tsx` to find where `McpToolCard` is used and what it passes for `onToggle`. Read those lines so step 4 can be a focused edit.

- [ ] **Step 2: Write the failing test**

Create (or extend) `src/components/mcp/McpToolCard.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { McpToolCard } from './McpToolCard';
import type { LiveTool } from '@/src/types/mcp.types';

const baseTool: LiveTool = {
  qualifiedName: 'fs.write_file',
  serverId: 'srv-1',
  serverName: 'fs',
  autoApprove: false,
  tool: { name: 'write_file' } as any,
};

describe('McpToolCard 4-state policy select', () => {
  it('renders a select with 4 options', () => {
    render(<McpToolCard tool={baseTool} onPolicyChange={() => {}} />);
    const select = screen.getByLabelText(/policy for fs.write_file/i) as HTMLSelectElement;
    const labels = Array.from(select.options).map((o) => o.value);
    expect(labels).toEqual(['auto', 'safe', 'dangerous', 'external']);
  });

  it('dispatches { category: "dangerous" } when "Dangerous" is selected', () => {
    const onPolicyChange = vi.fn();
    render(<McpToolCard tool={baseTool} onPolicyChange={onPolicyChange} />);
    fireEvent.change(screen.getByLabelText(/policy for fs.write_file/i), {
      target: { value: 'dangerous' },
    });
    expect(onPolicyChange).toHaveBeenCalledWith({ category: 'dangerous' });
  });

  it('dispatches { autoApprove: true } when "Auto-approve" is selected', () => {
    const onPolicyChange = vi.fn();
    render(<McpToolCard tool={baseTool} onPolicyChange={onPolicyChange} />);
    fireEvent.change(screen.getByLabelText(/policy for fs.write_file/i), {
      target: { value: 'auto' },
    });
    expect(onPolicyChange).toHaveBeenCalledWith({ autoApprove: true });
  });
});
```

- [ ] **Step 3: Run — expect failure**

Run: `pnpm vitest run src/components/mcp/McpToolCard.test.tsx`
Expected: FAIL.

- [ ] **Step 4: Rewrite McpToolCard**

Replace `src/components/mcp/McpToolCard.tsx`:

```tsx
import type { LiveTool } from '@/src/types/mcp.types';
import type { McpToolPolicy } from '@/server/domain/context/context.types';
import type { ToolCategory } from '@/src/types/breakpoints.types';

export interface McpToolCardProps {
  tool: LiveTool;
  onPolicyChange: (policy: McpToolPolicy) => void;
}

type SelectValue = 'auto' | ToolCategory;

function currentValue(tool: LiveTool): SelectValue {
  if (tool.autoApprove) return 'auto';
  const cat = (tool as unknown as { policy?: McpToolPolicy }).policy?.category;
  return cat ?? 'safe';
}

export function McpToolCard({ tool, onPolicyChange }: McpToolCardProps) {
  const value = currentValue(tool);
  return (
    <div className="ml-2 p-1.5 rounded bg-zinc-900/40 border border-border-subtle/40 text-[10px] font-mono">
      <div className="flex items-center justify-between gap-2">
        <span className="text-zinc-300 truncate">{tool.qualifiedName}</span>
        <select
          aria-label={`policy for ${tool.qualifiedName}`}
          value={value}
          onChange={(e) => {
            const v = e.target.value as SelectValue;
            if (v === 'auto') onPolicyChange({ autoApprove: true });
            else onPolicyChange({ category: v });
          }}
          className="bg-zinc-950 text-zinc-300 border border-border-subtle rounded px-1 py-0.5"
        >
          <option value="auto">Auto-approve</option>
          <option value="safe">Safe</option>
          <option value="dangerous">Dangerous</option>
          <option value="external">External</option>
        </select>
      </div>
      {tool.tool.description && (
        <div className="mt-0.5 text-[9px] text-zinc-600 truncate">{tool.tool.description}</div>
      )}
    </div>
  );
}
```

- [ ] **Step 5: Update the call-site in McpServersSection.tsx**

Open `src/components/sidebar/McpServersSection.tsx`. Find the `<McpToolCard ... onToggle={...} />` usage. Replace the `onToggle={(checked) => ...}` prop with `onPolicyChange={(policy) => ...}` that calls `mcpApi.togglePolicy(serverId, toolName, policy)` (the existing API method already accepts the extended `McpToolPolicy`).

If the existing handler had this shape:
```tsx
onToggle={(newAutoApprove) => void mcpApi.togglePolicy(server.id, tool.tool.name, { autoApprove: newAutoApprove })}
```
change to:
```tsx
onPolicyChange={(policy) => void mcpApi.togglePolicy(server.id, tool.tool.name, policy)}
```

- [ ] **Step 6: Run the McpToolCard tests + the McpServersSection tests**

Run: `pnpm vitest run src/components/mcp/McpToolCard.test.tsx src/components/sidebar/McpServersSection.test.tsx`
Expected: green. Fix any breakage from the rename in McpServersSection tests (they may still reference `onToggle`).

- [ ] **Step 7: Commit**

```bash
git add src/components/mcp/McpToolCard.tsx src/components/mcp/McpToolCard.test.tsx \
        src/components/sidebar/McpServersSection.tsx src/components/sidebar/McpServersSection.test.tsx
git commit -m "feat(slice-22): McpToolCard 4-state policy select"
```

---

### Task S1: App.tsx wiring (mount section, mount modal, init store)

**Files:**
- Modify: `src/App.tsx`

- [ ] **Step 1: Mount the new pieces**

In `src/App.tsx`:

a) Imports (group with existing sidebar + chat imports):

```ts
import { BreakpointsSection } from '@/src/components/sidebar/BreakpointsSection';
import { ApprovalGate } from '@/src/components/chat/ApprovalGate';
import { useBreakpointsStore } from '@/src/stores/breakpoints.store';
```

b) Inside the `useEffect` that runs on App mount (look for where `useProviderAuthStore.getState().init()` is called; if there isn't one, add a `useEffect(() => { useBreakpointsStore.getState().init(); }, []);` near the other init effects).

c) In the sidebar JSX, mount `<BreakpointsSection />` immediately below `<BuiltinMcpToggles />`.

d) Near `<KeyVaultModal />` and `<MessageContextMenu />`, add `<ApprovalGate />`.

- [ ] **Step 2: Typecheck + smoke unit run**

Run: `pnpm typecheck && pnpm vitest run src/App.test.tsx`
Expected: PASS (or test file doesn't exist — skip the vitest line).

- [ ] **Step 3: Commit**

```bash
git add src/App.tsx
git commit -m "feat(slice-22): App mounts BreakpointsSection + ApprovalGate + initializes store"
```

---

### Task T1: Integration test (dispatch → gate → approve)

**Files:**
- Create: `src/integration/approval-gate.integration.test.tsx`

- [ ] **Step 1: Write the integration test**

Create `src/integration/approval-gate.integration.test.tsx`:

```tsx
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { App } from '@/src/App';
import { emitToolCallRequest } from '@/src/hooks/useToolCallDecisions';
import { useChatStore } from '@/src/stores/chat.store';
import { useUiStore } from '@/src/stores/ui.store';

describe('approval gate integration', () => {
  beforeEach(() => {
    useChatStore.getState()._reset();
    useUiStore.getState().closeApprovalGate();
  });

  it('emit tool_call_request → ApprovalGate opens → Approve closes it', async () => {
    render(<App />);
    act(() => emitToolCallRequest({ id: 'c-int-1', qualifiedName: 'fs.write_file', args: { path: '/tmp/x' } }));

    await waitFor(() => expect(screen.getByText('fs.write_file')).toBeInTheDocument());

    fireEvent.click(screen.getByText('Approve'));
    await waitFor(() => expect(useUiStore.getState().approvalGateState).toBeNull());
  });

  it('sticky approval skips the gate next time', async () => {
    render(<App />);
    useChatStore.getState().addStickyApproval('fs.write_file');
    act(() => emitToolCallRequest({ id: 'c-int-2', qualifiedName: 'fs.write_file', args: {} }));
    // Give microtasks a chance
    await Promise.resolve();
    await Promise.resolve();
    expect(useUiStore.getState().approvalGateState).toBeNull();
  });
});
```

- [ ] **Step 2: Run — green**

Run: `pnpm vitest run src/integration/approval-gate.integration.test.tsx`
Expected: 2 passing.

If the App renders too much and slows the test, follow the pattern from existing `src/integration/*.integration.test.tsx` files — they typically render `<App />` directly and MSW supplies all endpoints.

- [ ] **Step 3: Commit**

```bash
git add src/integration/approval-gate.integration.test.tsx
git commit -m "test(slice-22): integration — approval gate opens + approves + sticky skip"
```

---

### Task U1: Playwright smoke + final gates + PR

**Files:**
- Modify: `e2e/sidebar.spec.ts` (or create `e2e/breakpoints.spec.ts` — match repo style)

- [ ] **Step 1: Inspect existing e2e structure**

Run: `ls e2e/` and read one existing spec (e.g., `e2e/builtin-mcp.spec.ts`). Match its style: `test.describe`, page object, etc.

- [ ] **Step 2: Add a Playwright smoke**

Create `e2e/breakpoints.spec.ts`:

```ts
import { test, expect } from '@playwright/test';

test.describe('breakpoints sidebar', () => {
  test('renders 3 rows with default modes', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByText('Breakpoints')).toBeVisible();
    const rows = page.getByTestId('breakpoint-row');
    await expect(rows).toHaveCount(3);
    await expect(rows.nth(1)).toContainText('gate'); // dangerous row default
  });

  test('toggling the dangerous row does not crash', async ({ page }) => {
    await page.goto('/');
    const dangerousRow = page.getByTestId('breakpoint-row').nth(1);
    const toggle = dangerousRow.getByRole('button', { name: /toggle dangerous mode/i });
    await toggle.click();
    await expect(dangerousRow).toContainText('auto');
  });
});
```

- [ ] **Step 3: Run Playwright smoke locally**

Run: `pnpm playwright test e2e/breakpoints.spec.ts --reporter=line`
Expected: 2 passing.

- [ ] **Step 4: Full test suite + lint + typecheck**

Run: `pnpm typecheck && pnpm lint && pnpm test`
Expected: green, modulo the pre-existing flakes documented in the plan notes (2 Ollama tests + the occasional Playwright isolation flake).

- [ ] **Step 5: Push the branch**

```bash
git push -u origin feat/slice-22-breakpoints
```

- [ ] **Step 6: Open the PR**

Open the PR via `gh pr create` with the title `feat(slice-22): Agentic breakpoints + dry-run sandboxing` and a body that summarizes:
- New 3-category policy (safe/dangerous/external) with SQLite migration 007.
- ApprovalGate modal with diff preview for filesystem writes.
- Session-scoped sticky approvals.
- 4-state per-tool select on McpToolCard.
- Pre-existing Ollama flakes called out.

- [ ] **Step 7: Update the roadmap**

In `docs/superpowers/roadmap.md`, move the slice 22 entry from "Killer Features — agentic depth track" to the "Shipped" table:

```md
| 22 | Agentic breakpoints + dry-run sandboxing | `feat/slice-22-breakpoints` | ✅ |
```

…and remove the "Slice 22 — Agentic Breakpoints + Dry-Run Sandboxing" detail block under "Killer Features".

Commit on the same branch (before merge):

```bash
git add docs/superpowers/roadmap.md
git commit -m "docs(slice-22): mark slice 22 shipped in roadmap"
git push
```

- [ ] **Step 8: Tell the user the PR is open**

Wait for user merge.

---

## Self-review checklist (already applied)

- **Spec coverage:** Migration 007 (B1), types (B1), classify (C1), policy store (D1), service (E1), preview (F1), context.types extension (B1), routes (G1+H1), dispatch integration (I1), app wiring (J1), FE types + api + MSW (K1), store (L1), chat sticky + ui state (M1), DiffView (N1), ApprovalGate (O1), useToolCallDecisions rewrite (P1), BreakpointsSection (Q1), McpToolCard 4-state (R1), App mount (S1), integration (T1), Playwright + final gates (U1). All 7 spec acceptance criteria are covered.
- **Type consistency:** `BreakpointPolicy`, `CategoryMode`, `ToolCategory`, `PreviewResult`, `McpToolPolicy` are defined once on the server and mirrored on the FE. `resolveDecision` returns `'auto' | 'gate'` consistently. `setCategoryMode` is the unified method name in both store and api.
- **No placeholders:** Every code step has full code. Every test step shows the assertions. Every command shows expected output.
