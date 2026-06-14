# Git Changes Pane Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A human-driven working-tree source-control "Changes pane" (status / stage / unstage / discard / commit / commit & push) as a sub-tab of the git view.

**Architecture:** Reuses the slice-27 `GitService` + git runner (no allowlist change — `status/diff/add/commit/restore/push` already permitted) and the shared `UnifiedDiff`. A pure `parseStatusPorcelain` (in the isomorphic `git-swimlanes` lib, next to `parseLog`) turns `git status --porcelain=v2` into a structured `WorkingChanges`; per-file diffs are fetched on demand. New HTTP routes are human-initiated → **no breakpoint gate**. A dedicated `gitChanges.store` holds the pane state. The git view gains an internal `[History | Changes]` tab (`mainView` `'history'`→`'git'`).

**Tech Stack:** Express/SQLite backend, React 19 + Zustand, Vitest. Tests use a temp git repo (+ a local bare repo for push) — no network.

**Spec:** `docs/superpowers/specs/2026-06-14-git-changes-pane-design.md`

---

## Branch

```bash
git checkout main
git checkout -b feat/git-changes-pane
```
(The spec commit is on local `main`; this branch includes it.)

---

## Task 1: Extract a shared configured-remote guard

`configuredRemotes` and `badRef` currently live inside `aether-git.handler.ts`. The new `GitService.push` needs them too — extract to a shared module reused by both (DRY).

**Files:**
- Create: `server/domain/git/remote-guard.ts`
- Modify: `server/mcp/builtin/aether-git.handler.ts:22-25,50-58`
- Test: `server/domain/git/remote-guard.test.ts`

- [ ] **Step 1: Write the failing test** — `server/domain/git/remote-guard.test.ts`:

```ts
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { badRef, configuredRemotes } from './remote-guard';

describe('remote-guard', () => {
  it('badRef rejects URLs, dashes, empty, and non-strings', () => {
    expect(badRef('origin')).toBe(false);
    expect(badRef('feature/x')).toBe(false);
    expect(badRef('https://evil/x')).toBe(true);
    expect(badRef('git@host:x')).toBe(true);
    expect(badRef('-x')).toBe(true);
    expect(badRef('')).toBe(true);
    expect(badRef(42)).toBe(true);
  });

  it('configuredRemotes lists the repo remotes', () => {
    const dir = mkdtempSync(join(tmpdir(), 'aether-rg-'));
    try {
      execFileSync('git', ['init', '-q', dir], { stdio: 'pipe' });
      execFileSync('git', ['-C', dir, 'remote', 'add', 'origin', '/tmp/x'], { stdio: 'pipe' });
      return configuredRemotes(dir).then((set) => {
        expect(set.has('origin')).toBe(true);
        expect(set.has('upstream')).toBe(false);
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run --project backend server/domain/git/remote-guard.test.ts`
Expected: FAIL — module `./remote-guard` not found.

- [ ] **Step 3: Create the shared module** — `server/domain/git/remote-guard.ts`:

```ts
import { runGit } from '@/server/domain/git/git.runner';

/** Validates a remote/branch/ref name. The charset excludes ':' so URLs are rejected. */
export function badRef(s: unknown): boolean {
  return typeof s !== 'string' || s.length === 0 || !/^[\w./-]+$/.test(s);
}

/** Lists the names of remotes configured in the repo (e.g. `origin`). */
export async function configuredRemotes(cwd: string): Promise<Set<string>> {
  try {
    const r = await runGit(['remote'], cwd);
    return new Set(r.stdout.split('\n').map((s) => s.trim()).filter(Boolean));
  } catch {
    return new Set();
  }
}
```

- [ ] **Step 4: Use it in the handler** — in `server/mcp/builtin/aether-git.handler.ts`: delete the local `badRef` (lines 22-25) and `configuredRemotes` (lines 50-58), and add to the imports at the top:

```ts
import { badRef, configuredRemotes } from '@/server/domain/git/remote-guard';
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run --project backend server/domain/git server/mcp/builtin && npm run lint`
Expected: PASS (remote-guard tests green; aether-git handler tests still green; lint clean).

- [ ] **Step 6: Commit**

```bash
git add server/domain/git/remote-guard.ts server/domain/git/remote-guard.test.ts server/mcp/builtin/aether-git.handler.ts
git commit -m "refactor(git): extract shared configured-remote guard (badRef + configuredRemotes)"
```

---

## Task 2: Porcelain v2 parser (shared lib)

**Files:**
- Modify: `src/lib/git-swimlanes/types.ts` (add types)
- Create: `src/lib/git-swimlanes/status.ts`
- Modify: `src/lib/git-swimlanes/index.ts` (re-export)
- Test: `src/lib/git-swimlanes/status.test.ts`

- [ ] **Step 1: Add the types** — append to `src/lib/git-swimlanes/types.ts`:

```ts
export type WorkingFileStatus =
  | 'modified' | 'added' | 'deleted' | 'renamed' | 'copied' | 'typechange'
  | 'untracked' | 'conflicted';

export interface WorkingFile {
  path: string;
  oldPath?: string;
  status: WorkingFileStatus;
}

export interface WorkingChanges {
  staged: WorkingFile[];
  unstaged: WorkingFile[];
  untracked: WorkingFile[];
  conflicted: WorkingFile[];
  branch?: string;
  ahead?: number;
  behind?: number;
}
```

- [ ] **Step 2: Write the failing test** — `src/lib/git-swimlanes/status.test.ts`:

```ts
import { parseStatusPorcelain } from './status';

describe('parseStatusPorcelain', () => {
  it('parses branch header + ahead/behind', () => {
    const r = parseStatusPorcelain('# branch.head main\n# branch.ab +2 -1\n');
    expect(r.branch).toBe('main');
    expect(r.ahead).toBe(2);
    expect(r.behind).toBe(1);
  });

  it('splits staged (X) and unstaged (Y) from ordinary "1" lines', () => {
    // X=M (staged modified), Y=. → staged only
    const staged = parseStatusPorcelain('1 M. N... 100644 100644 100644 aaa bbb a.txt\n');
    expect(staged.staged).toEqual([{ path: 'a.txt', status: 'modified' }]);
    expect(staged.unstaged).toEqual([]);
    // X=. Y=M → unstaged only
    const unstaged = parseStatusPorcelain('1 .M N... 100644 100644 100644 aaa bbb b.txt\n');
    expect(unstaged.unstaged).toEqual([{ path: 'b.txt', status: 'modified' }]);
    expect(unstaged.staged).toEqual([]);
  });

  it('handles a file both staged and modified', () => {
    const r = parseStatusPorcelain('1 MM N... 100644 100644 100644 aaa bbb c.txt\n');
    expect(r.staged).toEqual([{ path: 'c.txt', status: 'modified' }]);
    expect(r.unstaged).toEqual([{ path: 'c.txt', status: 'modified' }]);
  });

  it('parses untracked, deleted, renamed (with oldPath), conflicted', () => {
    const text = [
      '? new.txt',
      '1 D. N... 100644 000000 000000 aaa bbb gone.txt',
      '2 R. N... 100644 100644 100644 aaa bbb R100 newname.txt\toldname.txt',
      'u UU N... 100644 100644 100644 100644 a b c conflict.txt',
    ].join('\n');
    const r = parseStatusPorcelain(text);
    expect(r.untracked).toEqual([{ path: 'new.txt', status: 'untracked' }]);
    expect(r.staged).toContainEqual({ path: 'gone.txt', status: 'deleted' });
    expect(r.staged).toContainEqual({ path: 'newname.txt', oldPath: 'oldname.txt', status: 'renamed' });
    expect(r.conflicted).toEqual([{ path: 'conflict.txt', status: 'conflicted' }]);
  });

  it('returns all-empty for a clean repo', () => {
    const r = parseStatusPorcelain('# branch.head main\n# branch.ab +0 -0\n');
    expect(r.staged).toEqual([]);
    expect(r.unstaged).toEqual([]);
    expect(r.untracked).toEqual([]);
    expect(r.conflicted).toEqual([]);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run --project frontend src/lib/git-swimlanes/status.test.ts`
Expected: FAIL — `./status` not found.

- [ ] **Step 4: Implement the parser** — `src/lib/git-swimlanes/status.ts`:

```ts
import type { WorkingChanges, WorkingFile, WorkingFileStatus } from './types';

const STATUS_MAP: Record<string, WorkingFileStatus> = {
  M: 'modified', A: 'added', D: 'deleted', T: 'typechange', R: 'renamed', C: 'copied',
};
function mapStatus(c: string): WorkingFileStatus {
  return STATUS_MAP[c] ?? 'modified';
}

/** Parse `git status --porcelain=v2 --branch` output into a structured WorkingChanges. */
export function parseStatusPorcelain(text: string): WorkingChanges {
  const out: WorkingChanges = { staged: [], unstaged: [], untracked: [], conflicted: [] };

  for (const raw of text.replace(/\r/g, '').split('\n')) {
    if (!raw) continue;

    if (raw.startsWith('# branch.head ')) {
      const h = raw.slice('# branch.head '.length).trim();
      if (h && h !== '(detached)') out.branch = h;
      continue;
    }
    if (raw.startsWith('# branch.ab ')) {
      const m = raw.match(/\+(\d+)\s+-(\d+)/);
      if (m) { out.ahead = parseInt(m[1], 10); out.behind = parseInt(m[2], 10); }
      continue;
    }
    if (raw.startsWith('# ')) continue;

    if (raw.startsWith('? ')) {
      out.untracked.push({ path: raw.slice(2), status: 'untracked' });
      continue;
    }
    if (raw.startsWith('! ')) continue; // ignored entries

    // Ordinary changed entry: 1 <XY> <sub> <mH> <mI> <mW> <hH> <hI> <path>
    let m = raw.match(/^1 (..) \S+ \S+ \S+ \S+ \S+ \S+ (.+)$/);
    if (m) {
      pushXY(out, m[1], m[2], undefined);
      continue;
    }
    // Rename/copy entry: 2 <XY> ... <Xscore> <path>\t<origPath>
    m = raw.match(/^2 (..) \S+ \S+ \S+ \S+ \S+ \S+ \S+ (.+)$/);
    if (m) {
      const tab = m[2].indexOf('\t');
      const path = tab >= 0 ? m[2].slice(0, tab) : m[2];
      const oldPath = tab >= 0 ? m[2].slice(tab + 1) : undefined;
      pushXY(out, m[1], path, oldPath);
      continue;
    }
    // Unmerged (conflict): u <XY> ... <path>
    m = raw.match(/^u .. \S+ \S+ \S+ \S+ \S+ \S+ \S+ \S+ (.+)$/);
    if (m) {
      out.conflicted.push({ path: m[1], status: 'conflicted' });
      continue;
    }
  }

  return out;
}

function pushXY(out: WorkingChanges, xy: string, path: string, oldPath: string | undefined): void {
  const file = (c: string): WorkingFile => (oldPath ? { path, oldPath, status: mapStatus(c) } : { path, status: mapStatus(c) });
  const X = xy[0];
  const Y = xy[1];
  if (X !== '.') out.staged.push(file(X));
  if (Y !== '.') out.unstaged.push(file(Y));
}
```

- [ ] **Step 5: Re-export** — add to `src/lib/git-swimlanes/index.ts`:

```ts
export { parseStatusPorcelain } from './status';
export type { WorkingFile, WorkingFileStatus, WorkingChanges } from './types';
```

- [ ] **Step 6: Run test + lint**

Run: `npx vitest run --project frontend src/lib/git-swimlanes/status.test.ts && npm run lint`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/lib/git-swimlanes/types.ts src/lib/git-swimlanes/status.ts src/lib/git-swimlanes/status.test.ts src/lib/git-swimlanes/index.ts
git commit -m "feat(git-changes): porcelain v2 working-tree status parser"
```

---

## Task 3: GitService working-tree methods

**Files:**
- Modify: `server/domain/git/git.service.ts`
- Test: `server/domain/git/git.service.test.ts`

- [ ] **Step 1: Write the failing test** — append to `server/domain/git/git.service.test.ts` (reuse its existing temp-repo fixture helpers — `git()`, `mkdtempSync`, etc.; build a `WorkspacesStore` stub mapping a known id → the repo). If a bare-remote helper is not present, add one mirroring slice-29's pattern:

```ts
describe('GitService — working tree (changes pane)', () => {
  // Reuse the file's existing helpers: a fake WorkspacesStore `store` mapping
  // 'ws1' → { rootPath: repo }, and a temp repo `repo` with at least one commit.
  it('changes() reports staged, unstaged, and untracked files', async () => {
    writeFileSync(join(repo, 'a.txt'), 'CHANGED\n');        // tracked, modified, unstaged
    writeFileSync(join(repo, 'new.txt'), 'N\n');            // untracked
    git(repo, 'add', 'a.txt');                              // now staged
    writeFileSync(join(repo, 'a.txt'), 'CHANGED AGAIN\n');  // staged + further modified
    const svc = new GitService(store);
    const c = await svc.changes('ws1');
    expect(c.staged.some((f) => f.path === 'a.txt')).toBe(true);
    expect(c.unstaged.some((f) => f.path === 'a.txt')).toBe(true);
    expect(c.untracked.some((f) => f.path === 'new.txt')).toBe(true);
  });

  it('stage → workingDiff(staged) → commit produces a clean tree', async () => {
    writeFileSync(join(repo, 'b.txt'), 'B\n');
    const svc = new GitService(store);
    await svc.stage('ws1', { paths: ['b.txt'] });
    const d = await svc.workingDiff('ws1', { path: 'b.txt', staged: true });
    expect(d.unified).toMatch(/b\.txt/);
    const { head } = await svc.commit('ws1', { message: 'add b' });
    expect(head).toMatch(/^[0-9a-f]{7,}$/);
    const c = await svc.changes('ws1');
    expect(c.staged).toEqual([]);
  });

  it('unstage moves a staged file back; discard reverts a tracked change', async () => {
    const svc = new GitService(store);
    writeFileSync(join(repo, 'a.txt'), 'X\n');
    await svc.stage('ws1', { paths: ['a.txt'] });
    await svc.unstage('ws1', { paths: ['a.txt'] });
    expect((await svc.changes('ws1')).staged).toEqual([]);
    await svc.discard('ws1', { paths: ['a.txt'] });
    expect((await svc.changes('ws1')).unstaged).toEqual([]);
  });

  it('commit rejects an empty message; rejects a path starting with dash', async () => {
    const svc = new GitService(store);
    await expect(svc.commit('ws1', { message: '   ' })).rejects.toThrow();
    await expect(svc.stage('ws1', { paths: ['-rf'] })).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run --project backend server/domain/git/git.service.test.ts`
Expected: FAIL — `changes`/`stage`/etc. not defined.

- [ ] **Step 3: Implement the methods** — in `server/domain/git/git.service.ts`:

(a) Extend the imports (lines 1-5):

```ts
import { parseLog, parseStatusPorcelain } from '@/src/lib/git-swimlanes';
import { NotFoundError, ValidationError } from '@/server/lib/errors';
import type { WorkspacesStore } from '@/server/domain/workspaces/workspaces.store';
import { runGit } from '@/server/domain/git/git.runner';
import { badRef, configuredRemotes } from '@/server/domain/git/remote-guard';
import { GIT_REMOTE_DEFAULTS } from '@/server/domain/git/git.types';
import type { CommitNode, DiffResult, GitStatus } from '@/server/domain/git/git.types';
import type { WorkingChanges } from '@/src/lib/git-swimlanes';
```

(b) Add these methods inside the `GitService` class (after `diff`, before the closing brace):

```ts
  private assertPaths(paths: unknown): asserts paths is string[] {
    if (!Array.isArray(paths) || paths.length === 0) throw new ValidationError('paths required');
    for (const p of paths) {
      if (typeof p !== 'string' || p.length === 0 || p.startsWith('-')) {
        throw new ValidationError('invalid path');
      }
    }
  }

  async changes(workspaceId: string): Promise<WorkingChanges> {
    const cwd = this.resolveCwd(workspaceId);
    const { stdout } = await runGit(['status', '--porcelain=v2', '--branch'], cwd);
    return parseStatusPorcelain(stdout);
  }

  async workingDiff(
    workspaceId: string,
    req: { path: string; staged?: boolean },
  ): Promise<DiffResult> {
    const cwd = this.resolveCwd(workspaceId);
    if (typeof req.path !== 'string' || req.path.length === 0 || req.path.startsWith('-')) {
      throw new ValidationError('invalid path');
    }
    const args = ['diff', ...(req.staged ? ['--cached'] : []), '--', req.path];
    const { stdout } = await runGit(args, cwd);
    return { unified: stdout };
  }

  async stage(workspaceId: string, req: { paths: unknown }): Promise<void> {
    const cwd = this.resolveCwd(workspaceId);
    this.assertPaths(req.paths);
    await runGit(['add', '--', ...req.paths], cwd);
  }

  async unstage(workspaceId: string, req: { paths: unknown }): Promise<void> {
    const cwd = this.resolveCwd(workspaceId);
    this.assertPaths(req.paths);
    await runGit(['restore', '--staged', '--', ...req.paths], cwd);
  }

  async discard(workspaceId: string, req: { paths: unknown }): Promise<void> {
    const cwd = this.resolveCwd(workspaceId);
    this.assertPaths(req.paths);
    await runGit(['restore', '--', ...req.paths], cwd);
  }

  async commit(workspaceId: string, req: { message: unknown }): Promise<{ head: string }> {
    const cwd = this.resolveCwd(workspaceId);
    if (typeof req.message !== 'string' || req.message.trim().length === 0) {
      throw new ValidationError('commit message required');
    }
    const r = await runGit(['commit', '-m', req.message], cwd);
    if (r.code !== 0) {
      throw new ValidationError(r.stderr.trim() || r.stdout.trim() || 'commit failed');
    }
    const head = await runGit(['rev-parse', '--short', 'HEAD'], cwd);
    return { head: head.stdout.trim() };
  }

  async push(
    workspaceId: string,
    req: { remote?: string; branch?: string },
  ): Promise<{ stdout: string }> {
    const cwd = this.resolveCwd(workspaceId);
    const remote = req.remote ?? 'origin';
    if (badRef(remote)) throw new ValidationError('invalid remote');
    if (req.branch !== undefined && badRef(req.branch)) throw new ValidationError('invalid branch');
    const remotes = await configuredRemotes(cwd);
    if (!remotes.has(remote)) throw new ValidationError(`unknown remote: ${remote}`);
    const r = await runGit(['push', remote, req.branch ?? 'HEAD'], cwd, {
      timeoutMs: GIT_REMOTE_DEFAULTS.timeoutMs,
      maxTimeoutMs: GIT_REMOTE_DEFAULTS.maxTimeoutMs,
      env: { GIT_TERMINAL_PROMPT: '0' },
    });
    if (r.code !== 0) throw new ValidationError(r.stderr.trim() || r.stdout.trim() || 'push failed');
    return { stdout: [r.stdout.trim(), r.stderr.trim()].filter(Boolean).join('\n') };
  }
```

- [ ] **Step 4: Run test + lint**

Run: `npx vitest run --project backend server/domain/git && npm run lint`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/domain/git/git.service.ts server/domain/git/git.service.test.ts
git commit -m "feat(git-changes): GitService working-tree methods (changes/diff/stage/unstage/discard/commit/push)"
```

---

## Task 4: HTTP routes

**Files:**
- Modify: `server/routes/git.routes.ts`
- Test: `server/routes/git.routes.test.ts`

- [ ] **Step 1: Write the failing test** — append to `server/routes/git.routes.test.ts` (reuse its supertest app + temp-repo fixture):

```ts
describe('git routes — changes pane', () => {
  // Reuse the existing `app` (built via createApp with a real GitService over a
  // temp repo `repo` exposed as workspace 'ws1').
  it('GET /api/git/changes returns structured working changes', async () => {
    writeFileSync(join(repo, 'a.txt'), 'CHANGED\n');
    const res = await request(app).get('/api/git/changes').query({ workspaceId: 'ws1' });
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.unstaged)).toBe(true);
  });

  it('POST /api/git/stage then /commit works; missing fields → 400', async () => {
    writeFileSync(join(repo, 'b.txt'), 'B\n');
    const stage = await request(app).post('/api/git/stage').send({ workspaceId: 'ws1', paths: ['b.txt'] });
    expect(stage.status).toBe(204);
    const commit = await request(app).post('/api/git/commit').send({ workspaceId: 'ws1', message: 'b' });
    expect(commit.status).toBe(200);
    expect(commit.body.head).toMatch(/^[0-9a-f]{7,}$/);
    const bad = await request(app).post('/api/git/stage').send({ workspaceId: 'ws1' });
    expect(bad.status).toBe(400);
  });

  it('GET /api/git/working-diff returns text/plain', async () => {
    writeFileSync(join(repo, 'a.txt'), 'CHANGED2\n');
    const res = await request(app).get('/api/git/working-diff').query({ workspaceId: 'ws1', path: 'a.txt' });
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/plain/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run --project backend server/routes/git.routes.test.ts`
Expected: FAIL — 404 on the new endpoints.

- [ ] **Step 3: Add the routes** — in `server/routes/git.routes.ts`, add these Zod schemas after `DiffQuery` (line 22):

```ts
const ChangesQuery = z.object({ workspaceId: z.string().min(1) });
const WorkingDiffQuery = z.object({
  workspaceId: z.string().min(1),
  path: z.string().min(1),
  staged: z.coerce.boolean().optional(),
});
const PathsBody = z.object({ workspaceId: z.string().min(1), paths: z.array(z.string().min(1)).min(1) });
const CommitBody = z.object({ workspaceId: z.string().min(1), message: z.string().min(1) });
const PushBody = z.object({ workspaceId: z.string().min(1) });
```

and add these route handlers inside `createGitRoutes`, before `return router;`:

```ts
  router.get(
    '/changes',
    asyncHandler(async (req, res) => {
      const parsed = ChangesQuery.safeParse(req.query);
      if (!parsed.success) throw new ValidationError('Invalid query', parsed.error);
      res.json(await svc.changes(parsed.data.workspaceId));
    }),
  );

  router.get(
    '/working-diff',
    asyncHandler(async (req, res) => {
      const parsed = WorkingDiffQuery.safeParse(req.query);
      if (!parsed.success) throw new ValidationError('Invalid query', parsed.error);
      const { workspaceId, path, staged } = parsed.data;
      const { unified } = await svc.workingDiff(workspaceId, { path, staged });
      res.type('text/plain').send(unified);
    }),
  );

  router.post(
    '/stage',
    asyncHandler(async (req, res) => {
      const parsed = PathsBody.safeParse(req.body);
      if (!parsed.success) throw new ValidationError('Invalid body', parsed.error);
      await svc.stage(parsed.data.workspaceId, { paths: parsed.data.paths });
      res.status(204).end();
    }),
  );

  router.post(
    '/unstage',
    asyncHandler(async (req, res) => {
      const parsed = PathsBody.safeParse(req.body);
      if (!parsed.success) throw new ValidationError('Invalid body', parsed.error);
      await svc.unstage(parsed.data.workspaceId, { paths: parsed.data.paths });
      res.status(204).end();
    }),
  );

  router.post(
    '/discard',
    asyncHandler(async (req, res) => {
      const parsed = PathsBody.safeParse(req.body);
      if (!parsed.success) throw new ValidationError('Invalid body', parsed.error);
      await svc.discard(parsed.data.workspaceId, { paths: parsed.data.paths });
      res.status(204).end();
    }),
  );

  router.post(
    '/commit',
    asyncHandler(async (req, res) => {
      const parsed = CommitBody.safeParse(req.body);
      if (!parsed.success) throw new ValidationError('Invalid body', parsed.error);
      res.json(await svc.commit(parsed.data.workspaceId, { message: parsed.data.message }));
    }),
  );

  router.post(
    '/push',
    asyncHandler(async (req, res) => {
      const parsed = PushBody.safeParse(req.body);
      if (!parsed.success) throw new ValidationError('Invalid body', parsed.error);
      res.json(await svc.push(parsed.data.workspaceId, {}));
    }),
  );
```

> The git routes mount at `app.ts:138`, after `express.json()` (`app.ts:88`), so the POST JSON bodies are parsed.

- [ ] **Step 4: Run test + lint**

Run: `npx vitest run --project backend server/routes/git.routes.test.ts && npm run lint`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/routes/git.routes.ts server/routes/git.routes.test.ts
git commit -m "feat(git-changes): HTTP routes (changes/working-diff/stage/unstage/discard/commit/push)"
```

---

## Task 5: Frontend API client

**Files:**
- Modify: `src/lib/api/git.api.ts`
- Test: `src/lib/api/git.api.test.ts`

- [ ] **Step 1: Write the failing test** — append to `src/lib/api/git.api.test.ts` (reuse its fetch-stub setup):

```ts
describe('gitApi — changes pane', () => {
  it('changes() GETs /api/git/changes', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ staged: [], unstaged: [], untracked: [], conflicted: [] }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const r = await gitApi.changes('ws1');
    expect(r.staged).toEqual([]);
    expect(fetchMock.mock.calls[0][0]).toContain('/api/git/changes?workspaceId=ws1');
    vi.unstubAllGlobals();
  });

  it('stage() POSTs paths; commit() returns head', async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (String(url).endsWith('/stage')) return new Response(null, { status: 204 });
      return new Response(JSON.stringify({ head: 'abc1234' }), { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);
    await gitApi.stage('ws1', ['a.txt']);
    const c = await gitApi.commit('ws1', 'msg');
    expect(c.head).toBe('abc1234');
    vi.unstubAllGlobals();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run --project frontend src/lib/api/git.api.test.ts`
Expected: FAIL — `gitApi.changes`/`stage`/`commit` not defined.

- [ ] **Step 3: Add the methods** — in `src/lib/api/git.api.ts`, add the import + methods. Change the import line (line 1) to:

```ts
import type { CommitNode, DiffRequest, DiffResult, WorkingChanges } from '@/src/lib/git-swimlanes';
```

Add a small body-post helper after `jsonOrThrow` (line 17):

```ts
async function postJson(url: string, body: unknown): Promise<Response> {
  return fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
}
async function okOrThrow(res: Response): Promise<void> {
  if (!res.ok) throw new Error(`Request failed: ${res.status}`);
}
```

Add these properties inside the `gitApi` object (before the closing `}`):

```ts
  changes: async (workspaceId: string): Promise<WorkingChanges> =>
    jsonOrThrow<WorkingChanges>(
      await fetch(`/api/git/changes?workspaceId=${encodeURIComponent(workspaceId)}`),
    ),

  workingDiff: async (workspaceId: string, path: string, staged?: boolean): Promise<DiffResult> => {
    let url = `/api/git/working-diff?workspaceId=${encodeURIComponent(workspaceId)}&path=${encodeURIComponent(path)}`;
    if (staged) url += `&staged=true`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Request failed: ${res.status}`);
    return { unified: await res.text() };
  },

  stage: async (workspaceId: string, paths: string[]): Promise<void> =>
    okOrThrow(await postJson('/api/git/stage', { workspaceId, paths })),

  unstage: async (workspaceId: string, paths: string[]): Promise<void> =>
    okOrThrow(await postJson('/api/git/unstage', { workspaceId, paths })),

  discard: async (workspaceId: string, paths: string[]): Promise<void> =>
    okOrThrow(await postJson('/api/git/discard', { workspaceId, paths })),

  commit: async (workspaceId: string, message: string): Promise<{ head: string }> =>
    jsonOrThrow<{ head: string }>(await postJson('/api/git/commit', { workspaceId, message })),

  push: async (workspaceId: string): Promise<{ stdout: string }> =>
    jsonOrThrow<{ stdout: string }>(await postJson('/api/git/push', { workspaceId })),
```

- [ ] **Step 4: Run test + lint**

Run: `npx vitest run --project frontend src/lib/api/git.api.test.ts && npm run lint`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/api/git.api.ts src/lib/api/git.api.test.ts
git commit -m "feat(git-changes): git api client methods"
```

---

## Task 6: gitChanges store

**Files:**
- Create: `src/stores/gitChanges.store.ts`
- Test: `src/stores/gitChanges.store.test.ts`

- [ ] **Step 1: Write the failing test** — `src/stores/gitChanges.store.test.ts`:

```ts
import { useGitChangesStore } from './gitChanges.store';

vi.mock('@/src/lib/api/git.api', () => ({
  gitApi: {
    changes: vi.fn(),
    workingDiff: vi.fn(),
    stage: vi.fn(),
    unstage: vi.fn(),
    discard: vi.fn(),
    commit: vi.fn(),
    push: vi.fn(),
  },
}));
import { gitApi } from '@/src/lib/api/git.api';

const EMPTY = { staged: [], unstaged: [], untracked: [], conflicted: [] };

beforeEach(() => {
  useGitChangesStore.getState().reset();
  vi.clearAllMocks();
});

describe('useGitChangesStore', () => {
  it('load populates changes', async () => {
    vi.mocked(gitApi.changes).mockResolvedValue({ ...EMPTY, unstaged: [{ path: 'a.txt', status: 'modified' }] });
    await useGitChangesStore.getState().load('ws1');
    expect(useGitChangesStore.getState().changes?.unstaged).toHaveLength(1);
    expect(useGitChangesStore.getState().activeWorkspaceId).toBe('ws1');
  });

  it('stage calls api then refreshes', async () => {
    vi.mocked(gitApi.changes).mockResolvedValue(EMPTY);
    await useGitChangesStore.getState().load('ws1');
    await useGitChangesStore.getState().stage(['a.txt']);
    expect(gitApi.stage).toHaveBeenCalledWith('ws1', ['a.txt']);
    expect(gitApi.changes).toHaveBeenCalledTimes(2); // load + refresh
  });

  it('commit clears the message and refreshes', async () => {
    vi.mocked(gitApi.changes).mockResolvedValue(EMPTY);
    vi.mocked(gitApi.commit).mockResolvedValue({ head: 'abc1234' });
    await useGitChangesStore.getState().load('ws1');
    useGitChangesStore.getState().setMessage('hello');
    await useGitChangesStore.getState().commit();
    expect(gitApi.commit).toHaveBeenCalledWith('ws1', 'hello');
    expect(useGitChangesStore.getState().message).toBe('');
  });

  it('surfaces errors', async () => {
    vi.mocked(gitApi.changes).mockRejectedValue(new Error('boom'));
    await useGitChangesStore.getState().load('ws1');
    expect(useGitChangesStore.getState().error).toMatch(/boom/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run --project frontend src/stores/gitChanges.store.test.ts`
Expected: FAIL — store not found.

- [ ] **Step 3: Implement the store** — `src/stores/gitChanges.store.ts`:

```ts
import { create } from 'zustand';
import { gitApi } from '@/src/lib/api/git.api';
import type { WorkingChanges } from '@/src/lib/git-swimlanes';

interface GitChangesState {
  changes: WorkingChanges | null;
  selectedPath: string | null;
  selectedStaged: boolean;
  selectedDiff: string | null;
  message: string;
  loading: boolean;
  busy: boolean;
  error: string | null;
  activeWorkspaceId: string | null;
  load(workspaceId: string): Promise<void>;
  refresh(): Promise<void>;
  select(path: string, staged: boolean): Promise<void>;
  setMessage(message: string): void;
  stage(paths: string[]): Promise<void>;
  unstage(paths: string[]): Promise<void>;
  discard(paths: string[]): Promise<void>;
  commit(): Promise<void>;
  commitAndPush(): Promise<void>;
  reset(): void;
}

function initial() {
  return {
    changes: null as WorkingChanges | null,
    selectedPath: null as string | null,
    selectedStaged: false,
    selectedDiff: null as string | null,
    message: '',
    loading: false,
    busy: false,
    error: null as string | null,
    activeWorkspaceId: null as string | null,
  };
}

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : 'Operation failed';
}

export const useGitChangesStore = create<GitChangesState>((set, get) => ({
  ...initial(),

  load: async (workspaceId) => {
    set({ loading: true, error: null, activeWorkspaceId: workspaceId });
    try {
      const changes = await gitApi.changes(workspaceId);
      set({ changes, loading: false });
    } catch (e) {
      set({ loading: false, error: errMsg(e) });
    }
  },

  refresh: async () => {
    const id = get().activeWorkspaceId;
    if (!id) return;
    try {
      set({ changes: await gitApi.changes(id), error: null });
    } catch (e) {
      set({ error: errMsg(e) });
    }
  },

  select: async (path, staged) => {
    const id = get().activeWorkspaceId;
    if (!id) return;
    set({ selectedPath: path, selectedStaged: staged, selectedDiff: null });
    try {
      const { unified } = await gitApi.workingDiff(id, path, staged);
      // Ignore if the selection changed while loading.
      if (get().selectedPath === path && get().selectedStaged === staged) set({ selectedDiff: unified });
    } catch (e) {
      set({ error: errMsg(e) });
    }
  },

  setMessage: (message) => set({ message }),

  stage: (paths) => mutate(set, get, () => gitApi.stage(get().activeWorkspaceId!, paths)),
  unstage: (paths) => mutate(set, get, () => gitApi.unstage(get().activeWorkspaceId!, paths)),
  discard: (paths) => mutate(set, get, () => gitApi.discard(get().activeWorkspaceId!, paths)),

  commit: () =>
    mutate(set, get, async () => {
      await gitApi.commit(get().activeWorkspaceId!, get().message);
      set({ message: '' });
    }),

  commitAndPush: () =>
    mutate(set, get, async () => {
      const id = get().activeWorkspaceId!;
      await gitApi.commit(id, get().message);
      set({ message: '' });
      await gitApi.push(id);
    }),

  reset: () => set(initial()),
}));

async function mutate(
  set: (p: Partial<GitChangesState>) => void,
  get: () => GitChangesState,
  action: () => Promise<unknown>,
): Promise<void> {
  if (!get().activeWorkspaceId) return;
  set({ busy: true, error: null });
  try {
    await action();
    set({ changes: await gitApi.changes(get().activeWorkspaceId!) });
  } catch (e) {
    set({ error: errMsg(e) });
  } finally {
    set({ busy: false });
  }
}
```

- [ ] **Step 4: Run test + lint**

Run: `npx vitest run --project frontend src/stores/gitChanges.store.test.ts && npm run lint`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/stores/gitChanges.store.ts src/stores/gitChanges.store.test.ts
git commit -m "feat(git-changes): gitChanges Zustand store (load/select/stage/unstage/discard/commit/push)"
```

---

## Task 7: Navigation — `mainView 'history' → 'git'` + git tab

**Files:**
- Modify: `src/stores/ui.store.ts`
- Modify: `src/stores/ui.store.test.ts`
- Modify: `src/App.tsx`
- Modify: `src/components/layout/TopBar.tsx`

- [ ] **Step 1: Update the ui.store tests** — in `src/stores/ui.store.test.ts`, the `mainView` block currently expects `'history'`. Update it to `'git'` and add `gitTab` tests. Replace the `describe('useUiStore.mainView', …)` block with:

```ts
describe('useUiStore.mainView', () => {
  it('defaults to chat', () => {
    expect(useUiStore.getState().mainView).toBe('chat');
  });

  it('toggleMainView flips chat <-> git and persists', () => {
    useUiStore.getState().toggleMainView();
    expect(useUiStore.getState().mainView).toBe('git');
    expect(localStorage.getItem('aether.mainView')).toBe('git');
    useUiStore.getState().toggleMainView();
    expect(useUiStore.getState().mainView).toBe('chat');
  });

  it('initFromStorage migrates a legacy "history" value to "git"', () => {
    localStorage.setItem('aether.mainView', 'history');
    useUiStore.getState().initFromStorage();
    expect(useUiStore.getState().mainView).toBe('git');
  });

  it('gitTab defaults to history; setGitTab persists', () => {
    expect(useUiStore.getState().gitTab).toBe('history');
    useUiStore.getState().setGitTab('changes');
    expect(useUiStore.getState().gitTab).toBe('changes');
    expect(localStorage.getItem('aether.gitTab')).toBe('changes');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run --project frontend src/stores/ui.store.test.ts`
Expected: FAIL — `mainView` is `'history'` not `'git'`; `gitTab`/`setGitTab` missing.

- [ ] **Step 3: Update ui.store** — in `src/stores/ui.store.ts`:

(a) Replace the `MainView` type and add `GitTab`:

```ts
export type MainView = 'chat' | 'git';
export type GitTab = 'history' | 'changes';
```

(b) Add the storage key next to `MAINVIEW_KEY`:

```ts
const GITTAB_KEY = 'aether.gitTab';
```

(c) In the `UiState` interface add `gitTab: GitTab;` and `setGitTab(v: GitTab): void;` (next to the mainView members).

(d) In `initial`, add `gitTab: 'history' as GitTab,` (next to `mainView`).

(e) Update the `mainView` default + the `readMainView` helper to map legacy `'history'` → `'git'`:

```ts
function readMainView(): MainView {
  try {
    const v = localStorage.getItem(MAINVIEW_KEY);
    // Legacy value 'history' migrates to the unified 'git' view.
    return v === 'git' || v === 'history' ? 'git' : 'chat';
  } catch {
    return 'chat';
  }
}
```

(f) In `toggleMainView`, change the toggle to flip `chat`/`git`:

```ts
  toggleMainView: () => {
    const next: MainView = get().mainView === 'git' ? 'chat' : 'git';
    try { localStorage.setItem(MAINVIEW_KEY, next); } catch { /* ignore */ }
    set({ mainView: next });
  },
```

(g) Add `setGitTab` (next to `setMainView`):

```ts
  setGitTab: (v) => {
    try { localStorage.setItem(GITTAB_KEY, v); } catch { /* ignore */ }
    set({ gitTab: v });
  },
```

(h) In `initFromStorage`, add `gitTab` hydration:

```ts
  initFromStorage: () =>
    set({
      thinkingEnabled: readBool(THINKING_KEY, false),
      sidebarOpen: readBool(SIDEBAR_KEY, true),
      mainView: readMainView(),
      gitTab: (() => {
        try { return localStorage.getItem(GITTAB_KEY) === 'changes' ? 'changes' : 'history'; }
        catch { return 'history'; }
      })(),
    }),
```

(i) `setMainView` already persists; if it has a literal `'history'` type guard, ensure it accepts `'git'` (the `MainView` type change covers it).

- [ ] **Step 4: Wire App.tsx + TopBar** —

In `src/App.tsx`, replace the import of `GitSwimlanesView` with `GitView`:
```ts
import { GitView } from '@/src/components/git/GitView';
```
and change the conditional render:
```tsx
        {mainView === 'git' ? (
          <GitView />
        ) : (
          <>
            <ChatView />
            <ToolCallBanner />
          </>
        )}
```

In `src/components/layout/TopBar.tsx`, update the toggle: `const historyActive = mainView === 'git';` and keep the same icons/labels (GitBranch → open git, MessageSquare → back to chat).

- [ ] **Step 5: Run test + lint** (GitView doesn't exist yet → lint will fail on the App import; that's expected — Task 8 creates it. To keep this task green standalone, do Step 5 AFTER Task 8, or create a minimal `GitView` stub now. Simplest: create the stub here.)

Create a minimal `src/components/git/GitView.tsx` stub (fully implemented in Task 8):
```tsx
import { GitSwimlanesView } from './GitSwimlanesView';
export function GitView() {
  return <GitSwimlanesView />;
}
```

Run: `npx vitest run --project frontend src/stores/ui.store.test.ts && npm run lint`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/stores/ui.store.ts src/stores/ui.store.test.ts src/App.tsx src/components/layout/TopBar.tsx src/components/git/GitView.tsx
git commit -m "feat(git-changes): unify git view (mainView history→git) + gitTab state"
```

---

## Task 8: GitView tabs + ChangesView

**Files:**
- Modify: `src/components/git/GitView.tsx` (real implementation)
- Create: `src/components/git/ChangesView.tsx`
- Test: `src/components/git/ChangesView.test.tsx`

- [ ] **Step 1: Implement GitView with tabs** — replace `src/components/git/GitView.tsx`:

```tsx
import { useUiStore } from '@/src/stores/ui.store';
import { cn } from '@/src/lib/cn';
import { GitSwimlanesView } from './GitSwimlanesView';
import { ChangesView } from './ChangesView';

const TABS: { id: 'history' | 'changes'; label: string }[] = [
  { id: 'history', label: 'History' },
  { id: 'changes', label: 'Changes' },
];

export function GitView() {
  const gitTab = useUiStore((s) => s.gitTab);
  const setGitTab = useUiStore((s) => s.setGitTab);

  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 items-center gap-1 border-b border-border-subtle bg-surface-2 px-3">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={gitTab === t.id}
            onClick={() => setGitTab(t.id)}
            className={cn(
              'px-3 py-2 text-xs font-mono uppercase tracking-widest border-b-2 -mb-px',
              gitTab === t.id
                ? 'border-disclosure text-disclosure'
                : 'border-transparent text-zinc-500 hover:text-zinc-300',
            )}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div className="min-h-0 flex-1">
        {gitTab === 'changes' ? <ChangesView /> : <GitSwimlanesView />}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Write the ChangesView smoke test** — `src/components/git/ChangesView.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import { ChangesView } from './ChangesView';
import { useGitChangesStore } from '@/src/stores/gitChanges.store';
import { useSessionsStore } from '@/src/stores/sessions.store';

beforeEach(() => {
  useGitChangesStore.getState().reset();
});

it('shows the no-workspace empty state when no workspace is active', () => {
  useSessionsStore.setState({ sessions: [], activeSessionId: null } as never);
  render(<ChangesView />);
  expect(screen.getByText(/no workspace/i)).toBeInTheDocument();
});

it('renders staged/changes sections and disables Commit when nothing is staged', () => {
  useSessionsStore.setState({ sessions: [{ id: 's1', workspaceId: 'ws1' }], activeSessionId: 's1' } as never);
  useGitChangesStore.setState({
    activeWorkspaceId: 'ws1',
    changes: { staged: [], unstaged: [{ path: 'a.txt', status: 'modified' }], untracked: [], conflicted: [] },
  } as never);
  render(<ChangesView />);
  expect(screen.getByText('a.txt')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /^commit$/i })).toBeDisabled();
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run --project frontend src/components/git/ChangesView.test.tsx`
Expected: FAIL — `ChangesView` not found.

- [ ] **Step 4: Implement ChangesView** — `src/components/git/ChangesView.tsx`:

```tsx
import { useEffect } from 'react';
import { Plus, Minus, RotateCcw, RefreshCw } from 'lucide-react';
import { useGitChangesStore } from '@/src/stores/gitChanges.store';
import { useSessionsStore } from '@/src/stores/sessions.store';
import { useDialog } from '@/src/hooks/useDialog';
import { UnifiedDiff } from './UnifiedDiff';
import { GitEmptyState } from './GitEmptyState';
import type { WorkingFile } from '@/src/lib/git-swimlanes';

export function ChangesView() {
  const workspaceId = useSessionsStore((s) => {
    const session = s.sessions.find((x) => x.id === s.activeSessionId);
    return session?.workspaceId;
  });
  const dialog = useDialog();

  const changes = useGitChangesStore((s) => s.changes);
  const selectedPath = useGitChangesStore((s) => s.selectedPath);
  const selectedDiff = useGitChangesStore((s) => s.selectedDiff);
  const message = useGitChangesStore((s) => s.message);
  const busy = useGitChangesStore((s) => s.busy);
  const error = useGitChangesStore((s) => s.error);
  const load = useGitChangesStore((s) => s.load);
  const refresh = useGitChangesStore((s) => s.refresh);
  const select = useGitChangesStore((s) => s.select);
  const setMessage = useGitChangesStore((s) => s.setMessage);
  const stage = useGitChangesStore((s) => s.stage);
  const unstage = useGitChangesStore((s) => s.unstage);
  const discard = useGitChangesStore((s) => s.discard);
  const commit = useGitChangesStore((s) => s.commit);
  const commitAndPush = useGitChangesStore((s) => s.commitAndPush);

  useEffect(() => {
    if (workspaceId) load(workspaceId);
  }, [workspaceId, load]);

  if (!workspaceId) return <GitEmptyState kind="no-workspace" />;

  const hasStaged = (changes?.staged.length ?? 0) > 0;
  const canCommit = hasStaged && message.trim().length > 0 && !busy;

  const onDiscard = async (paths: string[]) => {
    const ok = await dialog.confirm({
      title: 'Discard changes',
      message: `Discard changes in ${paths.length} file(s)? This cannot be undone.`,
      confirmLabel: 'Discard',
    });
    if (ok) void discard(paths);
  };

  const Row = ({ file, staged }: { file: WorkingFile; staged: boolean }) => (
    <div className="group flex items-center gap-1.5 px-2 py-1 hover:bg-surface-3">
      <button
        type="button"
        onClick={() => void select(file.path, staged)}
        className={`min-w-0 flex-1 truncate text-left font-mono text-[11px] ${selectedPath === file.path ? 'text-disclosure' : 'text-zinc-300'}`}
      >
        {file.oldPath ? `${file.oldPath} → ${file.path}` : file.path}
        <span className="ml-2 text-[9px] uppercase text-zinc-600">{file.status}</span>
      </button>
      {staged ? (
        <button type="button" aria-label={`Unstage ${file.path}`} onClick={() => void unstage([file.path])} className="icon-btn opacity-0 group-hover:opacity-100">
          <Minus size={13} aria-hidden="true" />
        </button>
      ) : (
        <>
          <button type="button" aria-label={`Discard ${file.path}`} onClick={() => void onDiscard([file.path])} className="icon-btn opacity-0 group-hover:opacity-100">
            <RotateCcw size={13} aria-hidden="true" />
          </button>
          <button type="button" aria-label={`Stage ${file.path}`} onClick={() => void stage([file.path])} className="icon-btn opacity-0 group-hover:opacity-100">
            <Plus size={13} aria-hidden="true" />
          </button>
        </>
      )}
    </div>
  );

  const Section = ({ title, files, staged }: { title: string; files: WorkingFile[]; staged: boolean }) =>
    files.length === 0 ? null : (
      <div className="mb-2">
        <div className="mono-label px-2 py-1">{title} ({files.length})</div>
        {files.map((f) => <Row key={(staged ? 'S:' : 'U:') + f.path} file={f} staged={staged} />)}
      </div>
    );

  return (
    <div className="flex h-full">
      {/* Left: file lists + commit box */}
      <div className="flex w-80 shrink-0 flex-col border-r border-border-subtle">
        <div className="flex items-center justify-between px-2 py-1.5 border-b border-border-subtle">
          <span className="mono-label">{changes?.branch ?? '—'}</span>
          <button type="button" aria-label="Refresh" onClick={() => void refresh()} className="icon-btn">
            <RefreshCw size={13} className={busy ? 'animate-spin' : undefined} aria-hidden="true" />
          </button>
        </div>
        {error && <div className="px-2 py-1.5 text-[11px] text-status-error">{error}</div>}
        <div className="min-h-0 flex-1 overflow-y-auto">
          <Section title="Staged" files={changes?.staged ?? []} staged={true} />
          <Section title="Changes" files={changes?.unstaged ?? []} staged={false} />
          <Section title="Untracked" files={changes?.untracked ?? []} staged={false} />
          {(changes?.conflicted.length ?? 0) > 0 && (
            <div className="mb-2">
              <div className="mono-label px-2 py-1 text-status-error">Conflicts ({changes!.conflicted.length})</div>
              {changes!.conflicted.map((f) => (
                <div key={'C:' + f.path} className="px-2 py-1 font-mono text-[11px] text-status-error">{f.path}</div>
              ))}
            </div>
          )}
        </div>
        <div className="shrink-0 border-t border-border-subtle p-2">
          <textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder="Commit message"
            aria-label="Commit message"
            className="mb-2 w-full resize-none rounded border border-border-subtle bg-surface-0 p-2 text-[12px] text-zinc-200"
            rows={3}
          />
          <div className="flex gap-2">
            <button type="button" disabled={!canCommit} onClick={() => void commit()} className="flex-1 rounded bg-manipulation/20 px-2 py-1 text-[11px] font-bold uppercase tracking-widest text-manipulation disabled:opacity-40">
              Commit
            </button>
            <button type="button" disabled={!canCommit} onClick={() => void commitAndPush()} className="flex-1 rounded border border-border-subtle px-2 py-1 text-[11px] uppercase tracking-widest text-zinc-300 disabled:opacity-40 hover:bg-surface-3">
              Commit & Push
            </button>
          </div>
        </div>
      </div>
      {/* Right: selected file diff */}
      <div className="min-w-0 flex-1 overflow-auto">
        {selectedDiff !== null ? (
          <UnifiedDiff unified={selectedDiff} />
        ) : (
          <div className="flex h-full items-center justify-center text-[12px] text-zinc-600">
            Select a file to view its diff
          </div>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Run test + lint**

Run: `npx vitest run --project frontend src/components/git && npm run lint`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/components/git/GitView.tsx src/components/git/ChangesView.tsx src/components/git/ChangesView.test.tsx
git commit -m "feat(git-changes): GitView tabs + ChangesView (stage/unstage/discard/commit/push UI)"
```

---

## Task 9: i18n, a11y, full verification

**Files:**
- Modify: `src/i18n/en.ts` (add `gitChanges` strings); thread `t()` through `GitView`/`ChangesView` where literals were used.

- [ ] **Step 1: Extract strings** — add a `gitChanges` section to `src/i18n/en.ts` for the literals introduced in `GitView`/`ChangesView` (tab labels "History"/"Changes", section titles "Staged"/"Changes"/"Untracked"/"Conflicts", "Commit"/"Commit & Push", "Commit message", "Select a file to view its diff", the discard dialog title/message/confirmLabel, aria-labels). Replace the inline literals with `t('gitChanges.*')`. Keep the English text identical so the smoke tests still pass (or update the test queries if a string changes).

- [ ] **Step 2: a11y check** — confirm: tab buttons have `role="tab"` + `aria-selected` (done); file action buttons have `aria-label` (done); the commit textarea has `aria-label` (done); no `dangerouslySetInnerHTML`.

- [ ] **Step 3: Full suite + build**

Run: `npm run lint && npm run test:run && npm run build`
Expected: lint clean; all tests green; build OK.

- [ ] **Step 4: Manual smoke** (this repo is a real git repo)

```bash
AETHER_FAKE_PROVIDER=1 PORT=3942 AETHER_DATA_DIR=/tmp/aether-changes npm run dev
```
Attach this repo as the active session's workspace, open the git view, switch to the **Changes** tab, edit a file, confirm it appears under Changes, stage it, write a message, Commit; verify the tree goes clean. Kill the server + remove the scratch data dir.

- [ ] **Step 5: Commit**

```bash
git add src/i18n/en.ts src/components/git/GitView.tsx src/components/git/ChangesView.tsx
git commit -m "feat(git-changes): i18n strings + a11y polish"
```

---

## Task 10: Docs + PR

- [ ] **Step 1: Update the roadmap** — in `docs/superpowers/roadmap.md`, add a Shipped row for the Changes pane and update the Tier-1 note (the "Changes pane follow-up" is now done).

- [ ] **Step 2: Commit + PR**

```bash
git add docs/superpowers/roadmap.md
git commit -m "docs: mark the git Changes pane shipped"
git push -u origin feat/git-changes-pane
gh pr create --base main --title "feat: git Changes pane (working-tree source control)" --body "<summary + test plan>"
```

---

## Notes on testing scope

- **No network:** the push test uses a local bare repo as `origin` (mirror slice-29's fixture).
- **E2e (Playwright):** deferred, same rationale as slices 28/29.
- **Coverage:** enforced globs (`server/domain/**`, `src/lib/**`, `src/stores/**`) are covered by the parser/service/store tests.
