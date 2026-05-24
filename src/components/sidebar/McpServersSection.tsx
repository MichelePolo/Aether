import { Power, PowerOff, RefreshCw, X } from 'lucide-react';
import { addMcpFlow } from '@/src/lib/context/addFlows';
import { useContextStore } from '@/src/stores/context.store';
import { useMcpStore } from '@/src/stores/mcp.store';
import { useDialog } from '@/src/hooks/useDialog';
import { StatusDot } from '@/src/components/ui/StatusDot';
import { McpToolCard } from '@/src/components/mcp/McpToolCard';

const EMPTY_SERVERS: never[] = [];

export function McpServersSection() {
  const context = useContextStore((s) => s.context);
  const servers = (context?.mcpServers ?? EMPTY_SERVERS).filter(
    (srv) => !srv.id.startsWith('builtin:'),
  );
  const addMcpServer = useContextStore((s) => s.addMcpServer);
  const removeMcpServer = useContextStore((s) => s.removeMcpServer);

  const liveTools = useMcpStore((s) => s.liveTools);
  const connectStates = useMcpStore((s) => s.connectStates);
  const errors = useMcpStore((s) => s.errors);
  const reconnectInfo = useMcpStore((s) => s.reconnectInfo);
  const connect = useMcpStore((s) => s.connect);
  const disconnect = useMcpStore((s) => s.disconnect);
  const refreshServer = useMcpStore((s) => s.refreshServer);
  const setPolicy = useMcpStore((s) => s.setPolicy);
  const clearError = useMcpStore((s) => s.clearError);

  const dialog = useDialog();

  const handleAdd = () => addMcpFlow(dialog, addMcpServer);

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
          servers.map((server) => {
            const state = connectStates[server.id] ?? 'offline';
            const err = errors[server.id];
            const tools = liveTools.filter((t) => t.serverId === server.id);
            const isOnline = state === 'online';
            const isReconnecting = state === 'reconnecting';
            const recon = reconnectInfo[server.id];
            return (
              <div
                key={server.id}
                className="group p-2 rounded bg-zinc-900/30 border border-border-subtle/50 flex flex-col gap-1"
              >
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-mono text-zinc-500">{server.name}</span>
                  <div className="flex items-center gap-2">
                    {isReconnecting ? (
                      <span aria-live="polite" className="text-[10px] font-mono text-zinc-400">
                        reconnecting{recon ? ` (${recon.attempt}/${recon.max})` : ''}
                      </span>
                    ) : isOnline ? (
                      <>
                        <button
                          type="button"
                          onClick={() => disconnect(server.id).catch(() => {})}
                          aria-label={`Disconnect ${server.name}`}
                          className="text-zinc-400 hover:text-white w-6 h-6 inline-flex items-center justify-center"
                        >
                          <PowerOff size={14} aria-hidden="true" />
                        </button>
                        <button
                          type="button"
                          onClick={() => refreshServer(server.id).catch(() => {})}
                          aria-label={`Refresh ${server.name}`}
                          className="text-zinc-400 hover:text-white w-6 h-6 inline-flex items-center justify-center"
                        >
                          <RefreshCw size={14} aria-hidden="true" />
                        </button>
                      </>
                    ) : (
                      <button
                        type="button"
                        onClick={() => connect(server.id).catch(() => {})}
                        disabled={state === 'connecting'}
                        aria-label={`Connect ${server.name}`}
                        className="text-accent hover:text-white disabled:opacity-50 w-6 h-6 inline-flex items-center justify-center"
                      >
                        {state === 'connecting' ? '…' : <Power size={14} aria-hidden="true" />}
                      </button>
                    )}
                    <button
                      onClick={() => handleRemove(server.id, server.name)}
                      aria-label={`Remove ${server.name}`}
                      className="hidden group-hover:inline hover:text-red-400 text-zinc-500 w-6 h-6 items-center justify-center"
                    >
                      <X size={12} aria-hidden="true" />
                    </button>
                    <StatusDot
                      status={state === 'online' ? 'online' : state === 'connecting' ? 'connecting' : state === 'error' ? 'error' : 'offline'}
                      label={server.name}
                    />
                  </div>
                </div>
                {'url' in server && server.url && (
                  <div className="text-[9px] font-mono text-zinc-600 truncate">{String(server.url)}</div>
                )}
                {err && (
                  <div role="alert" className="text-[9px] font-mono text-status-error flex items-center gap-1">
                    <span className="flex-1">⚠ {err}</span>
                    <button
                      type="button"
                      aria-label={`Dismiss error for ${server.name}`}
                      onClick={() => clearError(server.id)}
                      className="hover:text-white"
                    >
                      ×
                    </button>
                  </div>
                )}
                {isOnline && tools.length > 0 && (
                  <div className="mt-1 space-y-1">
                    {tools.map((t) => (
                      <McpToolCard
                        key={t.qualifiedName}
                        tool={t}
                        onPolicyChange={(policy) => setPolicy(server.id, t.tool.name, policy).catch(() => {})}
                      />
                    ))}
                  </div>
                )}
                {isOnline && tools.length === 0 && (
                  <div className="mt-1 text-[9px] font-mono text-zinc-600 italic">
                    (no tools available)
                  </div>
                )}
              </div>
            );
          })
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
