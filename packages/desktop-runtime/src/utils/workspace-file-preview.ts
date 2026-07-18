import type { WorkspaceFilePreviewImageMimeType } from '@setsuna-desktop/contracts';
import { detectSafeImageMimeType } from './safe-image.js';

const BINARY_SAMPLE_BYTES = 8 * 1024;
const SVG_SAMPLE_BYTES = 64 * 1024;

/** Detect browser-previewable images by content instead of trusting a spoofable extension. */
export function detectWorkspacePreviewImageMimeType(buffer: Buffer): WorkspaceFilePreviewImageMimeType | null {
  const safeImageMimeType = detectSafeImageMimeType(buffer);
  if (safeImageMimeType) return safeImageMimeType;
  if (isBitmap(buffer)) return 'image/bmp';
  if (isIcon(buffer)) return 'image/x-icon';
  if (looksLikeSvg(buffer)) return 'image/svg+xml';
  return null;
}

/** Keep arbitrary binary payloads out of the UTF-8 code preview. */
export function isProbablyBinaryWorkspaceFile(buffer: Buffer): boolean {
  if (!buffer.length) return false;
  const sample = buffer.subarray(0, Math.min(buffer.length, BINARY_SAMPLE_BYTES));
  if (hasKnownBinarySignature(sample) || sample.includes(0)) return true;
  if (sample.toString('utf8').includes('\uFFFD')) return true;

  let controlBytes = 0;
  for (const byte of sample) {
    const allowedWhitespace = byte === 0x09 || byte === 0x0a || byte === 0x0c || byte === 0x0d;
    if (!allowedWhitespace && (byte < 0x20 || byte === 0x7f)) controlBytes += 1;
  }
  return controlBytes / sample.length > 0.1;
}

function isBitmap(buffer: Buffer): boolean {
  return buffer.length >= 2 && buffer[0] === 0x42 && buffer[1] === 0x4d;
}

function isIcon(buffer: Buffer): boolean {
  return buffer.length >= 6
    && buffer[0] === 0x00
    && buffer[1] === 0x00
    && buffer[2] === 0x01
    && buffer[3] === 0x00
    && buffer.readUInt16LE(4) > 0;
}

function looksLikeSvg(buffer: Buffer): boolean {
  const source = buffer
    .subarray(0, Math.min(buffer.length, SVG_SAMPLE_BYTES))
    .toString('utf8')
    .replace(/^\uFEFF/u, '');
  if (source.includes('\uFFFD') || source.includes('\u0000')) return false;
  return /^\s*(?:<\?xml[^>]*>\s*)?(?:<!--[\s\S]*?-->\s*)*(?:<!doctype\s+svg[^>]*>\s*)?<svg(?:\s|>)/iu.test(source);
}

function hasKnownBinarySignature(buffer: Buffer): boolean {
  return startsWithAscii(buffer, '%PDF-')
    || startsWithAscii(buffer, 'MZ')
    || startsWithAscii(buffer, 'Rar!')
    || startsWithBytes(buffer, [0x7f, 0x45, 0x4c, 0x46])
    || startsWithBytes(buffer, [0x1f, 0x8b])
    || startsWithBytes(buffer, [0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c])
    || startsWithBytes(buffer, [0x50, 0x4b, 0x03, 0x04])
    || startsWithBytes(buffer, [0x50, 0x4b, 0x05, 0x06])
    || startsWithBytes(buffer, [0x50, 0x4b, 0x07, 0x08]);
}

function startsWithAscii(buffer: Buffer, value: string): boolean {
  return buffer.length >= value.length && buffer.subarray(0, value.length).toString('ascii') === value;
}

function startsWithBytes(buffer: Buffer, value: number[]): boolean {
  return buffer.length >= value.length && value.every((byte, index) => buffer[index] === byte);
}
