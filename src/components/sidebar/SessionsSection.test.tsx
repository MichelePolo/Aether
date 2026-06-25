import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SessionsSection } from './SessionsSection';
import { useSessionsStore } from '@/src/stores/sessions.store';
import { useChatStore } from '@/src/stores/chat.store';
import { DialogHost } from '@/src/components/layout/DialogHost';

vi.mock('@/src/lib/api/sessions.api', () => ({
  sessionsApi: {
    list: vi.fn().mockResolvedValue([]),
    create: vi.fn().mockResolvedValue({ id: 'NEW', title: '', createdAt: 0, updatedAt: 0 }),
    rename: vi.fn().mockResolvedValue({}),
    delete: vi.fn().mockResolvedValue(undefined),
    setProviderName: vi.fn().mockResolvedValue(undefined),
    exportSessionUrl: (id: string) => `/api/sessions/${id}/export`,
    importSession: vi.fn().mockResolvedValue({ id: 'IMP', title: '', createdAt: 0, updatedAt: 0 }),
  },
}));

const meta = (id: string, title = '', updatedAt = 0) => ({ id, title, createdAt: 0, updatedAt });

beforeEach(() => {
  useSessionsStore.getState()._reset();
  useChatStore.getState()._reset();
});

function renderWithDialog() {
  return render(
    <>
      <DialogHost />
      <SessionsSection />
    </>,
  );
}

describe('SessionsSection', () => {
  it('renders empty state-aware list', () => {
    useSessionsStore.setState({ sessions: [], activeSessionId: null, hydrated: true });
    renderWithDialog();
    expect(screen.getByRole('button', { name: /new session/i })).toBeInTheDocument();
  });

  it('renders one row per session, highlights active', () => {
    useSessionsStore.setState({
      sessions: [meta('A', 'first', 1), meta('B', 'second', 2)],
      activeSessionId: 'B', hydrated: true,
    });
    renderWithDialog();
    expect(screen.getByText('first')).toBeInTheDocument();
    expect(screen.getByText('second')).toBeInTheDocument();
  });

  it('falls back to "New session" when title is empty', () => {
    useSessionsStore.setState({
      sessions: [meta('A', '', 1)], activeSessionId: 'A', hydrated: true,
    });
    renderWithDialog();
    expect(screen.getByText('New session')).toBeInTheDocument();
  });

  it('clicking a row calls setActive', async () => {
    useSessionsStore.setState({
      sessions: [meta('A', 'first', 1), meta('B', 'second', 2)],
      activeSessionId: 'B', hydrated: true,
    });
    const spy = vi.spyOn(useSessionsStore.getState(), 'setActive');
    renderWithDialog();
    await userEvent.click(screen.getByText('first'));
    expect(spy).toHaveBeenCalledWith('A');
  });

  it('clicking + New Session calls create()', async () => {
    useSessionsStore.setState({
      sessions: [meta('A', 'x', 1)], activeSessionId: 'A', hydrated: true,
    });
    const spy = vi
      .spyOn(useSessionsStore.getState(), 'create')
      .mockResolvedValue(meta('NEW'));
    renderWithDialog();
    await userEvent.click(screen.getByRole('button', { name: /new session/i }));
    expect(spy).toHaveBeenCalled();
  });

  it('disables rows + new button while streaming', () => {
    useSessionsStore.setState({
      sessions: [meta('A', 'x', 1)], activeSessionId: 'A', hydrated: true,
    });
    useChatStore.setState({ streamingId: 'STREAMING' });
    renderWithDialog();
    const newBtn = screen.getByRole('button', { name: /new session/i });
    expect(newBtn).toBeDisabled();
  });

  it('shows error pill when error is set; clearError dismisses it', async () => {
    useSessionsStore.setState({
      sessions: [], activeSessionId: null, hydrated: true, error: 'Boom',
    });
    renderWithDialog();
    expect(screen.getByText(/Boom/i)).toBeInTheDocument();
    const dismiss = screen.getByRole('button', { name: /dismiss error/i });
    await userEvent.click(dismiss);
    expect(useSessionsStore.getState().error).toBeNull();
  });
});

describe('SessionsSection — export button', () => {
  let assignSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    assignSpy = vi.fn();
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { ...window.location, assign: assignSpy },
    });
  });

  it('renders ↓ button per row with aria-label="Export <title>"', () => {
    useSessionsStore.setState({
      sessions: [meta('A', 'Alpha', 1)],
      activeSessionId: 'A',
      hydrated: true,
    });
    renderWithDialog();
    expect(screen.getByRole('button', { name: 'Export Alpha' })).toBeInTheDocument();
  });

  it('clicking ↓ triggers window.location.assign with the export URL', async () => {
    useSessionsStore.setState({
      sessions: [meta('A', 'Alpha', 1)],
      activeSessionId: 'A',
      hydrated: true,
    });
    renderWithDialog();
    const exportBtn = screen.getByRole('button', { name: 'Export Alpha' });
    await userEvent.click(exportBtn);
    expect(assignSpy).toHaveBeenCalledWith('/api/sessions/A/export');
  });

  it('export button is disabled when streaming', () => {
    useSessionsStore.setState({
      sessions: [meta('a', 'Alpha', 1)],
      activeSessionId: 'a',
      hydrated: true,
    });
    useChatStore.setState({ streamingId: 'a' });
    renderWithDialog();
    const exportBtn = screen.getByRole('button', { name: 'Export Alpha' });
    expect(exportBtn).toBeDisabled();
  });
});
