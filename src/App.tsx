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
import { useContextStore } from '@/src/stores/context.store';

export default function App() {
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const init = useContextStore((s) => s.init);

  useEffect(() => {
    init();
  }, [init]);

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
        <div className="flex-1 flex items-center justify-center text-zinc-600">
          <div className="text-center opacity-50">
            <div className="font-mono text-xs uppercase tracking-widest text-accent mb-2">
              Aether OS — Slice 1
            </div>
            <div className="text-[10px]">Chat verrà aggiunta in Slice 2</div>
          </div>
        </div>
      </AppShell>
    </>
  );
}
