import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  copyChatImage,
  copyImageDataUrlToClipboard,
  readGeneratedImageAsset,
  resolveGeneratedImageAssetPath,
  revealChatImage,
} from './generated-image-actions.js';

const ONE_PIXEL_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
);

const testDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(testDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe('generated image desktop actions', () => {
  it('copies a validated image data URL through the native clipboard adapter', () => {
    const image = { isEmpty: () => false };
    const createImage = vi.fn(() => image);
    const writeImage = vi.fn();

    expect(copyImageDataUrlToClipboard('data:image/png;base64,AA==', createImage, writeImage)).toEqual({ ok: true });
    expect(createImage).toHaveBeenCalledWith('data:image/png;base64,AA==');
    expect(writeImage).toHaveBeenCalledWith(image);
    expect(copyImageDataUrlToClipboard('https://example.test/image.png', createImage, writeImage))
      .toEqual({ ok: false, error: 'Image data is invalid or too large.' });
  });

  it('resolves and reveals only a generated image inside its managed asset directory', async () => {
    const userDataDir = await mkdtemp(path.join(tmpdir(), 'setsuna-user-data-'));
    testDirectories.push(userDataDir);
    const assetDirectory = path.join(userDataDir, 'runtime', 'generated-images', 'generated_image_1');
    const imagePath = path.join(assetDirectory, 'generated-1.png');
    await mkdir(assetDirectory, { recursive: true });
    await writeFile(imagePath, ONE_PIXEL_PNG);
    await writeFile(path.join(assetDirectory, '.DS_Store'), Buffer.from('finder metadata'));

    await expect(resolveGeneratedImageAssetPath(userDataDir, 'generated_image_1')).resolves.toBe(imagePath);
    await expect(resolveGeneratedImageAssetPath(userDataDir, '../outside')).rejects.toThrow('invalid');
    const showItemInFolder = vi.fn();
    await expect(revealChatImage(userDataDir, {
      assetId: 'generated_image_1',
      dataUrl: `data:image/png;base64,${ONE_PIXEL_PNG.toString('base64')}`,
      name: 'generated-1.png',
    }, showItemInFolder)).resolves.toEqual({ ok: true });
    expect(showItemInFolder).toHaveBeenCalledWith(imagePath);
  });

  it('reads and copies a managed generated image without exposing its path to the renderer', async () => {
    const userDataDir = await mkdtemp(path.join(tmpdir(), 'setsuna-user-data-'));
    testDirectories.push(userDataDir);
    const assetDirectory = path.join(userDataDir, 'runtime', 'generated-images', 'generated_image_1');
    const imagePath = path.join(assetDirectory, 'generated-1.png');
    await mkdir(assetDirectory, { recursive: true });
    await writeFile(imagePath, ONE_PIXEL_PNG);

    await expect(readGeneratedImageAsset(userDataDir, 'generated_image_1')).resolves.toEqual({
      ok: true,
      data: Uint8Array.from(ONE_PIXEL_PNG),
      type: 'image/png',
    });
    const image = { isEmpty: () => false };
    const createFromDataUrl = vi.fn(() => image);
    const createFromPath = vi.fn(() => image);
    const writeImage = vi.fn();
    await expect(copyChatImage(
      userDataDir,
      { assetId: 'generated_image_1', name: 'generated-1.png' },
      createFromDataUrl,
      createFromPath,
      writeImage,
    )).resolves.toEqual({ ok: true });
    expect(createFromDataUrl).not.toHaveBeenCalled();
    expect(createFromPath).toHaveBeenCalledWith(imagePath);
    expect(writeImage).toHaveBeenCalledWith(image);
  });

  it('persists a legacy inline image before revealing it', async () => {
    const userDataDir = await mkdtemp(path.join(tmpdir(), 'setsuna-user-data-'));
    testDirectories.push(userDataDir);
    const showItemInFolder = vi.fn();

    await expect(revealChatImage(userDataDir, {
      dataUrl: `data:image/png;base64,${ONE_PIXEL_PNG.toString('base64')}`,
      name: '../legacy:image.png',
    }, showItemInFolder)).resolves.toEqual({ ok: true });
    const revealedPath = showItemInFolder.mock.calls[0]?.[0] as string;
    expect(revealedPath).toMatch(/[\\/]generated-images[\\/]inline_image_[a-f0-9]{24}[\\/]legacy_image\.png$/u);
    await expect(readFile(revealedPath)).resolves.toEqual(ONE_PIXEL_PNG);
  });

  it('falls back to persisted inline data when a legacy local asset is stale', async () => {
    const userDataDir = await mkdtemp(path.join(tmpdir(), 'setsuna-user-data-'));
    testDirectories.push(userDataDir);
    const dataUrl = `data:image/png;base64,${ONE_PIXEL_PNG.toString('base64')}`;
    const input = { assetId: 'missing_legacy_asset', dataUrl, name: 'legacy.png' };
    const image = { isEmpty: () => false };
    const createFromDataUrl = vi.fn(() => image);
    const createFromPath = vi.fn(() => image);
    const writeImage = vi.fn();

    await expect(copyChatImage(
      userDataDir,
      input,
      createFromDataUrl,
      createFromPath,
      writeImage,
    )).resolves.toEqual({ ok: true });
    expect(createFromDataUrl).toHaveBeenCalledWith(dataUrl);
    expect(createFromPath).not.toHaveBeenCalled();

    const showItemInFolder = vi.fn();
    await expect(revealChatImage(userDataDir, input, showItemInFolder)).resolves.toEqual({ ok: true });
    expect(showItemInFolder.mock.calls[0]?.[0]).toMatch(/[\\/]generated-images[\\/]inline_image_[a-f0-9]{24}[\\/]legacy\.png$/u);
  });

  it('does not expose local filesystem paths through asset read errors', async () => {
    const userDataDir = await mkdtemp(path.join(tmpdir(), 'setsuna-private-user-data-'));
    testDirectories.push(userDataDir);

    const result = await readGeneratedImageAsset(userDataDir, 'missing_generated_image');

    expect(result).toEqual({ ok: false, error: 'Failed to read generated image.' });
    expect(result.ok || result.error.includes(userDataDir)).toBe(false);
  });
});
