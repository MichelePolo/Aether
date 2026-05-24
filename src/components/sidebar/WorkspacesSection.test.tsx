import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { useWorkspacesStore } from '@/src/stores/workspaces.store';
import { useUiStore } from '@/src/stores/ui.store';
import { WorkspacesSection } from './WorkspacesSection';

describe('WorkspacesSection', () => {
  beforeEach(() => {
    useWorkspacesStore.getState()._reset();
    useUiStore.getState().closeWorkspaceBrowser();
  });

  it('renders existing workspaces', () => {
    useWorkspacesStore.setState({
      workspaces: [
        { id: 'w1', name: 'proj-1', rootPath: '/tmp/p1', addedAt: 0 },
        { id: 'w2', name: 'proj-2', rootPath: '/tmp/p2', addedAt: 1 },
      ],
    });
    render(<WorkspacesSection />);
    expect(screen.getByText('proj-1')).toBeInTheDocument();
    expect(screen.getByText('proj-2')).toBeInTheDocument();
  });

  it('clicking + Add workspace… opens the browser modal', () => {
    render(<WorkspacesSection />);
    fireEvent.click(screen.getByRole('button', { name: /add workspace/i }));
    expect(useUiStore.getState().workspaceBrowserOpen).toBe(true);
  });

  it('shows a delete button per row that calls remove', async () => {
    useWorkspacesStore.setState({
      workspaces: [{ id: 'w1', name: 'p', rootPath: '/tmp/p', addedAt: 0 }],
    });
    render(<WorkspacesSection />);
    fireEvent.click(screen.getByLabelText(/delete p/i));
    await waitFor(() => {
      expect(useWorkspacesStore.getState().workspaces).toEqual([]);
    });
  });
});
