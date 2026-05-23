import type { ContextStore } from '@/server/domain/context/context.store';
import type { McpServerConfig } from '@/server/domain/context/context.types';
import type { CallToolOpts, McpConnection } from './connection.types';
import type {
  McpTool,
  McpToolResult,
  McpToolPolicy,
  McpConnectionStateSnapshot,
} from './mcp.types';
import type { BuiltinMcpStore } from './builtin/builtin.store';
import type { BuiltinTransport } from './builtin/builtin.types';
import { MockMcpConnection } from './mock-connection';
import { StdioMcpConnection } from './stdio-connection';
import { HttpMcpConnection } from './http-connection';

const RECONNECT_DELAYS_MS = [1000, 2000, 4000, 8000, 16000];
const MAX_RECONNECT_ATTEMPTS = RECONNECT_DELAYS_MS.length;

interface LiveEntry {
  connection: McpConnection;
  serverName: string;
  serverId: string;
  tools: McpTool[];
  policies: Record<string, McpToolPolicy>; // persisted overrides, indexed by local name
}

export interface LiveTool {
  qualifiedName: string;
  serverId: string;
  serverName: string;
  tool: McpTool;
  autoApprove: boolean;
}

export class McpRegistry {
  private live = new Map<string, LiveEntry>();
  private states = new Map<string, McpConnectionStateSnapshot>();
  private decisions = new Map<
    string,
    { resolve: (v: 'approve' | 'reject') => void; timer: NodeJS.Timeout }
  >();
  private reconnectAborters = new Map<string, AbortController>();

  constructor(
    private readonly contextStore: ContextStore,
    private readonly builtinStore?: BuiltinMcpStore,
  ) {}

  async connect(id: string): Promise<{ tools: McpTool[] }> {
    if (this.live.has(id)) return { tools: this.live.get(id)!.tools };
    const ctx = await this.contextStore.read();
    const cfg = ctx.mcpServers.find((s) => s.id === id);
    if (!cfg) throw new Error(`Unknown MCP server '${id}'`);
    return this.connectFromConfig(cfg);
  }

  private async connectFromConfig(cfg: McpServerConfig): Promise<{ tools: McpTool[] }> {
    const id = cfg.id;
    if (this.live.has(id)) {
      return { tools: this.live.get(id)!.tools };
    }
    this.states.set(id, { state: 'connecting' });
    try {
      const connection = this.makeConnection(cfg);
      await connection.initialize();
      const tools = await connection.listTools();
      if (this.live.has(id)) {
        await connection.close().catch(() => {});
        return { tools: this.live.get(id)!.tools };
      }
      this.live.set(id, {
        connection,
        serverName: cfg.name,
        serverId: id,
        tools,
        policies: cfg.toolPolicies ?? {},
      });
      this.states.set(id, { state: 'online' });
      connection.onUnexpectedClose?.(() => {
        void this.triggerReconnect(id, cfg);
      });
      return { tools };
    } catch (e) {
      this.states.set(id, {
        state: 'error',
        error: e instanceof Error ? e.message : 'connect failed',
      });
      throw e;
    }
  }

  async startBuiltin(transport: BuiltinTransport): Promise<void> {
    if (!this.builtinStore) throw new Error('Built-in MCP store not configured');
    const id = `builtin:${transport}`;
    if (this.live.has(id)) return;
    const configs = this.builtinStore.toConfigs(process.cwd());
    const cfg = configs.find((c) => c.id === id);
    if (!cfg) throw new Error(`Built-in ${transport} not enabled`);
    await this.connectFromConfig(cfg);
  }

  async stopBuiltin(transport: BuiltinTransport): Promise<void> {
    const id = `builtin:${transport}`;
    await this.disconnect(id);
  }

  async reconnectBuiltin(transport: BuiltinTransport): Promise<void> {
    await this.stopBuiltin(transport);
    await this.startBuiltin(transport);
  }

  async disconnect(id: string): Promise<void> {
    const aborter = this.reconnectAborters.get(id);
    if (aborter) {
      aborter.abort();
      this.reconnectAborters.delete(id);
    }
    const entry = this.live.get(id);
    if (entry) {
      await entry.connection.close().catch(() => {});
      this.live.delete(id);
    }
    this.states.set(id, { state: 'offline' });
  }

  listLiveTools(): LiveTool[] {
    const out: LiveTool[] = [];
    for (const entry of this.live.values()) {
      for (const tool of entry.tools) {
        out.push({
          qualifiedName: `${entry.serverName}.${tool.name}`,
          serverId: entry.serverId,
          serverName: entry.serverName,
          tool,
          autoApprove: this.resolvePolicy(entry, tool.name).autoApprove,
        });
      }
    }
    return out;
  }

  /** User-facing list of live server entries — excludes built-in servers. */
  list(): Array<{ serverId: string; serverName: string; tools: McpTool[] }> {
    return [...this.live.values()]
      .filter((entry) => !entry.serverId.startsWith('builtin:'))
      .map((entry) => ({
        serverId: entry.serverId,
        serverName: entry.serverName,
        tools: entry.tools,
      }));
  }

  /** All live tools from all connected servers (including built-ins) — used by dispatch layer. */
  getAvailableTools(): LiveTool[] {
    return this.listLiveTools();
  }

  async callTool(
    qualifiedName: string,
    args: Record<string, unknown>,
    opts?: CallToolOpts,
  ): Promise<McpToolResult> {
    const sep = qualifiedName.indexOf('.');
    if (sep < 0) return { ok: false, error: `Invalid qualified name '${qualifiedName}'` };
    const serverName = qualifiedName.slice(0, sep);
    const toolName = qualifiedName.slice(sep + 1);
    const entry = [...this.live.values()].find((e) => e.serverName === serverName);
    if (!entry) return { ok: false, error: `Server '${serverName}' is offline` };
    return entry.connection.callTool(toolName, args, opts);
  }

  async refreshTools(id: string): Promise<McpTool[]> {
    const entry = this.live.get(id);
    if (!entry) throw new Error(`MCP server '${id}' is not connected`);
    const tools = await entry.connection.listTools();
    entry.tools = tools;
    return tools;
  }

  cancelToolCall(_callId: string): void {
    /* no-op: actual cancellation lives in dispatch.service */
  }

  policy(qualifiedName: string): McpToolPolicy {
    const sep = qualifiedName.indexOf('.');
    if (sep < 0) return { autoApprove: false };
    const serverName = qualifiedName.slice(0, sep);
    const toolName = qualifiedName.slice(sep + 1);
    const entry = [...this.live.values()].find((e) => e.serverName === serverName);
    if (!entry) return { autoApprove: false };
    return this.resolvePolicy(entry, toolName);
  }

  stateOf(id: string): McpConnectionStateSnapshot {
    return this.states.get(id) ?? { state: 'offline' };
  }

  async setToolPolicy(serverId: string, toolName: string, policy: McpToolPolicy): Promise<void> {
    const cur = await this.contextStore.read();
    await this.contextStore.patch({
      mcpServers: cur.mcpServers.map((s) =>
        s.id === serverId
          ? { ...s, toolPolicies: { ...(s.toolPolicies ?? {}), [toolName]: policy } }
          : s,
      ),
    });
    const entry = this.live.get(serverId);
    if (entry) {
      entry.policies = { ...entry.policies, [toolName]: policy };
    }
  }

  awaitDecision(callId: string, timeoutMs = 60_000): Promise<'approve' | 'reject'> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.decisions.delete(callId);
        reject(new Error('decision timeout'));
      }, timeoutMs);
      this.decisions.set(callId, { resolve, timer });
    });
  }

  resolveDecision(callId: string, decision: 'approve' | 'reject'): void {
    const pending = this.decisions.get(callId);
    if (!pending) return;
    clearTimeout(pending.timer);
    this.decisions.delete(callId);
    pending.resolve(decision);
  }

  private makeConnection(cfg: McpServerConfig): McpConnection {
    if (cfg.transport === 'mock') return new MockMcpConnection();
    if (cfg.transport === 'http') {
      if (!cfg.url) throw new Error('http transport requires url');
      return new HttpMcpConnection({ url: cfg.url });
    }
    return new StdioMcpConnection({
      command: cfg.command ?? '',
      args: cfg.args ?? [],
      env: cfg.env ?? {},
    });
  }

  private resolvePolicy(entry: LiveEntry, toolName: string): McpToolPolicy {
    const persisted = entry.policies[toolName];
    if (persisted) return persisted;
    return { autoApprove: entry.connection.defaultAutoApprove };
  }

  private async triggerReconnect(id: string, cfg: McpServerConfig): Promise<void> {
    const existing = this.reconnectAborters.get(id);
    if (existing) existing.abort();
    const aborter = new AbortController();
    this.reconnectAborters.set(id, aborter);

    const stale = this.live.get(id);
    if (stale) {
      this.live.delete(id);
      await stale.connection.close().catch(() => {});
    }

    try {
      await this.reconnectLoop(id, cfg, aborter.signal);
    } finally {
      if (this.reconnectAborters.get(id) === aborter) {
        this.reconnectAborters.delete(id);
      }
    }
  }

  private async reconnectLoop(
    id: string,
    cfg: McpServerConfig,
    signal: AbortSignal,
    startAttempt = 1,
  ): Promise<void> {
    for (let attempt = startAttempt; attempt <= MAX_RECONNECT_ATTEMPTS; attempt++) {
      if (signal.aborted) return;
      this.states.set(id, {
        state: 'reconnecting',
        reconnectAttempt: attempt,
        reconnectMaxAttempts: MAX_RECONNECT_ATTEMPTS,
      });
      const delayMs = RECONNECT_DELAYS_MS[attempt - 1];
      const slept = await sleep(delayMs, signal);
      if (!slept || signal.aborted) return;
      try {
        const connection = this.makeConnection(cfg);
        await connection.initialize();
        const tools = await connection.listTools();
        if (signal.aborted) {
          await connection.close().catch(() => {});
          return;
        }
        this.live.set(id, {
          connection,
          serverName: cfg.name,
          serverId: id,
          tools,
          policies: cfg.toolPolicies ?? {},
        });
        this.states.set(id, { state: 'online' });
        connection.onUnexpectedClose?.(() => {
          void this.triggerReconnect(id, cfg);
        });
        return;
      } catch {
        // try next attempt
      }
    }
    if (!signal.aborted) {
      this.states.set(id, {
        state: 'error',
        error: 'Reconnect failed after 5 attempts',
      });
    }
  }

  /** Test-only helper: bypasses the first-attempt delay and drives the reconnect loop. */
  async __forceReconnectForTest(id: string): Promise<void> {
    const ctx = await this.contextStore.read();
    const cfg = ctx.mcpServers.find((s) => s.id === id);
    if (!cfg) throw new Error(`Unknown MCP server '${id}'`);
    const existing = this.reconnectAborters.get(id);
    if (existing) existing.abort();
    const aborter = new AbortController();
    this.reconnectAborters.set(id, aborter);

    const stale = this.live.get(id);
    if (stale) {
      this.live.delete(id);
      await stale.connection.close().catch(() => {});
    }

    try {
      await this.immediateReconnectAttempt(id, cfg, aborter.signal);
    } finally {
      if (this.reconnectAborters.get(id) === aborter) {
        this.reconnectAborters.delete(id);
      }
    }
  }

  private async immediateReconnectAttempt(
    id: string,
    cfg: McpServerConfig,
    signal: AbortSignal,
  ): Promise<void> {
    if (signal.aborted) return;
    this.states.set(id, {
      state: 'reconnecting',
      reconnectAttempt: 1,
      reconnectMaxAttempts: MAX_RECONNECT_ATTEMPTS,
    });
    try {
      const connection = this.makeConnection(cfg);
      await connection.initialize();
      const tools = await connection.listTools();
      if (signal.aborted) {
        await connection.close().catch(() => {});
        return;
      }
      this.live.set(id, {
        connection,
        serverName: cfg.name,
        serverId: id,
        tools,
        policies: cfg.toolPolicies ?? {},
      });
      this.states.set(id, { state: 'online' });
      connection.onUnexpectedClose?.(() => {
        void this.triggerReconnect(id, cfg);
      });
    } catch {
      await this.reconnectLoop(id, cfg, signal, 2);
    }
  }
}

function sleep(ms: number, signal: AbortSignal): Promise<boolean> {
  return new Promise((resolve) => {
    if (signal.aborted) {
      resolve(false);
      return;
    }
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve(true);
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      signal.removeEventListener('abort', onAbort);
      resolve(false);
    };
    signal.addEventListener('abort', onAbort, { once: true });
  });
}
