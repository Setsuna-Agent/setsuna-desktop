import type { RuntimeStoredMessageAttachment } from '@setsuna-desktop/contracts';
import { describe, expect, it, vi } from 'vitest';
import {
  chatAttachmentValidationError,
  createChatMessageAttachment,
  formatAttachmentTypeLabel,
} from '../../../../../src/features/chat/composer/chatAttachments.js';

describe('chat attachments', () => {
  it('accepts PDF and DOCX by extension even when the browser omits their MIME type', () => {
    expect(chatAttachmentValidationError(file('guide.pdf', '%PDF-1.4', ''))).toBeNull();
    expect(chatAttachmentValidationError(file('notes.docx', 'PK document', ''))).toBeNull();
    expect(chatAttachmentValidationError(file('notes.txt', 'plain text', 'text/plain')))
      .toBe('目前仅支持图片、PDF 和 DOCX 文件');
  });

  it('accepts images independently of the active model capability', () => {
    const image = file('diagram.png', 'image', 'image/png');
    expect(chatAttachmentValidationError(image)).toBeNull();
  });

  it('uploads document bytes through the narrow runtime client API', async () => {
    const uploaded: RuntimeStoredMessageAttachment = {
      id: 'attachment_1',
      assetId: 'attachment_1',
      source: 'runtime',
      name: 'guide.pdf',
      type: 'application/pdf',
      size: 8,
    };
    const uploadAttachment = vi.fn(async () => uploaded);
    const document = file('guide.pdf', '%PDF-1.4', 'application/pdf');

    await expect(createChatMessageAttachment(document, { uploadAttachment })).resolves.toBe(uploaded);
    expect(uploadAttachment).toHaveBeenCalledWith({
      name: 'guide.pdf',
      type: 'application/pdf',
      data: expect.any(Uint8Array),
    });
  });

  it('uploads images as runtime-managed assets independently of the active model', async () => {
    const bytes = pngBytes();
    const uploaded: RuntimeStoredMessageAttachment = {
      id: 'attachment_1',
      assetId: 'attachment_1',
      source: 'runtime',
      name: 'diagram.png',
      type: 'image/png',
      size: bytes.byteLength,
    };
    const uploadAttachment = vi.fn(async () => uploaded);
    const image = new File([bytes], 'diagram.png', { type: 'image/png' });

    await expect(createChatMessageAttachment(image, { uploadAttachment })).resolves.toBe(uploaded);
    expect(uploadAttachment).toHaveBeenCalledWith({
      name: 'diagram.png',
      type: 'image/png',
      data: new Uint8Array(bytes),
    });
  });

  it('formats compact file type labels from extension or MIME type', () => {
    expect(formatAttachmentTypeLabel('guide.PDF', '')).toBe('PDF');
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
