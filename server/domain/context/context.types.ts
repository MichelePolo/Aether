import type { ToolCategory } from '@/server/domain/mcp/breakpoints/breakpoints.types';

export interface Tool {
  id: string;
  name: string;
  version: string;
  status: 'online' | 'offline';
}

export type McpTransport = 'stdio' | 'mock' | 'http';
export type McpConnectionState =
  | 'offline'
  | 'connecting'
  | 'online'
  | 'reconnecting'
  | 'error';

export interface McpToolPolicy {
  autoApprove?: boolean;
  category?: ToolCategory;
}

export interface McpServerConfig {
  id: string;
  name: string;
  transport?: McpTransport;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  toolPolicies?: Record<string, McpToolPolicy>;
  status: McpConnectionState;
}

export interface Skill {
  name: string;
  enabled: boolean;
}

export interface AetherContext {
  systemInstruction: string;
  skills: Skill[];
  tools: Tool[];
  mcpServers: McpServerConfig[];
}
