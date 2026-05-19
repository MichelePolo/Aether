import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { server } from '@/src/test/msw-server';
import { ProfilesModal } from './ProfilesModal';
import { DialogHost } from '@/src/components/layout/DialogHost';
import { useProfilesStore } from '@/src/stores/profiles.store';
import { useUiStore } from '@/src/stores/ui.store';
import { useContextStore } from '@/src/stores/context.store';

const ctx = { systemInstruction: '', skills: [], tools: [], mcpServers: [] };
const p = (id: string, name = 'P', updatedAt = 1) => ({ id, name, createdAt: 1, updatedAt });

function renderModal() {
  return render(
    <>
      <DialogHost />
      <ProfilesModal />
    </>,
  );
}

beforeEach(() => {
  useProfilesStore.getState()._reset();
  useUiStore.getState()._reset();
  useContextStore.getState()._reset();
  useContextStore.setState({ context: ctx });
});

describe('ProfilesModal', () => {
  it('renders nothing when closed', () => {
    const { container } = renderModal();
    expect(container.querySelector('[role="dialog"]')).toBeNull();
  });

  it('renders when open', () => {
    useUiStore.setState({ profilesModalOpen: true });
    renderModal();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('"+ Save current as new" opens prompt and calls saveCurrent', async () => {
    useUiStore.setState({ profilesModalOpen: true });
    let received: unknown;
    server.use(
      http.post('http://localhost/api/profiles', async ({ request }) => {
        received = await request.json();
        return HttpResponse.json(p('NEW', 'Brand new'), { status: 201 });
      }),
    );
    renderModal();
    await userEvent.click(screen.getByRole('button', { name: /save current as new/i }));
    // PromptDialog appears
    const textbox = await screen.findByRole('textbox');
    await userEvent.type(textbox, 'Brand new');
    // Click confirm/OK
    const confirmBtn = screen.getAllByRole('button').find(
      (b) => /ok|confirm|save/i.test(b.textContent ?? ''),
    );
    if (confirmBtn) await userEvent.click(confirmBtn);
    await waitFor(() => {
      expect((received as { name?: string })?.name).toBe('Brand new');
    });
  });

  it('shows error pill when error is set and clears on dismiss', async () => {
    useUiStore.setState({ profilesModalOpen: true });
    useProfilesStore.setState({ profiles: [], hydrated: true, error: 'Boom' });
    renderModal();
    expect(screen.getByText(/Boom/i)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /dismiss error/i }));
    expect(useProfilesStore.getState().error).toBeNull();
  });

  it('Apply on a row delegates to store', async () => {
    useUiStore.setState({ profilesModalOpen: true });
    useProfilesStore.setState({ profiles: [p('A', 'Alpha')], hydrated: true });
    const spy = vi.spyOn(useProfilesStore.getState(), 'apply').mockResolvedValue(undefined);
    renderModal();
    await userEvent.click(screen.getByRole('button', { name: /^apply$/i }));
    expect(spy).toHaveBeenCalledWith('A');
  });
});
