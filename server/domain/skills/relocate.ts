import { existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { moveDirSync } from '@/server/lib/move-dir';
import { skillsDirFor } from './skills.paths';

/**
 * One-time relocation of the skills directory from the legacy location under
 * `${dataDir}/skills` to `${libraryDir}/skills`. Runs at boot, before seeding.
 *
 * Idempotent: it only moves when the destination is absent and the legacy
 * source exists, so it fires exactly once across the app's lifetime. Returns
 * whether a move happened (for logging). `moveDirSync` handles cross-volume
 * (EXDEV) and Windows lock fallbacks.
 */
export function relocateSkillsDir(dataDir: string, libraryDir: string): boolean {
  const legacy = skillsDirFor(dataDir);
  const target = skillsDirFor(libraryDir);
  if (existsSync(target) || !existsSync(legacy)) return false;
  mkdirSync(path.dirname(target), { recursive: true });
  moveDirSync(legacy, target);
  return true;
}
