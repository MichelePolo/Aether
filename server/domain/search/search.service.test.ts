import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { makeTestDb } from '@/server/test/test-db';
import { HistoryStore } from '@/server/domain/history/history.store';
import { SearchService } from './search.service';
import type { DatabaseHandle } from '@/server/db/database';

let db: DatabaseHandle;
let history: HistoryStore;
let search: SearchService;

beforeEach(() => {
  db = makeTestDb();
  history = new HistoryStore(db);
  search = new SearchService(db);
});

afterEach(() => {
  db.close();
});

async function seedSession(title: string, msgs: Array<{ id: string; role: 'user' | 'model'; text: string }>) {
  const s = await history.createEmpty();
  if (title) await history.rename(s.id, title);
  for (const m of msgs) {
    await history.append(s.id, { ...m, timestamp: Date.now() });
  }
  return s;
}

describe('SearchService', () => {
  it('returns [] on empty index', async () => {
    const results = await search.search('anything');
    expect(results).toEqual([]);
  });

  it('returns one SessionHits with one snippet for a single match', async () => {
    const s = await seedSession('S1', [
      { id: 'm1', role: 'user', text: 'discussing hyperloop transit systems' },
    ]);
    const results = await search.search('hyperloop');
    expect(results).toHaveLength(1);
    expect(results[0].sessionId).toBe(s.id);
    expect(results[0].title).toBe('S1');
    expect(results[0].hits).toHaveLength(1);
    expect(results[0].hits[0].messageId).toBe('m1');
    expect(results[0].hits[0].snippet).toContain('«M»');
    expect(results[0].hits[0].snippet).toContain('«/M»');
  });

  it('groups hits per session and orders sessions by best rank', async () => {
    const s1 = await seedSession('S1', [
      { id: 'a1', role: 'user', text: 'apple banana cherry' },
    ]);
    const s2 = await seedSession('S2', [
      { id: 'b1', role: 'user', text: 'apple apple apple' },
    ]);
    const results = await search.search('apple');
    expect(results).toHaveLength(2);
    // S2 mentions "apple" three times → better BM25 → ordered first.
    expect(results[0].sessionId).toBe(s2.id);
    expect(results[1].sessionId).toBe(s1.id);
  });

  it('caps hits per session via snippetsPerSession', async () => {
    const s = await seedSession('S', [
      { id: 'm1', role: 'user', text: 'searchterm one' },
      { id: 'm2', role: 'model', text: 'searchterm two' },
      { id: 'm3', role: 'user', text: 'searchterm three' },
      { id: 'm4', role: 'model', text: 'searchterm four' },
    ]);
    expect(s.id).toBeTruthy();
    const results = await search.search('searchterm', { snippetsPerSession: 2 });
    expect(results).toHaveLength(1);
    expect(results[0].hits).toHaveLength(2);
  });

  it('respects the raw limit on SQL row count', async () => {
    await seedSession('S', [
      { id: 'm1', role: 'user', text: 'x' },
      { id: 'm2', role: 'user', text: 'x' },
      { id: 'm3', role: 'user', text: 'x' },
    ]);
    const results = await search.search('x', { limit: 2 });
    expect(results[0].hits).toHaveLength(2);
  });

  it('returns [] for empty query without preparing any statement', async () => {
    const spy = vi.spyOn(db, 'prepare');
    const results = await search.search('   ');
    expect(results).toEqual([]);
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it('returns [] on FTS5 syntax error (does not throw)', async () => {
    await seedSession('S', [{ id: 'm1', role: 'user', text: 'hello' }]);
    const results = await search.search('"foo');
    expect(results).toEqual([]);
  });

  it('snippet preserves literal HTML characters from user content', async () => {
    await seedSession('S', [
      { id: 'm1', role: 'user', text: 'beware of <script>alert(1)</script> in messages' },
    ]);
    const results = await search.search('alert');
    expect(results).toHaveLength(1);
    // SQLite does not HTML-escape: literal `<`, `>`, `(`, `)` stay as text in the snippet.
    // The «M» markers are the ONLY tags injected.
    const snippet = results[0].hits[0].snippet;
    expect(snippet).toContain('<script>');
    expect(snippet).toContain('</script>');
    expect(snippet).not.toContain('&lt;');
    expect(snippet).not.toContain('&gt;');
    expect(snippet).toContain('«M»alert«/M»');
  });

  it('title + updatedAt come from joined sessions row', async () => {
    const s = await seedSession('My Session', [
      { id: 'm1', role: 'user', text: 'searchword' },
    ]);
    const results = await search.search('searchword');
    expect(results[0].title).toBe('My Session');
    expect(typeof results[0].updatedAt).toBe('number');
    expect(results[0].updatedAt).toBeGreaterThan(0);
    expect(results[0].sessionId).toBe(s.id);
  });
});
