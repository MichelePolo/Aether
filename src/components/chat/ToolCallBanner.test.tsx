import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { server } from '@/src/test/msw-server';
import { ToolCallBanner } from './ToolCallBanner';
import { useMcpStore } from '@/src/stores/mcp.store';

beforeEach(() => {
  useMcpStore.getState()._reset();
});

describe('ToolCallBanner', () => {
  it('renders nothing when no in-flight calls', () => {
    const { container } = render(<ToolCallBanner />);
    expect(container.firstChild).toBeNull();
  });

  it('renders one banner per in-flight call with qualifiedName and Cancel button', () => {
    useMcpStore.getState().registerInFlightCall({
      callId: 'C1',
      qualifiedName: 'mock.echo',
      args: { message: 'hi' },
    });
    render(<ToolCallBanner />);
    expect(screen.getByText('mock.echo')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /cancel mock\.echo/i })).toBeInTheDocument();
  });

  it('renders progressNote if present', () => {
    useMcpStore.getState().registerInFlightCall({
      callId: 'C1',
      qualifiedName: 'mock.slow',
      args: {},
    });
    useMcpStore.getState().updateInFlightProgress('C1', '1/2 — step 1');
    render(<ToolCallBanner />);
    expect(screen.getByText(/1\/2 — step 1/)).toBeInTheDocument();
  });

  it('Cancel button POSTs cancelCall with the right id', async () => {
    useMcpStore.getState().registerInFlightCall({
      callId: 'C1',
      qualifiedName: 'mock.echo',
      args: {},
    });
    let posted: unknown = null;
    server.use(
      http.post('http://localhost/api/mcp/cancel-call', async ({ request }) => {
        posted = await request.json();
        return new HttpResponse(null, { status: 204 });
      }),
    );
    const user = userEvent.setup();
    render(<ToolCallBanner />);
    await user.click(screen.getByRole('button', { name: /cancel mock\.echo/i }));
    expect(posted).toEqual({ callId: 'C1' });
  });
});
