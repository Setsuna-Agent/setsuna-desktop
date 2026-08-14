import {
  isRuntimeRasterImageMimeType,
  type RuntimeAttachmentUploadInput,
} from '@setsuna-desktop/contracts';
import path from 'node:path';
import { RuntimeAttachmentValidationError } from '../../ports/attachment-store.js';
import { detectSafeImageMimeType, type SafeImageMimeType } from '../../utils/safe-image.js';
import { replaceControlCharacters, safeStorageFileStem } from './storage-file-name.js';

export type StoredAttachmentMimeType = string;

export const DEFAULT_STORED_ATTACHMENT_MIME_TYPE = 'application/octet-stream';
const PDF_MIME_TYPE = 'application/pdf';
const DOCX_MIME_TYPE = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const MIME_TYPE_PATTERN = /^[a-z\d][a-z\d!#$&^_.+-]{0,126}\/[a-z\d][a-z\d!#$&^_.+-]{0,126}$/u;
const IMAGE_EXTENSIONS_BY_MIME: Readonly<Record<SafeImageMimeType, readonly string[]>> = {
  'image/gif': ['.gif'],
  'image/jpeg': ['.jpg', '.jpeg'],
  'image/png': ['.png'],
  'image/webp': ['.webp'],
};
const DEFAULT_IMAGE_EXTENSION_BY_MIME: Readonly<Record<SafeImageMimeType, string>> = {
  'image/gif': '.gif',
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
};
const RASTER_IMAGE_EXTENSIONS = new Set(Object.values(IMAGE_EXTENSIONS_BY_MIME).flat());

export function validateStoredAttachmentUpload(input: RuntimeAttachmentUploadInput): {
  name: string;
  type: StoredAttachmentMimeType;
  data: Buffer;
} {
  const name = safeAttachmentDisplayName(input.name);
  const data = Buffer.from(input.data);
  if (!data.byteLength) throw new RuntimeAttachmentValidationError('附件不能为空。', 'attachment_empty');

  const extension = path.extname(name).toLowerCase();
  const declaredType = normalizeDeclaredMimeType(input.type);
  if (extension === '.pdf' || declaredType === PDF_MIME_TYPE) {
    if (extension === '.pdf' && hasPdfSignature(data) && compatibleDeclaredType(declaredType, PDF_MIME_TYPE)) {
      return { name, type: PDF_MIME_TYPE, data };
    }
    throw unsupportedAttachment();
  }
  if (extension === '.docx' || declaredType === DOCX_MIME_TYPE) {
    if (extension === '.docx' && hasDocxSignature(data) && compatibleDeclaredType(declaredType, DOCX_MIME_TYPE)) {
      return { name, type: DOCX_MIME_TYPE, data };
    }
    throw unsupportedAttachment();
  }

  const rasterImageIntent = RASTER_IMAGE_EXTENSIONS.has(extension)
    || isRuntimeRasterImageMimeType(declaredType);
  if (rasterImageIntent) {
    const detectedImageType = detectSafeImageMimeType(data);
    if (detectedImageType
      && IMAGE_EXTENSIONS_BY_MIME[detectedImageType].includes(extension)
      && compatibleDeclaredType(declaredType, detectedImageType)) {
      return { name, type: detectedImageType, data };
    }
    throw unsupportedAttachment();
  }

  throw new RuntimeAttachmentValidationError(
    '该文件应通过本地引用添加。',
    'attachment_unsupported',
  );
}

export function safeAttachmentDisplayName(value: string): string {
  const segments = value.trim().split(/[\\/]+/u);
  const baseName = replaceControlCharacters(segments.at(-1) ?? '', '').trim();
  if (!baseName || baseName === '.' || baseName === '..') {
    throw new RuntimeAttachmentValidationError('附件名称无效。', 'attachment_invalid');
  }
  return baseName.slice(0, 255);
}

export function safeStoredAttachmentFileName(name: string, type: StoredAttachmentMimeType): string {
  const originalExtension = path.extname(name).toLowerCase();
  const extension = type === PDF_MIME_TYPE
    ? '.pdf'
    : type === DOCX_MIME_TYPE
      ? '.docx'
      : isRuntimeRasterImageMimeType(type)
        ? IMAGE_EXTENSIONS_BY_MIME[type].includes(originalExtension)
          ? originalExtension
          : DEFAULT_IMAGE_EXTENSION_BY_MIME[type]
        : safeGenericExtension(name);
  const sourceExtension = path.extname(name);
  const stem = safeStorageFileStem(sourceExtension ? name.slice(0, -sourceExtension.length) : name, 'attachment');
  return `${stem}${extension}`;
}

export function normalizeStoredAttachmentMimeType(value: unknown): StoredAttachmentMimeType | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toLowerCase();
  return MIME_TYPE_PATTERN.test(normalized) ? normalized : null;
}

export function normalizeAttachmentLinkMimeType(value: string): StoredAttachmentMimeType {
  return normalizeDeclaredMimeType(value);
}

function compatibleDeclaredType(declared: string, expected: StoredAttachmentMimeType): boolean {
  return declared === DEFAULT_STORED_ATTACHMENT_MIME_TYPE || declared === expected;
}

function normalizeDeclaredMimeType(value: string): StoredAttachmentMimeType {
  const normalized = value.trim().toLowerCase();
  if (!normalized) return DEFAULT_STORED_ATTACHMENT_MIME_TYPE;
  if (!MIME_TYPE_PATTERN.test(normalized)) {
    throw new RuntimeAttachmentValidationError('附件类型无效。', 'attachment_invalid');
  }
  return normalized;
}

function safeGenericExtension(name: string): string {
  const extension = path.extname(name);
  if (!extension) return '';
  const safeExtension = replaceControlCharacters(extension.slice(1), '_')
    .replace(/[<>:"/\\|?*]/gu, '_')
    .replace(/[. ]+$/u, '')
    .trim()
    .slice(0, 32);
  return safeExtension ? `.${safeExtension}` : '';
}

function unsupportedAttachment(): RuntimeAttachmentValidationError {
  return new RuntimeAttachmentValidationError(
    '文件扩展名、类型或内容不匹配。',
    'attachment_unsupported',
  );
}

function hasPdfSignature(data: Buffer): boolean {
  return data.subarray(0, 5).toString('ascii') === '%PDF-';
}

function hasDocxSignature(data: Buffer): boolean {
  if (data.byteLength < 4 || data[0] !== 0x50 || data[1] !== 0x4b || ![0x03, 0x05, 0x07].includes(data[2] ?? -1)) return false;
  return data.includes(Buffer.from('[Content_Types].xml')) && data.includes(Buffer.from('word/'));
}
