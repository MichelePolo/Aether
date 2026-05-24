import { useCallback, useState, type DragEvent, type PropsWithChildren } from 'react';
import { useChatStore } from '@/src/stores/chat.store';
import { t } from '@/src/i18n/t';

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
      className="relative h-full"
    >
      {children}
      {active && (
        <div
          data-testid="drop-overlay"
          className="absolute inset-0 z-40 flex items-center justify-center bg-accent/10 border-2 border-dashed border-accent pointer-events-none"
        >
          <div className="bg-surface-2 border border-accent/40 rounded px-4 py-3 text-sm font-mono text-accent">
            {t('attachmentDropZone.dropHere')}
          </div>
        </div>
      )}
    </div>
  );
}
