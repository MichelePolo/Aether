import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { GitSwimlanesView } from './GitSwimlanesView';
import { useGitStore } from '@/src/stores/git.store';
import { useSessionsStore } from '@/src/stores/sessions.store';
import type { CommitNode } from '@/src/lib/git-swimlanes';

function commit(over: Partial<CommitNode>): CommitNode {
  return {
    hash: 'aaaaaaa0000000000000000000000000000000000',
    parents: [],
    author: 'Alice',
    date: '2026-01-01',
    subject: 'init',
    branches: [],
    tags: [],
    head: false,
    files: [],
    ...over,
  };
}

function setSession(workspaceId: string | undefined) {
  useSessionsStore.setState({
    sessions: [
      {
        id: 's1',
        title: 'S1',
        createdAt: 0,
        updatedAt: 0,
        workspaceId,
      } as never,
    ],
    activeSessionId: 's1',
  });
}

describe('GitSwimlanesView', () => {
  beforeEach(() => {
    useGitStore.setState({
      status: null,
      commits: [],
      truncated: false,
      loading: false,
      error: null,
      expanded: new Set<string>(),
      activeWorkspaceId: null,
    });
    // prevent the load effect from making real fetches
    useGitStore.setState({ load: async () => {} });
  });

  it('renders no-workspace empty state when session has no workspaceId', () => {
    setSession(undefined);
    render(<GitSwimlanesView />);
    expect(document.querySelector('[data-empty="no-workspace"]')).toBeTruthy();
  });

  it('renders not-a-repo empty state when status.isRepo is false', () => {
    setSession('w1');
    useGitStore.setState({ status: { isRepo: false }, activeWorkspaceId: 'w1' });
    render(<GitSwimlanesView />);
    expect(document.querySelector('[data-empty="not-a-repo"]')).toBeTruthy();
  });

  it('renders empty-repo state for a repo with no commits', () => {
    setSession('w1');
    useGitStore.setState({
      status: { isRepo: true },
      commits: [],
      loading: false,
      activeWorkspaceId: 'w1',
    });
    render(<GitSwimlanesView />);
    expect(document.querySelector('[data-empty="empty-repo"]')).toBeTruthy();
  });

  it('renders commit subjects and lane legend branch names', () => {
    setSession('w1');
    const c = commit({
      hash: 'feedface000000000000000000000000000000000',
      subject: 'add feature',
      branches: ['main'],
    });
    useGitStore.setState({
      status: { isRepo: true },
      commits: [c],
      activeWorkspaceId: 'w1',
    });
    render(<GitSwimlanesView />);
    expect(screen.getByText('add feature')).toBeTruthy();
    // 'main' appears as a branch tip badge and in the legend
    expect(screen.getAllByText('main').length).toBeGreaterThanOrEqual(1);
  });

  it('toggles a commit row to reveal the file accordion', () => {
    setSession('w1');
    const c = commit({
      hash: 'cafebabe000000000000000000000000000000000',
      subject: 'edit file',
      branches: ['main'],
      files: [{ code: 'M', path: 'src/x.ts' }],
    });
    // make toggleExpand actually mutate so the row re-renders
    useGitStore.setState({
      status: { isRepo: true },
      commits: [c],
      activeWorkspaceId: 'w1',
    });
    render(<GitSwimlanesView />);

    const row = document.querySelector('[data-hash="' + c.hash + '"]') as HTMLElement;
    expect(within(row).queryByText('src/x.ts')).toBeNull();

    const crow = row.querySelector('.crow') as HTMLElement;
    fireEvent.click(crow);

    const rowAfter = document.querySelector(
      '[data-hash="' + c.hash + '"]',
    ) as HTMLElement;
    expect(within(rowAfter).getByText('src/x.ts')).toBeTruthy();
  });
});
