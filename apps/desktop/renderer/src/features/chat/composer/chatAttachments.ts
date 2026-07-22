import {
  RUNTIME_FILE_ATTACHMENT_EXTENSIONS,
  RUNTIME_FILE_ATTACHMENT_MAX_BYTES,
  RUNTIME_FILE_ATTACHMENT_MIME_TYPES,
  isRuntimeInlineMessageAttachment,
  type DesktopRuntimeClient,
  type RuntimeMessageAttachment,
} from '@setsuna-desktop/contracts';
import { translate, type Translate } from '../../../shared/i18n/I18nProvider.js';
import { maxChatImageAttachments, maxChatImageSize, readChatImageAttachment } from './chatImageAttachments.js';

const defaultTranslate: Translate = (key, params) => translate('zh-CN', key, params);

export const maxChatAttachments = maxChatImageAttachments;
export const chatAttachmentAccept = [
  'image/*',
  ...RUNTIME_FILE_ATTACHMENT_EXTENSIONS,
  ...RUNTIME_FILE_ATTACHMENT_MIME_TYPES,
].join(',');

const attachmentTypeLabelsByMime: Readonly<Record<string, string>> = {
  'application/pdf': 'PDF',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'DOCX',
};

export type ChatComposerAttachmentStatus = 'uploading' | 'ready' | 'error' | 'removing';

export type ChatComposerAttachmentItem = {
  key: string;
  name: string;
  type: string;
  size: number;
  status: ChatComposerAttachmentStatus;
  attachment?: RuntimeMessageAttachment;
  error?: string;
};

export function chatAttachmentValidationError(file: File, supportsImageInput: boolean, t: Translate = defaultTranslate): string | null {
  if (!file.size) return t('chat.composer.fileEmpty');
  if (file.type.startsWith('image/')) {
    if (!supportsImageInput) return t('chat.composer.imageUnsupported');
    if (file.size > maxChatImageSize) return t('chat.composer.imageTooLarge');
    return null;
  }
  if (!isSupportedDocumentName(file.name)) return t('chat.composer.fileUnsupported');
  if (file.size > RUNTIME_FILE_ATTACHMENT_MAX_BYTES) return t('chat.composer.documentTooLarge');
  return null;
}

export async function createChatMessageAttachment(
  file: File,
  client: Pick<DesktopRuntimeClient, 'uploadAttachment'>,
  t: Translate = defaultTranslate,
): Promise<RuntimeMessageAttachment> {
  if (file.type.startsWith('image/')) return readChatImageAttachment(file, t);
  return client.uploadAttachment({
    name: file.name,
    type: file.type,
    data: new Uint8Array(await file.arrayBuffer()),
  });
}

export function isImageMessageAttachment(attachment: RuntimeMessageAttachment): boolean {
  return isRuntimeInlineMessageAttachment(attachment) && attachment.type.startsWith('image/');
}

export function formatAttachmentTypeLabel(name: string, mimeType: string, t: Translate = defaultTranslate): string {
  const normalizedName = name.trim().toLowerCase();
  const extension = RUNTIME_FILE_ATTACHMENT_EXTENSIONS.find((value) => normalizedName.endsWith(value));
  if (extension) return extension.slice(1).toUpperCase();

  const normalizedMimeType = mimeType.split(';', 1)[0]?.trim().toLowerCase() ?? '';
  return attachmentTypeLabelsByMime[normalizedMimeType] ?? t('chat.composer.fileType');
}

function isSupportedDocumentName(name: string): boolean {
  const normalized = name.trim().toLowerCase();
  return RUNTIME_FILE_ATTACHMENT_EXTENSIONS.some((extension) => normalized.endsWith(extension));
}
