import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SidebarGroups } from './SidebarGroups';
import { useUiStore } from '@/src/stores/ui.store';
import { useSessionsStore } from '@/src/stores/sessions.store';
import { useProviderAuthStore } from '@/src/stores/providerAuth.store';

beforeEach(() => {
  localStorage.clear();
  useUiStore.getState()._reset();
  useSessionsStore.getState()._reset();
});

describe('SidebarGroups', () => {
  it('renders all six group headers', () => {
    render(<SidebarGroups />);
    for (const name of [/sessions/i, /system protocol/i, /skills & agents/i, /tools/i, /workspaces/i, /providers/i]) {
      expect(screen.getByRole('button', { name })).toBeInTheDocument();
    }
  });

  it('honors default open/closed state (System Protocol closed → its textarea not mounted)', () => {
    render(<SidebarGroups />);
    // System Protocol default closed: the section body (textarea) is not mounted
    expect(screen.queryByLabelText('System instruction')).not.toBeInTheDocument();
  });

  it('shows the session count in the Sessions header actions', () => {
    useSessionsStore.setState({ sessions: [], activeSessionId: null, hydrated: true });
    // close skillsAgents to avoid SubAgentsSection also rendering [0]
    useUiStore.setState({ sidebarGroups: { sessions: true, systemProtocol: false, skillsAgents: false, tools: false, workspaces: false, providers: false } });
    render(<SidebarGroups />);
    expect(screen.getByText('[0]')).toBeInTheDocument();
  });

  it('toggling a closed group mounts its content', async () => {
    render(<SidebarGroups />);
    await userEvent.click(screen.getByRole('button', { name: /system protocol/i }));
    expect(screen.getByLabelText('System instruction')).toBeInTheDocument();
  });

  it('clicking + Add workspace… opens the workspace browser', async () => {
    const spy = vi.spyOn(useUiStore.getState(), 'openWorkspaceBrowser');
    render(<SidebarGroups />);
    await userEvent.click(screen.getByRole('button', { name: /add workspace/i }));
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('clicking the provider refresh calls refresh', async () => {
    const refreshSpy = vi.fn().mockResolvedValue(undefined);
    useProviderAuthStore.setState({ refresh: refreshSpy });
    render(<SidebarGroups />);
    await userEvent.click(screen.getByRole('button', { name: /refresh provider auth/i }));
    expect(refreshSpy).toHaveBeenCalledTimes(1);
  });
});
