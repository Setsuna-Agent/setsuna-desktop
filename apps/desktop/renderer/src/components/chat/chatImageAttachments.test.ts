import { describe, expect, it } from 'vitest';
import type { RuntimeMessageAttachment } from '@setsuna-desktop/contracts';
import {
  maxChatImageAttachments,
  maxChatImageSize,
  rejectedChatImageAttachment,
} from './chatImageAttachments.js';

const imageAttachment: RuntimeMessageAttachment = {
  id: 'image_1',
  name: 'screenshot.png',
  size: 1024,
  type: 'image/png',
  url: 'data:image/png;base64,aW1hZ2U=',
};

describe('rejectedChatImageAttachment', () => {
  it('accepts a valid image while capacity remains', () => {
    expect(rejectedChatImageAttachment(imageAttachment, 0, true)).toBeNull();
  });

  it('reports the reason an external image cannot enter the composer', () => {
    expect(rejectedChatImageAttachment(imageAttachment, 0, false)).toBe('unsupported');
    expect(rejectedChatImageAttachment({ ...imageAttachment, size: maxChatImageSize + 1 }, 0, true)).toBe('too-large');
    expect(rejectedChatImageAttachment(imageAttachment, maxChatImageAttachments, true)).toBe('limit-reached');
    expect(rejectedChatImageAttachment({ ...imageAttachment, url: 'https://example.com/image.png' }, 0, true)).toBe('unavailable');
  });
});
