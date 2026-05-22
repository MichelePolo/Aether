import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ProviderAuthSection } from './ProviderAuthSection';
import { useProviderAuthStore } from '@/src/stores/providerAuth.store';

beforeEach(() => {
  useProviderAuthStore.getState()._reset();
});

const allStatuses = [
  { transport: 'anthropic' as const, state: 'ok' as const, reason: 'API key set', detail: 'sk-ant-***' },
  { transport: 'openai' as const, state: 'unconfigured' as const, reason: 'No key', detail: '' },
  { transport: 'gemini' as const, state: 'error' as const, reason: 'Invalid key', detail: 'Bad format' },
  { transport: 'ollama' as const, state: 'ok' as const, reason: 'Running', detail: '' },
];

describe('ProviderAuthSection', () => {
  it('renders 4 rows in TRANSPORT_ORDER (anthropic, openai, gemini, ollama)', () => {
    useProviderAuthStore.setState({ statuses: allStatuses });
    render(<ProviderAuthSection />);
    const rows = screen.getAllByTestId('provider-auth-row');
    expect(rows).toHaveLength(4);
    expect(rows[0].textContent).toContain('Anthropic');
    expect(rows[1].textContent).toContain('OpenAI');
    expect(rows[2].textContent).toContain('Gemini');
    expect(rows[3].textContent).toContain('Ollama');
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
    // ollama has detail '' (empty)
    expect(rows[3]).toHaveAttribute('title', '');
  });

  it('renders error banner when store.error is set', () => {
    useProviderAuthStore.setState({ error: 'Network timeout' });
    render(<ProviderAuthSection />);
    expect(screen.getByText('Network timeout')).toBeInTheDocument();
  });
});
