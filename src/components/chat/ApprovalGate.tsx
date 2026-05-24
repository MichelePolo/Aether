import { useEffect, useRef, useState } from 'react';
import { Clock } from 'lucide-react';
import { Modal } from '@/src/components/ui/Modal';
import { Button } from '@/src/components/ui/Button';
import { useUiStore } from '@/src/stores/ui.store';
import { useChatStore } from '@/src/stores/chat.store';
import { breakpointsApi } from '@/src/lib/api/breakpoints.api';
import { mcpApi } from '@/src/lib/api/mcp.api';
import { DiffView } from './DiffView';
import { t } from '@/src/i18n/t';
import type { ToolCategory } from '@/src/types/breakpoints.types';

const BADGE_CLASS: Record<ToolCategory, string> = {
  safe: 'bg-emerald-900/40 text-emerald-300 border-emerald-700',
  dangerous: 'bg-rose-900/40 text-rose-300 border-rose-700',
  external: 'bg-orange-900/40 text-orange-300 border-orange-700',
};

const COUNTDOWN_SECONDS = 60;

export function ApprovalGate() {
  const state = useUiStore((s) => s.approvalGateState);
  const closeApprovalGate = useUiStore((s) => s.closeApprovalGate);
  const addSticky = useChatStore((s) => s.addStickyApproval);
  const [category, setCategory] = useState<ToolCategory | null>(null);
  const [sticky, setSticky] = useState(false);
  const [seconds, setSeconds] = useState(COUNTDOWN_SECONDS);
  const rejectRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!state) { setCategory(null); setSticky(false); setSeconds(COUNTDOWN_SECONDS); return; }
    let cancelled = false;
    breakpointsApi
      .classify({ qualifiedName: state.event.qualifiedName, args: state.event.args })
      .then((r) => { if (!cancelled) setCategory(r.category); })
      .catch(() => { if (!cancelled) setCategory('safe'); });
    return () => { cancelled = true; };
  }, [state]);

  useEffect(() => {
    if (!state) return;
    setSeconds(COUNTDOWN_SECONDS);
    const id = setInterval(() => setSeconds((s) => Math.max(0, s - 1)), 1000);
    return () => clearInterval(id);
  }, [state]);

  useEffect(() => {
    if (state) {
      // Wait a tick for the modal to open before focusing.
      const id = setTimeout(() => rejectRef.current?.focus(), 0);
      return () => clearTimeout(id);
    }
  }, [state]);

  if (!state) return null;
  const { event, preview } = state;

  const decide = async (action: 'approve' | 'reject') => {
    if (action === 'approve' && sticky) addSticky(event.qualifiedName);
    await mcpApi.decide(event.id, action).catch(() => {});
    closeApprovalGate();
  };

  return (
    <Modal
      open={true}
      onClose={() => void decide('reject')}
      dismissOnBackdrop={false}
      className="max-w-[640px]"
    >
      <div className="text-zinc-500 text-[10px] font-mono mb-2">
        {t('approvalGate.countdown', { seconds })}
      </div>
      <div className="flex items-center gap-2 mb-3">
        <span className="text-zinc-300 font-mono">{event.qualifiedName}</span>
        {category && (
          <span className={`px-2 py-0.5 rounded text-[10px] font-mono border uppercase tracking-wider ${BADGE_CLASS[category]}`}>
            {category}
          </span>
        )}
      </div>

      <pre tabIndex={0} className="text-[11px] font-mono bg-zinc-950 border border-border-subtle rounded p-2 overflow-x-auto mb-3 max-h-40">
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
          aria-label={t('approvalGate.stickyLabel')}
        />
        <Clock size={12} aria-hidden="true" className="text-zinc-500" />
        <span>{t('approvalGate.stickyLabel')}</span>
      </label>

      <div className="flex justify-end gap-2">
        <Button ref={rejectRef} variant="ghost" onClick={() => void decide('reject')}>Reject</Button>
        <Button variant="primary" onClick={() => void decide('approve')}>Approve</Button>
      </div>
    </Modal>
  );
}
