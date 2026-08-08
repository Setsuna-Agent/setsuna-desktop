import type {
  RuntimeGeneratedMessageAttachment,
  RuntimeStoredMessageAttachment,
} from '@setsuna-desktop/contracts';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ToastProvider } from '../../../../../src/app/providers/ToastProvider.js';
import { ChatMessageAttachments } from '../../../../../src/features/chat/conversation/ChatMessageAttachments.js';
import { ChatThreadProvider } from '../../../../../src/features/chat/conversation/ChatThreadProvider.js';

const storedImageAttachment: RuntimeStoredMessageAttachment = {
  id: 'attachment_image',
  assetId: 'attachment_image',
  source: 'runtime',
  name: 'diagram.png',
  type: 'image/png',
  size: 1024,
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

    expect(html).toContain('chat-image-gallery--single');
    expect(html).toContain('正在加载图片');
    expect(html).not.toContain('data:image');
  });

  it('renders stored user images in the preview gallery instead of as file cards', () => {
    const html = renderToStaticMarkup(
      <ToastProvider>
        <ChatThreadProvider threadId="thread_1">
          <ChatMessageAttachments attachments={[storedImageAttachment]} />
        </ChatThreadProvider>
      </ToastProvider>,
    );

    expect(html).toContain('chat-image-gallery--single');
    expect(html).toContain('chat-message-image__placeholder');
    expect(html).not.toContain('chat-user-message-file');
  });

});
