export interface Tool {
  id: string;
  name: string;
  version: string;
  status: 'online' | 'offline';
}

export type McpTransport = 'stdio' | 'mock';
export type McpConnectionState = 'offline' | 'connecting' | 'online' | 'error';

export interface McpToolPolicy {
  autoApprove: boolean;
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

export interface AetherContext {
  systemInstruction: string;
  skills: string[];
  tools: Tool[];
  mcpServers: McpServerConfig[];
}
