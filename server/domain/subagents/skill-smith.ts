import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { SubAgentsStore } from './subagents.store';
import { SKILL_SMITH_NAME } from './skill-smith.name';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export { SKILL_SMITH_NAME };

/**
 * The portable agent definition, shared with the exported bundle. Single source
 * of truth: `bundle/sources/agent.md` is both what Aether seeds and what
 * `bundle/skill-smith/agents/skill-smith.md` ships to Claude Code (see
 * `scripts/build-bundle.mjs`). It deliberately carries no method — that lives in
 * the `skill-smith` skill it tells the model to read.
 *
 * Resolution mirrors how migrations and default skills are found: in dev
 * __dirname is server/domain/subagents; in the esbuild prod bundle
 * (dist/server.cjs) it is dist/, and the build copies the file to
 * dist/agents/skill-smith.md.
 */
function portableAgentPath(): string {
  const devPath = path.resolve(__dirname, '..', '..', '..', 'bundle', 'sources', 'agent.md');
  const prodPath = path.resolve(__dirname, 'agents', 'skill-smith.md');
  return existsSync(devPath) ? devPath : prodPath;
}

/** Drop the leading YAML frontmatter — it addresses the host, not the model. */
function stripFrontmatter(md: string): string {
  const lines = md.split(/\r?\n/);
  if (lines[0]?.trim() !== '---') return md.trim();
  const end = lines.indexOf('---', 1);
  return end === -1 ? md.trim() : lines.slice(end + 1).join('\n').trim();
}

/**
 * What the portable agent cannot know: where Aether wants the files and how the
 * user promotes them. Appended rather than merged so the shared half stays
 * byte-identical to what the bundle ships.
 */
const AETHER_PLACEMENT = `## In Aether

- Write the new skill under \`.drafts/<slug>/\` inside the skills directory. The user's message carries the absolute path to write under. Never write outside \`.drafts/\` — a draft is inert until promoted, which is what makes it safe to generate one without asking.
- Use your filesystem tools to create the directory and its files.
- When the files are written, tell the user the draft is ready to review and promote from the Skills panel. Do not enable or promote it yourself.
- If the \`skill-smith\` skill is not enabled in this workspace, say so instead of improvising the method: ask the user to enable it, or fall back to the \`brainstorming\` skill for the design step and state plainly that the format rules are unverified.`;

/** Used only when the portable agent file is missing (stripped deployment). */
const FALLBACK = `You are skill-smith, an assistant that creates new skills with the user.

Read the \`skill-smith\` skill's SKILL.md and follow it — the method lives there, not in this prompt. Design first, one question at a time; confirm the slug before writing; run the skill's validator before handing off.`;

/** The seeded system instruction: portable agent body + Aether placement rules. */
export function skillSmithInstruction(): string {
  const file = portableAgentPath();
  const body = existsSync(file) ? stripFrontmatter(readFileSync(file, 'utf8')) : FALLBACK;
  return `${body}\n\n${AETHER_PLACEMENT}`;
}

/**
 * Idempotently ensure the default skill-smith subagent exists. Skips creation
 * if a subagent of that name is already present (preserves user edits, no
 * duplicates per boot).
 */
export async function seedSkillSmith(store: SubAgentsStore): Promise<void> {
  const existing = await store.list();
  if (existing.some((s) => s.name === SKILL_SMITH_NAME)) return;
  await store.create({
    name: SKILL_SMITH_NAME,
    systemInstruction: skillSmithInstruction(),
    skills: [],
    tools: [],
  });
}
