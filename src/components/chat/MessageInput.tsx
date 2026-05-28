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
import { ComposerPlusMenu, type ComposerAction } from './ComposerPlusMenu';
import { ComposerModelPill } from './ComposerModelPill';
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

  // Extensible "+" menu actions. Add new composer capabilities (screenshot,
  // web search, skills, …) by appending entries here.
  const plusActions: ComposerAction[] = [
    {
      id: 'files',
      label: 'Add files or photos',
      icon: Paperclip,
      onSelect: () => fileInputRef.current?.click(),
    },
  ];

  return (
    <div className="shrink-0 border-t border-border-subtle bg-surface-2 p-3">
      {/* Claude-style composer: textarea on top, a single aligned control row below. */}
      <div className="rounded-2xl border border-border-subtle bg-surface-1 transition-colors focus-within:border-manipulation/50 focus-within:ring-1 focus-within:ring-manipulation/40">
        <div className="relative">
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
            className="w-full bg-transparent text-sm px-3.5 pt-3 pb-1.5 resize-none focus:outline-none disabled:opacity-50 placeholder:text-zinc-600"
          />
          <MentionPopover
            open={mention.open}
            items={filteredItems}
            onSelect={handleMentionSelect}
            onClose={handleMentionClose}
          />
        </div>

        <div className="flex items-center gap-1 px-2 pb-2">
          <ComposerPlusMenu actions={plusActions} disabled={isStreaming} />
          <ComposerModelPill />
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
              'flex items-center gap-1.5 px-2 py-1 rounded-lg text-xs transition-colors',
              thinkingEnabled
                ? 'bg-disclosure/15 text-disclosure'
                : 'text-zinc-500 hover:text-zinc-200 hover:bg-surface-3',
              'disabled:opacity-50 disabled:cursor-not-allowed',
            )}
          >
            <Brain size={16} />
            <span>Thinking</span>
          </button>

          <span
            data-testid="input-token-chip"
            aria-live="polite"
            className="ml-auto text-[10px] font-mono text-zinc-600 px-1 pointer-events-none tabular-nums"
          >
            ~{Math.ceil(value.length / 4)} tokens
          </span>

          {isStreaming ? (
            <button
              type="button"
              aria-label="Stop"
              onClick={onStop}
              className="p-1.5 rounded-lg bg-status-error/20 hover:bg-status-error/30 text-status-error transition-colors"
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
              className="p-1.5 rounded-lg bg-manipulation/20 hover:bg-manipulation/30 text-manipulation transition-colors disabled:opacity-30"
            >
              <Send size={16} />
            </button>
          )}
        </div>
      </div>

      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept="image/png,image/jpeg,image/webp,image/gif,.md,.json,.ts,.tsx,.js,.jsx,.py,.txt,.yaml,.yml,.toml,.sh,.sql,.csv"
        hidden
        onChange={onPickFiles}
      />
    </div>
  );
}
