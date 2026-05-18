import { useState, type KeyboardEvent } from 'react';
import { Send, Square } from 'lucide-react';

export interface MessageInputProps {
  onSend: (text: string) => void;
  onStop: () => void;
  isStreaming: boolean;
}

export function MessageInput({ onSend, onStop, isStreaming }: MessageInputProps) {
  const [value, setValue] = useState('');

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
