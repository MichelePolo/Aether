import { describe, it, expect } from 'vitest';
import {
  ProfileRecordSchema,
  ProfileImportSchema,
  ProfilesFileSchema,
} from './profiles.schema';

const validContext = {
  systemInstruction: 'You are Aether',
  skills: [],
  tools: [],
  mcpServers: [],
};

describe('ProfileRecordSchema', () => {
  it('parses valid record', () => {
    const rec = {
      name: 'My setup',
      createdAt: 1,
      updatedAt: 2,
      context: validContext,
      thinkingEnabled: false,
    };
    expect(ProfileRecordSchema.parse(rec)).toEqual(rec);
  });

  it('rejects empty name', () => {
    expect(() =>
      ProfileRecordSchema.parse({
        name: '',
        createdAt: 1,
        updatedAt: 1,
        context: validContext,
        thinkingEnabled: false,
      }),
    ).toThrow();
  });

  it('rejects name > 100 chars', () => {
    expect(() =>
      ProfileRecordSchema.parse({
        name: 'a'.repeat(101),
        createdAt: 1,
        updatedAt: 1,
        context: validContext,
        thinkingEnabled: false,
      }),
    ).toThrow();
  });

  it('rejects missing context', () => {
    expect(() =>
      ProfileRecordSchema.parse({
        name: 'x',
        createdAt: 1,
        updatedAt: 1,
        thinkingEnabled: false,
      } as unknown),
    ).toThrow();
  });

  it('rejects missing thinkingEnabled', () => {
    expect(() =>
      ProfileRecordSchema.parse({
        name: 'x',
        createdAt: 1,
        updatedAt: 1,
        context: validContext,
      } as unknown),
    ).toThrow();
  });
});

describe('ProfileImportSchema', () => {
  it('accepts minimal (context only)', () => {
    expect(ProfileImportSchema.parse({ context: validContext })).toEqual({ context: validContext });
  });

  it('accepts name + thinkingEnabled', () => {
    expect(
      ProfileImportSchema.parse({
        name: 'X',
        context: validContext,
        thinkingEnabled: true,
      }),
    ).toMatchObject({ name: 'X', thinkingEnabled: true });
  });

  it('passthrough extra fields (forward-compat)', () => {
    const parsed = ProfileImportSchema.parse({
      context: validContext,
      futureField: 'whatever',
    });
    expect(parsed).toHaveProperty('context');
    // extra fields preserved with passthrough but consumer may ignore
  });

  it('rejects missing context', () => {
    expect(() => ProfileImportSchema.parse({ name: 'x' })).toThrow();
  });
});

describe('ProfilesFileSchema', () => {
  it('parses populated', () => {
    const file = {
      '11111111-1111-1111-1111-111111111111': {
        name: 'A',
        createdAt: 1,
        updatedAt: 2,
        context: validContext,
        thinkingEnabled: false,
      },
    };
    expect(ProfilesFileSchema.parse(file)).toEqual(file);
  });

  it('accepts empty', () => {
    expect(ProfilesFileSchema.parse({})).toEqual({});
  });
});
