import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import type { DatabaseHandle } from '@/server/db/database';
import type { McpServerConfig } from '@/server/domain/context/context.types';
import type { BuiltinMcpState, BuiltinTransport } from './builtin.types';

const require = createRequire(import.meta.url);

interface Row {
  transport: string;
  enabled: number;
  fs_root: string | null;
}

function resolveFilesystemServerEntry(): string {
  // Resolve the official server-filesystem package's main entry.
  // Falls back to a hardcoded path if require.resolve fails (rare).
  try {
    return require.resolve('@modelcontextprotocol/server-filesystem/dist/index.js');
  } catch {
    return path.resolve(
      process.cwd(),
      'node_modules/@modelcontextprotocol/server-filesystem/dist/index.js',
    );
  }
}

function resolveAetherShellArgs(): string[] {
  // The "Terminal" tool runs as a SEPARATE node process speaking JSON-RPC over
  // stdio. It is launched as `process.execPath` (node) + the args returned here.
  const here = path.dirname(fileURLToPath(import.meta.url));
  const srcEntry = path.resolve(here, '../../../mcp/builtin/aether-shell.ts');
  // Prod: `npm run build` bundles the entry to dist/. If it exists, run it directly.
  const distEntry = path.resolve(process.cwd(), 'dist/server/mcp/builtin/aether-shell.js');
  try {
    require.resolve(distEntry);
    return [distEntry];
  } catch {
    // Dev: only the .ts source exists. A child `node` process does NOT inherit
    // the tsx loader from the parent dev server, so a plain `node aether-shell.ts`
    // dies immediately with ERR_UNKNOWN_FILE_EXTENSION. Register the tsx loader
    // first → effectively `node --import tsx server/mcp/builtin/aether-shell.ts`.
    return ['--import', 'tsx', srcEntry];
  }
}

function resolveAetherGitArgs(): string[] {
  // Mirrors resolveAetherShellArgs for the aether-git MCP entry.
  const here = path.dirname(fileURLToPath(import.meta.url));
  const srcEntry = path.resolve(here, '../../../mcp/builtin/aether-git.ts');
  const distEntry = path.resolve(process.cwd(), 'dist/server/mcp/builtin/aether-git.js');
  try {
    require.resolve(distEntry);
    return [distEntry];
  } catch {
    return ['--import', 'tsx', srcEntry];
  }
}

export class BuiltinMcpStore {
  constructor(
    private readonly db: DatabaseHandle,
    private readonly libraryDir?: string,
  ) {}

  read(): BuiltinMcpState[] {
    const rows = this.db
      .prepare('SELECT transport, enabled, fs_root FROM builtin_mcp_state ORDER BY transport')
      .all() as Row[];
    return rows.map((r) => ({
      transport: r.transport as BuiltinTransport,
      enabled: r.enabled === 1,
      fsRoot: r.fs_root,
    }));
  }

  setEnabled(transport: BuiltinTransport, enabled: boolean): void {
    this.db
      .prepare('UPDATE builtin_mcp_state SET enabled = ? WHERE transport = ?')
      .run(enabled ? 1 : 0, transport);
  }

  setFsRoot(transport: BuiltinTransport, fsRoot: string | null): void {
    this.db
      .prepare('UPDATE builtin_mcp_state SET fs_root = ? WHERE transport = ?')
      .run(fsRoot, transport);
  }

  toConfigs(defaultCwd: string): McpServerConfig[] {
    const rows = this.read().filter((r) => r.enabled);
    return rows.map((r) => {
      if (r.transport === 'filesystem') {
        const primaryRoot = r.fsRoot ?? defaultCwd;
        const allowed = this.libraryDir && this.libraryDir !== primaryRoot
          ? [primaryRoot, this.libraryDir]
          : [primaryRoot];
        return {
          id: 'builtin:filesystem',
          name: 'Filesystem',
          transport: 'stdio',
          command: process.execPath,
          args: [resolveFilesystemServerEntry(), ...allowed],
          env: {},
          status: 'offline',
        } as McpServerConfig;
      }
      if (r.transport === 'git') {
        return {
          id: 'builtin:git',
          name: 'Git',
          transport: 'stdio',
          command: process.execPath,
          args: [...resolveAetherGitArgs(), r.fsRoot ?? defaultCwd],
          env: {},
          status: 'offline',
        } as McpServerConfig;
      }
      return {
        id: 'builtin:terminal',
        name: 'Terminal',
        transport: 'stdio',
        command: process.execPath,
        args: resolveAetherShellArgs(),
        env: {},
        status: 'offline',
      } as McpServerConfig;
    });
  }

  /**
   * Per-root configs for the rooted builtin transports (filesystem, git). Each
   * gets an id suffixed with the root so the registry can pool one instance per
   * root. Filesystem always-allows the libraryDir alongside the root; git does
   * not. Terminal is excluded — it is never workspace-rooted.
   */
  rootedConfigs(root: string): McpServerConfig[] {
    const rows = this.read().filter((r) => r.enabled);
    const out: McpServerConfig[] = [];
    for (const r of rows) {
      if (r.transport === 'filesystem') {
        const allowed = this.libraryDir && this.libraryDir !== root
          ? [root, this.libraryDir]
          : [root];
        out.push({
          id: `builtin:filesystem@${root}`,
          name: 'Filesystem',
          transport: 'stdio',
          command: process.execPath,
          args: [resolveFilesystemServerEntry(), ...allowed],
          env: {},
          status: 'offline',
        } as McpServerConfig);
      } else if (r.transport === 'git') {
        out.push({
          id: `builtin:git@${root}`,
          name: 'Git',
          transport: 'stdio',
          command: process.execPath,
          args: [...resolveAetherGitArgs(), root],
          env: {},
          status: 'offline',
        } as McpServerConfig);
      }
    }
    return out;
  }
}
