import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PromptDialog } from './PromptDialog';

describe('PromptDialog accessible validation', () => {
  it('announces a required-field error only after interaction', async () => {
    const user = userEvent.setup();
    render(<PromptDialog open title="T" label="Name" required onConfirm={() => {}} onCancel={() => {}} />);
    const input = screen.getByLabelText(/name/i);
    expect(input).toHaveAttribute('aria-invalid', 'false'); // not eager
    await user.click(input);
    await user.tab(); // blur while empty
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(input).toHaveAccessibleDescription(/required/i); // via aria-describedby error node
  });
});
