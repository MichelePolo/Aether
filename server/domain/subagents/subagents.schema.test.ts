import { describe, it, expect } from 'vitest';
import { SubAgentNameSchema, SubAgentRecordSchema, SubAgentCreateInputSchema } from './subagents.schema';

describe('SubAgentNameSchema', () => {
  it.each([
    'designer',
    'd',
    'Designer',
    'design-3r',
    'design_er',
    'A1B2',
    'a'.repeat(64),
  ])('accepts %s', (name) => {
    expect(SubAgentNameSchema.safeParse(name).success).toBe(true);
  });

  it.each([
    '',
    ' designer',
    '1designer',
    '-designer',
    'design er',
    'design@er',
    'a'.repeat(65),
  ])('rejects %s', (name) => {
    expect(SubAgentNameSchema.safeParse(name).success).toBe(false);
  });
});

describe('SubAgentRecordSchema', () => {
  const valid = {
    name: 'designer',
    systemInstruction: 'You design.',
    skills: ['layout', 'color'],
    tools: [{ id: 't1', name: 'figma', version: '1.0.0', status: 'online' as const }],
    createdAt: 1,
    updatedAt: 2,
  };

  it('accepts a valid record', () => {
    expect(SubAgentRecordSchema.safeParse(valid).success).toBe(true);
  });

  it('rejects when systemInstruction is over 8000 chars', () => {
    expect(
      SubAgentRecordSchema.safeParse({ ...valid, systemInstruction: 'x'.repeat(8001) }).success,
    ).toBe(false);
  });
});

describe('SubAgentCreateInputSchema', () => {
  it('applies defaults for optional fields', () => {
    const parsed = SubAgentCreateInputSchema.parse({ name: 'designer' });
    expect(parsed).toEqual({
      name: 'designer',
      systemInstruction: '',
      skills: [],
      tools: [],
    });
  });
});
