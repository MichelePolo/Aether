import { useEffect } from 'react';
import { AppShell } from '@/src/components/layout/AppShell';
import { TopBar } from '@/src/components/layout/TopBar';
import { Sidebar } from '@/src/components/layout/Sidebar';
import { DialogHost } from '@/src/components/layout/DialogHost';
import { HiddenImportInput } from '@/src/components/layout/HiddenImportInput';
import { SidebarGroups } from '@/src/components/sidebar/SidebarGroups';
import { WorkspaceBrowserModal } from '@/src/components/workspaces/WorkspaceBrowserModal';
import { ApprovalGate } from '@/src/components/chat/ApprovalGate';
import { useBreakpointsStore } from '@/src/stores/breakpoints.store';
import { useBuiltinMcpStore } from '@/src/stores/builtinMcp.store';
import { ConnectionFooter } from '@/src/components/sidebar/ConnectionFooter';
import { ChatView } from '@/src/components/chat/ChatView';
import { ToolCallBanner } from '@/src/components/chat/ToolCallBanner';
import { GitView } from '@/src/components/git/GitView';
import { ReasoningDrawer } from '@/src/components/reasoning/ReasoningDrawer';
import { ProfilesModal } from '@/src/components/profiles/ProfilesModal';
import { KeyVaultModal } from '@/src/components/profiles/KeyVaultModal';
import { OllamaEndpointsModal } from '@/src/components/providers/OllamaEndpointsModal';
import { OpenAIEndpointsModal } from '@/src/components/providers/OpenAIEndpointsModal';
import { SubAgentEditModal } from '@/src/components/subagents/SubAgentEditModal';
import { CreateSkillModal } from '@/src/components/skills/CreateSkillModal';
import { TddRunModal } from '@/src/components/tdd/TddRunModal';
import { CommandPalette } from '@/src/components/palette/CommandPalette';
import { MessageContextMenu } from '@/src/components/chat/MessageContextMenu';
import { useContextStore } from '@/src/stores/context.store';
import { useSessionsStore } from '@/src/stores/sessions.store';
import { useUiStore } from '@/src/stores/ui.store';
import { useProfilesStore } from '@/src/stores/profiles.store';
import { useSubAgentsStore } from '@/src/stores/subagents.store';
import { useSwarmsStore } from '@/src/stores/swarms.store';
import { useSchedulesStore } from '@/src/stores/schedules.store';
import { useProvidersStore } from '@/src/stores/providers.store';
import { useProviderAuthStore } from '@/src/stores/providerAuth.store';
import { useWorkspacesStore } from '@/src/stores/workspaces.store';
import { useSkillsStore } from '@/src/stores/skills.store';
import { useGlobalShortcuts } from '@/src/hooks/useGlobalShortcuts';
import { useToolCallDecisions } from '@/src/hooks/useToolCallDecisions';

export default function App() {
  const sidebarOpen = useUiStore((s) => s.sidebarOpen);
  const toggleSidebar = useUiStore((s) => s.toggleSidebar);
  const mainView = useUiStore((s) => s.mainView);
  const initContext = useContextStore((s) => s.init);
  const initSessions = useSessionsStore((s) => s.init);
  const initUi = useUiStore((s) => s.initFromStorage);
  const initProfiles = useProfilesStore((s) => s.init);
  const initSubAgents = useSubAgentsStore((s) => s.init);
  const initSwarms = useSwarmsStore((s) => s.init);
  const initSchedules = useSchedulesStore((s) => s.init);
  const initProviders = useProvidersStore((s) => s.init);
  const initProviderAuth = useProviderAuthStore((s) => s.init);
  const initBuiltinMcp = useBuiltinMcpStore((s) => s.init);
  const initBreakpoints = useBreakpointsStore((s) => s.init);
  const initWorkspaces = useWorkspacesStore((s) => s.init);
  const initSkills = useSkillsStore((s) => s.init);

  useEffect(() => {
    initContext();
    initSessions();
    initUi();
    initProfiles();
    initSubAgents();
    initSwarms();
    initSchedules();
    initProviders();
    initProviderAuth();
    initBuiltinMcp();
    initBreakpoints();
    initWorkspaces();
    initSkills();
  }, [initContext, initSessions, initUi, initProfiles, initSubAgents, initSwarms, initSchedules, initProviders, initProviderAuth, initBuiltinMcp, initBreakpoints, initWorkspaces, initSkills]);

  useGlobalShortcuts();
  useToolCallDecisions();

  return (
    <>
      <a
        href="#message-input"
        className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50 focus:bg-manipulation focus:text-black focus:px-3 focus:py-1.5 focus:rounded"
      >
        Skip to message input
      </a>
      <AppShell
        sidebarOpen={sidebarOpen}
        sidebar={
          <Sidebar
            header={
              <span className="font-mono text-sm tracking-tight text-white font-bold">
                AETHER_CORE
              </span>
            }
            footer={<ConnectionFooter />}
          >
            <SidebarGroups />
          </Sidebar>
        }
      >
        <TopBar
          title="Aether Core"
          sidebarOpen={sidebarOpen}
          onToggleSidebar={toggleSidebar}
        />
        {mainView === 'git' ? (
          <GitView />
        ) : (
          <>
            <ChatView />
            <ToolCallBanner />
          </>
        )}
      </AppShell>
      <ReasoningDrawer />
      <ProfilesModal />
      <KeyVaultModal />
      <OllamaEndpointsModal />
      <OpenAIEndpointsModal />
      <SubAgentEditModal />
      <CreateSkillModal />
      <TddRunModal />
      <CommandPalette />
      <MessageContextMenu />
      <ApprovalGate />
      <WorkspaceBrowserModal />
      <DialogHost />
      <HiddenImportInput />
    </>
  );
}
