import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MessageInput } from './MessageInput';
import { useSubAgentsStore } from '@/src/stores/subagents.store';
import { mentionOptionId } from './MentionPopover';

describe('MessageInput — mention combobox ARIA', () => {
  beforeEach(() => {
    useSubAgentsStore.getState()._reset();
  });

  it('exposes combobox semantics on the textarea when the mention popover is open', async () => {
    useSubAgentsStore.setState({
      list: [{ id: 'a', name: 'designer', createdAt: 1, updatedAt: 1 }],
      hydrated: true,
    });
    const user = userEvent.setup();
    render(<MessageInput onSend={() => {}} onStop={() => {}} isStreaming={false} />);
    const ta = screen.getByPlaceholderText(/type a message/i);
    await user.click(ta);
    await user.keyboard('@d');

    const combobox = screen.getByRole('combobox');
    expect(combobox).toBe(ta);
    expect(combobox).toHaveAttribute('aria-expanded', 'true');
    const listboxId = combobox.getAttribute('aria-controls');
    expect(listboxId).toBeTruthy();
    expect(document.getElementById(listboxId!)).toBeInTheDocument();
    expect(combobox).toHaveAttribute('aria-activedescendant', mentionOptionId(0));
    expect(document.getElementById(mentionOptionId(0))).toBeInTheDocument();
  });

  it('has combobox role with aria-expanded=false when the popover is closed', () => {
    render(<MessageInput onSend={() => {}} onStop={() => {}} isStreaming={false} />);
    const combobox = screen.getByRole('combobox');
    expect(combobox).toHaveAttribute('aria-expanded', 'false');
    expect(combobox).not.toHaveAttribute('aria-activedescendant');
  });
});
