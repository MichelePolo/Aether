import { describe, it, expect } from 'vitest';
import {
  EXPORT_VERSION,
  exportEnvelopeSchema,
  wrap,
  slugifyFilename,
} from './history.export';
import type { SessionRecord } from './history.types';

describe('EXPORT_VERSION', () => {
  it('is 1', () => {
    expect(EXPORT_VERSION).toBe(1);
  });
});

describe('wrap', () => {
  it('produces a versioned envelope around a SessionRecord', () => {
    const record: SessionRecord = {
      title: 'demo',
      createdAt: 100,
      providerName: 'fake:default',
      messages: [{ id: 'm1', role: 'user', text: 'hi', timestamp: 100 }],
    };
    const env = wrap(record, 12345);
    expect(env).toEqual({
      app: 'aether',
      version: 1,
      exportedAt: 12345,
      session: record,
    });
  });
});

describe('exportEnvelopeSchema (lenient)', () => {
  const valid = {
    app: 'aether',
    version: 1,
    exportedAt: 1,
    session: {
      title: 't',
      createdAt: 0,
      messages: [{ id: 'm1', role: 'user', text: 'hi', timestamp: 0 }],
    },
  };

  it('accepts a minimal valid envelope', () => {
    const parsed = exportEnvelopeSchema.parse(valid);
    expect(parsed.session.messages).toHaveLength(1);
  });

  it('drops unknown top-level keys silently', () => {
    const withExtras = { ...valid, junk: 'ignored' };
    const parsed = exportEnvelopeSchema.parse(withExtras) as unknown as Record<
      string,
      unknown
    >;
    expect(parsed.junk).toBeUndefined();
  });

  it('drops unknown keys inside session.messages[i]', () => {
    const withExtras = {
      ...valid,
      session: {
        ...valid.session,
        messages: [{ ...valid.session.messages[0], surprise: true }],
      },
    };
    const parsed = exportEnvelopeSchema.parse(withExtras);
    expect(
      (parsed.session.messages[0] as unknown as Record<string, unknown>).surprise,
    ).toBeUndefined();
  });

  it('rejects wrong app discriminator', () => {
    expect(() =>
      exportEnvelopeSchema.parse({ ...valid, app: 'something-else' }),
    ).toThrow();
  });

  it('rejects unsupported version', () => {
    expect(() =>
      exportEnvelopeSchema.parse({ ...valid, version: 2 }),
    ).toThrow();
  });

  it('rejects missing session.messages', () => {
    expect(() =>
      exportEnvelopeSchema.parse({
        ...valid,
        session: { title: 't', createdAt: 0 },
      }),
    ).toThrow();
  });

  it('accepts an empty messages array', () => {
    const parsed = exportEnvelopeSchema.parse({
      ...valid,
      session: { ...valid.session, messages: [] },
    });
    expect(parsed.session.messages).toEqual([]);
  });
});

describe('slugifyFilename', () => {
  it('produces aether-session-<slug>-<ts>.json for a normal title', () => {
    // 2026-05-22 18:30 UTC == 1779863400000
    const name = slugifyFilename('My Chat!', 1779863400000);
    expect(name).toMatch(/^aether-session-my-chat-\d{8}-\d{4}\.json$/);
  });

  it('falls back to "untitled" for empty title', () => {
    const name = slugifyFilename('', 1779863400000);
    expect(name).toMatch(/^aether-session-untitled-\d{8}-\d{4}\.json$/);
  });

  it('collapses runs of non-alphanumerics into single dashes', () => {
    const name = slugifyFilename('  hello   world  ', 1779863400000);
    expect(name).toMatch(/^aether-session-hello-world-\d{8}-\d{4}\.json$/);
  });

  it('trims leading and trailing dashes', () => {
    const name = slugifyFilename('!!!foo!!!', 1779863400000);
    expect(name).toMatch(/^aether-session-foo-\d{8}-\d{4}\.json$/);
  });

  it('clamps the slug to 60 chars', () => {
    const long = 'a'.repeat(200);
    const name = slugifyFilename(long, 1779863400000);
    const slug = name.replace(/^aether-session-/, '').replace(/-\d{8}-\d{4}\.json$/, '');
    expect(slug.length).toBeLessThanOrEqual(60);
  });
});
