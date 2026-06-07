import { useEffect, useMemo, useState } from 'react';
import { Loader2, RefreshCw } from 'lucide-react';
import { useGitStore } from '@/src/stores/git.store';
import { useSessionsStore } from '@/src/stores/sessions.store';
import {
  assignLanes,
  computeOffsets,
  LAYOUT,
  panelHeight,
} from '@/src/lib/git-swimlanes';
import type { DiffRequest, FileChange } from '@/src/lib/git-swimlanes';
import { GitGraph } from './GitGraph';
import { GitCommitRow } from './GitCommitRow';
import { GitLaneLegend } from './GitLaneLegend';
import { GitDiffPanel } from './GitDiffPanel';
import { GitEmptyState } from './GitEmptyState';
import { t } from '@/src/i18n/t';

const DEFAULT_MAX = 500;

export function GitSwimlanesView() {
  const workspaceId = useSessionsStore((s) => {
    const session = s.sessions.find((x) => x.id === s.activeSessionId);
    return session?.workspaceId;
  });

  const status = useGitStore((s) => s.status);
  const commits = useGitStore((s) => s.commits);
  const truncated = useGitStore((s) => s.truncated);
  const loading = useGitStore((s) => s.loading);
  const error = useGitStore((s) => s.error);
  const expanded = useGitStore((s) => s.expanded);
  const load = useGitStore((s) => s.load);
  const toggleExpand = useGitStore((s) => s.toggleExpand);
  const refresh = useGitStore((s) => s.refresh);

  const [maxCount, setMaxCount] = useState(DEFAULT_MAX);
  const [diffReq, setDiffReq] = useState<DiffRequest | null>(null);

  useEffect(() => {
    if (workspaceId) load(workspaceId, maxCount);
  }, [workspaceId, maxCount, load]);

  const model = useMemo(
    () => assignLanes(commits, Object.fromEntries(commits.map((c) => [c.hash, c]))),
    [commits],
  );
  const offsets = useMemo(() => computeOffsets(model, expanded), [model, expanded]);

  const handleFileSelect = (commitHash: string) => (file: FileChange) => {
    setDiffReq({ hash: commitHash, path: file.path, oldPath: file.old });
  };

  const loadMore = () => {
    // Bumping maxCount re-runs the load effect with the larger window.
    setMaxCount((m) => m * 2);
  };

  // Empty states
  if (!workspaceId) return <GitEmptyState kind="no-workspace" />;
  if (status && !status.isRepo) return <GitEmptyState kind="not-a-repo" />;

  const showEmptyRepo = status?.isRepo && commits.length === 0 && !loading;

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex items-center gap-2 border-b border-border-subtle bg-surface-2 px-3 py-2">
        <span className="text-sm font-mono text-white">{t('git.title')}</span>
        <div className="flex-1" />
        {truncated && (
          <button
            type="button"
            onClick={loadMore}
            className="rounded border border-border-subtle px-2 py-0.5 text-[11px] text-zinc-300 hover:bg-surface-3"
          >
            {t('git.loadMore')}
          </button>
        )}
        <button
          type="button"
          aria-label={t('git.refresh')}
          onClick={() => void refresh()}
          className="text-zinc-400 hover:text-white"
        >
          <RefreshCw
            size={14}
            className={loading ? 'animate-spin' : undefined}
            aria-hidden="true"
          />
        </button>
      </div>

      {error && (
        <div className="border-b border-border-subtle bg-status-error/10 px-3 py-1.5 text-[11px] text-status-error">
          {error}
        </div>
      )}

      {showEmptyRepo ? (
        <GitEmptyState kind="empty-repo" />
      ) : (
        <>
          <GitLaneLegend model={model} />

          {loading && commits.length === 0 ? (
            <div className="flex flex-1 items-center justify-center text-zinc-500">
              <Loader2 size={20} className="animate-spin" aria-hidden="true" />
            </div>
          ) : (
            <div className="flex min-h-0 flex-1 overflow-auto">
              {/* Graph column */}
              <div
                className="shrink-0 bg-surface-2/30"
                style={{ width: model.graphW }}
              >
                <GitGraph model={model} offsets={offsets} />
              </div>

              {/* Rows column */}
              <div className="min-w-0 flex-1">
                {model.commits.map((commit) => (
                  <div
                    key={commit.hash}
                    style={{
                      minHeight:
                        LAYOUT.rowH +
                        (expanded.has(commit.hash) ? panelHeight(commit) : 0),
                    }}
                  >
                    <GitCommitRow
                      commit={commit}
                      expanded={expanded.has(commit.hash)}
                      onToggle={() => toggleExpand(commit.hash)}
                      onFileSelect={handleFileSelect(commit.hash)}
                    />
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}

      {diffReq && (
        <GitDiffPanel req={diffReq} onClose={() => setDiffReq(null)} />
      )}
    </div>
  );
}
