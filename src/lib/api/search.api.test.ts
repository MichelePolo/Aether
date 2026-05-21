import { describe, it, expect } from 'vitest';
import { http, HttpResponse } from 'msw';
import { server } from '@/src/test/msw-server';
import { searchApi } from './search.api';

describe('searchApi.search', () => {
  it('GETs /api/search?q=… and unwraps results', async () => {
    let receivedUrl = '';
    server.use(
      http.get('http://localhost/api/search', ({ request }) => {
        receivedUrl = request.url;
        return HttpResponse.json({
          results: [
            {
              sessionId: 'S1',
              title: 'Session 1',
              updatedAt: 1,
              hits: [{ messageId: 'm1', role: 'user', snippet: 'hello «M»world«/M»' }],
            },
          ],
        });
      }),
    );
    const results = await searchApi.search('world');
    expect(receivedUrl).toContain('q=world');
    expect(results).toHaveLength(1);
    expect(results[0].hits[0].snippet).toContain('«M»');
  });

  it('forwards the limit param when provided', async () => {
    let receivedUrl = '';
    server.use(
      http.get('http://localhost/api/search', ({ request }) => {
        receivedUrl = request.url;
        return HttpResponse.json({ results: [] });
      }),
    );
    await searchApi.search('x', { limit: 5 });
    expect(receivedUrl).toContain('limit=5');
  });
});
