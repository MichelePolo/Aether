import { X, File as FileIcon } from 'lucide-react';
import { useChatStore } from '@/src/stores/chat.store';
import { useProvidersStore } from '@/src/stores/providers.store';
import { useSessionsStore } from '@/src/stores/sessions.store';
import { isImageMime } from '@/src/types/attachment.types';
import { cn } from '@/src/lib/cn';

function formatSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${bytes} B`;
}

export function AttachmentChips() {
  const queue = useChatStore((s) => s.queuedAttachments);
  const remove = useChatStore((s) => s.removeQueuedAttachment);
  const activeId = useSessionsStore((s) => s.activeSessionId);
  const sessions = useSessionsStore((s) => s.sessions);
  const defaultProvider = useProvidersStore((s) => s.defaultProvider);
  const capabilitiesOf = useProvidersStore((s) => s.capabilitiesOf);

  if (queue.length === 0) return null;

  const activeSession = activeId ? sessions.find((s) => s.id === activeId) : undefined;
  const activeProviderName = activeSession?.providerName ?? defaultProvider;
  const caps = capabilitiesOf(activeProviderName ?? null);
  const hasImages = queue.some((a) => isImageMime(a.mime));
  const visionRequired = hasImages && caps?.vision === false;

  return (
    <div className="px-3 py-2 border-t border-border-subtle bg-surface-2 space-y-2">
      <div className="flex flex-wrap gap-2">
        {queue.map((a) => (
          <div
            key={a.id}
            className="flex items-center gap-2 px-2 py-1 bg-surface-3 border border-border-subtle rounded text-xs"
          >
            {isImageMime(a.mime) ? (
              <img src={a.dataUri} alt={a.name} className="h-10 w-10 object-cover rounded" />
            ) : (
              <FileIcon size={14} className="text-zinc-400" />
            )}
            <div className="flex flex-col">
              <span className="text-zinc-200 font-mono">{a.name}</span>
              <span className="text-zinc-500 text-[10px]">{formatSize(a.size)}</span>
            </div>
            <button
              type="button"
              aria-label={`Remove ${a.name}`}
              onClick={() => remove(a.id)}
              className="ml-1 text-zinc-500 hover:text-status-error"
            >
              <X size={14} />
            </button>
          </div>
        ))}
      </div>
      {visionRequired && (
        <div
          className={cn(
            'text-[10px] text-status-error font-mono',
          )}
        >
          Current provider does not support images. Switch providers or remove the image attachments.
        </div>
      )}
    </div>
  );
}
