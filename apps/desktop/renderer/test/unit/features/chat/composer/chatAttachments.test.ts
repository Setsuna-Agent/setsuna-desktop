import type { RuntimeStoredMessageAttachment } from '@setsuna-desktop/contracts';
import { describe, expect, it, vi } from 'vitest';
import {
  createChatMessageAttachment,
  formatAttachmentTypeLabel,
} from '../../../../../src/features/chat/composer/chatAttachments.js';

describe('chat attachments', () => {
  it('links a local file without reading or uploading its bytes', async () => {
    const linked: RuntimeStoredMessageAttachment = {
      id: 'attachment_1',
      assetId: 'attachment_1',
      source: 'runtime',
      name: 'notes.txt',
      type: 'text/plain',
      size: 10,
    };
    const linkAttachment = vi.fn(async () => linked);
    const uploadAttachment = vi.fn();
    const document = file('notes.txt', 'local file', 'text/plain');

    await expect(createChatMessageAttachment(document, { linkAttachment, uploadAttachment })).resolves.toBe(linked);
    expect(linkAttachment).toHaveBeenCalledWith(document);
    expect(uploadAttachment).not.toHaveBeenCalled();
  });

  it('stores only pathless clipboard images as runtime-managed bytes', async () => {
    const bytes = pngBytes();
    const uploaded: RuntimeStoredMessageAttachment = {
      id: 'attachment_1',
      assetId: 'attachment_1',
      source: 'runtime',
      name: 'diagram.png',
      type: 'image/png',
      size: bytes.byteLength,
    };
    const linkAttachment = vi.fn(async () => null);
    const uploadAttachment = vi.fn(async () => uploaded);
    const image = new File([bytes], 'diagram.png', { type: 'image/png' });

    await expect(createChatMessageAttachment(image, { linkAttachment, uploadAttachment })).resolves.toBe(uploaded);
    expect(uploadAttachment).toHaveBeenCalledWith({
      name: 'diagram.png',
      type: 'image/png',
      data: new Uint8Array(bytes),
    });
  });

  it('does not copy a non-image file when no trusted local path is available', async () => {
    const linkAttachment = vi.fn(async () => null);
    const uploadAttachment = vi.fn();

    await expect(createChatMessageAttachment(
      file('notes.txt', 'clipboard text', 'text/plain'),
      { linkAttachment, uploadAttachment },
    )).rejects.toThrow('无法获取该文件的本地路径');
    expect(uploadAttachment).not.toHaveBeenCalled();
  });

  it('formats compact file type labels from extension or MIME type', () => {
    expect(formatAttachmentTypeLabel('guide.PDF', '')).toBe('PDF');
    expect(formatAttachmentTypeLabel('notes.txt', '')).toBe('TXT');
    expect(formatAttachmentTypeLabel('notes', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')).toBe('DOCX');
    expect(formatAttachmentTypeLabel('attachment', 'application/octet-stream')).toBe('文件');
  });
});

function file(name: string, body: string, type: string): File {
  return new File([body], name, { type });
}

function pngBytes(): ArrayBuffer {
  return Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x01]).buffer as ArrayBuffer;
}
