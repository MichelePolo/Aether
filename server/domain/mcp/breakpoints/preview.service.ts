import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { runGit } from '@/server/domain/git/git.runner';
import type { PreviewResult } from './breakpoints.types';

const MAX_PREVIEW_BYTES = 1024 * 1024;
const WRITE_TOOL_PATTERN = /\.(write|edit|create)_/i;
const GIT_DIFF_PREVIEW_PATTERN = /^[^.]+\.git_(add|commit|restore)$/i;
const GIT_REMOTE_PREVIEW_PATTERN = /^[^.]+\.git_(push|pull|merge)$/i;
const SAFE_REF = /^[\w./-]+$/;

export interface PreviewServiceDeps {
  safeRoots: () => string[];
  gitRoot: () => string | null;
}

export class PreviewService {
  constructor(private readonly deps: PreviewServiceDeps) {}

  async previewToolCall(input: {
    qualifiedName: string;
    args: Record<string, unknown>;
  }): Promise<PreviewResult> {
    if (GIT_REMOTE_PREVIEW_PATTERN.test(input.qualifiedName)) {
      return this.remotePreview(input.qualifiedName, input.args);
    }

    if (GIT_DIFF_PREVIEW_PATTERN.test(input.qualifiedName)) {
      return this.gitPreview(input.qualifiedName, input.args);
    }

    if (!WRITE_TOOL_PATTERN.test(input.qualifiedName)) return { kind: 'plain' };

    const rawPath = input.args.path;
    if (typeof rawPath !== 'string' || rawPath.length === 0) return { kind: 'plain' };
    const rawContent = input.args.content;
    const newText = typeof rawContent === 'string' ? rawContent : '';

    const abs = path.resolve(rawPath);
    const roots = this.deps.safeRoots().map((r) => path.resolve(r));
    const inside = roots.some((r) => abs === r || abs.startsWith(r + path.sep));
    if (!inside) return { kind: 'plain' };

    let oldText = '';
    try {
      const s = await stat(abs);
      if (!s.isFile()) return { kind: 'plain' };
      if (s.size > MAX_PREVIEW_BYTES) return { kind: 'plain' };
      oldText = await readFile(abs, 'utf8');
    } catch (e: unknown) {
      const code = (e as { code?: string }).code;
      if (code === 'ENOENT') {
        oldText = '';
      } else {
        return { kind: 'plain' };
      }
    }

    if (newText.length > MAX_PREVIEW_BYTES) return { kind: 'plain' };

    return { kind: 'diff', oldText, newText, path: abs };
  }

  private async gitPreview(
    qualifiedName: string,
    args: Record<string, unknown>,
  ): Promise<PreviewResult> {
    const root = this.deps.gitRoot();
    if (!root) return { kind: 'plain' };
    const tool = qualifiedName.split('.')[1];
    const paths = Array.isArray(args.paths)
      ? args.paths.filter((p): p is string => typeof p === 'string' && !p.startsWith('-'))
      : [];

    let diffArgs: string[];
    let title: string;
    if (tool === 'git_commit') {
      diffArgs = ['diff', '--cached'];
      title = 'Commit preview (staged changes)';
    } else if (tool === 'git_add') {
      diffArgs = ['diff', '--', ...paths];
      title = 'Will be staged';
    } else if (tool === 'git_restore') {
      diffArgs =
        args.staged === true ? ['diff', '--cached', '--', ...paths] : ['diff', '--', ...paths];
      title = 'Changes that will be DISCARDED';
    } else {
      return { kind: 'plain' };
    }

    try {
      const { stdout } = await runGit(diffArgs, root);
      return { kind: 'gitDiff', unified: stdout, title };
    } catch {
      return { kind: 'plain' };
    }
  }

  private async remotePreview(
    qualifiedName: string,
    args: Record<string, unknown>,
  ): Promise<PreviewResult> {
    const root = this.deps.gitRoot();
    if (!root) return { kind: 'plain' };
    const tool = qualifiedName.split('.')[1];
    const remote = typeof args.remote === 'string' && SAFE_REF.test(args.remote) ? args.remote : 'origin';

    try {
      const branchRes = await runGit(['rev-parse', '--abbrev-ref', 'HEAD'], root);
      const branch = branchRes.stdout.trim();
      if (!branch || branch === 'HEAD') return { kind: 'plain' };

      if (tool === 'git_push') {
        const { stdout, code } = await runGit(
          ['log', `${remote}/${branch}..HEAD`, '--oneline', '--no-color'],
          root,
        );
        if (code !== 0) return { kind: 'plain' };
        const commits = stdout.split('\n').map((s) => s.trim()).filter(Boolean);
        return { kind: 'commitList', title: `Push ${commits.length} commit(s) → ${remote}/${branch}`, commits };
      }

      // git_pull / git_merge → incoming commits we don't yet have.
      const ref =
        tool === 'git_merge'
          ? (typeof args.ref === 'string' && SAFE_REF.test(args.ref) ? args.ref : null)
          : `${remote}/${branch}`;
      if (!ref) return { kind: 'plain' };
      const { stdout, code } = await runGit(['log', `HEAD..${ref}`, '--oneline', '--no-color'], root);
      if (code !== 0) return { kind: 'plain' };
      const commits = stdout.split('\n').map((s) => s.trim()).filter(Boolean);
      return { kind: 'commitList', title: `Will merge ${commits.length} commit(s) from ${ref}`, commits };
    } catch {
      return { kind: 'plain' };
    }
  }
}
