import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TopBar } from './TopBar';

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
});
