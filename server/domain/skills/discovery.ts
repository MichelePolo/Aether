import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { parseFrontmatter } from './frontmatter';

export interface DiscoveredSkill {
  name: string;
  description?: string;
  invalid?: string;
}

/** Validate one directory as a skill, returning a DiscoveredSkill. */
function inspect(dir: string, slug: string): DiscoveredSkill {
  const skillMd = path.join(dir, 'SKILL.md');
  if (!existsSync(skillMd)) {
    return { name: slug, invalid: 'Missing SKILL.md' };
  }
  const fm = parseFrontmatter(readFileSync(skillMd, 'utf8'));
  if (!fm.name || !fm.description) {
    return { name: slug, invalid: 'SKILL.md frontmatter must set name and description' };
  }
  if (fm.name !== slug) {
    return { name: slug, invalid: `Frontmatter name "${fm.name}" must match directory name "${slug}"` };
  }
  return { name: slug, description: fm.description, invalid: undefined };
}

/** List immediate subdirectories of `parent`, excluding dot-directories. */
function subdirs(parent: string): string[] {
  if (!existsSync(parent)) return [];
  return readdirSync(parent, { withFileTypes: true })
    .filter((e) => e.isDirectory() && !e.name.startsWith('.'))
    .map((e) => e.name)
    .sort();
}

/** Discover material skills under the skills dir (dot-dirs like .drafts excluded). */
export function discoverMaterialDirs(skillsDir: string): DiscoveredSkill[] {
  return subdirs(skillsDir).map((slug) => inspect(path.join(skillsDir, slug), slug));
}

/** Discover draft skills under skillsDir/.drafts. */
export function discoverDraftDirs(skillsDir: string): DiscoveredSkill[] {
  const drafts = path.join(skillsDir, '.drafts');
  return subdirs(drafts).map((slug) => inspect(path.join(drafts, slug), slug));
}
