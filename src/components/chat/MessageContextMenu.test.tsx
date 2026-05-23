import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MessageContextMenu } from './MessageContextMenu';
import { useUiStore } from '@/src/stores/ui.store';
import { useSessionsStore } from '@/src/stores/sessions.store';

beforeEach(() => {
  useUiStore.getState()._reset();
  useSessionsStore.getState()._reset();
});

describe('MessageContextMenu', () => {
  it('renders nothing when messageContextMenu is null', () => {
    const { container } = render(<MessageContextMenu />);
    expect(container.firstChild).toBeNull();
  });

  it('renders "Branch from here" label for user role', () => {
    useUiStore.getState().openMessageContextMenu({ x: 50, y: 100, messageId: 'u1', role: 'user' });
    render(<MessageContextMenu />);
    expect(screen.getByText('Branch from here')).toBeInTheDocument();
  });

  it('renders "Branch from previous user message" label for model role', () => {
    useUiStore.getState().openMessageContextMenu({ x: 50, y: 100, messageId: 'm1', role: 'model' });
    render(<MessageContextMenu />);
    expect(screen.getByText('Branch from previous user message')).toBeInTheDocument();
  });

  it('click calls forkSession with messageId and closes menu', async () => {
    const forkSession = vi.fn().mockResolvedValue(undefined);
    useSessionsStore.setState({ forkSession } as unknown as typeof useSessionsStore extends { getState(): infer S } ? Partial<S> : never);
    useUiStore.getState().openMessageContextMenu({ x: 50, y: 100, messageId: 'u2', role: 'user' });
    render(<MessageContextMenu />);
    await userEvent.click(screen.getByText('Branch from here'));
    expect(forkSession).toHaveBeenCalledWith('u2');
    expect(useUiStore.getState().messageContextMenu).toBeNull();
  });

  it('Escape key closes the menu', async () => {
    useUiStore.getState().openMessageContextMenu({ x: 50, y: 100, messageId: 'u3', role: 'user' });
    render(<MessageContextMenu />);
    expect(screen.getByText('Branch from here')).toBeInTheDocument();
    await userEvent.keyboard('{Escape}');
    expect(useUiStore.getState().messageContextMenu).toBeNull();
  });
});
