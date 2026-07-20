import { randomUUID } from 'node:crypto';
import type {
  ProviderToolDecl,
  ProviderToolCallOutcome,
} from '@/server/domain/dispatch/providers/provider.types';

export type BridgeToolExecutor = (call: {
  qualifiedName: string;
  args: Record<string, unknown>;
}) => Promise<ProviderToolCallOutcome>;

export interface BridgeTool {
  /** MCP-safe exposed name ([A-Za-z0-9_-]); dots in qualifiedNames are normalized. */
  name: string;
  decl: ProviderToolDecl;
}

export interface BridgeEntry {
  tools: BridgeTool[];
  runToolCall: BridgeToolExecutor;
  expiresAt: number;
}

// Above the 24h gate-decision timeout, so a dispatch waiting on a breakpoint
// approval never loses its bridge entry mid-flight.
const DEFAULT_TTL_MS = 25 * 60 * 60 * 1000;

/**
 * Per-dispatch registry backing the loopback MCP endpoint that external
 * agentic CLIs (Codex) call back into. The opaque token IS the authorization:
 * it only travels to the spawned child process via its argv, and each entry is
 * unregistered when its dispatch's stream ends.
 */
export class McpBridgeService {
  private entries = new Map<string, BridgeEntry>();

  constructor(private readonly ttlMs = DEFAULT_TTL_MS) {}

  register(tools: ProviderToolDecl[], runToolCall: BridgeToolExecutor): string {
    this.sweep();
    const token = randomUUID();
    const used = new Set<string>();
    this.entries.set(token, {
      tools: tools.map((decl) => ({ name: safeName(decl.qualifiedName, used), decl })),
      runToolCall,
      expiresAt: Date.now() + this.ttlMs,
    });
    return token;
  }

  get(token: string): BridgeEntry | null {
    const entry = this.entries.get(token);
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) {
      this.entries.delete(token);
      return null;
    }
    return entry;
  }

  unregister(token: string): void {
    this.entries.delete(token);
  }

  private sweep(): void {
    const now = Date.now();
    for (const [token, entry] of this.entries) {
      if (now > entry.expiresAt) this.entries.delete(token);
    }
  }
}

/** MCP tool names must match [A-Za-z0-9_-]; qualified names like
 *  `Filesystem.read_file` get their dots normalized, with a numeric suffix on
 *  the (unlikely) collision. */
function safeName(qualifiedName: string, used: Set<string>): string {
  const base = qualifiedName.replace(/[^A-Za-z0-9_-]/g, '_');
  let name = base;
  let i = 2;
  while (used.has(name)) name = `${base}_${i++}`;
  used.add(name);
  return name;
}
