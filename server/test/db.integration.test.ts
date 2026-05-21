import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { makeTestDb } from './test-db';
import { ContextStore } from '@/server/domain/context/context.store';
import { HistoryStore } from '@/server/domain/history/history.store';
import { ProfilesStore } from '@/server/domain/profiles/profiles.store';
import { SubAgentsStore } from '@/server/domain/subagents/subagents.store';
import type { DatabaseHandle } from '@/server/db/database';

let db: DatabaseHandle;
let context: ContextStore;
let history: HistoryStore;
let profiles: ProfilesStore;
let subagents: SubAgentsStore;

beforeEach(() => {
  db = makeTestDb();
  context = new ContextStore(db);
  history = new HistoryStore(db);
  profiles = new ProfilesStore(db);
  subagents = new SubAgentsStore(db);
});

afterEach(() => {
  db.close();
});

describe('SQLite stores — cross-store integration', () => {
  it('end-to-end: create profile from current context, create session, append message, verify all reads agree', async () => {
    await context.addSkill('typescript');
    const tool = await context.addTool({ name: 'GoogleSearch', version: '1.0', status: 'online' });
    const srv = await context.addMcpServer({
      name: 'mock',
      transport: 'mock',
      status: 'offline',
    });
    const ctx = await context.read();
    expect(ctx.skills).toContain('typescript');
    expect(ctx.tools.map((t) => t.id)).toContain(tool.id);
    expect(ctx.mcpServers.map((s) => s.id)).toContain(srv.id);

    const profile = await profiles.create({
      name: 'dev',
      context: ctx,
      thinkingEnabled: true,
    });
    const readProfile = await profiles.read(profile.id);
    expect(readProfile!.context.skills).toContain('typescript');
    expect(readProfile!.context.tools.map((t) => t.id)).toContain(tool.id);

    const designer = await subagents.create({
      name: 'designer',
      systemInstruction: 'You design.',
      skills: ['layout'],
      tools: [{ id: 't1', name: 'X', version: '1', status: 'online' }],
    });
    const readDesigner = await subagents.read(designer.id);
    expect(readDesigner!.skills).toEqual(['layout']);

    const session = await history.createEmpty({ providerName: 'fake:default' });
    await history.append(session.id, {
      id: 'm1',
      role: 'user',
      text: 'ping',
      timestamp: Date.now(),
    });
    await history.append(session.id, {
      id: 'm2',
      role: 'model',
      text: 'pong',
      timestamp: Date.now() + 1,
      model: 'fake-1',
      reasoningSteps: [{
        id: 'r1',
        type: 'tool_call',
        title: 'Tool: mock.echo',
        content: 'used mock.echo',
        durationMs: 5,
        timestamp: Date.now(),
        toolCall: {
          id: 'TC1',
          qualifiedName: 'mock.echo',
          args: { message: 'ping' },
          result: { message: 'ping' },
          durationMs: 5,
        },
      }],
    });

    const messages = await history.read(session.id);
    expect(messages).toHaveLength(2);
    expect(messages![0]).toMatchObject({ id: 'm1', role: 'user' });
    expect(messages![1].reasoningSteps).toHaveLength(1);
    expect(messages![1].reasoningSteps![0].toolCall?.qualifiedName).toBe('mock.echo');

    await history.delete(session.id);
    expect(await history.listSessions()).toEqual([]);
    expect((await profiles.listProfiles())[0].id).toBe(profile.id);
    expect((await subagents.list())[0].id).toBe(designer.id);
    expect((await context.read()).skills).toContain('typescript');
  });
});
