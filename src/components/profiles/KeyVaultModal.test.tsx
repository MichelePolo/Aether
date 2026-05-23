import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useUiStore } from '@/src/stores/ui.store';
import { useKeyVaultStore } from '@/src/stores/keyVault.store';
import { useProviderAuthStore } from '@/src/stores/providerAuth.store';

// Mock the API so keyVault store actions don't hit real endpoints
vi.mock('@/src/lib/api/providers.api', () => ({
  providersApi: {
    listKeys: vi.fn().mockResolvedValue({ vault: [], info: [] }),
    setKey: vi.fn().mockResolvedValue({
      row: { transport: 'anthropic', hasKey: true, masked: 'sk-ant-***', updatedAt: 1 },
      status: null,
    }),
    clearKey: vi.fn().mockResolvedValue(undefined),
    revealKey: vi.fn().mockResolvedValue('sk-ant-plaintext'),
    fetchAuthStatus: vi.fn().mockResolvedValue({ statuses: [], checkedAt: 0 }),
    refreshAuthStatus: vi.fn().mockResolvedValue({ statuses: [], checkedAt: 0 }),
  },
}));

import { KeyVaultModal } from './KeyVaultModal';

beforeEach(() => {
  useUiStore.getState()._reset();
  useKeyVaultStore.getState()._reset();
  useProviderAuthStore.getState()._reset();
  vi.clearAllMocks();
});

function openModal() {
  useUiStore.getState().openKeyVault();
}

// Helper: replace init with no-op so store state is stable during tests
function freezeInit() {
  useKeyVaultStore.setState({ init: vi.fn().mockResolvedValue(undefined) });
}

describe('KeyVaultModal — rendering', () => {
  it('renders nothing when keyVaultOpen is false', () => {
    render(<KeyVaultModal />);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('renders 5 rows in fixed order (anthropic, anthropic-oauth, openai, gemini, ollama) when open', () => {
    freezeInit();
    openModal();
    render(<KeyVaultModal />);
    const rows = screen.getAllByTestId('key-vault-row');
    expect(rows).toHaveLength(5);
    expect(rows[0].textContent).toMatch(/Anthropic/i);
    expect(rows[1].textContent).toMatch(/Anthropic OAuth/i);
    expect(rows[2].textContent).toMatch(/OpenAI/i);
    expect(rows[3].textContent).toMatch(/Gemini/i);
    expect(rows[4].textContent).toMatch(/Ollama/i);
  });

  it('shows error banner when store.error is set', () => {
    freezeInit();
    useKeyVaultStore.setState({ error: 'Failed to load keys' });
    openModal();
    render(<KeyVaultModal />);
    expect(screen.getByText('Failed to load keys')).toBeInTheDocument();
  });
});

describe('KeyVaultModal — save', () => {
  it('calls useKeyVaultStore.save with the typed key', async () => {
    const saveSpy = vi.fn().mockResolvedValue(undefined);
    freezeInit();
    useKeyVaultStore.setState({ save: saveSpy });
    openModal();
    render(<KeyVaultModal />);
    const user = userEvent.setup();

    const input = screen.getByLabelText(/anthropic key/i);
    await user.clear(input);
    await user.type(input, 'sk-ant-test123');
    await user.click(screen.getByRole('button', { name: /save anthropic/i }));

    expect(saveSpy).toHaveBeenCalledWith('anthropic', 'sk-ant-test123');
  });
});

describe('KeyVaultModal — clear (two-click confirm)', () => {
  it('first click shows "Confirm clear?"; second click calls clear', async () => {
    const clearSpy = vi.fn().mockResolvedValue(undefined);
    freezeInit();
    useKeyVaultStore.setState({
      vault: [{ transport: 'openai', hasKey: true, masked: 'sk-***', updatedAt: 1 }],
      clear: clearSpy,
    });
    openModal();
    render(<KeyVaultModal />);
    const user = userEvent.setup();

    const clearBtn = screen.getByRole('button', { name: /clear openai/i });
    await user.click(clearBtn);
    // After first click, button text changes to confirm
    expect(screen.getByRole('button', { name: /clear openai/i }).textContent).toMatch(/confirm clear/i);
    expect(clearSpy).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: /clear openai/i }));
    expect(clearSpy).toHaveBeenCalledWith('openai');
  });
});

describe('KeyVaultModal — reveal', () => {
  it('clicking Reveal shows plaintext in the input', async () => {
    const revealSpy = vi.fn().mockResolvedValue('sk-ant-plaintext-key');
    freezeInit();
    useKeyVaultStore.setState({
      vault: [{ transport: 'anthropic', hasKey: true, masked: 'sk-ant-***', updatedAt: 1 }],
      reveal: revealSpy,
    });
    openModal();
    render(<KeyVaultModal />);
    const user = userEvent.setup();

    const revealBtn = screen.getByRole('button', { name: /reveal anthropic/i });
    await user.click(revealBtn);
    expect(revealSpy).toHaveBeenCalledWith('anthropic');
    expect(screen.getByDisplayValue('sk-ant-plaintext-key')).toBeInTheDocument();
  });

  it('plaintext is masked again when modal is closed and reopened', async () => {
    const revealSpy = vi.fn().mockResolvedValue('sk-ant-plaintext-key');
    freezeInit();
    useKeyVaultStore.setState({
      vault: [{ transport: 'anthropic', hasKey: true, masked: 'sk-ant-***', updatedAt: 1 }],
      reveal: revealSpy,
    });
    openModal();
    const { unmount } = render(<KeyVaultModal />);
    const user = userEvent.setup();

    await user.click(screen.getByRole('button', { name: /reveal anthropic/i }));
    expect(screen.getByDisplayValue('sk-ant-plaintext-key')).toBeInTheDocument();

    // Close modal
    act(() => {
      useUiStore.getState().closeKeyVault();
    });
    unmount();

    // Reopen fresh
    act(() => {
      useUiStore.getState().openKeyVault();
    });
    render(<KeyVaultModal />);

    // Input should now show masked/empty value again (not plaintext)
    expect(screen.queryByDisplayValue('sk-ant-plaintext-key')).toBeNull();
  });
});

describe('KeyVaultModal — status dot', () => {
  it('status dot reflects useProviderAuthStore statuses', () => {
    freezeInit();
    useProviderAuthStore.setState({
      statuses: [
        { transport: 'anthropic', state: 'ok', reason: 'Key set' },
        { transport: 'openai', state: 'error', reason: 'Invalid key' },
      ],
    });
    openModal();
    render(<KeyVaultModal />);

    const rows = screen.getAllByTestId('key-vault-row');
    // anthropic row (index 0) should have a dot with data-state="ok"
    const anthropicDot = within(rows[0]).getByTestId('status-dot');
    expect(anthropicDot).toHaveAttribute('data-state', 'ok');

    // openai row (index 2) should have a dot with data-state="error"
    const openaiDot = within(rows[2]).getByTestId('status-dot');
    expect(openaiDot).toHaveAttribute('data-state', 'error');
  });
});
