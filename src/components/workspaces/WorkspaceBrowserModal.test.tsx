import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { useUiStore } from '@/src/stores/ui.store';
import { useWorkspacesStore } from '@/src/stores/workspaces.store';
import { workspacesApi } from '@/src/lib/api/workspaces.api';
import { WorkspaceBrowserModal } from './WorkspaceBrowserModal';

vi.mock('@/src/lib/api/workspaces.api', () => ({
  workspacesApi: {
    browse: vi.fn(),
    create: vi.fn(),
  },
}));

describe('WorkspaceBrowserModal', () => {
  beforeEach(() => {
    vi.mocked(workspacesApi.browse).mockReset().mockResolvedValue([
      { name: 'sub-a', path: '/start/sub-a', isDir: true },
      { name: 'sub-b', path: '/start/sub-b', isDir: true },
    ]);
    vi.mocked(workspacesApi.create).mockReset().mockResolvedValue({
      id: 'w1', name: 'sub-a', rootPath: '/start/sub-a', addedAt: 0,
    });
    useUiStore.getState().closeWorkspaceBrowser();
    useWorkspacesStore.getState()._reset();
  });

  it('renders null when closed', () => {
    const { container } = render(<WorkspaceBrowserModal />);
    expect(container.firstChild).toBeNull();
  });

  it('lists browse entries when open', async () => {
    useUiStore.getState().openWorkspaceBrowser();
    render(<WorkspaceBrowserModal />);
    await waitFor(() => expect(screen.getByText(/sub-a/)).toBeInTheDocument());
    expect(screen.getByText(/sub-b/)).toBeInTheDocument();
  });

  it('clicking a folder descends into it', async () => {
    const { workspacesApi } = await import('@/src/lib/api/workspaces.api');
    useUiStore.getState().openWorkspaceBrowser();
    render(<WorkspaceBrowserModal />);
    await waitFor(() => screen.getByText(/sub-a/));
    fireEvent.click(screen.getByText(/sub-a/));
    await waitFor(() => expect(workspacesApi.browse).toHaveBeenCalledTimes(2));
  });

  it('"Add this folder" calls create and closes', async () => {
    const { workspacesApi } = await import('@/src/lib/api/workspaces.api');
    useUiStore.getState().openWorkspaceBrowser();
    render(<WorkspaceBrowserModal />);
    await waitFor(() => screen.getByText(/sub-a/));
    // First descend so currentPath is non-empty (button is disabled at root)
    fireEvent.click(screen.getByText(/sub-a/));
    const addButton = await screen.findByRole('button', { name: 'Add this folder' });
    await waitFor(() => expect(addButton).not.toBeDisabled());
    fireEvent.click(addButton);
    await waitFor(() => expect(workspacesApi.create).toHaveBeenCalled());
    expect(useUiStore.getState().workspaceBrowserOpen).toBe(false);
  });

  it('Escape closes without creating', async () => {
    useUiStore.getState().openWorkspaceBrowser();
    render(<WorkspaceBrowserModal />);
    await waitFor(() => screen.getByText(/sub-a/));
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(useUiStore.getState().workspaceBrowserOpen).toBe(false);
  });
});
