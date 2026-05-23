import { describe, it, expect } from 'vitest';
import { classifyAttachment, IMAGE_MIMES, TEXT_EXTENSIONS, MAX_ATTACHMENTS, MAX_TOTAL_BYTES } from './attachment.types';

describe('classifyAttachment', () => {
  it('classifies PNG/JPEG/WebP/GIF as image', () => {
    expect(classifyAttachment('a.png', 'image/png')).toBe('image');
    expect(classifyAttachment('a.jpg', 'image/jpeg')).toBe('image');
    expect(classifyAttachment('a.webp', 'image/webp')).toBe('image');
    expect(classifyAttachment('a.gif', 'image/gif')).toBe('image');
  });

  it('classifies text/* MIME as text', () => {
    expect(classifyAttachment('a.txt', 'text/plain')).toBe('text');
    expect(classifyAttachment('a.md', 'text/markdown')).toBe('text');
  });

  it('classifies octet-stream + text-extension as text', () => {
    expect(classifyAttachment('a.ts', 'application/octet-stream')).toBe('text');
    expect(classifyAttachment('a.json', '')).toBe('text');
    expect(classifyAttachment('a.yaml', '')).toBe('text');
  });

  it('returns null for unknown MIME + unknown extension', () => {
    expect(classifyAttachment('a.pdf', 'application/pdf')).toBeNull();
    expect(classifyAttachment('a.zip', 'application/zip')).toBeNull();
    expect(classifyAttachment('a.exe', '')).toBeNull();
  });

  it('returns null when extension is missing entirely', () => {
    expect(classifyAttachment('noext', 'application/octet-stream')).toBeNull();
  });

  it('exports the expected constants', () => {
    expect(IMAGE_MIMES.has('image/png')).toBe(true);
    expect(TEXT_EXTENSIONS.has('ts')).toBe(true);
    expect(MAX_ATTACHMENTS).toBe(5);
    expect(MAX_TOTAL_BYTES).toBe(10 * 1024 * 1024);
  });
});
