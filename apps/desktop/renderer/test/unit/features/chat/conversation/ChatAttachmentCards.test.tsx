import type {
  RuntimeGeneratedMessageAttachment,
  RuntimeStoredMessageAttachment,
} from '@setsuna-desktop/contracts';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '../../../../../src/app/providers/ToastProvider.js';
import { ChatAttachmentTray } from '../../../../../src/features/chat/composer/ChatAttachmentTray.js';
import { ChatMessageAttachments } from '../../../../../src/features/chat/conversation/ChatMessageAttachments.js';
const pdfAttachment: RuntimeStoredMessageAttachment = {
  id: 'attachment_pdf',
  assetId: 'attachment_pdf',
  source: 'runtime',
  name: 'invoice.pdf',
  type: 'application/pdf',
  size: 50 * 1024,
};

describe('chat attachment cards', () => {

  it('renders generated asset references without requiring persisted Base64 data', () => {
    const generated: RuntimeGeneratedMessageAttachment = {
      id: 'generated_1',
      source: 'generated',
      assetId: 'generated_image_asset_1',
      name: 'generated-1.png',
      type: 'image/png',
      size: 1024,
      modelVisible: false,
    };

    const html = renderToStaticMarkup(
      <ToastProvider>
        <ChatMessageAttachments attachments={[generated]} variant="assistant" />
      </ToastProvider>,
    );
    expect(html).toContain('正在加载图片');
    expect(html).not.toContain('data:image');
  });

  it('renders stored file names and composer removal controls', () => {
    const composerHtml = renderToStaticMarkup(
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
    const fileHtml = renderToStaticMarkup(
      <ToastProvider>
        <ChatMessageAttachments attachments={[pdfAttachment]} />
      </ToastProvider>,
    );
    expect(composerHtml).toContain('invoice.pdf');
    expect(composerHtml).toContain('aria-label="移除 invoice.pdf"');
    expect(fileHtml).toContain('invoice.pdf');
  });
});
