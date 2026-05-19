import type { McpTool, McpToolResult } from './mcp.types';

export interface McpConnection {
  readonly defaultAutoApprove: boolean;
  initialize(): Promise<void>;
  listTools(): Promise<McpTool[]>;
  callTool(name: string, args: Record<string, unknown>): Promise<McpToolResult>;
  close(): Promise<void>;
}
