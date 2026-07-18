import type { Tool, McpServerConfig } from '@/src/types/context.types';
import type { useDialog } from '@/src/hooks/useDialog';

type DialogApi = Pick<ReturnType<typeof useDialog>, 'prompt' | 'confirm'>;

export async function addSkillFlow(
  dialog: DialogApi,
  addSkill: (name: string) => Promise<void>,
): Promise<void> {
  const name = await dialog.prompt({ title: 'Add Skill', label: 'Skill name', required: true });
  if (!name) return;
  await addSkill(name).catch(() => {});
}

export async function addToolFlow(
  dialog: DialogApi,
  addTool: (input: Omit<Tool, 'id'>) => Promise<void>,
): Promise<void> {
  const name = await dialog.prompt({ title: 'Register Tool', label: 'Name', required: true });
  if (!name) return;
  const version = await dialog.prompt({
    title: 'Register Tool',
    label: 'Version',
    defaultValue: '1.0.0',
    required: true,
  });
  if (!version) return;
  const isOnline = await dialog.confirm({
    title: 'Register Tool',
    message: `Set status of ${name} to ONLINE? (Cancel = offline)`,
    confirmLabel: 'Online',
    cancelLabel: 'Offline',
  });
  await addTool({ name, version, status: isOnline ? 'online' : 'offline' }).catch(() => {});
}

/** Parse "Key: value" lines (HTTP headers) or "KEY=value" lines (env) into a
 *  record. Malformed lines are skipped. Returns undefined when nothing parses,
 *  so empty input stores no field at all. */
export function parseKeyValueLines(
  input: string,
  separator: ':' | '=',
): Record<string, string> | undefined {
  const out: Record<string, string> = {};
  for (const line of input.split('\n')) {
    const idx = line.indexOf(separator);
    if (idx <= 0) continue;
    const key = line.slice(0, idx).trim();
    const value = line.slice(idx + 1).trim();
    if (key) out[key] = value;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

export async function addMcpFlow(
  dialog: DialogApi,
  addMcpServer: (input: Omit<McpServerConfig, 'id'>) => Promise<void>,
): Promise<void> {
  const name = await dialog.prompt({ title: 'Add MCP Server', label: 'Name', required: true });
  if (!name) return;

  const isHttp = await dialog.confirm({
    title: 'Add MCP Server',
    message: `Transport for ${name}: HTTP (remote URL) or Stdio (local command)?`,
    confirmLabel: 'HTTP',
    cancelLabel: 'Stdio',
  });

  if (isHttp) {
    const url = await dialog.prompt({
      title: 'Add MCP Server',
      label: 'URL',
      defaultValue: 'http://localhost:8080/mcp',
      required: true,
    });
    if (!url) return;
    const headersRaw = await dialog.prompt({
      title: 'Add MCP Server',
      label: 'Headers (optional, one "Name: value" per line)',
      placeholder: 'Authorization: Bearer <token>',
      multiline: true,
    });
    if (headersRaw === null) return;
    const headers = parseKeyValueLines(headersRaw, ':');
    await addMcpServer({
      name,
      transport: 'http',
      url,
      ...(headers ? { headers } : {}),
      status: 'connecting',
    }).catch(() => {});
    return;
  }

  const command = await dialog.prompt({
    title: 'Add MCP Server',
    label: 'Command',
    placeholder: 'npx',
    required: true,
  });
  if (!command) return;
  const argsRaw = await dialog.prompt({
    title: 'Add MCP Server',
    label: 'Arguments (optional, one per line)',
    placeholder: '-y\n@modelcontextprotocol/server-filesystem\n/path/to/dir',
    multiline: true,
  });
  if (argsRaw === null) return;
  const envRaw = await dialog.prompt({
    title: 'Add MCP Server',
    label: 'Env (optional, one "KEY=value" per line)',
    placeholder: 'API_KEY=...',
    multiline: true,
  });
  if (envRaw === null) return;
  const args = argsRaw
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
  const env = parseKeyValueLines(envRaw, '=');
  await addMcpServer({
    name,
    transport: 'stdio',
    command,
    ...(args.length > 0 ? { args } : {}),
    ...(env ? { env } : {}),
    status: 'connecting',
  }).catch(() => {});
}
