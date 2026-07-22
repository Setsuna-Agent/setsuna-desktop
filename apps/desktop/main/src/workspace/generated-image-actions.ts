import type { DesktopImageActionResult, DesktopImageDataResult, DesktopImageInput } from '@setsuna-desktop/contracts';
import { createHash } from 'node:crypto';
import { mkdir, open, readFile, readdir, realpath, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
const MAX_ENCODED_IMAGE_CHARS = Math.ceil((MAX_IMAGE_BYTES * 4) / 3) + 1_024;
const SAFE_IMAGE_DATA_URL = /^data:image\/(?:gif|jpeg|png|webp);base64,/iu;
const SAFE_ASSET_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,191}$/u;

type NativeImageLike = { isEmpty(): boolean };

class GeneratedImageActionError extends Error {}

export async function copyChatImage<TImage extends NativeImageLike>(
  userDataDir: string,
  inputValue: unknown,
  createImageFromDataUrl: (dataUrl: string) => TImage,
  createImageFromPath: (imagePath: string) => TImage,
  writeImage: (image: TImage) => void,
): Promise<DesktopImageActionResult> {
  try {
    const input = normalizeImageInput(inputValue);
    if (!input.assetId) return copyImageDataUrlToClipboard(input.dataUrl, createImageFromDataUrl, writeImage);
    try {
      const image = createImageFromPath(await resolveGeneratedImageAssetPath(userDataDir, input.assetId));
      if (!image.isEmpty()) {
        writeImage(image);
        return { ok: true };
      }
      if (!input.dataUrl) return { ok: false, error: 'Image data could not be decoded.' };
    } catch (error) {
      if (!input.dataUrl) throw error;
    }
    return copyImageDataUrlToClipboard(input.dataUrl, createImageFromDataUrl, writeImage);
  } catch (error) {
    return { ok: false, error: publicImageActionError(error, 'Failed to copy image.') };
  }
}

export function copyImageDataUrlToClipboard<TImage extends NativeImageLike>(
  dataUrlValue: unknown,
  createImage: (dataUrl: string) => TImage,
  writeImage: (image: TImage) => void,
): DesktopImageActionResult {
  const dataUrl = String(dataUrlValue ?? '');
  if (!SAFE_IMAGE_DATA_URL.test(dataUrl) || dataUrl.length > MAX_ENCODED_IMAGE_CHARS) {
    return { ok: false, error: 'Image data is invalid or too large.' };
  }
  try {
    const image = createImage(dataUrl);
    if (image.isEmpty()) return { ok: false, error: 'Image data could not be decoded.' };
    writeImage(image);
    return { ok: true };
  } catch {
    return { ok: false, error: 'Failed to copy image.' };
  }
}

export async function revealChatImage(
  userDataDir: string,
  inputValue: unknown,
  showItemInFolder: (targetPath: string) => void,
): Promise<DesktopImageActionResult> {
  try {
    const input = normalizeImageInput(inputValue);
    let imagePath: string;
    if (input.assetId) {
      try {
        imagePath = await resolveGeneratedImageAssetPath(userDataDir, input.assetId);
      } catch (error) {
        if (!input.dataUrl) throw error;
        imagePath = await persistInlineImage(userDataDir, input);
      }
    } else {
      imagePath = await persistInlineImage(userDataDir, input);
    }
    showItemInFolder(imagePath);
    return { ok: true };
  } catch (error) {
    return { ok: false, error: publicImageActionError(error, 'Failed to locate generated image.') };
  }
}

export async function resolveGeneratedImageAssetPath(userDataDir: string, assetIdValue: unknown): Promise<string> {
  const assetId = String(assetIdValue ?? '').trim();
  if (!SAFE_ASSET_ID.test(assetId) || assetId === '.' || assetId === '..') {
    throw new GeneratedImageActionError('Generated image asset id is invalid.');
  }

  const root = path.resolve(userDataDir, 'runtime', 'generated-images');
  const requestedAssetDirectory = path.resolve(root, assetId);
  if (path.dirname(requestedAssetDirectory) !== root) {
    throw new GeneratedImageActionError('Generated image asset escapes its storage root.');
  }

  const [canonicalRoot, canonicalAssetDirectory] = await Promise.all([
    realpath(root),
    realpath(requestedAssetDirectory),
  ]);
  if (path.dirname(canonicalAssetDirectory) !== canonicalRoot) {
    throw new GeneratedImageActionError('Generated image asset escapes its storage root.');
  }

  const entries = await readdir(canonicalAssetDirectory, { withFileTypes: true });
  const imagePaths: string[] = [];
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const imagePath = await validatedGeneratedImagePath(canonicalAssetDirectory, entry.name);
    if (imagePath) imagePaths.push(imagePath);
  }
  if (imagePaths.length !== 1) throw new GeneratedImageActionError('Generated image asset is unavailable.');
  return imagePaths[0]!;
}

async function validatedGeneratedImagePath(assetDirectory: string, fileName: string): Promise<string | null> {
  try {
    const imagePath = await realpath(path.join(assetDirectory, fileName));
    const imageStat = await stat(imagePath);
    if (path.dirname(imagePath) !== assetDirectory || !imageStat.isFile()) return null;
    if (!imageStat.size || imageStat.size > MAX_IMAGE_BYTES) return null;

    const handle = await open(imagePath, 'r');
    try {
      const header = Buffer.alloc(12);
      const { bytesRead } = await handle.read(header, 0, header.byteLength, 0);
      return detectImageType(header.subarray(0, bytesRead)) ? imagePath : null;
    } finally {
      await handle.close();
    }
  } catch {
    // Finder/Explorer metadata can disappear while scanning; it is never an image candidate.
    return null;
  }
}

export async function readGeneratedImageAsset(
  userDataDir: string,
  assetId: unknown,
): Promise<DesktopImageDataResult> {
  try {
    const imagePath = await resolveGeneratedImageAssetPath(userDataDir, assetId);
    const data = await readFile(imagePath);
    if (!data.byteLength || data.byteLength > MAX_IMAGE_BYTES) {
      throw new GeneratedImageActionError('Generated image is invalid or too large.');
    }
    const type = detectImageType(data);
    if (!type) throw new GeneratedImageActionError('Generated image type is unsupported.');
    return { ok: true, data: Uint8Array.from(data), type: `image/${type}` };
  } catch (error) {
    return { ok: false, error: publicImageActionError(error, 'Failed to read generated image.') };
  }
}

async function persistInlineImage(userDataDir: string, input: DesktopImageInput): Promise<string> {
  const { data, extension } = decodeSafeImageDataUrl(validatedImageDataUrl(input.dataUrl));
  const assetId = `inline_image_${createHash('sha256').update(data).digest('hex').slice(0, 24)}`;
  const root = path.resolve(userDataDir, 'runtime', 'generated-images');
  const assetDirectory = path.join(root, assetId);
  await mkdir(root, { recursive: true });
  try {
    await mkdir(assetDirectory, { recursive: false });
  } catch (error) {
    if (isNodeError(error) && error.code === 'EEXIST') {
      return resolveGeneratedImageAssetPath(userDataDir, assetId);
    }
    throw error;
  }

  const imagePath = path.join(assetDirectory, safeImageFileName(input.name, extension));
  try {
    await writeFile(imagePath, data, { flag: 'wx', mode: 0o400 });
    return imagePath;
  } catch (error) {
    await rm(assetDirectory, { recursive: true, force: true }).catch(() => undefined);
    throw error;
  }
}

function normalizeImageInput(value: unknown): DesktopImageInput {
  if (!value || typeof value !== 'object') throw new GeneratedImageActionError('Image input is invalid.');
  const record = value as Record<string, unknown>;
  const dataUrl = typeof record.dataUrl === 'string' && record.dataUrl.trim() ? record.dataUrl : undefined;
  const name = typeof record.name === 'string' && record.name.trim() ? record.name.trim() : 'image';
  const assetId = typeof record.assetId === 'string' && record.assetId.trim() ? record.assetId.trim() : undefined;
  if (!assetId && !dataUrl) throw new GeneratedImageActionError('Image input has no readable source.');
  return { ...(dataUrl ? { dataUrl } : {}), name, ...(assetId ? { assetId } : {}) };
}

function validatedImageDataUrl(value: string | undefined): string {
  const dataUrl = value ?? '';
  if (!SAFE_IMAGE_DATA_URL.test(dataUrl) || dataUrl.length > MAX_ENCODED_IMAGE_CHARS) {
    throw new GeneratedImageActionError('Image data is invalid or too large.');
  }
  return dataUrl;
}

function decodeSafeImageDataUrl(dataUrl: string): { data: Buffer; extension: string } {
  if (dataUrl.length > MAX_ENCODED_IMAGE_CHARS) {
    throw new GeneratedImageActionError('Image data is invalid or too large.');
  }
  const match = /^data:image\/(gif|jpeg|png|webp);base64,([A-Za-z0-9+/]*={0,2})$/iu.exec(dataUrl);
  if (!match) throw new GeneratedImageActionError('Image data is invalid or too large.');
  const data = Buffer.from(match[2]!, 'base64');
  if (!data.byteLength || data.byteLength > MAX_IMAGE_BYTES) {
    throw new GeneratedImageActionError('Image data is invalid or too large.');
  }
  const declaredType = match[1]!.toLowerCase();
  const detectedType = detectImageType(data);
  if (!detectedType || detectedType !== declaredType) {
    throw new GeneratedImageActionError('Image data does not match its declared type.');
  }
  return { data, extension: declaredType === 'jpeg' ? 'jpg' : declaredType };
}

function detectImageType(data: Buffer): 'gif' | 'jpeg' | 'png' | 'webp' | null {
  if (data.length >= 8 && data.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
  if (data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) return 'jpeg';
  if (data.length >= 6 && ['GIF87a', 'GIF89a'].includes(data.subarray(0, 6).toString('ascii'))) return 'gif';
  if (data.length >= 12 && data.subarray(0, 4).toString('ascii') === 'RIFF' && data.subarray(8, 12).toString('ascii') === 'WEBP') return 'webp';
  return null;
}

function safeImageFileName(name: string, extension: string): string {
  const sourceName = name.trim().split(/[\\/]+/u).at(-1) ?? '';
  const stem = replaceControlCharacters(sourceName.slice(0, -path.extname(sourceName).length), '_')
    .replace(/[<>:"/\\|?*]/gu, '_')
    .replace(/[. ]+$/u, '')
    .trim()
    .slice(0, 120) || 'image';
  const safeStem = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])$/iu.test(stem) ? `_${stem}` : stem;
  return `${safeStem}.${extension}`;
}

function replaceControlCharacters(value: string, replacement: string): string {
  return Array.from(value, (character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint <= 0x1f || codePoint === 0x7f ? replacement : character;
  }).join('');
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error;
}

function publicImageActionError(error: unknown, fallback: string): string {
  return error instanceof GeneratedImageActionError ? error.message : fallback;
}
