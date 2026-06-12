import type { AetherContext, Tool } from '@/server/domain/context/context.types';
import type { SubAgentRecord } from '@/server/domain/subagents/subagents.types';
import type { ProviderToolDecl } from './providers/provider.types';

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

function withSkillsBlock(systemInstruction: string, skillNames: string[]): string {
  if (skillNames.length === 0) return systemInstruction;
  const block = ['# Active Skills', ...skillNames.map((n) => `- ${n}`)].join('\n');
  return [systemInstruction.trim(), block].filter(Boolean).join('\n\n');
}

export function assemble(
  ctx: AetherContext,
  subAgent: SubAgentRecord | null,
  parsedMessage: string,
  resolvedName: string | null,
  mcpTools: ProviderToolDecl[] = [],
): AssembledPrompt {
  if (!subAgent) {
    const skills = activeSkillNames(ctx.skills);
    return {
      systemInstruction: withSkillsBlock(ctx.systemInstruction, skills),
      skills,
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
  const skills = dedupStrings([...activeSkillNames(ctx.skills), ...subAgent.skills]);
  const tools = dedupToolsById([...ctx.tools, ...subAgent.tools]);
  return {
    systemInstruction: withSkillsBlock(baseSys, skills),
    skills,
    tools,
    message: parsedMessage,
    subAgent: resolvedName,
    mcpTools,
  };
}
