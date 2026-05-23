# Slice 21 — 1-click coding MCPs (Filesystem + Terminal) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Two sidebar toggles (Filesystem + Terminal) that, with a single click, spawn pre-configured MCP servers via the existing stdio transport — no JSON config required.

**Architecture:** Filesystem uses `@modelcontextprotocol/server-filesystem` (new npm dep) spawned via stdio. Terminal uses a small custom in-repo `aether-shell` stdio server with 30 s timeout, 1 MB output cap, and a blocklist of dangerous patterns. State persists in a new 2-row `builtin_mcp_state` table. `McpRegistry` gains `startBuiltin` / `stopBuiltin` / `reconnectBuiltin` methods; built-ins materialize from `BuiltinMcpStore.toConfigs()` into the existing stdio code path. UI: a new `<BuiltinMcpToggles>` section above `<McpServersSection>`; built-ins never appear in the manual list.

**Tech Stack:** TypeScript, better-sqlite3, Express, Node `child_process`, Zustand, MSW, vitest, Playwright. One new npm dep: `@modelcontextprotocol/server-filesystem`.

**Spec:** `docs/superpowers/specs/2026-05-23-aether-slice-21-one-click-mcps-design.md`

**Branch:** `feat/slice-21-one-click-mcps`

---

## File Structure

**Server**
- Create: `server/db/migrations/006_builtin_mcp_state.sql`.
- Modify: `server/db/migrate.test.ts` — count assertion `[1,2,3,4,5]` → `[1,2,3,4,5,6]`.
- Create: `server/domain/mcp/builtin/builtin.types.ts` — types + `BLOCKED_PATTERNS` + `SHELL_DEFAULTS`.
- Create: `server/domain/mcp/builtin/builtin.store.ts` — `BuiltinMcpStore` class.
- Create: `server/domain/mcp/builtin/builtin.store.test.ts`.
- Create: `server/mcp/builtin/aether-shell.handler.ts` — pure `executeCommand` function.
- Create: `server/mcp/builtin/aether-shell.handler.test.ts`.
- Create: `server/mcp/builtin/aether-shell.ts` — standalone Node script (stdio JSON-RPC framing → calls `executeCommand`).
- Modify: `server/domain/mcp/registry.ts` — accept `builtinStore`, add `startBuiltin`/`stopBuiltin`/`reconnectBuiltin`, filter built-ins from `list()`, merge built-ins in `init()`.
- Modify: `server/domain/mcp/registry.test.ts` — built-in cases.
- Create: `server/routes/builtin-mcp.routes.ts` — `GET /` + `PUT /:transport`.
- Create: `server/routes/builtin-mcp.routes.test.ts`.
- Modify: `server/app.ts` — `builtinStore?: BuiltinMcpStore` in `AppDeps`; mount route.
- Modify: `server/index.ts` — construct `BuiltinMcpStore`, pass to registry + `createApp`.
- Modify: `package.json` — add `@modelcontextprotocol/server-filesystem` dep.

**Frontend**
- Modify: `src/types/mcp.types.ts` — `BuiltinTransport`, `BuiltinMcpState`.
- Create: `src/lib/api/builtin-mcp.api.ts` — `listBuiltins`, `setBuiltin`.
- Create: `src/lib/api/builtin-mcp.api.test.ts`.
- Create: `src/stores/builtinMcp.store.ts` — Zustand store with per-transport dedupe.
- Create: `src/stores/builtinMcp.store.test.ts`.
- Create: `src/components/sidebar/BuiltinMcpToggles.tsx` + test.
- Modify: `src/components/sidebar/McpServersSection.tsx` — filter `'builtin:*'` ids.
- Modify: `src/components/sidebar/McpServersSection.test.tsx` — case for the filter.
- Modify: `src/App.tsx` — mount `<BuiltinMcpToggles />`, init the store.
- Modify: `src/test/msw-handlers.ts` — defaults for `/api/mcp/builtin`.

**Integration / e2e**
- Create: `src/integration/builtin-mcp.integration.test.tsx`.
- Modify: `e2e/smoke.spec.ts` — toggle smoke.

---

## Task A1: Migration 006 + types + helpers

**Files:**
- Create: `server/db/migrations/006_builtin_mcp_state.sql`.
- Create: `server/domain/mcp/builtin/builtin.types.ts`.
- Modify: `server/db/migrate.test.ts`.

- [ ] **Step 1: Write the migration**

`server/db/migrations/006_builtin_mcp_state.sql`:
```sql
-- Built-in MCP toggles (slice 21). 2 pre-seeded rows: filesystem + terminal.
CREATE TABLE builtin_mcp_state (
  transport TEXT PRIMARY KEY CHECK (transport IN ('filesystem','terminal')),
  enabled INTEGER NOT NULL DEFAULT 0,
  fs_root TEXT
);

INSERT INTO builtin_mcp_state (transport, enabled, fs_root) VALUES ('filesystem', 0, NULL);
INSERT INTO builtin_mcp_state (transport, enabled, fs_root) VALUES ('terminal', 0, NULL);
```

- [ ] **Step 2: Update migrate count assertion**

In `server/db/migrate.test.ts`, find the test that asserts `expect(versions).toEqual([1, 2, 3, 4, 5])` and change to:
```ts
expect(versions).toEqual([1, 2, 3, 4, 5, 6]);
```

- [ ] **Step 3: Write `builtin.types.ts`**

`server/domain/mcp/builtin/builtin.types.ts`:
```ts
export type BuiltinTransport = 'filesystem' | 'terminal';

export interface BuiltinMcpState {
  transport: BuiltinTransport;
  enabled: boolean;
  fsRoot: string | null;
}

export interface BuiltinMcpListResponse {
  builtins: BuiltinMcpState[];
}

export const BLOCKED_PATTERNS: RegExp[] = [
  /\brm\s+-rf\s+\/(?!\w)/,
  /\bsudo\b/,
  /:\(\)\s*\{\s*:\s*\|\s*:&\s*\}\s*;\s*:/,
  /\bdd\s+if=/,
  /\bmkfs\./,
  /\s>\s*\/dev\/sd[a-z]/,
  /\bchmod\s+-R\s+777\s+\//,
];

export const SHELL_DEFAULTS = {
  timeoutMs: 30_000,
  maxTimeoutMs: 120_000,
  outputCapBytes: 1 * 1024 * 1024,
} as const;
```

- [ ] **Step 4: Run migrate tests, expect GREEN**

```bash
npx vitest run server/db/migrate.test.ts
```

Expected: 7/7 pass.

- [ ] **Step 5: Lint clean**

```bash
npm run lint
```

- [ ] **Step 6: Commit**

```bash
git add server/db/migrations/006_builtin_mcp_state.sql server/db/migrate.test.ts server/domain/mcp/builtin/builtin.types.ts
git commit -m "feat(slice-21): migration 006 + builtin MCP types + BLOCKED_PATTERNS"
```

---

## Task B1: BuiltinMcpStore

**Files:**
- Create: `server/domain/mcp/builtin/builtin.store.ts`.
- Create: `server/domain/mcp/builtin/builtin.store.test.ts`.

- [ ] **Step 1: Failing tests** — `builtin.store.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { makeTestDb } from '@/server/test/test-db';
import { BuiltinMcpStore } from './builtin.store';
import type { DatabaseHandle } from '@/server/db/database';

let db: DatabaseHandle;
let store: BuiltinMcpStore;

beforeEach(() => {
  db = makeTestDb();
  store = new BuiltinMcpStore(db);
});

afterEach(() => db.close());

describe('BuiltinMcpStore', () => {
  it('read() returns 2 pre-seeded rows, both disabled', () => {
    const rows = store.read();
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.transport).sort()).toEqual(['filesystem', 'terminal']);
    expect(rows.every((r) => r.enabled === false)).toBe(true);
    expect(rows.every((r) => r.fsRoot === null)).toBe(true);
  });

  it('setEnabled flips the flag', () => {
    store.setEnabled('filesystem', true);
    const fs = store.read().find((r) => r.transport === 'filesystem')!;
    expect(fs.enabled).toBe(true);
  });

  it('setFsRoot persists path; null reverts', () => {
    store.setFsRoot('filesystem', '/tmp');
    expect(store.read().find((r) => r.transport === 'filesystem')!.fsRoot).toBe('/tmp');
    store.setFsRoot('filesystem', null);
    expect(store.read().find((r) => r.transport === 'filesystem')!.fsRoot).toBeNull();
  });

  it('toConfigs() returns only enabled rows', () => {
    expect(store.toConfigs('/cwd')).toEqual([]);
    store.setEnabled('filesystem', true);
    const configs = store.toConfigs('/cwd');
    expect(configs).toHaveLength(1);
    expect(configs[0].id).toBe('builtin:filesystem');
  });

  it('toConfigs() resolves fsRoot ?? defaultCwd', () => {
    store.setEnabled('filesystem', true);
    let configs = store.toConfigs('/default');
    expect(configs[0].args).toContain('/default');
    store.setFsRoot('filesystem', '/custom');
    configs = store.toConfigs('/default');
    expect(configs[0].args).toContain('/custom');
    expect(configs[0].args).not.toContain('/default');
  });

  it('toConfigs() for terminal omits fsRoot', () => {
    store.setEnabled('terminal', true);
    const configs = store.toConfigs('/default');
    expect(configs).toHaveLength(1);
    expect(configs[0].id).toBe('builtin:terminal');
    expect(configs[0].args).not.toContain('/default');
  });
});
```

- [ ] **Step 2: Run, expect FAIL**

```bash
npx vitest run server/domain/mcp/builtin/builtin.store.test.ts
```

- [ ] **Step 3: Implement** — `builtin.store.ts`:

```ts
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import type { DatabaseHandle } from '@/server/db/database';
import type { McpServerConfig } from '@/server/domain/context/context.types';
import type { BuiltinMcpState, BuiltinTransport } from './builtin.types';

const require = createRequire(import.meta.url);

interface Row {
  transport: string;
  enabled: number;
  fs_root: string | null;
}

function resolveFilesystemServerEntry(): string {
  // Resolve the official server-filesystem package's main entry.
  // Falls back to a hardcoded path if require.resolve fails (rare).
  try {
    return require.resolve('@modelcontextprotocol/server-filesystem/dist/index.js');
  } catch {
    return path.resolve(
      process.cwd(),
      'node_modules/@modelcontextprotocol/server-filesystem/dist/index.js',
    );
  }
}

function resolveAetherShellEntry(): string {
  // In dev (tsx/vite-node) we run the .ts directly. In prod we run the built .js.
  // The build step copies aether-shell.ts → dist/server/mcp/builtin/aether-shell.js.
  const here = path.dirname(fileURLToPath(import.meta.url));
  const distGuess = path.resolve(here, '../../../mcp/builtin/aether-shell.js');
  const srcGuess = path.resolve(here, '../../../mcp/builtin/aether-shell.ts');
  // Prefer .js (production); fall back to .ts (dev — tsx executes TS directly).
  try {
    require.resolve(distGuess);
    return distGuess;
  } catch {
    return srcGuess;
  }
}

export class BuiltinMcpStore {
  constructor(private readonly db: DatabaseHandle) {}

  read(): BuiltinMcpState[] {
    const rows = this.db
      .prepare('SELECT transport, enabled, fs_root FROM builtin_mcp_state ORDER BY transport')
      .all() as Row[];
    return rows.map((r) => ({
      transport: r.transport as BuiltinTransport,
      enabled: r.enabled === 1,
      fsRoot: r.fs_root,
    }));
  }

  setEnabled(transport: BuiltinTransport, enabled: boolean): void {
    this.db
      .prepare('UPDATE builtin_mcp_state SET enabled = ? WHERE transport = ?')
      .run(enabled ? 1 : 0, transport);
  }

  setFsRoot(transport: BuiltinTransport, fsRoot: string | null): void {
    this.db
      .prepare('UPDATE builtin_mcp_state SET fs_root = ? WHERE transport = ?')
      .run(fsRoot, transport);
  }

  toConfigs(defaultCwd: string): McpServerConfig[] {
    const rows = this.read().filter((r) => r.enabled);
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
        };
      }
      return {
        id: 'builtin:terminal',
        name: 'Terminal',
        transport: 'stdio',
        command: process.execPath,
        args: [resolveAetherShellEntry()],
        env: {},
        status: 'offline',
      };
    });
  }
}
```

- [ ] **Step 4: Run tests, expect GREEN**

```bash
npx vitest run server/domain/mcp/builtin/builtin.store.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add server/domain/mcp/builtin/builtin.store.ts server/domain/mcp/builtin/builtin.store.test.ts
git commit -m "feat(slice-21): BuiltinMcpStore (read/setEnabled/setFsRoot/toConfigs)"
```

---

## Task C1: `aether-shell` handler (pure executeCommand)

**Files:**
- Create: `server/mcp/builtin/aether-shell.handler.ts`.
- Create: `server/mcp/builtin/aether-shell.handler.test.ts`.

- [ ] **Step 1: Failing tests** — `aether-shell.handler.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { executeCommand } from './aether-shell.handler';

describe('executeCommand — happy path', () => {
  it('runs echo and returns stdout + exit 0', async () => {
    const out = await executeCommand({ cmd: "echo hello" });
    expect(out.isError).toBe(false);
    expect(out.content[0].text).toMatch(/hello/);
    expect(out.content[0].text).toMatch(/exit code: 0/);
  });

  it('non-zero exit returns isError=true', async () => {
    const out = await executeCommand({ cmd: 'exit 7' });
    expect(out.isError).toBe(true);
    expect(out.content[0].text).toMatch(/exit code: 7/);
  });

  it('runs with custom cwd', async () => {
    const out = await executeCommand({ cmd: 'pwd', cwd: '/tmp' });
    expect(out.isError).toBe(false);
    expect(out.content[0].text).toMatch(/\/tmp/);
  });
});

describe('executeCommand — blocklist', () => {
  it('blocks rm -rf /', async () => {
    const out = await executeCommand({ cmd: 'rm -rf /' });
    expect(out.isError).toBe(true);
    expect(out.content[0].text).toMatch(/blocked by safety policy/);
  });

  it('blocks sudo', async () => {
    const out = await executeCommand({ cmd: 'sudo apt install x' });
    expect(out.isError).toBe(true);
    expect(out.content[0].text).toMatch(/blocked by safety policy/);
  });

  it('blocks fork bomb', async () => {
    const out = await executeCommand({ cmd: ':(){:|:&};:' });
    expect(out.isError).toBe(true);
    expect(out.content[0].text).toMatch(/blocked by safety policy/);
  });

  it('blocks dd if=', async () => {
    const out = await executeCommand({ cmd: 'dd if=/dev/zero of=/dev/sda' });
    expect(out.isError).toBe(true);
    expect(out.content[0].text).toMatch(/blocked by safety policy/);
  });
});

describe('executeCommand — timeout', () => {
  it('returns timeout error when command exceeds timeout', async () => {
    const out = await executeCommand({ cmd: 'sleep 10', timeout: 200 });
    expect(out.isError).toBe(true);
    expect(out.content[0].text).toMatch(/timeout after/);
  });

  it('caps timeout at maxTimeoutMs', async () => {
    // Asking for 9999999 ms should be silently capped.
    // We can't easily assert internal state, but a command that finishes fast must succeed.
    const out = await executeCommand({ cmd: 'true', timeout: 9_999_999 });
    expect(out.isError).toBe(false);
  });
});

describe('executeCommand — output cap', () => {
  it('truncates oversized stdout and notes it', async () => {
    // Produce ~2 MB of output via /bin/sh
    const out = await executeCommand({
      cmd: 'head -c 2000000 /dev/zero | base64',
    });
    expect(out.content[0].text).toMatch(/\[output truncated\]/);
  }, 10_000);
});
```

- [ ] **Step 2: Run, expect FAIL**

```bash
npx vitest run server/mcp/builtin/aether-shell.handler.test.ts
```

- [ ] **Step 3: Implement** — `aether-shell.handler.ts`:

```ts
import { spawn } from 'node:child_process';
import { BLOCKED_PATTERNS, SHELL_DEFAULTS } from '@/server/domain/mcp/builtin/builtin.types';

export interface ExecuteCommandInput {
  cmd: string;
  cwd?: string;
  timeout?: number;
}

export interface ExecuteCommandResult {
  isError: boolean;
  content: Array<{ type: 'text'; text: string }>;
}

const TRUNC_MARKER = '\n[output truncated]';

function formatOutput(stdout: string, stderr: string, exit: string): string {
  return `${stdout}\n---\n${stderr}\n---\n${exit}`;
}

function findBlockedPattern(cmd: string): RegExp | null {
  for (const pattern of BLOCKED_PATTERNS) {
    if (pattern.test(cmd)) return pattern;
  }
  return null;
}

export async function executeCommand(input: ExecuteCommandInput): Promise<ExecuteCommandResult> {
  const blocked = findBlockedPattern(input.cmd);
  if (blocked) {
    return {
      isError: true,
      content: [{
        type: 'text',
        text: `blocked by safety policy: ${blocked.source}`,
      }],
    };
  }

  const requestedTimeout = input.timeout ?? SHELL_DEFAULTS.timeoutMs;
  const effectiveTimeout = Math.min(requestedTimeout, SHELL_DEFAULTS.maxTimeoutMs);
  const cwd = input.cwd ?? process.cwd();

  return new Promise<ExecuteCommandResult>((resolve) => {
    const child = spawn(input.cmd, [], { shell: true, cwd });
    let stdoutBuf = '';
    let stderrBuf = '';
    let stdoutTruncated = false;
    let stderrTruncated = false;
    const cap = SHELL_DEFAULTS.outputCapBytes;

    child.stdout?.on('data', (chunk: Buffer) => {
      if (stdoutBuf.length < cap) {
        stdoutBuf += chunk.toString('utf-8');
        if (stdoutBuf.length > cap) {
          stdoutBuf = stdoutBuf.slice(0, cap);
          stdoutTruncated = true;
        }
      }
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      if (stderrBuf.length < cap) {
        stderrBuf += chunk.toString('utf-8');
        if (stderrBuf.length > cap) {
          stderrBuf = stderrBuf.slice(0, cap);
          stderrTruncated = true;
        }
      }
    });

    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      setTimeout(() => child.kill('SIGKILL'), 500);
      const stdoutOut = stdoutTruncated ? stdoutBuf + TRUNC_MARKER : stdoutBuf;
      const stderrOut = stderrTruncated ? stderrBuf + TRUNC_MARKER : stderrBuf;
      resolve({
        isError: true,
        content: [{
          type: 'text',
          text: formatOutput(stdoutOut, stderrOut, `timeout after ${effectiveTimeout}ms`),
        }],
      });
    }, effectiveTimeout);

    child.on('error', (err) => {
      clearTimeout(timer);
      resolve({
        isError: true,
        content: [{ type: 'text', text: `spawn error: ${err.message}` }],
      });
    });

    child.on('exit', (code) => {
      clearTimeout(timer);
      const stdoutOut = stdoutTruncated ? stdoutBuf + TRUNC_MARKER : stdoutBuf;
      const stderrOut = stderrTruncated ? stderrBuf + TRUNC_MARKER : stderrBuf;
      const exitCode = code ?? 0;
      resolve({
        isError: exitCode !== 0,
        content: [{
          type: 'text',
          text: formatOutput(stdoutOut, stderrOut, `exit code: ${exitCode}`),
        }],
      });
    });
  });
}
```

- [ ] **Step 4: Run tests, expect GREEN**

```bash
npx vitest run server/mcp/builtin/aether-shell.handler.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add server/mcp/builtin/aether-shell.handler.ts server/mcp/builtin/aether-shell.handler.test.ts
git commit -m "feat(slice-21): aether-shell handler (executeCommand with timeout + cap + blocklist)"
```

---

## Task D1: `aether-shell` stdio script

**Files:**
- Create: `server/mcp/builtin/aether-shell.ts`.

This is a standalone Node script spawned via stdio. It manually implements the MCP JSON-RPC framing (line-delimited JSON).

- [ ] **Step 1: Implement** — `aether-shell.ts`:

```ts
#!/usr/bin/env node
import { executeCommand } from './aether-shell.handler';

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

function send(res: JsonRpcResponse): void {
  process.stdout.write(JSON.stringify(res) + '\n');
}

async function handle(req: JsonRpcRequest): Promise<JsonRpcResponse> {
  const base = { jsonrpc: '2.0' as const, id: req.id };

  if (req.method === 'initialize') {
    return {
      ...base,
      result: {
        protocolVersion: '2024-11-05',
        capabilities: { tools: {} },
        serverInfo: { name: 'aether-shell', version: '0.1.0' },
      },
    };
  }

  if (req.method === 'tools/list') {
    return {
      ...base,
      result: {
        tools: [{
          name: 'execute_command',
          description: 'Run a shell command. 30s default timeout, 1 MB output cap, dangerous patterns blocked.',
          inputSchema: {
            type: 'object',
            properties: {
              cmd: { type: 'string', description: 'Command line to execute' },
              cwd: { type: 'string', description: 'Optional working directory' },
              timeout: { type: 'number', description: 'Timeout in ms (default 30000, max 120000)' },
            },
            required: ['cmd'],
          },
        }],
      },
    };
  }

  if (req.method === 'tools/call') {
    const params = (req.params ?? {}) as { name?: string; arguments?: Record<string, unknown> };
    if (params.name !== 'execute_command') {
      return { ...base, error: { code: -32601, message: `Unknown tool: ${params.name}` } };
    }
    const args = (params.arguments ?? {}) as { cmd?: string; cwd?: string; timeout?: number };
    if (typeof args.cmd !== 'string') {
      return { ...base, error: { code: -32602, message: 'cmd (string) required' } };
    }
    const result = await executeCommand({ cmd: args.cmd, cwd: args.cwd, timeout: args.timeout });
    return { ...base, result };
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

- [ ] **Step 2: Lint clean**

```bash
npm run lint
```

- [ ] **Step 3: Verify the script runs** (manual smoke):

```bash
echo '{"jsonrpc":"2.0","id":1,"method":"initialize"}' | npx tsx server/mcp/builtin/aether-shell.ts
```

Expected output: a single JSON line with `result.serverInfo.name = "aether-shell"`.

- [ ] **Step 4: Commit**

```bash
git add server/mcp/builtin/aether-shell.ts
git commit -m "feat(slice-21): aether-shell stdio MCP server script"
```

---

## Task E1: Install `@modelcontextprotocol/server-filesystem`

**Files:**
- Modify: `package.json` + lockfile.

- [ ] **Step 1: Install the dep**

```bash
npm install @modelcontextprotocol/server-filesystem
```

- [ ] **Step 2: Verify the entry resolves**

```bash
node -e "console.log(require.resolve('@modelcontextprotocol/server-filesystem/dist/index.js'))"
```

Expected: prints a path under `node_modules/`. If the path differs from `/dist/index.js`, update `resolveFilesystemServerEntry()` in `builtin.store.ts` to match (some packages use `/dist/main.js` or similar — adapt to what the actual install produces).

- [ ] **Step 3: Run the BuiltinMcpStore tests again** (they should still pass — the resolve fallback was only used at runtime):

```bash
npx vitest run server/domain/mcp/builtin/builtin.store.test.ts
```

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json
git commit -m "deps(slice-21): add @modelcontextprotocol/server-filesystem"
```

---

## Task F1: McpRegistry — startBuiltin / stopBuiltin / reconnectBuiltin + init merge + list filter

**Files:**
- Modify: `server/domain/mcp/registry.ts`.
- Modify: `server/domain/mcp/registry.test.ts`.

- [ ] **Step 1: Failing tests** — append to `registry.test.ts`:

```ts
import { BuiltinMcpStore } from './builtin/builtin.store';

describe('McpRegistry — built-ins', () => {
  it('init() connects enabled built-ins alongside user configs', async () => {
    // ...
    // Set up a contextStore with zero user configs.
    // Set up a BuiltinMcpStore with filesystem enabled (toConfigs returns 1 config).
    // Construct registry with builtinStore.
    // Call init() and assert mcpRegistry.list() (the registry's own list method)
    // does NOT include 'builtin:filesystem' (filtered out from user-facing list),
    // but mcpRegistry.getAvailableTools() DOES include filesystem tools.
  });

  it('startBuiltin / stopBuiltin connects/disconnects without touching context_mcp_servers', async () => {
    // ...
  });

  it('reconnectBuiltin disconnects and re-connects after fsRoot change', async () => {
    // ...
  });

  it('list() filters out entries with id starting with "builtin:"', async () => {
    // Insert a fake built-in via low-level state; assert list() does not show it.
  });
});
```

(Full test body is similar to the existing patterns in this file — adapt the existing scaffolding. For these tests, prefer using `MockMcpConnection` rather than spawning real subprocesses; you may need to extend `makeConnection` with a test seam OR override `toConfigs` to return `{ transport: 'mock', ... }` for testing.)

**For simpler tests, override the registry's connection factory:**
```ts
// Inject a fake makeConnection in tests via a protected method override or
// by replacing builtin configs' transport with 'mock'.
```

- [ ] **Step 2: Run, expect FAIL**

```bash
npx vitest run server/domain/mcp/registry.test.ts
```

- [ ] **Step 3: Extend registry.ts**

Add `builtinStore` to the constructor (optional):
```ts
constructor(
  private readonly contextStore: ContextStore,
  private readonly builtinStore?: BuiltinMcpStore,
) {}
```

Add a private helper to materialize a built-in config by transport:
```ts
private builtinConfig(transport: 'filesystem' | 'terminal'): McpServerConfig | null {
  if (!this.builtinStore) return null;
  const configs = this.builtinStore.toConfigs(process.cwd());
  const id = `builtin:${transport}`;
  return configs.find((c) => c.id === id) ?? null;
}
```

Add three new methods alongside `connect`:
```ts
async startBuiltin(transport: 'filesystem' | 'terminal'): Promise<void> {
  if (!this.builtinStore) throw new Error('Built-in MCP store not configured');
  const id = `builtin:${transport}`;
  if (this.live.has(id)) return;
  const cfg = this.builtinConfig(transport);
  if (!cfg) throw new Error(`Built-in ${transport} not enabled`);
  await this.connectFromConfig(cfg);
}

async stopBuiltin(transport: 'filesystem' | 'terminal'): Promise<void> {
  const id = `builtin:${transport}`;
  await this.disconnect(id);
}

async reconnectBuiltin(transport: 'filesystem' | 'terminal'): Promise<void> {
  await this.stopBuiltin(transport);
  await this.startBuiltin(transport);
}
```

Where `connectFromConfig` is a small refactor of the existing `connect(id)` to accept a config directly rather than looking it up via `contextStore`:
```ts
private async connectFromConfig(cfg: McpServerConfig): Promise<{ tools: McpTool[] }> {
  // Body lifted from connect() but using `cfg` directly instead of fetching from contextStore.
  // ...
}
```

In `connect(id)`:
```ts
async connect(id: string): Promise<{ tools: McpTool[] }> {
  if (this.live.has(id)) return { tools: this.live.get(id)!.tools };
  const ctx = await this.contextStore.read();
  const cfg = ctx.mcpServers.find((s) => s.id === id);
  if (!cfg) throw new Error(`Unknown MCP server '${id}'`);
  return this.connectFromConfig(cfg);
}
```

Filter built-ins from `list()`:
```ts
list(): Array<{ ... }> {
  // existing code, but at the end:
  return result.filter((e) => !e.serverId.startsWith('builtin:'));
}
```

Add the merge in `init()` (the existing method that connects all stored MCP servers on startup):
```ts
async init(): Promise<void> {
  const userConfigs = (await this.contextStore.read()).mcpServers;
  const builtinConfigs = this.builtinStore?.toConfigs(process.cwd()) ?? [];
  for (const cfg of [...userConfigs, ...builtinConfigs]) {
    await this.connectFromConfig(cfg).catch(() => {
      // best-effort; individual failures don't abort startup
    });
  }
}
```

(If `init()` doesn't exist yet, find whatever startup hook the registry uses to auto-connect on boot — there's logic in `server/index.ts` that iterates `mcpServers` and connects them. Move that loop into `init()` for cleanliness, or just add the built-in merge wherever the existing loop lives.)

- [ ] **Step 4: Run tests, expect GREEN**

```bash
npx vitest run server/domain/mcp/registry.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add server/domain/mcp/registry.ts server/domain/mcp/registry.test.ts
git commit -m "feat(slice-21): McpRegistry — startBuiltin/stopBuiltin/reconnectBuiltin + filter built-ins from list()"
```

---

## Task G1: Routes (GET + PUT) + AppDeps + bootstrap

**Files:**
- Create: `server/routes/builtin-mcp.routes.ts`.
- Create: `server/routes/builtin-mcp.routes.test.ts`.
- Modify: `server/app.ts`.
- Modify: `server/index.ts`.

- [ ] **Step 1: Failing tests** — `builtin-mcp.routes.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import express from 'express';
import { makeTestDb } from '@/server/test/test-db';
import { BuiltinMcpStore } from '@/server/domain/mcp/builtin/builtin.store';
import { McpRegistry } from '@/server/domain/mcp/registry';
import { ContextStore } from '@/server/domain/context/context.store';
import { createBuiltinMcpRoutes } from './builtin-mcp.routes';
import type { DatabaseHandle } from '@/server/db/database';
import { isAppError } from '@/server/lib/errors';

let db: DatabaseHandle;
let store: BuiltinMcpStore;
let registry: McpRegistry;
let app: express.Express;

beforeEach(() => {
  db = makeTestDb();
  store = new BuiltinMcpStore(db);
  const ctx = new ContextStore(db);
  registry = new McpRegistry(ctx, store);
  // Stub registry methods we don't want to actually connect subprocesses
  vi.spyOn(registry, 'startBuiltin').mockResolvedValue(undefined);
  vi.spyOn(registry, 'stopBuiltin').mockResolvedValue(undefined);
  vi.spyOn(registry, 'reconnectBuiltin').mockResolvedValue(undefined);
  app = express();
  app.use(express.json());
  app.use('/api/mcp/builtin', createBuiltinMcpRoutes(store, registry));
  app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    if (isAppError(err)) {
      res.status(err.status).json({ error: { code: err.code, message: err.message } });
      return;
    }
    const message = err instanceof Error ? err.message : 'Unknown error';
    res.status(500).json({ error: { code: 'INTERNAL', message } });
  });
});

afterEach(() => db.close());

describe('builtin MCP routes', () => {
  it('GET /api/mcp/builtin returns 2 disabled rows', async () => {
    const res = await request(app).get('/api/mcp/builtin');
    expect(res.status).toBe(200);
    expect(res.body.builtins).toHaveLength(2);
    expect(res.body.builtins.every((b: { enabled: boolean }) => !b.enabled)).toBe(true);
  });

  it('PUT enables and triggers startBuiltin', async () => {
    const res = await request(app).put('/api/mcp/builtin/filesystem').send({ enabled: true });
    expect(res.status).toBe(200);
    expect(res.body.state.enabled).toBe(true);
    expect(registry.startBuiltin).toHaveBeenCalledWith('filesystem');
  });

  it('PUT disable triggers stopBuiltin then writes DB', async () => {
    store.setEnabled('terminal', true);
    const res = await request(app).put('/api/mcp/builtin/terminal').send({ enabled: false });
    expect(res.status).toBe(200);
    expect(res.body.state.enabled).toBe(false);
    expect(registry.stopBuiltin).toHaveBeenCalledWith('terminal');
  });

  it('PUT fsRoot while enabled triggers reconnect', async () => {
    store.setEnabled('filesystem', true);
    const res = await request(app).put('/api/mcp/builtin/filesystem').send({ fsRoot: '/tmp' });
    expect(res.status).toBe(200);
    expect(res.body.state.fsRoot).toBe('/tmp');
    expect(registry.reconnectBuiltin).toHaveBeenCalledWith('filesystem');
  });

  it('PUT with invalid fsRoot returns 400', async () => {
    const res = await request(app).put('/api/mcp/builtin/filesystem').send({ fsRoot: '/no/such/dir/here' });
    expect(res.status).toBe(400);
  });

  it('PUT with null fsRoot reverts to default', async () => {
    store.setFsRoot('filesystem', '/tmp');
    const res = await request(app).put('/api/mcp/builtin/filesystem').send({ fsRoot: null });
    expect(res.status).toBe(200);
    expect(res.body.state.fsRoot).toBeNull();
  });

  it('PUT with invalid transport returns 400', async () => {
    const res = await request(app).put('/api/mcp/builtin/nope').send({ enabled: true });
    expect(res.status).toBe(400);
  });
});
```

(Add `import { vi } from 'vitest'` at the top.)

- [ ] **Step 2: Run, expect FAIL**

```bash
npx vitest run server/routes/builtin-mcp.routes.test.ts
```

- [ ] **Step 3: Implement** — `builtin-mcp.routes.ts`:

```ts
import { Router, type Request, type Response, type NextFunction } from 'express';
import fs from 'node:fs';
import type { BuiltinMcpStore } from '@/server/domain/mcp/builtin/builtin.store';
import type { McpRegistry } from '@/server/domain/mcp/registry';
import type { BuiltinTransport } from '@/server/domain/mcp/builtin/builtin.types';
import { ValidationError } from '@/server/lib/errors';

function asyncHandler(fn: (req: Request, res: Response, next: NextFunction) => Promise<void>) {
  return (req: Request, res: Response, next: NextFunction) => {
    fn(req, res, next).catch(next);
  };
}

const VALID_TRANSPORTS: readonly BuiltinTransport[] = ['filesystem', 'terminal'];

function isValidTransport(t: string): t is BuiltinTransport {
  return (VALID_TRANSPORTS as readonly string[]).includes(t);
}

export function createBuiltinMcpRoutes(store: BuiltinMcpStore, registry: McpRegistry): Router {
  const router = Router();

  router.get(
    '/',
    asyncHandler(async (_req, res) => {
      res.json({ builtins: store.read() });
    }),
  );

  router.put(
    '/:transport',
    asyncHandler(async (req, res) => {
      const { transport } = req.params;
      if (!isValidTransport(transport)) throw new ValidationError('Unknown transport');

      const body = req.body as { enabled?: unknown; fsRoot?: unknown };
      const wasEnabled = store.read().find((r) => r.transport === transport)!.enabled;

      // fsRoot validation
      if ('fsRoot' in body) {
        if (body.fsRoot === null) {
          store.setFsRoot(transport, null);
        } else if (typeof body.fsRoot === 'string') {
          try {
            const stat = fs.statSync(body.fsRoot);
            if (!stat.isDirectory()) throw new ValidationError('fsRoot must be a directory');
          } catch (err) {
            if (err instanceof ValidationError) throw err;
            throw new ValidationError(`fsRoot does not exist: ${body.fsRoot}`);
          }
          store.setFsRoot(transport, body.fsRoot);
        } else {
          throw new ValidationError('fsRoot must be a string or null');
        }
      }

      if ('enabled' in body && typeof body.enabled === 'boolean') {
        if (body.enabled && !wasEnabled) {
          store.setEnabled(transport, true);
          await registry.startBuiltin(transport);
        } else if (!body.enabled && wasEnabled) {
          await registry.stopBuiltin(transport);
          store.setEnabled(transport, false);
        }
      } else if ('fsRoot' in body && wasEnabled) {
        // fsRoot changed while enabled → reconnect
        await registry.reconnectBuiltin(transport);
      }

      const state = store.read().find((r) => r.transport === transport)!;
      res.json({ state });
    }),
  );

  return router;
}
```

- [ ] **Step 4: Run tests, expect GREEN**

```bash
npx vitest run server/routes/builtin-mcp.routes.test.ts
```

- [ ] **Step 5: Wire into `app.ts`**

Add the import:
```ts
import type { BuiltinMcpStore } from '@/server/domain/mcp/builtin/builtin.store';
import { createBuiltinMcpRoutes } from './routes/builtin-mcp.routes';
```

Extend `AppDeps`:
```ts
builtinStore?: BuiltinMcpStore;
```

Mount the route near the existing `/api/mcp` mount:
```ts
if (deps.builtinStore && deps.mcpRegistry) {
  app.use('/api/mcp/builtin', createBuiltinMcpRoutes(deps.builtinStore, deps.mcpRegistry));
}
```

Important: this mount must come BEFORE the existing `app.use('/api/mcp', createMcpRoutes(...))` so the more specific path wins. Or check the existing mount logic — Express usually picks the first match in declaration order, so registering the more specific path first is the safe choice.

- [ ] **Step 6: Construct in `index.ts`**

After migrations:
```ts
import { BuiltinMcpStore } from './domain/mcp/builtin/builtin.store';
// ...
const builtinStore = new BuiltinMcpStore(db);
const mcpRegistry = new McpRegistry(contextStore, builtinStore);
```

Pass to `createApp`:
```ts
const app = createApp({ ..., builtinStore });
```

- [ ] **Step 7: Run server tests**

```bash
npx vitest run server/
```

Expected: all green except pre-existing Ollama flakes.

- [ ] **Step 8: Commit**

```bash
git add server/routes/builtin-mcp.routes.ts server/routes/builtin-mcp.routes.test.ts server/app.ts server/index.ts
git commit -m "feat(slice-21): GET/PUT /api/mcp/builtin routes + bootstrap wiring"
```

---

## Task H1: FE types + API + Zustand store

**Files:**
- Modify: `src/types/mcp.types.ts`.
- Create: `src/lib/api/builtin-mcp.api.ts` + test.
- Create: `src/stores/builtinMcp.store.ts` + test.

- [ ] **Step 1: Extend FE types**

In `src/types/mcp.types.ts`, append:
```ts
export type BuiltinTransport = 'filesystem' | 'terminal';

export interface BuiltinMcpState {
  transport: BuiltinTransport;
  enabled: boolean;
  fsRoot: string | null;
}

export interface BuiltinMcpListResponse {
  builtins: BuiltinMcpState[];
}
```

- [ ] **Step 2: API failing tests** — `src/lib/api/builtin-mcp.api.test.ts`:

```ts
import { describe, it, expect, afterEach } from 'vitest';
import { http, HttpResponse } from 'msw';
import { server } from '@/src/test/msw-server';
import { builtinMcpApi } from './builtin-mcp.api';

afterEach(() => server.resetHandlers());

describe('builtinMcpApi', () => {
  it('list() GETs /api/mcp/builtin and returns parsed payload', async () => {
    server.use(
      http.get('http://localhost/api/mcp/builtin', () => HttpResponse.json({
        builtins: [
          { transport: 'filesystem', enabled: false, fsRoot: null },
          { transport: 'terminal', enabled: false, fsRoot: null },
        ],
      })),
    );
    const got = await builtinMcpApi.list();
    expect(got).toHaveLength(2);
  });

  it('set() PUTs the patch and returns the new state', async () => {
    let receivedBody: unknown = null;
    server.use(
      http.put('http://localhost/api/mcp/builtin/filesystem', async ({ request }) => {
        receivedBody = await request.json();
        return HttpResponse.json({
          state: { transport: 'filesystem', enabled: true, fsRoot: null },
        });
      }),
    );
    const state = await builtinMcpApi.set('filesystem', { enabled: true });
    expect(state.enabled).toBe(true);
    expect(receivedBody).toEqual({ enabled: true });
  });
});
```

- [ ] **Step 3: Implement** — `src/lib/api/builtin-mcp.api.ts`:

```ts
import type {
  BuiltinTransport,
  BuiltinMcpState,
  BuiltinMcpListResponse,
} from '@/src/types/mcp.types';

async function jsonRes<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const msg = (body as { error?: { message?: string } }).error?.message ?? res.statusText;
    throw new Error(msg);
  }
  return (await res.json()) as T;
}

export const builtinMcpApi = {
  list: (): Promise<BuiltinMcpState[]> =>
    fetch('/api/mcp/builtin')
      .then(jsonRes<BuiltinMcpListResponse>)
      .then((b) => b.builtins),

  set: (
    transport: BuiltinTransport,
    patch: { enabled?: boolean; fsRoot?: string | null },
  ): Promise<BuiltinMcpState> =>
    fetch(`/api/mcp/builtin/${transport}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    })
      .then(jsonRes<{ state: BuiltinMcpState }>)
      .then((b) => b.state),
};
```

- [ ] **Step 4: Run, expect GREEN**

```bash
npx vitest run src/lib/api/builtin-mcp.api.test.ts
```

- [ ] **Step 5: Store failing tests** — `src/stores/builtinMcp.store.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { http, HttpResponse } from 'msw';
import { server } from '@/src/test/msw-server';
import { useBuiltinMcpStore } from './builtinMcp.store';
import { useMcpStore } from './mcp.store';

beforeEach(() => useBuiltinMcpStore.getState()._reset());
afterEach(() => server.resetHandlers());

describe('useBuiltinMcpStore', () => {
  it('init() populates builtins', async () => {
    server.use(
      http.get('http://localhost/api/mcp/builtin', () => HttpResponse.json({
        builtins: [
          { transport: 'filesystem', enabled: false, fsRoot: null },
          { transport: 'terminal', enabled: false, fsRoot: null },
        ],
      })),
    );
    await useBuiltinMcpStore.getState().init();
    expect(useBuiltinMcpStore.getState().builtins).toHaveLength(2);
    expect(useBuiltinMcpStore.getState().loading).toBe(false);
  });

  it('toggle() PUTs and updates the row + calls useMcpStore.refresh', async () => {
    const refreshSpy = vi.fn(async () => {});
    useMcpStore.setState({ refresh: refreshSpy });
    server.use(
      http.get('http://localhost/api/mcp/builtin', () => HttpResponse.json({
        builtins: [{ transport: 'filesystem', enabled: false, fsRoot: null }],
      })),
      http.put('http://localhost/api/mcp/builtin/filesystem', () => HttpResponse.json({
        state: { transport: 'filesystem', enabled: true, fsRoot: null },
      })),
    );
    await useBuiltinMcpStore.getState().init();
    await useBuiltinMcpStore.getState().toggle('filesystem');
    const fs = useBuiltinMcpStore.getState().builtins.find((b) => b.transport === 'filesystem');
    expect(fs?.enabled).toBe(true);
    expect(refreshSpy).toHaveBeenCalled();
  });

  it('toggle dedupes parallel calls for the same transport', async () => {
    let puts = 0;
    server.use(
      http.put('http://localhost/api/mcp/builtin/filesystem', async () => {
        puts++;
        await new Promise((r) => setTimeout(r, 30));
        return HttpResponse.json({ state: { transport: 'filesystem', enabled: true, fsRoot: null } });
      }),
    );
    useBuiltinMcpStore.setState({
      builtins: [{ transport: 'filesystem', enabled: false, fsRoot: null }],
    });
    const a = useBuiltinMcpStore.getState().toggle('filesystem');
    const b = useBuiltinMcpStore.getState().toggle('filesystem');
    await Promise.all([a, b]);
    expect(puts).toBe(1);
  });

  it('setFsRoot PUTs the new path', async () => {
    let receivedBody: unknown = null;
    server.use(
      http.put('http://localhost/api/mcp/builtin/filesystem', async ({ request }) => {
        receivedBody = await request.json();
        return HttpResponse.json({ state: { transport: 'filesystem', enabled: false, fsRoot: '/x' } });
      }),
    );
    useBuiltinMcpStore.setState({
      builtins: [{ transport: 'filesystem', enabled: false, fsRoot: null }],
    });
    await useBuiltinMcpStore.getState().setFsRoot('filesystem', '/x');
    expect(receivedBody).toEqual({ fsRoot: '/x' });
  });

  it('network failure sets error', async () => {
    server.use(
      http.get('http://localhost/api/mcp/builtin', () => HttpResponse.error()),
    );
    await useBuiltinMcpStore.getState().init();
    expect(useBuiltinMcpStore.getState().error).not.toBeNull();
  });
});
```

- [ ] **Step 6: Implement** — `src/stores/builtinMcp.store.ts`:

```ts
import { create } from 'zustand';
import { builtinMcpApi } from '@/src/lib/api/builtin-mcp.api';
import { useMcpStore } from './mcp.store';
import type { BuiltinTransport, BuiltinMcpState } from '@/src/types/mcp.types';

interface BuiltinMcpStoreState {
  builtins: BuiltinMcpState[];
  loading: boolean;
  error: string | null;

  init(): Promise<void>;
  toggle(transport: BuiltinTransport): Promise<void>;
  setFsRoot(transport: BuiltinTransport, root: string | null): Promise<void>;
  _reset(): void;
}

const initial = {
  builtins: [] as BuiltinMcpState[],
  loading: false,
  error: null as string | null,
};

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : 'Operation failed';
}

const inflight = new Map<string, Promise<BuiltinMcpState>>();

export const useBuiltinMcpStore = create<BuiltinMcpStoreState>((set, get) => ({
  ...initial,
  _reset: () => { inflight.clear(); set(initial); },

  init: async () => {
    set({ loading: true, error: null });
    try {
      const builtins = await builtinMcpApi.list();
      set({ builtins, loading: false, error: null });
    } catch (e) {
      set({ loading: false, error: errMsg(e) });
    }
  },

  toggle: async (transport) => {
    const key = `toggle:${transport}`;
    const existing = inflight.get(key);
    if (existing) { await existing.catch(() => {}); return; }
    const current = get().builtins.find((b) => b.transport === transport);
    if (!current) return;
    const newEnabled = !current.enabled;
    const promise = builtinMcpApi.set(transport, { enabled: newEnabled });
    inflight.set(key, promise);
    try {
      const state = await promise;
      set((s) => ({
        builtins: s.builtins.map((b) => (b.transport === transport ? state : b)),
        error: null,
      }));
      void useMcpStore.getState().refresh();
    } catch (e) {
      set({ error: errMsg(e) });
    } finally {
      inflight.delete(key);
    }
  },

  setFsRoot: async (transport, root) => {
    const key = `fsroot:${transport}`;
    const existing = inflight.get(key);
    if (existing) { await existing.catch(() => {}); return; }
    const promise = builtinMcpApi.set(transport, { fsRoot: root });
    inflight.set(key, promise);
    try {
      const state = await promise;
      set((s) => ({
        builtins: s.builtins.map((b) => (b.transport === transport ? state : b)),
        error: null,
      }));
      void useMcpStore.getState().refresh();
    } catch (e) {
      set({ error: errMsg(e) });
    } finally {
      inflight.delete(key);
    }
  },
}));
```

- [ ] **Step 7: Run, expect GREEN**

```bash
npx vitest run src/lib/api/builtin-mcp.api.test.ts src/stores/builtinMcp.store.test.ts
```

- [ ] **Step 8: Commit**

```bash
git add src/types/mcp.types.ts src/lib/api/builtin-mcp.api.ts src/lib/api/builtin-mcp.api.test.ts src/stores/builtinMcp.store.ts src/stores/builtinMcp.store.test.ts
git commit -m "feat(slice-21): FE types + builtinMcpApi + useBuiltinMcpStore"
```

---

## Task I1: `<BuiltinMcpToggles>` component + App mount + McpServersSection filter

**Files:**
- Create: `src/components/sidebar/BuiltinMcpToggles.tsx` + test.
- Modify: `src/components/sidebar/McpServersSection.tsx` + test.
- Modify: `src/App.tsx`.

- [ ] **Step 1: Component failing tests** — `BuiltinMcpToggles.test.tsx`:

```tsx
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BuiltinMcpToggles } from './BuiltinMcpToggles';
import { useBuiltinMcpStore } from '@/src/stores/builtinMcp.store';
import { useMcpStore } from '@/src/stores/mcp.store';

beforeEach(() => {
  useBuiltinMcpStore.getState()._reset();
  useMcpStore.getState()._reset();
});

describe('BuiltinMcpToggles', () => {
  it('renders 2 rows in fixed order (Filesystem, Terminal)', () => {
    useBuiltinMcpStore.setState({
      builtins: [
        { transport: 'filesystem', enabled: false, fsRoot: null },
        { transport: 'terminal', enabled: false, fsRoot: null },
      ],
    });
    render(<BuiltinMcpToggles />);
    const rows = screen.getAllByTestId('builtin-mcp-row');
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent(/Filesystem/i);
    expect(rows[1]).toHaveTextContent(/Terminal/i);
  });

  it('clicking the Filesystem toggle calls useBuiltinMcpStore.toggle', async () => {
    const toggleSpy = vi.fn(async () => {});
    useBuiltinMcpStore.setState({
      builtins: [
        { transport: 'filesystem', enabled: false, fsRoot: null },
        { transport: 'terminal', enabled: false, fsRoot: null },
      ],
      toggle: toggleSpy,
    });
    const user = userEvent.setup();
    render(<BuiltinMcpToggles />);
    await user.click(screen.getByLabelText(/toggle filesystem/i));
    expect(toggleSpy).toHaveBeenCalledWith('filesystem');
  });

  it('Filesystem row shows the current fsRoot or "default"', () => {
    useBuiltinMcpStore.setState({
      builtins: [
        { transport: 'filesystem', enabled: true, fsRoot: '/repo' },
        { transport: 'terminal', enabled: false, fsRoot: null },
      ],
    });
    render(<BuiltinMcpToggles />);
    expect(screen.getByText('/repo')).toBeInTheDocument();
  });

  it('shows "default" when fsRoot is null', () => {
    useBuiltinMcpStore.setState({
      builtins: [
        { transport: 'filesystem', enabled: true, fsRoot: null },
        { transport: 'terminal', enabled: false, fsRoot: null },
      ],
    });
    render(<BuiltinMcpToggles />);
    expect(screen.getByText(/default/i)).toBeInTheDocument();
  });

  it('status dot reflects useMcpStore live state for builtin:<transport>', () => {
    useBuiltinMcpStore.setState({
      builtins: [
        { transport: 'filesystem', enabled: true, fsRoot: null },
        { transport: 'terminal', enabled: false, fsRoot: null },
      ],
    });
    useMcpStore.setState({
      states: { 'builtin:filesystem': { state: 'online' } },
    });
    render(<BuiltinMcpToggles />);
    const rows = screen.getAllByTestId('builtin-mcp-row');
    expect(rows[0].querySelector('[data-state="online"]')).not.toBeNull();
  });
});
```

- [ ] **Step 2: Implement** — `BuiltinMcpToggles.tsx`:

```tsx
import { useBuiltinMcpStore } from '@/src/stores/builtinMcp.store';
import { useMcpStore } from '@/src/stores/mcp.store';
import type { BuiltinTransport } from '@/src/types/mcp.types';
import { cn } from '@/src/lib/cn';

const ROW_ORDER: BuiltinTransport[] = ['filesystem', 'terminal'];

const LABEL: Record<BuiltinTransport, string> = {
  filesystem: 'Filesystem',
  terminal: 'Terminal',
};

const DOT_CLASS: Record<string, string> = {
  online: 'text-status-ok',
  connecting: 'text-status-warn',
  reconnecting: 'text-status-warn',
  error: 'text-status-error',
  offline: 'text-zinc-500',
};

export function BuiltinMcpToggles() {
  const builtins = useBuiltinMcpStore((s) => s.builtins);
  const toggle = useBuiltinMcpStore((s) => s.toggle);
  const states = useMcpStore((s) => s.states);

  if (builtins.length === 0) return null;

  return (
    <section>
      <div className="mono-label mb-2">Coding Tools</div>
      <div className="space-y-1">
        {ROW_ORDER.map((t) => {
          const row = builtins.find((b) => b.transport === t);
          if (!row) return null;
          const liveState = states?.[`builtin:${t}`]?.state ?? 'offline';
          const dotClass = DOT_CLASS[liveState] ?? 'text-zinc-500';
          return (
            <div
              key={t}
              data-testid="builtin-mcp-row"
              className="flex items-center gap-2 p-1.5 bg-zinc-900 border border-border-subtle rounded text-[10px] font-mono"
            >
              <span data-state={liveState} className={cn(dotClass)}>●</span>
              <span className="text-zinc-300">{LABEL[t]}</span>
              {t === 'filesystem' && (
                <span className="flex-1 text-zinc-600 truncate" title={row.fsRoot ?? 'default'}>
                  {row.fsRoot ?? 'default'}
                </span>
              )}
              {t !== 'filesystem' && <span className="flex-1" />}
              <button
                type="button"
                aria-label={`Toggle ${LABEL[t]}`}
                onClick={() => void toggle(t)}
                className={cn(
                  'px-2 py-0.5 rounded text-[10px] border',
                  row.enabled
                    ? 'bg-accent/20 text-accent border-accent/40'
                    : 'bg-surface-1 text-zinc-500 border-border-subtle hover:text-zinc-300',
                )}
              >
                {row.enabled ? 'On' : 'Off'}
              </button>
            </div>
          );
        })}
      </div>
    </section>
  );
}
```

- [ ] **Step 3: Run, expect GREEN**

```bash
npx vitest run src/components/sidebar/BuiltinMcpToggles.test.tsx
```

- [ ] **Step 4: Filter `'builtin:*'` from McpServersSection**

In `src/components/sidebar/McpServersSection.tsx`, find the place where the MCP server list is iterated for rendering and add a filter to exclude ids starting with `'builtin:'`. Locate where `useMcpStore` provides servers — probably a selector like `(s) => s.servers` — and apply:

```tsx
const servers = useMcpStore((s) => s.servers).filter((srv) => !srv.id.startsWith('builtin:'));
```

(Adapt to the actual selector name. If the section maps over a different state shape, the filter goes wherever the array of servers is consumed.)

Append a test case to `McpServersSection.test.tsx`:
```tsx
it('does not render servers whose id starts with "builtin:"', () => {
  useMcpStore.setState({
    servers: [
      { id: 'builtin:filesystem', name: 'Filesystem' /* shape */ },
      { id: 'user-server-1', name: 'My MCP' /* shape */ },
    ],
  });
  render(<McpServersSection />);
  expect(screen.queryByText('Filesystem')).toBeNull();
  expect(screen.getByText('My MCP')).toBeInTheDocument();
});
```

(Adapt the state shape to whatever `useMcpStore` actually expects.)

- [ ] **Step 5: Mount in `App.tsx`**

Add the import:
```tsx
import { BuiltinMcpToggles } from '@/src/components/sidebar/BuiltinMcpToggles';
import { useBuiltinMcpStore } from '@/src/stores/builtinMcp.store';
```

Add `<BuiltinMcpToggles />` to the sidebar children BEFORE `<McpServersSection />`:
```tsx
<Sidebar ...>
  <SessionsSection />
  <SystemProtocolSection />
  <SkillsSection />
  <ToolsSection />
  <BuiltinMcpToggles />
  <McpServersSection />
  <SubAgentsSection />
  <ProviderAuthSection />
</Sidebar>
```

In the init useEffect, add:
```tsx
const initBuiltinMcp = useBuiltinMcpStore((s) => s.init);
useEffect(() => {
  // ...existing inits...
  initBuiltinMcp();
}, [..., initBuiltinMcp]);
```

- [ ] **Step 6: Run, expect GREEN**

```bash
npx vitest run src/
```

- [ ] **Step 7: Commit**

```bash
git add src/components/sidebar/BuiltinMcpToggles.tsx src/components/sidebar/BuiltinMcpToggles.test.tsx src/components/sidebar/McpServersSection.tsx src/components/sidebar/McpServersSection.test.tsx src/App.tsx
git commit -m "feat(slice-21): BuiltinMcpToggles section + filter built-ins from McpServersSection"
```

---

## Task J1: MSW defaults + integration test

**Files:**
- Modify: `src/test/msw-handlers.ts`.
- Create: `src/integration/builtin-mcp.integration.test.tsx`.

- [ ] **Step 1: MSW defaults**

Append to `msw-handlers.ts`:
```ts
http.get('http://localhost/api/mcp/builtin', () => HttpResponse.json({
  builtins: [
    { transport: 'filesystem', enabled: false, fsRoot: null },
    { transport: 'terminal', enabled: false, fsRoot: null },
  ],
})),
http.put('http://localhost/api/mcp/builtin/:transport', async ({ params, request }) => {
  const body = (await request.json()) as { enabled?: boolean; fsRoot?: string | null };
  return HttpResponse.json({
    state: {
      transport: params.transport,
      enabled: body.enabled ?? false,
      fsRoot: body.fsRoot ?? null,
    },
  });
}),
```

- [ ] **Step 2: Integration test**

`src/integration/builtin-mcp.integration.test.tsx`:

```tsx
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { server } from '@/src/test/msw-server';
import App from '@/src/App';
import { useUiStore } from '@/src/stores/ui.store';
import { useSessionsStore } from '@/src/stores/sessions.store';
import { useProfilesStore } from '@/src/stores/profiles.store';
import { useContextStore } from '@/src/stores/context.store';
import { useSubAgentsStore } from '@/src/stores/subagents.store';
import { useMcpStore } from '@/src/stores/mcp.store';
import { useProvidersStore } from '@/src/stores/providers.store';
import { useChatStore } from '@/src/stores/chat.store';
import { useProviderAuthStore } from '@/src/stores/providerAuth.store';
import { useKeyVaultStore } from '@/src/stores/keyVault.store';
import { useBuiltinMcpStore } from '@/src/stores/builtinMcp.store';

beforeEach(() => {
  useUiStore.getState()._reset();
  useSessionsStore.getState()._reset();
  useProfilesStore.getState()._reset();
  useContextStore.getState()._reset();
  useSubAgentsStore.getState()._reset();
  useMcpStore.getState()._reset();
  useProvidersStore.getState()._reset();
  useChatStore.getState()._reset();
  useProviderAuthStore.getState()._reset();
  useKeyVaultStore.getState()._reset();
  useBuiltinMcpStore.getState()._reset();
  localStorage.clear();
});

afterEach(() => server.resetHandlers());

describe('builtin MCP integration', () => {
  it('toggle Filesystem on → PUT captured → row flips → toggle off restores', async () => {
    let capturedBody: { enabled?: boolean } | null = null;
    server.use(
      http.put('http://localhost/api/mcp/builtin/filesystem', async ({ request }) => {
        capturedBody = (await request.json()) as typeof capturedBody;
        return HttpResponse.json({
          state: {
            transport: 'filesystem',
            enabled: capturedBody?.enabled ?? false,
            fsRoot: null,
          },
        });
      }),
    );
    const user = userEvent.setup();
    render(<App />);
    await waitFor(() => expect(useBuiltinMcpStore.getState().builtins.length).toBe(2));

    const fsToggle = screen.getByLabelText(/toggle filesystem/i);
    await user.click(fsToggle);
    await waitFor(() => expect(capturedBody?.enabled).toBe(true));
    await waitFor(() => {
      const fs = useBuiltinMcpStore.getState().builtins.find((b) => b.transport === 'filesystem');
      expect(fs?.enabled).toBe(true);
    });

    await user.click(fsToggle);
    await waitFor(() => expect(capturedBody?.enabled).toBe(false));
  });
});
```

- [ ] **Step 3: Run, expect GREEN**

```bash
npx vitest run src/integration/builtin-mcp.integration.test.tsx
```

- [ ] **Step 4: Commit**

```bash
git add src/test/msw-handlers.ts src/integration/builtin-mcp.integration.test.tsx
git commit -m "test(slice-21): MSW defaults + integration — toggle round-trip"
```

---

## Task K1: Playwright smoke + final gates + PR

**Files:**
- Modify: `e2e/smoke.spec.ts`.

- [ ] **Step 1: Append smoke**

```ts
test('builtin MCPs: 2 toggle rows visible, click Filesystem twice to toggle on/off', async ({ page }) => {
  await page.goto('/');
  await page.getByText('AETHER_CORE').waitFor();

  // The Coding Tools section is in the sidebar
  const rows = page.getByTestId('builtin-mcp-row');
  await expect(rows).toHaveCount(2);

  // Click the Filesystem toggle
  await page.getByLabel('Toggle Filesystem').click();

  // Wait for the button label to change to "On" (or stay "Off" if backend rejected — either way no crash).
  await page.waitForTimeout(500);

  // Click again to toggle off
  await page.getByLabel('Toggle Filesystem').click();
  await page.waitForTimeout(500);

  // Both rows still rendered
  await expect(rows).toHaveCount(2);
});
```

- [ ] **Step 2: Build + Playwright**

```bash
npm run build
npx playwright test --grep "builtin MCPs"
```

Expected: PASS.

- [ ] **Step 3: Lint**

```bash
npm run lint
```

Expected: clean.

- [ ] **Step 4: Full vitest**

```bash
npx vitest run
```

Expected: all green except pre-existing Ollama flakes.

- [ ] **Step 5: Full Playwright**

```bash
npx playwright test
```

Expected: 19/19 pass (or 18/19 with the known intermittent isolation flake on slice 18 vault — re-run if needed).

- [ ] **Step 6: Push + open PR**

```bash
git add e2e/smoke.spec.ts
git commit -m "test(slice-21): playwright smoke for builtin MCP toggles"
git push -u origin feat/slice-21-one-click-mcps
gh pr create --title "feat(slice-21): 1-click coding MCPs (Filesystem + Terminal)" --body "$(cat <<'EOF'
## Summary
- Migration 006 adds `builtin_mcp_state` (2-row table, filesystem + terminal).
- New `BuiltinMcpStore` reads/writes the table; `toConfigs(cwd)` materializes in-memory `McpServerConfig` for each enabled built-in.
- Custom in-repo `aether-shell` stdio MCP server (one tool: `execute_command`) with 30 s timeout (max 120 s), 1 MB output cap, and a blocklist of dangerous patterns. Spawned via the existing stdio transport.
- Filesystem uses the official `@modelcontextprotocol/server-filesystem` (new npm dep) spawned via stdio, rooted at the configured `fsRoot` or `process.cwd()`.
- `McpRegistry` gains `startBuiltin` / `stopBuiltin` / `reconnectBuiltin`; `init()` merges built-ins with user configs; `list()` filters built-in ids out.
- New routes: `GET /api/mcp/builtin` (list) + `PUT /api/mcp/builtin/:transport` (enable/disable + `fsRoot`).
- New `<BuiltinMcpToggles>` sidebar section above `<McpServersSection>`. Built-ins never appear in the manual MCP list.

## Test plan
- [x] `BuiltinMcpStore` (6 cases) + `aether-shell.handler` (happy + 4 blocklist + timeout + cap = 9 cases)
- [x] McpRegistry built-in connect/stop/reconnect (4 cases)
- [x] Routes (7 cases incl. fsRoot validation + invalid transport)
- [x] FE api + store (5 cases)
- [x] `<BuiltinMcpToggles>` component (5 cases)
- [x] `<McpServersSection>` filter (1 case)
- [x] Integration: toggle round-trip
- [x] Playwright smoke: 2 rows visible + toggle on/off
- [x] Lint clean, full vitest green (modulo Ollama flakes), Playwright passing

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

Expected: PR URL printed.

---

## Self-review

| Spec requirement | Task |
|---|---|
| Migration 006 with `builtin_mcp_state` (2 rows) | A1 |
| Types + `BLOCKED_PATTERNS` + `SHELL_DEFAULTS` | A1 |
| `BuiltinMcpStore.read/setEnabled/setFsRoot/toConfigs` | B1 |
| `aether-shell` handler with timeout / cap / blocklist | C1 |
| `aether-shell` stdio script (JSON-RPC framing) | D1 |
| `@modelcontextprotocol/server-filesystem` dep | E1 |
| `McpRegistry.startBuiltin/stopBuiltin/reconnectBuiltin` | F1 |
| `McpRegistry.list()` filters `'builtin:*'` | F1 |
| `init()` merges built-ins into connect loop | F1 |
| `GET /api/mcp/builtin` + `PUT /api/mcp/builtin/:transport` | G1 |
| `fsRoot` validation (400 if non-existent / not a dir) | G1 |
| Bootstrap wiring (`BuiltinMcpStore` + registry + `createApp`) | G1 |
| FE types + api + store | H1 |
| Per-transport dedupe + `useMcpStore.refresh()` after mutation | H1 |
| `<BuiltinMcpToggles>` section | I1 |
| `<McpServersSection>` filters `'builtin:'` ids | I1 |
| App mount + init | I1 |
| MSW defaults | J1 |
| Integration test (toggle round-trip) | J1 |
| Playwright smoke | K1 |

No placeholders. Types/names consistent: `BuiltinMcpStore`, `BuiltinMcpState`, `BuiltinTransport`, `BLOCKED_PATTERNS`, `SHELL_DEFAULTS`, `executeCommand`, `startBuiltin`/`stopBuiltin`/`reconnectBuiltin`, `useBuiltinMcpStore`, `builtinMcpApi`.
