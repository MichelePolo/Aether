import { useEffect, useState } from 'react';
import { Command as Cmdk } from 'cmdk';
import { useUiStore } from '@/src/stores/ui.store';
import { useSessionsStore } from '@/src/stores/sessions.store';
import { useCommands } from '@/src/hooks/useCommands';
import { CommandItem } from './CommandItem';
import { SnippetHighlight } from './SnippetHighlight';
import { searchApi } from '@/src/lib/api/search.api';
import type { Command, CommandGroup } from '@/src/types/command.types';
import type { SessionHits } from '@/src/types/search.types';

const GROUP_LABEL: Record<CommandGroup, string> = {
  sessions: 'Sessions',
  profiles: 'Profiles',
  ui: 'UI',
  context: 'Context',
};

const GROUP_ORDER: CommandGroup[] = ['sessions', 'profiles', 'ui', 'context'];

function groupBy(cmds: Command[]): Record<CommandGroup, Command[]> {
  const out: Record<CommandGroup, Command[]> = {
    sessions: [],
    profiles: [],
    ui: [],
    context: [],
  };
  for (const c of cmds) out[c.group].push(c);
  return out;
}

const DEBOUNCE_MS = 150;

export function CommandPalette() {
  const open = useUiStore((s) => s.paletteOpen);
  const close = useUiStore((s) => s.closePalette);
  const mode = useUiStore((s) => s.paletteMode);
  const searchQuery = useUiStore((s) => s.searchQuery);
  const searchResults = useUiStore((s) => s.searchResults);
  const setSearchQuery = useUiStore((s) => s.setSearchQuery);
  const setSearchResults = useUiStore((s) => s.setSearchResults);
  const exitSearchMode = useUiStore((s) => s.exitSearchMode);
  const setActiveSession = useSessionsStore((s) => s.setActive);
  const commands = useCommands();

  const [inputValue, setInputValue] = useState('');

  useEffect(() => {
    setInputValue('');
  }, [mode]);

  useEffect(() => {
    if (mode !== 'search') return;
    const t = setTimeout(() => {
      setSearchQuery(inputValue);
    }, DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [inputValue, mode, setSearchQuery]);

  useEffect(() => {
    if (mode !== 'search') return;
    if (searchQuery.trim().length === 0) {
      setSearchResults([]);
      return;
    }
    const aborter = new AbortController();
    searchApi
      .search(searchQuery, { signal: aborter.signal })
      .then((results) => setSearchResults(results))
      .catch(() => {
        // Network error or abort — leave previous results in place.
      });
    return () => aborter.abort();
  }, [searchQuery, mode, setSearchResults]);

  // Intercept Escape at document capture phase: in search mode, exit search
  // mode instead of letting cmdk close the dialog.
  useEffect(() => {
    if (!open || mode !== 'search') return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        exitSearchMode();
      }
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [open, mode, exitSearchMode]);

  if (!open) return null;

  const groups = groupBy(commands);

  const runCmd = async (cmd: Command) => {
    // Close BEFORE awaiting the command so any dialog the command opens
    // (e.g. rename prompt) isn't trapped behind the palette's focus trap.
    // "Search history…" intentionally keeps the palette open.
    if (cmd.id !== 'sessions.search-history') {
      close();
    }
    try {
      await cmd.run();
    } catch {
      // store owns error display
    }
  };

  const onSelectResult = (sessionId: string) => {
    setActiveSession(sessionId);
    close();
  };

  return (
    <Cmdk.Dialog
      open={open}
      onOpenChange={(v) => (v ? null : close())}
      label="Command palette"
      shouldFilter={mode === 'commands'}
      overlayClassName="fixed inset-0 z-50 bg-black/60"
      contentClassName="fixed left-1/2 top-[15vh] z-50 w-full max-w-xl -translate-x-1/2 bg-surface-2 border border-border-subtle rounded-lg shadow-2xl overflow-hidden"
    >
      <Cmdk.Input
        autoFocus
        placeholder={mode === 'search' ? 'Search messages…' : 'Type a command…'}
        value={inputValue}
        onValueChange={setInputValue}
        onKeyDown={(e) => {
          if (mode === 'search' && e.key === 'Escape') {
            e.preventDefault();
            e.stopPropagation();
            exitSearchMode();
          }
        }}
        className="w-full px-3 py-2 bg-surface-3 border-b border-border-subtle text-sm text-white outline-none placeholder:text-zinc-500"
      />
      <Cmdk.List className="max-h-80 overflow-y-auto p-1">
        {mode === 'commands' ? (
          <>
            <Cmdk.Empty className="px-3 py-4 text-center text-xs text-zinc-500">
              No matching commands
            </Cmdk.Empty>
            {GROUP_ORDER.map((g) =>
              groups[g].length === 0 ? null : (
                <Cmdk.Group
                  key={g}
                  heading={GROUP_LABEL[g]}
                  className="px-1 py-1 [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1 [&_[cmdk-group-heading]]:text-[10px] [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-widest [&_[cmdk-group-heading]]:text-zinc-500 [&_[cmdk-group-heading]]:font-mono"
                >
                  {groups[g].map((c) => (
                    <Cmdk.Item
                      key={c.id}
                      value={`${c.label} ${c.id}`}
                      onSelect={() => runCmd(c)}
                      className="px-2 py-1.5 rounded cursor-pointer data-[selected=true]:bg-surface-3"
                    >
                      <CommandItem label={c.label} shortcut={c.shortcut} icon={c.icon} />
                    </Cmdk.Item>
                  ))}
                </Cmdk.Group>
              ),
            )}
          </>
        ) : (
          <SearchResults results={searchResults} onSelect={onSelectResult} />
        )}
      </Cmdk.List>
    </Cmdk.Dialog>
  );
}

function SearchResults({
  results,
  onSelect,
}: {
  results: SessionHits[];
  onSelect: (sessionId: string) => void;
}) {
  if (results.length === 0) {
    return (
      <div className="px-3 py-4 text-center text-xs text-zinc-500">
        No results
      </div>
    );
  }
  return (
    <>
      {results.map((session) => (
        <Cmdk.Item
          key={session.sessionId}
          value={`session-${session.sessionId}`}
          onSelect={() => onSelect(session.sessionId)}
          className="px-2 py-2 rounded cursor-pointer data-[selected=true]:bg-surface-3 flex flex-col gap-1"
        >
          <div className="text-sm text-white font-medium">
            {session.title || '(untitled session)'}
          </div>
          <div className="flex flex-col gap-0.5">
            {session.hits.map((hit) => (
              <SnippetHighlight
                key={hit.messageId}
                snippet={hit.snippet}
                className="text-xs text-zinc-400 truncate"
              />
            ))}
          </div>
        </Cmdk.Item>
      ))}
    </>
  );
}
