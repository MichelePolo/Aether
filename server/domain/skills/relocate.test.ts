import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { relocateSkillsDir } from './relocate';

function tmp(): string {
  return mkdtempSync(path.join(os.tmpdir(), 'aether-reloc-'));
}

describe('relocateSkillsDir', () => {
  it('moves ${dataDir}/skills to ${libraryDir}/skills on first boot', () => {
    const data = tmp();
    const lib = tmp();
    mkdirSync(path.join(data, 'skills', 'my-skill'), { recursive: true });
    writeFileSync(path.join(data, 'skills', 'my-skill', 'SKILL.md'), '# mine');

    const moved = relocateSkillsDir(data, lib);

    expect(moved).toBe(true);
    expect(existsSync(path.join(data, 'skills'))).toBe(false);
    expect(readFileSync(path.join(lib, 'skills', 'my-skill', 'SKILL.md'), 'utf8')).toBe('# mine');
    rmSync(data, { recursive: true, force: true });
    rmSync(lib, { recursive: true, force: true });
  });

  it('is a no-op when ${dataDir}/skills does not exist', () => {
    const data = tmp();
    const lib = tmp();
    expect(relocateSkillsDir(data, lib)).toBe(false);
    expect(existsSync(path.join(lib, 'skills'))).toBe(false);
    rmSync(data, { recursive: true, force: true });
    rmSync(lib, { recursive: true, force: true });
  });

  it('is a no-op when ${libraryDir}/skills already exists (idempotent second boot)', () => {
    const data = tmp();
    const lib = tmp();
    mkdirSync(path.join(data, 'skills'), { recursive: true });
    mkdirSync(path.join(lib, 'skills'), { recursive: true });
    expect(relocateSkillsDir(data, lib)).toBe(false);
    // source left untouched because destination already exists
    expect(existsSync(path.join(data, 'skills'))).toBe(true);
    rmSync(data, { recursive: true, force: true });
    rmSync(lib, { recursive: true, force: true });
  });
});
