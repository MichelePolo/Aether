import { useEffect, useMemo } from 'react';
import { ChevronLeft, ChevronRight, Download, ExternalLink } from 'lucide-react';
import { useUiStore } from '@/src/stores/ui.store';
import { useChatStore } from '@/src/stores/chat.store';
import { Modal } from '@/src/components/ui/Modal';

export function AttachmentLightbox() {
  const id = useUiStore((s) => s.lightboxAttachmentId);
  const close = useUiStore((s) => s.closeLightbox);
  const openLightbox = useUiStore((s) => s.openLightbox);
  const messages = useChatStore((s) => s.messages);

  // Find the message containing this attachment + the image siblings.
  // Falls back to an empty sibling list if the chat store hasn't hydrated.
  const { siblings, current } = useMemo(() => {
    if (!id) return { siblings: [], current: undefined } as const;
    for (const m of messages) {
      const atts = m.attachments?.filter((a) => a.mime?.startsWith('image/')) ?? [];
      const found = atts.find((a) => a.id === id);
      if (found) return { siblings: atts, current: found };
    }
    return { siblings: [], current: undefined } as const;
  }, [id, messages]);

  useEffect(() => {
    if (!id || siblings.length <= 1) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight') {
        const idx = siblings.findIndex((a) => a.id === id);
        openLightbox(siblings[(idx + 1) % siblings.length].id);
      } else if (e.key === 'ArrowLeft') {
        const idx = siblings.findIndex((a) => a.id === id);
        openLightbox(siblings[(idx - 1 + siblings.length) % siblings.length].id);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [id, siblings, openLightbox]);

  if (!id) return null;

  const url = `/api/attachments/${id}`;
  const name = current?.name ?? 'Attachment';
  const idx = current ? siblings.findIndex((a) => a.id === id) : -1;
  const hasSiblings = siblings.length > 1;

  const go = (delta: number) => {
    if (!hasSiblings || idx < 0) return;
    openLightbox(siblings[(idx + delta + siblings.length) % siblings.length].id);
  };

  return (
    <Modal open={true} onClose={close} className="max-w-[92vw]">
      <div className="flex flex-col items-center gap-2">
        <div className="text-zinc-400 text-[11px] font-mono">{name}</div>
        <div className="relative">
          <img
            src={url}
            alt={name}
            className="max-w-full max-h-[80vh] object-contain"
          />
          {hasSiblings && (
            <>
              <button
                type="button"
                aria-label="Previous attachment"
                onClick={() => go(-1)}
                className="absolute left-1 top-1/2 -translate-y-1/2 p-2 rounded bg-black/60 text-white hover:bg-black/80"
              >
                <ChevronLeft size={20} />
              </button>
              <button
                type="button"
                aria-label="Next attachment"
                onClick={() => go(1)}
                className="absolute right-1 top-1/2 -translate-y-1/2 p-2 rounded bg-black/60 text-white hover:bg-black/80"
              >
                <ChevronRight size={20} />
              </button>
            </>
          )}
        </div>
        <div className="flex gap-3 text-[11px] font-mono text-zinc-400">
          <a
            href={url}
            download={name}
            className="flex items-center gap-1 hover:text-white"
          >
            <Download size={12} aria-hidden="true" /> Download
          </a>
          <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1 hover:text-white"
          >
            <ExternalLink size={12} aria-hidden="true" /> Open in new tab
          </a>
        </div>
      </div>
    </Modal>
  );
}
