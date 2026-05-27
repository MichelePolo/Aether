import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ComposerModelPill } from './ComposerModelPill';
import { useProvidersStore } from '@/src/stores/providers.store';
import { useSessionsStore } from '@/src/stores/sessions.store';

const PROVIDERS = [
  { name: 'fake:default', transport: 'fake', model: 'default', capabilities: { thinking: false, toolCalling: false, vision: false }, displayName: 'Fake / default' },
  { name: 'anthropic:claude-sonnet-4-6', transport: 'anthropic', model: 'claude-sonnet-4-6', capabilities: { thinking: true, toolCalling: true, vision: true }, displayName: 'Anthropic / claude-sonnet-4-6' },
];

function seed(opts: { setProviderName?: ReturnType<typeof vi.fn>; setDefault?: ReturnType<typeof vi.fn>; refresh?: ReturnType<typeof vi.fn> } = {}) {
  useProvidersStore.setState({
    list: PROVIDERS as never,
    defaultProvider: 'fake:default',
    hydrated: true,
    error: null,
    ...(opts.setDefault ? { setDefault: opts.setDefault } : {}),
    ...(opts.refresh ? { refresh: opts.refresh } : {}),
  } as never);
  useSessionsStore.setState({
    activeSessionId: 's1',
    sessions: [{ id: 's1', providerName: 'fake:default' }] as never,
    ...(opts.setProviderName ? { setProviderName: opts.setProviderName } : {}),
  } as never);
}

describe('ComposerModelPill', () => {
  beforeEach(() => {
    useProvidersStore.getState()._reset();
    localStorage.clear();
  });

  it('shows the active provider label', () => {
    seed();
    render(<ComposerModelPill />);
    expect(screen.getByRole('button', { name: /select model/i })).toHaveTextContent('Fake / default');
  });

  it('lists all providers when opened, marking the active one', async () => {
    seed();
    render(<ComposerModelPill />);
    await userEvent.click(screen.getByRole('button', { name: /select model/i }));
    expect(screen.getByRole('menuitemradio', { name: /Fake \/ default/ })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('menuitemradio', { name: /Anthropic \/ claude-sonnet-4-6/ })).toHaveAttribute('aria-checked', 'false');
  });

  it('selecting a provider switches the session provider and the default', async () => {
    const setProviderName = vi.fn(async () => {});
    const setDefault = vi.fn();
    seed({ setProviderName, setDefault });
    render(<ComposerModelPill />);
    await userEvent.click(screen.getByRole('button', { name: /select model/i }));
    await userEvent.click(screen.getByRole('menuitemradio', { name: /Anthropic \/ claude-sonnet-4-6/ }));
    expect(setProviderName).toHaveBeenCalledWith('s1', 'anthropic:claude-sonnet-4-6');
    expect(setDefault).toHaveBeenCalledWith('anthropic:claude-sonnet-4-6');
  });

  it('refresh item calls providers refresh', async () => {
    const refresh = vi.fn(async () => {});
    seed({ refresh });
    render(<ComposerModelPill />);
    await userEvent.click(screen.getByRole('button', { name: /select model/i }));
    await userEvent.click(screen.getByRole('menuitem', { name: /refresh models/i }));
    expect(refresh).toHaveBeenCalled();
  });
});
