import { useCallback, useEffect, useState } from 'react';
import { useUiStore } from '@/src/stores/ui.store';
import { useWorkspacesStore } from '@/src/stores/workspaces.store';
import { workspacesApi } from '@/src/lib/api/workspaces.api';
import type { BrowseEntry } from '@/src/types/workspace.types';

function basename(p: string): string {
  const trimmed = p.replace(/\/+$/, '');
  const idx = trimmed.lastIndexOf('/');
  return idx >= 0 ? trimmed.slice(idx + 1) : trimmed;
}

function parentOf(p: string): string {
  const trimmed = p.replace(/\/+$/, '');
  const idx = trimmed.lastIndexOf('/');
  return idx > 0 ? trimmed.slice(0, idx) : '/';
}

export function WorkspaceBrowserModal() {
  const open = useUiStore((s) => s.workspaceBrowserOpen);
  const close = useUiStore((s) => s.closeWorkspaceBrowser);
  const createWorkspace = useWorkspacesStore((s) => s.create);

  const [currentPath, setCurrentPath] = useState<string>('');
  const [entries, setEntries] = useState<BrowseEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState<string>('');

  const loadPath = useCallback(async (path?: string) => {
    setError(null);
    try {
      const r = await workspacesApi.browse(path);
      setEntries(r);
      if (path) setCurrentPath(path);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Cannot list directory');
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    setCurrentPath('');
    setEntries([]);
    setName('');
    void loadPath();
  }, [open, loadPath]);

  useEffect(() => {
    setName(basename(currentPath));
  }, [currentPath]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, close]);

  if (!open) return null;

  const descend = (subName: string) => {
    const next = currentPath ? `${currentPath.replace(/\/+$/, '')}/${subName}` : subName;
    void loadPath(next);
  };

  const goUp = () => {
    if (!currentPath) return;
    void loadPath(parentOf(currentPath));
  };

  const add = async () => {
    if (!currentPath || !name.trim()) return;
    try {
      await createWorkspace({ name: name.trim(), rootPath: currentPath });
      close();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Cannot create workspace');
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      onClick={close}
    >
      <div
        className="w-[640px] max-w-[90vw] max-h-[85vh] flex flex-col rounded border border-border-subtle bg-surface-1 p-4 text-sm"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-2 flex items-center gap-2">
          <button
            type="button"
            onClick={goUp}
            disabled={!currentPath}
            className="text-zinc-400 hover:text-zinc-200 disabled:opacity-30 text-[12px]"
          >
            ↑ Up
          </button>
          <span className="text-zinc-300 font-mono text-[11px] truncate flex-1">
            {currentPath || '(home)'}
          </span>
        </div>

        {error && <div className="mb-2 text-rose-400 text-[11px]">{error}</div>}

        <div className="flex-1 overflow-y-auto border border-border-subtle rounded bg-zinc-950 mb-3">
          {entries.length === 0 && (
            <div className="p-2 text-zinc-600 text-[11px]">No subdirectories</div>
          )}
          {entries.map((e) => (
            <button
              key={e.name}
              type="button"
              onClick={() => descend(e.name)}
              className="block w-full text-left px-2 py-1 text-zinc-300 hover:bg-zinc-800 font-mono text-[11px]"
            >
              📁 {e.name}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2 mb-3">
          <label className="text-zinc-400 text-[11px]">Name</label>
          <input
            type="text"
            value={name}
            onChange={(ev) => setName(ev.target.value)}
            className="flex-1 bg-zinc-950 border border-border-subtle text-zinc-300 rounded px-2 py-1 font-mono text-[11px]"
          />
        </div>

        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={close}
            className="px-3 py-1.5 rounded border border-border-subtle text-zinc-300 hover:bg-zinc-800"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void add()}
            disabled={!currentPath || !name.trim()}
            className="px-3 py-1.5 rounded bg-accent text-black font-medium disabled:opacity-40"
          >
            Add this folder
          </button>
        </div>
      </div>
    </div>
  );
}
