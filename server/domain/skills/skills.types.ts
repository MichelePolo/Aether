/** A skill backed by a directory with a SKILL.md under the skills dir. */
export interface MaterialSkill {
  /** Slug = directory name = `name:` in SKILL.md frontmatter. */
  name: string;
  enabled: boolean;
  pinned: boolean;
  /** From frontmatter; undefined when the dir is invalid. */
  description?: string;
  /** Set when the directory is NOT a valid skill; human-readable reason. */
  invalid?: string;
}

/** A directory sitting in `.drafts/` awaiting review/promote. */
export interface DraftSkill {
  name: string;
  description?: string;
  invalid?: string;
}

/** Row shape of the `skill_state` table. */
export interface SkillStateRow {
  slug: string;
  enabled: boolean;
  pinned: boolean;
}

/** Response of GET /api/skills (material skills only; label skills stay in context). */
export interface SkillsList {
  skills: MaterialSkill[];
  drafts: DraftSkill[];
  paths: { skillsDir: string; draftsDir: string };
}

/** What DispatchService hands to the prompt assembler for an enabled material skill. */
export interface PromptMaterialSkill {
  name: string;
  description: string;
  pinned: boolean;
  /** Absolute path to the skill directory, used in the read-from-disk note. */
  dir: string;
  /** Full SKILL.md content; present only when pinned (inlined). */
  body?: string;
}
