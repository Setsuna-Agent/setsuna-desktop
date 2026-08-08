import type {
  RuntimeGeneratedMessageAttachment,
  RuntimeInlineMessageAttachment,
  RuntimeStoredMessageAttachment,
} from '@setsuna-desktop/contracts';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '../../../../../src/app/providers/ToastProvider.js';
import { ChatAttachmentTray } from '../../../../../src/features/chat/composer/ChatAttachmentTray.js';
import { ChatMessageAttachments } from '../../../../../src/features/chat/conversation/ChatMessageAttachments.js';
import {
  chatImageGalleryColumns,
  chatImageGalleryWidth,
} from '../../../../../src/features/chat/conversation/ChatMessageImageGallery.js';
import { ChatThreadProvider } from '../../../../../src/features/chat/conversation/ChatThreadProvider.js';

const storedImageAttachment: RuntimeStoredMessageAttachment = {
  id: 'attachment_image',
  assetId: 'attachment_image',
  source: 'runtime',
  name: 'diagram.png',
  type: 'image/png',
  size: 1024,
};

const pdfAttachment: RuntimeStoredMessageAttachment = {
  id: 'attachment_pdf',
  assetId: 'attachment_pdf',
  source: 'runtime',
  name: 'invoice.pdf',
  type: 'application/pdf',
  size: 50 * 1024,
};

describe('chat attachment cards', () => {
  it('keeps the balanced gallery boundaries', () => {
    expect([1, 2, 3, 4, 5].map(chatImageGalleryColumns)).toEqual([1, 2, 3, 2, 3]);
    expect([
      chatImageGalleryWidth(1, 'user'),
      chatImageGalleryWidth(1, 'assistant'),
      chatImageGalleryWidth(2, 'user'),
      chatImageGalleryWidth(3, 'assistant'),
    ]).toEqual(['min(220px, 52vw)', '360px', '360px', '544px']);
  });

  it('wires multiple images into one two-column preview gallery', () => {
    const images: RuntimeInlineMessageAttachment[] = [1, 2].map((index) => ({
      id: `generated_${index}`,
      name: `generated-${index}.png`,
      type: 'image/png',
      size: 4,
      url: 'data:image/png;base64,AA==',
    }));

    const html = renderToStaticMarkup(
      <ToastProvider>
        <ChatMessageAttachments attachments={images} variant="assistant" />
      </ToastProvider>,
    );

    expect(html).toContain('chat-image-gallery--multiple');
    expect(html).toContain('--chat-image-gallery-columns:2');
    expect(html).toContain('--chat-image-gallery-width:360px');
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

  it('renders stored files as cards while keeping images in the preview gallery', () => {
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
    const imageHtml = renderToStaticMarkup(
      <ToastProvider>
        <ChatThreadProvider threadId="thread_1">
          <ChatMessageAttachments attachments={[storedImageAttachment]} />
        </ChatThreadProvider>
      </ToastProvider>,
    );

    expect(composerHtml).toContain('invoice.pdf');
    expect(composerHtml).toContain('class="chat-attachment__file-meta">PDF</span>');
    expect(composerHtml).toContain('aria-label="移除 invoice.pdf"');
    expect(fileHtml).toContain('class="chat-user-message-file"');
    expect(fileHtml).toContain('invoice.pdf');
    expect(fileHtml).toContain('class="chat-user-message-file__meta">PDF</span>');
    expect(imageHtml).toContain('chat-image-gallery--single');
    expect(imageHtml).toContain('chat-message-image__placeholder');
    expect(imageHtml).not.toContain('chat-user-message-file');
  });
});
