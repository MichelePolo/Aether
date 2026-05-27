import { useEffect, useRef, useState, type KeyboardEvent, type ChangeEvent } from 'react';
import { Send, Square, Brain, Paperclip } from 'lucide-react';
import { useUiStore } from '@/src/stores/ui.store';
import { useSubAgentsStore } from '@/src/stores/subagents.store';
import { useProvidersStore } from '@/src/stores/providers.store';
import { useSessionsStore } from '@/src/stores/sessions.store';
import { useChatStore } from '@/src/stores/chat.store';
import { isImageMime } from '@/src/types/attachment.types';
import { cn } from '@/src/lib/cn';
import { computeMentionState, type MentionState } from '@/src/hooks/useMentionAutocomplete';
import { MentionPopover } from './MentionPopover';
import { t } from '@/src/i18n/t';

export interface MessageInputProps {
  onSend: (text: string) => void;
  onStop: () => void;
  isStreaming: boolean;
}

function autoGrow(el: HTMLTextAreaElement): void {
  el.style.height = 'auto';
  const maxRows = 12;
  const lineHeight = parseFloat(getComputedStyle(el).lineHeight) || 20;
  el.style.height = `${Math.min(el.scrollHeight, maxRows * lineHeight)}px`;
}

export function MessageInput({ onSend, onStop, isStreaming }: MessageInputProps) {
  const [value, setValue] = useState('');
  const [mention, setMention] = useState<MentionState>({ open: false, query: '', replaceRange: [0, 0] });
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const thinkingEnabled = useUiStore((s) => s.thinkingEnabled);
  const setThinkingEnabled = useUiStore((s) => s.setThinkingEnabled);
  const subAgents = useSubAgentsStore((s) => s.list);

  const activeId = useSessionsStore((s) => s.activeSessionId);
  const sessions = useSessionsStore((s) => s.sessions);
  const defaultProvider = useProvidersStore((s) => s.defaultProvider);
  const capabilitiesOf = useProvidersStore((s) => s.capabilitiesOf);

  const queuedAttachments = useChatStore((s) => s.queuedAttachments);
  const queueAttachments = useChatStore((s) => s.queueAttachments);

  const activeProviderName = activeId
    ? ((sessions.find((s) => s.id === activeId) as { providerName?: string } | undefined)?.providerName ?? defaultProvider)
    : defaultProvider;
  const caps = capabilitiesOf(activeProviderName);
  const thinkingSupported = caps?.thinking !== false;

  const onChange = (e: ChangeEvent<HTMLTextAreaElement>) => {
    setValue(e.target.value);
    autoGrow(e.target);
    const caret = e.target.selectionStart ?? e.target.value.length;
    setMention(computeMentionState(e.target.value, caret));
  };

  useEffect(() => {
    if (textareaRef.current) autoGrow(textareaRef.current);
  }, [value]);

  const submit = () => {
    const trimmed = value.trim();
    if (!trimmed) return;
    onSend(trimmed);
    setValue('');
    setMention({ open: false, query: '', replaceRange: [0, 0] });
  };

  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (mention.open) {
      return; // MentionPopover owns Enter/Tab/Esc/Arrow keys.
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  };

  const filteredItems = mention.open
    ? subAgents.filter((s) =>
        s.name.toLowerCase().startsWith(mention.query.toLowerCase()),
      )
    : [];

  const handleMentionSelect = (name: string) => {
    const [start, end] = mention.replaceRange;
    const next = `${value.slice(0, start)}@${name} ${value.slice(end)}`;
    setValue(next);
    setMention({ open: false, query: '', replaceRange: [0, 0] });
    setTimeout(() => {
      const ta = textareaRef.current;
      if (ta) {
        const caret = start + name.length + 2;
        ta.focus();
        ta.setSelectionRange(caret, caret);
      }
    }, 0);
  };

  const handleMentionClose = () =>
    setMention({ open: false, query: '', replaceRange: [0, 0] });

  const onPickFiles = async (e: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    if (files.length > 0) await queueAttachments(files);
    e.target.value = '';
  };

  const onPaste = async (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const files = Array.from(e.clipboardData?.files ?? []);
    if (files.length > 0) {
      e.preventDefault();
      await queueAttachments(files);
    }
  };

  const hasImages = queuedAttachments.some((a) => isImageMime(a.mime));
  const visionBlocked = hasImages && caps?.vision === false;
  const canSend = (value.trim().length > 0 || queuedAttachments.length > 0) && !visionBlocked;

  return (
    <div className="shrink-0 border-t border-border-subtle bg-surface-2 p-3">
      <div className="flex items-end gap-2 relative">
        <button
          type="button"
          aria-label="Attach files"
          disabled={isStreaming}
          onClick={() => fileInputRef.current?.click()}
          className="p-2 rounded bg-surface-1 text-zinc-500 border border-border-subtle hover:text-zinc-300 disabled:opacity-50"
        >
          <Paperclip size={16} />
        </button>
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept="image/png,image/jpeg,image/webp,image/gif,.md,.json,.ts,.tsx,.js,.jsx,.py,.txt,.yaml,.yml,.toml,.sh,.sql,.csv"
          hidden
          onChange={onPickFiles}
        />
        <button
          type="button"
          aria-label="Toggle thinking mode"
          aria-pressed={thinkingEnabled}
          disabled={!thinkingSupported}
          onClick={() => setThinkingEnabled(!thinkingEnabled)}
          title={
            thinkingSupported
              ? (thinkingEnabled ? t('messageInput.thinkingEnabled') : t('messageInput.thinkingDisabled'))
              : t('messageInput.thinkingUnsupported', { provider: activeProviderName ?? 'this provider' })
          }
          className={cn(
            'p-2 rounded transition-colors',
            thinkingEnabled
              ? 'bg-accent/20 text-accent border border-accent/40'
              : 'bg-surface-1 text-zinc-500 border border-border-subtle hover:text-zinc-300',
            'disabled:opacity-50 disabled:cursor-not-allowed',
          )}
        >
          <Brain size={16} />
        </button>
        <div className="flex-1 relative">
          <textarea
            ref={textareaRef}
            id="message-input"
            value={value}
            onChange={onChange}
            onKeyDown={onKey}
            onPaste={onPaste}
            disabled={isStreaming}
            placeholder={
              isStreaming
                ? t('messageInput.streaming')
                : t('messageInput.placeholder')
            }
            rows={2}
            className="w-full bg-surface-1 border border-border-subtle rounded text-sm p-2 resize-none focus:outline-none focus:ring-1 focus:ring-accent disabled:opacity-50"
          />
          <MentionPopover
            open={mention.open}
            items={filteredItems}
            onSelect={handleMentionSelect}
            onClose={handleMentionClose}
          />
          <span
            data-testid="input-token-chip"
            aria-live="polite"
            className="absolute bottom-1 right-2 text-[9px] font-mono text-zinc-600 pointer-events-none"
          >
            ~{Math.ceil(value.length / 4)} tokens
          </span>
        </div>
        {isStreaming ? (
          <button
            type="button"
            aria-label="Stop"
            onClick={onStop}
            className="p-2 rounded bg-status-error/20 hover:bg-status-error/30 text-status-error"
          >
            <Square size={16} />
          </button>
        ) : (
          <button
            type="button"
            aria-label="Send"
            onClick={submit}
            title={visionBlocked ? t('messageInput.visionUnsupported') : undefined}
            disabled={!canSend}
            className="p-2 rounded bg-accent/20 hover:bg-accent/30 text-accent disabled:opacity-30"
          >
            <Send size={16} />
          </button>
        )}
      </div>
    </div>
  );
}
