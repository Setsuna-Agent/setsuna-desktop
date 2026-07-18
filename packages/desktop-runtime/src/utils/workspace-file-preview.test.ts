import { describe, expect, it } from 'vitest';
import { detectWorkspacePreviewImageMimeType, isProbablyBinaryWorkspaceFile } from './workspace-file-preview.js';

describe('workspace file preview classification', () => {
  it('recognizes browser-previewable image content without trusting extensions', () => {
    const webp = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBPVP8 ')]);
    const icon = Buffer.from([0x00, 0x00, 0x01, 0x00, 0x01, 0x00]);

    expect(detectWorkspacePreviewImageMimeType(webp)).toBe('image/webp');
    expect(detectWorkspacePreviewImageMimeType(Buffer.from('BMfixture'))).toBe('image/bmp');
    expect(detectWorkspacePreviewImageMimeType(icon)).toBe('image/x-icon');
    expect(detectWorkspacePreviewImageMimeType(Buffer.from('<?xml version="1.0"?><svg viewBox="0 0 1 1"></svg>'))).toBe('image/svg+xml');
  });

  it('separates UTF-8 text from executable and archive bytes', () => {
    expect(isProbablyBinaryWorkspaceFile(Buffer.from('export const value = "中文";\n'))).toBe(false);
    expect(isProbablyBinaryWorkspaceFile(Buffer.from([0x4d, 0x5a, 0x00, 0x00]))).toBe(true);
    expect(isProbablyBinaryWorkspaceFile(Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x01]))).toBe(true);
  });
});
