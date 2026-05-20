import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import App from './App';
import { useChatStore } from '@/src/stores/chat.store';
import { useContextStore } from '@/src/stores/context.store';
import { useSessionsStore } from '@/src/stores/sessions.store';
import { useUiStore } from '@/src/stores/ui.store';
import { useProfilesStore } from '@/src/stores/profiles.store';
import { useSubAgentsStore } from '@/src/stores/subagents.store';
import { useMcpStore } from '@/src/stores/mcp.store';
import { useProvidersStore } from '@/src/stores/providers.store';

beforeEach(() => {
  useChatStore.getState()._reset();
  useContextStore.getState()._reset();
  useSessionsStore.getState()._reset();
  useUiStore.getState()._reset();
  useProfilesStore.getState()._reset();
  useSubAgentsStore.getState()._reset();
  useMcpStore.getState()._reset();
  useProvidersStore.getState()._reset();
  localStorage.clear();
});

describe('App', () => {
  it('renders sidebar with SessionsSection, ChatView present after init', async () => {
    render(<App />);
    expect(screen.getByText('AETHER_CORE')).toBeInTheDocument();
    expect(screen.getByText(/Sessions/i)).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByPlaceholderText(/Scrivi un messaggio/i)).toBeInTheDocument();
    });
  });

  it('mounts ReasoningDrawer (closed by default)', () => {
    render(<App />);
    expect(screen.queryByRole('complementary', { name: /reasoning/i })).not.toBeInTheDocument();
  });

  it('opens ReasoningDrawer when ui.store flips', async () => {
    render(<App />);
    act(() => {
      useUiStore.getState().openReasoningDrawer();
    });
    await waitFor(() => {
      expect(screen.getByRole('complementary', { name: /reasoning/i })).toBeInTheDocument();
    });
  });

  it('mounts ProfilesButton in TopBar', () => {
    render(<App />);
    expect(
      screen.getByRole('button', { name: /open profiles manager/i }),
    ).toBeInTheDocument();
  });

  it('mounts CommandPalette (closed by default)', () => {
    render(<App />);
    expect(screen.queryByPlaceholderText(/type a command/i)).toBeNull();
  });

  it('opens CommandPalette when ui.store flips paletteOpen', async () => {
    render(<App />);
    act(() => {
      useUiStore.getState().openPalette();
    });
    await waitFor(() => {
      expect(screen.getByPlaceholderText(/type a command/i)).toBeInTheDocument();
    });
  });

  it('mounts SubAgentsSection in sidebar', () => {
    render(<App />);
    expect(screen.getAllByText(/sub-agents/i).length).toBeGreaterThan(0);
  });

  it('useToolCallDecisions is mounted (dialog opens when emitToolCallRequest fires for non-auto-approve)', async () => {
    useMcpStore.setState({
      liveTools: [{ qualifiedName: 'mock.fs', serverId: 'M1', serverName: 'mock', tool: { name: 'fs', inputSchema: {} }, autoApprove: false }],
      connectStates: { M1: 'online' },
      errors: {},
    });
    render(<App />);
    await act(async () => {
      const { emitToolCallRequest } = await import('@/src/hooks/useToolCallDecisions');
      emitToolCallRequest({ id: 'C1', qualifiedName: 'mock.fs', args: { path: '/tmp' } });
    });
    await waitFor(() => {
      expect(screen.getByText(/tool call request/i)).toBeInTheDocument();
    });
  });
});
