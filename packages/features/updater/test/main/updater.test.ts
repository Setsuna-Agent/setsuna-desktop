import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { app, shell } from 'electron';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DesktopUpdater } from '../../src/main/updater.js';

const native = vi.hoisted(() => ({ prepare: vi.fn(), quitAndInstall: vi.fn(), dispose: vi.fn() }));
vi.mock('../../src/main/mac-update-installer.js', () => ({
  MacUpdateInstaller: class {
    prepare = native.prepare;
    quitAndInstall = native.quitAndInstall;
    dispose = native.dispose;
  },
}));
vi.mock('electron', () => ({
  app: { quit: vi.fn() }, autoUpdater: {}, BrowserWindow: { getAllWindows: () => [] },
  shell: { openPath: vi.fn(async () => ''), showItemInFolder: vi.fn() },
}));

// Independent fake versions exercise an upgrade; the injected fetch never contacts GitHub.
const CURRENT_VERSION = '0.3.2';
const AVAILABLE_VERSION = '0.4.0';
const RELEASE_TAG = `v${AVAILABLE_VERSION}`;
const LATEST_RELEASE_URL = 'https://api.github.com/repos/Setsuna-Agent/setsuna-desktop/releases/latest';

const roots: string[] = [];
const updaters: DesktopUpdater[] = [];
const platform = Object.getOwnPropertyDescriptor(process, 'platform')!;
beforeEach(() => {
  vi.clearAllMocks();
  native.prepare.mockReset().mockResolvedValue(undefined);
  Object.defineProperty(process, 'platform', { value: 'darwin' });
});
afterEach(async () => {
  updaters.splice(0).forEach((updater) => updater.stop());
  Object.defineProperty(process, 'platform', platform);
  vi.useRealTimers();
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function fixture(options: { extension?: string; checksum?: 'missing' | 'wrong' } = {}) {
  const root = await mkdtemp(path.join(tmpdir(), 'setsuna-updater-'));
  roots.push(root);
  const extension = options.extension ?? 'zip';
  const target = process.platform === 'win32' ? 'windows-x64' : `mac-${process.arch}`;
  const name = `Setsuna-Desktop-${AVAILABLE_VERSION}-${target}.${extension}`;
  const data = 'signed update fixture';
  const hash = options.checksum === 'wrong' ? '0'.repeat(64) : createHash('sha256').update(data).digest('hex');
  const base = `https://github.com/Setsuna-Agent/setsuna-desktop/releases/download/${RELEASE_TAG}`;
  const fetch = vi.fn(async (input: Parameters<typeof globalThis.fetch>[0]) => {
    const url = String(input);
    if (url === LATEST_RELEASE_URL) return Response.json({
      tag_name: RELEASE_TAG, assets: [
        { name, browser_download_url: `${base}/${name}` },
        ...(options.checksum === 'missing' ? [] : [{ name: 'SHA256SUMS', browser_download_url: `${base}/SHA256SUMS` }]),
      ],
    });
    if (url.endsWith('SHA256SUMS')) return new Response(`${hash}  ${name}\n`);
    if (url.endsWith(name)) return new Response(data);
    throw new Error(`Unexpected request: ${url}`);
  });
  const installUpdate = vi.fn(async (quitAndInstall: () => void) => { quitAndInstall(); return true; });
  const updater = new DesktopUpdater({
    currentVersion: CURRENT_VERSION, repository: 'Setsuna-Agent/setsuna-desktop', enabled: true,
    downloadsDir: root, sourceConfigPath: path.join(root, 'sources.json'), fetch, installUpdate,
  });
  updaters.push(updater);
  await updater.initialize();
  return { updater, fetch, name, base, installUpdate };
}

describe('desktop update installation', () => {
  it('downloads through the selected source, then stages once and delegates shutdown before restarting', async () => {
    const { updater, fetch, name, base, installUpdate } = await fixture();
    await updater.addDownloadSource({ name: 'mirror', urlTemplate: 'https://mirror.example/{url}' });
    const state = await updater.checkAndDownload();
    expect(state).toMatchObject({ status: 'downloaded', installMode: 'native-mac', manualInstall: false });
    expect(await readFile(state.downloadedFilePath!, 'utf8')).toBe('signed update fixture');
    expect(fetch.mock.calls.map(([url]) => String(url))).toEqual([
      LATEST_RELEASE_URL,
      `https://mirror.example/${base}/SHA256SUMS`, `https://mirror.example/${base}/${name}`,
    ]);
    expect(native.prepare).not.toHaveBeenCalled();
    const installing = updater.installReady();
    expect(updater.installReady()).toBe(installing);
    expect(await installing).toMatchObject({ ok: true, action: 'restarting', state: { status: 'installing' } });
    expect(native.prepare).toHaveBeenCalledExactlyOnceWith(state.downloadedFilePath, RELEASE_TAG);
    expect(installUpdate).toHaveBeenCalledOnce();
    expect(native.prepare.mock.invocationCallOrder[0]).toBeLessThan(installUpdate.mock.invocationCallOrder[0]);
    expect(installUpdate.mock.invocationCallOrder[0]).toBeLessThan(native.quitAndInstall.mock.invocationCallOrder[0]);
    expect(shell.showItemInFolder).not.toHaveBeenCalled();
  });

  it.each(['missing', 'wrong'] as const)('rejects %s ZIP checksums before an update can become ready', async (checksum) => {
    const { updater, installUpdate } = await fixture({ checksum });
    expect(await updater.checkAndDownload()).toMatchObject({ status: 'error' });
    expect(await updater.installReady()).toMatchObject({ ok: false });
    expect(native.prepare).not.toHaveBeenCalled();
    expect(installUpdate).not.toHaveBeenCalled();
  });

  it('detects local archive tampering before native staging or runtime shutdown', async () => {
    const { updater, installUpdate } = await fixture();
    const state = await updater.checkAndDownload();
    await writeFile(state.downloadedFilePath!, 'changed after download');
    expect(await updater.installReady()).toMatchObject({ ok: false, error: expect.stringContaining('has changed') });
    expect(native.prepare).not.toHaveBeenCalled();
    expect(installUpdate).not.toHaveBeenCalled();
  });

  it('keeps the app running on a native signature error and allows a fresh download', async () => {
    const { updater, installUpdate } = await fixture();
    await updater.checkAndDownload();
    native.prepare.mockRejectedValueOnce(new Error('Signature mismatch'));
    expect(await updater.installReady()).toMatchObject({ ok: false, state: { status: 'error', error: 'Signature mismatch' } });
    expect(installUpdate).not.toHaveBeenCalled();
    expect(native.quitAndInstall).not.toHaveBeenCalled();
    expect(await updater.checkAndDownload()).toMatchObject({ status: 'downloaded' });
    expect(await updater.installReady()).toMatchObject({ ok: true });
  });

  it('does not restart if the runtime cannot flush and stop', async () => {
    const { updater, installUpdate } = await fixture();
    await updater.checkAndDownload();
    installUpdate.mockRejectedValueOnce(new Error('Runtime shutdown failed'));
    expect(await updater.installReady()).toMatchObject({ ok: false, error: 'Runtime shutdown failed' });
    expect(native.quitAndInstall).not.toHaveBeenCalled();
  });

  it('returns to ready after a cancelled close and reuses the download on retry', async () => {
    const { updater, installUpdate, fetch } = await fixture();
    const ready = await updater.checkAndDownload();
    installUpdate.mockResolvedValueOnce(false);
    expect(await updater.installReady()).toMatchObject({ ok: true, action: 'none', state: ready });
    expect(native.quitAndInstall).not.toHaveBeenCalled();
    const downloads = fetch.mock.calls.length;
    expect(await updater.installReady()).toMatchObject({ ok: true, action: 'restarting' });
    expect(native.quitAndInstall).toHaveBeenCalledOnce();
    expect(fetch).toHaveBeenCalledTimes(downloads);
  });

  it('keeps DMG-only releases available for manual installation', async () => {
    const { updater } = await fixture({ extension: 'dmg' });
    expect(await updater.checkAndDownload()).toMatchObject({ status: 'downloaded', manualInstall: true, installMode: 'open-finder' });
    expect(await updater.installReady()).toMatchObject({ ok: true, action: 'opened-folder' });
    expect(shell.showItemInFolder).toHaveBeenCalledOnce();
    expect(native.prepare).not.toHaveBeenCalled();
  });

  it('continues launching the Windows installer and quitting after handoff', async () => {
    Object.defineProperty(process, 'platform', { value: 'win32' });
    const { updater } = await fixture({ extension: 'exe' });
    expect(await updater.checkAndDownload()).toMatchObject({ status: 'downloaded', installMode: 'run-installer' });
    vi.useFakeTimers();
    expect(await updater.installReady()).toMatchObject({ ok: true, action: 'opened-installer' });
    expect(shell.openPath).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(800);
    expect(app.quit).toHaveBeenCalledOnce();
    expect(native.prepare).not.toHaveBeenCalled();
  });
});
