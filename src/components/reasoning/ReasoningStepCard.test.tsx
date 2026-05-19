import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ReasoningStepCard } from './ReasoningStepCard';
import type { ReasoningStep } from '@/src/types/reasoning.types';

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
});
