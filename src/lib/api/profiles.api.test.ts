import { describe, it, expect } from 'vitest';
import { http, HttpResponse } from 'msw';
import { server } from '@/src/test/msw-server';
import { profilesApi } from './profiles.api';

const ctx = {
  systemInstruction: '',
  skills: [],
  tools: [],
  mcpServers: [],
};

describe('profilesApi', () => {
  it('list returns profiles array', async () => {
    server.use(
      http.get('http://localhost/api/profiles', () =>
        HttpResponse.json({
          profiles: [{ id: 'a', name: 'A', createdAt: 1, updatedAt: 2 }],
        }),
      ),
    );
    const out = await profilesApi.list();
    expect(out).toHaveLength(1);
  });

  it('get returns full ProfileRecord', async () => {
    const out = await profilesApi.get('msw-prof-1');
    expect(out).toMatchObject({ name: 'msw', thinkingEnabled: false });
  });

  it('get throws on 404', async () => {
    server.use(
      http.get('http://localhost/api/profiles/:id', () =>
        HttpResponse.json({ error: { message: 'not found' } }, { status: 404 }),
      ),
    );
    await expect(profilesApi.get('nope')).rejects.toThrow();
  });

  it('create POSTs', async () => {
    server.use(
      http.post('http://localhost/api/profiles', () =>
        HttpResponse.json({ id: 'NEW', name: 'X', createdAt: 1, updatedAt: 1 }, { status: 201 }),
      ),
    );
    const out = await profilesApi.create({ name: 'X', context: ctx, thinkingEnabled: false });
    expect(out.id).toBe('NEW');
  });

  it('create throws on 400', async () => {
    server.use(
      http.post('http://localhost/api/profiles', () =>
        HttpResponse.json({ error: { message: 'bad' } }, { status: 400 }),
      ),
    );
    await expect(
      profilesApi.create({ name: '', context: ctx, thinkingEnabled: false }),
    ).rejects.toThrow(/bad/);
  });

  it('update PUTs', async () => {
    server.use(
      http.put('http://localhost/api/profiles/:id', ({ params }) =>
        HttpResponse.json({ id: params.id, name: 'X', createdAt: 1, updatedAt: 2 }),
      ),
    );
    const out = await profilesApi.update('abc', {
      name: 'X',
      createdAt: 1,
      updatedAt: 2,
      context: ctx,
      thinkingEnabled: true,
    });
    expect(out).toMatchObject({ id: 'abc', name: 'X' });
  });

  it('rename PATCHes', async () => {
    server.use(
      http.patch('http://localhost/api/profiles/:id', ({ params }) =>
        HttpResponse.json({ id: params.id, name: 'Y', createdAt: 1, updatedAt: 2 }),
      ),
    );
    const out = await profilesApi.rename('abc', 'Y');
    expect(out.name).toBe('Y');
  });

  it('delete hits DELETE', async () => {
    let called = false;
    server.use(
      http.delete('http://localhost/api/profiles/:id', () => {
        called = true;
        return new HttpResponse(null, { status: 204 });
      }),
    );
    await profilesApi.delete('abc');
    expect(called).toBe(true);
  });

  it('delete throws on 404', async () => {
    server.use(
      http.delete('http://localhost/api/profiles/:id', () =>
        HttpResponse.json({ error: { message: 'not found' } }, { status: 404 }),
      ),
    );
    await expect(profilesApi.delete('nope')).rejects.toThrow();
  });

  it('importJson POSTs to /import', async () => {
    server.use(
      http.post('http://localhost/api/profiles/import', () =>
        HttpResponse.json(
          { id: 'IMP', name: 'Imported', createdAt: 1, updatedAt: 1 },
          { status: 201 },
        ),
      ),
    );
    const out = await profilesApi.importJson({ context: ctx });
    expect(out.id).toBe('IMP');
  });

  it('importJson throws on 400', async () => {
    server.use(
      http.post('http://localhost/api/profiles/import', () =>
        HttpResponse.json({ error: { message: 'invalid' } }, { status: 400 }),
      ),
    );
    await expect(profilesApi.importJson({ broken: true })).rejects.toThrow(/invalid/);
  });
});
