import { describe, it, expect } from 'vitest';
import { MessageSchema, SessionsFileSchema } from './history.schema';

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
      error: undefined,
      retryable: undefined,
    };
    const parsed = MessageSchema.parse(msg);
    expect(parsed.model).toBe('gemini-test');
    expect(parsed.interrupted).toBe(false);
  });

  it('rejects invalid role', () => {
    expect(() =>
      MessageSchema.parse({ id: 'x', role: 'admin', text: 't', timestamp: 1 }),
    ).toThrow();
  });

  it('rejects missing required fields', () => {
    expect(() => MessageSchema.parse({ role: 'user', text: 'x' })).toThrow();
  });

  it('SessionsFileSchema parses { default: Message[] }', () => {
    const file = {
      default: [
        { id: '1', role: 'user' as const, text: 'a', timestamp: 1 },
        { id: '2', role: 'model' as const, text: 'b', timestamp: 2 },
      ],
    };
    expect(SessionsFileSchema.parse(file).default).toHaveLength(2);
  });

  it('SessionsFileSchema accepts empty', () => {
    expect(SessionsFileSchema.parse({})).toEqual({});
  });
});
