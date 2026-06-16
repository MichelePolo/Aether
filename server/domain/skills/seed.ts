import { existsSync, mkdirSync, readdirSync, cpSync } from 'node:fs';
import path from 'node:path';

/**
 * Copy bundled default skills into the data dir's skills folder. Idempotent and
 * non-destructive: a default is copied only when no directory of the same slug
 * already exists (user edits and removals are preserved). No-op when the
 * defaults dir is absent (e.g. a stripped deployment).
 */
export function seedDefaultSkills(defaultsDir: string, skillsDir: string): void {
  if (!existsSync(defaultsDir)) return;
  mkdirSync(skillsDir, { recursive: true });
  for (const entry of readdirSync(defaultsDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const dest = path.join(skillsDir, entry.name);
    if (existsSync(dest)) continue;
    cpSync(path.join(defaultsDir, entry.name), dest, { recursive: true });
  }
}
