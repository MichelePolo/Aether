import { SkillStateStore } from './skill-state.store';
import { makeTestDb } from '@/server/test/test-db';
import type { DatabaseHandle } from '@/server/db/database';

let db: DatabaseHandle;
let store: SkillStateStore;

beforeEach(() => {
  db = makeTestDb();
  store = new SkillStateStore(db);
});
afterEach(() => db.close());

describe('SkillStateStore', () => {
  it('returns defaults (disabled, unpinned) for an unknown slug', () => {
    expect(store.get('ghost')).toEqual({ slug: 'ghost', enabled: false, pinned: false });
  });

  it('setEnabled upserts and persists', () => {
    store.setEnabled('alpha', true);
    expect(store.get('alpha')).toEqual({ slug: 'alpha', enabled: true, pinned: false });
  });

  it('setPinned upserts and persists independently of enabled', () => {
    store.setPinned('alpha', true);
    expect(store.get('alpha')).toEqual({ slug: 'alpha', enabled: false, pinned: true });
  });

  it('setEnabled then setPinned preserves both flags', () => {
    store.setEnabled('alpha', true);
    store.setPinned('alpha', true);
    expect(store.get('alpha')).toEqual({ slug: 'alpha', enabled: true, pinned: true });
  });

  it('readAll returns a map of all known rows', () => {
    store.setEnabled('a', true);
    store.setPinned('b', true);
    const all = store.readAll();
    expect(all.get('a')).toEqual({ slug: 'a', enabled: true, pinned: false });
    expect(all.get('b')).toEqual({ slug: 'b', enabled: false, pinned: true });
  });

  it('remove deletes the row', () => {
    store.setEnabled('a', true);
    store.remove('a');
    expect(store.get('a')).toEqual({ slug: 'a', enabled: false, pinned: false });
  });
});
