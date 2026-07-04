import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
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
    fetchAuthStatus: vi.fn().mockResolvedValue({ statuses: [], ollama: [], checkedAt: 0 }),
    refreshAuthStatus: vi.fn().mockResolvedValue({ statuses: [], ollama: [], checkedAt: 0 }),
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

function freezeInit() {
  useKeyVaultStore.setState({ init: vi.fn().mockResolvedValue(undefined) });
}

describe('KeyVaultModal — autocomplete opt-out', () => {
  it('the secret key input opts out of browser/password-manager autofill', () => {
    freezeInit();
    openModal();
    render(<KeyVaultModal />);

    const input = screen.getByLabelText(/anthropic key/i);
    expect(input).toHaveAttribute('autocomplete', 'off');
  });

  it('the revealed (text-mode) key input also opts out of autofill', async () => {
    const revealSpy = vi.fn().mockResolvedValue('sk-ant-plaintext-key');
    freezeInit();
    useKeyVaultStore.setState({
      vault: [{ transport: 'anthropic', hasKey: true, masked: 'sk-ant-***', updatedAt: 1 }],
      reveal: revealSpy,
    });
    openModal();
    render(<KeyVaultModal />);

    const input = screen.getByLabelText(/anthropic key/i);
    expect(input).toHaveAttribute('type', 'password');
    expect(input).toHaveAttribute('autocomplete', 'off');
  });
});
