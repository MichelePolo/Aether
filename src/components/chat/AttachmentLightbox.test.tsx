import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AttachmentLightbox } from './AttachmentLightbox';
import { useUiStore } from '@/src/stores/ui.store';

beforeEach(() => {
  useUiStore.getState()._reset();
});

describe('AttachmentLightbox', () => {
  it('renders nothing when lightboxAttachmentId is null', () => {
    const { container } = render(<AttachmentLightbox />);
    expect(container.textContent).toBe('');
  });

  it('renders the img with the correct src when lightboxAttachmentId is set', () => {
    useUiStore.setState({ lightboxAttachmentId: 'att-42' });
    render(<AttachmentLightbox />);
    const img = screen.getByRole('img', { name: /attachment/i });
    expect(img.getAttribute('src')).toBe('/api/attachments/att-42');
  });

  it('Escape key closes the lightbox', async () => {
    const user = userEvent.setup();
    useUiStore.setState({ lightboxAttachmentId: 'att-99' });
    render(<AttachmentLightbox />);
    expect(screen.getByRole('img')).toBeInTheDocument();
    await user.keyboard('{Escape}');
    expect(useUiStore.getState().lightboxAttachmentId).toBeNull();
  });
});
