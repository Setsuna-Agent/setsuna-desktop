import { access, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
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
    await expect(store.read('generated_image_1')).resolves.toEqual({
      name: 'mountain_night.png',
      type: 'image/png',
      data: ONE_PIXEL_PNG,
    });
    await expect(readFile(path.join(dataDir, 'generated-images', 'generated_image_1', 'mountain_night.png')))
      .resolves.toEqual(ONE_PIXEL_PNG);
    await expect(store.delete('generated_image_1')).resolves.toBeUndefined();
    await expect(access(path.join(dataDir, 'generated-images', 'generated_image_1'))).rejects.toThrow();
  });

  it('rejects a declared image type that does not match the bytes', async () => {
    const dataDir = await mkdtemp(path.join(tmpdir(), 'setsuna-generated-image-'));
    testDirectories.push(dataDir);
    const store = new FileGeneratedImageStore(dataDir, { id: () => 'generated_image_1' });

    await expect(store.create({ name: 'image.jpg', type: 'image/jpeg', data: ONE_PIXEL_PNG }))
      .rejects.toThrow('does not match');
  });

  it('removes unreferenced assets during startup recovery', async () => {
    const dataDir = await mkdtemp(path.join(tmpdir(), 'setsuna-generated-image-'));
    testDirectories.push(dataDir);
    let nextId = 0;
    const store = new FileGeneratedImageStore(dataDir, { id: () => `generated_image_${++nextId}` });
    const retained = await store.create({ name: 'retained.png', type: 'image/png', data: ONE_PIXEL_PNG });
    const orphaned = await store.create({ name: 'orphaned.png', type: 'image/png', data: ONE_PIXEL_PNG });

    await store.recover([retained.assetId, '../invalid']);

    await expect(access(path.join(dataDir, 'generated-images', retained.assetId))).resolves.toBeUndefined();
    await expect(access(path.join(dataDir, 'generated-images', orphaned.assetId))).rejects.toThrow();
  });

  it('clones a managed asset into a new opaque directory for thread forks', async () => {
    const dataDir = await mkdtemp(path.join(tmpdir(), 'setsuna-generated-image-'));
    testDirectories.push(dataDir);
    let nextId = 0;
    const store = new FileGeneratedImageStore(dataDir, { id: () => `generated_image_${++nextId}` });
    const source = await store.create({ name: 'fork-source.png', type: 'image/png', data: ONE_PIXEL_PNG });
    await writeFile(
      path.join(dataDir, 'generated-images', source.assetId, '.DS_Store'),
      Buffer.from('finder metadata'),
    );

    const cloned = await store.clone(source.assetId);

    expect(cloned.assetId).not.toBe(source.assetId);
    await expect(readFile(path.join(dataDir, 'generated-images', cloned.assetId, 'fork-source.png')))
      .resolves.toEqual(ONE_PIXEL_PNG);
  });
});
