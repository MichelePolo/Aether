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

export async function addMcpFlow(
  dialog: DialogApi,
  addMcpServer: (input: Omit<McpServerConfig, 'id'>) => Promise<void>,
): Promise<void> {
  const name = await dialog.prompt({ title: 'Add MCP Server', label: 'Name', required: true });
  if (!name) return;
  const url = await dialog.prompt({
    title: 'Add MCP Server',
    label: 'URL',
    defaultValue: 'http://localhost:8080/mcp',
    required: true,
  });
  if (!url) return;
  await addMcpServer({ name, url, status: 'connecting' }).catch(() => {});
}
