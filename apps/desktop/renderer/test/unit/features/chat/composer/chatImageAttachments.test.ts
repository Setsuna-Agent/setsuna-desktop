import type { RuntimeMessageAttachment } from '@setsuna-desktop/contracts';
import { describe, expect, it } from 'vitest';
import {
  chatImageDataUrlBytes,
  maxChatImageAttachments,
  rejectedChatImageAttachment,
} from '../../../../../src/features/chat/composer/chatImageAttachments.js';

const imageAttachment: RuntimeMessageAttachment = {
  id: 'image_1',
  name: 'screenshot.png',
  size: 1024,
  type: 'image/png',
  url: 'data:image/png;base64,aW1hZ2U=',
};

describe('rejectedChatImageAttachment', () => {
  it('accepts a valid image while capacity remains', () => {
    expect(rejectedChatImageAttachment(imageAttachment, 0)).toBeNull();
    expect(rejectedChatImageAttachment({ ...imageAttachment, size: 128 * 1024 * 1024 }, 0)).toBeNull();
  });

  it('reports the reason an external image cannot enter the composer', () => {
    expect(rejectedChatImageAttachment(imageAttachment, maxChatImageAttachments)).toBe('limit-reached');
    expect(rejectedChatImageAttachment({ ...imageAttachment, url: 'https://example.com/image.png' }, 0)).toBe('unavailable');
  });

  it('decodes inline image data for runtime attachment upload', () => {
    expect(chatImageDataUrlBytes(imageAttachment.url)).toEqual(Uint8Array.from(Buffer.from('image')));
  });
});
