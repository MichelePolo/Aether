import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(__dirname, '..', '..', '..');
const BUNDLE = path.join(ROOT, 'bundle', 'skill-smith');
const BUNDLED_SKILL = path.join(BUNDLE, 'skills', 'skill-smith');

const run = (args: string[]) =>
  spawnSync(process.execPath, args, { cwd: ROOT, encoding: 'utf8', windowsHide: true });

describe('exported skill-smith bundle', () => {
  it('is in sync with its sources', () => {
    const res = run([path.join(ROOT, 'scripts', 'build-bundle.mjs'), '--check']);
    expect(`${res.stdout}${res.stderr}`).not.toMatch(/stale|missing|orphaned/);
    expect(res.status).toBe(0);
  });

  it('ships a skill that passes the validator', () => {
    const res = run([path.join(BUNDLED_SKILL, 'scripts', 'validate-skill.mjs'), BUNDLED_SKILL]);
    expect(res.status).toBe(0);
  });

  it('declares a Claude Code plugin manifest named skill-smith', () => {
    const manifest = JSON.parse(
      readFileSync(path.join(BUNDLE, '.claude-plugin', 'plugin.json'), 'utf8'),
    );
    expect(manifest.name).toBe('skill-smith');
    expect(manifest.description.length).toBeGreaterThan(40);
  });

  it('ships the agent Aether seeds, byte for byte', () => {
    const shipped = readFileSync(path.join(BUNDLE, 'agents', 'skill-smith.md'));
    const source = readFileSync(path.join(ROOT, 'bundle', 'sources', 'agent.md'));
    expect(shipped.equals(source)).toBe(true);
    expect(shipped.toString()).toMatch(/^---\nname: skill-smith\n/);
  });

  it('carries the Codex harness config inside the skill directory', () => {
    const yaml = readFileSync(path.join(BUNDLED_SKILL, 'agents', 'openai.yaml'), 'utf8');
    expect(yaml).toContain('display_name: "Skill Smith"');
    expect(yaml).toContain('allow_implicit_invocation: true');
  });
});
