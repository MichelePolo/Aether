import { IconButton } from '@/src/components/ui/IconButton';

export interface TopBarProps {
  title: string;
  sidebarOpen: boolean;
  onToggleSidebar: () => void;
}

export function TopBar({ title, sidebarOpen, onToggleSidebar }: TopBarProps) {
  return (
    <header className="h-12 border-b border-border-subtle flex items-center px-4 bg-surface-2 sticky top-0 z-10">
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
    </header>
  );
}
