import { useEffect, useState } from 'react';
import { Trash2, Pencil } from 'lucide-react';
import { useUiStore } from '@/src/stores/ui.store';
import { useOllamaEndpointsStore } from '@/src/stores/ollamaEndpoints.store';
import { useProviderAuthStore } from '@/src/stores/providerAuth.store';
import { Modal } from '@/src/components/ui/Modal';
import { HeadersEditor } from './HeadersEditor';
import { cn } from '@/src/lib/cn';
import type { OllamaEndpoint } from '@/src/types/ollama-endpoints.types';

function dotStateClass(state: string | undefined): string {
  if (state === 'ok') return 'bg-status-ok';
  if (state === 'error') return 'bg-status-error';
  return 'bg-zinc-500';
}

function EndpointRow({ ep }: { ep: OllamaEndpoint }) {
  const remove = useOllamaEndpointsStore((s) => s.remove);
  const update = useOllamaEndpointsStore((s) => s.update);
  const status = useProviderAuthStore((s) => s.ollama.find((e) => e.id === ep.id));
  const [confirm, setConfirm] = useState(false);
  const [editing, setEditing] = useState(false);
  const [label, setLabel] = useState(ep.label);
  const [baseUrl, setBaseUrl] = useState(ep.baseUrl);
  const [token, setToken] = useState('');
  const [headers, setHeaders] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!confirm) return;
    const t = setTimeout(() => setConfirm(false), 4000);
    return () => clearTimeout(t);
  }, [confirm]);

  useEffect(() => {
    if (!editing) {
      setLabel(ep.label);
      setBaseUrl(ep.baseUrl);
      setHeaders({});
    }
  }, [ep.label, ep.baseUrl, editing]);

  const handleDelete = () => {
    if (!confirm) { setConfirm(true); return; }
    setConfirm(false);
    void remove(ep.id);
  };

  const handleSaveEdit = async () => {
    if (saving) return;
    setSaving(true);
    try {
      await update(ep.id, {
        label: label.trim(),
        baseUrl: baseUrl.trim(),
        token: token === '' ? undefined : token.trim(),
        headers: Object.keys(headers).length > 0 ? headers : null,
      });
      if (!useOllamaEndpointsStore.getState().error) {
        setEditing(false);
        setToken('');
        setHeaders({});
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <div data-testid="ollama-endpoint-row" className="flex flex-col gap-1 py-2">
      <div className="flex items-center gap-2">
        <span
          data-testid="status-dot"
          data-state={status?.state ?? 'unknown'}
          role="img"
          aria-label={`${ep.label} status: ${status?.state ?? 'unknown'}`}
          className={cn('w-2 h-2 rounded-full flex-shrink-0', dotStateClass(status?.state))}
        />
        <span className="mono-label text-zinc-300">{ep.label}</span>
        {ep.fixed && <span className="text-[10px] font-mono text-zinc-600">fixed</span>}
        {status?.reason && <span className="text-[10px] font-mono text-zinc-500 ml-auto">{status.reason}</span>}
        {!ep.fixed && (
          <div className={cn('flex items-center gap-1', !status?.reason && 'ml-auto')}>
            <button type="button" aria-label={`Edit ${ep.label}`} onClick={() => setEditing((v) => !v)}
              className="px-1.5 py-1 rounded text-zinc-400 hover:text-white border border-border-subtle">
              <Pencil size={12} aria-hidden="true" />
            </button>
            <button type="button" aria-label={`Delete ${ep.label}`} onClick={handleDelete}
              className={cn('px-1.5 py-1 rounded border',
                confirm ? 'bg-status-error/15 text-status-error border-status-error/40'
                        : 'text-zinc-400 hover:text-white border-border-subtle')}>
              <Trash2 size={12} aria-hidden="true" />
            </button>
          </div>
        )}
      </div>
      <div className="text-[10px] font-mono text-zinc-600 pl-4">{ep.baseUrl}{ep.hasToken && ' · token set'}</div>

      {editing && (
        <div className="flex flex-col gap-1.5 pl-4 pt-1">
          <input aria-label={`Edit label ${ep.label}`} value={label} onChange={(e) => setLabel(e.target.value)}
            className="bg-surface-2 border border-border-subtle rounded px-2 py-1 text-[11px] font-mono text-zinc-200" />
          <input aria-label={`Edit URL ${ep.label}`} value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)}
            className="bg-surface-2 border border-border-subtle rounded px-2 py-1 text-[11px] font-mono text-zinc-200" />
          <input aria-label={`Edit token ${ep.label}`} type="password" value={token} onChange={(e) => setToken(e.target.value)}
            placeholder={ep.hasToken ? 'token set — type to replace' : 'no auth'}
            className="bg-surface-2 border border-border-subtle rounded px-2 py-1 text-[11px] font-mono text-zinc-200 placeholder:text-zinc-600" />
          <div className="mono-label text-zinc-500 text-[10px]">Headers (replaces existing)</div>
          <HeadersEditor value={headers} onChange={setHeaders} />
          <div className="flex gap-1.5 mt-1">
            <button type="button" onClick={handleSaveEdit} disabled={saving} aria-busy={saving}
              className="px-2 py-1 rounded text-[10px] font-mono bg-manipulation/15 text-manipulation hover:bg-manipulation/25 disabled:opacity-40 disabled:cursor-not-allowed">Save</button>
            <button type="button" onClick={() => { setEditing(false); setToken(''); setHeaders({}); }}
              className="px-2 py-1 rounded text-[10px] font-mono bg-surface-2 text-zinc-400 border border-border-subtle">Cancel</button>
          </div>
        </div>
      )}
    </div>
  );
}

function AddForm() {
  const create = useOllamaEndpointsStore((s) => s.create);
  const [label, setLabel] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [token, setToken] = useState('');
  const [headers, setHeaders] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  const canSubmit = label.trim() !== '' && baseUrl.trim() !== '' && !busy;

  const handleAdd = async () => {
    if (!canSubmit) return;
    setBusy(true);
    try {
      await create({
        label: label.trim(),
        baseUrl: baseUrl.trim(),
        token: token.trim() === '' ? undefined : token.trim(),
        headers: Object.keys(headers).length > 0 ? headers : undefined,
      });
      setLabel(''); setBaseUrl(''); setToken(''); setHeaders({});
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-1.5 pt-3">
      <div className="mono-label text-zinc-400">Add endpoint</div>
      <input aria-label="Endpoint label" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="label (e.g. workstation)"
        className="bg-surface-2 border border-border-subtle rounded px-2 py-1 text-[11px] font-mono text-zinc-200 placeholder:text-zinc-600" />
      <input aria-label="Endpoint URL" value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="http://host:11434"
        className="bg-surface-2 border border-border-subtle rounded px-2 py-1 text-[11px] font-mono text-zinc-200 placeholder:text-zinc-600" />
      <input aria-label="Endpoint token" type="password" value={token} onChange={(e) => setToken(e.target.value)} placeholder="Bearer token (leave empty for no auth)"
        className="bg-surface-2 border border-border-subtle rounded px-2 py-1 text-[11px] font-mono text-zinc-200 placeholder:text-zinc-600" />
      <div className="mono-label text-zinc-500 text-[10px]">Headers</div>
      <HeadersEditor value={headers} onChange={setHeaders} />
      <button type="button" onClick={handleAdd} disabled={!canSubmit} aria-busy={busy}
        className="self-start mt-1 px-2 py-1 rounded text-[10px] font-mono bg-manipulation/15 text-manipulation hover:bg-manipulation/25 disabled:opacity-40 disabled:cursor-not-allowed">
        Add endpoint
      </button>
    </div>
  );
}

export function OllamaEndpointsModal() {
  const open = useUiStore((s) => s.ollamaEndpointsOpen);
  const close = useUiStore((s) => s.closeOllamaEndpoints);
  const init = useOllamaEndpointsStore((s) => s.init);
  const endpoints = useOllamaEndpointsStore((s) => s.endpoints);
  const error = useOllamaEndpointsStore((s) => s.error);

  useEffect(() => {
    if (open) init().catch(() => {});
  }, [open, init]);

  if (!open) return null;

  return (
    <Modal open={open} onClose={close} title="Ollama Endpoints" className="max-w-lg">
      <div className="flex flex-col">
        {error && (
          <div className="mb-3 text-[10px] font-mono text-status-error bg-status-error/10 rounded px-2 py-1">{error}</div>
        )}
        <div className="flex flex-col divide-y divide-border-subtle">
          {endpoints.map((ep) => <EndpointRow key={ep.id} ep={ep} />)}
        </div>
        <AddForm />
      </div>
    </Modal>
  );
}
