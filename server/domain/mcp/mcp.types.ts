import type { McpToolPolicy, McpConnectionState } from '@/server/domain/context/context.types';
export type { McpToolPolicy, McpConnectionState };

export interface McpToolSchema {
  type?: 'object';
  properties?: Record<string, unknown>;
  required?: string[];
  additionalProperties?: boolean;
}

export interface McpTool {
  name: string;
  description?: string;
  inputSchema: McpToolSchema;
}

export interface McpToolCall {
  id: string;
  qualifiedName: string;
  args: Record<string, unknown>;
}

export type McpToolResult =
  | { ok: true; output: unknown }
  | { ok: false; error: string };

export interface McpConnectionStateSnapshot {
  state: McpConnectionState;
  error?: string;
  reconnectAttempt?: number;
  reconnectMaxAttempts?: number;
}
