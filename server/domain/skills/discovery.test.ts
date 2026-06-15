import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { discoverMaterialDirs, discoverDraftDirs } from './discovery';

function makeSkill(root: string, slug: string, frontmatter: string | null): void {
  const dir = path.join(root, slug);
  mkdirSync(dir, { recursive: true });
  if (frontmatter !== null) writeFileSync(path.join(dir, 'SKILL.md'), frontmatter);
}

let root: string;
beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), 'skills-'));
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('discoverMaterialDirs', () => {
  it('returns [] when the skills dir does not exist', () => {
    expect(discoverMaterialDirs(path.join(root, 'nope'))).toEqual([]);
  });

  it('discovers a valid skill with name+description', () => {
    makeSkill(root, 'alpha', '---\nname: alpha\ndescription: First\n---\n# A');
    expect(discoverMaterialDirs(root)).toEqual([
      { name: 'alpha', description: 'First', invalid: undefined },
    ]);
  });

  it('marks a dir without SKILL.md invalid', () => {
    mkdirSync(path.join(root, 'beta'));
    const [s] = discoverMaterialDirs(root);
    expect(s.name).toBe('beta');
    expect(s.invalid).toMatch(/SKILL\.md/);
  });

  it('marks a dir invalid when frontmatter lacks name or description', () => {
    makeSkill(root, 'gamma', '---\nname: gamma\n---\n');
    const [s] = discoverMaterialDirs(root);
    expect(s.invalid).toMatch(/description/);
  });

  it('marks a dir invalid when frontmatter name != directory name', () => {
    makeSkill(root, 'delta', '---\nname: wrong\ndescription: d\n---\n');
    const [s] = discoverMaterialDirs(root);
    expect(s.invalid).toMatch(/match/);
  });

  it('skips dot-directories (e.g. .drafts) and files', () => {
    makeSkill(root, '.drafts', null);
    writeFileSync(path.join(root, 'README.md'), 'x');
    makeSkill(root, 'eps', '---\nname: eps\ndescription: e\n---\n');
    expect(discoverMaterialDirs(root).map((s) => s.name)).toEqual(['eps']);
  });

  it('sorts results by name', () => {
    makeSkill(root, 'zeta', '---\nname: zeta\ndescription: z\n---\n');
    makeSkill(root, 'alpha', '---\nname: alpha\ndescription: a\n---\n');
    expect(discoverMaterialDirs(root).map((s) => s.name)).toEqual(['alpha', 'zeta']);
  });
});

describe('discoverDraftDirs', () => {
  it('returns [] when .drafts does not exist', () => {
    expect(discoverDraftDirs(root)).toEqual([]);
  });

  it('discovers draft directories under .drafts', () => {
    const drafts = path.join(root, '.drafts');
    makeSkill(drafts, 'wip', '---\nname: wip\ndescription: W\n---\n');
    expect(discoverDraftDirs(root)).toEqual([
      { name: 'wip', description: 'W', invalid: undefined },
    ]);
  });
});
