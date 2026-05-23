import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { TokenChip } from './TokenChip';
import { useChatStore } from '@/src/stores/chat.store';

beforeEach(() => {
  useChatStore.getState()._reset();
});

describe('TokenChip', () => {
  it('renders nothing when there are no messages', () => {
    const { container } = render(<TokenChip />);
    expect(container.firstChild).toBeNull();
  });

  it('renders nothing when the last assistant message has no tokens', () => {
    const { id } = useChatStore.getState().startAssistant();
    useChatStore.getState().finishAssistant(id, { model: 'fake' });
    const { container } = render(<TokenChip />);
    expect(container.firstChild).toBeNull();
  });

  it('renders formatted total with k suffix when total >= 1000', () => {
    const { id } = useChatStore.getState().startAssistant();
    useChatStore.getState().finishAssistant(id, { model: 'fake', tokensIn: 1500, tokensOut: 500 });
    render(<TokenChip />);
    expect(screen.getByTestId('token-chip')).toBeInTheDocument();
    expect(screen.getByTestId('token-chip').textContent).toMatch(/2\.0k tok/);
  });

  it('renders raw total when under 1000', () => {
    const { id } = useChatStore.getState().startAssistant();
    useChatStore.getState().finishAssistant(id, { model: 'fake', tokensIn: 80, tokensOut: 40 });
    render(<TokenChip />);
    expect(screen.getByTestId('token-chip').textContent).toMatch(/120 tok/);
  });

  it('title attribute splits prompt/reply', () => {
    const { id } = useChatStore.getState().startAssistant();
    useChatStore.getState().finishAssistant(id, { model: 'fake', tokensIn: 80, tokensOut: 40 });
    render(<TokenChip />);
    const chip = screen.getByTestId('token-chip');
    expect(chip.title).toMatch(/prompt 80/);
    expect(chip.title).toMatch(/reply 40/);
  });
});
