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
      expect(screen.getByPlaceholderText(/Type a message/i)).toBeInTheDocument();
    });
  });

  it('mounts ReasoningDrawer inert (closed by default)', () => {
    const { container } = render(<App />);
    // The drawer stays mounted for the slide transition; when closed it is
    // inert, which removes it from the tab order and the a11y tree in browsers.
    const drawer = container.querySelector('aside[aria-labelledby="reasoning-heading"]');
    expect(drawer).not.toBeNull();
    expect(drawer!.hasAttribute('inert')).toBe(true);
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

  it('useToolCallDecisions is mounted (ApprovalGate opens when emitToolCallRequest fires)', async () => {
    useMcpStore.setState({
      liveTools: [{ qualifiedName: 'mock.fs', serverId: 'M1', serverName: 'mock', tool: { name: 'fs', inputSchema: {} }, autoApprove: false }],
      connectStates: { M1: 'online' },
      errors: {},
      inFlightCalls: {},
      reconnectInfo: {},
    });
    render(<App />);
    await act(async () => {
      const { emitToolCallRequest } = await import('@/src/hooks/useToolCallDecisions');
      emitToolCallRequest({ callId: 'C1', qualifiedName: 'mock.fs', args: { path: '/tmp' } });
    });
    await waitFor(() => {
      expect(screen.getByText('mock.fs')).toBeInTheDocument();
      expect(screen.getByText('Approve')).toBeInTheDocument();
    });
  });
});
