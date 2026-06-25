import { MessagesSquare, ScrollText, Bot, Wrench, FolderTree, Plug, RefreshCw } from 'lucide-react';
import { useUiStore } from '@/src/stores/ui.store';
import { useSessionsStore } from '@/src/stores/sessions.store';
import { useProviderAuthStore } from '@/src/stores/providerAuth.store';
import { cn } from '@/src/lib/cn';
import { SidebarAccordion } from './SidebarAccordion';
import { SessionsSection } from './SessionsSection';
import { SystemProtocolSection } from './SystemProtocolSection';
import { SkillsSection } from './SkillsSection';
import { SubAgentsSection } from './SubAgentsSection';
import { SwarmsSection } from './SwarmsSection';
import { SchedulesSection } from './SchedulesSection';
import { ToolsSection } from './ToolsSection';
import { BuiltinMcpToggles } from './BuiltinMcpToggles';
import { McpServersSection } from './McpServersSection';
import { BreakpointsSection } from './BreakpointsSection';
import { WorkspacesSection } from './WorkspacesSection';
import { ProviderAuthSection } from './ProviderAuthSection';

export function SidebarGroups() {
  const groups = useUiStore((s) => s.sidebarGroups);
  const toggle = useUiStore((s) => s.toggleSidebarGroup);
  const sessionCount = useSessionsStore((s) => s.sessions.length);
  const openWorkspaceBrowser = useUiStore((s) => s.openWorkspaceBrowser);
  const refreshProviders = useProviderAuthStore((s) => s.refresh);
  const providersLoading = useProviderAuthStore((s) => s.loading);

  return (
    <div className="space-y-2">
      <SidebarAccordion
        icon={MessagesSquare}
        title="Sessions"
        open={groups.sessions}
        onToggle={() => toggle('sessions')}
        actions={<span className="text-[10px] text-zinc-600">[{sessionCount}]</span>}
      >
        <SessionsSection />
      </SidebarAccordion>

      <SidebarAccordion
        icon={ScrollText}
        title="System Protocol"
        open={groups.systemProtocol}
        onToggle={() => toggle('systemProtocol')}
      >
        <SystemProtocolSection />
      </SidebarAccordion>

      <SidebarAccordion
        icon={Bot}
        title="Skills & Agents"
        open={groups.skillsAgents}
        onToggle={() => toggle('skillsAgents')}
      >
        <div className="space-y-6">
          <SkillsSection />
          <SubAgentsSection />
          <SwarmsSection />
          <SchedulesSection />
        </div>
      </SidebarAccordion>

      <SidebarAccordion
        icon={Wrench}
        title="Tools"
        open={groups.tools}
        onToggle={() => toggle('tools')}
      >
        <div className="space-y-6">
          <ToolsSection />
          <BuiltinMcpToggles />
          <McpServersSection />
          <BreakpointsSection />
        </div>
      </SidebarAccordion>

      <SidebarAccordion
        icon={FolderTree}
        title="Workspaces"
        open={groups.workspaces}
        onToggle={() => toggle('workspaces')}
        actions={
          <button
            type="button"
            onClick={openWorkspaceBrowser}
            className="text-[10px] text-manipulation hover:underline"
          >
            + Add workspace…
          </button>
        }
      >
        <WorkspacesSection />
      </SidebarAccordion>

      <SidebarAccordion
        icon={Plug}
        title="Providers"
        open={groups.providers}
        onToggle={() => toggle('providers')}
        actions={
          <button
            type="button"
            aria-label="Refresh provider auth"
            onClick={() => refreshProviders().catch(() => {})}
            className={cn('text-zinc-400 hover:text-white transition-colors', providersLoading && 'animate-spin')}
          >
            <RefreshCw size={10} />
          </button>
        }
      >
        <ProviderAuthSection />
      </SidebarAccordion>
    </div>
  );
}
