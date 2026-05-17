import { randomUUID } from 'node:crypto';
import { JsonStore } from '@/server/lib/json-store';
import { ValidationError, NotFoundError } from '@/server/lib/errors';
import {
  AetherContextSchema,
  ToolSchema,
  McpServerSchema,
} from './context.schema';
import type { AetherContext, Tool, McpServerConfig } from './context.types';

export const defaultContext: AetherContext = {
  systemInstruction:
    'You are Aether, an advanced AI development agent. You provide transparent reasoning and can dispatch sub-agents.',
  skills: [],
  tools: [],
  mcpServers: [],
};

export class ContextStore {
  private json: JsonStore<AetherContext>;

  constructor(filePath: string) {
    this.json = new JsonStore(filePath, AetherContextSchema, defaultContext);
  }

  read(): Promise<AetherContext> {
    return this.json.read();
  }

  async patch(partial: Partial<AetherContext>): Promise<AetherContext> {
    return this.json.update((cur) => ({ ...cur, ...partial }));
  }

  async bulkOverwrite(next: AetherContext): Promise<AetherContext> {
    const parsed = AetherContextSchema.safeParse(next);
    if (!parsed.success) throw new ValidationError('Invalid context payload', parsed.error);
    return this.json.update(() => parsed.data);
  }

  async addSkill(name: string): Promise<void> {
    if (!name.trim()) throw new ValidationError('Skill name cannot be empty');
    await this.json.update((cur) => ({ ...cur, skills: [...cur.skills, name.trim()] }));
  }

  async updateSkillAt(index: number, value: string): Promise<void> {
    if (!value.trim()) throw new ValidationError('Skill name cannot be empty');
    await this.json.update((cur) => {
      if (index < 0 || index >= cur.skills.length) {
        throw new NotFoundError(`skill index ${index}`);
      }
      const next = [...cur.skills];
      next[index] = value.trim();
      return { ...cur, skills: next };
    });
  }

  async removeSkillAt(index: number): Promise<void> {
    await this.json.update((cur) => {
      if (index < 0 || index >= cur.skills.length) {
        throw new NotFoundError(`skill index ${index}`);
      }
      return { ...cur, skills: cur.skills.filter((_, i) => i !== index) };
    });
  }

  async addTool(input: Omit<Tool, 'id'>): Promise<Tool> {
    const parsed = ToolSchema.omit({ id: true }).safeParse(input);
    if (!parsed.success) throw new ValidationError('Invalid tool', parsed.error);
    const tool: Tool = { ...parsed.data, id: randomUUID() };
    await this.json.update((cur) => ({ ...cur, tools: [...cur.tools, tool] }));
    return tool;
  }

  async updateTool(id: string, patch: Partial<Omit<Tool, 'id'>>): Promise<void> {
    await this.json.update((cur) => {
      const idx = cur.tools.findIndex((t) => t.id === id);
      if (idx === -1) throw new NotFoundError(`tool ${id}`);
      const merged = { ...cur.tools[idx], ...patch };
      const validated = ToolSchema.safeParse(merged);
      if (!validated.success) throw new ValidationError('Invalid tool patch', validated.error);
      const tools = [...cur.tools];
      tools[idx] = validated.data;
      return { ...cur, tools };
    });
  }

  async removeTool(id: string): Promise<void> {
    await this.json.update((cur) => {
      if (!cur.tools.some((t) => t.id === id)) throw new NotFoundError(`tool ${id}`);
      return { ...cur, tools: cur.tools.filter((t) => t.id !== id) };
    });
  }

  async addMcpServer(input: Omit<McpServerConfig, 'id'>): Promise<McpServerConfig> {
    const parsed = McpServerSchema.omit({ id: true }).safeParse(input);
    if (!parsed.success) throw new ValidationError('Invalid MCP server', parsed.error);
    const srv: McpServerConfig = { ...parsed.data, id: randomUUID() };
    await this.json.update((cur) => ({ ...cur, mcpServers: [...cur.mcpServers, srv] }));
    return srv;
  }

  async removeMcpServer(id: string): Promise<void> {
    await this.json.update((cur) => {
      if (!cur.mcpServers.some((s) => s.id === id)) throw new NotFoundError(`mcp server ${id}`);
      return { ...cur, mcpServers: cur.mcpServers.filter((s) => s.id !== id) };
    });
  }
}
