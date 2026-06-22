import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { OpenAIEndpointsModal } from './OpenAIEndpointsModal';
import { useUiStore } from '@/src/stores/ui.store';
import { useOpenAIEndpointsStore } from '@/src/stores/openaiEndpoints.store';
import { providersApi } from '@/src/lib/api/providers.api';
import type { OpenAICompatEndpoint } from '@/src/types/openai-endpoints.types';

const vllm: OpenAICompatEndpoint = {
  id: 'ep1', label: 'vllm', baseUrl: 'http://vllm.lan:8000',
  model: 'meta-llama/Llama-3', headerKeys: [], createdAt: 1, updatedAt: 1,
};
const withHeaders: OpenAICompatEndpoint = {
  id: 'ep2', label: 'headered', baseUrl: 'http://api.lan:8080',
  model: null, headerKeys: ['Authorization'], createdAt: 2, updatedAt: 2,
};

beforeEach(() => {
  useOpenAIEndpointsStore.getState()._reset();
  useUiStore.getState().openOpenAIEndpoints();
  vi.spyOn(providersApi, 'listOpenAIEndpoints').mockResolvedValue([vllm]);
});
afterEach(() => { vi.restoreAllMocks(); useUiStore.getState().closeOpenAIEndpoints(); });

describe('OpenAIEndpointsModal', () => {
  it('lists endpoints on open', async () => {
    render(<OpenAIEndpointsModal />);
    expect(await screen.findByText('vllm')).toBeInTheDocument();
  });

  it('creates an endpoint from the add form (label + baseUrl + model + headers)', async () => {
    const createSpy = vi.spyOn(providersApi, 'createOpenAIEndpoint').mockResolvedValue({
      endpoint: vllm, status: null,
    });
    render(<OpenAIEndpointsModal />);
    await screen.findByText('vllm');

    fireEvent.change(screen.getByLabelText('Endpoint label'), { target: { value: 'my-vllm' } });
    fireEvent.change(screen.getByLabelText('Endpoint URL'), { target: { value: 'http://vllm:8000' } });
    fireEvent.change(screen.getByLabelText('Model (optional)'), { target: { value: 'llama3' } });
    // Add a header
    fireEvent.click(screen.getByRole('button', { name: 'Add header' }));
    fireEvent.change(screen.getByPlaceholderText('Key'), { target: { value: 'Authorization' } });
    fireEvent.change(screen.getByPlaceholderText('Value'), { target: { value: 'Bearer tok' } });

    fireEvent.click(screen.getByRole('button', { name: 'Add endpoint' }));
    await waitFor(() =>
      expect(createSpy).toHaveBeenCalledWith({
        label: 'my-vllm',
        baseUrl: 'http://vllm:8000',
        model: 'llama3',
        headers: { Authorization: 'Bearer tok' },
      }),
    );
  });

  it('creates an endpoint without model when field is empty', async () => {
    const createSpy = vi.spyOn(providersApi, 'createOpenAIEndpoint').mockResolvedValue({
      endpoint: vllm, status: null,
    });
    render(<OpenAIEndpointsModal />);
    await screen.findByText('vllm');

    fireEvent.change(screen.getByLabelText('Endpoint label'), { target: { value: 'bare' } });
    fireEvent.change(screen.getByLabelText('Endpoint URL'), { target: { value: 'http://bare:8000' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add endpoint' }));
    await waitFor(() =>
      expect(createSpy).toHaveBeenCalledWith({
        label: 'bare',
        baseUrl: 'http://bare:8000',
        model: undefined,
        headers: undefined,
      }),
    );
  });

  it('deletes an endpoint after confirm', async () => {
    const delSpy = vi.spyOn(providersApi, 'deleteOpenAIEndpoint').mockResolvedValue({ ok: true });
    render(<OpenAIEndpointsModal />);
    await screen.findByText('vllm');
    fireEvent.click(screen.getByLabelText('Delete vllm')); // arm confirm
    fireEvent.click(screen.getByLabelText('Delete vllm')); // confirm
    await waitFor(() => expect(delSpy).toHaveBeenCalledWith('ep1'));
  });

  it('edits an endpoint: Save calls update', async () => {
    const updateSpy = vi.spyOn(providersApi, 'updateOpenAIEndpoint')
      .mockResolvedValue({ endpoint: { ...vllm, label: 'vllm2' }, status: null });
    render(<OpenAIEndpointsModal />);
    await screen.findByText('vllm');
    fireEvent.click(screen.getByLabelText('Edit vllm'));
    fireEvent.change(screen.getByLabelText('Edit label vllm'), { target: { value: 'vllm2' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(updateSpy).toHaveBeenCalledWith('ep1', expect.objectContaining({ label: 'vllm2' })),
    );
  });

  it('shows headerKeys as indicator (headers set)', async () => {
    vi.spyOn(providersApi, 'listOpenAIEndpoints').mockResolvedValue([withHeaders]);
    useOpenAIEndpointsStore.getState()._reset();
    render(<OpenAIEndpointsModal />);
    expect(await screen.findByText('headered')).toBeInTheDocument();
    expect(screen.getByText(/headers set/)).toBeInTheDocument();
  });
});
