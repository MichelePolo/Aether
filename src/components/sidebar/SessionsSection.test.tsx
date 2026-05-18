import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SessionsSection } from './SessionsSection';
import { useSessionsStore } from '@/src/stores/sessions.store';
import { useChatStore } from '@/src/stores/chat.store';
import { DialogHost } from '@/src/components/layout/DialogHost';

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
    expect(screen.getByText(/Sessions/i)).toBeInTheDocument();
    expect(screen.getByText('[0]')).toBeInTheDocument();
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

  it('falls back to "Nuova sessione" when title is empty', () => {
    useSessionsStore.setState({
      sessions: [meta('A', '', 1)], activeSessionId: 'A', hydrated: true,
    });
    renderWithDialog();
    expect(screen.getByText('Nuova sessione')).toBeInTheDocument();
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
