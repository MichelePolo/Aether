import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { useUiStore } from '@/src/stores/ui.store';
import { useChatStore } from '@/src/stores/chat.store';
import { ApprovalGate } from './ApprovalGate';

vi.mock('@/src/lib/api/mcp.api', () => ({
  mcpApi: { decide: vi.fn().mockResolvedValue(undefined) },
}));
vi.mock('@/src/lib/api/breakpoints.api', () => ({
  breakpointsApi: {
    classify: vi.fn().mockResolvedValue({
      qualifiedName: 'fs.write_file', category: 'dangerous', source: 'heuristic',
    }),
  },
}));

const ev = { id: 'call-1', qualifiedName: 'fs.write_file', args: { path: '/x', content: 'a' } };

describe('ApprovalGate', () => {
  beforeEach(() => {
    useUiStore.getState().closeApprovalGate();
    useChatStore.getState()._reset();
  });

  it('renders null when no state', () => {
    const { container } = render(<ApprovalGate />);
    expect(container.firstChild).toBeNull();
  });

  it('renders category badge + tool name + args when open with plain preview', async () => {
    useUiStore.getState().openApprovalGate({ event: ev, preview: { kind: 'plain' } });
    render(<ApprovalGate />);
    expect(screen.getByText('fs.write_file')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText('dangerous')).toBeInTheDocument());
  });

  it('renders DiffView for diff preview', async () => {
    useUiStore.getState().openApprovalGate({
      event: ev,
      preview: { kind: 'diff', oldText: 'a\n', newText: 'b\n', path: '/x' },
    });
    render(<ApprovalGate />);
    await waitFor(() => expect(screen.getByText('/x')).toBeInTheDocument());
  });

  it('Approve calls mcpApi.decide and closes', async () => {
    const { mcpApi } = await import('@/src/lib/api/mcp.api');
    useUiStore.getState().openApprovalGate({ event: ev, preview: { kind: 'plain' } });
    render(<ApprovalGate />);
    fireEvent.click(screen.getByText('Approve'));
    await waitFor(() => expect(mcpApi.decide).toHaveBeenCalledWith('call-1', 'approve'));
    expect(useUiStore.getState().approvalGateState).toBeNull();
  });

  it('Reject calls mcpApi.decide with "reject"', async () => {
    const { mcpApi } = await import('@/src/lib/api/mcp.api');
    useUiStore.getState().openApprovalGate({ event: ev, preview: { kind: 'plain' } });
    render(<ApprovalGate />);
    fireEvent.click(screen.getByText('Reject'));
    await waitFor(() => expect(mcpApi.decide).toHaveBeenCalledWith('call-1', 'reject'));
  });

  it('sticky checkbox + Approve adds the tool to chat.stickyApprovals', async () => {
    useUiStore.getState().openApprovalGate({ event: ev, preview: { kind: 'plain' } });
    render(<ApprovalGate />);
    fireEvent.click(screen.getByLabelText(/auto-approve this tool/i));
    fireEvent.click(screen.getByText('Approve'));
    await waitFor(() =>
      expect(useChatStore.getState().stickyApprovals.has('fs.write_file')).toBe(true),
    );
  });
});
