import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { useSessionsStore } from '@/src/stores/sessions.store';
import { useWorkspacesStore } from '@/src/stores/workspaces.store';
import { WorkspaceChip } from './WorkspaceChip';

describe('WorkspaceChip', () => {
  beforeEach(() => {
    useWorkspacesStore.getState()._reset();
  });

  it('shows "no workspace" when active session has none', () => {
    useSessionsStore.setState({
      sessions: [{ id: 's1', title: 't', createdAt: 0, updatedAt: 0 }],
      activeSessionId: 's1',
    } as Partial<ReturnType<typeof useSessionsStore.getState>>);
    render(<WorkspaceChip />);
    expect(screen.getByText(/no workspace/i)).toBeInTheDocument();
  });

  it("shows active session's workspace name", () => {
    useSessionsStore.setState({
      sessions: [{ id: 's1', title: 't', createdAt: 0, updatedAt: 0, workspaceId: 'w1' }],
      activeSessionId: 's1',
    } as Partial<ReturnType<typeof useSessionsStore.getState>>);
    useWorkspacesStore.setState({
      workspaces: [{ id: 'w1', name: 'proj', rootPath: '/tmp/p', addedAt: 0 }],
    });
    render(<WorkspaceChip />);
    expect(screen.getByText('proj')).toBeInTheDocument();
  });

  it('clicking opens dropdown; selecting a workspace calls setSessionWorkspace', async () => {
    const spy = vi.spyOn(useSessionsStore.getState(), 'setSessionWorkspace').mockResolvedValue();
    useSessionsStore.setState({
      sessions: [{ id: 's1', title: 't', createdAt: 0, updatedAt: 0 }],
      activeSessionId: 's1',
    } as Partial<ReturnType<typeof useSessionsStore.getState>>);
    useWorkspacesStore.setState({
      workspaces: [{ id: 'w1', name: 'proj', rootPath: '/tmp/p', addedAt: 0 }],
    });
    render(<WorkspaceChip />);
    fireEvent.click(screen.getByRole('button', { name: /active workspace/i }));
    await waitFor(() => screen.getByText('proj'));
    fireEvent.click(screen.getByText('proj'));
    expect(spy).toHaveBeenCalledWith('s1', 'w1');
    spy.mockRestore();
  });
});
