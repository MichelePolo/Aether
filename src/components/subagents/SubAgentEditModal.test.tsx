import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { server } from '@/src/test/msw-server';
import { SubAgentEditModal } from './SubAgentEditModal';
import { DialogHost } from '@/src/components/layout/DialogHost';
import { useUiStore } from '@/src/stores/ui.store';
import { useSubAgentsStore } from '@/src/stores/subagents.store';

beforeEach(() => {
  useUiStore.getState()._reset();
  useSubAgentsStore.getState()._reset();
});

function renderModal() {
  return render(
    <>
      <DialogHost />
      <SubAgentEditModal />
    </>,
  );
}

describe('SubAgentEditModal', () => {
  it('renders nothing when editingSubAgentId is null', () => {
    const { container } = renderModal();
    expect(container.querySelector('[role="dialog"]')).toBeNull();
  });

  it('fetches and renders the sub-agent when opened', async () => {
    server.use(
      http.get('http://localhost/api/subagents/SA1', () =>
        HttpResponse.json({
          id: 'SA1',
          name: 'designer',
          systemInstruction: 'You design.',
          skills: ['layout'],
          tools: [{ id: 't1', name: 'figma', version: '1.0.0', status: 'online' }],
          createdAt: 1,
          updatedAt: 2,
        }),
      ),
    );
    useUiStore.setState({ editingSubAgentId: 'SA1' });
    renderModal();
    await waitFor(() => expect(screen.getByText('designer')).toBeInTheDocument());
    expect(screen.getByText('You design.')).toBeInTheDocument();
    expect(screen.getByText('layout')).toBeInTheDocument();
    expect(screen.getByText('figma')).toBeInTheDocument();
  });

  it('Rename → prompt → confirm → calls store.update with new name', async () => {
    server.use(
      http.get('http://localhost/api/subagents/SA1', () =>
        HttpResponse.json({
          id: 'SA1', name: 'designer', systemInstruction: '', skills: [], tools: [],
          createdAt: 1, updatedAt: 2,
        }),
      ),
    );
    useUiStore.setState({ editingSubAgentId: 'SA1' });
    const updateSpy = vi.spyOn(useSubAgentsStore.getState(), 'update').mockResolvedValue(undefined);
    const user = userEvent.setup();
    renderModal();
    await waitFor(() => expect(screen.getByText('designer')).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: /rename/i }));
    const input = await screen.findByLabelText(/^name$/i);
    await user.clear(input);
    await user.type(input, 'newname');
    await user.click(screen.getByRole('button', { name: /confirm/i }));
    await waitFor(() => expect(updateSpy).toHaveBeenCalledWith('SA1', { name: 'newname' }));
  });

  it('Edit system instruction calls update with the new value', async () => {
    server.use(
      http.get('http://localhost/api/subagents/SA1', () =>
        HttpResponse.json({
          id: 'SA1', name: 'd', systemInstruction: 'old', skills: [], tools: [],
          createdAt: 1, updatedAt: 2,
        }),
      ),
    );
    useUiStore.setState({ editingSubAgentId: 'SA1' });
    const updateSpy = vi.spyOn(useSubAgentsStore.getState(), 'update').mockResolvedValue(undefined);
    const user = userEvent.setup();
    renderModal();
    await waitFor(() => expect(screen.getByText('old')).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: /edit system instruction/i }));
    const ta = await screen.findByLabelText(/system instruction/i);
    await user.clear(ta);
    await user.type(ta, 'newsys');
    await user.click(screen.getByRole('button', { name: /confirm/i }));
    await waitFor(() => expect(updateSpy).toHaveBeenCalledWith('SA1', { systemInstruction: 'newsys' }));
  });

  it('shows "Failed to load" when GET fails', async () => {
    server.use(
      http.get('http://localhost/api/subagents/SA1', () =>
        HttpResponse.json({ error: { message: 'Boom' } }, { status: 500 }),
      ),
    );
    useUiStore.setState({ editingSubAgentId: 'SA1' });
    renderModal();
    await waitFor(() => expect(screen.getByText(/failed to load/i)).toBeInTheDocument());
  });

  it('Escape calls closeSubAgentEditor', async () => {
    server.use(
      http.get('http://localhost/api/subagents/SA1', () =>
        HttpResponse.json({
          id: 'SA1', name: 'designer', systemInstruction: '', skills: [], tools: [],
          createdAt: 1, updatedAt: 2,
        }),
      ),
    );
    useUiStore.setState({ editingSubAgentId: 'SA1' });
    const closeSpy = vi.spyOn(useUiStore.getState(), 'closeSubAgentEditor');
    const user = userEvent.setup();
    renderModal();
    await waitFor(() => expect(screen.getByText('designer')).toBeInTheDocument());
    await user.keyboard('{Escape}');
    expect(closeSpy).toHaveBeenCalled();
  });
});
