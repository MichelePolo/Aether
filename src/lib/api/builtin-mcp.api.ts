import type {
  BuiltinTransport,
  BuiltinMcpState,
  BuiltinMcpListResponse,
} from '@/src/types/mcp.types';

async function jsonRes<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const msg = (body as { error?: { message?: string } }).error?.message ?? res.statusText;
    throw new Error(msg);
  }
  return (await res.json()) as T;
}

export const builtinMcpApi = {
  list: (): Promise<BuiltinMcpState[]> =>
    fetch('/api/mcp/builtin')
      .then(jsonRes<BuiltinMcpListResponse>)
      .then((b) => b.builtins),

  set: (
    transport: BuiltinTransport,
    patch: { enabled?: boolean; fsRoot?: string | null },
  ): Promise<BuiltinMcpState> =>
    fetch(`/api/mcp/builtin/${transport}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    })
      .then(jsonRes<{ state: BuiltinMcpState }>)
      .then((b) => b.state),
};
