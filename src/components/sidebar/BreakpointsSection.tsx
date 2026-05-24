import { useBreakpointsStore } from '@/src/stores/breakpoints.store';
import type { ToolCategory } from '@/src/types/breakpoints.types';
import { cn } from '@/src/lib/cn';

const ROWS: { category: ToolCategory; label: string }[] = [
  { category: 'safe', label: 'Safe' },
  { category: 'dangerous', label: 'Dangerous' },
  { category: 'external', label: 'External' },
];

export function BreakpointsSection() {
  const policy = useBreakpointsStore((s) => s.policy);
  const setCategoryMode = useBreakpointsStore((s) => s.setCategoryMode);

  return (
    <section>
      <div className="mono-label mb-2">Breakpoints</div>
      <div className="space-y-1">
        {ROWS.map(({ category, label }) => {
          const mode = policy[category];
          return (
            <div
              key={category}
              data-testid="breakpoint-row"
              className="flex items-center gap-2 p-1.5 bg-zinc-900 border border-border-subtle rounded text-[10px] font-mono"
            >
              <span className="text-zinc-300 flex-1">{label}</span>
              <span className="text-zinc-500">{mode}</span>
              <button
                type="button"
                aria-label={`Toggle ${label} mode`}
                onClick={() => void setCategoryMode(category, mode === 'auto' ? 'gate' : 'auto')}
                className={cn(
                  'px-2 py-0.5 rounded text-[10px] border',
                  mode === 'auto'
                    ? 'bg-accent/20 text-accent border-accent/40'
                    : 'bg-surface-1 text-zinc-500 border-border-subtle hover:text-zinc-300',
                )}
              >
                {mode === 'auto' ? 'auto' : 'gate'}
              </button>
            </div>
          );
        })}
      </div>
    </section>
  );
}
