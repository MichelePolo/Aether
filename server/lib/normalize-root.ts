import path from 'node:path';

/**
 * Normalize a directory path into a stable key for the builtin-server pool and
 * a canonical allowed-dir. Resolves to an absolute path; case-folds on Windows
 * (a case-insensitive filesystem) so `C:\Proj` and `c:/proj` map to one entry.
 */
export function normalizeRoot(p: string): string {
  const resolved = path.resolve(p);
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}
