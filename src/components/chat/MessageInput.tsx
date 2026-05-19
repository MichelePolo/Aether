import { useRef, useState, type KeyboardEvent, type ChangeEvent } from 'react';
import { Send, Square, Brain } from 'lucide-react';
import { useUiStore } from '@/src/stores/ui.store';
import { useSubAgentsStore } from '@/src/stores/subagents.store';
import { cn } from '@/src/lib/cn';
import { computeMentionState, type MentionState } from '@/src/hooks/useMentionAutocomplete';
import { MentionPopover } from './MentionPopover';

export interface MessageInputProps {
  onSend: (text: string) => void;
  onStop: () => void;
  isStreaming: boolean;
}

export function MessageInput({ onSend, onStop, isStreaming }: MessageInputProps) {
  const [value, setValue] = useState('');
  const [mention, setMention] = useState<MentionState>({ open: false, query: '', replaceRange: [0, 0] });
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const thinkingEnabled = useUiStore((s) => s.thinkingEnabled);
  const setThinkingEnabled = useUiStore((s) => s.setThinkingEnabled);
  const subAgents = useSubAgentsStore((s) => s.list);

  const onChange = (e: ChangeEvent<HTMLTextAreaElement>) => {
    setValue(e.target.value);
    const caret = e.target.selectionStart ?? e.target.value.length;
    setMention(computeMentionState(e.target.value, caret));
  };

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

  return (
    <div className="border-t border-border-subtle bg-surface-2 p-3">
      <div className="flex items-end gap-2 relative">
        <button
          type="button"
          aria-label="Toggle thinking mode"
          aria-pressed={thinkingEnabled}
          onClick={() => setThinkingEnabled(!thinkingEnabled)}
          title={
            thinkingEnabled
              ? 'Thinking enabled (slower, shows reasoning)'
              : 'Thinking disabled'
          }
          className={cn(
            'p-2 rounded transition-colors',
            thinkingEnabled
              ? 'bg-accent/20 text-accent border border-accent/40'
              : 'bg-surface-1 text-zinc-500 border border-border-subtle hover:text-zinc-300',
          )}
        >
          <Brain size={16} />
        </button>
        <div className="flex-1 relative">
          <textarea
            ref={textareaRef}
            value={value}
            onChange={onChange}
            onKeyDown={onKey}
            disabled={isStreaming}
            placeholder={
              isStreaming
                ? 'Streaming…'
                : 'Scrivi un messaggio. Enter per inviare, Shift+Enter per a capo.'
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
            className="p-2 rounded bg-accent/20 hover:bg-accent/30 text-accent disabled:opacity-30"
            disabled={!value.trim()}
          >
            <Send size={16} />
          </button>
        )}
      </div>
    </div>
  );
}
