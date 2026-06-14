import { render, screen } from '@testing-library/react';
import { ChangesView } from './ChangesView';
import { useGitChangesStore } from '@/src/stores/gitChanges.store';
import { useSessionsStore } from '@/src/stores/sessions.store';

beforeEach(() => {
  useGitChangesStore.getState().reset();
});

it('shows the no-workspace empty state when no workspace is active', () => {
  useSessionsStore.setState({ sessions: [], activeSessionId: null } as never);
  const { container } = render(<ChangesView />);
  expect(container.querySelector('[data-empty="no-workspace"]')).toBeInTheDocument();
  expect(screen.getAllByText(/no workspace/i).length).toBeGreaterThan(0);
});

it('renders staged/changes sections and disables Commit when nothing is staged', () => {
  useSessionsStore.setState({ sessions: [{ id: 's1', workspaceId: 'ws1' }], activeSessionId: 's1' } as never);
  useGitChangesStore.setState({
    activeWorkspaceId: 'ws1',
    changes: { staged: [], unstaged: [{ path: 'a.txt', status: 'modified' }], untracked: [], conflicted: [] },
  } as never);
  render(<ChangesView />);
  expect(screen.getByText('a.txt')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /^commit$/i })).toBeDisabled();
});
