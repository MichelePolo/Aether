import { useCallback, useEffect, useMemo, useState } from 'react';
import { useUiStore } from '@/src/stores/ui.store';
import { useWorkspacesStore } from '@/src/stores/workspaces.store';
import { useDialog } from '@/src/hooks/useDialog';
import { workspacesApi } from '@/src/lib/api/workspaces.api';
import { Modal } from '@/src/components/ui/Modal';
import { Button } from '@/src/components/ui/Button';
import { cn } from '@/src/lib/cn';
import { t } from '@/src/i18n/t';
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
  const dialog = useDialog();

  const [currentPath, setCurrentPath] = useState<string>('');
  const [entries, setEntries] = useState<BrowseEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState<string>('');
  const [nameTouched, setNameTouched] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);

  const loadPath = useCallback(async (path?: string) => {
    setError(null);
    try {
      const r = await workspacesApi.browse(path);
      setEntries(r.entries);
      setSelectedIndex(0);
      setCurrentPath(r.path);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Cannot list directory');
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    setCurrentPath('');
    setEntries([]);
    setName('');
    setNameTouched(false);
    setSelectedIndex(0);
    void loadPath();
  }, [open, loadPath]);

  useEffect(() => {
    if (!nameTouched) setName(basename(currentPath));
  }, [currentPath, nameTouched]);

  const segments = useMemo(() => {
    if (!currentPath) return [];
    const parts = currentPath.split('/').filter(Boolean);
    const accum: { name: string; path: string }[] = [];
    let acc = '';
    for (const p of parts) {
      acc += '/' + p;
      accum.push({ name: p, path: acc });
    }
    return accum;
  }, [currentPath]);

  const descend = useCallback((entry: BrowseEntry) => {
    const next = currentPath ? `${currentPath.replace(/\/+$/, '')}/${entry.name}` : entry.name;
    void loadPath(next);
  }, [currentPath, loadPath]);

  const goUp = useCallback(() => {
    if (!currentPath) return;
    void loadPath(parentOf(currentPath));
  }, [currentPath, loadPath]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      const tag = (document.activeElement?.tagName ?? '').toUpperCase();
      const inInput = tag === 'INPUT' || tag === 'TEXTAREA';
      if (e.key === 'ArrowDown' && !inInput) {
        e.preventDefault();
        setSelectedIndex((i) => Math.min(i + 1, entries.length - 1));
      } else if (e.key === 'ArrowUp' && !inInput) {
        e.preventDefault();
        setSelectedIndex((i) => Math.max(i - 1, 0));
      } else if (e.key === 'Enter' && !inInput && entries[selectedIndex]) {
        e.preventDefault();
        descend(entries[selectedIndex]);
      } else if (e.key === 'Backspace' && !inInput && currentPath) {
        e.preventDefault();
        goUp();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, entries, selectedIndex, currentPath, descend, goUp]);

  const tryClose = useCallback(() => {
    if (nameTouched) {
      void dialog
        .confirm({
          title: 'Discard changes?',
          message: t('workspaceBrowser.discardName'),
          destructive: true,
        })
        .then((ok) => { if (ok) close(); });
      return;
    }
    close();
  }, [nameTouched, dialog, close]);

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
    <Modal open={open} onClose={tryClose} dismissOnBackdrop={!nameTouched} className="max-w-[640px]">
      <nav aria-label="Breadcrumb" className="mb-2 flex items-center gap-1 text-[11px] font-mono">
        <button
          type="button"
          onClick={() => void loadPath('/')}
          className="text-zinc-400 hover:text-zinc-200"
        >
          /
        </button>
        {segments.map((s) => (
          <span key={s.path} className="flex items-center gap-1">
            <span className="text-zinc-600">/</span>
            <button
              type="button"
              onClick={() => void loadPath(s.path)}
              className="text-zinc-400 hover:text-zinc-200"
            >
              {s.name}
            </button>
          </span>
        ))}
      </nav>

      {error && <div className="mb-2 text-rose-400 text-[11px]">{error}</div>}

      <div className="overflow-y-auto border border-border-subtle rounded bg-zinc-950 mb-3 max-h-[40vh]">
        {entries.length === 0 && (
          <div className="p-2 text-zinc-600 text-[11px]">{t('workspaceBrowser.emptyDir')}</div>
        )}
        {entries.map((e, i) => (
          <button
            key={e.name}
            type="button"
            onClick={() => descend(e)}
            aria-current={i === selectedIndex ? 'true' : undefined}
            className={cn(
              'block w-full text-left px-2 py-1 font-mono text-[11px]',
              i === selectedIndex ? 'bg-zinc-800 text-white' : 'text-zinc-300 hover:bg-zinc-800',
            )}
          >
            <span aria-hidden="true">📁 </span>
            {e.name}
          </button>
        ))}
      </div>

      <form
        onSubmit={(e) => { e.preventDefault(); void add(); }}
        className="flex items-center gap-2 mb-3"
      >
        <label className="text-zinc-400 text-[11px]">{t('workspaceBrowser.nameLabel')}</label>
        <input
          type="text"
          value={name}
          onChange={(ev) => { setName(ev.target.value); setNameTouched(true); }}
          className="flex-1 bg-zinc-950 border border-border-subtle text-zinc-300 rounded px-2 py-1 font-mono text-[11px]"
        />
      </form>

      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={tryClose}>{t('workspaceBrowser.cancel')}</Button>
        <Button
          variant="primary"
          onClick={() => void add()}
          disabled={!currentPath || !name.trim()}
        >
          {t('workspaceBrowser.addThisFolder')}
        </Button>
      </div>
    </Modal>
  );
}
