import { existsSync, readFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { ValidationError, NotFoundError } from '@/server/lib/errors';
import { moveDirSync } from '@/server/lib/move-dir';
import { discoverMaterialDirs, discoverDraftDirs } from './discovery';
import { skillsDirFor, draftsDirFor } from './skills.paths';
import type { SkillStateStore } from './skill-state.store';
import type { MaterialSkill, DraftSkill, SkillsList, PromptMaterialSkill } from './skills.types';

export class SkillsService {
  private readonly skillsDir: string;
  private readonly draftsDir: string;

  constructor(
    private readonly state: SkillStateStore,
    dataDir: string,
  ) {
    this.skillsDir = skillsDirFor(dataDir);
    this.draftsDir = draftsDirFor(dataDir);
  }

  list(): SkillsList {
    const stateMap = this.state.readAll();
    const skills: MaterialSkill[] = discoverMaterialDirs(this.skillsDir).map((d) => {
      const st = stateMap.get(d.name);
      const valid = !d.invalid;
      return {
        name: d.name,
        description: d.description,
        invalid: d.invalid,
        enabled: valid ? (st?.enabled ?? false) : false,
        pinned: valid ? (st?.pinned ?? false) : false,
      };
    });
    const drafts: DraftSkill[] = discoverDraftDirs(this.skillsDir);
    return { skills, drafts, paths: { skillsDir: this.skillsDir, draftsDir: this.draftsDir } };
  }

  setEnabled(slug: string, enabled: boolean): void {
    this.requireValid(slug);
    this.state.setEnabled(slug, enabled);
  }

  setPinned(slug: string, pinned: boolean): void {
    this.requireValid(slug);
    this.state.setPinned(slug, pinned);
  }

  getActiveForPrompt(): PromptMaterialSkill[] {
    return this.list()
      .skills.filter((s) => s.enabled && !s.invalid)
      .map((s) => {
        const dir = path.join(this.skillsDir, s.name);
        return {
          name: s.name,
          description: s.description ?? '',
          pinned: s.pinned,
          dir,
          body: s.pinned ? readFileSync(path.join(dir, 'SKILL.md'), 'utf8') : undefined,
        };
      });
  }

  promote(slug: string): void {
    this.assertContainedSlug(slug);
    const draft = discoverDraftDirs(this.skillsDir).find((d) => d.name === slug);
    if (!draft) throw new NotFoundError(`draft ${slug}`);
    if (draft.invalid) throw new ValidationError(`Draft "${slug}" is invalid: ${draft.invalid}`);
    const dest = path.join(this.skillsDir, slug);
    if (existsSync(dest)) throw new ValidationError(`A skill named "${slug}" already exists`);
    moveDirSync(path.join(this.skillsDir, '.drafts', slug), dest);
  }

  remove(slug: string): void {
    this.assertContainedSlug(slug);
    const dir = path.join(this.skillsDir, slug);
    if (!existsSync(dir)) throw new NotFoundError(`skill ${slug}`);
    // maxRetries rides out transient Windows locks (watcher/AV/indexer), same
    // class of EPERM/EBUSY failure that motivated the robust move in promote().
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    this.state.remove(slug);
  }

  private requireValid(slug: string): void {
    const found = this.list().skills.find((s) => s.name === slug);
    if (!found) throw new NotFoundError(`skill ${slug}`);
    if (found.invalid) throw new ValidationError(`Skill "${slug}" is invalid: ${found.invalid}`);
  }

  /**
   * Reject slugs that would escape the skills dir. The `:slug` route param is
   * user-controlled and Express decodes `%2F`, so without this a slug like
   * `../../etc/foo` would let `remove`/`promote` touch paths outside the skills
   * dir (CWE-22). A valid skill slug is always a single on-disk directory name,
   * i.e. a direct child of the skills dir.
   */
  private assertContainedSlug(slug: string): void {
    const resolved = path.resolve(this.skillsDir, slug);
    if (path.dirname(resolved) !== path.resolve(this.skillsDir)) {
      throw new ValidationError(`Invalid skill slug "${slug}"`);
    }
  }
}
