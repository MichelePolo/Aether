import type { McpTool, McpToolResult } from './mcp.types';

export interface CallToolOpts {
  signal?: AbortSignal;
  onProgress?: (note: string) => void;
}

export interface McpConnection {
  readonly defaultAutoApprove: boolean;
  initialize(): Promise<void>;
  listTools(): Promise<McpTool[]>;
  callTool(
    name: string,
    args: Record<string, unknown>,
    opts?: CallToolOpts,
  ): Promise<McpToolResult>;
  close(): Promise<void>;
  onUnexpectedClose?(handler: () => void): void;
}
