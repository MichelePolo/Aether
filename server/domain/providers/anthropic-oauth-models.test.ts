import type { query } from '@anthropic-ai/claude-agent-sdk';
import { canonicalModelId, discoverAnthropicOAuthModels } from './anthropic-oauth-models';

type ModelRow = { value: string; resolvedModel?: string; displayName: string; description: string };

/** Fake `query()` whose session answers supportedModels with `rows` (or the given promise). */
function fakeQuery(rows: ModelRow[] | Promise<ModelRow[]>) {
  const close = vi.fn();
  let capturedOptions: Record<string, unknown> | undefined;
  const impl = ((args: { options: Record<string, unknown> }) => {
    capturedOptions = args.options;
    return { supportedModels: () => Promise.resolve(rows), close };
  }) as unknown as typeof query;
  return { impl, close, options: () => capturedOptions };
}

describe('canonicalModelId', () => {
  it.each([
    ['claude-opus-5-5', 'claude-opus-5-5'],
    ['claude-opus-5[1m]', 'claude-opus-5'],
    ['claude-haiku-4-5-20251001', 'claude-haiku-4-5'],
    ['default', null],
    ['sonnet', null],
  ])('%s → %s', (raw, expected) => {
    expect(canonicalModelId(raw)).toBe(expected);
  });
});

describe('discoverAnthropicOAuthModels', () => {
  beforeEach(() => { vi.spyOn(console, 'warn').mockImplementation(() => {}); });
  afterEach(() => { vi.restoreAllMocks(); });

  it('returns canonical, deduplicated IDs in SDK order, preferring resolvedModel', async () => {
    const fake = fakeQuery([
      { value: 'default', resolvedModel: 'claude-opus-5-5', displayName: 'Default', description: '' },
      { value: 'opus', resolvedModel: 'claude-opus-5-5', displayName: 'Opus', description: '' },
      { value: 'claude-fable-5-1[1m]', resolvedModel: 'claude-fable-5-1', displayName: 'Fable', description: '' },
      { value: 'claude-sonnet-4-6', displayName: 'Sonnet 4.6', description: '' },
      { value: 'haiku', displayName: 'Haiku (unresolved alias)', description: '' },
    ]);
    await expect(discoverAnthropicOAuthModels({ queryImpl: fake.impl })).resolves.toEqual([
      'claude-opus-5-5',
      'claude-fable-5-1',
      'claude-sonnet-4-6',
    ]);
    expect(fake.close).toHaveBeenCalledOnce();
  });

  it('runs isolated like the provider and passes the auth env through', async () => {
    const fake = fakeQuery([]);
    await discoverAnthropicOAuthModels({ queryImpl: fake.impl, resolveAuthEnv: () => ({ CLAUDE_CODE_OAUTH_TOKEN: 'tok' }) });
    expect(fake.options()).toMatchObject({ tools: [], settingSources: [], env: expect.objectContaining({ CLAUDE_CODE_OAUTH_TOKEN: 'tok' }) });
  });

  it('returns [] and closes the session when the SDK fails', async () => {
    const fake = fakeQuery(Promise.reject(new Error('not logged in')));
    await expect(discoverAnthropicOAuthModels({ queryImpl: fake.impl })).resolves.toEqual([]);
    expect(fake.close).toHaveBeenCalledOnce();
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('not logged in'));
  });

  it('returns [] when supportedModels never answers', async () => {
    const fake = fakeQuery(new Promise<ModelRow[]>(() => {}));
    await expect(discoverAnthropicOAuthModels({ queryImpl: fake.impl, timeoutMs: 20 })).resolves.toEqual([]);
    expect(fake.close).toHaveBeenCalledOnce();
  });
});
