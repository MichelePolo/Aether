import { describe, it, expect } from 'vitest';
import { McpToolSchema, ToolsListResultSchema, ToolsCallResultSchema, JsonRpcResponseSchema } from './mcp.schema';

describe('McpToolSchema', () => {
  it('accepts minimal tool', () => {
    expect(McpToolSchema.safeParse({ name: 'echo', inputSchema: { type: 'object' } }).success).toBe(true);
  });
  it('accepts tool with description', () => {
    expect(McpToolSchema.safeParse({
      name: 'echo', description: 'returns input', inputSchema: { type: 'object' },
    }).success).toBe(true);
  });
  it('rejects tool missing name', () => {
    expect(McpToolSchema.safeParse({ inputSchema: { type: 'object' } }).success).toBe(false);
  });
});

describe('ToolsListResultSchema', () => {
  it('parses { tools: [...] }', () => {
    const out = ToolsListResultSchema.parse({ tools: [{ name: 'echo', inputSchema: {} }] });
    expect(out.tools).toHaveLength(1);
  });
});

describe('ToolsCallResultSchema', () => {
  it('parses content array', () => {
    const out = ToolsCallResultSchema.parse({ content: [{ type: 'text', text: 'hello' }] });
    expect(out.content[0]).toEqual({ type: 'text', text: 'hello' });
  });
  it('accepts empty content', () => {
    expect(ToolsCallResultSchema.safeParse({ content: [] }).success).toBe(true);
  });
});

describe('JsonRpcResponseSchema', () => {
  it('parses success response', () => {
    expect(JsonRpcResponseSchema.safeParse({ jsonrpc: '2.0', id: 1, result: { ok: true } }).success).toBe(true);
  });
  it('parses error response', () => {
    expect(JsonRpcResponseSchema.safeParse({
      jsonrpc: '2.0', id: 1, error: { code: -32601, message: 'method not found' },
    }).success).toBe(true);
  });
});
