import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TopBar } from './TopBar';
import { useProfilesStore } from '@/src/stores/profiles.store';
import { useUiStore } from '@/src/stores/ui.store';

beforeEach(() => {
  useProfilesStore.getState()._reset();
  useUiStore.getState()._reset();
});

describe('TopBar', () => {
  it('renders title', () => {
    render(<TopBar title="AETHER" onToggleSidebar={() => {}} sidebarOpen />);
    expect(screen.getByText('AETHER')).toBeInTheDocument();
  });

  it('calls onToggleSidebar when toggle clicked', async () => {
    const user = userEvent.setup();
    const onToggle = vi.fn();
    render(<TopBar title="X" onToggleSidebar={onToggle} sidebarOpen />);
    await user.click(screen.getByRole('button', { name: /toggle sidebar/i }));
    expect(onToggle).toHaveBeenCalledOnce();
  });

  it('marks toggle button as active when sidebar is open', () => {
    render(<TopBar title="X" onToggleSidebar={() => {}} sidebarOpen />);
    expect(screen.getByRole('button', { name: /toggle sidebar/i }).className).toMatch(/bg-zinc-800/);
  });

  it('mounts ProfilesButton', () => {
    render(<TopBar title="X" sidebarOpen onToggleSidebar={() => {}} />);
    expect(screen.getByRole('button', { name: /open profiles manager/i })).toBeInTheDocument();
  });

  it('mounts ProviderSelector', () => {
    render(<TopBar title="X" sidebarOpen onToggleSidebar={() => {}} />);
    expect(screen.getByRole('combobox', { name: /active provider/i })).toBeInTheDocument();
  });
});
