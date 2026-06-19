import { http, HttpResponse } from 'msw';
import type { AetherContext } from '@/src/types/context.types';

const defaultContext: AetherContext = {
  systemInstruction: 'You are Aether',
  skills: [],
  tools: [],
  mcpServers: [],
};

export const handlers = [
  http.get('http://localhost/api/__health', () => HttpResponse.json({ ok: true })),
  http.get('http://localhost/api/context', () => HttpResponse.json(defaultContext)),
  http.get('http://localhost/api/sessions', () => HttpResponse.json({ sessions: [] })),
  http.post('http://localhost/api/sessions', () =>
    HttpResponse.json(
      { id: 'msw-session-1', title: '', createdAt: 0, updatedAt: 0 },
      { status: 201 },
    ),
  ),
  http.get('http://localhost/api/sessions/:id', () => HttpResponse.json({ messages: [] })),
  http.patch('http://localhost/api/sessions/:id', ({ params }) =>
    HttpResponse.json({ id: params.id, title: 'renamed', createdAt: 0, updatedAt: 0 }),
  ),
  http.delete('http://localhost/api/sessions/:id', () => new HttpResponse(null, { status: 204 })),
  http.get('http://localhost/api/workspaces', () =>
    HttpResponse.json({ workspaces: [] }),
  ),
  http.post('http://localhost/api/workspaces', async ({ request }) => {
    const body = (await request.json()) as { name: string; rootPath: string };
    return HttpResponse.json(
      { id: `w-${Date.now()}`, name: body.name, rootPath: body.rootPath, addedAt: Date.now() },
      { status: 201 },
    );
  }),
  http.patch('http://localhost/api/workspaces/:id', async ({ params, request }) => {
    const body = (await request.json()) as { name: string };
    return HttpResponse.json({
      id: params.id,
      name: body.name,
      rootPath: '/tmp/p',
      addedAt: Date.now(),
    });
  }),
  http.delete('http://localhost/api/workspaces/:id', () =>
    new HttpResponse(null, { status: 204 }),
  ),
  http.get('http://localhost/api/workspaces/browse', ({ request }) => {
    const path = new URL(request.url).searchParams.get('path') ?? '/home/user';
    return HttpResponse.json({ path, entries: [{ name: 'sub', isDir: true }] });
  }),
  http.get('http://localhost/api/profiles', () => HttpResponse.json({ profiles: [] })),
  http.post('http://localhost/api/profiles', () =>
    HttpResponse.json(
      { id: 'msw-prof-1', name: 'New', createdAt: 0, updatedAt: 0 },
      { status: 201 },
    ),
  ),
  http.get('http://localhost/api/profiles/:id', () =>
    HttpResponse.json({
      name: 'msw',
      createdAt: 0,
      updatedAt: 0,
      context: { systemInstruction: '', skills: [], tools: [], mcpServers: [] },
      thinkingEnabled: false,
    }),
  ),
  http.put('http://localhost/api/profiles/:id', ({ params }) =>
    HttpResponse.json({ id: params.id, name: 'msw', createdAt: 0, updatedAt: 1 }),
  ),
  http.patch('http://localhost/api/profiles/:id', ({ params }) =>
    HttpResponse.json({ id: params.id, name: 'renamed', createdAt: 0, updatedAt: 1 }),
  ),
  http.delete('http://localhost/api/profiles/:id', () => new HttpResponse(null, { status: 204 })),
  http.post('http://localhost/api/profiles/import', () =>
    HttpResponse.json(
      { id: 'msw-imp-1', name: 'Imported', createdAt: 0, updatedAt: 0 },
      { status: 201 },
    ),
  ),
  http.get('http://localhost/api/subagents', () => HttpResponse.json({ subAgents: [] })),
  http.post('http://localhost/api/subagents', async ({ request }) => {
    const body = (await request.json()) as { name: string };
    return HttpResponse.json(
      { id: `sa-${Date.now()}`, name: body.name, createdAt: Date.now(), updatedAt: Date.now() },
      { status: 201 },
    );
  }),
  http.get('http://localhost/api/subagents/:id', ({ params }) =>
    HttpResponse.json({
      id: params.id,
      name: 'default',
      systemInstruction: '',
      skills: [],
      tools: [],
      createdAt: 1,
      updatedAt: 1,
    }),
  ),
  http.put('http://localhost/api/subagents/:id', ({ params }) =>
    HttpResponse.json({
      id: params.id,
      name: 'updated',
      createdAt: 1,
      updatedAt: Date.now(),
    }),
  ),
  http.delete('http://localhost/api/subagents/:id', () => new HttpResponse(null, { status: 204 })),
  http.post('http://localhost/api/mcp/:id/connect', () =>
    HttpResponse.json({ state: 'online', tools: [] }),
  ),
  http.post('http://localhost/api/mcp/:id/disconnect', () => new HttpResponse(null, { status: 204 })),
  http.get('http://localhost/api/mcp/tools', () => HttpResponse.json({ tools: [] })),
  http.patch('http://localhost/api/mcp/:id/tools/:name', async ({ request }) => {
    const body = (await request.json()) as { autoApprove: boolean };
    return HttpResponse.json(body);
  }),
  http.post('http://localhost/api/mcp/decision', () => new HttpResponse(null, { status: 204 })),
  http.get('http://localhost/api/mcp/state', () => HttpResponse.json({ servers: [] })),
  http.post('http://localhost/api/mcp/:id/refresh-tools', () =>
    HttpResponse.json({ tools: [] }),
  ),
  http.post('http://localhost/api/mcp/cancel-call', () =>
    new HttpResponse(null, { status: 204 }),
  ),
  http.get('http://localhost/api/breakpoints/policy', () =>
    HttpResponse.json({ safe: 'auto', dangerous: 'gate', external: 'gate' }),
  ),
  http.put('http://localhost/api/breakpoints/policy/:category', async ({ params, request }) => {
    const body = (await request.json()) as { mode: 'auto' | 'gate' };
    const base: Record<string, 'auto' | 'gate'> = { safe: 'auto', dangerous: 'gate', external: 'gate' };
    base[params.category as string] = body.mode;
    return HttpResponse.json(base);
  }),
  http.post('http://localhost/api/breakpoints/preview', () =>
    HttpResponse.json({ kind: 'plain' }),
  ),
  http.get('http://localhost/api/breakpoints/classify', ({ request }) => {
    const url = new URL(request.url);
    const qn = url.searchParams.get('qualifiedName') ?? '';
    const isWrite = /\.(write|edit|delete|move|create|remove|rename|drop|truncate)_/.test(qn);
    return HttpResponse.json({
      qualifiedName: qn,
      category: isWrite ? 'dangerous' : 'safe',
      source: 'heuristic',
    });
  }),
  http.get('http://localhost/api/mcp/builtin', () =>
    HttpResponse.json({
      builtins: [
        { transport: 'filesystem', enabled: false, fsRoot: null },
        { transport: 'terminal', enabled: false, fsRoot: null },
      ],
    }),
  ),
  http.put('http://localhost/api/mcp/builtin/:transport', async ({ params, request }) => {
    const body = (await request.json()) as { enabled?: boolean; fsRoot?: string | null };
    return HttpResponse.json({
      state: {
        transport: params.transport,
        enabled: body.enabled ?? false,
        fsRoot: body.fsRoot ?? null,
      },
    });
  }),
  http.get('http://localhost/api/providers', () =>
    HttpResponse.json({
      providers: [
        {
          name: 'fake:default',
          transport: 'fake',
          model: 'default',
          capabilities: { thinking: true, toolCalling: true },
          displayName: 'Fake (default)',
        },
      ],
    }),
  ),
  http.post('http://localhost/api/providers/refresh', () =>
    HttpResponse.json({ providers: [] }),
  ),
  http.get('http://localhost/api/providers/default', () =>
    HttpResponse.json({ name: 'fake:default' }),
  ),
  http.get('http://localhost/api/search', () =>
    HttpResponse.json({ results: [] }),
  ),
  http.get('http://localhost/api/sessions/:id/export', ({ params }) =>
    HttpResponse.json({
      app: 'aether',
      version: 1,
      exportedAt: 0,
      session: {
        title: `exported-${params.id}`,
        createdAt: 0,
        messages: [],
      },
    }),
  ),
  http.post('http://localhost/api/sessions/import', async ({ request }) => {
    const body = (await request.json()) as { session?: { title?: string } };
    return HttpResponse.json(
      {
        id: `imp-${Date.now()}`,
        title: body?.session?.title ?? 'imported',
        createdAt: Date.now(),
        updatedAt: Date.now(),
      },
      { status: 201 },
    );
  }),
  http.get('http://localhost/api/providers/auth-status', () =>
    HttpResponse.json({
      checkedAt: 0,
      statuses: [
        { transport: 'anthropic', state: 'unconfigured', reason: 'no api key' },
        { transport: 'openai', state: 'unconfigured', reason: 'no api key' },
        { transport: 'gemini', state: 'unconfigured', reason: 'no api key' },
      ],
      ollama: [
        { id: 'local', label: 'local', fixed: true, state: 'unconfigured', reason: 'no api key' },
      ],
    }),
  ),
  http.post('http://localhost/api/providers/auth-status/refresh', () =>
    HttpResponse.json({
      checkedAt: Date.now(),
      statuses: [
        { transport: 'anthropic', state: 'unconfigured', reason: 'no api key' },
        { transport: 'openai', state: 'unconfigured', reason: 'no api key' },
        { transport: 'gemini', state: 'unconfigured', reason: 'no api key' },
      ],
      ollama: [
        { id: 'local', label: 'local', fixed: true, state: 'unconfigured', reason: 'no api key' },
      ],
    }),
  ),
  http.get('http://localhost/api/providers/keys', () =>
    HttpResponse.json({
      vault: [
        { transport: 'anthropic', hasKey: false, masked: null, updatedAt: null },
        { transport: 'openai', hasKey: false, masked: null, updatedAt: null },
        { transport: 'gemini', hasKey: false, masked: null, updatedAt: null },
      ],
      info: [
        { transport: 'anthropic-oauth', label: 'Anthropic OAuth (via claude CLI)', status: 'detected' },
        { transport: 'ollama', label: 'Ollama', status: 'Host: http://localhost:11434' },
      ],
    }),
  ),
  http.put('http://localhost/api/providers/keys/:transport', async ({ params, request }) => {
    const body = (await request.json()) as { key: string };
    const masked = body.key.length > 8 ? `${body.key.slice(0, 3)}…${body.key.slice(-4)}` : '***';
    return HttpResponse.json({
      row: {
        transport: params.transport,
        hasKey: true,
        masked,
        updatedAt: Date.now(),
      },
      status: { transport: params.transport, state: 'ok', reason: 'api key set' },
    });
  }),
  http.delete('http://localhost/api/providers/keys/:transport', ({ params }) =>
    HttpResponse.json({
      status: { transport: params.transport, state: 'unconfigured', reason: 'no api key' },
    }),
  ),
  http.get('http://localhost/api/providers/keys/:transport', ({ params }) =>
    HttpResponse.json({ plaintext: `mock-${params.transport}-key` }),
  ),
  http.post('http://localhost/api/sessions/:id/fork', () =>
    HttpResponse.json(
      {
        meta: {
          id: `fork-${Date.now()}`,
          title: 'forked',
          createdAt: Date.now(),
          updatedAt: Date.now(),
        },
      },
      { status: 201 },
    ),
  ),
  http.get('http://localhost/api/attachments/:id', () => {
    // 1x1 transparent PNG
    const png = Uint8Array.from(
      atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkAAIAAAoAAv/lxKUAAAAASUVORK5CYII='),
      (c) => c.charCodeAt(0),
    );
    return new HttpResponse(png, {
      status: 200,
      headers: { 'Content-Type': 'image/png' },
    });
  }),
];
