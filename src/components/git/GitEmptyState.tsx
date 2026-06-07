import { FolderGit2, GitBranch } from 'lucide-react';
import { t } from '@/src/i18n/t';

interface GitEmptyStateProps {
  kind: 'no-workspace' | 'not-a-repo' | 'empty-repo';
}

const CONTENT: Record<
  GitEmptyStateProps['kind'],
  { icon: typeof GitBranch; titleKey: 'git.empty.noWorkspaceTitle' | 'git.empty.notARepoTitle' | 'git.empty.emptyRepoTitle'; messageKey: 'git.empty.noWorkspace' | 'git.empty.notARepo' | 'git.empty.emptyRepo' }
> = {
  'no-workspace': {
    icon: FolderGit2,
    titleKey: 'git.empty.noWorkspaceTitle',
    messageKey: 'git.empty.noWorkspace',
  },
  'not-a-repo': {
    icon: GitBranch,
    titleKey: 'git.empty.notARepoTitle',
    messageKey: 'git.empty.notARepo',
  },
  'empty-repo': {
    icon: GitBranch,
    titleKey: 'git.empty.emptyRepoTitle',
    messageKey: 'git.empty.emptyRepo',
  },
};

export function GitEmptyState({ kind }: GitEmptyStateProps) {
  const { icon: Icon, titleKey, messageKey } = CONTENT[kind];
  const title = t(titleKey);
  const message = t(messageKey);
  return (
    <div
      data-empty={kind}
      className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center"
    >
      <Icon size={36} className="text-zinc-600" aria-hidden="true" />
      <div className="text-sm font-mono text-zinc-300">{title}</div>
      <div className="max-w-sm text-[12px] text-zinc-500">{message}</div>
    </div>
  );
}
