import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Root of material skills: ${libraryDir}/skills */
export function skillsDirFor(libraryDir: string): string {
  return path.join(libraryDir, 'skills');
}

/** Staging area for generated/manual drafts: ${libraryDir}/skills/.drafts */
export function draftsDirFor(libraryDir: string): string {
  return path.join(skillsDirFor(libraryDir), '.drafts');
}

/** Reserved home for future file-based agents: ${libraryDir}/agents */
export function agentsDirFor(libraryDir: string): string {
  return path.join(libraryDir, 'agents');
}

/**
 * Bundled default skills shipped with the app. In dev __dirname is
 * server/domain/skills; in the esbuild prod bundle (dist/server.cjs) __dirname
 * is dist/. We mirror how migrations resolve: build copies server/skills/defaults
 * to dist/skills/defaults (see package.json build). Try the dev path first, then
 * the prod path.
 */
export function defaultsDir(): string {
  // dev: server/domain/skills/ -> ../../skills/defaults = server/skills/defaults
  const devPath = path.resolve(__dirname, '..', '..', 'skills', 'defaults');
  // prod: dist/ + skills/defaults
  const prodPath = path.resolve(__dirname, 'skills', 'defaults');
  return fs.existsSync(devPath) ? devPath : prodPath;
}
