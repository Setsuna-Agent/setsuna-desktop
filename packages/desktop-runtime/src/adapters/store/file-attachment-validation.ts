import {
  RUNTIME_FILE_ATTACHMENT_MAX_BYTES,
  type RuntimeAttachmentUploadInput,
  type RuntimeFileAttachmentMimeType,
} from '@setsuna-desktop/contracts';
import path from 'node:path';
import { RuntimeAttachmentValidationError } from '../../ports/attachment-store.js';
import { detectSafeImageMimeType, type SafeImageMimeType } from '../../utils/safe-image.js';
import { replaceControlCharacters, safeStorageFileStem } from './storage-file-name.js';

export type StoredAttachmentMimeType = RuntimeFileAttachmentMimeType | SafeImageMimeType;

const PDF_MIME_TYPE = 'application/pdf' satisfies RuntimeFileAttachmentMimeType;
const DOCX_MIME_TYPE = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' satisfies RuntimeFileAttachmentMimeType;
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
const STORED_ATTACHMENT_MIME_TYPES = new Set<StoredAttachmentMimeType>([
  PDF_MIME_TYPE,
  DOCX_MIME_TYPE,
  ...Object.keys(IMAGE_EXTENSIONS_BY_MIME) as SafeImageMimeType[],
]);

export function validateStoredAttachmentUpload(input: RuntimeAttachmentUploadInput): {
  name: string;
  type: StoredAttachmentMimeType;
  data: Buffer;
} {
  const name = safeAttachmentDisplayName(input.name);
  const data = Buffer.from(input.data);
  if (!data.byteLength) throw new RuntimeAttachmentValidationError('附件不能为空。', 'attachment_empty');
  if (data.byteLength > RUNTIME_FILE_ATTACHMENT_MAX_BYTES) {
    throw new RuntimeAttachmentValidationError('附件不能超过 20 MB。', 'attachment_too_large');
  }

  const extension = path.extname(name).toLowerCase();
  const declaredType = input.type.trim().toLowerCase();
  if (extension === '.pdf' && hasPdfSignature(data) && compatibleDeclaredType(declaredType, PDF_MIME_TYPE)) {
    return { name, type: PDF_MIME_TYPE, data };
  }
  if (extension === '.docx' && hasDocxSignature(data) && compatibleDeclaredType(declaredType, DOCX_MIME_TYPE)) {
    return { name, type: DOCX_MIME_TYPE, data };
  }

  const detectedImageType = detectSafeImageMimeType(data);
  if (detectedImageType
    && IMAGE_EXTENSIONS_BY_MIME[detectedImageType].includes(extension)
    && compatibleDeclaredType(declaredType, detectedImageType)) {
    return { name, type: detectedImageType, data };
  }

  throw new RuntimeAttachmentValidationError(
    '目前仅支持有效的 PDF、DOCX、PNG、JPEG、GIF 和 WebP 文件。',
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
      : IMAGE_EXTENSIONS_BY_MIME[type].includes(originalExtension)
        ? originalExtension
        : DEFAULT_IMAGE_EXTENSION_BY_MIME[type];
  const stem = safeStorageFileStem(name.slice(0, -path.extname(name).length), 'attachment');
  return `${stem}${extension}`;
}

export function normalizeStoredAttachmentMimeType(value: unknown): StoredAttachmentMimeType | null {
  return typeof value === 'string' && STORED_ATTACHMENT_MIME_TYPES.has(value as StoredAttachmentMimeType)
    ? value as StoredAttachmentMimeType
    : null;
}

function compatibleDeclaredType(declared: string, expected: StoredAttachmentMimeType): boolean {
  return !declared || declared === 'application/octet-stream' || declared === expected;
}

function hasPdfSignature(data: Buffer): boolean {
  return data.subarray(0, 5).toString('ascii') === '%PDF-';
}

function hasDocxSignature(data: Buffer): boolean {
  if (data.byteLength < 4 || data[0] !== 0x50 || data[1] !== 0x4b || ![0x03, 0x05, 0x07].includes(data[2] ?? -1)) return false;
  return data.includes(Buffer.from('[Content_Types].xml')) && data.includes(Buffer.from('word/'));
}
