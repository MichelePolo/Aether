import { describe, it, expect } from 'vitest';
import { assemble } from './prompt-assembler';
import type { AetherContext } from '@/server/domain/context/context.types';
import type { SubAgentRecord } from '@/server/domain/subagents/subagents.types';
import type { ProviderToolDecl } from './providers/provider.types';

const ctx: AetherContext = {
  systemInstruction: 'Base.',
  skills: [{ name: 'core', enabled: true }],
  tools: [{ id: 't1', name: 'tool1', version: '1', status: 'online' }],
  mcpServers: [],
};

const sub: SubAgentRecord = {
  name: 'designer',
  systemInstruction: 'Design.',
  skills: ['design', 'core'], // subagent skills remain string[]
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
    expect(out.systemInstruction).toContain('Base.');
    expect(out.systemInstruction).toContain('# Active Skills');
    expect(out.systemInstruction).toContain('- core');
    expect(out.skills).toEqual(['core']);
    expect(out.tools).toEqual(ctx.tools);
    expect(out.message).toBe('hello');
    expect(out.subAgent).toBeNull();
    expect(out.mcpTools).toEqual([]);
  });

  it('concatenates system instructions with header', () => {
    const out = assemble(ctx, sub, 'hello', 'designer');
    // The skills block is appended after the sub-agent block
    expect(out.systemInstruction).toContain('Base.\n\n# Sub-agent: designer\n\nDesign.');
  });

  it('dedups skills, context wins ordering', () => {
    const out = assemble(ctx, sub, 'hello', 'designer');
    // ctx has enabled 'core'; sub has ['design','core']; deduped = ['core','design']
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
    expect(out.systemInstruction).toContain('# Sub-agent: designer\n\nDesign.');
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

describe('assemble active skills block', () => {
  function ctxWith(skills: { name: string; enabled: boolean }[]): AetherContext {
    return { systemInstruction: 'BASE', skills, tools: [], mcpServers: [] };
  }

  it('injects only enabled skills into the system instruction', () => {
    const out = assemble(
      ctxWith([
        { name: 'web-search', enabled: true },
        { name: 'disabled-one', enabled: false },
      ]),
      null,
      'hi',
      null,
      [],
    );
    expect(out.systemInstruction).toContain('# Active Skills');
    expect(out.systemInstruction).toContain('- web-search');
    expect(out.systemInstruction).not.toContain('disabled-one');
    expect(out.skills).toEqual(['web-search']);
  });

  it('adds no block when no skill is enabled', () => {
    const out = assemble(ctxWith([{ name: 'x', enabled: false }]), null, 'hi', null, []);
    expect(out.systemInstruction).not.toContain('# Active Skills');
    expect(out.skills).toEqual([]);
  });
});
