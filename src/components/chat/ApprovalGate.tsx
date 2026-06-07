import { useEffect, useRef, useState } from 'react';
import { Clock } from 'lucide-react';
import { Modal } from '@/src/components/ui/Modal';
import { Button } from '@/src/components/ui/Button';
import { useUiStore } from '@/src/stores/ui.store';
import { useChatStore } from '@/src/stores/chat.store';
import { breakpointsApi } from '@/src/lib/api/breakpoints.api';
import { mcpApi } from '@/src/lib/api/mcp.api';
import { DiffView } from './DiffView';
import { UnifiedDiff } from '@/src/components/git/UnifiedDiff';
import { t } from '@/src/i18n/t';
import type { ToolCategory } from '@/src/types/breakpoints.types';

const BADGE_CLASS: Record<ToolCategory, string> = {
  safe: 'bg-status-online/15 text-status-online border-status-online/50',
  dangerous: 'bg-status-error/15 text-status-error border-status-error/50',
  external: 'bg-status-connecting/15 text-status-connecting border-status-connecting/50',
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
    await mcpApi.decide(event.callId, action).catch(() => {});
    closeApprovalGate();
  };

  return (
    <Modal
      open={true}
      onClose={() => void decide('reject')}
      dismissOnBackdrop={false}
      className="max-w-[640px] glass"
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

      {preview.kind === 'gitDiff' && (
        <div className="mb-3">
          <div className="text-zinc-500 text-[10px] font-mono mb-1 uppercase tracking-wider">
            {preview.title}
          </div>
          <div className="bg-zinc-950 border border-border-subtle rounded max-h-60 overflow-auto">
            <UnifiedDiff unified={preview.unified} />
          </div>
        </div>
      )}

      {preview.kind === 'commitList' && (
        <div className="mb-3">
          <div className="text-zinc-500 text-[10px] font-mono mb-1 uppercase tracking-wider">
            {preview.title}
          </div>
          <ul className="bg-zinc-950 border border-border-subtle rounded max-h-60 overflow-auto p-2 font-mono text-[11px] text-zinc-300">
            {preview.commits.length === 0 ? (
              <li className="text-zinc-600">(no commits)</li>
            ) : (
              preview.commits.map((c, i) => (
                <li key={i} className="truncate">{c}</li>
              ))
            )}
          </ul>
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
