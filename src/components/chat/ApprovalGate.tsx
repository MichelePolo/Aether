import { useEffect, useState } from 'react';
import { useUiStore } from '@/src/stores/ui.store';
import { useChatStore } from '@/src/stores/chat.store';
import { breakpointsApi } from '@/src/lib/api/breakpoints.api';
import { mcpApi } from '@/src/lib/api/mcp.api';
import { DiffView } from './DiffView';
import type { ToolCategory } from '@/src/types/breakpoints.types';

const BADGE_CLASS: Record<ToolCategory, string> = {
  safe: 'bg-emerald-900/40 text-emerald-300 border-emerald-700',
  dangerous: 'bg-rose-900/40 text-rose-300 border-rose-700',
  external: 'bg-orange-900/40 text-orange-300 border-orange-700',
};

export function ApprovalGate() {
  const state = useUiStore((s) => s.approvalGateState);
  const closeApprovalGate = useUiStore((s) => s.closeApprovalGate);
  const addSticky = useChatStore((s) => s.addStickyApproval);
  const [category, setCategory] = useState<ToolCategory | null>(null);
  const [sticky, setSticky] = useState(false);

  useEffect(() => {
    if (!state) {
      setCategory(null);
      setSticky(false);
      return;
    }
    let cancelled = false;
    breakpointsApi
      .classify({ qualifiedName: state.event.qualifiedName, args: state.event.args })
      .then((r) => { if (!cancelled) setCategory(r.category); })
      .catch(() => { if (!cancelled) setCategory('safe'); });
    return () => { cancelled = true; };
  }, [state]);

  if (!state) return null;
  const { event, preview } = state;

  const decide = async (action: 'approve' | 'reject') => {
    if (action === 'approve' && sticky) addSticky(event.qualifiedName);
    await mcpApi.decide(event.id, action).catch(() => {});
    closeApprovalGate();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      onClick={() => void decide('reject')}
    >
      <div
        className="w-[640px] max-w-[90vw] max-h-[85vh] overflow-auto rounded border border-border-subtle bg-surface-1 p-4 text-sm"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 mb-3">
          <span className="text-zinc-300 font-mono">{event.qualifiedName}</span>
          {category && (
            <span className={`px-2 py-0.5 rounded text-[10px] font-mono border ${BADGE_CLASS[category]}`}>
              {category}
            </span>
          )}
        </div>

        <pre className="text-[11px] font-mono bg-zinc-950 border border-border-subtle rounded p-2 overflow-x-auto mb-3">
          {JSON.stringify(event.args, null, 2)}
        </pre>

        {preview.kind === 'diff' && (
          <div className="mb-3">
            <DiffView oldText={preview.oldText} newText={preview.newText} path={preview.path} />
          </div>
        )}

        <label className="flex items-center gap-2 text-zinc-400 text-[12px] mb-3 cursor-pointer">
          <input
            type="checkbox"
            checked={sticky}
            onChange={(e) => setSticky(e.target.checked)}
            aria-label="auto-approve this tool for the rest of this session"
          />
          <span>Auto-approve this tool for the rest of this session</span>
        </label>

        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={() => void decide('reject')}
            className="px-3 py-1.5 rounded border border-border-subtle text-zinc-300 hover:bg-zinc-800"
          >
            Reject
          </button>
          <button
            type="button"
            onClick={() => void decide('approve')}
            className="px-3 py-1.5 rounded bg-accent text-black font-medium hover:bg-accent/90"
          >
            Approve
          </button>
        </div>
      </div>
    </div>
  );
}
