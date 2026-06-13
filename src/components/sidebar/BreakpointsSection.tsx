import { useBreakpointsStore } from '@/src/stores/breakpoints.store';
import { useChatStore } from '@/src/stores/chat.store';
import type { ToolCategory, CategoryMode } from '@/src/types/breakpoints.types';
import { Tooltip } from '@/src/components/ui/Tooltip';
import { cn } from '@/src/lib/cn';
import { t } from '@/src/i18n/t';

const ROWS: { category: ToolCategory; label: string }[] = [
  { category: 'safe', label: 'Safe' },
  { category: 'dangerous', label: 'Dangerous' },
  { category: 'external', label: 'External' },
];

const MODES: CategoryMode[] = ['auto', 'gate'];

export function BreakpointsSection() {
  const policy = useBreakpointsStore((s) => s.policy);
  const setCategoryMode = useBreakpointsStore((s) => s.setCategoryMode);
  const stickyApprovals = useChatStore((s) => s.stickyApprovals);
  const removeStickyApproval = useChatStore((s) => s.removeStickyApproval);
  const clearStickyApprovals = useChatStore((s) => s.clearStickyApprovals);
  const stickyNames = [...stickyApprovals].sort();

  return (
    <section>
      <div className="flex items-center gap-2 mb-2">
        <span className="mono-label">{t('breakpoints.heading')}</span>
        <Tooltip label={t('breakpoints.helpText')}>
          <button
            type="button"
            aria-label="What are breakpoints?"
            className="text-zinc-600 hover:text-zinc-300 text-[10px]"
          >
            ?
          </button>
        </Tooltip>
      </div>
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
              <div
                role="radiogroup"
                aria-label={`${label} mode`}
                className="inline-flex border border-border-subtle rounded overflow-hidden"
              >
                {MODES.map((m) => (
                  <button
                    key={m}
                    type="button"
                    role="radio"
                    aria-checked={mode === m}
                    onClick={() => mode !== m && void setCategoryMode(category, m)}
                    className={cn(
                      'px-2 py-0.5',
                      mode === m
                        ? 'bg-manipulation/20 text-manipulation'
                        : 'bg-surface-1 text-zinc-500 hover:text-zinc-300',
                    )}
                  >
                    {m}
                  </button>
                ))}
              </div>
            </div>
          );
        })}
      </div>
      <div className="mt-4">
        <div className="flex items-center gap-2 mb-2">
          <span className="mono-label">{t('breakpoints.sessionApprovals.heading')}</span>
          <span className="text-[10px] text-zinc-600">[{stickyNames.length}]</span>
          <Tooltip label={t('breakpoints.sessionApprovals.help')}>
            <button
              type="button"
              aria-label="What are session approvals?"
              className="text-zinc-600 hover:text-zinc-300 text-[10px]"
            >
              ?
            </button>
          </Tooltip>
        </div>
        {stickyNames.length === 0 ? (
          <div className="text-[10px] text-zinc-600 font-mono italic">
            {t('breakpoints.sessionApprovals.empty')}
          </div>
        ) : (
          <div className="space-y-1">
            {stickyNames.map((name) => (
              <div
                key={name}
                data-testid="session-approval-row"
                className="flex items-center gap-2 p-1.5 bg-zinc-900 border border-border-subtle rounded text-[10px] font-mono"
              >
                <span className="text-zinc-300 flex-1 truncate">{name}</span>
                <button
                  type="button"
                  aria-label={`Revoke ${name}`}
                  onClick={() => removeStickyApproval(name)}
                  className="text-zinc-500 hover:text-status-error"
                >
                  ×
                </button>
              </div>
            ))}
            <button
              type="button"
              onClick={() => clearStickyApprovals()}
              className="w-full p-1 border border-dashed border-border-subtle rounded text-[10px] text-zinc-600 hover:text-zinc-400 transition-colors mt-2"
            >
              {t('breakpoints.sessionApprovals.clearAll')}
            </button>
          </div>
        )}
      </div>
    </section>
  );
}
