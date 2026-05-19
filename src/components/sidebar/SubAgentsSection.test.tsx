import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { server } from '@/src/test/msw-server';
import { SubAgentsSection } from './SubAgentsSection';
import { DialogHost } from '@/src/components/layout/DialogHost';
import { useSubAgentsStore } from '@/src/stores/subagents.store';

beforeEach(() => {
  useSubAgentsStore.getState()._reset();
});

function renderSection() {
  return render(
    <>
      <DialogHost />
      <SubAgentsSection />
    </>,
  );
}

describe('SubAgentsSection', () => {
  it('renders empty state initially', () => {
    renderSection();
    expect(screen.getByText(/no sub-agents/i)).toBeInTheDocument();
  });

  it('renders existing sub-agents', () => {
    useSubAgentsStore.setState({
      list: [
        { id: 's1', name: 'designer', createdAt: 1, updatedAt: 1 },
        { id: 's2', name: 'coder', createdAt: 1, updatedAt: 1 },
      ],
      hydrated: true,
    });
    renderSection();
    expect(screen.getByText('designer')).toBeInTheDocument();
    expect(screen.getByText('coder')).toBeInTheDocument();
  });

  it('+ New sub-agent opens prompt chain and calls API', async () => {
    let captured: unknown = null;
    server.use(
      http.post('http://localhost/api/subagents', async ({ request }) => {
        captured = await request.json();
        return HttpResponse.json(
          { id: 'sX', name: 'designer', createdAt: 1, updatedAt: 1 },
          { status: 201 },
        );
      }),
    );
    renderSection();
    await userEvent.click(screen.getByRole('button', { name: /new sub-agent/i }));
    const nameInput = await screen.findByLabelText(/name/i);
    await userEvent.type(nameInput, 'designer');
    await userEvent.click(screen.getByRole('button', { name: /confirm/i }));
    const sysInput = await screen.findByLabelText(/system instruction/i);
    await userEvent.type(sysInput, 'Design things.');
    await userEvent.click(screen.getByRole('button', { name: /confirm/i }));
    await screen.findByText('designer');
    expect((captured as { name?: string }).name).toBe('designer');
  });

  it('Delete button calls API + removes row', async () => {
    useSubAgentsStore.setState({
      list: [{ id: 's1', name: 'designer', createdAt: 1, updatedAt: 1 }],
      hydrated: true,
    });
    server.use(
      http.delete('http://localhost/api/subagents/s1', () => new HttpResponse(null, { status: 204 })),
    );
    renderSection();
    await userEvent.hover(screen.getByText('designer'));
    await userEvent.click(screen.getByRole('button', { name: /delete designer/i }));
    await userEvent.click(screen.getByRole('button', { name: /confirm/i }));
    expect(useSubAgentsStore.getState().list).toHaveLength(0);
  });

  it('shows error pill when store.error is set', () => {
    useSubAgentsStore.setState({ list: [], hydrated: true, error: 'Boom' });
    renderSection();
    expect(screen.getByText(/Boom/)).toBeInTheDocument();
  });
});
