import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ReasoningStepCard } from './ReasoningStepCard';
import type { ReasoningStep } from '@/src/types/reasoning.types';

/** Expand the card body (tool_call cards start collapsed). */
function expandCard() {
  fireEvent.click(screen.getByRole('button', { expanded: false }));
}

const baseStep: ReasoningStep = {
  id: '1', type: 'context_fetch', title: 'Read context', content: 'loaded', timestamp: 1,
};

describe('ReasoningStepCard', () => {
  it('renders title + content', () => {
    render(<ReasoningStepCard step={baseStep} />);
    expect(screen.getByText('Read context')).toBeInTheDocument();
    expect(screen.getByText('loaded')).toBeInTheDocument();
  });

  it('shows durationMs in ms when < 1000', () => {
    render(<ReasoningStepCard step={{ ...baseStep, durationMs: 123 }} />);
    expect(screen.getByText(/123ms/)).toBeInTheDocument();
  });

  it('shows durationMs in seconds when >= 1000', () => {
    render(<ReasoningStepCard step={{ ...baseStep, durationMs: 1500 }} />);
    expect(screen.getByText(/1\.5s/)).toBeInTheDocument();
  });

  it('shows tokens when present', () => {
    render(<ReasoningStepCard step={{ ...baseStep, tokens: 42 }} />);
    expect(screen.getByText(/42 t/)).toBeInTheDocument();
  });

  it('shows em-dash for missing tokens', () => {
    render(<ReasoningStepCard step={baseStep} />);
    expect(screen.getByText(/— t/)).toBeInTheDocument();
  });

  it('renders unknown type with neutral fallback (does not crash)', () => {
    const step = { ...baseStep, type: 'mystery' as unknown as 'logic' };
    render(<ReasoningStepCard step={step} />);
    expect(screen.getByText('Read context')).toBeInTheDocument();
  });

  it('renders DispatchBranch when subAgent present', () => {
    render(<ReasoningStepCard step={{ ...baseStep, subAgent: 'Coder' }} />);
    expect(screen.getByText('Coder')).toBeInTheDocument();
  });

  it('renders resolve_subagent step with badge label and subAgent name', () => {
    render(
      <ReasoningStepCard
        step={{
          id: '1',
          type: 'resolve_subagent',
          title: 'Sub-agent: designer',
          content: 'systemInstruction +12 chars, +1 skills, +0 tools',
          subAgent: 'designer',
          timestamp: 0,
        }}
      />,
    );
    expect(screen.getByText(/^subagent$/i)).toBeInTheDocument();
    expect(screen.getByText('designer')).toBeInTheDocument();
    expect(screen.getByText('Sub-agent: designer')).toBeInTheDocument();
  });

  it('renders tool_call step with structured args and result', () => {
    render(
      <ReasoningStepCard
        step={{
          id: '1',
          type: 'tool_call',
          title: 'Tool: mock.echo',
          content: 'executed mock.echo',
          toolCall: {
            id: 'C1',
            qualifiedName: 'mock.echo',
            args: { message: 'hi' },
            result: { message: 'hi' },
            durationMs: 12,
          },
          timestamp: 0,
        }}
      />,
    );
    expect(screen.getByText('Tool: mock.echo')).toBeInTheDocument();
    expandCard();
    expect(screen.getAllByText(/"message":\s*"hi"/)[0]).toBeInTheDocument();
  });

  it('collapses tool_call cards by default (body hidden until expanded)', () => {
    render(
      <ReasoningStepCard
        step={{
          id: '1',
          type: 'tool_call',
          title: 'Tool: mock.echo',
          content: 'executed mock.echo',
          toolCall: { id: 'C1', qualifiedName: 'mock.echo', args: { message: 'hi' }, result: { message: 'hi' }, durationMs: 12 },
          timestamp: 0,
        }}
      />,
    );
    // Header (title) is visible; body (content + args/result) is not.
    expect(screen.getByText('Tool: mock.echo')).toBeInTheDocument();
    expect(screen.queryByText('executed mock.echo')).not.toBeInTheDocument();
    expect(screen.queryByText(/"message":\s*"hi"/)).not.toBeInTheDocument();
    expandCard();
    expect(screen.getByText('executed mock.echo')).toBeInTheDocument();
  });

  it('keeps thinking/context steps expanded by default', () => {
    render(<ReasoningStepCard step={baseStep} />);
    // context_fetch body is visible without any interaction.
    expect(screen.getByText('loaded')).toBeInTheDocument();
    expect(screen.getByRole('button')).toHaveAttribute('aria-expanded', 'true');
  });

  it('renders progressNote when present on a tool_call step', () => {
    render(
      <ReasoningStepCard
        step={{
          id: 'X',
          type: 'tool_call',
          title: 'Tool: mock.slow',
          content: 'executed mock.slow',
          toolCall: {
            id: 'C1',
            qualifiedName: 'mock.slow',
            args: {},
            result: { ok: true },
            durationMs: 100,
            progressNote: '2/2 — done',
          },
          timestamp: 0,
        }}
      />,
    );
    expandCard();
    expect(screen.getByText(/2\/2 — done/)).toBeInTheDocument();
  });

  it('renders tool_call error state in red', () => {
    render(
      <ReasoningStepCard
        step={{
          id: '2',
          type: 'tool_call',
          title: 'Tool: mock.fail',
          content: 'tool failed: nope',
          toolCall: {
            id: 'C2',
            qualifiedName: 'mock.fail',
            args: {},
            error: 'nope',
            durationMs: 5,
          },
          timestamp: 0,
        }}
      />,
    );
    // Collapsed errored tool shows a red indicator in the header; expand for the message.
    expect(screen.getByLabelText('tool error')).toBeInTheDocument();
    expandCard();
    expect(screen.getAllByText(/nope/)[0]).toBeInTheDocument();
  });
});
