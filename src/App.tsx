import { useEffect, useState } from 'react';
import { AppShell } from '@/src/components/layout/AppShell';
import { TopBar } from '@/src/components/layout/TopBar';
import { Sidebar } from '@/src/components/layout/Sidebar';
import { DialogHost } from '@/src/components/layout/DialogHost';
import { SessionsSection } from '@/src/components/sidebar/SessionsSection';
import { SystemProtocolSection } from '@/src/components/sidebar/SystemProtocolSection';
import { SkillsSection } from '@/src/components/sidebar/SkillsSection';
import { ToolsSection } from '@/src/components/sidebar/ToolsSection';
import { McpServersSection } from '@/src/components/sidebar/McpServersSection';
import { ConnectionFooter } from '@/src/components/sidebar/ConnectionFooter';
import { ChatView } from '@/src/components/chat/ChatView';
import { ReasoningDrawer } from '@/src/components/reasoning/ReasoningDrawer';
import { ProfilesModal } from '@/src/components/profiles/ProfilesModal';
import { useContextStore } from '@/src/stores/context.store';
import { useSessionsStore } from '@/src/stores/sessions.store';
import { useUiStore } from '@/src/stores/ui.store';
import { useProfilesStore } from '@/src/stores/profiles.store';

export default function App() {
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const initContext = useContextStore((s) => s.init);
  const initSessions = useSessionsStore((s) => s.init);
  const initUi = useUiStore((s) => s.initFromStorage);
  const initProfiles = useProfilesStore((s) => s.init);

  useEffect(() => {
    initContext();
    initSessions();
    initUi();
    initProfiles();
  }, [initContext, initSessions, initUi, initProfiles]);

  return (
    <>
      <DialogHost />
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
          </Sidebar>
        }
      >
        <TopBar
          title="Aether Dev Studio"
          sidebarOpen={sidebarOpen}
          onToggleSidebar={() => setSidebarOpen((v) => !v)}
        />
        <ChatView />
      </AppShell>
      <ReasoningDrawer />
      <ProfilesModal />
    </>
  );
}
