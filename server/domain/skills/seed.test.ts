import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { seedDefaultSkills } from './seed';

let defaults: string;
let skillsDir: string;

beforeEach(() => {
  const base = mkdtempSync(path.join(tmpdir(), 'seed-'));
  defaults = path.join(base, 'defaults');
  skillsDir = path.join(base, 'skills');
  mkdirSync(path.join(defaults, 'brainstorming'), { recursive: true });
  writeFileSync(path.join(defaults, 'brainstorming', 'SKILL.md'), '---\nname: brainstorming\ndescription: d\n---\n');
});
afterEach(() => {
  rmSync(path.dirname(defaults), { recursive: true, force: true });
});

describe('seedDefaultSkills', () => {
  it('copies default skills into an empty skills dir', () => {
    seedDefaultSkills(defaults, skillsDir);
    expect(existsSync(path.join(skillsDir, 'brainstorming', 'SKILL.md'))).toBe(true);
  });

  it('does NOT overwrite an existing skill of the same slug', () => {
    mkdirSync(path.join(skillsDir, 'brainstorming'), { recursive: true });
    writeFileSync(path.join(skillsDir, 'brainstorming', 'SKILL.md'), 'USER EDIT');
    seedDefaultSkills(defaults, skillsDir);
    expect(readFileSync(path.join(skillsDir, 'brainstorming', 'SKILL.md'), 'utf8')).toBe('USER EDIT');
  });

  it('is a no-op (no throw) when the defaults dir is missing', () => {
    expect(() => seedDefaultSkills(path.join(defaults, 'nope'), skillsDir)).not.toThrow();
  });
});
