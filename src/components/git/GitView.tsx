import { useUiStore } from '@/src/stores/ui.store';
import { cn } from '@/src/lib/cn';
import { GitSwimlanesView } from './GitSwimlanesView';
import { ChangesView } from './ChangesView';

const TABS: { id: 'history' | 'changes'; label: string }[] = [
  { id: 'history', label: 'History' },
  { id: 'changes', label: 'Changes' },
];

export function GitView() {
  const gitTab = useUiStore((s) => s.gitTab);
  const setGitTab = useUiStore((s) => s.setGitTab);

  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 items-center gap-1 border-b border-border-subtle bg-surface-2 px-3">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={gitTab === t.id}
            onClick={() => setGitTab(t.id)}
            className={cn(
              'px-3 py-2 text-xs font-mono uppercase tracking-widest border-b-2 -mb-px',
              gitTab === t.id
                ? 'border-disclosure text-disclosure'
                : 'border-transparent text-zinc-500 hover:text-zinc-300',
            )}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div className="min-h-0 flex-1">
        {gitTab === 'changes' ? <ChangesView /> : <GitSwimlanesView />}
      </div>
    </div>
  );
}
