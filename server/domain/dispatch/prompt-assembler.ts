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

const RUNTIME_HEADER = '# Runtime';
const PROJECT_MEMORY_HEADER = '# Project memory (ETERE.md)';
const AVAILABLE_WORKSPACES_HEADER = '# availableWorkspaces';

/**
 * Render the body of the `# availableWorkspaces` block: one registered workspace
 * root per line, the active one listed first and tagged `-> current` so the model
 * is never ambiguous about which root it operates in. Pure formatting — the
 * caller supplies the registered roots and the resolved current root.
 *
 * Only a `currentPath` that is itself a registered workspace is marked: a
 * filesystem-fallback root (a session with no workspace) is not a switchable
 * workspace, so it is neither listed nor tagged. Returns '' when there is nothing
 * to list.
 *
 * @param allPaths  Registered workspace root paths, in their natural order.
 * @param currentPath  The active session's root, or null when none is selected.
 */
export function formatAvailableWorkspaces(allPaths: string[], currentPath: string | null): string {
  const current = currentPath && allPaths.includes(currentPath) ? currentPath : null;
  // Current first (deduped against the rest), then the remaining roots in order.
  const ordered = dedupStrings(current ? [current, ...allPaths] : allPaths);
  return ordered.map((p) => (p === current ? `- ${p} -> current` : `- ${p}`)).join('\n');
}

/**
 * Runtime-derived prompt blocks, supplied as already-read/built content. Grouped
 * into one object so the blocks can grow without lengthening every call site's
 * positional argument list.
 */
export interface RuntimeContext {
  /** `# Runtime` facts (current time, active model). */
  facts?: string;
  /** `# Project memory (ETERE.md)` content. */
  projectMemory?: string;
  /** `# availableWorkspaces` block body (see {@link formatAvailableWorkspaces}). */
  availableWorkspaces?: string;
}

/**
 * Append the `# Runtime`, `# availableWorkspaces`, and `# Project memory
 * (ETERE.md)` blocks to a system instruction, in that order. Each block is
 * omitted when its string is empty/absent. Pure string composition.
 */
export function withRuntimeContext(systemInstruction: string, runtime: RuntimeContext = {}): string {
  const parts = [systemInstruction.trim()];
  if (runtime.facts?.trim()) parts.push(`${RUNTIME_HEADER}\n${runtime.facts.trim()}`);
  if (runtime.availableWorkspaces?.trim()) {
    parts.push(`${AVAILABLE_WORKSPACES_HEADER}\n${runtime.availableWorkspaces.trim()}`);
  }
  if (runtime.projectMemory?.trim()) {
    parts.push(`${PROJECT_MEMORY_HEADER}\n${runtime.projectMemory.trim()}`);
  }
  return parts.filter(Boolean).join('\n\n');
}

export function assemble(
  ctx: AetherContext,
  subAgent: SubAgentRecord | null,
  parsedMessage: string,
  resolvedName: string | null,
  mcpTools: ProviderToolDecl[] = [],
  materialSkills: PromptMaterialSkill[] = [],
  runtime: RuntimeContext = {},
): AssembledPrompt {
  const materialNames = materialSkills.map((m) => m.name);
  if (!subAgent) {
    const labels = activeSkillNames(ctx.skills);
    return {
      systemInstruction: withSkillsBlock(
        withRuntimeContext(ctx.systemInstruction, runtime),
        labels,
        materialSkills,
      ),
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
    systemInstruction: withSkillsBlock(
      withRuntimeContext(baseSys, runtime),
      labels,
      materialSkills,
    ),
    skills: dedupStrings([...labels, ...materialNames]),
    tools,
    message: parsedMessage,
    subAgent: resolvedName,
    mcpTools,
  };
}
