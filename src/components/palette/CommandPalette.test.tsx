import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CommandPalette } from './CommandPalette';
import { useUiStore } from '@/src/stores/ui.store';
import * as commandsModule from '@/src/hooks/useCommands';
import type { Command } from '@/src/types/command.types';

const sampleRun = vi.fn(async () => {});
const throwingRun = vi.fn(async () => {
  throw new Error('boom');
});

const fakeCommands: Command[] = [
  { id: 'sessions.new', group: 'sessions', label: 'New session', shortcut: '⌘N', run: sampleRun },
  { id: 'profiles.open', group: 'profiles', label: 'Open profiles manager', run: sampleRun },
  { id: 'ui.toggleSidebar', group: 'ui', label: 'Toggle sidebar', run: throwingRun },
];

beforeEach(() => {
  useUiStore.getState()._reset();
  sampleRun.mockClear();
  throwingRun.mockClear();
  vi.spyOn(commandsModule, 'useCommands').mockReturnValue(fakeCommands);
});

describe('CommandPalette', () => {
  it('renders nothing when paletteOpen=false', () => {
    const { container } = render(<CommandPalette />);
    expect(container.querySelector('[cmdk-root]')).toBeNull();
  });

  it('renders dialog when paletteOpen=true with group headings', () => {
    useUiStore.setState({ paletteOpen: true });
    render(<CommandPalette />);
    expect(screen.getByPlaceholderText(/type a command/i)).toBeInTheDocument();
    expect(screen.getByText(/^sessions$/i)).toBeInTheDocument();
    expect(screen.getAllByText(/profiles/i).length).toBeGreaterThan(0);
    expect(screen.getByText(/^ui$/i)).toBeInTheDocument();
  });

  it('Enter on highlighted item runs and closes palette', async () => {
    useUiStore.setState({ paletteOpen: true });
    const user = userEvent.setup();
    render(<CommandPalette />);
    await user.keyboard('{Enter}');
    expect(sampleRun).toHaveBeenCalled();
    expect(useUiStore.getState().paletteOpen).toBe(false);
  });

  it('error-throwing run still closes palette', async () => {
    useUiStore.setState({ paletteOpen: true });
    const user = userEvent.setup();
    render(<CommandPalette />);
    await user.click(screen.getByText('Toggle sidebar'));
    expect(throwingRun).toHaveBeenCalled();
    expect(useUiStore.getState().paletteOpen).toBe(false);
  });

  it('shows empty message when nothing matches', async () => {
    useUiStore.setState({ paletteOpen: true });
    const user = userEvent.setup();
    render(<CommandPalette />);
    await user.type(screen.getByPlaceholderText(/type a command/i), 'zzznomatch');
    expect(screen.getByText(/no matching commands/i)).toBeInTheDocument();
  });
});
