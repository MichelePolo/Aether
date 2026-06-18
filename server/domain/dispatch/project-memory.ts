import { readFileSync, statSync } from 'node:fs';
import path from 'node:path';

/** Canonical project-memory filename, read from the workspace root. */
export const ETERE_FILENAME = 'ETERE.md';

/** Hard cap on injected project memory; it competes with the task for tokens. */
export const PROJECT_MEMORY_CAP_BYTES = 32 * 1024;

/**
 * Read <root>/ETERE.md for injection into the system instruction. Returns null
 * when there is no root, the file is absent/unreadable, or it is empty/whitespace.
 * Content over the cap is truncated to PROJECT_MEMORY_CAP_BYTES with a notice.
 */
export function readProjectMemory(root: string | null): string | null {
  if (!root) return null;
  const file = path.join(root, ETERE_FILENAME);
  let raw: string;
  try {
    if (!statSync(file).isFile()) return null;
    raw = readFileSync(file, 'utf8');
  } catch {
    return null;
  }
  if (raw.trim().length === 0) return null;
  if (Buffer.byteLength(raw, 'utf8') <= PROJECT_MEMORY_CAP_BYTES) return raw;
  const truncated = Buffer.from(raw, 'utf8')
    .subarray(0, PROJECT_MEMORY_CAP_BYTES)
    .toString('utf8');
  return `${truncated}\n\n[ETERE.md truncated: exceeded ${PROJECT_MEMORY_CAP_BYTES} bytes]`;
}
