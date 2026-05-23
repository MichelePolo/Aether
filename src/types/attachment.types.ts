export interface MessageAttachment {
  id: string;
  mime: string;
  name: string;
  size: number;
  contentBase64?: string;
}

export interface QueuedAttachment {
  id: string;           // local-only uuid for chip keying
  name: string;
  mime: string;
  size: number;
  base64: string;       // bare base64, no data: prefix
  dataUri: string;      // full data:<mime>;base64,<base64> for <img src>
}

export type AttachmentKind = 'image' | 'text';

export function isImageMime(mime: string): boolean {
  return mime.startsWith('image/');
}
