export interface Tool {
  id: string;
  name: string;
  version: string;
  status: 'online' | 'offline';
}

export interface McpServerConfig {
  id: string;
  name: string;
  url: string;
  status: 'online' | 'offline' | 'connecting';
}

export interface AetherContext {
  systemInstruction: string;
  skills: string[];
  tools: Tool[];
  mcpServers: McpServerConfig[];
}
