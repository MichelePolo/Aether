import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { SkillsService } from './skills.service';
import { SkillStateStore } from './skill-state.store';
import { makeTestDb } from '@/server/test/test-db';
import type { DatabaseHandle } from '@/server/db/database';

function makeSkill(root: string, slug: string, description: string): void {
  const dir = path.join(root, slug);
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, 'SKILL.md'), `---\nname: ${slug}\ndescription: ${description}\n---\n# ${slug}`);
}

let db: DatabaseHandle;
let dataDir: string;
let skillsDir: string;
let service: SkillsService;

beforeEach(() => {
  db = makeTestDb();
  dataDir = mkdtempSync(path.join(tmpdir(), 'data-'));
  skillsDir = path.join(dataDir, 'skills');
  mkdirSync(skillsDir, { recursive: true });
  service = new SkillsService(new SkillStateStore(db), dataDir);
});
afterEach(() => {
  db.close();
  rmSync(dataDir, { recursive: true, force: true });
});

describe('SkillsService.list', () => {
  it('merges discovered skills with their stored state (default disabled)', () => {
    makeSkill(skillsDir, 'alpha', 'First');
    const { skills } = service.list();
    expect(skills).toEqual([
      { name: 'alpha', enabled: false, pinned: false, description: 'First', invalid: undefined },
    ]);
  });

  it('reflects enabled/pinned state', () => {
    makeSkill(skillsDir, 'alpha', 'First');
    service.setEnabled('alpha', true);
    service.setPinned('alpha', true);
    expect(service.list().skills[0]).toMatchObject({ name: 'alpha', enabled: true, pinned: true });
  });

  it('includes invalid skills but never marks them enabled', () => {
    mkdirSync(path.join(skillsDir, 'broken'));
    const [s] = service.list().skills;
    expect(s.invalid).toBeTruthy();
    expect(s.enabled).toBe(false);
  });

  it('lists drafts from .drafts', () => {
    makeSkill(path.join(skillsDir, '.drafts'), 'wip', 'Work');
    expect(service.list().drafts).toEqual([{ name: 'wip', description: 'Work', invalid: undefined }]);
  });
});

describe('SkillsService.getActiveForPrompt', () => {
  it('returns only enabled + valid skills with absolute dir', () => {
    makeSkill(skillsDir, 'alpha', 'First');
    makeSkill(skillsDir, 'beta', 'Second');
    service.setEnabled('alpha', true);
    const active = service.getActiveForPrompt();
    expect(active).toEqual([
      { name: 'alpha', description: 'First', pinned: false, dir: path.join(skillsDir, 'alpha'), body: undefined },
    ]);
  });

  it('includes the SKILL.md body only when pinned', () => {
    makeSkill(skillsDir, 'alpha', 'First');
    service.setEnabled('alpha', true);
    service.setPinned('alpha', true);
    const [a] = service.getActiveForPrompt();
    expect(a.body).toContain('# alpha');
  });
});

describe('SkillsService.promote', () => {
  it('moves a draft into the skills dir (disabled)', () => {
    makeSkill(path.join(skillsDir, '.drafts'), 'wip', 'Work');
    service.promote('wip');
    expect(service.list().skills.map((s) => s.name)).toContain('wip');
    expect(service.list().drafts).toEqual([]);
  });

  it('throws when a skill with the same slug already exists', () => {
    makeSkill(skillsDir, 'wip', 'Existing');
    makeSkill(path.join(skillsDir, '.drafts'), 'wip', 'Draft');
    expect(() => service.promote('wip')).toThrow(/exists/i);
  });

  it('throws when the draft is invalid', () => {
    mkdirSync(path.join(skillsDir, '.drafts', 'bad'), { recursive: true });
    expect(() => service.promote('bad')).toThrow(/invalid/i);
  });
});

describe('SkillsService.remove', () => {
  it('deletes the directory and the state row', () => {
    makeSkill(skillsDir, 'alpha', 'First');
    service.setEnabled('alpha', true);
    service.remove('alpha');
    expect(service.list().skills).toEqual([]);
  });
});
