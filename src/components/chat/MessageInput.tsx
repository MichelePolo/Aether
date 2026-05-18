import { useState, type KeyboardEvent } from 'react';
import { Send, Square, Brain } from 'lucide-react';
import { useUiStore } from '@/src/stores/ui.store';
import { cn } from '@/src/lib/cn';

export interface MessageInputProps {
  onSend: (text: string) => void;
  onStop: () => void;
  isStreaming: boolean;
}

export function MessageInput({ onSend, onStop, isStreaming }: MessageInputProps) {
  const [value, setValue] = useState('');
  const thinkingEnabled = useUiStore((s) => s.thinkingEnabled);
  const setThinkingEnabled = useUiStore((s) => s.setThinkingEnabled);

  const submit = () => {
    const trimmed = value.trim();
    if (!trimmed) return;
    onSend(trimmed);
    setValue('');
  };

  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  };

  return (
    <div className="border-t border-border-subtle bg-surface-2 p-3">
      <div className="flex items-end gap-2">
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
        <textarea
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={onKey}
          disabled={isStreaming}
          placeholder={
            isStreaming
              ? 'Streaming…'
              : 'Scrivi un messaggio. Enter per inviare, Shift+Enter per a capo.'
          }
          rows={2}
          className="flex-1 bg-surface-1 border border-border-subtle rounded text-sm p-2 resize-none focus:outline-none focus:ring-1 focus:ring-accent disabled:opacity-50"
        />
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
