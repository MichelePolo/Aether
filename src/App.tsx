import { useEffect } from 'react';
import { AppShell } from '@/src/components/layout/AppShell';
import { TopBar } from '@/src/components/layout/TopBar';
import { Sidebar } from '@/src/components/layout/Sidebar';
import { DialogHost } from '@/src/components/layout/DialogHost';
import { SessionsSection } from '@/src/components/sidebar/SessionsSection';
import { SystemProtocolSection } from '@/src/components/sidebar/SystemProtocolSection';
import { SkillsSection } from '@/src/components/sidebar/SkillsSection';
import { ToolsSection } from '@/src/components/sidebar/ToolsSection';
import { McpServersSection } from '@/src/components/sidebar/McpServersSection';
import { SubAgentsSection } from '@/src/components/sidebar/SubAgentsSection';
import { ConnectionFooter } from '@/src/components/sidebar/ConnectionFooter';
import { ChatView } from '@/src/components/chat/ChatView';
import { ToolCallBanner } from '@/src/components/chat/ToolCallBanner';
import { ReasoningDrawer } from '@/src/components/reasoning/ReasoningDrawer';
import { ProfilesModal } from '@/src/components/profiles/ProfilesModal';
import { SubAgentEditModal } from '@/src/components/subagents/SubAgentEditModal';
import { CommandPalette } from '@/src/components/palette/CommandPalette';
import { useContextStore } from '@/src/stores/context.store';
import { useSessionsStore } from '@/src/stores/sessions.store';
import { useUiStore } from '@/src/stores/ui.store';
import { useProfilesStore } from '@/src/stores/profiles.store';
import { useSubAgentsStore } from '@/src/stores/subagents.store';
import { useProvidersStore } from '@/src/stores/providers.store';
import { useGlobalShortcuts } from '@/src/hooks/useGlobalShortcuts';
import { useToolCallDecisions } from '@/src/hooks/useToolCallDecisions';

export default function App() {
  const sidebarOpen = useUiStore((s) => s.sidebarOpen);
  const toggleSidebar = useUiStore((s) => s.toggleSidebar);
  const initContext = useContextStore((s) => s.init);
  const initSessions = useSessionsStore((s) => s.init);
  const initUi = useUiStore((s) => s.initFromStorage);
  const initProfiles = useProfilesStore((s) => s.init);
  const initSubAgents = useSubAgentsStore((s) => s.init);
  const initProviders = useProvidersStore((s) => s.init);

  useEffect(() => {
    initContext();
    initSessions();
    initUi();
    initProfiles();
    initSubAgents();
    initProviders();
  }, [initContext, initSessions, initUi, initProfiles, initSubAgents, initProviders]);

  useGlobalShortcuts();
  useToolCallDecisions();

  return (
    <>
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
            <SessionsSection />
            <SystemProtocolSection />
            <SkillsSection />
            <ToolsSection />
            <McpServersSection />
            <SubAgentsSection />
          </Sidebar>
        }
      >
        <TopBar
          title="Aether Dev Studio"
          sidebarOpen={sidebarOpen}
          onToggleSidebar={toggleSidebar}
        />
        <ChatView />
        <ToolCallBanner />
      </AppShell>
      <ReasoningDrawer />
      <ProfilesModal />
      <SubAgentEditModal />
      <CommandPalette />
      <DialogHost />
    </>
  );
}
