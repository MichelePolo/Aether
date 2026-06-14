import type { WorkingChanges, WorkingFile, WorkingFileStatus } from './types';

const STATUS_MAP: Record<string, WorkingFileStatus> = {
  M: 'modified', A: 'added', D: 'deleted', T: 'typechange', R: 'renamed', C: 'copied',
};
function mapStatus(c: string): WorkingFileStatus {
  return STATUS_MAP[c] ?? 'modified';
}

/** Parse `git status --porcelain=v2 --branch` output into a structured WorkingChanges. */
export function parseStatusPorcelain(text: string): WorkingChanges {
  const out: WorkingChanges = { staged: [], unstaged: [], untracked: [], conflicted: [] };

  for (const raw of text.replace(/\r/g, '').split('\n')) {
    if (!raw) continue;

    if (raw.startsWith('# branch.head ')) {
      const h = raw.slice('# branch.head '.length).trim();
      if (h && h !== '(detached)') out.branch = h;
      continue;
    }
    if (raw.startsWith('# branch.ab ')) {
      const m = raw.match(/\+(\d+)\s+-(\d+)/);
      if (m) { out.ahead = parseInt(m[1], 10); out.behind = parseInt(m[2], 10); }
      continue;
    }
    if (raw.startsWith('# ')) continue;

    if (raw.startsWith('? ')) {
      out.untracked.push({ path: raw.slice(2), status: 'untracked' });
      continue;
    }
    if (raw.startsWith('! ')) continue; // ignored entries

    // Ordinary changed entry: 1 <XY> <sub> <mH> <mI> <mW> <hH> <hI> <path>
    let m = raw.match(/^1 (..) \S+ \S+ \S+ \S+ \S+ \S+ (.+)$/);
    if (m) {
      pushXY(out, m[1], m[2], undefined);
      continue;
    }
    // Rename/copy entry: 2 <XY> ... <Xscore> <path>\t<origPath>
    m = raw.match(/^2 (..) \S+ \S+ \S+ \S+ \S+ \S+ \S+ (.+)$/);
    if (m) {
      const tab = m[2].indexOf('\t');
      const path = tab >= 0 ? m[2].slice(0, tab) : m[2];
      const oldPath = tab >= 0 ? m[2].slice(tab + 1) : undefined;
      pushXY(out, m[1], path, oldPath);
      continue;
    }
    // Unmerged (conflict): u <XY> ... <path>
    m = raw.match(/^u .. \S+ \S+ \S+ \S+ \S+ \S+ \S+ \S+ (.+)$/);
    if (m) {
      out.conflicted.push({ path: m[1], status: 'conflicted' });
      continue;
    }
  }

  return out;
}

function pushXY(out: WorkingChanges, xy: string, path: string, oldPath: string | undefined): void {
  const file = (c: string): WorkingFile => (oldPath ? { path, oldPath, status: mapStatus(c) } : { path, status: mapStatus(c) });
  const X = xy[0];
  const Y = xy[1];
  if (X !== '.') out.staged.push(file(X));
  if (Y !== '.') out.unstaged.push(file(Y));
}
