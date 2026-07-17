import { createHash } from 'node:crypto';
import { mkdir, readdir, realpath, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { DesktopImageActionResult, DesktopRevealImageInput } from '@setsuna-desktop/contracts';

const MAX_ENCODED_IMAGE_CHARS = Math.ceil((20 * 1024 * 1024 * 4) / 3) + 1_024;
const SAFE_IMAGE_DATA_URL = /^data:image\/(?:gif|jpeg|png|webp);base64,/iu;
const SAFE_ASSET_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,191}$/u;

type NativeImageLike = { isEmpty(): boolean };

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
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'Failed to copy image.' };
  }
}

export async function revealChatImage(
  userDataDir: string,
  inputValue: unknown,
  showItemInFolder: (targetPath: string) => void,
): Promise<DesktopImageActionResult> {
  try {
    const input = normalizeRevealImageInput(inputValue);
    const imagePath = input.assetId
      ? await resolveGeneratedImageAssetPath(userDataDir, input.assetId)
      : await persistInlineImage(userDataDir, input);
    showItemInFolder(imagePath);
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'Failed to locate generated image.' };
  }
}

export async function resolveGeneratedImageAssetPath(userDataDir: string, assetIdValue: unknown): Promise<string> {
  const assetId = String(assetIdValue ?? '').trim();
  if (!SAFE_ASSET_ID.test(assetId) || assetId === '.' || assetId === '..') {
    throw new Error('Generated image asset id is invalid.');
  }

  const root = path.resolve(userDataDir, 'runtime', 'generated-images');
  const requestedAssetDirectory = path.resolve(root, assetId);
  if (path.dirname(requestedAssetDirectory) !== root) throw new Error('Generated image asset escapes its storage root.');

  const [canonicalRoot, canonicalAssetDirectory] = await Promise.all([
    realpath(root),
    realpath(requestedAssetDirectory),
  ]);
  if (path.dirname(canonicalAssetDirectory) !== canonicalRoot) {
    throw new Error('Generated image asset escapes its storage root.');
  }

  const entries = await readdir(canonicalAssetDirectory, { withFileTypes: true });
  const files = entries.filter((entry) => entry.isFile());
  if (entries.length !== 1 || files.length !== 1) throw new Error('Generated image asset is unavailable.');
  const imagePath = await realpath(path.join(canonicalAssetDirectory, files[0]!.name));
  if (path.dirname(imagePath) !== canonicalAssetDirectory || !(await stat(imagePath)).isFile()) {
    throw new Error('Generated image asset is unavailable.');
  }
  return imagePath;
}

async function persistInlineImage(userDataDir: string, input: DesktopRevealImageInput): Promise<string> {
  const { data, extension } = decodeSafeImageDataUrl(input.dataUrl);
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

function normalizeRevealImageInput(value: unknown): DesktopRevealImageInput {
  if (!value || typeof value !== 'object') throw new Error('Image input is invalid.');
  const record = value as Record<string, unknown>;
  const dataUrl = typeof record.dataUrl === 'string' ? record.dataUrl : '';
  const name = typeof record.name === 'string' && record.name.trim() ? record.name.trim() : 'image';
  const assetId = typeof record.assetId === 'string' && record.assetId.trim() ? record.assetId.trim() : undefined;
  return { dataUrl, name, ...(assetId ? { assetId } : {}) };
}

function decodeSafeImageDataUrl(dataUrl: string): { data: Buffer; extension: string } {
  if (dataUrl.length > MAX_ENCODED_IMAGE_CHARS) throw new Error('Image data is invalid or too large.');
  const match = /^data:image\/(gif|jpeg|png|webp);base64,([A-Za-z0-9+/]*={0,2})$/iu.exec(dataUrl);
  if (!match) throw new Error('Image data is invalid or too large.');
  const data = Buffer.from(match[2]!, 'base64');
  if (!data.byteLength || data.byteLength > 20 * 1024 * 1024) throw new Error('Image data is invalid or too large.');
  const declaredType = match[1]!.toLowerCase();
  const detectedType = detectImageType(data);
  if (!detectedType || detectedType !== declaredType) throw new Error('Image data does not match its declared type.');
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
