import { useCallback, useState, type DragEvent, type PropsWithChildren } from 'react';
import { useChatStore } from '@/src/stores/chat.store';
import { cn } from '@/src/lib/cn';

export function AttachmentDropZone({ children }: PropsWithChildren) {
  const queueAttachments = useChatStore((s) => s.queueAttachments);
  const [active, setActive] = useState(false);

  const onDragEnter = useCallback((e: DragEvent) => {
    if (!Array.from(e.dataTransfer.types).includes('Files')) return;
    e.preventDefault();
    setActive(true);
  }, []);

  const onDragOver = useCallback((e: DragEvent) => {
    if (!Array.from(e.dataTransfer.types).includes('Files')) return;
    e.preventDefault();
  }, []);

  const onDragLeave = useCallback((e: DragEvent) => {
    // Only deactivate when leaving the outer zone, not entering children
    if (e.currentTarget === e.target) setActive(false);
  }, []);

  const onDrop = useCallback(
    (e: DragEvent) => {
      e.preventDefault();
      setActive(false);
      const files = Array.from(e.dataTransfer.files);
      if (files.length > 0) void queueAttachments(files);
    },
    [queueAttachments],
  );

  return (
    <div
      data-drag-active={active}
      onDragEnter={onDragEnter}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      className={cn(
        'relative h-full',
        active && 'outline outline-2 outline-accent/40 outline-offset-[-4px]',
      )}
    >
      {children}
    </div>
  );
}
