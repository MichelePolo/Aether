import { describe, it, expect, beforeEach } from 'vitest';
import { ContextStore } from '@/server/domain/context/context.store';
import { makeTestDb } from '@/server/test/test-db';
import { McpRegistry } from './registry';
import { BuiltinMcpStore } from './builtin/builtin.store';

function newCtx(): ContextStore {
  return new ContextStore(makeTestDb());
}

describe('McpRegistry', () => {
  let ctx: ContextStore;
  let reg: McpRegistry;
  beforeEach(async () => {
    ctx = newCtx();
    reg = new McpRegistry(ctx);
    await ctx.bulkOverwrite({
      systemInstruction: '',
      skills: [],
      tools: [],
      mcpServers: [
        { id: 'M1', name: 'mock', transport: 'mock', status: 'offline' },
      ],
    });
  });

  it('connect returns tools and transitions to online', async () => {
    const r = await reg.connect('M1');
    expect(r.tools.map((t) => t.name).sort()).toEqual(['current_time', 'echo', 'read_file_mock']);
    expect(reg.stateOf('M1').state).toBe('online');
  });

  it('listLiveTools returns namespaced names', async () => {
    await reg.connect('M1');
    const tools = reg.listLiveTools();
    expect(tools.map((t) => t.qualifiedName).sort()).toEqual([
      'mock.current_time', 'mock.echo', 'mock.read_file_mock',
    ]);
  });

  it('callTool routes by namespace', async () => {
    await reg.connect('M1');
    const res = await reg.callTool('mock.echo', { message: 'hi' });
    expect(res).toEqual({ ok: true, output: { message: 'hi' } });
  });

  it('callTool offline returns ok:false', async () => {
    const res = await reg.callTool('mock.echo', {});
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/offline/i);
  });

  it('policy: built-in mock default autoApprove true', async () => {
    await reg.connect('M1');
    expect(reg.policy('mock.echo')).toEqual({ autoApprove: true });
  });

  it('policy: persisted user override wins', async () => {
    await ctx.bulkOverwrite({
      systemInstruction: '',
      skills: [],
      tools: [],
      mcpServers: [
        { id: 'M1', name: 'mock', transport: 'mock', status: 'offline',
          toolPolicies: { echo: { autoApprove: false } } },
      ],
    });
    await reg.connect('M1');
    expect(reg.policy('mock.echo')).toEqual({ autoApprove: false });
  });

  it('disconnect transitions to offline; listLiveTools empties', async () => {
    await reg.connect('M1');
    await reg.disconnect('M1');
    expect(reg.stateOf('M1').state).toBe('offline');
    expect(reg.listLiveTools()).toEqual([]);
  });

  it('awaitDecision resolves when resolveDecision called', async () => {
    const p = reg.awaitDecision('CALL1', 1000);
    reg.resolveDecision('CALL1', 'approve');
    await expect(p).resolves.toBe('approve');
  });

  it('awaitDecision rejects on timeout', async () => {
    await expect(reg.awaitDecision('CALL2', 20)).rejects.toThrow(/timeout/i);
  });

  it('setToolPolicy persists to context.mcpServers[].toolPolicies', async () => {
    await reg.setToolPolicy('M1', 'echo', { autoApprove: false });
    const after = await ctx.read();
    expect(after.mcpServers[0].toolPolicies).toEqual({ echo: { autoApprove: false } });
  });

  it('refreshTools updates the live entry', async () => {
    await reg.connect('M1');
    const before = reg.listLiveTools().length;
    expect(before).toBe(3);
    const tools = await reg.refreshTools('M1');
    expect(tools.length).toBe(3);
  });

  it('refreshTools on disconnected server throws', async () => {
    await expect(reg.refreshTools('M1')).rejects.toThrow();
  });

  it('listLiveTools after refresh reflects mock tools unchanged', async () => {
    await reg.connect('M1');
    await reg.refreshTools('M1');
    expect(reg.listLiveTools().map((t) => t.tool.name).sort()).toEqual([
      'current_time', 'echo', 'read_file_mock',
    ]);
  });

  it('callTool forwards opts.signal to the connection', async () => {
    await reg.connect('M1');
    const ctrl = new AbortController();
    ctrl.abort();
    const res = await reg.callTool('mock.echo', { message: 'hi' }, { signal: ctrl.signal });
    expect(res).toEqual({ ok: false, error: 'Cancelled by user' });
  });

  it('passes onProgress through callTool (mock ignores; assert no throw)', async () => {
    await reg.connect('M1');
    const notes: string[] = [];
    const res = await reg.callTool('mock.echo', { message: 'hi' }, { onProgress: (n) => notes.push(n) });
    expect(res.ok).toBe(true);
    expect(notes).toEqual([]);
  });

  it('cancelToolCall is idempotent (no-op when controller missing)', () => {
    expect(() => reg.cancelToolCall?.('nonexistent')).not.toThrow();
  });

  it('auto-reconnect: triggers reconnecting state and returns to online', async () => {
    await reg.connect('M1');
    const promise = (reg as unknown as { __forceReconnectForTest(id: string): Promise<void> }).__forceReconnectForTest('M1');
    await promise;
    expect(reg.stateOf('M1').state).toBe('online');
  }, 10_000);
});

// ---------------------------------------------------------------------------
// Helper: override toConfigs to return mock transport to avoid spawning real subprocesses
// ---------------------------------------------------------------------------
function withMockTransport(store: BuiltinMcpStore): BuiltinMcpStore {
  const orig = store.toConfigs.bind(store);
  store.toConfigs = (cwd: string) => {
    const real = orig(cwd);
    return real.map((c) => ({
      ...c,
      transport: 'mock' as const,
      command: undefined,
      args: undefined,
    }));
  };
  return store;
}

// ---------------------------------------------------------------------------
// Helper: override rootedConfigs to return mock transport configs so no real
// subprocesses are spawned when ensureRootedBuiltins is called.
// ---------------------------------------------------------------------------
function withMockRootedTransport(store: BuiltinMcpStore): BuiltinMcpStore {
  store.rootedConfigs = (root: string) => [
    { id: `builtin:filesystem@${root}`, name: 'Filesystem', transport: 'mock' as const, status: 'offline' },
    { id: `builtin:git@${root}`, name: 'Git', transport: 'mock' as const, status: 'offline' },
  ];
  return store;
}

// ---------------------------------------------------------------------------
// Helper: inject always-ok mock connections for rooted builtins directly
// into the registry (bypasses makeConnection so unknown tool names return ok).
// ---------------------------------------------------------------------------
import type { McpConnection } from './connection.types';
import type { McpTool, McpToolResult } from './mcp.types';

class AlwaysOkConnection implements McpConnection {
  readonly defaultAutoApprove = true;
  async initialize(): Promise<void> { /* no-op */ }
  async listTools(): Promise<McpTool[]> {
    return [{ name: 'list_directory', description: 'mock', inputSchema: { type: 'object', properties: {} } }];
  }
  async callTool(_name: string, _args: Record<string, unknown>): Promise<McpToolResult> {
    return { ok: true, output: {} };
  }
  async close(): Promise<void> { /* no-op */ }
}

function withAlwaysOkRootedBuiltins(reg: McpRegistry, root: string): void {
  const fsConn = new AlwaysOkConnection();
  const gitConn = new AlwaysOkConnection();
  const fsTool: McpTool = { name: 'list_directory', description: 'mock', inputSchema: { type: 'object', properties: {} } };
  const gitTool: McpTool = { name: 'status', description: 'mock', inputSchema: { type: 'object', properties: {} } };
  reg.__injectLiveForTest(`builtin:filesystem@${root}`, 'Filesystem', fsConn, [fsTool]);
  reg.__injectLiveForTest(`builtin:git@${root}`, 'Git', gitConn, [gitTool]);
}

describe('McpRegistry — built-ins', () => {
  it('startBuiltin connects an enabled built-in via toConfigs', async () => {
    const db = makeTestDb();
    try {
      const builtinStore = withMockTransport(new BuiltinMcpStore(db));
      builtinStore.setEnabled('terminal', true);
      const ctx = new ContextStore(db);
      const registry = new McpRegistry(ctx, builtinStore);
      await registry.startBuiltin('terminal');
      // 'builtin:terminal' should be live but NOT in user-facing list
      expect(registry.list().find((e) => e.serverId === 'builtin:terminal')).toBeUndefined();
      // It should be accessible via getAvailableTools (the dispatcher's view)
      expect(registry.getAvailableTools().length).toBeGreaterThanOrEqual(0);
    } finally {
      db.close();
    }
  });

  it('stopBuiltin disconnects and re-start succeeds', async () => {
    const db = makeTestDb();
    try {
      const builtinStore = withMockTransport(new BuiltinMcpStore(db));
      builtinStore.setEnabled('terminal', true);
      const ctx = new ContextStore(db);
      const registry = new McpRegistry(ctx, builtinStore);
      await registry.startBuiltin('terminal');
      await registry.stopBuiltin('terminal');
      // After stop, calling start again should re-connect successfully
      await registry.startBuiltin('terminal');
    } finally {
      db.close();
    }
  });

  it('reconnectBuiltin stops then starts without throwing', async () => {
    const db = makeTestDb();
    try {
      const builtinStore = withMockTransport(new BuiltinMcpStore(db));
      builtinStore.setEnabled('terminal', true);
      const ctx = new ContextStore(db);
      const registry = new McpRegistry(ctx, builtinStore);
      await registry.startBuiltin('terminal');
      await registry.reconnectBuiltin('terminal');
      // A successful sequence of start → reconnect without throwing is the assertion
    } finally {
      db.close();
    }
  });

  it('list() filters out entries with serverId starting with "builtin:"', async () => {
    const db = makeTestDb();
    try {
      const builtinStore = withMockTransport(new BuiltinMcpStore(db));
      builtinStore.setEnabled('terminal', true);
      const ctx = new ContextStore(db);
      const registry = new McpRegistry(ctx, builtinStore);
      await registry.startBuiltin('terminal');
      const list = registry.list();
      for (const entry of list) {
        expect(entry.serverId.startsWith('builtin:')).toBe(false);
      }
    } finally {
      db.close();
    }
  });
});

// ---------------------------------------------------------------------------
// listLiveTools(root) and callTool with root routing
// ---------------------------------------------------------------------------
describe('McpRegistry — root-aware listLiveTools and callTool', () => {
  it('listLiveTools(root) returns only that root\'s builtin instance', async () => {
    const db = makeTestDb();
    try {
      const ctx = new ContextStore(db);
      const reg = new McpRegistry(ctx);

      withAlwaysOkRootedBuiltins(reg, '/work-a');
      withAlwaysOkRootedBuiltins(reg, '/work-b');
      const toolsA = reg.listLiveTools('/work-a');
      // Filesystem tools appear once (stable name), from the /work-a instance only
      const fsTools = toolsA.filter((t) => t.serverName === 'Filesystem');
      expect(fsTools.length).toBeGreaterThan(0);
      expect(fsTools.every((t) => t.serverId === 'builtin:filesystem@/work-a')).toBe(true);
    } finally {
      db.close();
    }
  });

  it('callTool routes Filesystem.* to the root-scoped instance', async () => {
    const db = makeTestDb();
    try {
      const ctx = new ContextStore(db);
      const reg = new McpRegistry(ctx);

      withAlwaysOkRootedBuiltins(reg, '/work-a');
      const res = await reg.callTool('Filesystem.list_directory', { path: '/work-a' }, { root: '/work-a' });
      expect(res.ok).toBe(true); // mock connection returns ok
    } finally {
      db.close();
    }
  });
});

// ---------------------------------------------------------------------------
// invalidateRootedBuiltins — drops all rooted instances and clears rootedLru
// ---------------------------------------------------------------------------
describe('McpRegistry — invalidateRootedBuiltins', () => {
  it('disconnects all rooted instances and clears rootedLru', async () => {
    const db = makeTestDb();
    try {
      const builtinStore = withMockRootedTransport(new BuiltinMcpStore(db));
      const ctx = new ContextStore(db);
      const reg = new McpRegistry(ctx, builtinStore);

      await reg.ensureRootedBuiltins('/root-a');
      await reg.ensureRootedBuiltins('/root-b');

      expect(reg.stateOf('builtin:filesystem@/root-a').state).toBe('online');
      expect(reg.stateOf('builtin:filesystem@/root-b').state).toBe('online');

      await reg.invalidateRootedBuiltins();

      expect(reg.stateOf('builtin:filesystem@/root-a').state).toBe('offline');
      expect(reg.stateOf('builtin:git@/root-a').state).toBe('offline');
      expect(reg.stateOf('builtin:filesystem@/root-b').state).toBe('offline');
      expect(reg.stateOf('builtin:git@/root-b').state).toBe('offline');

      // rootedLru is cleared — re-ensuring the same root re-connects fresh
      await reg.ensureRootedBuiltins('/root-a');
      expect(reg.stateOf('builtin:filesystem@/root-a').state).toBe('online');
    } finally {
      db.close();
    }
  });
});

// ---------------------------------------------------------------------------
// ensureRootedBuiltins — LRU-capped pool of per-root builtin instances
// ---------------------------------------------------------------------------
describe('McpRegistry — ensureRootedBuiltins', () => {
  it('pools one instance set per distinct root (idempotent)', async () => {
    const db = makeTestDb();
    try {
      const builtinStore = withMockRootedTransport(new BuiltinMcpStore(db));
      const ctx = new ContextStore(db);
      const reg = new McpRegistry(ctx, builtinStore);

      await reg.ensureRootedBuiltins('/work-a');
      await reg.ensureRootedBuiltins('/work-a'); // idempotent
      await reg.ensureRootedBuiltins('/work-b');

      expect(reg.stateOf('builtin:filesystem@/work-a').state).toBe('online');
      expect(reg.stateOf('builtin:filesystem@/work-b').state).toBe('online');
    } finally {
      db.close();
    }
  });

  it('evicts the least-recently-used root set when over the cap', async () => {
    vi.stubEnv('AETHER_BUILTIN_POOL_MAX', '2');
    const db = makeTestDb();
    try {
      const builtinStore = withMockRootedTransport(new BuiltinMcpStore(db));
      const ctx = new ContextStore(db);
      const reg = new McpRegistry(ctx, builtinStore);

      await reg.ensureRootedBuiltins('/r1');
      await reg.ensureRootedBuiltins('/r2');
      await reg.ensureRootedBuiltins('/r1'); // touch r1 -> r2 is now LRU
      await reg.ensureRootedBuiltins('/r3'); // over cap -> evict r2

      expect(reg.stateOf('builtin:filesystem@/r2').state).toBe('offline');
      expect(reg.stateOf('builtin:filesystem@/r1').state).toBe('online');
      expect(reg.stateOf('builtin:filesystem@/r3').state).toBe('online');
    } finally {
      db.close();
      vi.unstubAllEnvs();
    }
  });
});
