import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import { AttachmentDropZone } from './AttachmentDropZone';
import { useChatStore } from '@/src/stores/chat.store';

beforeEach(() => {
  useChatStore.getState().reset();
});

describe('AttachmentDropZone', () => {
  it('renders children', () => {
    const { getByTestId } = render(
      <AttachmentDropZone>
        <div data-testid="inner">hello</div>
      </AttachmentDropZone>,
    );
    expect(getByTestId('inner')).toBeInTheDocument();
  });

  it('drop dispatches queueAttachments with the file list', () => {
    const queueSpy = vi.fn(async () => {});
    useChatStore.setState({ queueAttachments: queueSpy });
    const { container } = render(
      <AttachmentDropZone><div /></AttachmentDropZone>,
    );
    const zone = container.firstChild as HTMLElement;
    const file = new File(['x'], 'a.png', { type: 'image/png' });
    fireEvent.drop(zone, { dataTransfer: { files: [file] } });
    expect(queueSpy).toHaveBeenCalledWith([file]);
  });

  it('dragover sets data-drag-active=true', () => {
    const { container } = render(
      <AttachmentDropZone><div /></AttachmentDropZone>,
    );
    const zone = container.firstChild as HTMLElement;
    fireEvent.dragEnter(zone, { dataTransfer: { types: ['Files'] } });
    expect(zone.getAttribute('data-drag-active')).toBe('true');
  });
});
