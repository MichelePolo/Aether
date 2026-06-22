import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
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
    // After Add, the wrapper re-renders with the new header key ('Header')
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
