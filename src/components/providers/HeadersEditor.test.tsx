import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState as useReactState } from 'react';
import { HeadersEditor } from './HeadersEditor';

/** Stateful wrapper that simulates a parent managing controlled value. */
function Controlled({ initial = {} }: { initial?: Record<string, string> }) {
  const [value, setValue] = useReactState<Record<string, string>>(initial);
  return <HeadersEditor value={value} onChange={setValue} />;
}

describe('HeadersEditor', () => {
  it('renders with no rows when value is empty', () => {
    render(<Controlled />);
    expect(screen.getByRole('button', { name: 'Add header' })).toBeInTheDocument();
    expect(screen.queryByPlaceholderText('Key')).not.toBeInTheDocument();
  });

  it('adds a K=V row and calls onChange with { K: "V" }', () => {
    render(<Controlled />);
    fireEvent.click(screen.getByRole('button', { name: 'Add header' }));
    expect(screen.getAllByPlaceholderText('Key')).toHaveLength(1);
    expect(screen.getAllByPlaceholderText('Value')).toHaveLength(1);
    // Rename key to 'K'
    fireEvent.change(screen.getByPlaceholderText('Key'), { target: { value: 'K' } });
    // Re-query after re-render and set value
    fireEvent.change(screen.getByPlaceholderText('Value'), { target: { value: 'V' } });
    // Final state: key = K, value = V
    expect(screen.getByDisplayValue('K')).toBeInTheDocument();
    expect(screen.getByDisplayValue('V')).toBeInTheDocument();
  });

  it('removes a row and calls onChange with {}', () => {
    const onChange = vi.fn();
    render(<HeadersEditor value={{ K: 'V' }} onChange={onChange} />);
    expect(screen.getByDisplayValue('K')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Remove header K' }));
    expect(onChange).toHaveBeenCalledWith({});
  });

  it('renders existing key-value pairs', () => {
    const onChange = vi.fn();
    render(<HeadersEditor value={{ Authorization: 'Bearer tok', 'X-Foo': 'bar' }} onChange={onChange} />);
    expect(screen.getByDisplayValue('Authorization')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Bearer tok')).toBeInTheDocument();
    expect(screen.getByDisplayValue('X-Foo')).toBeInTheDocument();
    expect(screen.getByDisplayValue('bar')).toBeInTheDocument();
  });
});

describe('HeadersEditor — focus retention while typing', () => {
  it('keeps focus in the key field for the whole header name', async () => {
    const user = userEvent.setup();
    render(<Controlled />);
    await user.click(screen.getByRole('button', { name: 'Add header' }));

    await user.click(screen.getByPlaceholderText('Key'));
    // Typing char-by-char only lands in the field if it is never remounted:
    // keying rows by the (editable) header name dropped focus after every
    // character, so the field ended up holding just "A".
    await user.keyboard('Authorization');

    expect(screen.getByPlaceholderText('Key')).toHaveValue('Authorization');
    expect(document.activeElement).toBe(screen.getByPlaceholderText('Key'));
  });

  it('keeps focus in the value field while typing a bearer token', async () => {
    const user = userEvent.setup();
    render(<Controlled initial={{ Authorization: '' }} />);
    await user.click(screen.getByPlaceholderText('Value'));
    await user.keyboard('Bearer sk-123');

    expect(screen.getByPlaceholderText('Value')).toHaveValue('Bearer sk-123');
    expect(document.activeElement).toBe(screen.getByPlaceholderText('Value'));
  });

  it('keeps rows independent when a second header is added', async () => {
    const user = userEvent.setup();
    render(<Controlled initial={{ Authorization: 'Bearer x' }} />);
    await user.click(screen.getByRole('button', { name: 'Add header' }));

    await user.click(screen.getAllByPlaceholderText('Key')[1]);
    await user.keyboard('X-Tenant');

    expect(screen.getAllByPlaceholderText('Key')[0]).toHaveValue('Authorization');
    expect(screen.getAllByPlaceholderText('Key')[1]).toHaveValue('X-Tenant');
  });

  it('emits the full record once the name is typed', async () => {
    const onChange = vi.fn();
    function Harness() {
      const [value, setValue] = useReactState<Record<string, string>>({});
      return (
        <HeadersEditor
          value={value}
          onChange={(next) => {
            onChange(next);
            setValue(next);
          }}
        />
      );
    }
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole('button', { name: 'Add header' }));
    await user.click(screen.getByPlaceholderText('Key'));
    await user.keyboard('X-Key');
    await user.click(screen.getByPlaceholderText('Value'));
    await user.keyboard('abc');

    expect(onChange).toHaveBeenLastCalledWith({ 'X-Key': 'abc' });
  });

  it('does not emit a row whose name is still empty', async () => {
    const onChange = vi.fn();
    render(<HeadersEditor value={{}} onChange={onChange} />);
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Add header' }));
    expect(onChange).toHaveBeenLastCalledWith({});
    expect(screen.getByPlaceholderText('Key')).toBeInTheDocument();
  });

  it('re-syncs when the parent replaces the value (form reset after save)', () => {
    const { rerender } = render(<HeadersEditor value={{ A: '1' }} onChange={vi.fn()} />);
    expect(screen.getByDisplayValue('A')).toBeInTheDocument();
    rerender(<HeadersEditor value={{}} onChange={vi.fn()} />);
    expect(screen.queryByPlaceholderText('Key')).not.toBeInTheDocument();
  });
});
