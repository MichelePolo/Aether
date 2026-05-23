import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ProviderSelector } from './ProviderSelector';
import { useProvidersStore } from '@/src/stores/providers.store';
import { useSessionsStore } from '@/src/stores/sessions.store';

beforeEach(() => {
  useProvidersStore.getState()._reset();
  useSessionsStore.getState()._reset();
});

describe('ProviderSelector', () => {
  it('renders all available providers', () => {
    useProvidersStore.setState({
      list: [
        { name: 'fake:default', transport: 'fake', model: 'default',
          capabilities: { thinking: true, toolCalling: true, vision: false }, displayName: 'Fake' },
        { name: 'ollama:llama3', transport: 'ollama', model: 'llama3',
          capabilities: { thinking: false, toolCalling: true, vision: false }, displayName: 'Ollama / llama3' },
      ],
      defaultProvider: 'fake:default',
      hydrated: true,
      error: null,
    });
    render(<ProviderSelector />);
    expect(screen.getByText(/Fake/)).toBeInTheDocument();
    expect(screen.getByText(/Ollama \/ llama3/)).toBeInTheDocument();
  });

  it('reflects active session providerName when present', () => {
    useProvidersStore.setState({
      list: [
        { name: 'fake:default', transport: 'fake', model: 'default',
          capabilities: { thinking: true, toolCalling: true, vision: false }, displayName: 'Fake' },
        { name: 'ollama:llama3', transport: 'ollama', model: 'llama3',
          capabilities: { thinking: false, toolCalling: true, vision: false }, displayName: 'Ollama / llama3' },
      ],
      defaultProvider: 'fake:default',
      hydrated: true,
      error: null,
    });
    useSessionsStore.setState({
      sessions: [{ id: 'S1', title: 't', createdAt: 0, updatedAt: 0, providerName: 'ollama:llama3' } as never],
      activeSessionId: 'S1',
      hydrated: true,
    });
    render(<ProviderSelector />);
    const select = screen.getByRole('combobox') as HTMLSelectElement;
    expect(select.value).toBe('ollama:llama3');
  });

  it('onChange calls setProviderName and setDefault', async () => {
    useProvidersStore.setState({
      list: [
        { name: 'fake:default', transport: 'fake', model: 'default',
          capabilities: { thinking: true, toolCalling: true, vision: false }, displayName: 'Fake' },
        { name: 'ollama:llama3', transport: 'ollama', model: 'llama3',
          capabilities: { thinking: false, toolCalling: true, vision: false }, displayName: 'Ollama / llama3' },
      ],
      defaultProvider: 'fake:default',
      hydrated: true,
      error: null,
    });
    useSessionsStore.setState({
      sessions: [{ id: 'S1', title: 't', createdAt: 0, updatedAt: 0 }],
      activeSessionId: 'S1',
      hydrated: true,
    });
    const setSpy = vi.spyOn(useSessionsStore.getState(), 'setProviderName').mockResolvedValue(undefined);
    const defSpy = vi.spyOn(useProvidersStore.getState(), 'setDefault');
    const user = userEvent.setup();
    render(<ProviderSelector />);
    await user.selectOptions(screen.getByRole('combobox'), 'ollama:llama3');
    expect(setSpy).toHaveBeenCalledWith('S1', 'ollama:llama3');
    expect(defSpy).toHaveBeenCalledWith('ollama:llama3');
  });

  it('refresh button triggers refresh', async () => {
    useProvidersStore.setState({
      list: [], defaultProvider: null, hydrated: true, error: null,
    });
    const spy = vi.spyOn(useProvidersStore.getState(), 'refresh').mockResolvedValue(undefined);
    const user = userEvent.setup();
    render(<ProviderSelector />);
    await user.click(screen.getByRole('button', { name: /refresh providers/i }));
    expect(spy).toHaveBeenCalled();
  });
});
