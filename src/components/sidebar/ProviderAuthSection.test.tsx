import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ProviderAuthSection } from './ProviderAuthSection';
import { useProviderAuthStore } from '@/src/stores/providerAuth.store';
import { useUiStore } from '@/src/stores/ui.store';

beforeEach(() => {
  useProviderAuthStore.getState()._reset();
  useUiStore.getState()._reset();
});

const allStatuses = [
  { transport: 'anthropic' as const, state: 'ok' as const, reason: 'API key set', detail: 'sk-ant-***' },
  { transport: 'openai' as const, state: 'unconfigured' as const, reason: 'No key', detail: '' },
  { transport: 'gemini' as const, state: 'error' as const, reason: 'Invalid key', detail: 'Bad format' },
];

describe('ProviderAuthSection', () => {
  it('renders 3 keyed rows in order (anthropic, openai, gemini) — Ollama is its own sub-block', () => {
    useProviderAuthStore.setState({ statuses: allStatuses });
    render(<ProviderAuthSection />);
    const rows = screen.getAllByTestId('provider-auth-row');
    expect(rows).toHaveLength(3);
    expect(rows[0].textContent).toContain('Anthropic');
    expect(rows[1].textContent).toContain('OpenAI');
    expect(rows[2].textContent).toContain('Gemini');
  });

  it('clicking the refresh button calls useProviderAuthStore.refresh', async () => {
    const refreshSpy = vi.fn().mockResolvedValue(undefined);
    useProviderAuthStore.setState({ refresh: refreshSpy });
    const user = userEvent.setup();
    render(<ProviderAuthSection />);
    await user.click(screen.getByRole('button', { name: /refresh provider auth/i }));
    expect(refreshSpy).toHaveBeenCalledTimes(1);
  });

  it('title= attribute equals detail when present, empty string when absent', () => {
    useProviderAuthStore.setState({ statuses: allStatuses });
    render(<ProviderAuthSection />);
    const rows = screen.getAllByTestId('provider-auth-row');
    // anthropic has detail 'sk-ant-***'
    expect(rows[0]).toHaveAttribute('title', 'sk-ant-***');
    // openai has detail '' (empty)
    expect(rows[1]).toHaveAttribute('title', '');
    // gemini has detail 'Bad format'
    expect(rows[2]).toHaveAttribute('title', 'Bad format');
  });

  it('renders error banner when store.error is set', () => {
    useProviderAuthStore.setState({ error: 'Network timeout' });
    render(<ProviderAuthSection />);
    expect(screen.getByText('Network timeout')).toBeInTheDocument();
  });
});

describe('ProviderAuthSection — Ollama sub-block', () => {
  it('renders one row per Ollama endpoint and opens the modal via the manage button', async () => {
    const openSpy = vi.fn();
    useUiStore.setState({ openOllamaEndpoints: openSpy });
    useProviderAuthStore.setState({
      statuses: [],
      ollama: [
        { id: 'local', label: 'local', fixed: true, state: 'ok', reason: '2 models' },
        { id: 'abc', label: 'gpu', fixed: false, state: 'error', reason: '401' },
      ],
    });
    const user = userEvent.setup();
    render(<ProviderAuthSection />);
    expect(screen.getByText('local')).toBeInTheDocument();
    expect(screen.getByText('gpu')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /manage ollama endpoints/i }));
    expect(openSpy).toHaveBeenCalled();
  });
});

describe('ProviderAuthSection — click-to-open vault', () => {
  it('clicking an unconfigured or error row (openai, gemini) opens the vault for that transport', async () => {
    useProviderAuthStore.setState({ statuses: allStatuses });
    render(<ProviderAuthSection />);
    const user = userEvent.setup();

    const rows = screen.getAllByTestId('provider-auth-row');
    // openai is unconfigured (index 1)
    await user.click(rows[1]);
    expect(useUiStore.getState().keyVaultOpen).toBe(true);
    expect(useUiStore.getState().keyVaultFocusTransport).toBe('openai');

    useUiStore.getState()._reset();

    // gemini is error (index 2)
    await user.click(rows[2]);
    expect(useUiStore.getState().keyVaultOpen).toBe(true);
    expect(useUiStore.getState().keyVaultFocusTransport).toBe('gemini');
  });

  it('clicking an ok row does NOT open the vault', async () => {
    useProviderAuthStore.setState({ statuses: allStatuses });
    render(<ProviderAuthSection />);
    const user = userEvent.setup();

    const rows = screen.getAllByTestId('provider-auth-row');
    // anthropic is ok (index 0)
    await user.click(rows[0]);
    expect(useUiStore.getState().keyVaultOpen).toBe(false);
  });
});
