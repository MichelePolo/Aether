export const messages = {
  messageInput: {
    placeholder: 'Type a message. Enter to send, Shift+Enter for newline.',
    streaming: 'Streaming…',
    visionUnsupported: 'Selected provider does not support images',
    thinkingEnabled: 'Thinking enabled (slower, shows reasoning)',
    thinkingDisabled: 'Thinking disabled',
    thinkingUnsupported: 'Thinking not supported by {provider}',
  },
  composerModelPill: {
    fetchFailed: '{provider} — could not fetch models ({reason})',
  },
  messageBubble: {
    streamInterrupted: 'Stream interrupted: {error}',
    interrupted: 'Interrupted · ~{tokens} tokens',
    resume: 'Resume',
    showReasoning: 'Show reasoning',
    stepsCount: '{n} steps',
    thinkingNow: 'thinking…',
    emptyResponse: '(empty response)',
    you: 'You',
    assistant: 'Aether',
    copy: 'Copy as Markdown',
    copied: 'Copied',
  },
  sessionsSection: {
    heading: 'Sessions',
    fallbackTitle: 'New session',
    newSession: '+ New Session',
    deleteIrreversible: 'This will delete all messages in this session.',
    streamingWait: 'Streaming — wait for current response',
  },
  chatView: {
    emptyState: 'No active session. Create one from the sidebar.',
  },
  workspaceChip: {
    label: 'active workspace',
    noWorkspace: 'no workspace',
    noWorkspaceItalic: '(no workspace)',
  },
  breakpoints: {
    heading: 'Breakpoints',
    helpText:
      'Tools are auto-classified by name. "Safe" runs without prompts; "Dangerous" (file writes, shell exec, git push/rebase/reset) and "External" (override-only, for API calls) gate via the approval modal.',
  },
  approvalGate: {
    countdown: 'Auto-rejecting in {seconds}s…',
    stickyLabel: 'Auto-approve this tool for the rest of this session',
  },
  workspaceBrowser: {
    addThisFolder: 'Add this folder',
    cancel: 'Cancel',
    nameLabel: 'Name',
    emptyDir: 'No subdirectories. You can add this folder even if empty.',
    discardName: 'Discard the name you typed?',
  },
  keyVault: {
    hidesIn: 'hides in {seconds}s…',
  },
  attachmentDropZone: {
    dropHere: 'Drop files to attach (max 5, 10 MB total)',
  },
  toast: {
    pastedImage: 'Pasted {name} attached',
  },
} as const;

export type MessageMap = typeof messages;
