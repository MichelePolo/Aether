import { useSessionsStore } from '@/src/stores/sessions.store';
import { useChatStore } from '@/src/stores/chat.store';
import { useSkillsStore } from '@/src/stores/skills.store';
import { SKILL_SMITH_NAME } from '@/server/domain/subagents/skill-smith';

export interface CreateSkillFlowInput {
  providerName: string;
  idea: string;
}

/**
 * Open a dedicated generation session: create + activate a session, bind the
 * chosen provider, and prefill the composer with an @skill-smith mention that
 * carries the absolute drafts path. The user reviews the prefilled message and
 * sends it to start the brainstorm -> generate flow.
 */
export async function createSkillFlow({ providerName, idea }: CreateSkillFlowInput): Promise<void> {
  const sessions = useSessionsStore.getState();
  const session = await sessions.create();
  await sessions.setProviderName(session.id, providerName).catch(() => {});

  const draftsDir = useSkillsStore.getState().paths?.draftsDir ?? '.drafts';
  const trimmedIdea = idea.trim();
  const ideaSentence = trimmedIdea ? ` My idea: ${trimmedIdea}` : '';
  const prefill =
    `@${SKILL_SMITH_NAME} Help me create a new Aether skill. ` +
    `Write the generated skill into a new folder under \`${draftsDir}/<slug>/\`. ` +
    `Read your brainstorming and skill-creator guide skills first.${ideaSentence}`;

  useChatStore.getState().setPendingComposerText(prefill);
}
