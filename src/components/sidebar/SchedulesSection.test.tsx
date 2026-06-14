import { render, screen } from '@testing-library/react';
import { SchedulesSection } from './SchedulesSection';
import { useSchedulesStore } from '@/src/stores/schedules.store';

it('lists schedules with their cadence summary', () => {
  useSchedulesStore.setState({
    hydrated: true, error: null,
    list: [{ id: 's1', name: 'nightly', cadence: { kind: 'cron', expr: '0 3 * * *' }, target: { kind: 'prompt', prompt: 'x' }, autonomy: 'safe', enabled: true, nextRunAt: 1, createdAt: 0, updatedAt: 0 }] as never,
  });
  render(<SchedulesSection />);
  expect(screen.getByText('nightly')).toBeInTheDocument();
  expect(screen.getByText(/0 3 \* \* \*/)).toBeInTheDocument();
});
