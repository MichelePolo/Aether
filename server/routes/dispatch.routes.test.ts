import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createApp } from '@/server/app';
import { ContextStore } from '@/server/domain/context/context.store';
import { HistoryStore } from '@/server/domain/history/history.store';
import { DispatchService } from '@/server/domain/dispatch/dispatch.service';
import { FakeProvider } from '@/server/domain/dispatch/providers/fake.provider';
import { collectSseEvents } from '@/server/test/sse-collector';

let dir: string;
let contextStore: ContextStore;
let historyStore: HistoryStore;

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'aether-disp-routes-'));
  contextStore = new ContextStore(path.join(dir, 'context.json'));
  historyStore = new HistoryStore(path.join(dir, 'sessions.json'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

function appWith(chunks: string[]) {
  const provider = new FakeProvider({ chunks });
  const dispatcher = new DispatchService({ provider, historyStore, contextStore });
  return createApp({ contextStore, historyStore, dispatcher });
}

describe('/api/ai/dispatch', () => {
  it('streams text + done events', async () => {
    const app = appWith(['Hello', ' world']);
    const res = await request(app)
      .post('/api/ai/dispatch')
      .set('Accept', 'text/event-stream')
      .send({ message: 'hi' });
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/event-stream/);
    const events = await collectSseEvents(res);
    expect(events.map((e) => e.event)).toEqual(['text', 'text', 'done']);
    expect(events[0].data).toEqual({ chunk: 'Hello' });
  });

  it('persists messages after success', async () => {
    const app = appWith(['pong']);
    await request(app).post('/api/ai/dispatch').send({ message: 'ping' });
    const msgs = await historyStore.read();
    expect(msgs.map((m) => `${m.role}:${m.text}`)).toEqual(['user:ping', 'model:pong']);
  });

  it('emits error event for invalid body', async () => {
    const app = appWith(['x']);
    const res = await request(app).post('/api/ai/dispatch').send({});
    const events = await collectSseEvents(res);
    expect(events.find((e) => e.event === 'error')).toBeDefined();
  });

  it('returns 503 when dispatcher is not configured', async () => {
    const app = createApp({ contextStore, historyStore });
    const res = await request(app).post('/api/ai/dispatch').send({ message: 'x' });
    expect(res.status).toBe(503);
  });
});
