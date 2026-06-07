import { ChevronDown, ChevronRight } from 'lucide-react';
import { cn } from '@/src/lib/cn';
import { colorFor, detectPR, LAYOUT, panelHeight } from '@/src/lib/git-swimlanes';
import type { CommitNode, FileChange } from '@/src/lib/git-swimlanes';
import { GitFileRow } from './GitFileRow';
import { t } from '@/src/i18n/t';

interface GitCommitRowProps {
  commit: CommitNode;
  expanded: boolean;
  onToggle(): void;
  onFileSelect(file: FileChange): void;
}

export function GitCommitRow({
  commit,
  expanded,
  onToggle,
  onFileSelect,
}: GitCommitRowProps) {
  const pr = detectPR(commit.subject);

  return (
    <div data-hash={commit.hash} className="border-b border-border-subtle/50">
      <button
        type="button"
        aria-expanded={expanded}
        aria-label={t('git.toggleCommit', { hash: commit.hash.slice(0, 7) })}
        onClick={onToggle}
        className={cn(
          'crow flex w-full cursor-pointer select-none items-center gap-2 px-2 text-left',
          'text-[12px] font-mono hover:bg-surface-3',
        )}
        style={{ height: LAYOUT.rowH, minHeight: LAYOUT.rowH }}
      >
        <span aria-hidden="true" className="shrink-0 text-zinc-500">
          {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </span>

        <span className="shrink-0 text-zinc-500">{commit.hash.slice(0, 7)}</span>

        {pr && (
          <span className="shrink-0 rounded bg-disclosure/10 px-1 py-px text-[10px] text-disclosure">
            {t('git.prBadge', { id: pr.id })}
          </span>
        )}

        {commit.branches.map((b) => (
          <span
            key={`b-${b}`}
            className="shrink-0 rounded border px-1 py-px text-[10px]"
            style={{ color: colorFor(b), borderColor: colorFor(b) }}
          >
            {b}
          </span>
        ))}

        {commit.tags.map((t) => (
          <span
            key={`t-${t}`}
            className="shrink-0 rounded bg-manipulation/10 px-1 py-px text-[10px] text-manipulation"
          >
            {t}
          </span>
        ))}

        <span className="min-w-0 flex-1 truncate text-zinc-300">
          {commit.subject}
        </span>

        <span className="shrink-0 text-[10px] text-zinc-500">
          {commit.files.length}{' '}
          {commit.files.length === 1
            ? t('git.fileCountSingular')
            : t('git.fileCountPlural')}
        </span>

        <span className="shrink-0 max-w-[120px] truncate text-zinc-500">
          {commit.author}
        </span>
      </button>

      {expanded && (
        <div
          className="overflow-y-auto bg-zinc-950/40 py-2"
          style={{ maxHeight: panelHeight(commit) }}
        >
          {commit.files.length === 0 ? (
            <div className="px-2 text-[11px] text-zinc-500">
              {t('git.noFileChanges')}
            </div>
          ) : (
            commit.files.map((f, i) => (
              <GitFileRow
                key={`${f.path}-${i}`}
                file={f}
                onSelect={() => onFileSelect(f)}
              />
            ))
          )}
        </div>
      )}
    </div>
  );
}
