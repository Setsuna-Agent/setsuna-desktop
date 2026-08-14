import type { RuntimeRasterImageMimeType } from '@setsuna-desktop/contracts';
import { open } from 'node:fs/promises';

export type SafeImageMimeType = RuntimeRasterImageMimeType;

// Local files remain tool-readable at any size. This only bounds runtime paths
// that would duplicate an entire raster image in memory and Base64.
export const MAX_IN_MEMORY_RASTER_IMAGE_BYTES = 64 * 1024 * 1024;

export function detectSafeImageMimeType(buffer: Buffer): SafeImageMimeType | null {
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return 'image/png';
  }
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'image/jpeg';
  if (buffer.length >= 6) {
    const signature = buffer.subarray(0, 6).toString('ascii');
    if (signature === 'GIF87a' || signature === 'GIF89a') return 'image/gif';
  }
  if (buffer.length >= 12
    && buffer.subarray(0, 4).toString('ascii') === 'RIFF'
    && buffer.subarray(8, 12).toString('ascii') === 'WEBP') {
    return 'image/webp';
  }
  return null;
}

export async function readSafeRasterImageFile(input: {
  filePath: string;
  expectedMimeType: SafeImageMimeType;
  expectedSize: number;
}): Promise<Buffer | null> {
  const handle = await open(input.filePath, 'r').catch(() => null);
  if (!handle) return null;
  try {
    const info = await handle.stat();
    if (
      !info.isFile()
      || info.size <= 0
      || info.size > MAX_IN_MEMORY_RASTER_IMAGE_BYTES
      || info.size !== input.expectedSize
    ) return null;

    const data = Buffer.allocUnsafe(info.size);
    let offset = 0;
    while (offset < data.byteLength) {
      const { bytesRead } = await handle.read(data, offset, data.byteLength - offset, offset);
      if (!bytesRead) return null;
      offset += bytesRead;
    }
    const trailing = Buffer.allocUnsafe(1);
    if ((await handle.read(trailing, 0, 1, data.byteLength)).bytesRead) return null;
    return detectSafeImageMimeType(data) === input.expectedMimeType ? data : null;
  } finally {
    await handle.close().catch(() => undefined);
  }
}
