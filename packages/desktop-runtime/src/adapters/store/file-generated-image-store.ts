import { mkdir, readFile, readdir, realpath, rm, stat, writeFile } from 'node:fs/promises';
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

  async clone(assetId: string): Promise<{ assetId: string }> {
    const { data, name, type } = await this.read(assetId);
    return this.create({ data, name, type });
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

  async delete(assetId: string): Promise<void> {
    const safeAssetId = assertSafeRuntimeId(assetId, 'Generated image asset id');
    await rm(path.join(this.root, safeAssetId), { recursive: true, force: true });
  }

  async read(assetId: string): Promise<{ data: Buffer; name: string; type: SafeImageMimeType }> {
    const safeAssetId = assertSafeRuntimeId(assetId, 'Generated image asset id');
    const canonicalRoot = await realpath(this.root);
    const canonicalAssetDirectory = await realpath(path.join(this.root, safeAssetId));
    if (path.dirname(canonicalAssetDirectory) !== canonicalRoot) {
      throw new Error('Generated image asset escapes its storage root.');
    }
    const entries = await readdir(canonicalAssetDirectory, { withFileTypes: true });
    const images: Array<{ data: Buffer; name: string; type: SafeImageMimeType }> = [];
    for (const entry of entries) {
      if (!entry.isFile()) continue;
      try {
        const imagePath = await realpath(path.join(canonicalAssetDirectory, entry.name));
        const imageStat = await stat(imagePath);
        if (path.dirname(imagePath) !== canonicalAssetDirectory || !imageStat.isFile()) continue;
        if (!imageStat.size || imageStat.size > MAX_GENERATED_IMAGE_BYTES) continue;
        const data = await readFile(imagePath);
        const type = detectSafeImageMimeType(data);
        if (type) images.push({ data, name: entry.name, type });
      } catch {
        // OS metadata files may be created or removed after revealing this directory.
      }
    }
    if (images.length !== 1) throw new Error('Generated image asset is unavailable.');
    return images[0]!;
  }

  async recover(retainedAssetIds: string[]): Promise<void> {
    const retained = new Set<string>();
    for (const assetId of retainedAssetIds) {
      try {
        retained.add(assertSafeRuntimeId(assetId, 'Generated image asset id'));
      } catch {
        // Corrupt attachment metadata should not prevent the runtime from recovering other threads.
      }
    }
    await mkdir(this.root, { recursive: true });
    const entries = await readdir(this.root, { withFileTypes: true });
    await Promise.all(entries.flatMap((entry) => {
      if (!entry.isDirectory() || retained.has(entry.name)) return [];
      // Directory names come from readdir, but validate containment before recursive removal.
      const candidate = path.resolve(this.root, entry.name);
      if (path.dirname(candidate) !== path.resolve(this.root)) return [];
      return [rm(candidate, { recursive: true, force: true })];
    }));
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
