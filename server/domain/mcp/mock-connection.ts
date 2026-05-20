import type { CallToolOpts, McpConnection } from './connection.types';
import type { McpTool, McpToolResult } from './mcp.types';

const MOCK_TOOLS: McpTool[] = [
  {
    name: 'echo',
    description: 'Returns the input message unchanged.',
    inputSchema: {
      type: 'object',
      properties: { message: { type: 'string' } },
      required: ['message'],
    },
  },
  {
    name: 'current_time',
    description: 'Returns the current time as ISO + unix seconds.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'read_file_mock',
    description: 'Pretends to read a file; returns synthetic content.',
    inputSchema: {
      type: 'object',
      properties: { path: { type: 'string' } },
      required: ['path'],
    },
  },
];

export class MockMcpConnection implements McpConnection {
  readonly defaultAutoApprove = true;

  async initialize(): Promise<void> {
    /* no-op */
  }

  async listTools(): Promise<McpTool[]> {
    return MOCK_TOOLS;
  }

  async callTool(
    name: string,
    args: Record<string, unknown>,
    opts?: CallToolOpts,
  ): Promise<McpToolResult> {
    if (opts?.signal?.aborted) return { ok: false, error: 'Cancelled by user' };
    switch (name) {
      case 'echo':
        return { ok: true, output: { message: String(args.message ?? '') } };
      case 'current_time':
        return { ok: true, output: { iso: new Date().toISOString(), unix: Math.floor(Date.now() / 1000) } };
      case 'read_file_mock':
        return { ok: true, output: { content: `mocked content of ${String(args.path ?? '<no path>')}` } };
      default:
        return { ok: false, error: `Unknown tool '${name}'` };
    }
  }

  async close(): Promise<void> {
    /* no-op */
  }
}
