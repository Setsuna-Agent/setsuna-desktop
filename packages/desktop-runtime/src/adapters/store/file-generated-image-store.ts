import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { GeneratedImageStore, GeneratedImageStoreInput } from '../../ports/generated-image-store.js';
import type { IdGenerator } from '../../ports/id-generator.js';
import { assertSafeRuntimeId } from '../../security/runtime-id.js';
import { detectSafeImageMimeType, type SafeImageMimeType } from '../../utils/safe-image.js';

const MAX_GENERATED_IMAGE_BYTES = 20 * 1024 * 1024;

/** 保存图片生成结果，renderer 只持有不透明 asset ID，不接触本地路径。 */
export class FileGeneratedImageStore implements GeneratedImageStore {
  private readonly root: string;

  constructor(dataDir: string, private readonly ids: IdGenerator) {
    this.root = path.join(dataDir, 'generated-images');
  }

  async create(input: GeneratedImageStoreInput): Promise<{ assetId: string }> {
    const data = Buffer.from(input.data);
    if (!data.byteLength) throw new Error('Generated image is empty.');
    if (data.byteLength > MAX_GENERATED_IMAGE_BYTES) throw new Error('Generated image exceeds the 20 MB limit.');
    const detectedType = detectSafeImageMimeType(data);
    if (!detectedType || detectedType !== input.type.trim().toLowerCase()) {
      throw new Error('Generated image type does not match its content.');
    }

    const assetId = assertSafeRuntimeId(this.ids.id('generated_image'), 'Generated image asset id');
    const assetDirectory = path.join(this.root, assetId);
    const fileName = safeImageFileName(input.name, detectedType);
    await mkdir(this.root, { recursive: true });
    await mkdir(assetDirectory, { recursive: false });
    try {
      await writeFile(path.join(assetDirectory, fileName), data, { flag: 'wx', mode: 0o400 });
    } catch (error) {
      await rm(assetDirectory, { recursive: true, force: true }).catch(() => undefined);
      throw error;
    }
    return { assetId };
  }
}

function safeImageFileName(name: string, type: SafeImageMimeType): string {
  const sourceName = name.trim().split(/[\\/]+/u).at(-1) ?? '';
  const sourceStem = sourceName.slice(0, -path.extname(sourceName).length);
  const stem = replaceControlCharacters(sourceStem, '_')
    .replace(/[<>:"/\\|?*]/gu, '_')
    .replace(/[. ]+$/u, '')
    .trim()
    .slice(0, 120) || 'generated-image';
  const safeStem = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])$/iu.test(stem) ? `_${stem}` : stem;
  return `${safeStem}.${imageExtension(type)}`;
}

function imageExtension(type: SafeImageMimeType): string {
  return type === 'image/jpeg' ? 'jpg' : type.slice('image/'.length);
}

function replaceControlCharacters(value: string, replacement: string): string {
  return Array.from(value, (character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint <= 0x1f || codePoint === 0x7f ? replacement : character;
  }).join('');
}
