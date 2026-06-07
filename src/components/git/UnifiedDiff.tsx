import { cn } from '@/src/lib/cn';
import { classifyDiffLine } from '@/src/lib/git-swimlanes';

const LINE_CLASS: Record<ReturnType<typeof classifyDiffLine>, string> = {
  add: 'text-status-online bg-status-online/10',
  del: 'text-status-error bg-status-error/10',
  hunk: 'text-sky-400 bg-sky-500/10',
  meta: 'text-zinc-500',
  ctx: 'text-zinc-400',
};

export function UnifiedDiff({ unified }: { unified: string }) {
  return (
    <pre className="overflow-auto whitespace-pre p-0 font-mono text-[11px]">
      {unified.split('\n').map((line, i) => {
        const kind = classifyDiffLine(line);
        return (
          <div key={i} data-diff={kind} className={cn('px-3', LINE_CLASS[kind])}>
            {line || ' '}
          </div>
        );
      })}
    </pre>
  );
}
