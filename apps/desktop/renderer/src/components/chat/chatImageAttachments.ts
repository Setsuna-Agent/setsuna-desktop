import type { RuntimeMessageAttachment } from '@setsuna-desktop/contracts';
import type { ChatImageAttachmentOutcome } from '../../types/app.js';

export const maxChatImageAttachments = 8;
export const maxChatImageSize = 8 * 1024 * 1024;

export function rejectedChatImageAttachment(
  attachment: RuntimeMessageAttachment,
  currentCount: number,
  supportsImageInput: boolean,
): Exclude<ChatImageAttachmentOutcome, 'added'> | null {
  if (!supportsImageInput) return 'unsupported';
  if (!attachment.type.startsWith('image/') || !attachment.url.startsWith('data:image/')) return 'unavailable';
  if (attachment.size > maxChatImageSize) return 'too-large';
  if (currentCount >= maxChatImageAttachments) return 'limit-reached';
  return null;
}

export function readChatImageAttachment(file: File): Promise<RuntimeMessageAttachment> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error('图片读取失败'));
    reader.onload = () => {
      const url = typeof reader.result === 'string' ? reader.result : '';
      if (!url) {
        reject(new Error('图片读取失败'));
        return;
      }
      resolve({
        id: `image_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
        name: file.name || 'image',
        type: file.type || 'image/png',
        size: file.size,
        url,
      });
    };
    reader.readAsDataURL(file);
  });
}
