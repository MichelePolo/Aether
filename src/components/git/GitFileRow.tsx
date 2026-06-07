import { cn } from '@/src/lib/cn';
import type { FileChange } from '@/src/lib/git-swimlanes';
import { t } from '@/src/i18n/t';

interface GitFileRowProps {
  file: FileChange;
  onSelect(): void;
}

function describe(file: FileChange): { label: string; color: string } {
  const code = file.code;
  if (code === 'A') return { label: t('git.fileStatus.added'), color: '#5fc77f' };
  if (code === 'M')
    return { label: t('git.fileStatus.modified'), color: '#e8b04b' };
  if (code === 'D')
    return { label: t('git.fileStatus.deleted'), color: '#e06c75' };
  if (code[0] === 'R')
    return { label: t('git.fileStatus.renamed'), color: '#b48ead' };
  if (code[0] === 'C')
    return { label: t('git.fileStatus.copied'), color: '#56b6c2' };
  if (code === 'T')
    return { label: t('git.fileStatus.typechange'), color: '#8a96a8' };
  return { label: code, color: '#8a96a8' };
}

export function GitFileRow({ file, onSelect }: GitFileRowProps) {
  const { label, color } = describe(file);
  const renamedOrCopied = file.code[0] === 'R' || file.code[0] === 'C';

  return (
    <button
      type="button"
      data-path={file.path}
      aria-label={t('git.viewDiff', { path: file.path, label })}
      onClick={(e) => {
        e.stopPropagation();
        onSelect();
      }}
      className={cn(
        'frow group flex w-full items-center gap-2 px-2 py-0.5 text-left text-[11px] font-mono',
        'rounded hover:bg-surface-3',
      )}
    >
      <span
        aria-hidden="true"
        className="inline-flex w-4 shrink-0 justify-center font-semibold"
        style={{ color }}
        title={label}
      >
        {file.code[0]}
      </span>
      <span className="min-w-0 flex-1 truncate text-zinc-300">
        {renamedOrCopied && file.old ? (
          <>
            <span className="text-zinc-500">{file.old}</span>
            <span className="text-zinc-600"> → </span>
            {file.path}
          </>
        ) : (
          file.path
        )}
      </span>
      <span className="shrink-0 text-zinc-500 opacity-0 group-hover:opacity-100">
        {t('git.diffAffordance')}
      </span>
    </button>
  );
}
