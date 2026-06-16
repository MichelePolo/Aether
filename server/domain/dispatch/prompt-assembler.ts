import type { AetherContext, Tool } from '@/server/domain/context/context.types';
import type { SubAgentRecord } from '@/server/domain/subagents/subagents.types';
import type { ProviderToolDecl } from './providers/provider.types';
import type { PromptMaterialSkill } from '@/server/domain/skills/skills.types';

export interface AssembledPrompt {
  systemInstruction: string;
  skills: string[];
  tools: Tool[];
  message: string;
  subAgent: string | null;
  mcpTools: ProviderToolDecl[];
}

function dedupStrings(arr: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const s of arr) {
    if (seen.has(s)) continue;
    seen.add(s);
    out.push(s);
  }
  return out;
}

function dedupToolsById(arr: Tool[]): Tool[] {
  const seen = new Set<string>();
  const out: Tool[] = [];
  for (const t of arr) {
    if (seen.has(t.id)) continue;
    seen.add(t.id);
    out.push(t);
  }
  return out;
}

function activeSkillNames(skills: AetherContext['skills']): string[] {
  return skills.filter((s) => s.enabled).map((s) => s.name);
}

function buildSkillsBlock(labelNames: string[], material: PromptMaterialSkill[]): string {
  if (labelNames.length === 0 && material.length === 0) return '';
  const nonPinned = material.filter((m) => !m.pinned);
  const pinned = material.filter((m) => m.pinned);

  const header: string[] = ['# Active Skills'];
  for (const n of labelNames) header.push(`- ${n}`);
  for (const m of nonPinned) header.push(`- ${m.name}: ${m.description}`);
  const parts: string[] = [header.join('\n')];

  if (nonPinned.length > 0) {
    const list = nonPinned.map((m) => `- ${m.name}: ${m.dir}/SKILL.md`).join('\n');
    parts.push(
      'For the skills above with a description, the full instructions and any referenced ' +
        'files live on disk. When a skill is relevant, read its SKILL.md (and the files it ' +
        'points to) via the filesystem before acting:\n' +
        list,
    );
  }
  for (const m of pinned) {
    parts.push(`## Skill: ${m.name}\n\n${(m.body ?? '').trim()}`);
  }
  return parts.join('\n\n');
}

function withSkillsBlock(
  systemInstruction: string,
  labelNames: string[],
  material: PromptMaterialSkill[],
): string {
  const block = buildSkillsBlock(labelNames, material);
  if (!block) return systemInstruction;
  return [systemInstruction.trim(), block].filter(Boolean).join('\n\n');
}

export function assemble(
  ctx: AetherContext,
  subAgent: SubAgentRecord | null,
  parsedMessage: string,
  resolvedName: string | null,
  mcpTools: ProviderToolDecl[] = [],
  materialSkills: PromptMaterialSkill[] = [],
): AssembledPrompt {
  const materialNames = materialSkills.map((m) => m.name);
  if (!subAgent) {
    const labels = activeSkillNames(ctx.skills);
    return {
      systemInstruction: withSkillsBlock(ctx.systemInstruction, labels, materialSkills),
      skills: dedupStrings([...labels, ...materialNames]),
      tools: ctx.tools,
      message: parsedMessage,
      subAgent: null,
      mcpTools,
    };
  }
  const baseSys = [
    ctx.systemInstruction.trim(),
    `# Sub-agent: ${subAgent.name}`,
    subAgent.systemInstruction.trim(),
  ]
    .filter(Boolean)
    .join('\n\n');
  const labels = dedupStrings([...activeSkillNames(ctx.skills), ...subAgent.skills]);
  const tools = dedupToolsById([...ctx.tools, ...subAgent.tools]);
  return {
    systemInstruction: withSkillsBlock(baseSys, labels, materialSkills),
    skills: dedupStrings([...labels, ...materialNames]),
    tools,
    message: parsedMessage,
    subAgent: resolvedName,
    mcpTools,
  };
}
