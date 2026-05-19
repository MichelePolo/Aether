import { FolderOpen } from 'lucide-react';
import { useProfilesStore } from '@/src/stores/profiles.store';
import { useUiStore } from '@/src/stores/ui.store';

function truncate(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

export function ProfilesButton() {
  const activeId = useProfilesStore((s) => s.activeProfileId);
  const profiles = useProfilesStore((s) => s.profiles);
  const open = useUiStore((s) => s.openProfilesModal);

  const active = activeId ? profiles.find((p) => p.id === activeId) ?? null : null;
  const label = active ? truncate(active.name, 20) : 'Profiles';

  return (
    <button
      type="button"
      aria-label="Open profiles manager"
      onClick={open}
      className="ml-auto px-2 py-1 rounded text-[10px] uppercase tracking-widest font-mono text-zinc-400 hover:text-white hover:bg-surface-3 transition-colors flex items-center gap-1.5"
    >
      <FolderOpen size={12} />
      <span>{label}</span>
    </button>
  );
}
