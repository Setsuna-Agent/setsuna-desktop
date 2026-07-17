import { describe, expect, it, vi } from 'vitest';
import type { RuntimeStoredMessageAttachment } from '@setsuna-desktop/contracts';
import {
  chatAttachmentValidationError,
  createChatMessageAttachment,
  formatAttachmentSize,
} from './chatAttachments.js';

describe('chat attachments', () => {
  it('accepts PDF and DOCX by extension even when the browser omits their MIME type', () => {
    expect(chatAttachmentValidationError(file('guide.pdf', '%PDF-1.4', ''), false)).toBeNull();
    expect(chatAttachmentValidationError(file('notes.docx', 'PK document', ''), false)).toBeNull();
    expect(chatAttachmentValidationError(file('notes.txt', 'plain text', 'text/plain'), true))
      .toBe('目前仅支持图片、PDF 和 DOCX 文件');
  });

  it('keeps image capability validation separate from document support', () => {
    const image = file('diagram.png', 'image', 'image/png');
    expect(chatAttachmentValidationError(image, false)).toBe('当前模型未启用图片输入');
    expect(chatAttachmentValidationError(image, true)).toBeNull();
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

  it('formats attachment sizes for compact file cards', () => {
    expect(formatAttachmentSize(32)).toBe('32 B');
    expect(formatAttachmentSize(1_500)).toBe('2 KB');
    expect(formatAttachmentSize(2 * 1024 * 1024)).toBe('2.0 MB');
  });
});

function file(name: string, body: string, type: string): File {
  return new File([body], name, { type });
}
