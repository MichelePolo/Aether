import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { parseFrontmatter } from './frontmatter';

const SKILL_DIR = path.resolve(__dirname, '..', '..', 'skills', 'defaults', 'skill-smith');
const md = readFileSync(path.join(SKILL_DIR, 'SKILL.md'), 'utf8');

describe('skill-smith default skill', () => {
  it('has frontmatter Aether can read', () => {
    const fm = parseFrontmatter(md);
    expect(fm.name).toBe('skill-smith');
    // A folded or multi-line description would come back empty from the
    // line-based parser and the skill would be listed as invalid.
    expect(fm.description).toBeTruthy();
    expect(fm.description!.length).toBeGreaterThan(100);
    expect(fm.description!.length).toBeLessThanOrEqual(1024);
  });

  it('keeps the body inside the level-2 disclosure budget', () => {
    const body = md.split(/\r?\n/).slice(md.split(/\r?\n/).indexOf('---', 1) + 1);
    expect(body.length).toBeLessThan(500);
  });

  it('points at every reference file, so none is an orphan', () => {
    for (const file of readdirSync(path.join(SKILL_DIR, 'references'))) {
      expect(md).toContain(`references/${file}`);
    }
  });

  it('passes its own validator', () => {
    const res = spawnSync(
      process.execPath,
      [path.join(SKILL_DIR, 'scripts', 'validate-skill.mjs'), SKILL_DIR],
      { encoding: 'utf8', windowsHide: true },
    );
    expect(`${res.stdout}${res.stderr}`).not.toMatch(/^ERROR/m);
    expect(res.status).toBe(0);
  });
});
