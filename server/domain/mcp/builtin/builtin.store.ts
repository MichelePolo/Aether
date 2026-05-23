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

function resolveAetherShellEntry(): string {
  // In dev (tsx/vite-node) we run the .ts directly. In prod we run the built .js.
  // The build step copies aether-shell.ts → dist/server/mcp/builtin/aether-shell.js.
  const here = path.dirname(fileURLToPath(import.meta.url));
  const distGuess = path.resolve(here, '../../../mcp/builtin/aether-shell.js');
  const srcGuess = path.resolve(here, '../../../mcp/builtin/aether-shell.ts');
  // Prefer .js (production); fall back to .ts (dev — tsx executes TS directly).
  try {
    require.resolve(distGuess);
    return distGuess;
  } catch {
    return srcGuess;
  }
}

export class BuiltinMcpStore {
  constructor(private readonly db: DatabaseHandle) {}

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
        return {
          id: 'builtin:filesystem',
          name: 'Filesystem',
          transport: 'stdio',
          command: process.execPath,
          args: [resolveFilesystemServerEntry(), r.fsRoot ?? defaultCwd],
          env: {},
          status: 'offline',
        } as McpServerConfig;
      }
      return {
        id: 'builtin:terminal',
        name: 'Terminal',
        transport: 'stdio',
        command: process.execPath,
        args: [resolveAetherShellEntry()],
        env: {},
        status: 'offline',
      } as McpServerConfig;
    });
  }
}
