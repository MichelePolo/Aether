# Git Remote Actions (Tier 3) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add agent-initiated git remote actions (`fetch`, `push`, `pull --ff-only`, `merge --ff-only`) to the builtin `aether-git` MCP server, gated through the existing breakpoint machinery with a new `commitList` preview.

**Architecture:** Four new MCP tools on the slice-28 `aether-git` server reuse the slice-27 `runGit` runner (extended with a per-call timeout ceiling + env injection). Auth is ambient (host git credentials) with `GIT_TERMINAL_PROMPT=0` for fail-fast; targets are remote *names* only (charset excludes URLs). `push/pull/merge` classify dangerous → gate with a commit-list preview; `fetch` stays safe → auto.

**Tech Stack:** Node JSON-RPC stdio MCP, Express/SQLite backend, React 19 + Zustand, Vitest. Tests use a local bare repo as a fake `origin` (no network/credentials).

**Spec:** `docs/superpowers/specs/2026-06-07-slice-29-git-remote-design.md`

---

## Branch

Slice 29 builds on slice 28's `aether-git` MCP. Create the branch off the current slice-28 branch:

```bash
git checkout feat/slice-28-git-write
git checkout -b feat/slice-29-git-remote
```

---

## Task 1: Runner — remote subcommands, timeout ceiling, env injection

The slice-27 runner allows only local subcommands, clamps the timeout to a fixed 30s ceiling, and spawns with no env override. Remote ops need `fetch/push/pull/merge`, a higher timeout ceiling, and the ability to inject `GIT_TERMINAL_PROMPT=0`.

**Files:**
- Modify: `server/domain/git/git.types.ts`
- Modify: `server/domain/git/git.runner.ts:8-13,39-65`
- Test: `server/domain/git/git.runner.test.ts`, `server/domain/git/git.runner.mock.test.ts`

- [ ] **Step 1: Add `GIT_REMOTE_DEFAULTS`** — `server/domain/git/git.types.ts`, after the existing `GIT_DEFAULTS` line:

```ts
export const GIT_REMOTE_DEFAULTS = { timeoutMs: 60_000, maxTimeoutMs: 120_000 } as const;
```

- [ ] **Step 2: Write the failing allowlist test** — append to `server/domain/git/git.runner.test.ts` (reuse the file's existing `makeRepo`/`rmSync` helpers):

```ts
describe('runGit — remote subcommands (slice 29)', () => {
  it('permits merge (allowlisted) — merging HEAD is a no-op', async () => {
    const repo = makeRepo();
    try {
      const r = await runGit(['merge', '--ff-only', 'HEAD'], repo);
      expect(r.code).toBe(0);
      expect(r.stdout + r.stderr).toMatch(/up to date/i);
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });

  it('permits fetch/push/pull as subcommands (not rejected by allowlist)', async () => {
    const repo = makeRepo();
    try {
      // No remote configured, so these exit non-zero — but they must NOT throw
      // the GIT_SUBCOMMAND allowlist error (which would reject before spawn).
      for (const sub of ['fetch', 'push', 'pull']) {
        await expect(runGit([sub], repo)).resolves.toBeDefined();
      }
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run --project backend server/domain/git/git.runner.test.ts`
Expected: FAIL — `merge`/`fetch`/`push`/`pull` throw `unsupported git subcommand`.

- [ ] **Step 4: Extend the allowlist + opts** — `server/domain/git/git.runner.ts`:

(a) Replace the `GIT_SUBCOMMANDS` set (lines 8-13) with:

```ts
export const GIT_SUBCOMMANDS = new Set([
  // read (slice 27)
  'log', 'show', 'rev-parse', 'status', 'diff',
  // write (slice 28)
  'add', 'commit', 'checkout', 'switch', 'restore',
  // remote (slice 29)
  'fetch', 'push', 'pull', 'merge',
]);
```

(b) Replace the `runGit` signature + timeout clamp + spawn (lines 39-65) so opts carry `maxTimeoutMs` and `env`:

```ts
export async function runGit(
  args: string[],
  cwd: string,
  opts?: { timeoutMs?: number; maxTimeoutMs?: number; env?: NodeJS.ProcessEnv },
): Promise<GitRunResult> {
  // Allowlist check — reject BEFORE spawning.
  const subcommand = args[0];
  if (!subcommand || !GIT_SUBCOMMANDS.has(subcommand)) {
    throw new GitError(`unsupported git subcommand: ${subcommand ?? ''}`, {
      status: 400,
      code: 'GIT_SUBCOMMAND',
    });
  }

  // cwd validation — reject BEFORE spawning.
  if (!isValidCwd(cwd)) {
    throw new GitError('invalid cwd', { status: 400 });
  }

  const effectiveTimeout = Math.min(
    opts?.timeoutMs ?? GIT_DEFAULTS.timeoutMs,
    opts?.maxTimeoutMs ?? GIT_DEFAULTS.maxTimeoutMs,
  );
  const cap = SHELL_DEFAULTS.outputCapBytes;

  return new Promise<GitRunResult>((resolve, reject) => {
    const child = spawn('git', [...FIXED_FLAGS, ...args], {
      cwd,
      shell: false,
      env: opts?.env ? { ...process.env, ...opts.env } : process.env,
    });
```

(Leave the rest of the Promise body — buffering, timer, error/exit handlers — exactly as it is.)

- [ ] **Step 5: Run the real test to verify it passes**

Run: `npx vitest run --project backend server/domain/git/git.runner.test.ts`
Expected: PASS.

- [ ] **Step 6: Write mock tests for the timeout ceiling + env** — append to `server/domain/git/git.runner.mock.test.ts` (this file already mocks `spawn`; reuse its `fakeChild`/`spawnMock`/`CWD` setup):

```ts
describe('runGit (mocked spawn) — slice 29 opts', () => {
  it('opts.maxTimeoutMs raises the clamp above the local 30s default', async () => {
    vi.useFakeTimers();
    const child = fakeChild();
    spawnMock.mockReturnValue(child as unknown as ReturnType<typeof spawn>);
    const p = runGit(['fetch'], CWD, { timeoutMs: 60_000, maxTimeoutMs: 120_000 });
    p.catch(() => {});
    // At 31s the local-default clamp (30s) would already have fired; it must NOT.
    await vi.advanceTimersByTimeAsync(31_000);
    expect(child.kill).not.toHaveBeenCalled();
    // It fires at the raised 60s ceiling.
    await vi.advanceTimersByTimeAsync(30_000);
    expect(child.kill).toHaveBeenCalledWith('SIGTERM');
    await expect(p).rejects.toThrow(/timed out/);
  });

  it('opts.env is merged into the spawn environment', async () => {
    const child = fakeChild();
    spawnMock.mockReturnValue(child as unknown as ReturnType<typeof spawn>);
    const p = runGit(['fetch'], CWD, { env: { GIT_TERMINAL_PROMPT: '0' } });
    child.emit('exit', 0);
    await p;
    const passedEnv = (spawnMock.mock.calls[0][2] as { env: Record<string, string> }).env;
    expect(passedEnv.GIT_TERMINAL_PROMPT).toBe('0');
  });
});
```

- [ ] **Step 7: Run mock tests + full git suite + lint**

Run: `npx vitest run --project backend server/domain/git && npm run lint`
Expected: PASS, lint clean.

- [ ] **Step 8: Commit**

```bash
git add server/domain/git/git.types.ts server/domain/git/git.runner.ts server/domain/git/git.runner.test.ts server/domain/git/git.runner.mock.test.ts
git commit -m "feat(slice-29): git runner remote subcommands + timeout ceiling + env injection"
```

---

## Task 2: aether-git handler — remote tools

**Files:**
- Modify: `server/mcp/builtin/aether-git.handler.ts`
- Test: `server/mcp/builtin/aether-git.handler.test.ts`

- [ ] **Step 1: Write the failing test** — append to `server/mcp/builtin/aether-git.handler.test.ts`. The file already imports `execFileSync`, `mkdtempSync`, `rmSync`, `writeFileSync`, `tmpdir`, `join`, defines a `git()` helper, and sets `LC_ALL=C` — reuse them. **Merge** `gitFetch, gitPush, gitPull, gitMerge` into the existing `import { gitStatus, … } from './aether-git.handler'` block (do NOT add a second import from the same module). Then add the helpers + describe block:

```ts
// (gitFetch, gitPush, gitPull, gitMerge added to the existing handler import above)

function makeRepoWithRemote(): { work: string; bare: string } {
  const bare = mkdtempSync(join(tmpdir(), 'aether-bare-'));
  execFileSync('git', ['init', '--bare', '-q', bare], { stdio: 'pipe' });
  const work = mkdtempSync(join(tmpdir(), 'aether-work-'));
  git(work, 'init', '-q');
  git(work, 'symbolic-ref', 'HEAD', 'refs/heads/main');
  writeFileSync(join(work, 'a.txt'), 'A1\n');
  git(work, 'add', '.');
  git(work, 'commit', '-q', '-m', 'first');
  git(work, 'remote', 'add', 'origin', bare);
  git(work, 'push', '-q', '-u', 'origin', 'main');
  return { work, bare };
}

// Advance the bare remote's main by one commit, via a throwaway clone.
function advanceRemote(bare: string): void {
  const tmp = mkdtempSync(join(tmpdir(), 'aether-adv-'));
  execFileSync('git', ['clone', '-q', bare, tmp], { stdio: 'pipe' });
  writeFileSync(join(tmp, 'remote.txt'), 'R\n');
  git(tmp, 'add', '.');
  git(tmp, 'commit', '-q', '-m', 'remote commit');
  git(tmp, 'push', '-q', 'origin', 'HEAD:main');
  rmSync(tmp, { recursive: true, force: true });
}

describe('aether-git.handler — remote (slice 29)', () => {
  let work: string;
  let bare: string;
  beforeEach(() => { ({ work, bare } = makeRepoWithRemote()); });
  afterEach(() => {
    rmSync(work, { recursive: true, force: true });
    rmSync(bare, { recursive: true, force: true });
  });

  it('git_push sends a new local commit to the bare remote', async () => {
    writeFileSync(join(work, 'b.txt'), 'B\n');
    git(work, 'add', '.');
    git(work, 'commit', '-q', '-m', 'second');
    const r = await gitPush({ remote: 'origin' }, work);
    expect(r.isError).toBe(false);
    const remoteLog = execFileSync('git', ['-C', bare, 'log', '--oneline'], { stdio: 'pipe' }).toString();
    expect(remoteLog).toMatch(/second/);
  });

  it('git_fetch updates the remote-tracking ref without error', async () => {
    advanceRemote(bare);
    const r = await gitFetch({ remote: 'origin' }, work);
    expect(r.isError).toBe(false);
    // origin/main is now resolvable and ahead of local main.
    expect(() => execFileSync('git', ['-C', work, 'rev-parse', 'origin/main'], { stdio: 'pipe' })).not.toThrow();
  });

  it('git_pull --ff-only fast-forwards when the remote is ahead', async () => {
    advanceRemote(bare);
    const r = await gitPull({ remote: 'origin', branch: 'main' }, work);
    expect(r.isError).toBe(false);
    expect(execFileSync('git', ['-C', work, 'log', '--oneline'], { stdio: 'pipe' }).toString()).toMatch(/remote commit/);
  });

  it('git_pull --ff-only fails (isError) on a diverged branch', async () => {
    advanceRemote(bare);                 // remote has a new commit
    writeFileSync(join(work, 'c.txt'), 'C\n');
    git(work, 'add', '.');
    git(work, 'commit', '-q', '-m', 'local commit'); // local also diverged
    const r = await gitPull({ remote: 'origin', branch: 'main' }, work);
    expect(r.isError).toBe(true);
  });

  it('git_merge --ff-only fast-forwards an ahead branch', async () => {
    git(work, 'checkout', '-q', '-b', 'feature');
    writeFileSync(join(work, 'f.txt'), 'F\n');
    git(work, 'add', '.');
    git(work, 'commit', '-q', '-m', 'feature commit');
    git(work, 'checkout', '-q', 'main');
    const r = await gitMerge({ ref: 'feature' }, work);
    expect(r.isError).toBe(false);
    expect(execFileSync('git', ['-C', work, 'log', '--oneline'], { stdio: 'pipe' }).toString()).toMatch(/feature commit/);
  });

  it('rejects a remote that is a URL or starts with dash', async () => {
    expect((await gitFetch({ remote: 'https://evil.example/x' }, work)).isError).toBe(true);
    expect((await gitFetch({ remote: '--upload-pack=x' }, work)).isError).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run --project backend server/mcp/builtin/aether-git.handler.test.ts`
Expected: FAIL — `gitFetch`/`gitPush`/`gitPull`/`gitMerge` are not exported.

- [ ] **Step 3: Implement the remote handlers** — in `server/mcp/builtin/aether-git.handler.ts`:

(a) Extend the `run` wrapper signature to forward opts. Replace lines 21-28:

```ts
async function run(
  args: string[],
  cwd: string,
  opts?: { timeoutMs?: number; maxTimeoutMs?: number; env?: NodeJS.ProcessEnv },
): Promise<GitToolResult> {
  try {
    const r = await runGit(args, cwd, opts);
    return ok(r.stdout, r.stderr, r.code);
  } catch (e) {
    return err(e instanceof Error ? e.message : 'git failed');
  }
}
```

(b) Add the import of `GIT_REMOTE_DEFAULTS` to the existing runner import on line 1:

```ts
import { runGit } from '@/server/domain/git/git.runner';
import { GIT_REMOTE_DEFAULTS } from '@/server/domain/git/git.types';
```

(c) After the existing `badPath` helper (line 19), add a ref validator + a remote-op runner:

```ts
/** Validates a remote/branch/ref name. The charset excludes ':' so URLs are rejected. */
function badRef(s: unknown): boolean {
  return typeof s !== 'string' || s.length === 0 || !/^[\w./-]+$/.test(s);
}

const REMOTE_ENV: NodeJS.ProcessEnv = { GIT_TERMINAL_PROMPT: '0' };

function runRemote(args: string[], cwd: string): Promise<GitToolResult> {
  return run(args, cwd, {
    timeoutMs: GIT_REMOTE_DEFAULTS.timeoutMs,
    maxTimeoutMs: GIT_REMOTE_DEFAULTS.maxTimeoutMs,
    env: REMOTE_ENV,
  });
}
```

(d) Append the four remote handlers at the end of the file:

```ts
export function gitFetch(args: { remote?: unknown }, cwd: string): Promise<GitToolResult> {
  const remote = args.remote ?? 'origin';
  if (badRef(remote)) return Promise.resolve(err('invalid remote'));
  return runRemote(['fetch', remote as string], cwd);
}

export function gitPush(
  args: { remote?: unknown; branch?: unknown; setUpstream?: unknown },
  cwd: string,
): Promise<GitToolResult> {
  const remote = args.remote ?? 'origin';
  if (badRef(remote)) return Promise.resolve(err('invalid remote'));
  if (args.branch !== undefined && badRef(args.branch)) {
    return Promise.resolve(err('invalid branch'));
  }
  const a = ['push'];
  if (args.setUpstream === true) a.push('-u');
  a.push(remote as string, (args.branch as string) ?? 'HEAD');
  return runRemote(a, cwd);
}

export function gitPull(
  args: { remote?: unknown; branch?: unknown },
  cwd: string,
): Promise<GitToolResult> {
  const remote = args.remote ?? 'origin';
  if (badRef(remote)) return Promise.resolve(err('invalid remote'));
  if (args.branch !== undefined && badRef(args.branch)) {
    return Promise.resolve(err('invalid branch'));
  }
  const a = ['pull', '--ff-only', remote as string];
  if (args.branch !== undefined) a.push(args.branch as string);
  return runRemote(a, cwd);
}

export function gitMerge(args: { ref?: unknown }, cwd: string): Promise<GitToolResult> {
  if (badRef(args.ref)) return Promise.resolve(err('ref (string) required'));
  return runRemote(['merge', '--ff-only', args.ref as string], cwd);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run --project backend server/mcp/builtin/aether-git.handler.test.ts && npm run lint`
Expected: PASS, lint clean.

- [ ] **Step 5: Commit**

```bash
git add server/mcp/builtin/aether-git.handler.ts server/mcp/builtin/aether-git.handler.test.ts
git commit -m "feat(slice-29): aether-git remote handlers (fetch/push/pull/merge, ff-only, fail-fast)"
```

---

## Task 3: aether-git server — expose the remote tools

**Files:**
- Modify: `server/mcp/builtin/aether-git.ts:25-32,55-62`

- [ ] **Step 1: Add the tools to `TOOLS`** — append these four entries to the `TOOLS` array (after `git_restore`, before the closing `]`):

```ts
  { name: 'git_fetch', description: 'Fetch from a remote (default origin). Updates remote-tracking refs.', inputSchema: { type: 'object', properties: { remote: { type: 'string' } }, required: [] } },
  { name: 'git_push', description: 'Push the current branch to a remote (default origin). Never force.', inputSchema: { type: 'object', properties: { remote: { type: 'string' }, branch: { type: 'string' }, setUpstream: { type: 'boolean' } }, required: [] } },
  { name: 'git_pull', description: 'Pull with --ff-only from a remote (default origin). Aborts on divergence.', inputSchema: { type: 'object', properties: { remote: { type: 'string' }, branch: { type: 'string' } }, required: [] } },
  { name: 'git_merge', description: 'Merge a ref into the current branch with --ff-only.', inputSchema: { type: 'object', properties: { ref: { type: 'string' } }, required: ['ref'] } },
```

- [ ] **Step 2: Add the dispatch cases** — add the import on the handler-import line at the top of the file:

```ts
import {
  gitStatus, gitDiff, gitAdd, gitCommit, gitCheckout, gitRestore,
  gitFetch, gitPush, gitPull, gitMerge,
} from './aether-git.handler';
```

and add these cases in the `tools/call` switch (after `git_restore`, before `default`):

```ts
      case 'git_fetch': return { ...base, result: await gitFetch(args, CWD) };
      case 'git_push': return { ...base, result: await gitPush(args, CWD) };
      case 'git_pull': return { ...base, result: await gitPull(args, CWD) };
      case 'git_merge': return { ...base, result: await gitMerge(args, CWD) };
```

- [ ] **Step 3: Type-check**

Run: `npm run lint`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add server/mcp/builtin/aether-git.ts
git commit -m "feat(slice-29): expose remote tools on the aether-git MCP server"
```

---

## Task 4: Classify push/pull/merge as dangerous (fetch stays safe)

**Files:**
- Modify: `server/domain/mcp/breakpoints/breakpoints.types.ts:24`
- Test: `server/domain/mcp/breakpoints/classify.test.ts`

- [ ] **Step 1: Write the failing test** — append to `server/domain/mcp/breakpoints/classify.test.ts`:

```ts
describe('classifyTool — git remote tools (slice 29)', () => {
  for (const name of ['Git.git_push', 'Git.git_pull', 'Git.git_merge']) {
    it(`classifies ${name} as dangerous`, () => {
      expect(classifyTool({ qualifiedName: name, args: {} }).category).toBe('dangerous');
    });
  }
  it('classifies Git.git_fetch as safe (read-only remote)', () => {
    expect(classifyTool({ qualifiedName: 'Git.git_fetch', args: {} }).category).toBe('safe');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run --project backend server/domain/mcp/breakpoints/classify.test.ts`
Expected: FAIL — `Git.git_pull`/`Git.git_merge` classify `safe`.

- [ ] **Step 3: Extend the dangerous pattern** — `server/domain/mcp/breakpoints/breakpoints.types.ts` line 24:

```ts
  /^[^.]+\.git_(rebase|push|reset|add|commit|checkout|switch|restore)/i,
```
→
```ts
  /^[^.]+\.git_(rebase|push|reset|add|commit|checkout|switch|restore|pull|merge)/i,
```

(`fetch` is intentionally omitted → stays safe → auto.)

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run --project backend server/domain/mcp/breakpoints/classify.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/domain/mcp/breakpoints/breakpoints.types.ts server/domain/mcp/breakpoints/classify.test.ts
git commit -m "feat(slice-29): classify push/pull/merge dangerous; fetch stays safe"
```

---

## Task 5: commitList preview for remote ops

**Files:**
- Modify: `server/domain/mcp/breakpoints/breakpoints.types.ts:16-19`
- Modify: `src/types/breakpoints.types.ts:16-18`
- Modify: `server/domain/mcp/breakpoints/preview.service.ts`
- Test: `server/domain/mcp/breakpoints/preview.service.test.ts`

- [ ] **Step 1: Write the failing test** — append to `server/domain/mcp/breakpoints/preview.service.test.ts` (reuse its existing git/tmp helpers; add a bare-remote helper if not present):

```ts
describe('PreviewService — commitList for remote (slice 29)', () => {
  function repoWithOutgoing(): string {
    const bare = mkdtempSync(join(tmpdir(), 'aether-pbare-'));
    execFileSync('git', ['init', '--bare', '-q', bare], { stdio: 'pipe' });
    const work = mkdtempSync(join(tmpdir(), 'aether-pwork-'));
    git(work, 'init', '-q');
    git(work, 'symbolic-ref', 'HEAD', 'refs/heads/main');
    writeFileSync(join(work, 'a.txt'), 'A1\n');
    git(work, 'add', '.'); git(work, 'commit', '-q', '-m', 'first');
    git(work, 'remote', 'add', 'origin', bare);
    git(work, 'push', '-q', '-u', 'origin', 'main');
    writeFileSync(join(work, 'b.txt'), 'B\n');
    git(work, 'add', '.'); git(work, 'commit', '-q', '-m', 'outgoing commit');
    return work; // origin/main is now 1 commit behind HEAD
  }

  it('git_push → commitList of outgoing commits', async () => {
    const work = repoWithOutgoing();
    try {
      const svc = new PreviewService({ safeRoots: () => [], gitRoot: () => work });
      const r = await svc.previewToolCall({ qualifiedName: 'Git.git_push', args: { remote: 'origin' } });
      expect(r.kind).toBe('commitList');
      if (r.kind === 'commitList') {
        expect(r.commits.length).toBe(1);
        expect(r.commits[0]).toMatch(/outgoing commit/);
        expect(r.title).toMatch(/origin\/main/);
      }
    } finally {
      rmSync(work, { recursive: true, force: true });
    }
  });

  it('degrades to plain when there is no upstream', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'aether-pnoup-'));
    git(dir, 'init', '-q');
    git(dir, 'symbolic-ref', 'HEAD', 'refs/heads/main');
    writeFileSync(join(dir, 'a.txt'), 'A\n');
    git(dir, 'add', '.'); git(dir, 'commit', '-q', '-m', 'x');
    try {
      const svc = new PreviewService({ safeRoots: () => [], gitRoot: () => dir });
      const r = await svc.previewToolCall({ qualifiedName: 'Git.git_push', args: { remote: 'origin' } });
      expect(r.kind).toBe('plain');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run --project backend server/domain/mcp/breakpoints/preview.service.test.ts`
Expected: FAIL — no `commitList` kind; remote tools fall through to `plain`.

- [ ] **Step 3a: Add the `commitList` kind (server)** — `server/domain/mcp/breakpoints/breakpoints.types.ts` lines 16-19:

```ts
export type PreviewResult =
  | { kind: 'diff'; oldText: string; newText: string; path: string }
  | { kind: 'gitDiff'; unified: string; title: string }
  | { kind: 'plain' };
```
→
```ts
export type PreviewResult =
  | { kind: 'diff'; oldText: string; newText: string; path: string }
  | { kind: 'gitDiff'; unified: string; title: string }
  | { kind: 'commitList'; title: string; commits: string[] }
  | { kind: 'plain' };
```

- [ ] **Step 3b: Add the `commitList` kind (frontend)** — apply the identical change to `src/types/breakpoints.types.ts`.

- [ ] **Step 3c: Implement the remote preview** — `server/domain/mcp/breakpoints/preview.service.ts`:

Add the pattern constant after `GIT_DIFF_PREVIEW_PATTERN` (line 8):

```ts
const GIT_REMOTE_PREVIEW_PATTERN = /^[^.]+\.git_(push|pull|merge)$/i;
const SAFE_REF = /^[\w./-]+$/;
```

Add the dispatch at the top of `previewToolCall` (before the `GIT_DIFF_PREVIEW_PATTERN` check on line 22):

```ts
    if (GIT_REMOTE_PREVIEW_PATTERN.test(input.qualifiedName)) {
      return this.remotePreview(input.qualifiedName, input.args);
    }
```

Add the method (next to `gitPreview`):

```ts
  private async remotePreview(
    qualifiedName: string,
    args: Record<string, unknown>,
  ): Promise<PreviewResult> {
    const root = this.deps.gitRoot();
    if (!root) return { kind: 'plain' };
    const tool = qualifiedName.split('.')[1];
    const remote = typeof args.remote === 'string' && SAFE_REF.test(args.remote) ? args.remote : 'origin';

    try {
      const branchRes = await runGit(['rev-parse', '--abbrev-ref', 'HEAD'], root);
      const branch = branchRes.stdout.trim();
      if (!branch || branch === 'HEAD') return { kind: 'plain' };

      if (tool === 'git_push') {
        const { stdout, code } = await runGit(
          ['log', `${remote}/${branch}..HEAD`, '--oneline', '--no-color'],
          root,
        );
        if (code !== 0) return { kind: 'plain' };
        const commits = stdout.split('\n').map((s) => s.trim()).filter(Boolean);
        return { kind: 'commitList', title: `Push ${commits.length} commit(s) → ${remote}/${branch}`, commits };
      }

      // git_pull / git_merge → incoming commits we don't yet have.
      const ref =
        tool === 'git_merge'
          ? (typeof args.ref === 'string' && SAFE_REF.test(args.ref) ? args.ref : null)
          : `${remote}/${branch}`;
      if (!ref) return { kind: 'plain' };
      const { stdout, code } = await runGit(['log', `HEAD..${ref}`, '--oneline', '--no-color'], root);
      if (code !== 0) return { kind: 'plain' };
      const commits = stdout.split('\n').map((s) => s.trim()).filter(Boolean);
      return { kind: 'commitList', title: `Will merge ${commits.length} commit(s) from ${ref}`, commits };
    } catch {
      return { kind: 'plain' };
    }
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run --project backend server/domain/mcp/breakpoints/preview.service.test.ts && npm run lint`
Expected: PASS, lint clean.

- [ ] **Step 5: Commit**

```bash
git add server/domain/mcp/breakpoints/breakpoints.types.ts src/types/breakpoints.types.ts server/domain/mcp/breakpoints/preview.service.ts server/domain/mcp/breakpoints/preview.service.test.ts
git commit -m "feat(slice-29): commitList preview for remote ops (outgoing/incoming commits)"
```

---

## Task 6: ApprovalGate renders the commitList preview

**Files:**
- Modify: `src/components/chat/ApprovalGate.tsx:94-103`

- [ ] **Step 1: Add the render block** — in `src/components/chat/ApprovalGate.tsx`, after the existing `preview.kind === 'gitDiff'` block (ends at line 103), add:

```tsx
      {preview.kind === 'commitList' && (
        <div className="mb-3">
          <div className="text-zinc-500 text-[10px] font-mono mb-1 uppercase tracking-wider">
            {preview.title}
          </div>
          <ul className="bg-zinc-950 border border-border-subtle rounded max-h-60 overflow-auto p-2 font-mono text-[11px] text-zinc-300">
            {preview.commits.length === 0 ? (
              <li className="text-zinc-600">(no commits)</li>
            ) : (
              preview.commits.map((c, i) => (
                <li key={i} className="truncate">{c}</li>
              ))
            )}
          </ul>
        </div>
      )}
```

- [ ] **Step 2: Verify the frontend type-checks and the suite is green**

Run: `npm run lint && npx vitest run --project frontend src/components/chat`
Expected: PASS (the `commitList` kind is now handled; tsc is satisfied that the union is exhausted).

- [ ] **Step 3: Commit**

```bash
git add src/components/chat/ApprovalGate.tsx
git commit -m "feat(slice-29): ApprovalGate renders commitList preview for remote git ops"
```

---

## Task 7: Full verification, manual smoke, docs

**Files:**
- Modify: `docs/superpowers/roadmap.md`

- [ ] **Step 1: Full suite + build**

Run: `npm run lint && npm run test:run && npm run build`
Expected: lint clean; all tests green (existing + new slice-29 tests); build OK (`dist/server/mcp/builtin/aether-git.js` still emitted).

- [ ] **Step 2: Manual smoke (local bare remote, no credentials)**

```bash
# scratch repo with a bare 'origin'
BARE=$(mktemp -d); git init --bare -q "$BARE"
WORK=$(mktemp -d); git -C "$WORK" init -q; git -C "$WORK" symbolic-ref HEAD refs/heads/main
echo a > "$WORK/a.txt"; git -C "$WORK" add .; git -C "$WORK" -c user.email=t@t -c user.name=t commit -qm first
git -C "$WORK" remote add origin "$BARE"; git -C "$WORK" push -qu origin main
echo b > "$WORK/b.txt"; git -C "$WORK" add .; git -C "$WORK" -c user.email=t@t -c user.name=t commit -qm second

AETHER_FAKE_PROVIDER=1 PORT=3941 AETHER_DATA_DIR=/tmp/aether-git29 npm run dev
```
Then via the API: enable the git builtin, create a workspace at "$WORK", attach it to the active session, and confirm:
- `GET /api/breakpoints/classify?qualifiedName=Git.git_push` → `dangerous`; `?qualifiedName=Git.git_fetch` → `safe`.
- `POST /api/breakpoints/preview {qualifiedName:'Git.git_push', args:{remote:'origin'}}` → `{kind:'commitList', commits:[…'second'…]}`.
Kill the server; remove "$BARE", "$WORK", and the scratch data dir.

- [ ] **Step 3: Update the roadmap** — in `docs/superpowers/roadmap.md`: add a slice 29 row to the Shipped table and mark Git integration **Tier 3** shipped in the candidate section (mirroring how Tier 1/2 were marked).

- [ ] **Step 4: Commit + open PR**

```bash
git add docs/superpowers/roadmap.md
git commit -m "docs(slice-29): mark Git integration Tier 3 (remote actions) shipped"
git push -u origin feat/slice-29-git-remote
# open PR feat/slice-29-git-remote -> main (after slices 27 & 28 merge; rebase if needed)
```

---

## Notes on testing scope

- **E2e (Playwright):** deferred — same rationale as slice 28 (an agent-driven gate e2e is heavy). The handler/preview/classification tests + manual smoke cover the behavior.
- **No network:** every remote test uses a local bare repo as `origin`; nothing reaches the internet, so tests are credential-free and deterministic.
- **Coverage:** the enforced globs (`server/domain/**`, `src/lib/**`, `src/stores/**`) are covered by handler/preview/classify/runner tests. `aether-git.ts` (stdio loop) stays untested, mirroring `aether-shell.ts`.
