import { colorFor } from '@/src/lib/git-swimlanes';
import type { LaneModel } from '@/src/lib/git-swimlanes';

interface GitLaneLegendProps {
  model: LaneModel;
}

const NO_REF = '(no branch ref)';
const NO_REF_HINT =
  'commits not reachable from any branch tip (e.g. a merged & deleted branch, or beyond the loaded window)';

export function GitLaneLegend({ model }: GitLaneLegendProps) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-border-subtle bg-surface-2 px-3 py-1.5">
      {model.laneNames.map((name) => {
        const noRef = name === NO_REF;
        return (
          <span
            key={name}
            className="flex items-center gap-1.5 text-[10px] font-mono"
            title={noRef ? NO_REF_HINT : undefined}
          >
            <span
              aria-hidden="true"
              className="inline-block h-2.5 w-2.5 rounded-sm"
              style={{ background: colorFor(name) }}
            />
            <span className={noRef ? 'text-zinc-500' : 'text-zinc-300'}>
              {name}
            </span>
          </span>
        );
      })}
    </div>
  );
}
