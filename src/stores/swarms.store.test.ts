import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useSwarmsStore } from './swarms.store';
import { swarmsApi } from '@/src/lib/api/swarms.api';

vi.mock('@/src/lib/api/swarms.api', () => ({
  swarmsApi: { list: vi.fn(), create: vi.fn(), update: vi.fn(), delete: vi.fn() },
}));

describe('swarms store', () => {
  beforeEach(() => {
    useSwarmsStore.setState({ list: [], hydrated: false, error: null });
    vi.clearAllMocks();
  });

  it('init loads the list', async () => {
    (swarmsApi.list as any).mockResolvedValue([{ id: '1', name: 'a', stepCount: 2, createdAt: 0, updatedAt: 0 }]);
    await useSwarmsStore.getState().init();
    expect(useSwarmsStore.getState().list).toHaveLength(1);
    expect(useSwarmsStore.getState().hydrated).toBe(true);
  });

  it('remove is optimistic and rolls back on error', async () => {
    useSwarmsStore.setState({
      list: [{ id: '1', name: 'a', stepCount: 0, createdAt: 0, updatedAt: 0 }],
      hydrated: true,
      error: null,
    });
    (swarmsApi.delete as any).mockRejectedValue(new Error('boom'));
    await useSwarmsStore.getState().remove('1');
    expect(useSwarmsStore.getState().list).toHaveLength(1);
    expect(useSwarmsStore.getState().error).toBeTruthy();
  });
});
