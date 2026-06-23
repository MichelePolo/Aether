import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { OllamaEndpointsModal } from './OllamaEndpointsModal';
import { useUiStore } from '@/src/stores/ui.store';
import { useOllamaEndpointsStore } from '@/src/stores/ollamaEndpoints.store';
import { providersApi } from '@/src/lib/api/providers.api';
import type { OllamaEndpoint } from '@/src/types/ollama-endpoints.types';

const local: OllamaEndpoint = {
  id: 'local', label: 'local', baseUrl: 'http://localhost:11434',
  hasToken: false, tokenMasked: null, fixed: true, createdAt: null, updatedAt: null,
};
const gpu: OllamaEndpoint = {
  id: 'abc', label: 'gpu', baseUrl: 'http://gpu.lan:11434',
  hasToken: false, tokenMasked: null, fixed: false, createdAt: 1, updatedAt: 1,
};

beforeEach(() => {
  useOllamaEndpointsStore.getState()._reset();
  useUiStore.getState().openOllamaEndpoints();
  vi.spyOn(providersApi, 'listOllamaEndpoints').mockResolvedValue([local, gpu]);
});
afterEach(() => { vi.restoreAllMocks(); useUiStore.getState().closeOllamaEndpoints(); });

describe('OllamaEndpointsModal', () => {
  it('lists endpoints and marks the local one as fixed (no delete)', async () => {
    render(<OllamaEndpointsModal />);
    expect(await screen.findByText('gpu')).toBeInTheDocument();
    expect(screen.queryByLabelText('Delete local')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Delete gpu')).toBeInTheDocument();
  });

  it('creates an endpoint from the add form', async () => {
    const createSpy = vi.spyOn(providersApi, 'createOllamaEndpoint').mockResolvedValue({ endpoint: gpu, status: null });
    render(<OllamaEndpointsModal />);
    await screen.findByText('local');
    fireEvent.change(screen.getByLabelText('Endpoint label'), { target: { value: 'gpu' } });
    fireEvent.change(screen.getByLabelText('Endpoint URL'), { target: { value: 'http://gpu.lan:11434' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add endpoint' }));
    await waitFor(() => expect(createSpy).toHaveBeenCalledWith({ label: 'gpu', baseUrl: 'http://gpu.lan:11434', token: undefined }));
  });

  it('deletes a remote endpoint after confirm', async () => {
    const delSpy = vi.spyOn(providersApi, 'deleteOllamaEndpoint').mockResolvedValue({ ok: true });
    render(<OllamaEndpointsModal />);
    await screen.findByText('gpu');
    fireEvent.click(screen.getByLabelText('Delete gpu')); // arm confirm
    fireEvent.click(screen.getByLabelText('Delete gpu')); // confirm
    await waitFor(() => expect(delSpy).toHaveBeenCalledWith('abc'));
  });

  it('edits a remote endpoint: Save calls update with trimmed values and closes the form', async () => {
    const updateSpy = vi.spyOn(providersApi, 'updateOllamaEndpoint')
      .mockResolvedValue({ endpoint: { ...gpu, label: 'gpu2' }, status: null });
    render(<OllamaEndpointsModal />);
    await screen.findByText('gpu');
    fireEvent.click(screen.getByLabelText('Edit gpu'));
    fireEvent.change(screen.getByLabelText('Edit label gpu'), { target: { value: '  gpu2  ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(updateSpy).toHaveBeenCalledWith('abc', { label: 'gpu2', baseUrl: 'http://gpu.lan:11434', token: undefined, headers: null }),
    );
    // form closed → edit inputs gone
    await waitFor(() => expect(screen.queryByLabelText('Edit label gpu2')).not.toBeInTheDocument());
  });

  it('edits an endpoint: adding a header via HeadersEditor includes headers in update call', async () => {
    const updateSpy = vi.spyOn(providersApi, 'updateOllamaEndpoint')
      .mockResolvedValue({ endpoint: gpu, status: null });
    render(<OllamaEndpointsModal />);
    await screen.findByText('gpu');
    fireEvent.click(screen.getByLabelText('Edit gpu'));
    // Scope to the gpu endpoint row to disambiguate from the AddForm's HeadersEditor
    const rows = screen.getAllByTestId('ollama-endpoint-row');
    const gpuRow = rows.find((r) => within(r).queryByLabelText('Edit label gpu') !== null)!;
    fireEvent.click(within(gpuRow).getByRole('button', { name: 'Add header' }));
    fireEvent.change(within(gpuRow).getByPlaceholderText('Key'), { target: { value: 'X-Custom' } });
    fireEvent.change(within(gpuRow).getByPlaceholderText('Value'), { target: { value: 'secret' } });
    fireEvent.click(within(gpuRow).getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(updateSpy).toHaveBeenCalledWith('abc', {
        label: 'gpu',
        baseUrl: 'http://gpu.lan:11434',
        token: undefined,
        headers: { 'X-Custom': 'secret' },
      }),
    );
  });
});
