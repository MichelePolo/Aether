import { useEffect, useState } from 'react';
import { AppShell } from '@/src/components/layout/AppShell';
import { TopBar } from '@/src/components/layout/TopBar';
import { Sidebar } from '@/src/components/layout/Sidebar';
import { DialogHost } from '@/src/components/layout/DialogHost';
import { SystemProtocolSection } from '@/src/components/sidebar/SystemProtocolSection';
import { SkillsSection } from '@/src/components/sidebar/SkillsSection';
import { ToolsSection } from '@/src/components/sidebar/ToolsSection';
import { McpServersSection } from '@/src/components/sidebar/McpServersSection';
import { ConnectionFooter } from '@/src/components/sidebar/ConnectionFooter';
import { ChatView } from '@/src/components/chat/ChatView';
import { useContextStore } from '@/src/stores/context.store';
import { useChatStore } from '@/src/stores/chat.store';
import { historyApi } from '@/src/lib/api/history.api';

export default function App() {
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const initContext = useContextStore((s) => s.init);
  const hydrateChat = useChatStore((s) => s.hydrate);

  useEffect(() => {
    initContext();
    historyApi
      .fetchDefault()
      .then((msgs) => hydrateChat(msgs))
      .catch(() => hydrateChat([]));
  }, [initContext, hydrateChat]);

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
    </>
  );
}
