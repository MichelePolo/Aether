import { describe, it, expect } from 'vitest';
import { assemble } from './prompt-assembler';
import type { AetherContext } from '@/server/domain/context/context.types';
import type { SubAgentRecord } from '@/server/domain/subagents/subagents.types';
import type { ProviderToolDecl } from './providers/provider.types';

const ctx: AetherContext = {
  systemInstruction: 'Base.',
  skills: ['core'],
  tools: [{ id: 't1', name: 'tool1', version: '1', status: 'online' }],
  mcpServers: [],
};

const sub: SubAgentRecord = {
  name: 'designer',
  systemInstruction: 'Design.',
  skills: ['design', 'core'],
  tools: [
    { id: 't1', name: 'tool1', version: '2', status: 'online' },
    { id: 't2', name: 'tool2', version: '1', status: 'online' },
  ],
  createdAt: 0,
  updatedAt: 0,
};

describe('assemble', () => {
  it('returns base context when subAgent is null', () => {
    const out = assemble(ctx, null, 'hello', null);
    expect(out).toEqual({
      systemInstruction: 'Base.',
      skills: ['core'],
      tools: ctx.tools,
      message: 'hello',
      subAgent: null,
      mcpTools: [],
    });
  });

  it('concatenates system instructions with header', () => {
    const out = assemble(ctx, sub, 'hello', 'designer');
    expect(out.systemInstruction).toBe('Base.\n\n# Sub-agent: designer\n\nDesign.');
  });

  it('dedups skills, context wins ordering', () => {
    const out = assemble(ctx, sub, 'hello', 'designer');
    expect(out.skills).toEqual(['core', 'design']);
  });

  it('dedups tools by id, context wins on conflict', () => {
    const out = assemble(ctx, sub, 'hello', 'designer');
    expect(out.tools).toHaveLength(2);
    expect(out.tools.find((t) => t.id === 't1')!.version).toBe('1');
    expect(out.tools.find((t) => t.id === 't2')!.version).toBe('1');
  });

  it('handles empty base systemInstruction', () => {
    const out = assemble({ ...ctx, systemInstruction: '' }, sub, 'm', 'designer');
    expect(out.systemInstruction).toBe('# Sub-agent: designer\n\nDesign.');
  });

  it('forwards parsed message + subAgent name', () => {
    const out = assemble(ctx, sub, 'parsed-msg', 'designer');
    expect(out.message).toBe('parsed-msg');
    expect(out.subAgent).toBe('designer');
  });
});

describe('assemble mcpTools (slice 7)', () => {
  it('forwards mcpTools unchanged when present', () => {
    const tools: ProviderToolDecl[] = [{
      qualifiedName: 'mock.echo',
      description: 'echo',
      schema: { type: 'object' as const },
    }];
    const out = assemble(ctx, null, 'hello', null, tools);
    expect(out.mcpTools).toEqual(tools);
  });

  it('mcpTools default to [] when omitted', () => {
    const out = assemble(ctx, null, 'hello', null);
    expect(out.mcpTools).toEqual([]);
  });
});
