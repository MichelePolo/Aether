import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { server } from '@/src/test/msw-server';
import { SwarmEditModal } from './SwarmEditModal';
import { useSwarmsStore } from '@/src/stores/swarms.store';

describe('SwarmEditModal', () => {
  it('shows an error and prevents Save when loading an existing swarm fails', async () => {
    server.use(
      http.get('http://localhost/api/swarms/SW1', () =>
        HttpResponse.json({ error: { message: 'Boom' } }, { status: 500 }),
      ),
    );
    const updateSpy = vi.spyOn(useSwarmsStore.getState(), 'update').mockResolvedValue(undefined);
    const onClose = vi.fn();
    render(<SwarmEditModal id="SW1" onClose={onClose} />);

    await waitFor(() => expect(screen.getByText(/failed to load/i)).toBeInTheDocument());

    const saveButton = screen.getByRole('button', { name: /save/i });
    expect(saveButton).toBeDisabled();
    expect(updateSpy).not.toHaveBeenCalled();
  });
});
