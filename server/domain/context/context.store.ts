import { randomUUID } from 'node:crypto';
import { ValidationError, NotFoundError } from '@/server/lib/errors';
import {
  AetherContextSchema,
  AetherContextPatchSchema,
  ToolSchema,
  McpServerSchema,
} from './context.schema';
import type { AetherContext, Tool, McpServerConfig, McpToolPolicy } from './context.types';
import type { DatabaseHandle } from '@/server/db/database';

export const DEFAULT_SYSTEM_INSTRUCTION = `You are Aether, the agent at the core of Aether — a local-first, multi-provider
agentic development studio that runs on the user's own machine and API keys. You
help a developer design, write, debug, and reason about software. Your defining
trait is transparency: you make your thinking and your actions auditable.

# Voice
Speak as a precise senior engineer talking to a capable peer: direct, technical,
and concise, with no filler or ceremony. Be kind and constructive — warmth and
honesty are not in tension. Push back when you disagree or see a better path, and
explain why. Treat the developer as an adult who wants the real answer.

# Transparency
Narrate your reasoning and your tool use as you work, so the developer can follow
and correct your course. State what you're about to do and why before you do it.
When you make a decision with trade-offs, say what you traded and what you chose.

# Tools, agents, and skills
Use the tools available to you deliberately — pick the most specific tool for the
job rather than reaching for a shell. Never invent or assume the result of a tool
call; run it and read the real output. Respect approval gates: when an action is
held for review, wait for the decision rather than working around it. Sub-agent
and skill instructions may be appended below this prompt — when a skill is
relevant, read its SKILL.md (and the files it references only when needed) before
acting on it.

# Workspaces
Aether is multi-workspace: the developer registers several project roots and
picks the active one per session. At runtime the available roots are listed under
a "# availableWorkspaces" block — the entry tagged "-> current" is the workspace
this session operates in, and it is always listed first. Treat that current root
as the base for file paths and project work; switch your focus only when the
developer points you at another listed workspace, and never assume a path lives
in one workspace when it belongs to another.

# Formatting
Default to clear prose. Use lists, tables, or headers only when the content is
genuinely multifaceted enough to need them, not by reflex. Put code in fenced
blocks and reference files as path:line so they're clickable. Keep formatting
minimal — it should serve clarity, never decorate.

# Honesty
Don't assume a file, function, or state exists — verify it before relying on it.
If you don't know, say so. When you're wrong, own it plainly, fix it, and move
on; no groveling and no defensiveness. Report outcomes faithfully: if a test
fails or a step was skipped, say that.

# Safety
You support legitimate security work — authorized testing, CTF, defensive
research, and dual-use tooling with clear context. Decline requests whose evident
purpose is harm: malware for real-world use, destructive or mass-targeting
attacks, or evading detection for crime.

# Currency
Your training has a knowledge cutoff. For anything that may have changed since
then, prefer a web search (when available) over guessing, and say when you're
unsure.`;

export const defaultContext: AetherContext = {
  systemInstruction: DEFAULT_SYSTEM_INSTRUCTION,
  skills: [],
  tools: [],
  mcpServers: [],
};

type ServerRow = {
  id: string;
  name: string;
  transport: 'stdio' | 'mock' | 'http';
  command: string | null;
  args: string | null;
  env: string | null;
  url: string | null;
  status: string;
};

type PolicyRow = {
  server_id: string;
  tool_name: string;
  auto_approve: number;
  category: string | null;
};

export class ContextStore {
  constructor(private readonly db: DatabaseHandle) {
    this.db
      .prepare('INSERT OR IGNORE INTO context (id, system_instruction) VALUES (1, ?)')
      .run(defaultContext.systemInstruction);
  }

  read(): Promise<AetherContext> {
    return Promise.resolve(this.readSync());
  }

  async patch(partial: Partial<AetherContext>): Promise<AetherContext> {
    const parsed = AetherContextPatchSchema.safeParse(partial);
    if (!parsed.success) throw new ValidationError('Invalid context patch', parsed.error);
    return this.writeAll({ ...this.readSync(), ...parsed.data });
  }

  async bulkOverwrite(next: AetherContext): Promise<AetherContext> {
    const parsed = AetherContextSchema.safeParse(next);
    if (!parsed.success) throw new ValidationError('Invalid context payload', parsed.error);
    return this.writeAll(parsed.data);
  }

  async addSkill(name: string): Promise<void> {
    const trimmed = name.trim();
    if (!trimmed) throw new ValidationError('Skill name cannot be empty');
    const cur = this.readSync();
    this.writeAll({ ...cur, skills: [...cur.skills, { name: trimmed, enabled: true }] });
  }

  async updateSkillAt(index: number, value: string): Promise<void> {
    const trimmed = value.trim();
    if (!trimmed) throw new ValidationError('Skill name cannot be empty');
    const cur = this.readSync();
    if (index < 0 || index >= cur.skills.length) {
      throw new NotFoundError(`skill index ${index}`);
    }
    const skills = [...cur.skills];
    skills[index] = { ...skills[index], name: trimmed };
    this.writeAll({ ...cur, skills });
  }

  async setSkillEnabledAt(index: number, enabled: boolean): Promise<void> {
    const cur = this.readSync();
    if (index < 0 || index >= cur.skills.length) {
      throw new NotFoundError(`skill index ${index}`);
    }
    const skills = [...cur.skills];
    skills[index] = { ...skills[index], enabled };
    this.writeAll({ ...cur, skills });
  }

  async removeSkillAt(index: number): Promise<void> {
    const cur = this.readSync();
    if (index < 0 || index >= cur.skills.length) {
      throw new NotFoundError(`skill index ${index}`);
    }
    this.writeAll({ ...cur, skills: cur.skills.filter((_, i) => i !== index) });
  }

  async addTool(input: Omit<Tool, 'id'>): Promise<Tool> {
    const parsed = ToolSchema.omit({ id: true }).safeParse(input);
    if (!parsed.success) throw new ValidationError('Invalid tool', parsed.error);
    const tool: Tool = { ...parsed.data, id: randomUUID() };
    const cur = this.readSync();
    this.writeAll({ ...cur, tools: [...cur.tools, tool] });
    return tool;
  }

  async updateTool(id: string, patch: Partial<Omit<Tool, 'id'>>): Promise<void> {
    const cur = this.readSync();
    const idx = cur.tools.findIndex((t) => t.id === id);
    if (idx === -1) throw new NotFoundError(`tool ${id}`);
    const merged = { ...cur.tools[idx], ...patch };
    const validated = ToolSchema.safeParse(merged);
    if (!validated.success) throw new ValidationError('Invalid tool patch', validated.error);
    const tools = [...cur.tools];
    tools[idx] = validated.data;
    this.writeAll({ ...cur, tools });
  }

  async removeTool(id: string): Promise<void> {
    const cur = this.readSync();
    if (!cur.tools.some((t) => t.id === id)) throw new NotFoundError(`tool ${id}`);
    this.writeAll({ ...cur, tools: cur.tools.filter((t) => t.id !== id) });
  }

  async addMcpServer(input: Omit<McpServerConfig, 'id'>): Promise<McpServerConfig> {
    const parsed = McpServerSchema.omit({ id: true }).safeParse(input);
    if (!parsed.success) throw new ValidationError('Invalid MCP server', parsed.error);
    const srv: McpServerConfig = { ...parsed.data, id: randomUUID() };
    const cur = this.readSync();
    this.writeAll({ ...cur, mcpServers: [...cur.mcpServers, srv] });
    return srv;
  }

  async removeMcpServer(id: string): Promise<void> {
    const cur = this.readSync();
    if (!cur.mcpServers.some((s) => s.id === id)) throw new NotFoundError(`mcp server ${id}`);
    this.writeAll({ ...cur, mcpServers: cur.mcpServers.filter((s) => s.id !== id) });
  }

  // ---- private synchronous helpers ----

  private readSync(): AetherContext {
    const ctx = this.db
      .prepare('SELECT system_instruction AS systemInstruction FROM context WHERE id = 1')
      .get() as { systemInstruction: string } | undefined;
    const systemInstruction = ctx?.systemInstruction ?? defaultContext.systemInstruction;

    const skills = (
      this.db
        .prepare('SELECT name, enabled FROM context_skills ORDER BY position')
        .all() as { name: string; enabled: number }[]
    ).map((r) => ({ name: r.name, enabled: r.enabled === 1 }));

    const tools = (
      this.db
        .prepare('SELECT id, name, version, status FROM context_tools ORDER BY position')
        .all() as Tool[]
    );

    const serverRows = this.db
      .prepare(
        'SELECT id, name, transport, command, args, env, url, status FROM context_mcp_servers ORDER BY rowid',
      )
      .all() as ServerRow[];

    const policyRows = this.db
      .prepare('SELECT server_id, tool_name, auto_approve, category FROM context_mcp_tool_policies')
      .all() as PolicyRow[];

    const policiesByServer = new Map<string, Record<string, McpToolPolicy>>();
    for (const p of policyRows) {
      const map = policiesByServer.get(p.server_id) ?? {};
      const policy: McpToolPolicy = {};
      if (p.auto_approve !== -1) policy.autoApprove = p.auto_approve === 1;
      if (p.category) policy.category = p.category as McpToolPolicy['category'];
      map[p.tool_name] = policy;
      policiesByServer.set(p.server_id, map);
    }

    const mcpServers: McpServerConfig[] = serverRows.map((r) => {
      const policies = policiesByServer.get(r.id);
      const base: McpServerConfig = {
        id: r.id,
        name: r.name,
        transport: r.transport,
        status: r.status as McpServerConfig['status'],
      };
      if (r.command !== null) base.command = r.command;
      if (r.args !== null) base.args = JSON.parse(r.args) as string[];
      if (r.env !== null) base.env = JSON.parse(r.env) as Record<string, string>;
      if (r.url !== null) base.url = r.url;
      if (policies) base.toolPolicies = policies;
      return base;
    });

    return { systemInstruction, skills, tools, mcpServers };
  }

  private writeAll(next: AetherContext): AetherContext {
    const tx = this.db.transaction(() => {
      this.db
        .prepare('UPDATE context SET system_instruction = ? WHERE id = 1')
        .run(next.systemInstruction);

      this.db.prepare('DELETE FROM context_skills').run();
      const insertSkill = this.db.prepare(
        'INSERT INTO context_skills (position, name, enabled) VALUES (?, ?, ?)',
      );
      next.skills.forEach((s, i) => insertSkill.run(i, s.name, s.enabled ? 1 : 0));

      this.db.prepare('DELETE FROM context_tools').run();
      const insertTool = this.db.prepare(
        'INSERT INTO context_tools (id, name, version, status, position) VALUES (?, ?, ?, ?, ?)',
      );
      next.tools.forEach((t, i) => insertTool.run(t.id, t.name, t.version, t.status, i));

      this.db.prepare('DELETE FROM context_mcp_servers').run();
      const insertServer = this.db.prepare(
        'INSERT INTO context_mcp_servers (id, name, transport, command, args, env, url, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      );
      const insertPolicy = this.db.prepare(
        'INSERT INTO context_mcp_tool_policies (server_id, tool_name, auto_approve, category) VALUES (?, ?, ?, ?)',
      );
      for (const s of next.mcpServers) {
        insertServer.run(
          s.id,
          s.name,
          s.transport ?? 'stdio',
          s.command ?? null,
          s.args ? JSON.stringify(s.args) : null,
          s.env ? JSON.stringify(s.env) : null,
          s.url ?? null,
          s.status,
        );
        if (s.toolPolicies) {
          for (const [toolName, policy] of Object.entries(s.toolPolicies)) {
            const autoApprove = policy.autoApprove === undefined ? -1 : (policy.autoApprove ? 1 : 0);
            const category = policy.category ?? null;
            insertPolicy.run(s.id, toolName, autoApprove, category);
          }
        }
      }
    });
    tx();
    return this.readSync();
  }
}
