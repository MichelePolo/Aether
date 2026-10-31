import { existsSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { ValidationError, NotFoundError } from '@/server/lib/errors';
import { moveDirSync } from '@/server/lib/move-dir';
import { discoverMaterialDirs, discoverDraftDirs } from './discovery';
import { skillsDirFor, draftsDirFor } from './skills.paths';
import { parseFrontmatter } from './frontmatter';
import type { SkillStateStore } from './skill-state.store';
import type { MaterialSkill, DraftSkill, SkillsList, PromptMaterialSkill } from './skills.types';

export class SkillsService {
  private readonly skillsDir: string;
  private readonly draftsDir: string;

  constructor(
    private readonly state: SkillStateStore,
    libraryDir: string,
  ) {
    this.skillsDir = skillsDirFor(libraryDir);
    this.draftsDir = draftsDirFor(libraryDir);
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

  /**
   * The raw SKILL.md of a skill (or of a draft), for the in-app editor. A skill
   * directory without SKILL.md reads as '' so the editor can create it.
   */
  readContent(slug: string, opts: { draft?: boolean } = {}): string {
    const file = path.join(this.existingDir(slug, opts.draft), 'SKILL.md');
    return existsSync(file) ? readFileSync(file, 'utf8') : '';
  }

  /**
   * Replace a skill's SKILL.md. The content must pass the same checks as
   * discovery (frontmatter `name` and `description`, `name` equal to the
   * directory), so the editor can never turn a valid skill into an invalid one.
   * Written to a temp file then renamed: a crash never leaves half a file.
   */
  writeContent(slug: string, content: string, opts: { draft?: boolean } = {}): void {
    const dir = this.existingDir(slug, opts.draft);
    const fm = parseFrontmatter(content);
    if (!fm.name || !fm.description) {
      throw new ValidationError('SKILL.md frontmatter must set name and description');
    }
    if (fm.name !== slug) {
      throw new ValidationError(`Frontmatter name "${fm.name}" must match directory name "${slug}"`);
    }
    const file = path.join(dir, 'SKILL.md');
    const tmp = path.join(dir, `.SKILL.md.${process.pid}.${Date.now()}.tmp`);
    writeFileSync(tmp, content, 'utf8');
    try {
      renameSync(tmp, file);
    } catch (err) {
      rmSync(tmp, { force: true });
      throw err;
    }
  }

  /** Directory of an existing skill or draft, with the slug confined to its parent. */
  private existingDir(slug: string, draft = false): string {
    const parent = draft ? path.join(this.skillsDir, '.drafts') : this.skillsDir;
    this.assertContainedSlug(slug, parent);
    const dir = path.join(parent, slug);
    if (!existsSync(dir)) throw new NotFoundError(`${draft ? 'draft' : 'skill'} ${slug}`);
    return dir;
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
   * i.e. a direct child of the skills dir (or of `parent`). Dot-names are
   * refused too: `.drafts` is not a skill.
   */
  private assertContainedSlug(slug: string, parent: string = this.skillsDir): void {
    const resolved = path.resolve(parent, slug);
    if (slug.startsWith('.') || path.dirname(resolved) !== path.resolve(parent)) {
      throw new ValidationError(`Invalid skill slug "${slug}"`);
    }
  }
}
