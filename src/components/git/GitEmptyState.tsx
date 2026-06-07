import { FolderGit2, GitBranch } from 'lucide-react';

interface GitEmptyStateProps {
  kind: 'no-workspace' | 'not-a-repo' | 'empty-repo';
}

const CONTENT: Record<
  GitEmptyStateProps['kind'],
  { icon: typeof GitBranch; title: string; message: string }
> = {
  'no-workspace': {
    icon: FolderGit2,
    title: 'No workspace',
    message:
      'This session has no workspace. Attach one to view its git history.',
  },
  'not-a-repo': {
    icon: GitBranch,
    title: 'Not a git repository',
    message: 'The active workspace is not a git repository.',
  },
  'empty-repo': {
    icon: GitBranch,
    title: 'No commits',
    message: 'This repository has no commits yet.',
  },
};

export function GitEmptyState({ kind }: GitEmptyStateProps) {
  const { icon: Icon, title, message } = CONTENT[kind];
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
