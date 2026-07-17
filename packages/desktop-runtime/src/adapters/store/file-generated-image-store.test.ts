import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { FileGeneratedImageStore } from './file-generated-image-store.js';

const ONE_PIXEL_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
);
const testDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(testDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe('file generated image store', () => {
  it('stores a validated image under an opaque asset directory', async () => {
    const dataDir = await mkdtemp(path.join(tmpdir(), 'setsuna-generated-image-'));
    testDirectories.push(dataDir);
    const store = new FileGeneratedImageStore(dataDir, { id: () => 'generated_image_1' });

    await expect(store.create({
      name: '../mountain:night.png',
      type: 'image/png',
      data: ONE_PIXEL_PNG,
    })).resolves.toEqual({ assetId: 'generated_image_1' });
    await expect(readFile(path.join(dataDir, 'generated-images', 'generated_image_1', 'mountain_night.png')))
      .resolves.toEqual(ONE_PIXEL_PNG);
  });

  it('rejects a declared image type that does not match the bytes', async () => {
    const dataDir = await mkdtemp(path.join(tmpdir(), 'setsuna-generated-image-'));
    testDirectories.push(dataDir);
    const store = new FileGeneratedImageStore(dataDir, { id: () => 'generated_image_1' });

    await expect(store.create({ name: 'image.jpg', type: 'image/jpeg', data: ONE_PIXEL_PNG }))
      .rejects.toThrow('does not match');
  });
});
