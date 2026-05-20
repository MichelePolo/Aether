import { describe, it, expect } from 'vitest';
import {
  ToolSchema,
  McpServerSchema,
  McpServerConfigSchema,
  AetherContextSchema,
  AetherContextPatchSchema,
} from './context.schema';

describe('context schemas', () => {
  it('Tool parses valid input', () => {
    const t = { id: '1', name: 'GoogleSearch', version: '1.2.0', status: 'online' as const };
    expect(ToolSchema.parse(t)).toEqual(t);
  });

  it('Tool rejects invalid status', () => {
    expect(() =>
      ToolSchema.parse({ id: '1', name: 'X', version: '1', status: 'busy' }),
    ).toThrow();
  });

  it('McpServer parses with valid status', () => {
    const s = { id: 'a', name: 'srv', url: 'http://x', status: 'connecting' as const };
    expect(McpServerSchema.parse(s)).toEqual(s);
  });

  it('AetherContext rejects skills with non-string items', () => {
    expect(() =>
      AetherContextSchema.parse({
        systemInstruction: 'x',
        skills: [1, 2],
        tools: [],
        mcpServers: [],
      }),
    ).toThrow();
  });

  it('AetherContext accepts empty arrays', () => {
    const ctx = { systemInstruction: '', skills: [], tools: [], mcpServers: [] };
    expect(AetherContextSchema.parse(ctx)).toEqual(ctx);
  });

  it('AetherContextPatch makes all fields optional', () => {
    expect(AetherContextPatchSchema.parse({})).toEqual({});
    expect(AetherContextPatchSchema.parse({ skills: ['a'] })).toEqual({ skills: ['a'] });
  });

  it('AetherContextPatch rejects unknown fields', () => {
    expect(() => AetherContextPatchSchema.parse({ badField: 1 })).toThrow();
  });
});

describe('McpServerConfig schema (slice-7)', () => {
  it('accepts a stdio config with command + args', () => {
    const cfg = {
      id: 'a', name: 'fs', transport: 'stdio',
      command: 'npx', args: ['@modelcontextprotocol/server-filesystem', '/tmp'],
      env: {}, status: 'offline',
    };
    expect(McpServerConfigSchema.safeParse(cfg).success).toBe(true);
  });

  it('accepts a mock config without command', () => {
    expect(McpServerConfigSchema.safeParse({
      id: 'm', name: 'mock', transport: 'mock', status: 'offline',
    }).success).toBe(true);
  });

  it('rejects stdio config missing command', () => {
    expect(McpServerConfigSchema.safeParse({
      id: 'a', name: 'fs', transport: 'stdio', status: 'offline',
    }).success).toBe(false);
  });

  it('defaults transport to stdio when omitted (legacy compat)', () => {
    const parsed = McpServerConfigSchema.parse({
      id: 'a', name: 'old', command: 'echo', status: 'offline',
    });
    expect(parsed.transport).toBe('stdio');
  });

  it('accepts toolPolicies map', () => {
    expect(McpServerConfigSchema.safeParse({
      id: 'a', name: 'mock', transport: 'mock', status: 'offline',
      toolPolicies: { echo: { autoApprove: true } },
    }).success).toBe(true);
  });

  it('accepts http transport with url', () => {
    expect(McpServerConfigSchema.safeParse({
      id: 'h', name: 'remote', transport: 'http', url: 'https://api.example.com/mcp',
      status: 'offline',
    }).success).toBe(true);
  });

  it('rejects http transport without url', () => {
    expect(McpServerConfigSchema.safeParse({
      id: 'h', name: 'remote', transport: 'http', status: 'offline',
    }).success).toBe(false);
  });
});

describe('McpServerSchema (loose stored shape)', () => {
  it('accepts http transport entry', () => {
    expect(McpServerSchema.safeParse({
      id: 'h', name: 'remote', transport: 'http', url: 'https://api.example.com/mcp',
      status: 'offline',
    }).success).toBe(true);
  });
});
