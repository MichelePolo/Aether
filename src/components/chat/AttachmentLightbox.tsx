import { useEffect } from 'react';
import { useUiStore } from '@/src/stores/ui.store';
import { Modal } from '@/src/components/ui/Modal';

export function AttachmentLightbox() {
  const id = useUiStore((s) => s.lightboxAttachmentId);
  const close = useUiStore((s) => s.closeLightbox);

  useEffect(() => {
    if (!id) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [id, close]);

  if (!id) return null;

  return (
    <Modal open={true} onClose={close}>
      <div className="p-2 max-w-[90vw] max-h-[90vh]">
        <img
          src={`/api/attachments/${id}`}
          alt="Attachment"
          className="max-w-full max-h-[85vh] object-contain"
        />
      </div>
    </Modal>
  );
}
