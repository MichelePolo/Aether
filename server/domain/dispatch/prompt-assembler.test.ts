import { describe, it, expect } from 'vitest';
import { assemble, withRuntimeContext, formatAvailableWorkspaces } from './prompt-assembler';
import type { AetherContext } from '@/server/domain/context/context.types';
import type { SubAgentRecord } from '@/server/domain/subagents/subagents.types';
import type { ProviderToolDecl } from './providers/provider.types';
import type { PromptMaterialSkill } from '@/server/domain/skills/skills.types';

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

const baseCtx: AetherContext = {
  systemInstruction: 'You are Aether.',
  skills: [{ name: 'legacy-a', enabled: true }, { name: 'legacy-off', enabled: false }],
  tools: [],
  mcpServers: [],
};

describe('assemble — runtime context injection', () => {
  it('injects runtime facts and project memory before Active Skills', () => {
    const out = assemble(
      ctx, null, 'hi', null, [], [],
      {
        facts: 'Current time (UTC): 2026-06-18T00:00:00Z\nActive model: fake:fake-1',
        projectMemory: '# ETERE.md — demo\nNotes.',
      },
    );
    const s = out.systemInstruction;
    expect(s).toContain('# Runtime');
    expect(s).toContain('Active model: fake:fake-1');
    expect(s).toContain('# Project memory (ETERE.md)');
    expect(s).toContain('Notes.');
    // ordering: base < runtime < project memory < skills
    expect(s.indexOf('Base.')).toBeLessThan(s.indexOf('# Runtime'));
    expect(s.indexOf('# Runtime')).toBeLessThan(s.indexOf('# Project memory (ETERE.md)'));
    expect(s.indexOf('# Project memory (ETERE.md)')).toBeLessThan(s.indexOf('# Active Skills'));
  });

  it('omits runtime/project-memory sections when not provided', () => {
    const out = assemble(ctx, null, 'hi', null);
    expect(out.systemInstruction).not.toContain('# Runtime');
    expect(out.systemInstruction).not.toContain('# Project memory (ETERE.md)');
  });

  it('injects runtime context in the sub-agent branch too', () => {
    const out = assemble(
      ctx, sub, 'hi', 'designer', [], [],
      { facts: 'Active model: fake:fake-1', projectMemory: '# ETERE.md\nNotes.' },
    );
    const s = out.systemInstruction;
    expect(s).toContain('# Sub-agent: designer');
    expect(s.indexOf('# Sub-agent: designer')).toBeLessThan(s.indexOf('# Project memory (ETERE.md)'));
    expect(s.indexOf('# Project memory (ETERE.md)')).toBeLessThan(s.indexOf('# Active Skills'));
  });

  it('withRuntimeContext appends only the provided blocks', () => {
    expect(withRuntimeContext('Base.')).toBe('Base.');
    expect(withRuntimeContext('Base.', { facts: 'F' })).toBe('Base.\n\n# Runtime\nF');
    expect(withRuntimeContext('Base.', { projectMemory: 'M' })).toBe('Base.\n\n# Project memory (ETERE.md)\nM');
  });
});

describe('formatAvailableWorkspaces', () => {
  it('lists the current workspace first, marked, then the rest in order', () => {
    const body = formatAvailableWorkspaces(['/a', '/b', '/c'], '/b');
    expect(body).toBe('- /b -> current\n- /a\n- /c');
  });

  it('keeps the given order when the current is already first', () => {
    const body = formatAvailableWorkspaces(['/a', '/b'], '/a');
    expect(body).toBe('- /a -> current\n- /b');
  });

  it('lists workspaces without a marker when there is no current', () => {
    const body = formatAvailableWorkspaces(['/a', '/b'], null);
    expect(body).toBe('- /a\n- /b');
  });

  it('does not mark a current root that is not a registered workspace', () => {
    // A filesystem-fallback root (not a registered workspace) is not a
    // switchable workspace, so it is neither listed nor tagged `-> current`.
    const body = formatAvailableWorkspaces(['/a', '/b'], '/elsewhere');
    expect(body).toBe('- /a\n- /b');
  });

  it('treats an empty-string current root as no current', () => {
    expect(formatAvailableWorkspaces(['/a'], '')).toBe('- /a');
  });

  it('dedups repeated paths, keeping the current marked once', () => {
    const body = formatAvailableWorkspaces(['/a', '/b', '/a'], '/a');
    expect(body).toBe('- /a -> current\n- /b');
  });

  it('returns an empty string when there are no workspaces and no current', () => {
    expect(formatAvailableWorkspaces([], null)).toBe('');
  });
});

describe('withRuntimeContext — availableWorkspaces block', () => {
  it('appends a # availableWorkspaces block after the runtime facts', () => {
    const out = withRuntimeContext('Base.', { facts: 'F', availableWorkspaces: '- /a -> current\n- /b' });
    expect(out).toBe('Base.\n\n# Runtime\nF\n\n# availableWorkspaces\n- /a -> current\n- /b');
  });

  it('omits the block when no workspaces body is provided', () => {
    expect(withRuntimeContext('Base.', { facts: 'F' })).toBe('Base.\n\n# Runtime\nF');
  });
});

describe('assemble — availableWorkspaces injection', () => {
  it('injects the workspaces block between Runtime and Project memory', () => {
    const out = assemble(
      ctx, null, 'hi', null, [], [],
      {
        facts: 'Active model: fake:fake-1',
        projectMemory: '# ETERE.md\nNotes.',
        availableWorkspaces: '- /ws/current -> current\n- /ws/other',
      },
    );
    const s = out.systemInstruction;
    expect(s).toContain('# availableWorkspaces');
    expect(s).toContain('- /ws/current -> current');
    expect(s.indexOf('# Runtime')).toBeLessThan(s.indexOf('# availableWorkspaces'));
    expect(s.indexOf('# availableWorkspaces')).toBeLessThan(s.indexOf('# Project memory (ETERE.md)'));
  });

  it('injects the workspaces block in the sub-agent branch too', () => {
    const out = assemble(
      ctx, sub, 'hi', 'designer', [], [],
      { facts: 'Active model: fake:fake-1', availableWorkspaces: '- /ws/current -> current' },
    );
    expect(out.systemInstruction).toContain('# availableWorkspaces');
    expect(out.systemInstruction).toContain('- /ws/current -> current');
  });
});

describe('assemble — hybrid skills', () => {
  it('renders only enabled label skills when no material skills (unchanged behavior)', () => {
    const out = assemble(baseCtx, null, 'hi', null);
    expect(out.systemInstruction).toContain('# Active Skills');
    expect(out.systemInstruction).toContain('- legacy-a');
    expect(out.systemInstruction).not.toContain('legacy-off');
  });

  it('renders a non-pinned material skill as name: description plus a read-from-disk note', () => {
    const material: PromptMaterialSkill[] = [
      { name: 'pdf', description: 'Work with PDFs', pinned: false, dir: '/data/skills/pdf', body: undefined },
    ];
    const out = assemble(baseCtx, null, 'hi', null, [], material);
    expect(out.systemInstruction).toContain('- pdf: Work with PDFs');
    expect(out.systemInstruction).toContain('/data/skills/pdf/SKILL.md');
    expect(out.systemInstruction).not.toContain('## Skill: pdf');
  });

  it('inlines the full SKILL.md body for a pinned material skill', () => {
    const material: PromptMaterialSkill[] = [
      { name: 'pdf', description: 'Work with PDFs', pinned: true, dir: '/data/skills/pdf', body: '# PDF\nUse pdfplumber.' },
    ];
    const out = assemble(baseCtx, null, 'hi', null, [], material);
    expect(out.systemInstruction).toContain('## Skill: pdf');
    expect(out.systemInstruction).toContain('Use pdfplumber.');
  });

  it('includes material skill names in the returned skills array', () => {
    const material: PromptMaterialSkill[] = [
      { name: 'pdf', description: 'd', pinned: false, dir: '/d/pdf', body: undefined },
    ];
    const out = assemble(baseCtx, null, 'hi', null, [], material);
    expect(out.skills).toEqual(['legacy-a', 'pdf']);
  });
});
