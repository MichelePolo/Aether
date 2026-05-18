import { describe, it, expect } from 'vitest';
import { MessageSchema, SessionRecordSchema, SessionsFileSchema } from './history.schema';

describe('MessageSchema', () => {
  it('parses minimal user message', () => {
    const msg = { id: 'a', role: 'user' as const, text: 'hi', timestamp: 1 };
    expect(MessageSchema.parse(msg)).toEqual(msg);
  });

  it('parses model message with optional fields', () => {
    const msg = {
      id: 'b',
      role: 'model' as const,
      text: 'hello',
      timestamp: 2,
      model: 'gemini-test',
      interrupted: false,
    };
    expect(MessageSchema.parse(msg).model).toBe('gemini-test');
  });

  it('rejects invalid role', () => {
    expect(() =>
      MessageSchema.parse({ id: 'x', role: 'admin', text: 't', timestamp: 1 }),
    ).toThrow();
  });
});

describe('SessionRecordSchema', () => {
  it('parses valid record', () => {
    const rec = { title: 'My chat', createdAt: 1, messages: [] };
    expect(SessionRecordSchema.parse(rec)).toEqual(rec);
  });

  it('accepts empty title', () => {
    expect(SessionRecordSchema.parse({ title: '', createdAt: 1, messages: [] })).toEqual({
      title: '',
      createdAt: 1,
      messages: [],
    });
  });

  it('rejects record without createdAt', () => {
    expect(() =>
      SessionRecordSchema.parse({ title: 't', messages: [] } as unknown),
    ).toThrow();
  });
});

describe('SessionsFileSchema', () => {
  it('parses populated file', () => {
    const file = {
      '11111111-1111-1111-1111-111111111111': {
        title: 'first',
        createdAt: 1,
        messages: [{ id: 'a', role: 'user' as const, text: 'hi', timestamp: 1 }],
      },
    };
    expect(SessionsFileSchema.parse(file)).toEqual(file);
  });

  it('accepts empty', () => {
    expect(SessionsFileSchema.parse({})).toEqual({});
  });

  it('rejects record values that are arrays (legacy V1 shape)', () => {
    expect(() =>
      SessionsFileSchema.parse({ default: [{ id: 'a', role: 'user', text: 'hi', timestamp: 1 }] }),
    ).toThrow();
  });
});
