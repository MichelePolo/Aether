import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ToolsSection } from './ToolsSection';
import { useContextStore } from '@/src/stores/context.store';
import { DialogHost } from '@/src/components/layout/DialogHost';
import { _resetDialogStore } from '@/src/hooks/useDialog';

beforeEach(() => {
  _resetDialogStore();
  useContextStore.setState({
    context: {
      systemInstruction: '',
      skills: [],
      tools: [{ id: 't1', name: 'GoogleSearch', version: '1.2.0', status: 'online' }],
      mcpServers: [],
    },
    isLoading: false,
    error: null,
    addTool: async (input) => {
      useContextStore.setState((s) => ({
        context: s.context
          ? { ...s.context, tools: [...s.context.tools, { ...input, id: 'new-id' }] }
          : null,
      }));
    },
    removeTool: async (id) => {
      useContextStore.setState((s) => ({
        context: s.context
          ? { ...s.context, tools: s.context.tools.filter((t) => t.id !== id) }
          : null,
      }));
    },
  });
});

describe('ToolsSection', () => {
  it('lists tools with version', () => {
    render(<><DialogHost /><ToolsSection /></>);
    expect(screen.getByText(/GoogleSearch/)).toBeInTheDocument();
    expect(screen.getByText(/1\.2\.0/)).toBeInTheDocument();
  });

  it('adds a tool via 3-step prompt (offline status)', async () => {
    const user = userEvent.setup();
    render(<><DialogHost /><ToolsSection /></>);
    await user.click(screen.getByRole('button', { name: /register tool/i }));
    // step 1: name
    await user.type(screen.getByRole('textbox'), 'MyTool');
    await user.click(screen.getByRole('button', { name: /^(confirm|ok|online)$/i }));
    // step 2: version (default 1.0.0)
    await user.click(screen.getByRole('button', { name: /^(confirm|ok|online)$/i }));
    // step 3: confirm status — click Offline (cancel)
    await user.click(screen.getByRole('button', { name: /offline/i }));
    expect(useContextStore.getState().context?.tools).toContainEqual(
      expect.objectContaining({ name: 'MyTool', version: '1.0.0', status: 'offline' }),
    );
  });

  it('removes a tool with confirm', async () => {
    const user = userEvent.setup();
    render(<><DialogHost /><ToolsSection /></>);
    await user.click(screen.getByRole('button', { name: /remove GoogleSearch/i }));
    await user.click(screen.getByRole('button', { name: /^(confirm|ok)$/i }));
    expect(useContextStore.getState().context?.tools).toHaveLength(0);
  });
});
