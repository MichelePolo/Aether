import { cpSync, renameSync, rmSync } from 'node:fs';

// renameSync fails when an atomic rename isn't possible. Fall back to copy+remove for:
// - EXDEV: src and dest are on different volumes (rename(2) can't cross devices).
// - EPERM/EACCES/EBUSY: Windows denies MoveFileEx while a handle is open on the
//   directory (a file watcher like Vite in dev, antivirus, or the OS indexer) —
//   even though the same directory CAN be deleted (share-delete), which is why
//   copy+remove succeeds where rename does not.
// - ENOTEMPTY: a non-empty destination (shouldn't happen — callers check first).
const FALLBACK_CODES = new Set(['EXDEV', 'EPERM', 'EACCES', 'EBUSY', 'ENOTEMPTY']);

/**
 * Move a directory robustly across platforms. Tries an atomic `rename` first
 * (fast, the common case on POSIX and same-volume Windows), and on the errno
 * codes above falls back to a recursive copy followed by a recursive remove of
 * the source. `rmSync` uses retries to ride out transient Windows locks.
 *
 * `rename` is injectable so the fallback path can be tested deterministically on
 * any OS.
 */
export function moveDirSync(
  src: string,
  dest: string,
  rename: (s: string, d: string) => void = renameSync,
): void {
  try {
    rename(src, dest);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (!code || !FALLBACK_CODES.has(code)) throw err;
    cpSync(src, dest, { recursive: true });
    rmSync(src, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
}
