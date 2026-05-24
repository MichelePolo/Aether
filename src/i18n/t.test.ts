import { describe, it, expect, vi } from 'vitest';
import { t } from './t';

describe('t()', () => {
  it('returns the English string for a known key', () => {
    expect(t('messageInput.placeholder')).toBe(
      'Type a message. Enter to send, Shift+Enter for newline.',
    );
  });

  it('substitutes {placeholders}', () => {
    expect(t('messageBubble.interrupted', { tokens: 42 })).toContain('42');
  });

  it('returns the key + warns on missing keys', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(t('does.not.exist' as never)).toBe('does.not.exist');
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});
