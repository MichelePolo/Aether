import type { McpToolResult } from './mcp.types';

export function normalizeToolResult(output: unknown): McpToolResult {
  if (output && typeof output === 'object' && (output as { isError?: unknown }).isError === true) {
    const content = (output as { content?: Array<{ type?: string; text?: string }> }).content;
    const error = Array.isArray(content) ? content.filter(c => c.type === 'text').map(c => c.text ?? '').join('\n') : '';
    return { ok: false, error: error || 'MCP tool failed' };
  }
  return { ok: true, output };
}
