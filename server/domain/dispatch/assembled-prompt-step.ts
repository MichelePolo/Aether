import type { ProviderToolDecl } from './providers/provider.types';

/**
 * Renders the verbatim payload sent to the LLM (system layer + declared tools)
 * for the live-only `assembled_prompt` reasoning step. The system instruction is
 * copied verbatim; tools are listed as `qualifiedName: description` only.
 */
export function formatAssembledPromptContent(
  systemInstruction: string,
  tools: ProviderToolDecl[],
): string {
  const header = `--- Tools declared to the model (${tools.length}) ---`;
  const lines = tools.map((t) => `- ${t.qualifiedName}: ${t.description ?? '(no description)'}`);
  return [systemInstruction.trim(), '', header, ...lines].join('\n');
}
