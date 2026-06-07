# Git Write Actions (Tier 2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expose agent-initiated git write actions (add/commit/checkout/restore) plus read tools (status/diff) as a builtin `aether-git` MCP server, gated through the existing breakpoint machinery with an in-process git diff preview.

**Architecture:** Git writes become real MCP tool calls inside the dispatch loop, so they reuse the entire breakpoint gate (classify → gate → await decision → ApprovalGate → execute) with zero new gating infrastructure. The MCP handler reuses the slice-27 `runGit` runner; previews reuse the slice-27 unified-diff renderer. The git working directory auto-roots to the active session's workspace, mirroring the filesystem builtin.

**Tech Stack:** Node JSON-RPC stdio MCP server, better-sqlite3 migration, Express, React 19 + Zustand, Vitest.

**Spec:** `docs/superpowers/specs/2026-06-07-slice-28-git-write-design.md`

---

## Branch

Slice 27 is not merged yet; slice 28 builds on slice-27 code. Create `feat/slice-28-git-write` **from the current `feat/slice-27-git-swimlanes` branch** (so slice-27 code is present). After slice 27 merges to `main`, rebase this branch onto `main`.

```bash
git checkout feat/slice-27-git-swimlanes
git checkout -b feat/slice-28-git-write
```

---

## Task 1: Extend the git runner allowlist to permit write subcommands

The slice-27 runner allows only `log/show/rev-parse`. The git MCP needs `status/diff/add/commit/checkout/switch/restore`. Safety invariants (`shell:false`, argv array, cwd validation, output cap, timeout) are unchanged — only the allowlist set grows.

**Files:**
- Modify: `server/domain/git/git.runner.ts:8`
- Test: `server/domain/git/git.runner.test.ts`

- [ ] **Step 1: Write the failing test** — append to `server/domain/git/git.runner.test.ts` (inside the existing top-level `describe`/file, after the last test):

```ts
describe('runGit — write subcommand allowlist (slice 28)', () => {
  it('permits write subcommands (does not reject as unsupported)', async () => {
    const repo = makeRepo(); // existing helper in this file
    try {
      // 'status' is now allowlisted: resolves instead of throwing GIT_SUBCOMMAND.
      const r = await runGit(['status', '--porcelain=v2'], repo);
      expect(r.code).toBe(0);
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });

  it('still rejects a non-allowlisted subcommand', async () => {
    const repo = makeRepo();
    try {
      await expect(runGit(['clone', 'x'], repo)).rejects.toThrow(/unsupported git subcommand/);
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });
});
```

> If `makeRepo`/`rmSync` are not already imported/defined in this test file, mirror the helper from `server/domain/git/git.service.test.ts` (it builds a temp repo with `execFileSync('git', …)`). Reuse whatever the file already has.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run --project backend server/domain/git/git.runner.test.ts`
Expected: FAIL — `runGit(['status', …])` throws `unsupported git subcommand: status`.

- [ ] **Step 3: Extend the allowlist** — in `server/domain/git/git.runner.ts`, replace line 8:

```ts
export const GIT_SUBCOMMANDS = new Set(['log', 'show', 'rev-parse']);
```

with:

```ts
export const GIT_SUBCOMMANDS = new Set([
  // read (slice 27)
  'log', 'show', 'rev-parse', 'status', 'diff',
  // write (slice 28)
  'add', 'commit', 'checkout', 'switch', 'restore',
]);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run --project backend server/domain/git`
Expected: PASS (all runner + service tests green).

- [ ] **Step 5: Commit**

```bash
git add server/domain/git/git.runner.ts server/domain/git/git.runner.test.ts
git commit -m "feat(slice-28): extend git runner allowlist with write subcommands"
```

---

## Task 2: aether-git MCP handler

Pure handler functions, one per tool, each building an explicit argv array and calling `runGit`. Never throws (errors → `{ isError: true }`).

**Files:**
- Create: `server/mcp/builtin/aether-git.handler.ts`
- Test: `server/mcp/builtin/aether-git.handler.test.ts`

- [ ] **Step 1: Write the failing test** — create `server/mcp/builtin/aether-git.handler.test.ts`:

```ts
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  gitStatus, gitDiff, gitAdd, gitCommit, gitCheckout, gitRestore,
} from './aether-git.handler';

const ENV = {
  GIT_AUTHOR_NAME: 'T', GIT_AUTHOR_EMAIL: 't@a.dev',
  GIT_COMMITTER_NAME: 'T', GIT_COMMITTER_EMAIL: 't@a.dev',
};
function git(cwd: string, ...a: string[]) {
  execFileSync('git', a, { cwd, stdio: 'pipe', env: { ...process.env, ...ENV } });
}
function makeRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), 'aether-gitw-'));
  git(dir, 'init', '-q');
  git(dir, 'symbolic-ref', 'HEAD', 'refs/heads/main');
  writeFileSync(join(dir, 'a.txt'), 'A1\n');
  git(dir, 'add', '.');
  git(dir, 'commit', '-q', '-m', 'first');
  return dir;
}

describe('aether-git.handler', () => {
  let repo: string;
  beforeEach(() => { repo = makeRepo(); });
  afterEach(() => rmSync(repo, { recursive: true, force: true }));

  it('git_status reports a clean branch', async () => {
    const r = await gitStatus(repo);
    expect(r.isError).toBe(false);
    expect(r.content[0].text).toMatch(/branch\.head main/);
  });

  it('git_add then git_commit creates a commit', async () => {
    writeFileSync(join(repo, 'b.txt'), 'B\n');
    const add = await gitAdd({ paths: ['b.txt'] }, repo);
    expect(add.isError).toBe(false);
    const staged = await gitDiff({ staged: true }, repo);
    expect(staged.content[0].text).toMatch(/b\.txt/);
    const commit = await gitCommit({ message: 'add b' }, repo);
    expect(commit.isError).toBe(false);
    expect(execFileSync('git', ['log', '--oneline'], { cwd: repo }).toString()).toMatch(/add b/);
  });

  it('git_commit with nothing staged returns isError', async () => {
    const r = await gitCommit({ message: 'noop' }, repo);
    expect(r.isError).toBe(true);
    expect(r.content[0].text).toMatch(/nothing to commit/i);
  });

  it('git_checkout create makes a new branch', async () => {
    const r = await gitCheckout({ branch: 'feature/x', create: true }, repo);
    expect(r.isError).toBe(false);
    expect(execFileSync('git', ['branch'], { cwd: repo }).toString()).toMatch(/feature\/x/);
  });

  it('git_restore discards an unstaged change', async () => {
    writeFileSync(join(repo, 'a.txt'), 'CHANGED\n');
    const r = await gitRestore({ paths: ['a.txt'] }, repo);
    expect(r.isError).toBe(false);
    expect(execFileSync('git', ['diff'], { cwd: repo }).toString()).toBe('');
  });

  it('rejects empty paths and path starting with dash', async () => {
    expect((await gitAdd({ paths: [] }, repo)).isError).toBe(true);
    expect((await gitAdd({ paths: ['-rf'] }, repo)).isError).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run --project backend server/mcp/builtin/aether-git.handler.test.ts`
Expected: FAIL — module `./aether-git.handler` not found.

- [ ] **Step 3: Implement the handler** — create `server/mcp/builtin/aether-git.handler.ts`:

```ts
import { runGit } from '@/server/domain/git/git.runner';

export interface GitToolResult {
  isError: boolean;
  content: Array<{ type: 'text'; text: string }>;
}

function ok(stdout: string, stderr: string, code: number): GitToolResult {
  const text = [stdout.trim(), stderr.trim()].filter(Boolean).join('\n') || `exit code: ${code}`;
  return { isError: code !== 0, content: [{ type: 'text', text }] };
}

function err(message: string): GitToolResult {
  return { isError: true, content: [{ type: 'text', text: message }] };
}

function badPath(p: unknown): boolean {
  return typeof p !== 'string' || p.length === 0 || p.startsWith('-');
}

async function run(args: string[], cwd: string): Promise<GitToolResult> {
  try {
    const r = await runGit(args, cwd);
    return ok(r.stdout, r.stderr, r.code);
  } catch (e) {
    return err(e instanceof Error ? e.message : 'git failed');
  }
}

export function gitStatus(cwd: string): Promise<GitToolResult> {
  return run(['status', '--porcelain=v2', '--branch'], cwd);
}

export function gitDiff(args: { staged?: boolean; path?: string }, cwd: string): Promise<GitToolResult> {
  const a = ['diff'];
  if (args.staged) a.push('--cached');
  if (args.path !== undefined) {
    if (badPath(args.path)) return Promise.resolve(err('invalid path'));
    a.push('--', args.path);
  }
  return run(a, cwd);
}

export function gitAdd(args: { paths?: unknown }, cwd: string): Promise<GitToolResult> {
  const paths = Array.isArray(args.paths) ? args.paths : [];
  if (paths.length === 0) return Promise.resolve(err('paths (non-empty string[]) required'));
  for (const p of paths) if (badPath(p)) return Promise.resolve(err(`invalid path: ${String(p)}`));
  return run(['add', '--', ...(paths as string[])], cwd);
}

export function gitCommit(args: { message?: unknown }, cwd: string): Promise<GitToolResult> {
  if (typeof args.message !== 'string' || args.message.trim().length === 0) {
    return Promise.resolve(err('message (non-empty string) required'));
  }
  return run(['commit', '-m', args.message], cwd);
}

export function gitCheckout(args: { branch?: unknown; create?: unknown }, cwd: string): Promise<GitToolResult> {
  if (typeof args.branch !== 'string' || args.branch.length === 0 || args.branch.startsWith('-')) {
    return Promise.resolve(err('branch (string) required'));
  }
  const a = ['checkout'];
  if (args.create === true) a.push('-b');
  a.push(args.branch);
  return run(a, cwd);
}

export function gitRestore(args: { paths?: unknown; staged?: unknown }, cwd: string): Promise<GitToolResult> {
  const paths = Array.isArray(args.paths) ? args.paths : [];
  if (paths.length === 0) return Promise.resolve(err('paths (non-empty string[]) required'));
  for (const p of paths) if (badPath(p)) return Promise.resolve(err(`invalid path: ${String(p)}`));
  const a = ['restore'];
  if (args.staged === true) a.push('--staged');
  a.push('--', ...(paths as string[]));
  return run(a, cwd);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run --project backend server/mcp/builtin/aether-git.handler.test.ts`
Expected: PASS (all handler tests green).

- [ ] **Step 5: Commit**

```bash
git add server/mcp/builtin/aether-git.handler.ts server/mcp/builtin/aether-git.handler.test.ts
git commit -m "feat(slice-28): aether-git MCP handler (status/diff/add/commit/checkout/restore)"
```

---

## Task 3: aether-git MCP server (JSON-RPC stdio)

Thin server mirroring `aether-shell.ts`; cwd from `process.argv[2]`. All logic lives in the (tested) handler, so the server file itself is not unit-tested — same as `aether-shell.ts`.

**Files:**
- Create: `server/mcp/builtin/aether-git.ts`

- [ ] **Step 1: Implement the server** — create `server/mcp/builtin/aether-git.ts`:

```ts
#!/usr/bin/env node
import {
  gitStatus, gitDiff, gitAdd, gitCommit, gitCheckout, gitRestore,
} from './aether-git.handler';

type JsonRpcRequest = {
  jsonrpc: '2.0';
  id: string | number;
  method: string;
  params?: Record<string, unknown>;
};
type JsonRpcResponse = {
  jsonrpc: '2.0';
  id: string | number;
  result?: unknown;
  error?: { code: number; message: string };
};

const CWD = process.argv[2] || process.cwd();

function send(res: JsonRpcResponse): void {
  process.stdout.write(JSON.stringify(res) + '\n');
}

const TOOLS = [
  { name: 'git_status', description: 'Show working-tree status (porcelain v2).', inputSchema: { type: 'object', properties: {}, required: [] } },
  { name: 'git_diff', description: 'Show a diff. staged=true for staged changes; optional path.', inputSchema: { type: 'object', properties: { staged: { type: 'boolean' }, path: { type: 'string' } }, required: [] } },
  { name: 'git_add', description: 'Stage the given paths.', inputSchema: { type: 'object', properties: { paths: { type: 'array', items: { type: 'string' } } }, required: ['paths'] } },
  { name: 'git_commit', description: 'Commit staged changes with a message.', inputSchema: { type: 'object', properties: { message: { type: 'string' } }, required: ['message'] } },
  { name: 'git_checkout', description: 'Switch to a branch; create=true makes a new branch.', inputSchema: { type: 'object', properties: { branch: { type: 'string' }, create: { type: 'boolean' } }, required: ['branch'] } },
  { name: 'git_restore', description: 'Discard changes in the given paths. staged=true unstages.', inputSchema: { type: 'object', properties: { paths: { type: 'array', items: { type: 'string' } }, staged: { type: 'boolean' } }, required: ['paths'] } },
];

async function handle(req: JsonRpcRequest): Promise<JsonRpcResponse> {
  const base = { jsonrpc: '2.0' as const, id: req.id };

  if (req.method === 'initialize') {
    return {
      ...base,
      result: {
        protocolVersion: '2024-11-05',
        capabilities: { tools: {} },
        serverInfo: { name: 'aether-git', version: '0.1.0' },
      },
    };
  }

  if (req.method === 'tools/list') {
    return { ...base, result: { tools: TOOLS } };
  }

  if (req.method === 'tools/call') {
    const params = (req.params ?? {}) as { name?: string; arguments?: Record<string, unknown> };
    const args = (params.arguments ?? {}) as Record<string, unknown>;
    switch (params.name) {
      case 'git_status': return { ...base, result: await gitStatus(CWD) };
      case 'git_diff': return { ...base, result: await gitDiff(args, CWD) };
      case 'git_add': return { ...base, result: await gitAdd(args, CWD) };
      case 'git_commit': return { ...base, result: await gitCommit(args, CWD) };
      case 'git_checkout': return { ...base, result: await gitCheckout(args, CWD) };
      case 'git_restore': return { ...base, result: await gitRestore(args, CWD) };
      default: return { ...base, error: { code: -32601, message: `Unknown tool: ${params.name}` } };
    }
  }

  return { ...base, error: { code: -32601, message: `Unknown method: ${req.method}` } };
}

let buffer = '';
process.stdin.setEncoding('utf-8');
process.stdin.on('data', (chunk: string) => {
  buffer += chunk;
  let idx: number;
  while ((idx = buffer.indexOf('\n')) >= 0) {
    const line = buffer.slice(0, idx).trim();
    buffer = buffer.slice(idx + 1);
    if (!line) continue;
    let req: JsonRpcRequest;
    try {
      req = JSON.parse(line) as JsonRpcRequest;
    } catch {
      send({ jsonrpc: '2.0', id: 0, error: { code: -32700, message: 'Parse error' } });
      continue;
    }
    void handle(req).then(send);
  }
});

process.stdin.on('end', () => process.exit(0));
process.on('SIGTERM', () => process.exit(0));
```

- [ ] **Step 2: Type-check**

Run: `npm run lint`
Expected: PASS (no type errors).

- [ ] **Step 3: Commit**

```bash
git add server/mcp/builtin/aether-git.ts
git commit -m "feat(slice-28): aether-git MCP server (JSON-RPC stdio, cwd from argv)"
```

---

## Task 4: Add the `git` builtin transport + migration (+ fix count assertions)

> Migration 012 adds a **3rd** builtin row. Several existing tests assert exactly 2
> rows and the route validator only accepts 2 transports — all must be updated here,
> or the suite (and the feature) breaks. The frontend MSW-mocked tests
> (`src/stores/builtinMcp.store.test.ts`, `src/lib/api/builtin-mcp.api.test.ts`,
> `src/integration/builtin-mcp.integration.test.tsx`) hardcode their own payloads and
> do NOT need changes.

**Files:**
- Modify: `server/domain/mcp/builtin/builtin.types.ts:1`
- Modify: `src/types/mcp.types.ts:12`
- Create: `server/db/migrations/012_builtin_git.sql`
- Modify: `server/routes/builtin-mcp.routes.ts:14` (VALID_TRANSPORTS — **functional**, else PUT /git → 400)
- Modify (tests): `server/domain/mcp/builtin/builtin.store.test.ts`, `server/routes/builtin-mcp.routes.test.ts:45`

- [ ] **Step 1: Update + extend the existing store test** — `server/domain/mcp/builtin/builtin.store.test.ts` already uses `makeTestDb()` (real migrations) and asserts 2 rows. Update the existing first test's assertions (lines ~20-21) from:

```ts
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.transport).sort()).toEqual(['filesystem', 'terminal']);
```
to:
```ts
    expect(rows).toHaveLength(3);
    expect(rows.map((r) => r.transport).sort()).toEqual(['filesystem', 'git', 'terminal']);
```

Then append a new describe block (reusing the file's existing `store`/`makeTestDb` setup):

```ts
describe('BuiltinMcpStore — git transport (slice 28)', () => {
  it('seeds a disabled git row', () => {
    const git = store.read().find((r) => r.transport === 'git');
    expect(git).toBeDefined();
    expect(git!.enabled).toBe(false);
    expect(git!.fsRoot).toBeNull();
  });

  it('toConfigs includes a Git config when enabled, rooted at the last arg', () => {
    store.setEnabled('git', true);
    const configs = store.toConfigs('/tmp/work');
    const git = configs.find((c) => c.id === 'builtin:git');
    expect(git).toBeDefined();
    expect(git!.name).toBe('Git');
    expect(git!.args[git!.args.length - 1]).toBe('/tmp/work');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run --project backend server/domain/mcp/builtin/builtin.store.test.ts`
Expected: FAIL — migration has no `git` row yet (3-row assertion fails; `toConfigs` has no `builtin:git`).

- [ ] **Step 3a: Extend the backend transport type** — `server/domain/mcp/builtin/builtin.types.ts` line 1:

```ts
export type BuiltinTransport = 'filesystem' | 'terminal';
```
→
```ts
export type BuiltinTransport = 'filesystem' | 'terminal' | 'git';
```

- [ ] **Step 3b: Extend the frontend transport type** — `src/types/mcp.types.ts` line 12:

```ts
export type BuiltinTransport = 'filesystem' | 'terminal';
```
→
```ts
export type BuiltinTransport = 'filesystem' | 'terminal' | 'git';
```

- [ ] **Step 3c: Create the migration** — `server/db/migrations/012_builtin_git.sql`:

```sql
-- Add 'git' to the builtin MCP transports (slice 28). SQLite cannot ALTER a CHECK
-- constraint, so rebuild the table preserving existing rows, then seed 'git'.
CREATE TABLE builtin_mcp_state_new (
  transport TEXT PRIMARY KEY CHECK (transport IN ('filesystem','terminal','git')),
  enabled INTEGER NOT NULL DEFAULT 0,
  fs_root TEXT
);
INSERT INTO builtin_mcp_state_new (transport, enabled, fs_root)
  SELECT transport, enabled, fs_root FROM builtin_mcp_state;
DROP TABLE builtin_mcp_state;
ALTER TABLE builtin_mcp_state_new RENAME TO builtin_mcp_state;
INSERT INTO builtin_mcp_state (transport, enabled, fs_root) VALUES ('git', 0, NULL);
```

- [ ] **Step 3d: Accept `git` in the route validator (functional)** — `server/routes/builtin-mcp.routes.ts` line 14:

```ts
const VALID_TRANSPORTS: readonly BuiltinTransport[] = ['filesystem', 'terminal'];
```
→
```ts
const VALID_TRANSPORTS: readonly BuiltinTransport[] = ['filesystem', 'terminal', 'git'];
```

- [ ] **Step 3e: Update the routes test count** — `server/routes/builtin-mcp.routes.test.ts` line ~45 (this test uses `makeTestDb`, so migration 012 makes it 3 rows). Change:

```ts
  it('GET /api/mcp/builtin returns 2 disabled rows', async () => {
    const res = await request(app).get('/api/mcp/builtin');
    expect(res.status).toBe(200);
    expect(res.body.builtins).toHaveLength(2);
```
to:
```ts
  it('GET /api/mcp/builtin returns 3 disabled rows', async () => {
    const res = await request(app).get('/api/mcp/builtin');
    expect(res.status).toBe(200);
    expect(res.body.builtins).toHaveLength(3);
```

- [ ] **Step 4: Run tests to verify they pass** (implement Task 5's `toConfigs` branch first — the two are coupled; do Task 5 now, then return here).

Run: `npx vitest run --project backend server/domain/mcp/builtin/builtin.store.test.ts server/routes/builtin-mcp.routes.test.ts`
Expected: migration + 3-row assertions PASS; `toConfigs` git assertion passes after Task 5.

- [ ] **Step 5: Commit**

```bash
git add server/domain/mcp/builtin/builtin.types.ts src/types/mcp.types.ts server/db/migrations/012_builtin_git.sql server/routes/builtin-mcp.routes.ts server/domain/mcp/builtin/builtin.store.test.ts server/routes/builtin-mcp.routes.test.ts
git commit -m "feat(slice-28): add 'git' builtin transport + migration 012 (validator + count assertions)"
```

---

## Task 5: Launch config for the git builtin (`toConfigs` + `resolveAetherGitArgs`)

**Files:**
- Modify: `server/domain/mcp/builtin/builtin.store.ts:29-46` (add `resolveAetherGitArgs`) and `:74-98` (add git branch)

- [ ] **Step 1: Add `resolveAetherGitArgs`** — in `server/domain/mcp/builtin/builtin.store.ts`, directly after the existing `resolveAetherShellArgs()` function (ends at line 46), add:

```ts
function resolveAetherGitArgs(): string[] {
  // Mirrors resolveAetherShellArgs for the aether-git MCP entry.
  const here = path.dirname(fileURLToPath(import.meta.url));
  const srcEntry = path.resolve(here, '../../../mcp/builtin/aether-git.ts');
  const distEntry = path.resolve(process.cwd(), 'dist/server/mcp/builtin/aether-git.js');
  try {
    require.resolve(distEntry);
    return [distEntry];
  } catch {
    return ['--import', 'tsx', srcEntry];
  }
}
```

- [ ] **Step 2: Add the git branch in `toConfigs`** — replace the body of the `rows.map((r) => { … })` (lines 76-97) so all three transports are explicit:

```ts
    return rows.map((r) => {
      if (r.transport === 'filesystem') {
        return {
          id: 'builtin:filesystem',
          name: 'Filesystem',
          transport: 'stdio',
          command: process.execPath,
          args: [resolveFilesystemServerEntry(), r.fsRoot ?? defaultCwd],
          env: {},
          status: 'offline',
        } as McpServerConfig;
      }
      if (r.transport === 'git') {
        return {
          id: 'builtin:git',
          name: 'Git',
          transport: 'stdio',
          command: process.execPath,
          args: [...resolveAetherGitArgs(), r.fsRoot ?? defaultCwd],
          env: {},
          status: 'offline',
        } as McpServerConfig;
      }
      return {
        id: 'builtin:terminal',
        name: 'Terminal',
        transport: 'stdio',
        command: process.execPath,
        args: resolveAetherShellArgs(),
        env: {},
        status: 'offline',
      } as McpServerConfig;
    });
```

- [ ] **Step 3: Run the store test to verify it passes**

Run: `npx vitest run --project backend server/domain/mcp/builtin/builtin.store.test.ts`
Expected: PASS (both git row + toConfigs assertions).

- [ ] **Step 4: Commit**

```bash
git add server/domain/mcp/builtin/builtin.store.ts
git commit -m "feat(slice-28): git builtin launch config (toConfigs + resolveAetherGitArgs)"
```

---

## Task 6: Classify git write tools as dangerous (→ gate)

**Files:**
- Modify: `server/domain/mcp/breakpoints/breakpoints.types.ts:23`
- Test: `server/domain/mcp/breakpoints/classify.test.ts` (create if absent)

- [ ] **Step 1: Write the failing test** — create/append `server/domain/mcp/breakpoints/classify.test.ts`:

```ts
import { classifyTool } from './classify';

describe('classifyTool — git tools (slice 28)', () => {
  for (const name of ['Git.git_add', 'Git.git_commit', 'Git.git_checkout', 'Git.git_restore']) {
    it(`classifies ${name} as dangerous`, () => {
      expect(classifyTool({ qualifiedName: name, args: {} }).category).toBe('dangerous');
    });
  }
  for (const name of ['Git.git_status', 'Git.git_diff']) {
    it(`classifies ${name} as safe`, () => {
      expect(classifyTool({ qualifiedName: name, args: {} }).category).toBe('safe');
    });
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run --project backend server/domain/mcp/breakpoints/classify.test.ts`
Expected: FAIL — `Git.git_commit` classified `safe` (current pattern only matches rebase/push/reset).

- [ ] **Step 3: Extend the dangerous pattern** — `server/domain/mcp/breakpoints/breakpoints.types.ts` line 23:

```ts
  /^[^.]+\.git_(rebase|push|reset)/i,
```
→
```ts
  /^[^.]+\.git_(rebase|push|reset|add|commit|checkout|switch|restore)/i,
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run --project backend server/domain/mcp/breakpoints/classify.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/domain/mcp/breakpoints/breakpoints.types.ts server/domain/mcp/breakpoints/classify.test.ts
git commit -m "feat(slice-28): classify git write tools as dangerous (gate by default)"
```

---

## Task 7: Git diff preview in PreviewService

Add a `gitDiff` `PreviewResult` kind (server + frontend) and compute git previews in-process via `runGit` against the git-root.

**Files:**
- Modify: `server/domain/mcp/breakpoints/breakpoints.types.ts:16-18`
- Modify: `src/types/breakpoints.types.ts:16-18`
- Modify: `server/domain/mcp/breakpoints/preview.service.ts`
- Test: `server/domain/mcp/breakpoints/preview.service.test.ts` (create if absent)

- [ ] **Step 1: Write the failing test** — create/append `server/domain/mcp/breakpoints/preview.service.test.ts`:

```ts
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PreviewService } from './preview.service';

const ENV = {
  GIT_AUTHOR_NAME: 'T', GIT_AUTHOR_EMAIL: 't@a.dev',
  GIT_COMMITTER_NAME: 'T', GIT_COMMITTER_EMAIL: 't@a.dev',
};
function git(cwd: string, ...a: string[]) {
  execFileSync('git', a, { cwd, stdio: 'pipe', env: { ...process.env, ...ENV } });
}
function repoWithStagedChange(): string {
  const dir = mkdtempSync(join(tmpdir(), 'aether-prev-'));
  git(dir, 'init', '-q');
  writeFileSync(join(dir, 'a.txt'), 'A1\n');
  git(dir, 'add', '.'); git(dir, 'commit', '-q', '-m', 'first');
  writeFileSync(join(dir, 'a.txt'), 'A2\n');
  git(dir, 'add', '.'); // staged change A1 -> A2
  return dir;
}

describe('PreviewService — git diff (slice 28)', () => {
  it('git_commit returns a gitDiff with staged content', async () => {
    const repo = repoWithStagedChange();
    try {
      const svc = new PreviewService({ safeRoots: () => [], gitRoot: () => repo });
      const r = await svc.previewToolCall({ qualifiedName: 'Git.git_commit', args: { message: 'x' } });
      expect(r.kind).toBe('gitDiff');
      if (r.kind === 'gitDiff') {
        expect(r.unified).toMatch(/A2/);
        expect(r.title).toMatch(/Commit preview/);
      }
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });

  it('degrades to plain when no git root is set', async () => {
    const svc = new PreviewService({ safeRoots: () => [], gitRoot: () => null });
    const r = await svc.previewToolCall({ qualifiedName: 'Git.git_commit', args: {} });
    expect(r.kind).toBe('plain');
  });

  it('git_checkout is plain (not a file diff)', async () => {
    const svc = new PreviewService({ safeRoots: () => [], gitRoot: () => '/tmp' });
    const r = await svc.previewToolCall({ qualifiedName: 'Git.git_checkout', args: { branch: 'x' } });
    expect(r.kind).toBe('plain');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run --project backend server/domain/mcp/breakpoints/preview.service.test.ts`
Expected: FAIL — `PreviewServiceDeps` has no `gitRoot`; no `gitDiff` kind.

- [ ] **Step 3a: Add the `gitDiff` kind (server)** — `server/domain/mcp/breakpoints/breakpoints.types.ts` lines 16-18:

```ts
export type PreviewResult =
  | { kind: 'diff'; oldText: string; newText: string; path: string }
  | { kind: 'plain' };
```
→
```ts
export type PreviewResult =
  | { kind: 'diff'; oldText: string; newText: string; path: string }
  | { kind: 'gitDiff'; unified: string; title: string }
  | { kind: 'plain' };
```

- [ ] **Step 3b: Add the `gitDiff` kind (frontend)** — apply the identical change to `src/types/breakpoints.types.ts` lines 16-18.

- [ ] **Step 3c: Implement git preview** — rewrite `server/domain/mcp/breakpoints/preview.service.ts`:

```ts
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { runGit } from '@/server/domain/git/git.runner';
import type { PreviewResult } from './breakpoints.types';

const MAX_PREVIEW_BYTES = 1024 * 1024;
const WRITE_TOOL_PATTERN = /\.(write|edit|create)_/i;
const GIT_DIFF_PREVIEW_PATTERN = /^[^.]+\.git_(add|commit|restore)$/i;

export interface PreviewServiceDeps {
  safeRoots: () => string[];
  gitRoot: () => string | null;
}

export class PreviewService {
  constructor(private readonly deps: PreviewServiceDeps) {}

  async previewToolCall(input: {
    qualifiedName: string;
    args: Record<string, unknown>;
  }): Promise<PreviewResult> {
    if (GIT_DIFF_PREVIEW_PATTERN.test(input.qualifiedName)) {
      return this.gitPreview(input.qualifiedName, input.args);
    }

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

  private async gitPreview(
    qualifiedName: string,
    args: Record<string, unknown>,
  ): Promise<PreviewResult> {
    const root = this.deps.gitRoot();
    if (!root) return { kind: 'plain' };
    const tool = qualifiedName.split('.')[1];
    const paths = Array.isArray(args.paths)
      ? args.paths.filter((p): p is string => typeof p === 'string' && !p.startsWith('-'))
      : [];

    let diffArgs: string[];
    let title: string;
    if (tool === 'git_commit') {
      diffArgs = ['diff', '--cached'];
      title = 'Commit preview (staged changes)';
    } else if (tool === 'git_add') {
      diffArgs = ['diff', '--', ...paths];
      title = 'Will be staged';
    } else if (tool === 'git_restore') {
      diffArgs = args.staged === true ? ['diff', '--cached', '--', ...paths] : ['diff', '--', ...paths];
      title = 'Changes that will be DISCARDED';
    } else {
      return { kind: 'plain' };
    }

    try {
      const { stdout } = await runGit(diffArgs, root);
      return { kind: 'gitDiff', unified: stdout, title };
    } catch {
      return { kind: 'plain' };
    }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run --project backend server/domain/mcp/breakpoints/preview.service.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/domain/mcp/breakpoints/breakpoints.types.ts src/types/breakpoints.types.ts server/domain/mcp/breakpoints/preview.service.ts server/domain/mcp/breakpoints/preview.service.test.ts
git commit -m "feat(slice-28): in-process git diff preview (gitDiff PreviewResult kind)"
```

---

## Task 8: Wire the git-root into PreviewService + auto-root on session activation + build

**Files:**
- Modify: `server/index.ts:64-69` (PreviewService deps)
- Modify: `server/routes/workspaces.routes.ts` (activate-for-session git re-root)
- Modify: `package.json:11` (esbuild bundle for aether-git)

- [ ] **Step 1: Add `gitRoot` to PreviewService construction** — `server/index.ts` lines 64-69:

```ts
  const previewService = new PreviewService({
    safeRoots: () => {
      const fsRoot = builtinStore.read().find((r) => r.transport === 'filesystem')?.fsRoot;
      return [process.cwd(), ...(fsRoot ? [fsRoot] : [])];
    },
  });
```
→
```ts
  const previewService = new PreviewService({
    safeRoots: () => {
      const fsRoot = builtinStore.read().find((r) => r.transport === 'filesystem')?.fsRoot;
      return [process.cwd(), ...(fsRoot ? [fsRoot] : [])];
    },
    gitRoot: () => builtinStore.read().find((r) => r.transport === 'git')?.fsRoot ?? null,
  });
```

- [ ] **Step 2: Re-root git on session activation** — in `server/routes/workspaces.routes.ts`, find the `/activate-for-session` handler. After the existing filesystem re-rooting (`setFsRoot('filesystem', targetRoot)` + `reconnectBuiltin('filesystem')`), add the same for git, guarded by whether git is enabled. Replace the filesystem-only block:

```ts
    const fsRow = deps.builtinStore.read().find((r) => r.transport === 'filesystem');
    if (!fsRow || !fsRow.enabled) {
      res.json({ rooted: null });
      return;
    }
    if (targetRoot === null || targetRoot === fsRow.fsRoot) {
      res.json({ rooted: targetRoot });
      return;
    }
    deps.builtinStore.setFsRoot('filesystem', targetRoot);
    await deps.mcpRegistry.reconnectBuiltin('filesystem');
    res.json({ rooted: targetRoot });
```

with a version that re-roots every enabled rootable builtin (filesystem + git):

```ts
    const rootable = deps.builtinStore
      .read()
      .filter((r) => (r.transport === 'filesystem' || r.transport === 'git') && r.enabled);
    if (rootable.length === 0) {
      res.json({ rooted: null });
      return;
    }
    if (targetRoot === null) {
      res.json({ rooted: null });
      return;
    }
    for (const row of rootable) {
      if (row.fsRoot !== targetRoot) {
        deps.builtinStore.setFsRoot(row.transport, targetRoot);
        await deps.mcpRegistry.reconnectBuiltin(row.transport);
      }
    }
    res.json({ rooted: targetRoot });
```

> Read the actual handler first and preserve its exact variable names (`targetRoot`, `deps.builtinStore`, `deps.mcpRegistry`). If the surrounding code differs, adapt minimally — the intent is: when a session activates, every enabled rootable builtin (filesystem AND git) is re-rooted to the workspace `rootPath`.

- [ ] **Step 3: Bundle aether-git in the prod build** — `package.json` line 11 build script: after the `esbuild server/mcp/builtin/aether-shell.ts … aether-shell.js` segment, insert an identical segment for aether-git:

```
&& esbuild server/mcp/builtin/aether-git.ts --bundle --platform=node --format=esm --outfile=dist/server/mcp/builtin/aether-git.js
```

(placed right after the aether-shell esbuild call, before the `cli/index.ts` call).

- [ ] **Step 4: Verify wiring + build**

Run: `npm run lint && npx vitest run --project backend server/routes/workspaces.routes.test.ts && npm run build`
Expected: lint PASS; workspace route tests PASS; build emits `dist/server/mcp/builtin/aether-git.js`.

- [ ] **Step 5: Commit**

```bash
git add server/index.ts server/routes/workspaces.routes.ts package.json
git commit -m "feat(slice-28): wire git-root into preview + auto-root git on session activation + bundle aether-git"
```

---

## Task 9: Frontend — shared UnifiedDiff component

Extract the unified-diff rendering from `GitDiffPanel` into a reusable component so both the History view and the ApprovalGate render diffs identically.

**Files:**
- Create: `src/components/git/UnifiedDiff.tsx`
- Modify: `src/components/git/GitDiffPanel.tsx:105-120` (use the shared component)

- [ ] **Step 1: Create the shared component** — `src/components/git/UnifiedDiff.tsx`:

```tsx
import { cn } from '@/src/lib/cn';
import { classifyDiffLine } from '@/src/lib/git-swimlanes';

const LINE_CLASS: Record<ReturnType<typeof classifyDiffLine>, string> = {
  add: 'text-status-online bg-status-online/10',
  del: 'text-status-error bg-status-error/10',
  hunk: 'text-sky-400 bg-sky-500/10',
  meta: 'text-zinc-500',
  ctx: 'text-zinc-400',
};

export function UnifiedDiff({ unified }: { unified: string }) {
  return (
    <pre className="overflow-auto whitespace-pre p-0 font-mono text-[11px]">
      {unified.split('\n').map((line, i) => {
        const kind = classifyDiffLine(line);
        return (
          <div key={i} data-diff={kind} className={cn('px-3', LINE_CLASS[kind])}>
            {line || ' '}
          </div>
        );
      })}
    </pre>
  );
}
```

- [ ] **Step 2: Use it in GitDiffPanel** — in `src/components/git/GitDiffPanel.tsx`: remove the local `LINE_CLASS` const (lines 20-26) and the `cn`/`classifyDiffLine` imports if now unused, add `import { UnifiedDiff } from './UnifiedDiff';`, and replace the `state.kind === 'ready'` block (lines 105-120) with:

```tsx
          {state.kind === 'ready' && <UnifiedDiff unified={state.unified} />}
```

- [ ] **Step 3: Verify the History view still works**

Run: `npm run lint && npx vitest run --project frontend src/components/git`
Expected: PASS (existing git component tests green; no unused imports).

- [ ] **Step 4: Commit**

```bash
git add src/components/git/UnifiedDiff.tsx src/components/git/GitDiffPanel.tsx
git commit -m "refactor(slice-28): extract shared UnifiedDiff component from GitDiffPanel"
```

---

## Task 10: Frontend — ApprovalGate renders gitDiff + BuiltinMcpToggles git row

**Files:**
- Modify: `src/components/chat/ApprovalGate.tsx:87-91`
- Modify: `src/components/sidebar/BuiltinMcpToggles.tsx:6-11`

- [ ] **Step 1: Render gitDiff in ApprovalGate** — in `src/components/chat/ApprovalGate.tsx`, add `import { UnifiedDiff } from '@/src/components/git/UnifiedDiff';` near the other imports, then after the existing `preview.kind === 'diff'` block (lines 87-91) add:

```tsx
      {preview.kind === 'gitDiff' && (
        <div className="mb-3">
          <div className="text-zinc-500 text-[10px] font-mono mb-1 uppercase tracking-wider">
            {preview.title}
          </div>
          <div className="bg-zinc-950 border border-border-subtle rounded max-h-60 overflow-auto">
            <UnifiedDiff unified={preview.unified} />
          </div>
        </div>
      )}
```

- [ ] **Step 2: Add the Git row to BuiltinMcpToggles** — `src/components/sidebar/BuiltinMcpToggles.tsx` lines 6-11:

```ts
const ROW_ORDER: BuiltinTransport[] = ['filesystem', 'terminal'];

const LABEL: Record<BuiltinTransport, string> = {
  filesystem: 'Filesystem',
  terminal: 'Terminal',
};
```
→
```ts
const ROW_ORDER: BuiltinTransport[] = ['filesystem', 'terminal', 'git'];

const LABEL: Record<BuiltinTransport, string> = {
  filesystem: 'Filesystem',
  terminal: 'Terminal',
  git: 'Git',
};
```

(The git row needs no manual root input — it auto-roots like Terminal. The existing `t !== 'filesystem'` branch already renders a plain spacer for non-filesystem rows, so git is handled.)

- [ ] **Step 3: Update the e2e count assertion** — `e2e/smoke.spec.ts` line ~508 has a test "builtin MCPs: 2 toggle rows visible". The real app now seeds 3 builtins, so update the title and the count assertion (around line 512-514) from 2 to 3:

```ts
test('builtin MCPs: 3 toggle rows visible, click Filesystem twice to toggle on/off', async ({ page }) => {
```
and the corresponding `expect(rows).toHaveCount(2)` (or `.toHaveLength`) → `3`. Read the test body and adjust only the count; the Filesystem toggle interaction is unchanged.

> The frontend unit test `src/components/sidebar/BuiltinMcpToggles.test.tsx` renders from a mocked store; if its mock provides only filesystem+terminal rows, the component still renders 2 (git is skipped via `if (!row) return null`) and the test passes unchanged. If it provides a git row or asserts on ROW_ORDER length, update its count to 3. Verify by running it in Step 4.

- [ ] **Step 4: Verify**

Run: `npm run lint && npx vitest run --project frontend`
Expected: PASS (type-check clean; frontend suite green).

- [ ] **Step 5: Commit**

```bash
git add src/components/chat/ApprovalGate.tsx src/components/sidebar/BuiltinMcpToggles.tsx e2e/smoke.spec.ts
git commit -m "feat(slice-28): ApprovalGate renders gitDiff preview + Git builtin toggle row"
```

---

## Task 11: Full verification, manual smoke, docs, PR

**Files:**
- Modify: `docs/superpowers/roadmap.md`

- [ ] **Step 1: Full suite + build**

Run: `npm run lint && npm run test:run && npm run build`
Expected: lint clean; all tests green (existing 1664 + the new slice-28 tests); build OK including `dist/server/mcp/builtin/aether-git.js`.

- [ ] **Step 2: Manual smoke (end-to-end gate)**

```bash
AETHER_FAKE_PROVIDER=1 PORT=3940 AETHER_DATA_DIR=/tmp/aether-git28 npm run dev
```
Then via the API: enable the git builtin (`PUT /api/mcp/builtin/git {enabled:true}`), create a workspace on a scratch git repo, attach it to the active session (so git auto-roots), and confirm:
- `GET /api/mcp` (or the registry tools list) shows `Git.git_*` tools.
- `POST /api/breakpoints/preview {qualifiedName:'Git.git_commit', args:{message:'x'}}` returns `{kind:'gitDiff', …}` when there are staged changes, else `{kind:'plain'}`.
- `GET /api/breakpoints/classify?qualifiedName=Git.git_commit` → `dangerous`.
Kill the server and remove the scratch data dir afterward.

- [ ] **Step 3: Update the roadmap** — in `docs/superpowers/roadmap.md`, mark Git integration **Tier 2** shipped (add a slice 28 row to the Shipped table and update the Tier 2 bullet in the Git integration candidate section, mirroring how slice 27 / Tier 1 was marked).

- [ ] **Step 4: Commit + open PR**

```bash
git add docs/superpowers/roadmap.md
git commit -m "docs(slice-28): mark Git integration Tier 2 (write actions) shipped"
git push -u origin feat/slice-28-git-write
# open a PR feat/slice-28-git-write -> main (after slice 27 merges; rebase if needed)
```

---

## Notes on testing scope

- **E2e (Playwright):** deferred for this slice. A full agent-driven gate e2e requires the Fake provider to emit a `Git.git_commit` function call and the test to auto-approve via `POST /api/mcp/decision`. The unit + handler + preview + classification tests plus the manual smoke (Task 11 step 2) cover the behavior; an e2e can be added in a follow-up if desired.
- **Coverage:** the enforced globs (`server/domain/**`, `src/lib/**`, `src/stores/**`) are covered by the handler/preview/classify/store tests. `server/mcp/builtin/aether-git.ts` (the stdio loop) is intentionally untested, mirroring `aether-shell.ts`.
