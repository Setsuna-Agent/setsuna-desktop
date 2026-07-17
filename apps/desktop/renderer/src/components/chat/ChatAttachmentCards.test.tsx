import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { RuntimeStoredMessageAttachment } from '@setsuna-desktop/contracts';
import { ChatAttachmentTray } from './ChatAttachmentTray.js';
import { ChatMessageAttachments } from './ChatMessageAttachments.js';

const pdfAttachment: RuntimeStoredMessageAttachment = {
  id: 'attachment_pdf',
  assetId: 'attachment_pdf',
  source: 'runtime',
  name: 'invoice.pdf',
  type: 'application/pdf',
  size: 50 * 1024,
};

describe('chat attachment cards', () => {
  it('uses the integrated file icon set in the composer attachment tray', () => {
    const html = renderToStaticMarkup(
      <ChatAttachmentTray
        items={[{
          key: pdfAttachment.id,
          name: pdfAttachment.name,
          type: pdfAttachment.type,
          size: pdfAttachment.size,
          status: 'ready',
          attachment: pdfAttachment,
        }]}
        onRemove={vi.fn()}
      />,
    );

    expect(html).toContain('class="chat-attachment__file-type-icon"');
    expect(html).toContain('data-file-icon-theme="seti"');
    expect(html).toContain('class="chat-attachment__file-meta">PDF</span>');
  });

  it('uses the integrated file icon set in sent attachment cards', () => {
    const html = renderToStaticMarkup(
      <ChatMessageAttachments attachments={[pdfAttachment]} />,
    );

    expect(html).toContain('class="chat-user-message-file__icon"');
    expect(html).toContain('data-file-icon-theme="seti"');
    expect(html).toContain('class="chat-user-message-file__meta">PDF</span>');
  });
});
