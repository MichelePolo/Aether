import { describe, it, expect } from 'vitest';
import {
  ToolSchema,
  McpServerSchema,
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
