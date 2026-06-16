import { SubAgentsStore } from './subagents.store';
import { seedSkillSmith, SKILL_SMITH_NAME } from './skill-smith';
import { makeTestDb } from '@/server/test/test-db';
import type { DatabaseHandle } from '@/server/db/database';

let db: DatabaseHandle;
let store: SubAgentsStore;

beforeEach(() => {
  db = makeTestDb();
  store = new SubAgentsStore(db);
});
afterEach(() => db.close());

describe('seedSkillSmith', () => {
  it('creates the skill-smith subagent when none exists', async () => {
    await seedSkillSmith(store);
    const all = await store.list();
    expect(all.map((s) => s.name)).toContain(SKILL_SMITH_NAME);
  });

  it('writes a non-empty system instruction mentioning the drafts workflow', async () => {
    await seedSkillSmith(store);
    const meta = (await store.list()).find((s) => s.name === SKILL_SMITH_NAME)!;
    const rec = await store.read(meta.id);
    expect(rec?.systemInstruction.length ?? 0).toBeGreaterThan(50);
    expect(rec?.systemInstruction).toMatch(/\.drafts/);
  });

  it('is idempotent — a second call does not create a duplicate', async () => {
    await seedSkillSmith(store);
    await seedSkillSmith(store);
    const count = (await store.list()).filter((s) => s.name === SKILL_SMITH_NAME).length;
    expect(count).toBe(1);
  });

  it('does not overwrite a user-edited skill-smith', async () => {
    await seedSkillSmith(store);
    const meta = (await store.list()).find((s) => s.name === SKILL_SMITH_NAME)!;
    await store.update(meta.id, { systemInstruction: 'USER EDIT' });
    await seedSkillSmith(store);
    const rec = await store.read(meta.id);
    expect(rec?.systemInstruction).toBe('USER EDIT');
  });
});
