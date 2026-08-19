/**
 * The skill-smith subagent's name, isolated in its own module because the
 * frontend imports it (`src/lib/skills/createSkillFlow.ts` builds the
 * `@skill-smith` composer prefill). Keep this file free of Node builtins:
 * anything it imports ends up in the browser bundle, where `node:fs` and
 * `node:url` resolve to an empty stub and fail the Vite build.
 */
export const SKILL_SMITH_NAME = 'skill-smith';
