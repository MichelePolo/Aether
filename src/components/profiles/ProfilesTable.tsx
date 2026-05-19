import { Check } from 'lucide-react';
import type { ProfileMeta } from '@/src/types/profile.types';
import { cn } from '@/src/lib/cn';

export interface ProfilesTableProps {
  profiles: ProfileMeta[];
  activeId: string | null;
  onApply: (id: string) => void;
  onSaveHere: (id: string) => void;
  onRename: (id: string, name: string) => void;
  onExport: (id: string) => void;
  onDelete: (id: string, name: string) => void;
}

function formatDate(ts: number): string {
  if (!ts) return '—';
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

export function ProfilesTable({
  profiles,
  activeId,
  onApply,
  onSaveHere,
  onRename,
  onExport,
  onDelete,
}: ProfilesTableProps) {
  if (profiles.length === 0) {
    return (
      <div className="p-6 text-center text-zinc-500 text-xs italic">
        No profiles yet — click &quot;+ Save current as new&quot; to create one
      </div>
    );
  }
  return (
    <table className="w-full text-[11px] font-mono">
      <thead className="text-[9px] uppercase tracking-widest text-zinc-500 border-b border-border-subtle">
        <tr>
          <th className="text-left p-2">Name</th>
          <th className="text-left p-2">Created</th>
          <th className="text-left p-2">Updated</th>
          <th className="text-right p-2">Actions</th>
        </tr>
      </thead>
      <tbody>
        {profiles.map((p) => {
          const active = p.id === activeId;
          return (
            <tr
              key={p.id}
              aria-current={active ? 'true' : undefined}
              className={cn(
                'border-b border-border-subtle/60',
                active && 'bg-accent/5',
              )}
            >
              <td className="p-2 flex items-center gap-1.5">
                {active && <Check size={11} className="text-accent" />}
                <span className={cn(active && 'text-accent font-bold')}>{p.name}</span>
              </td>
              <td className="p-2 text-zinc-500">{formatDate(p.createdAt)}</td>
              <td className="p-2 text-zinc-500">{formatDate(p.updatedAt)}</td>
              <td className="p-2 text-right">
                <div className="inline-flex gap-1">
                  <button
                    type="button"
                    onClick={() => onApply(p.id)}
                    className="px-1.5 py-0.5 rounded text-[9px] uppercase tracking-widest font-bold bg-accent/10 text-accent hover:bg-accent/20"
                  >
                    Apply
                  </button>
                  <button
                    type="button"
                    onClick={() => onSaveHere(p.id)}
                    className="px-1.5 py-0.5 rounded text-[9px] uppercase tracking-widest font-bold bg-zinc-800 text-zinc-300 hover:bg-zinc-700"
                  >
                    Save here
                  </button>
                  <button
                    type="button"
                    onClick={() => onRename(p.id, p.name)}
                    className="px-1.5 py-0.5 rounded text-[9px] uppercase tracking-widest font-bold bg-zinc-800 text-zinc-300 hover:bg-zinc-700"
                  >
                    Rename
                  </button>
                  <button
                    type="button"
                    onClick={() => onExport(p.id)}
                    className="px-1.5 py-0.5 rounded text-[9px] uppercase tracking-widest font-bold bg-zinc-800 text-zinc-300 hover:bg-zinc-700"
                  >
                    Export
                  </button>
                  <button
                    type="button"
                    onClick={() => onDelete(p.id, p.name)}
                    className="px-1.5 py-0.5 rounded text-[9px] uppercase tracking-widest font-bold bg-status-error/10 text-status-error hover:bg-status-error/20"
                  >
                    Delete
                  </button>
                </div>
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
