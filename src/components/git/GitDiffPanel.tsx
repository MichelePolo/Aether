import { useEffect, useState } from 'react';
import { Loader2, X } from 'lucide-react';
import { cn } from '@/src/lib/cn';
import { gitApi } from '@/src/lib/api/git.api';
import { classifyDiffLine } from '@/src/lib/git-swimlanes';
import type { DiffRequest } from '@/src/lib/git-swimlanes';
import { useGitStore } from '@/src/stores/git.store';

interface GitDiffPanelProps {
  req: DiffRequest;
  onClose(): void;
}

type State =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; unified: string };

const LINE_CLASS: Record<ReturnType<typeof classifyDiffLine>, string> = {
  add: 'text-status-online bg-status-online/10',
  del: 'text-status-error bg-status-error/10',
  hunk: 'text-sky-400 bg-sky-500/10',
  meta: 'text-zinc-500',
  ctx: 'text-zinc-400',
};

export function GitDiffPanel({ req, onClose }: GitDiffPanelProps) {
  const workspaceId = useGitStore((s) => s.activeWorkspaceId);
  const [state, setState] = useState<State>({ kind: 'loading' });

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  useEffect(() => {
    let cancelled = false;
    if (!workspaceId) {
      setState({ kind: 'error', message: 'No active workspace.' });
      return;
    }
    setState({ kind: 'loading' });
    gitApi
      .diff({ ...req, workspaceId })
      .then((res) => {
        if (!cancelled) setState({ kind: 'ready', unified: res.unified });
      })
      .catch((e: unknown) => {
        if (!cancelled)
          setState({
            kind: 'error',
            message: e instanceof Error ? e.message : 'Failed to load diff',
          });
      });
    return () => {
      cancelled = true;
    };
  }, [req, workspaceId]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-6"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-label={`Diff for ${req.path}`}
        className="glass flex max-h-[80vh] w-full max-w-3xl flex-col overflow-hidden rounded-lg border border-border-default"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 border-b border-border-subtle px-3 py-2">
          <span className="min-w-0 flex-1 truncate font-mono text-[12px] text-zinc-300">
            {req.path}
          </span>
          <span className="shrink-0 font-mono text-[11px] text-zinc-500">
            {req.hash.slice(0, 7)}
          </span>
          <button
            type="button"
            aria-label="Close diff"
            onClick={onClose}
            className="shrink-0 text-zinc-500 hover:text-white"
          >
            <X size={16} aria-hidden="true" />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-auto">
          {state.kind === 'loading' && (
            <div className="flex items-center gap-2 p-4 text-[12px] text-zinc-500">
              <Loader2 size={14} className="animate-spin" aria-hidden="true" />
              Loading diff…
            </div>
          )}
          {state.kind === 'error' && (
            <div className="p-4 text-[12px] text-status-error">
              {state.message}
            </div>
          )}
          {state.kind === 'ready' && (
            <pre className="overflow-auto whitespace-pre p-0 font-mono text-[11px]">
              {state.unified.split('\n').map((line, i) => {
                const kind = classifyDiffLine(line);
                return (
                  <div
                    key={i}
                    data-diff={kind}
                    className={cn('px-3', LINE_CLASS[kind])}
                  >
                    {line || ' '}
                  </div>
                );
              })}
            </pre>
          )}
        </div>
      </div>
    </div>
  );
}
