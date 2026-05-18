import { describe, it, expect } from 'vitest';
import { ReasoningStepSchema, ReasoningStepTypeSchema } from './reasoning.schema';

describe('ReasoningStepTypeSchema', () => {
  it('accepts known types', () => {
    for (const t of ['context_fetch', 'mcp_query', 'dispatch', 'thinking', 'validation', 'logic']) {
      expect(ReasoningStepTypeSchema.parse(t)).toBe(t);
    }
  });

  it('rejects unknown type', () => {
    expect(() => ReasoningStepTypeSchema.parse('unknown')).toThrow();
  });
});

describe('ReasoningStepSchema', () => {
  it('parses minimal required fields', () => {
    const step = {
      id: 'a',
      type: 'context_fetch' as const,
      title: 'Read context',
      content: 'loaded',
      timestamp: 1,
    };
    expect(ReasoningStepSchema.parse(step)).toEqual(step);
  });

  it('accepts optional fields', () => {
    const step = {
      id: 'a',
      type: 'dispatch' as const,
      title: 'Dispatch',
      content: '',
      timestamp: 1,
      tokens: 100,
      durationMs: 50,
      subAgent: 'Coder',
    };
    expect(ReasoningStepSchema.parse(step)).toEqual(step);
  });

  it('rejects missing required fields', () => {
    expect(() => ReasoningStepSchema.parse({ id: 'a', type: 'logic' })).toThrow();
  });

  it('rejects invalid type', () => {
    expect(() =>
      ReasoningStepSchema.parse({ id: 'a', type: 'wrong', title: 't', content: 'c', timestamp: 1 }),
    ).toThrow();
  });
});
