import { useState } from 'react';
import { Play, Pencil, Trash2 } from 'lucide-react';
import { useSchedulesStore } from '@/src/stores/schedules.store';
import { ScheduleEditModal } from '@/src/components/schedules/ScheduleEditModal';
import { t } from '@/src/i18n/t';
import type { Cadence } from '@/src/lib/api/schedules.api';

function cadenceSummary(c: Cadence): string {
  return c.kind === 'cron'
    ? c.expr
    : t('schedules.cadenceSummary', { n: Math.round(c.everyMs / 60_000) });
}

export function SchedulesSection() {
  const list = useSchedulesStore((s) => s.list);
  const remove = useSchedulesStore((s) => s.remove);
  const runNow = useSchedulesStore((s) => s.runNow);
  const [editing, setEditing] = useState<string | 'new' | null>(null);

  return (
    <section>
      <div className="flex items-center justify-between mb-2">
        <div className="mono-label">{t('schedules.title')}</div>
        <button type="button" className="text-[10px] text-manipulation hover:underline" onClick={() => setEditing('new')}>
          {t('schedules.newButton')}
        </button>
      </div>
      <div className="space-y-1">
        {list.map((s) => (
          <div key={s.id} className="flex items-center gap-1.5 p-1.5 bg-zinc-900 border border-border-subtle rounded text-[10px] font-mono">
            <span className={`status-dot ${s.enabled ? 'bg-status-online' : 'bg-zinc-600'}`} aria-hidden="true" />
            <span className="min-w-0 flex-1 truncate text-zinc-300">
              {s.name} <span className="text-zinc-600">({cadenceSummary(s.cadence)})</span>
            </span>
            <button type="button" aria-label={t('schedules.runNow', { name: s.name })} onClick={() => void runNow(s.id)} className="icon-btn"><Play size={12} aria-hidden="true" /></button>
            <button type="button" aria-label={t('schedules.edit', { name: s.name })} onClick={() => setEditing(s.id)} className="icon-btn"><Pencil size={12} aria-hidden="true" /></button>
            <button type="button" aria-label={t('schedules.delete', { name: s.name })} onClick={() => void remove(s.id)} className="icon-btn hover:text-status-error"><Trash2 size={12} aria-hidden="true" /></button>
          </div>
        ))}
      </div>
      {editing && <ScheduleEditModal id={editing} onClose={() => setEditing(null)} />}
    </section>
  );
}
