import { EventEmitter } from 'node:events';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { get } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { AutoUpdater } from 'electron';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MacUpdateInstaller } from '../../src/main/mac-update-installer.js';

const roots: string[] = [];
const installers: MacUpdateInstaller[] = [];
afterEach(async () => {
  installers.splice(0).forEach((installer) => installer.dispose());
  vi.useRealTimers();
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), 'setsuna-mac-update-'));
  roots.push(root);
  const archive = path.join(root, 'update.zip');
  await writeFile(archive, 'archive bytes');
  const native = Object.assign(new EventEmitter(), {
    setFeedURL: vi.fn(), checkForUpdates: vi.fn(), quitAndInstall: vi.fn(),
  });
  const onError = vi.fn();
  const installer = new MacUpdateInstaller(native as unknown as AutoUpdater, onError);
  installers.push(installer);
  return { installer, native, archive, onError };
}

describe('native macOS update handoff', () => {
  it('serves only the selected ZIP and waits for native staging before allowing restart', async () => {
    const { installer, native, archive } = await fixture();
    expect(() => installer.quitAndInstall()).toThrow('No verified macOS update');
    const prepared = installer.prepare(archive, 'v0.4.0');
    void prepared.catch(() => undefined); // Assertions may abort before the native completion is emitted.
    expect(installer.prepare(archive, 'v0.4.0')).toBe(prepared);
    await vi.waitFor(() => expect(native.checkForUpdates).toHaveBeenCalledOnce());
    const feedUrl = native.setFeedURL.mock.calls[0][0].url as string;
    const feed = await (await fetch(feedUrl)).json() as { url: string; name: string };
    expect(new URL(feedUrl).hostname).toBe('127.0.0.1');
    expect(feed.name).toBe('v0.4.0');
    expect(await (await fetch(feed.url)).text()).toBe('archive bytes');
    expect((await fetch(new URL('/update.zip', feedUrl))).status).toBe(404);
    expect((await fetch(`${feed.url}/../other-file`)).status).toBe(404);
    expect((await fetch(feedUrl, { method: 'POST' })).status).toBe(404);
    const foreignHostStatus = await new Promise<number | undefined>((resolve, reject) => {
      get(feedUrl, { headers: { host: 'attacker.example' } }, (response) => {
        response.resume();
        resolve(response.statusCode);
      }).on('error', reject);
    });
    expect(foreignHostStatus).toBe(404);
    native.emit('update-downloaded', {}, '', '', new Date(), 'http://127.0.0.1/stale.zip');
    expect(() => installer.quitAndInstall()).toThrow('No verified macOS update');
    native.emit('update-downloaded', {}, '', '', new Date(), feed.url);
    await prepared;
    await expect(fetch(feedUrl)).rejects.toThrow();
    expect(native.quitAndInstall).not.toHaveBeenCalled();
    vi.useFakeTimers();
    installer.quitAndInstall();
    installer.quitAndInstall();
    expect(native.quitAndInstall).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(50);
    expect(native.quitAndInstall).toHaveBeenCalledOnce();
  });

  it('closes the feed after signature rejection, permits retry, and reports late errors', async () => {
    const { installer, native, archive, onError } = await fixture();
    const prepared = installer.prepare(archive, 'v0.4.0');
    const rejected = expect(prepared).rejects.toThrow('Signature mismatch');
    await vi.waitFor(() => expect(native.checkForUpdates).toHaveBeenCalledOnce());
    const url = native.setFeedURL.mock.calls[0][0].url as string;
    native.emit('error', new Error('Signature mismatch'));
    await rejected;
    await expect(fetch(url)).rejects.toThrow();
    expect(() => installer.quitAndInstall()).toThrow('No verified macOS update');
    const retry = installer.prepare(archive, 'v0.4.0');
    await vi.waitFor(() => expect(native.checkForUpdates).toHaveBeenCalledTimes(2));
    const retryFeed = await (await fetch(native.setFeedURL.mock.calls[1][0].url)).json() as { url: string };
    native.emit('update-downloaded', {}, '', '', new Date(), retryFeed.url);
    await retry;
    native.emit('error', new Error('Install failed'));
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: 'Install failed' }));
    expect(() => installer.quitAndInstall()).toThrow('No verified macOS update');
  });

  it('cancels pending preparation on shutdown and removes its listeners', async () => {
    const { installer, native, archive } = await fixture();
    const prepared = installer.prepare(archive, 'v0.4.0');
    const rejected = expect(prepared).rejects.toThrow('updater has stopped');
    await vi.waitFor(() => expect(native.checkForUpdates).toHaveBeenCalledOnce());
    const url = native.setFeedURL.mock.calls[0][0].url as string;
    installer.dispose();
    await rejected;
    await expect(fetch(url)).rejects.toThrow();
    expect(native.listenerCount('update-downloaded')).toBe(0);
    expect(native.listenerCount('error')).toBe(0);
    expect(native.quitAndInstall).not.toHaveBeenCalled();
  });
});
