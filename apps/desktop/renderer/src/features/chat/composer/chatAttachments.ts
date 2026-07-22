import {
  RUNTIME_FILE_ATTACHMENT_EXTENSIONS,
  RUNTIME_FILE_ATTACHMENT_MAX_BYTES,
  RUNTIME_FILE_ATTACHMENT_MIME_TYPES,
  isRuntimeInlineMessageAttachment,
  type DesktopRuntimeClient,
  type RuntimeMessageAttachment,
} from '@setsuna-desktop/contracts';
import { maxChatImageAttachments, maxChatImageSize, readChatImageAttachment } from './chatImageAttachments.js';

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

export function chatAttachmentValidationError(file: File, supportsImageInput: boolean): string | null {
  if (!file.size) return '文件不能为空';
  if (file.type.startsWith('image/')) {
    if (!supportsImageInput) return '当前模型未启用图片输入';
    if (file.size > maxChatImageSize) return '图片不能超过 8 MB';
    return null;
  }
  if (!isSupportedDocumentName(file.name)) return '目前仅支持图片、PDF 和 DOCX 文件';
  if (file.size > RUNTIME_FILE_ATTACHMENT_MAX_BYTES) return '文档不能超过 20 MB';
  return null;
}

export async function createChatMessageAttachment(
  file: File,
  client: Pick<DesktopRuntimeClient, 'uploadAttachment'>,
): Promise<RuntimeMessageAttachment> {
  if (file.type.startsWith('image/')) return readChatImageAttachment(file);
  return client.uploadAttachment({
    name: file.name,
    type: file.type,
    data: new Uint8Array(await file.arrayBuffer()),
  });
}

export function isImageMessageAttachment(attachment: RuntimeMessageAttachment): boolean {
  return isRuntimeInlineMessageAttachment(attachment) && attachment.type.startsWith('image/');
}

export function formatAttachmentTypeLabel(name: string, mimeType: string): string {
  const normalizedName = name.trim().toLowerCase();
  const extension = RUNTIME_FILE_ATTACHMENT_EXTENSIONS.find((value) => normalizedName.endsWith(value));
  if (extension) return extension.slice(1).toUpperCase();

  const normalizedMimeType = mimeType.split(';', 1)[0]?.trim().toLowerCase() ?? '';
  return attachmentTypeLabelsByMime[normalizedMimeType] ?? '文件';
}

function isSupportedDocumentName(name: string): boolean {
  const normalized = name.trim().toLowerCase();
  return RUNTIME_FILE_ATTACHMENT_EXTENSIONS.some((extension) => normalized.endsWith(extension));
}
