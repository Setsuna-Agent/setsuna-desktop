import { access, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { clearDesktopLogs, scanDesktopStorage } from '../../../src/data-root/storage-files.js';
import { DesktopStorageService, type StorageCacheSession } from '../../../src/data-root/storage.js';

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });

async function temporaryRoot() {
  const root = await mkdtemp(path.join(tmpdir(), 'setsuna-storage-'));
  roots.push(root);
  return root;
}

async function fixture(root: string, relative: string, content: string) {
  const file = path.join(root, relative);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, content);
  return file;
}

function cacheSession() {
  return {
    clearCache: vi.fn<StorageCacheSession['clearCache']>(async () => undefined),
    clearCodeCaches: vi.fn<StorageCacheSession['clearCodeCaches']>(async () => undefined),
    clearStorageData: vi.fn<StorageCacheSession['clearStorageData']>(async () => undefined),
  } satisfies StorageCacheSession;
}

describe('desktop storage management', () => {
  it('counts every managed category once without following linked workspaces', async () => {
    const root = await temporaryRoot();
    const outside = await temporaryRoot();
    await Promise.all([
      fixture(root, 'runtime/threads.sqlite', '123456'),
      fixture(root, 'runtime/tool-results/result.json', '1234'),
      fixture(root, 'runtime/attachments/files/a/image.png', '123'),
      fixture(root, 'runtime/generated-images/a/image.png', '12'),
      fixture(root, 'runtime/logs/runtime.log', '12345'),
      fixture(root, 'Partitions/browser/Cache/data', '1234567'),
      fixture(root, 'runtime/user-skills/my-skill/cache/file', '12345678'),
      fixture(root, 'runtime/workspace-dependencies/cache/corepack/pnpm', '123456789'),
      fixture(root, 'Local Storage/leveldb/log', '12'),
      fixture(outside, 'private.txt', 'not application data'),
    ]);
    await symlink(outside, path.join(root, 'linked-workspace'), 'junction');
    const usage = await scanDesktopStorage(root);
    const sizes = Object.fromEntries(usage.categories.map((item) => [item.id, item.totalBytes]));
    expect(sizes).toMatchObject({ conversations: 10, attachments_images: 5, cache: 7, logs: 5,
      projects_capabilities: 8, runtime_dependencies: 9, desktop_browser: 2 });
    expect(usage.totalBytes).toBe(46);
    expect(usage.incomplete).toBe(false);
  });

  it('clears only fixed log roots, preserving directories, live data and external symlink targets', async () => {
    const root = await temporaryRoot();
    const outside = await temporaryRoot();
    const log = await fixture(root, 'runtime/logs/runtime.log', 'log');
    const rootLog = await fixture(root, 'logs/old/nested.log', 'log');
    const original = await fixture(outside, 'original.txt', 'original');
    const keep = await Promise.all([
      fixture(root, 'runtime/user-skills/skill/logs/user.txt', 'user'),
      fixture(root, 'runtime/threads.sqlite', 'database'),
      fixture(root, 'runtime/attachments/files/image', 'image'),
      fixture(root, 'Local Storage/leveldb/000003.log', 'draft'),
    ]);
    await symlink(outside, path.join(root, 'runtime/logs/external'), 'junction');
    await clearDesktopLogs(root);
    await expect(access(log)).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(access(rootLog)).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(access(path.dirname(log))).resolves.toBeUndefined();
    await Promise.all(keep.map((file) => expect(access(file)).resolves.toBeUndefined()));
    expect(await readFile(original, 'utf8')).toBe('original');
  });

  it('refuses cleanup when a fixed log root is reached through a linked runtime directory', async () => {
    const root = await temporaryRoot();
    const outside = await temporaryRoot();
    const original = await fixture(outside, 'logs/file.log', 'keep');
    await symlink(outside, path.join(root, 'runtime'), 'junction');
    await expect(clearDesktopLogs(root)).rejects.toThrow('could not be removed');
    expect(await readFile(original, 'utf8')).toBe('keep');
  });

  it('does no work at construction and validates the entire cleanup selection before mutation', async () => {
    const root = await temporaryRoot();
    const log = await fixture(root, 'runtime/logs/file.log', 'keep');
    const session = cacheSession();
    const activeRoot = vi.fn(() => root);
    const sessions = vi.fn(() => [session]);
    const service = new DesktopStorageService(activeRoot, sessions);
    expect(activeRoot).not.toHaveBeenCalled();
    expect(sessions).not.toHaveBeenCalled();
    await expect(service.clear(['logs', '../attachments'])).rejects.toThrow('Invalid');
    await expect(service.clear('logs')).rejects.toThrow('Invalid');
    expect(await readFile(log, 'utf8')).toBe('keep');
    expect(sessions).not.toHaveBeenCalled();
  });

  it('uses cache-only Electron operations and reports partial failures after all selected work settles', async () => {
    const root = await temporaryRoot();
    const log = await fixture(root, 'runtime/logs/file.log', 'remove');
    const session = cacheSession();
    session.clearCodeCaches.mockRejectedValueOnce(new Error('busy'));
    const service = new DesktopStorageService(() => root, () => [session, session]);
    expect(await service.clear(['cache', 'logs'])).toEqual({ failedCategories: ['cache'] });
    expect(session.clearCache).toHaveBeenCalledTimes(1);
    expect(session.clearCodeCaches).toHaveBeenCalledWith({});
    expect(session.clearStorageData).toHaveBeenCalledExactlyOnceWith({ storages: ['shadercache'] });
    await expect(access(log)).rejects.toMatchObject({ code: 'ENOENT' });
    expect((await service.getUsage()).totalBytes).toBe(0);
  });

  it('shares in-flight scans and waits for cache cleanup before reporting refreshed usage', async () => {
    const root = await temporaryRoot();
    const cache = await fixture(root, 'Cache/file', 'cache');
    const session = cacheSession();
    let release!: () => void;
    session.clearCache.mockImplementationOnce(() => new Promise<void>((resolve) => { release = resolve; }));
    const service = new DesktopStorageService(() => root, () => [session]);
    const clear = service.clear(['cache']);
    await vi.waitFor(() => expect(session.clearCache).toHaveBeenCalled());
    await expect(service.clear(['logs'])).rejects.toThrow('already running');
    const scan = service.getUsage();
    expect(service.getUsage()).toBe(scan);
    await rm(cache);
    release();
    await clear;
    expect((await scan).totalBytes).toBe(0);
  });
});
