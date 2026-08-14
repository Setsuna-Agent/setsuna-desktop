import {
  isRuntimeInlineMessageAttachment,
  type DesktopRuntimeClient,
  type RuntimeInlineMessageAttachment,
  type RuntimeMessageAttachment,
  type RuntimeStoredMessageAttachment,
} from '@setsuna-desktop/contracts';
import type { ChatImageAttachmentOutcome } from '../../../app/types.js';

export const maxChatImageAttachments = 8;

export function rejectedChatImageAttachment(
  attachment: RuntimeMessageAttachment,
  currentCount: number,
): Exclude<ChatImageAttachmentOutcome, 'added' | 'unsupported'> | null {
  if (!isRuntimeInlineMessageAttachment(attachment) || !attachment.type.startsWith('image/') || !attachment.url.startsWith('data:image/')) return 'unavailable';
  if (currentCount >= maxChatImageAttachments) return 'limit-reached';
  return null;
}

export function uploadInlineChatImageAttachment(
  attachment: RuntimeInlineMessageAttachment,
  client: Pick<DesktopRuntimeClient, 'uploadAttachment'>,
): Promise<RuntimeStoredMessageAttachment> {
  return client.uploadAttachment({
    name: attachment.name,
    type: attachment.type,
    data: chatImageDataUrlBytes(attachment.url),
  });
}

export function chatImageDataUrlBytes(url: string): Uint8Array {
  const match = /^data:image\/[^;,]+;base64,([A-Za-z\d+/=\s]+)$/u.exec(url);
  if (!match?.[1]) throw new Error('Image data URL is invalid.');
  const binary = atob(match[1].replace(/\s/gu, ''));
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}
