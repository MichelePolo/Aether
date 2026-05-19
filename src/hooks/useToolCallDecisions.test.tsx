import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { server } from '@/src/test/msw-server';
import { DialogHost } from '@/src/components/layout/DialogHost';
import { useMcpStore } from '@/src/stores/mcp.store';
import { useToolCallDecisions, emitToolCallRequest } from './useToolCallDecisions';

beforeEach(() => {
  useMcpStore.getState()._reset();
});

function Mount() {
  useToolCallDecisions();
  return null;
}

describe('useToolCallDecisions', () => {
  it('auto-approve tool: no dialog opens', async () => {
    useMcpStore.setState({
      liveTools: [{ qualifiedName: 'mock.echo', serverId: 'M1', serverName: 'mock', tool: { name: 'echo', inputSchema: {} }, autoApprove: true }],
      connectStates: { M1: 'online' },
      errors: {},
    });
    render(<><DialogHost /><Mount /></>);
    emitToolCallRequest({ id: 'C1', qualifiedName: 'mock.echo', args: { message: 'hi' } });
    await Promise.resolve();
    expect(screen.queryByText(/tool call request/i)).toBeNull();
  });

  it('non-auto-approve tool: dialog opens; Approve calls POST /decision', async () => {
    useMcpStore.setState({
      liveTools: [{ qualifiedName: 'mock.fs', serverId: 'M1', serverName: 'mock', tool: { name: 'fs', inputSchema: {} }, autoApprove: false }],
      connectStates: { M1: 'online' },
      errors: {},
    });
    let posted: unknown = null;
    server.use(
      http.post('http://localhost/api/mcp/decision', async ({ request }) => {
        posted = await request.json();
        return new HttpResponse(null, { status: 204 });
      }),
    );
    const user = userEvent.setup();
    render(<><DialogHost /><Mount /></>);
    emitToolCallRequest({ id: 'C2', qualifiedName: 'mock.fs', args: { path: '/tmp' } });
    await waitFor(() => expect(screen.getByText(/tool call request/i)).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: /approve/i }));
    await waitFor(() => expect(posted).toEqual({ callId: 'C2', action: 'approve' }));
  });

  it('Reject path posts action=reject', async () => {
    useMcpStore.setState({
      liveTools: [{ qualifiedName: 'mock.fs', serverId: 'M1', serverName: 'mock', tool: { name: 'fs', inputSchema: {} }, autoApprove: false }],
      connectStates: { M1: 'online' },
      errors: {},
    });
    let posted: unknown = null;
    server.use(
      http.post('http://localhost/api/mcp/decision', async ({ request }) => {
        posted = await request.json();
        return new HttpResponse(null, { status: 204 });
      }),
    );
    const user = userEvent.setup();
    render(<><DialogHost /><Mount /></>);
    emitToolCallRequest({ id: 'C3', qualifiedName: 'mock.fs', args: {} });
    await waitFor(() => expect(screen.getByText(/tool call request/i)).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: /reject/i }));
    await waitFor(() => expect(posted).toEqual({ callId: 'C3', action: 'reject' }));
  });
});
