import { IconButton } from '@/src/components/ui/IconButton';
import { ProfilesButton } from '@/src/components/profiles/ProfilesButton';
import { TokenChip } from './TokenChip';
import { WorkspaceChip } from './WorkspaceChip';
import { useUiStore } from '@/src/stores/ui.store';

export interface TopBarProps {
  title: string;
  sidebarOpen: boolean;
  onToggleSidebar: () => void;
}

export function TopBar({ title, sidebarOpen, onToggleSidebar }: TopBarProps) {
  const openPalette = useUiStore((s) => s.openPalette);
  return (
    <header className="h-12 border-b border-border-subtle flex items-center gap-2 px-4 bg-surface-2 sticky top-0 z-10">
      <IconButton
        label="Toggle sidebar"
        onClick={onToggleSidebar}
        variant={sidebarOpen ? 'active' : 'default'}
      >
        <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
          <rect x="2" y="3" width="12" height="2" />
          <rect x="2" y="7" width="12" height="2" />
          <rect x="2" y="11" width="12" height="2" />
        </svg>
      </IconButton>
      <span className="ml-3 font-mono text-sm tracking-tight text-white font-bold">{title}</span>
      <button
        type="button"
        aria-label="Open command palette"
        onClick={openPalette}
        className="ml-2 px-1.5 py-0.5 rounded border border-border-subtle text-zinc-500 hover:text-zinc-300"
      >
        <kbd className="font-mono text-[9px]">⌘K</kbd>
      </button>
      <div className="ml-auto flex items-center gap-2">
        <ProfilesButton />
        <TokenChip />
        <WorkspaceChip />
      </div>
    </header>
  );
}
