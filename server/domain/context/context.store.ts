import { randomUUID } from 'node:crypto';
import { ValidationError, NotFoundError } from '@/server/lib/errors';
import {
  AetherContextSchema,
  ToolSchema,
  McpServerSchema,
} from './context.schema';
import type { AetherContext, Tool, McpServerConfig, McpToolPolicy } from './context.types';
import type { DatabaseHandle } from '@/server/db/database';

export const defaultContext: AetherContext = {
  systemInstruction:
    'You are Aether, an advanced AI development agent. You provide transparent reasoning and can dispatch sub-agents.',
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
    return this.writeAll({ ...this.readSync(), ...partial });
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
    this.writeAll({ ...cur, skills: [...cur.skills, trimmed] });
  }

  async updateSkillAt(index: number, value: string): Promise<void> {
    const trimmed = value.trim();
    if (!trimmed) throw new ValidationError('Skill name cannot be empty');
    const cur = this.readSync();
    if (index < 0 || index >= cur.skills.length) {
      throw new NotFoundError(`skill index ${index}`);
    }
    const skills = [...cur.skills];
    skills[index] = trimmed;
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
        .prepare('SELECT name FROM context_skills ORDER BY position')
        .all() as { name: string }[]
    ).map((r) => r.name);

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
        'INSERT INTO context_skills (position, name) VALUES (?, ?)',
      );
      next.skills.forEach((s, i) => insertSkill.run(i, s));

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
