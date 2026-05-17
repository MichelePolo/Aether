import { useContextStore } from '@/src/stores/context.store';
import { useDialog } from '@/src/hooks/useDialog';
import { StatusDot } from '@/src/components/ui/StatusDot';

const EMPTY_SERVERS: never[] = [];

export function McpServersSection() {
  const context = useContextStore((s) => s.context);
  const servers = context?.mcpServers ?? EMPTY_SERVERS;
  const addMcpServer = useContextStore((s) => s.addMcpServer);
  const removeMcpServer = useContextStore((s) => s.removeMcpServer);
  const dialog = useDialog();

  const handleAdd = async () => {
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
  };

  const handleRemove = async (id: string, name: string) => {
    const ok = await dialog.confirm({
      title: 'Remove MCP server',
      message: `Remove "${name}"?`,
      destructive: true,
    });
    if (ok) await removeMcpServer(id).catch(() => {});
  };

  return (
    <section>
      <div className="mono-label mb-2">MCP Network</div>
      <div className="space-y-2">
        {servers.length === 0 ? (
          <div className="text-[10px] text-zinc-600 font-mono italic">
            No active MCP nodes connected.
          </div>
        ) : (
          servers.map((server) => (
            <div
              key={server.id}
              className="group p-2 rounded bg-zinc-900/30 border border-border-subtle/50 flex flex-col gap-1"
            >
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-mono text-zinc-500">{server.name}</span>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => handleRemove(server.id, server.name)}
                    aria-label={`Remove ${server.name}`}
                    className="hidden group-hover:inline hover:text-red-400 text-zinc-500"
                  >
                    ×
                  </button>
                  <StatusDot status={server.status} label={server.name} />
                </div>
              </div>
              <div className="text-[9px] font-mono text-zinc-600 truncate">{server.url}</div>
            </div>
          ))
        )}
        <button
          onClick={handleAdd}
          aria-label="Add MCP server"
          className="w-full p-1 border border-dashed border-border-subtle rounded text-[10px] text-zinc-600 hover:text-zinc-400 transition-colors mt-2"
        >
          + Add Connection
        </button>
      </div>
    </section>
  );
}
