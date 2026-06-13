import { useEffect } from 'react';
import { Plus, Minus, RotateCcw, RefreshCw } from 'lucide-react';
import { useGitChangesStore } from '@/src/stores/gitChanges.store';
import { useSessionsStore } from '@/src/stores/sessions.store';
import { useDialog } from '@/src/hooks/useDialog';
import { t } from '@/src/i18n/t';
import { UnifiedDiff } from './UnifiedDiff';
import { GitEmptyState } from './GitEmptyState';
import type { WorkingFile } from '@/src/lib/git-swimlanes';

export function ChangesView() {
  const workspaceId = useSessionsStore((s) => {
    const session = s.sessions.find((x) => x.id === s.activeSessionId);
    return session?.workspaceId;
  });
  const dialog = useDialog();

  const changes = useGitChangesStore((s) => s.changes);
  const selectedPath = useGitChangesStore((s) => s.selectedPath);
  const selectedDiff = useGitChangesStore((s) => s.selectedDiff);
  const message = useGitChangesStore((s) => s.message);
  const busy = useGitChangesStore((s) => s.busy);
  const error = useGitChangesStore((s) => s.error);
  const load = useGitChangesStore((s) => s.load);
  const refresh = useGitChangesStore((s) => s.refresh);
  const select = useGitChangesStore((s) => s.select);
  const setMessage = useGitChangesStore((s) => s.setMessage);
  const stage = useGitChangesStore((s) => s.stage);
  const unstage = useGitChangesStore((s) => s.unstage);
  const discard = useGitChangesStore((s) => s.discard);
  const commit = useGitChangesStore((s) => s.commit);
  const commitAndPush = useGitChangesStore((s) => s.commitAndPush);

  useEffect(() => {
    if (workspaceId) load(workspaceId);
  }, [workspaceId, load]);

  if (!workspaceId) return <GitEmptyState kind="no-workspace" />;

  const hasStaged = (changes?.staged.length ?? 0) > 0;
  const canCommit = hasStaged && message.trim().length > 0 && !busy;

  const onDiscard = async (paths: string[]) => {
    const ok = await dialog.confirm({
      title: t('gitChanges.discardTitle'),
      message: t('gitChanges.discardMessage', { n: paths.length }),
      confirmLabel: t('gitChanges.discardConfirm'),
    });
    if (ok) void discard(paths);
  };

  const Row = ({ file, staged }: { file: WorkingFile; staged: boolean }) => (
    <div className="group flex items-center gap-1.5 px-2 py-1 hover:bg-surface-3">
      <button
        type="button"
        onClick={() => void select(file.path, staged)}
        className={`min-w-0 flex-1 truncate text-left font-mono text-[11px] ${selectedPath === file.path ? 'text-disclosure' : 'text-zinc-300'}`}
      >
        {file.oldPath ? `${file.oldPath} → ${file.path}` : file.path}
        <span className="ml-2 text-[9px] uppercase text-zinc-600">{file.status}</span>
      </button>
      {staged ? (
        <button type="button" aria-label={t('gitChanges.unstageFile', { path: file.path })} onClick={() => void unstage([file.path])} className="icon-btn opacity-0 group-hover:opacity-100">
          <Minus size={13} aria-hidden="true" />
        </button>
      ) : (
        <>
          <button type="button" aria-label={t('gitChanges.discardFile', { path: file.path })} onClick={() => void onDiscard([file.path])} className="icon-btn opacity-0 group-hover:opacity-100">
            <RotateCcw size={13} aria-hidden="true" />
          </button>
          <button type="button" aria-label={t('gitChanges.stageFile', { path: file.path })} onClick={() => void stage([file.path])} className="icon-btn opacity-0 group-hover:opacity-100">
            <Plus size={13} aria-hidden="true" />
          </button>
        </>
      )}
    </div>
  );

  const Section = ({ title, files, staged }: { title: string; files: WorkingFile[]; staged: boolean }) =>
    files.length === 0 ? null : (
      <div className="mb-2">
        <div className="mono-label px-2 py-1">{title} ({files.length})</div>
        {files.map((f) => <Row key={(staged ? 'S:' : 'U:') + f.path} file={f} staged={staged} />)}
      </div>
    );

  return (
    <div className="flex h-full">
      {/* Left: file lists + commit box */}
      <div className="flex w-80 shrink-0 flex-col border-r border-border-subtle">
        <div className="flex items-center justify-between px-2 py-1.5 border-b border-border-subtle">
          <span className="mono-label">{changes?.branch ?? '—'}</span>
          <button type="button" aria-label={t('gitChanges.refresh')} onClick={() => void refresh()} className="icon-btn">
            <RefreshCw size={13} className={busy ? 'animate-spin' : undefined} aria-hidden="true" />
          </button>
        </div>
        {error && <div className="px-2 py-1.5 text-[11px] text-status-error">{error}</div>}
        <div className="min-h-0 flex-1 overflow-y-auto">
          <Section title={t('gitChanges.sectionStaged')} files={changes?.staged ?? []} staged={true} />
          <Section title={t('gitChanges.sectionChanges')} files={changes?.unstaged ?? []} staged={false} />
          <Section title={t('gitChanges.sectionUntracked')} files={changes?.untracked ?? []} staged={false} />
          {(changes?.conflicted.length ?? 0) > 0 && (
            <div className="mb-2">
              <div className="mono-label px-2 py-1 text-status-error">{t('gitChanges.sectionConflicts')} ({changes!.conflicted.length})</div>
              {changes!.conflicted.map((f) => (
                <div key={'C:' + f.path} className="px-2 py-1 font-mono text-[11px] text-status-error">{f.path}</div>
              ))}
            </div>
          )}
        </div>
        <div className="shrink-0 border-t border-border-subtle p-2">
          <textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder={t('gitChanges.commitMessage')}
            aria-label={t('gitChanges.commitMessage')}
            className="mb-2 w-full resize-none rounded border border-border-subtle bg-surface-0 p-2 text-[12px] text-zinc-200"
            rows={3}
          />
          <div className="flex gap-2">
            <button type="button" disabled={!canCommit} onClick={() => void commit()} className="flex-1 rounded bg-manipulation/20 px-2 py-1 text-[11px] font-bold uppercase tracking-widest text-manipulation disabled:opacity-40">
              {t('gitChanges.commit')}
            </button>
            <button type="button" disabled={!canCommit} onClick={() => void commitAndPush()} className="flex-1 rounded border border-border-subtle px-2 py-1 text-[11px] uppercase tracking-widest text-zinc-300 disabled:opacity-40 hover:bg-surface-3">
              {t('gitChanges.commitAndPush')}
            </button>
          </div>
        </div>
      </div>
      {/* Right: selected file diff */}
      <div className="min-w-0 flex-1 overflow-auto">
        {selectedDiff !== null ? (
          <UnifiedDiff unified={selectedDiff} />
        ) : (
          <div className="flex h-full items-center justify-center text-[12px] text-zinc-600">
            {t('gitChanges.selectFile')}
          </div>
        )}
      </div>
    </div>
  );
}
