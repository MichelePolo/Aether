import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AttachmentChips } from './AttachmentChips';
import { useChatStore } from '@/src/stores/chat.store';
import { useProvidersStore } from '@/src/stores/providers.store';

beforeEach(() => {
  useChatStore.getState().reset();
  useProvidersStore.getState()._reset();
});

describe('AttachmentChips', () => {
  it('renders nothing when queue is empty', () => {
    const { container } = render(<AttachmentChips />);
    expect(container.textContent).toBe('');
  });

  it('renders image thumb for image queue items', () => {
    useChatStore.setState({
      queuedAttachments: [{
        id: 'q1', name: 'p.png', mime: 'image/png', size: 4, base64: 'AAAA',
        dataUri: 'data:image/png;base64,AAAA',
      }],
    });
    render(<AttachmentChips />);
    const img = screen.getByRole('img', { name: /p\.png/i });
    expect(img.getAttribute('src')).toBe('data:image/png;base64,AAAA');
  });

  it('renders text chip for text queue items', () => {
    useChatStore.setState({
      queuedAttachments: [{
        id: 'q1', name: 'notes.md', mime: 'text/markdown', size: 100, base64: 'AAA=',
        dataUri: 'data:text/markdown;base64,AAA=',
      }],
    });
    render(<AttachmentChips />);
    expect(screen.getByText(/notes\.md/i)).toBeInTheDocument();
  });

  it('× button removes the chip', async () => {
    useChatStore.setState({
      queuedAttachments: [{
        id: 'q1', name: 'p.png', mime: 'image/png', size: 4, base64: 'AAAA',
        dataUri: 'data:image/png;base64,AAAA',
      }],
    });
    const user = userEvent.setup();
    render(<AttachmentChips />);
    await user.click(screen.getByLabelText(/remove p\.png/i));
    expect(useChatStore.getState().queuedAttachments).toHaveLength(0);
  });

  it('renders a vision warning when queue has images and provider lacks vision', () => {
    useChatStore.setState({
      queuedAttachments: [{
        id: 'q1', name: 'p.png', mime: 'image/png', size: 4, base64: 'AAAA',
        dataUri: 'data:image/png;base64,AAAA',
      }],
    });
    // Force providersStore so capabilitiesOf returns vision:false
    useProvidersStore.setState({
      list: [{ name: 'fake:default', transport: 'fake', model: 'fake-1', capabilities: { thinking: false, toolCalling: false, vision: false }, displayName: 'Fake' }],
      defaultProvider: 'fake:default',
      hydrated: true,
    });
    render(<AttachmentChips />);
    expect(screen.getByText(/provider does not support images/i)).toBeInTheDocument();
  });
});
