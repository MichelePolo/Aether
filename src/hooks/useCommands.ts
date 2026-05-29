import { useMemo } from 'react';
import {
  Plus,
  MessageSquare,
  Pencil,
  Trash2,
  FolderOpen,
  Save,
  Layers,
  PanelLeft,
  Brain,
  Lightbulb,
  Sparkles,
  Wrench,
  Plug,
  FileText,
  Search,
  Upload,
  KeyRound,
} from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';
import type { Command } from '@/src/types/command.types';
import { useUiStore } from '@/src/stores/ui.store';
import { useSessionsStore } from '@/src/stores/sessions.store';
import { useProfilesStore } from '@/src/stores/profiles.store';
import { useContextStore } from '@/src/stores/context.store';
import { useTddUiStore } from '@/src/stores/tdd-ui.store';
import { useDialog } from '@/src/hooks/useDialog';
import { addSkillFlow, addToolFlow, addMcpFlow } from '@/src/lib/context/addFlows';
import { triggerImportOpen } from '@/src/components/layout/HiddenImportInput';

const IS_MAC =
  typeof navigator !== 'undefined' && /mac/i.test(navigator.platform);
const MOD = IS_MAC ? '⌘' : 'Ctrl+';

export function useCommands(): Command[] {
  const sessions = useSessionsStore(
    useShallow((s) => ({
      list: s.sessions,
      activeId: s.activeSessionId,
      create: s.create,
      setActive: s.setActive,
      rename: s.rename,
      remove: s.delete,
    })),
  );
  const profiles = useProfilesStore(
    useShallow((s) => ({
      list: s.profiles,
      activeId: s.activeProfileId,
      save: s.saveCurrent,
      apply: s.apply,
    })),
  );
  const ui = useUiStore(
    useShallow((s) => ({
      drawerOpen: s.reasoningDrawerOpen,
      openDrawer: s.openReasoningDrawer,
      toggleSidebar: s.toggleSidebar,
      toggleThinking: s.toggleThinking,
      openProfilesModal: s.openProfilesModal,
    })),
  );
  const ctx = useContextStore(
    useShallow((s) => ({
      ctx: s.context,
      addSkill: s.addSkill,
      addTool: s.addTool,
      addMcp: s.addMcpServer,
      setSystem: s.setSystemInstruction,
    })),
  );
  const dialog = useDialog();

  return useMemo<Command[]>(() => {
    const out: Command[] = [];

    // Sessions
    out.push({
      id: 'sessions.new',
      group: 'sessions',
      label: 'New session',
      icon: Plus,
      shortcut: `${MOD}N`,
      run: async () => {
        await sessions.create();
      },
    });
    out.push({
      id: 'sessions.search-history',
      group: 'sessions',
      label: 'Search history…',
      icon: Search,
      run: async () => {
        useUiStore.getState().enterSearchMode();
      },
    });
    out.push({
      id: 'sessions.import',
      group: 'sessions',
      label: 'Import session…',
      icon: Upload,
      run: async () => {
        triggerImportOpen();
      },
    });
    out.push({
      id: 'keys.configure',
      group: 'profiles',
      label: 'Configure API keys…',
      icon: KeyRound,
      run: async () => {
        useUiStore.getState().openKeyVault();
      },
    });
    for (const s of sessions.list) {
      if (s.id === sessions.activeId) continue;
      out.push({
        id: `sessions.switch.${s.id}`,
        group: 'sessions',
        label: `Switch to: ${s.title || 'untitled'}`,
        icon: MessageSquare,
        run: () => sessions.setActive(s.id),
      });
    }
    if (sessions.activeId) {
      const activeId = sessions.activeId;
      const current = sessions.list.find((s) => s.id === activeId);
      out.push({
        id: 'sessions.rename',
        group: 'sessions',
        label: 'Rename current session',
        icon: Pencil,
        run: async () => {
          const name = await dialog.prompt({
            title: 'Rename session',
            label: 'Title',
            defaultValue: current?.title ?? '',
            required: true,
          });
          if (name) await sessions.rename(activeId, name);
        },
      });
      out.push({
        id: 'sessions.delete',
        group: 'sessions',
        label: 'Delete current session',
        icon: Trash2,
        run: async () => {
          const ok = await dialog.confirm({
            title: 'Delete session',
            message: `Delete "${current?.title ?? 'this session'}"?`,
            destructive: true,
          });
          if (ok) await sessions.remove(activeId);
        },
      });
    }

    // Profiles
    out.push({
      id: 'profiles.open',
      group: 'profiles',
      label: 'Open profiles manager',
      icon: FolderOpen,
      run: () => ui.openProfilesModal(),
    });
    out.push({
      id: 'profiles.saveNew',
      group: 'profiles',
      label: 'Save current as new profile…',
      icon: Save,
      run: async () => {
        const name = await dialog.prompt({
          title: 'Save profile',
          label: 'Name',
          required: true,
        });
        if (name) await profiles.save(name);
      },
    });
    for (const p of profiles.list) {
      if (p.id === profiles.activeId) continue;
      out.push({
        id: `profiles.apply.${p.id}`,
        group: 'profiles',
        label: `Apply profile: ${p.name}`,
        icon: Layers,
        run: () => profiles.apply(p.id),
      });
    }

    // UI
    out.push({
      id: 'ui.toggleSidebar',
      group: 'ui',
      label: 'Toggle sidebar',
      icon: PanelLeft,
      shortcut: `${MOD}B`,
      run: () => ui.toggleSidebar(),
    });
    out.push({
      id: 'ui.toggleThinking',
      group: 'ui',
      label: 'Toggle thinking',
      icon: Brain,
      run: () => ui.toggleThinking(),
    });
    if (!ui.drawerOpen) {
      out.push({
        id: 'ui.openReasoning',
        group: 'ui',
        label: 'Open reasoning drawer',
        icon: Lightbulb,
        run: () => ui.openDrawer(),
      });
    }
    out.push({
      id: 'tdd.auto-fix',
      group: 'ui',
      label: 'Auto-fix tests…',
      icon: Wrench,
      run: () => useTddUiStore.getState().openModal(),
    });

    // Context
    out.push({
      id: 'context.addSkill',
      group: 'context',
      label: 'Add skill…',
      icon: Sparkles,
      run: () => addSkillFlow(dialog, ctx.addSkill),
    });
    out.push({
      id: 'context.addTool',
      group: 'context',
      label: 'Add tool…',
      icon: Wrench,
      run: () => addToolFlow(dialog, ctx.addTool),
    });
    out.push({
      id: 'context.addMcp',
      group: 'context',
      label: 'Add MCP server…',
      icon: Plug,
      run: () => addMcpFlow(dialog, ctx.addMcp),
    });
    out.push({
      id: 'context.editSystem',
      group: 'context',
      label: 'Edit system protocol',
      icon: FileText,
      run: async () => {
        const cur = ctx.ctx?.systemInstruction ?? '';
        const text = await dialog.prompt({
          title: 'Edit system protocol',
          label: 'System instruction',
          defaultValue: cur,
          multiline: true,
        });
        if (text !== null) await ctx.setSystem(text);
      },
    });

    return out;
  }, [sessions, profiles, ui, ctx, dialog]);
}
