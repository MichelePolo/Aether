import { randomUUID } from 'node:crypto';
import { ValidationError, NotFoundError } from '@/server/lib/errors';
import type {
  AetherContext,
  McpServerConfig,
  McpToolPolicy,
  Tool,
} from '@/server/domain/context/context.types';
import type { ProfileMeta, ProfileRecord } from './profiles.types';
import type { DatabaseHandle } from '@/server/db/database';

const NAME_MAX = 100;

type ProfileRow = {
  id: string;
  name: string;
  created_at: number;
  updated_at: number;
  system_instruction: string;
  thinking_enabled: number;
};

type ProfileServerRow = {
  server_id: string;
  name: string;
  transport: string;
  command: string | null;
  args: string | null;
  env: string | null;
  url: string | null;
  status: string;
};

type ProfilePolicyRow = {
  server_id: string;
  tool_name: string;
  auto_approve: number;
  category: string | null;
};

function validateName(name: string): void {
  if (!name.trim()) throw new ValidationError('Name cannot be empty');
  if (name.length > NAME_MAX) throw new ValidationError(`Name too long (max ${NAME_MAX})`);
}

export class ProfilesStore {
  constructor(private readonly db: DatabaseHandle) {}

  async listProfiles(): Promise<ProfileMeta[]> {
    const rows = this.db
      .prepare('SELECT id, name, created_at, updated_at FROM profiles ORDER BY updated_at DESC')
      .all() as { id: string; name: string; created_at: number; updated_at: number }[];
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    }));
  }

  async read(id: string): Promise<ProfileRecord | null> {
    const row = this.db
      .prepare(
        'SELECT id, name, created_at, updated_at, system_instruction, thinking_enabled FROM profiles WHERE id = ?',
      )
      .get(id) as ProfileRow | undefined;
    if (!row) return null;

    const skills = (
      this.db
        .prepare('SELECT name FROM profile_skills WHERE profile_id = ? ORDER BY position')
        .all(id) as { name: string }[]
    ).map((r) => r.name);

    const tools = this.db
      .prepare(
        'SELECT tool_id AS id, name, version, status FROM profile_tools WHERE profile_id = ? ORDER BY position',
      )
      .all(id) as Tool[];

    const serverRows = this.db
      .prepare(
        'SELECT server_id, name, transport, command, args, env, url, status FROM profile_mcp_servers WHERE profile_id = ?',
      )
      .all(id) as ProfileServerRow[];

    const policyRows = this.db
      .prepare(
        'SELECT server_id, tool_name, auto_approve, category FROM profile_mcp_tool_policies WHERE profile_id = ?',
      )
      .all(id) as ProfilePolicyRow[];

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
      const policies = policiesByServer.get(r.server_id);
      const base: McpServerConfig = {
        id: r.server_id,
        name: r.name,
        transport: r.transport as McpServerConfig['transport'],
        status: r.status as McpServerConfig['status'],
      };
      if (r.command !== null) base.command = r.command;
      if (r.args !== null) base.args = JSON.parse(r.args) as string[];
      if (r.env !== null) base.env = JSON.parse(r.env) as Record<string, string>;
      if (r.url !== null) base.url = r.url;
      if (policies) base.toolPolicies = policies;
      return base;
    });

    const context: AetherContext = {
      systemInstruction: row.system_instruction,
      skills,
      tools,
      mcpServers,
    };

    return {
      name: row.name,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      context,
      thinkingEnabled: row.thinking_enabled === 1,
    };
  }

  async create(input: {
    name: string;
    context: AetherContext;
    thinkingEnabled: boolean;
  }): Promise<ProfileMeta> {
    validateName(input.name);
    const id = randomUUID();
    const now = Date.now();
    const tx = this.db.transaction(() => {
      const uniqueName = this.findUniqueName(input.name);
      this.db
        .prepare(
          'INSERT INTO profiles (id, name, created_at, updated_at, system_instruction, thinking_enabled) VALUES (?, ?, ?, ?, ?, ?)',
        )
        .run(id, uniqueName, now, now, input.context.systemInstruction, input.thinkingEnabled ? 1 : 0);
      this.writeChildren(id, input.context);
    });
    tx();
    return this.metaOf(id);
  }

  async update(
    id: string,
    patch: Partial<Omit<ProfileRecord, 'createdAt'>>,
  ): Promise<ProfileMeta> {
    if (patch.name !== undefined) validateName(patch.name);
    const tx = this.db.transaction(() => {
      const exists = this.db.prepare('SELECT id FROM profiles WHERE id = ?').get(id);
      if (!exists) throw new NotFoundError(`profile ${id}`);
      const now = Date.now();

      const cur = this.db
        .prepare('SELECT name, system_instruction, thinking_enabled FROM profiles WHERE id = ?')
        .get(id) as { name: string; system_instruction: string; thinking_enabled: number };

      const nextName = patch.name ?? cur.name;
      const nextSystemInstruction =
        patch.context?.systemInstruction ?? cur.system_instruction;
      const nextThinking =
        patch.thinkingEnabled === undefined ? cur.thinking_enabled : patch.thinkingEnabled ? 1 : 0;

      this.db
        .prepare(
          'UPDATE profiles SET name = ?, updated_at = ?, system_instruction = ?, thinking_enabled = ? WHERE id = ?',
        )
        .run(nextName, now, nextSystemInstruction, nextThinking, id);

      if (patch.context) {
        this.writeChildren(id, patch.context);
      }
    });
    tx();
    return this.metaOf(id);
  }

  rename(id: string, name: string): Promise<ProfileMeta> {
    return this.update(id, { name });
  }

  async delete(id: string): Promise<void> {
    const info = this.db.prepare('DELETE FROM profiles WHERE id = ?').run(id);
    if (info.changes === 0) throw new NotFoundError(`profile ${id}`);
  }

  // ---- private helpers ----

  private metaOf(id: string): ProfileMeta {
    const row = this.db
      .prepare('SELECT id, name, created_at, updated_at FROM profiles WHERE id = ?')
      .get(id) as { id: string; name: string; created_at: number; updated_at: number };
    return {
      id: row.id,
      name: row.name,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  private findUniqueName(desired: string): string {
    const existing = new Set(
      (this.db.prepare('SELECT name FROM profiles').all() as { name: string }[]).map((r) => r.name),
    );
    if (!existing.has(desired)) return desired;
    let n = 1;
    while (existing.has(`${desired} (${n})`)) n++;
    return `${desired} (${n})`;
  }

  private writeChildren(profileId: string, context: AetherContext): void {
    this.db.prepare('DELETE FROM profile_skills WHERE profile_id = ?').run(profileId);
    const insertSkill = this.db.prepare(
      'INSERT INTO profile_skills (profile_id, position, name) VALUES (?, ?, ?)',
    );
    context.skills.forEach((s, i) => insertSkill.run(profileId, i, s));

    this.db.prepare('DELETE FROM profile_tools WHERE profile_id = ?').run(profileId);
    const insertTool = this.db.prepare(
      'INSERT INTO profile_tools (profile_id, tool_id, name, version, status, position) VALUES (?, ?, ?, ?, ?, ?)',
    );
    context.tools.forEach((t, i) =>
      insertTool.run(profileId, t.id, t.name, t.version, t.status, i),
    );

    // Policies cascade on mcp_servers delete, so we don't delete them separately.
    this.db.prepare('DELETE FROM profile_mcp_servers WHERE profile_id = ?').run(profileId);
    const insertServer = this.db.prepare(
      'INSERT INTO profile_mcp_servers (profile_id, server_id, name, transport, command, args, env, url, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    );
    const insertPolicy = this.db.prepare(
      'INSERT INTO profile_mcp_tool_policies (profile_id, server_id, tool_name, auto_approve, category) VALUES (?, ?, ?, ?, ?)',
    );
    for (const s of context.mcpServers) {
      insertServer.run(
        profileId,
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
          insertPolicy.run(profileId, s.id, toolName, autoApprove, category);
        }
      }
    }
  }
}
