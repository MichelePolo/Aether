import type { ProviderRequest } from './provider.types';

/**
 * Render the whole turn as ONE user-role message. Agentic-CLI providers
 * (Anthropic via the Agent SDK, Codex via `codex exec`) cannot replay prior
 * assistant turns structurally, so history is flattened into a text
 * transcript, with `pendingAssistantText` marking an interrupted response to
 * continue.
 */
export function renderConversation(req: ProviderRequest): string {
  const parts: string[] = [];
  if (req.history.length > 0) {
    parts.push('# Conversation so far');
    for (const h of req.history) {
      parts.push(`${h.role === 'model' ? 'Assistant' : 'User'}: ${h.text}`);
    }
    parts.push('');
  }
  if (req.pendingAssistantText && req.pendingAssistantText.length > 0) {
    parts.push(`Assistant (interrupted — continue this response): ${req.pendingAssistantText}`);
    parts.push('');
  }
  parts.push(req.userMessage);
  return parts.join('\n');
}
