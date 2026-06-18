import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { parseFrontmatter } from '@/server/domain/skills/frontmatter';

describe('init default skill', () => {
  const md = readFileSync(path.join(__dirname, 'SKILL.md'), 'utf8');

  it('has valid frontmatter with name "init"', () => {
    const fm = parseFrontmatter(md);
    expect(fm.name).toBe('init');
    expect(fm.description && fm.description.length).toBeGreaterThan(20);
  });

  it('targets ETERE.md and stays provider-agnostic', () => {
    expect(md).toContain('ETERE.md');
    expect(md.toLowerCase()).not.toContain('claude');
    expect(md.toLowerCase()).not.toContain('anthropic');
  });

  it('documents the FIFO-5 version window and the runtime-facts copy rule', () => {
    expect(md).toContain('5');
    expect(md).toContain('Storico versioni');
    expect(md).toMatch(/Current time|Active model|Runtime/);
  });
});
