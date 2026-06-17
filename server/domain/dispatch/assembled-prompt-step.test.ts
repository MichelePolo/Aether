import { formatAssembledPromptContent } from './assembled-prompt-step';
import type { ProviderToolDecl } from './providers/provider.types';

describe('formatAssembledPromptContent', () => {
  it('includes the verbatim system instruction and a tool list', () => {
    const tools: ProviderToolDecl[] = [
      { qualifiedName: 'mcp__fs__read', description: 'Read a file', schema: { type: 'object' } },
      { qualifiedName: 'mcp__fs__write', schema: { type: 'object' } },
    ];
    const out = formatAssembledPromptContent('SYSTEM PROMPT VERBATIM', tools);
    expect(out).toContain('SYSTEM PROMPT VERBATIM');
    expect(out).toContain('--- Tools declared to the model (2) ---');
    expect(out).toContain('- mcp__fs__read: Read a file');
    expect(out).toContain('- mcp__fs__write: (no description)');
  });

  it('renders the header with zero tools and no bullets', () => {
    const out = formatAssembledPromptContent('SYS', []);
    expect(out).toContain('--- Tools declared to the model (0) ---');
    expect(out).not.toContain('\n- ');
  });
});
