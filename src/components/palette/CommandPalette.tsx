import { Command as Cmdk } from 'cmdk';
import { useUiStore } from '@/src/stores/ui.store';
import { useCommands } from '@/src/hooks/useCommands';
import { CommandItem } from './CommandItem';
import type { Command, CommandGroup } from '@/src/types/command.types';

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

export function CommandPalette() {
  const open = useUiStore((s) => s.paletteOpen);
  const close = useUiStore((s) => s.closePalette);
  const commands = useCommands();

  if (!open) return null;

  const groups = groupBy(commands);

  const runCmd = async (cmd: Command) => {
    try {
      await cmd.run();
    } catch {
      // store owns error display
    } finally {
      close();
    }
  };

  return (
    <Cmdk.Dialog
      open={open}
      onOpenChange={(v) => (v ? null : close())}
      label="Command palette"
      className="fixed inset-0 z-50 flex items-start justify-center pt-[15vh] bg-black/60"
      contentClassName="w-full max-w-xl bg-surface-2 border border-border-subtle rounded-lg shadow-2xl overflow-hidden"
    >
      <Cmdk.Input
        autoFocus
        placeholder="Type a command…"
        className="w-full px-3 py-2 bg-surface-3 border-b border-border-subtle text-sm text-white outline-none placeholder:text-zinc-500"
      />
      <Cmdk.List className="max-h-80 overflow-y-auto p-1">
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
      </Cmdk.List>
    </Cmdk.Dialog>
  );
}
