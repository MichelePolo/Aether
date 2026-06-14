import { useSchedulesStore } from './schedules.store';

vi.mock('@/src/lib/api/schedules.api', () => ({
  schedulesApi: { list: vi.fn(), create: vi.fn(), update: vi.fn(), remove: vi.fn(), runNow: vi.fn(), runs: vi.fn() },
}));
import { schedulesApi } from '@/src/lib/api/schedules.api';

beforeEach(() => { useSchedulesStore.setState({ list: [], hydrated: false, error: null }); vi.clearAllMocks(); });

describe('useSchedulesStore', () => {
  it('init loads the list', async () => {
    vi.mocked(schedulesApi.list).mockResolvedValue([{ id: 's1', name: 'n' } as never]);
    await useSchedulesStore.getState().init();
    expect(useSchedulesStore.getState().list).toHaveLength(1);
    expect(useSchedulesStore.getState().hydrated).toBe(true);
  });

  it('create prepends', async () => {
    vi.mocked(schedulesApi.create).mockResolvedValue({ id: 's2', name: 'm' } as never);
    await useSchedulesStore.getState().create({ name: 'm', cadence: { kind: 'interval', everyMs: 60_000 }, target: { kind: 'prompt', prompt: 'x' } });
    expect(useSchedulesStore.getState().list[0].id).toBe('s2');
  });
});
