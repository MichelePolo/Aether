export type {
  McpTool,
  McpToolCall,
  McpToolResult,
  McpToolPolicy,
  McpConnectionState,
  McpConnectionStateSnapshot,
} from '@/server/domain/mcp/mcp.types';

export type { LiveTool } from '@/server/domain/mcp/registry';

export type BuiltinTransport = 'filesystem' | 'terminal';

export interface BuiltinMcpState {
  transport: BuiltinTransport;
  enabled: boolean;
  fsRoot: string | null;
}

export interface BuiltinMcpListResponse {
  builtins: BuiltinMcpState[];
}
