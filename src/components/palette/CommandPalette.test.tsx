import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { server } from '@/src/test/msw-server';
import { CommandPalette } from './CommandPalette';
import { useUiStore } from '@/src/stores/ui.store';
import { useSessionsStore } from '@/src/stores/sessions.store';
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

describe('CommandPalette search mode', () => {
  beforeEach(() => {
    useUiStore.getState()._reset();
    // For these tests, surface the real "Search history…" command + a dummy session-switch.
    const searchCmd: Command = {
      id: 'sessions.search-history',
      group: 'sessions',
      label: 'Search history…',
      run: async () => {
        useUiStore.getState().enterSearchMode();
      },
    };
    vi.spyOn(commandsModule, 'useCommands').mockReturnValue([searchCmd]);
  });

  it('shows the "Search history…" command in the commands list', () => {
    useUiStore.setState({ paletteOpen: true });
    render(<CommandPalette />);
    expect(screen.getByText('Search history…')).toBeInTheDocument();
  });

  it('clicking "Search history…" switches the palette into search mode (placeholder changes)', async () => {
    useUiStore.setState({ paletteOpen: true });
    const user = userEvent.setup();
    render(<CommandPalette />);
    expect(screen.getByPlaceholderText(/type a command/i)).toBeInTheDocument();
    await user.click(screen.getByText('Search history…'));
    await waitFor(() => {
      expect(screen.getByPlaceholderText(/search messages/i)).toBeInTheDocument();
    });
    expect(useUiStore.getState().paletteMode).toBe('search');
  });

  it('typing in search mode triggers searchApi.search via MSW', async () => {
    let receivedQuery = '';
    server.use(
      http.get('http://localhost/api/search', ({ request }) => {
        const url = new URL(request.url);
        receivedQuery = url.searchParams.get('q') ?? '';
        return HttpResponse.json({
          results: [
            {
              sessionId: 'S1',
              title: 'Search target',
              updatedAt: 1,
              hits: [{ messageId: 'm1', role: 'user', snippet: 'hello «M»world«/M»' }],
            },
          ],
        });
      }),
    );

    useUiStore.setState({ paletteOpen: true, paletteMode: 'search' });
    const user = userEvent.setup();
    render(<CommandPalette />);
    await user.type(screen.getByPlaceholderText(/search messages/i), 'world');
    await waitFor(() => {
      expect(receivedQuery).toBe('world');
    });
    await waitFor(() => {
      expect(screen.getByText('Search target')).toBeInTheDocument();
    });
  });

  it('renders <mark> elements around the highlighted snippet segments', async () => {
    server.use(
      http.get('http://localhost/api/search', () =>
        HttpResponse.json({
          results: [
            {
              sessionId: 'S1',
              title: 'S1',
              updatedAt: 1,
              hits: [{ messageId: 'm1', role: 'user', snippet: 'see «M»match«/M» here' }],
            },
          ],
        }),
      ),
    );
    useUiStore.setState({ paletteOpen: true, paletteMode: 'search' });
    const user = userEvent.setup();
    render(<CommandPalette />);
    await user.type(screen.getByPlaceholderText(/search messages/i), 'match');
    await waitFor(() => {
      const mark = document.querySelector('mark');
      expect(mark).not.toBeNull();
      expect(mark!.textContent).toBe('match');
    });
  });

  it('selecting a result calls sessionsStore.setActive and closes the palette', async () => {
    server.use(
      http.get('http://localhost/api/search', () =>
        HttpResponse.json({
          results: [
            {
              sessionId: 'session-target',
              title: 'Pick me',
              updatedAt: 1,
              hits: [{ messageId: 'm1', role: 'user', snippet: 'pick' }],
            },
          ],
        }),
      ),
    );

    const setActiveSpy = vi.fn();
    useSessionsStore.setState({ setActive: setActiveSpy });

    useUiStore.setState({ paletteOpen: true, paletteMode: 'search' });
    const user = userEvent.setup();
    render(<CommandPalette />);
    await user.type(screen.getByPlaceholderText(/search messages/i), 'pick');
    await waitFor(() => {
      expect(screen.getByText('Pick me')).toBeInTheDocument();
    });
    await user.click(screen.getByText('Pick me'));
    expect(setActiveSpy).toHaveBeenCalledWith('session-target');
    expect(useUiStore.getState().paletteOpen).toBe(false);
  });

  it('Escape in search mode exits to command mode without closing', async () => {
    useUiStore.setState({ paletteOpen: true, paletteMode: 'search' });
    const user = userEvent.setup();
    render(<CommandPalette />);
    const input = screen.getByPlaceholderText(/search messages/i);
    input.focus();
    await user.keyboard('{Escape}');
    expect(useUiStore.getState().paletteMode).toBe('commands');
    expect(useUiStore.getState().paletteOpen).toBe(true);
  });
});
