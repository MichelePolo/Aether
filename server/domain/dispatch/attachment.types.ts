export const IMAGE_MIMES = new Set<string>([
  'image/png',
  'image/jpeg',
  'image/jpg',
  'image/webp',
  'image/gif',
]);

export const TEXT_EXTENSIONS = new Set<string>([
  'md', 'json', 'ts', 'tsx', 'js', 'jsx', 'py', 'yaml', 'yml',
  'toml', 'sh', 'sql', 'rb', 'go', 'rs', 'java', 'c', 'cpp', 'h',
  'html', 'css', 'csv', 'env', 'gitignore', 'txt',
]);

export type AttachmentKind = 'image' | 'text';

export function classifyAttachment(name: string, mime: string): AttachmentKind | null {
  if (IMAGE_MIMES.has(mime)) return 'image';
  if (mime.startsWith('text/')) return 'text';
  const dot = name.lastIndexOf('.');
  if (dot === -1) return null;
  const ext = name.slice(dot + 1).toLowerCase();
  if (!ext) return null;
  if (TEXT_EXTENSIONS.has(ext)) return 'text';
  return null;
}

export const MAX_ATTACHMENTS = 5;
export const MAX_TOTAL_BYTES = 10 * 1024 * 1024;
