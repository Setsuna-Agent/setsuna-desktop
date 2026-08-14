import {
  isRuntimeRasterImageMimeType,
  type DesktopRuntimeClient,
  type RuntimeMessageAttachment,
} from '@setsuna-desktop/contracts';
import { translate, type Translate } from '../../../shared/i18n/I18nProvider.js';
import { maxChatImageAttachments } from './chatImageAttachments.js';

const defaultTranslate: Translate = (key, params) => translate('zh-CN', key, params);

export const maxChatAttachments = maxChatImageAttachments;

const attachmentTypeLabelsByMime: Readonly<Record<string, string>> = {
  'application/pdf': 'PDF',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'DOCX',
};

export type ChatComposerAttachmentStatus = 'preparing' | 'ready' | 'error' | 'removing';

export type ChatComposerAttachmentItem = {
  key: string;
  name: string;
  type: string;
  size: number;
  status: ChatComposerAttachmentStatus;
  attachment?: RuntimeMessageAttachment;
  /** Renderer-only preview. Blob/data URLs here are never persisted or sent to the runtime. */
  previewUrl?: string;
  error?: string;
};

export async function createChatMessageAttachment(
  file: File,
  client: Pick<DesktopRuntimeClient, 'linkAttachment' | 'uploadAttachment'>,
  t: Translate = defaultTranslate,
): Promise<RuntimeMessageAttachment> {
  const linkedAttachment = await client.linkAttachment(file);
  if (linkedAttachment) return linkedAttachment;
  if (!isChatPreviewableImageType(file.type)) {
    throw new Error(t('chat.composer.fileLinkUnavailable'));
  }
  // Clipboard-created images do not have an Electron-backed local path, so they
  // remain the only File objects that need managed byte storage.
  return client.uploadAttachment({
    name: file.name,
    type: file.type,
    data: new Uint8Array(await file.arrayBuffer()),
  });
}

export function formatAttachmentTypeLabel(name: string, mimeType: string, t: Translate = defaultTranslate): string {
  const normalizedName = name.trim();
  const extensionStart = normalizedName.lastIndexOf('.');
  if (extensionStart > 0 && extensionStart < normalizedName.length - 1) {
    const extension = normalizedName.slice(extensionStart + 1);
    if (extension.length <= 12 && /^[a-z\d][a-z\d+_-]*$/iu.test(extension)) return extension.toUpperCase();
  }

  const normalizedMimeType = mimeType.split(';', 1)[0]?.trim().toLowerCase() ?? '';
  return attachmentTypeLabelsByMime[normalizedMimeType] ?? t('chat.composer.fileType');
}

export function isChatPreviewableImageType(mimeType: string): boolean {
  return isRuntimeRasterImageMimeType(mimeType.trim().toLowerCase());
}
