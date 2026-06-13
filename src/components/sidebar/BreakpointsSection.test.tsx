import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { useBreakpointsStore } from '@/src/stores/breakpoints.store';
import { useChatStore } from '@/src/stores/chat.store';
import { BreakpointsSection } from './BreakpointsSection';

describe('BreakpointsSection', () => {
  beforeEach(async () => {
    useBreakpointsStore.getState()._reset();
    await useBreakpointsStore.getState().init();
  });

  it('renders three rows with default modes', () => {
    render(<BreakpointsSection />);
    expect(screen.getByText('Safe')).toBeInTheDocument();
    expect(screen.getByText('Dangerous')).toBeInTheDocument();
    expect(screen.getByText('External')).toBeInTheDocument();
    expect(screen.getAllByTestId('breakpoint-row').length).toBe(3);
  });

  it('shows current mode for each category', () => {
    render(<BreakpointsSection />);
    const dangerousRow = screen.getAllByTestId('breakpoint-row')[1];
    expect(dangerousRow).toHaveTextContent(/gate/i);
  });

  it('clicking AUTO on the dangerous radio group switches the mode', async () => {
    render(<BreakpointsSection />);
    const dangerousRow = screen.getAllByTestId('breakpoint-row')[1];
    fireEvent.click(within(dangerousRow).getByRole('radio', { name: /auto/i }));
    await waitFor(() => {
      expect(useBreakpointsStore.getState().policy.dangerous).toBe('auto');
    });
  });

  it('renders a help tooltip trigger', () => {
    render(<BreakpointsSection />);
    expect(screen.getByLabelText(/what are breakpoints/i)).toBeInTheDocument();
  });

  it('shows the empty state when there are no session approvals', () => {
    useChatStore.getState().reset();
    render(<BreakpointsSection />);
    expect(screen.getByText('No session approvals.')).toBeInTheDocument();
  });

  it('lists session approvals and revokes one on ×', () => {
    useChatStore.getState().reset();
    useChatStore.getState().addStickyApproval('fs.write_file');
    useChatStore.getState().addStickyApproval('git.git_commit');
    render(<BreakpointsSection />);

    expect(screen.getAllByTestId('session-approval-row').length).toBe(2);
    fireEvent.click(screen.getByRole('button', { name: 'Revoke fs.write_file' }));

    expect(screen.queryByText('fs.write_file')).not.toBeInTheDocument();
    expect(screen.getByText('git.git_commit')).toBeInTheDocument();
  });

  it('Clear all revokes every session approval', () => {
    useChatStore.getState().reset();
    useChatStore.getState().addStickyApproval('fs.write_file');
    useChatStore.getState().addStickyApproval('git.git_commit');
    render(<BreakpointsSection />);

    fireEvent.click(screen.getByRole('button', { name: 'Clear all' }));
    expect(screen.getByText('No session approvals.')).toBeInTheDocument();
  });
});
