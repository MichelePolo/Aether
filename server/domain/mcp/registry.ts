import type { ContextStore } from '@/server/domain/context/context.store';
import type { McpServerConfig } from '@/server/domain/context/context.types';
import type { McpConnection } from './connection.types';
import type {
  McpTool,
  McpToolResult,
  McpToolPolicy,
  McpConnectionStateSnapshot,
} from './mcp.types';
import { MockMcpConnection } from './mock-connection';
import { StdioMcpConnection } from './stdio-connection';

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

  constructor(private readonly contextStore: ContextStore) {}

  async connect(id: string): Promise<{ tools: McpTool[] }> {
    const ctx = await this.contextStore.read();
    const cfg = ctx.mcpServers.find((s) => s.id === id);
    if (!cfg) throw new Error(`Unknown MCP server '${id}'`);
    if (this.live.has(id)) {
      return { tools: this.live.get(id)!.tools };
    }
    this.states.set(id, { state: 'connecting' });
    try {
      const connection = this.makeConnection(cfg);
      await connection.initialize();
      const tools = await connection.listTools();
      this.live.set(id, {
        connection,
        serverName: cfg.name,
        serverId: id,
        tools,
        policies: cfg.toolPolicies ?? {},
      });
      this.states.set(id, { state: 'online' });
      return { tools };
    } catch (e) {
      this.states.set(id, {
        state: 'error',
        error: e instanceof Error ? e.message : 'connect failed',
      });
      throw e;
    }
  }

  async disconnect(id: string): Promise<void> {
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

  async callTool(qualifiedName: string, args: Record<string, unknown>): Promise<McpToolResult> {
    const sep = qualifiedName.indexOf('.');
    if (sep < 0) return { ok: false, error: `Invalid qualified name '${qualifiedName}'` };
    const serverName = qualifiedName.slice(0, sep);
    const toolName = qualifiedName.slice(sep + 1);
    const entry = [...this.live.values()].find((e) => e.serverName === serverName);
    if (!entry) return { ok: false, error: `Server '${serverName}' is offline` };
    return entry.connection.callTool(toolName, args);
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
}
