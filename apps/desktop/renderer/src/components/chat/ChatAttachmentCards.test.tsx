import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { RuntimeGeneratedMessageAttachment, RuntimeInlineMessageAttachment, RuntimeStoredMessageAttachment } from '@setsuna-desktop/contracts';
import { ToastProvider } from '../ToastProvider.js';
import { ChatAttachmentTray } from './ChatAttachmentTray.js';
import { ChatMessageAttachments } from './ChatMessageAttachments.js';
import { chatImageGalleryColumns } from './ChatMessageImageGallery.js';

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
      <ToastProvider>
        <ChatMessageAttachments attachments={[pdfAttachment]} />
      </ToastProvider>,
    );

    expect(html).toContain('class="chat-user-message-file__icon"');
    expect(html).toContain('data-file-icon-theme="seti"');
    expect(html).toContain('class="chat-user-message-file__meta">PDF</span>');
  });

  it('renders multiple sent images as one Ant Design preview gallery', () => {
    const images: RuntimeInlineMessageAttachment[] = [1, 2].map((index) => ({
      id: `generated_${index}`,
      name: `generated-${index}.png`,
      type: 'image/png',
      size: 4,
      url: 'data:image/png;base64,AA==',
      localAssetId: `generated_image_asset_${index}`,
    }));
    const html = renderToStaticMarkup(
      <ToastProvider>
        <ChatMessageAttachments attachments={images} variant="assistant" />
      </ToastProvider>,
    );

    expect(html).toContain('chat-image-gallery--multiple');
    expect(html).toContain('--chat-image-gallery-columns:2');
    expect(html.match(/class="ant-image-img/g)).toHaveLength(2);
  });

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

    expect(html).toContain('chat-image-gallery--single');
    expect(html).toContain('正在加载图片');
    expect(html).not.toContain('data:image');
  });

  it('uses balanced gallery columns for common image counts', () => {
    expect([1, 2, 3, 4, 5, 6].map(chatImageGalleryColumns)).toEqual([1, 2, 3, 2, 3, 3]);
  });
});
