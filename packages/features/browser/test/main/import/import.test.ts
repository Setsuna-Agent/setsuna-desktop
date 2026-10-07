import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { browserProfileRoots, discoverBrowserProfiles } from '../../../src/main/import/profiles.js';
import { BrowserImportService } from '../../../src/main/import/service.js';
import { readProfileBookmarks } from '../../../src/main/import/bookmarks.js';
import { readInstalledExtensions } from '../../../src/main/extensions/installations.js';
import { copyImportedExtension } from '../../../src/main/extensions/import.js';

vi.mock('electron', () => ({ nativeImage: {} }));
const cleanup: string[] = [];
afterEach(async () => { await Promise.all(cleanup.splice(0).map((directory) => rm(directory, { recursive: true, force: true }))); });

async function fixture() {
  const directory = await mkdtemp(path.join(tmpdir(), 'setsuna-browser-import-'));
  cleanup.push(directory);
  const root = path.join(directory, 'Chrome');
  const profile = path.join(root, 'Default');
  await mkdir(profile, { recursive: true });
  const roots = [{ browser: 'chrome' as const, directory: root }];
  return { directory, root, profile, roots };
}

async function extension(profile: string, name: string, manifestVersion = 3) {
  const key = Buffer.from(name).toString('base64');
  const id = createHash('sha256').update(Buffer.from(key, 'base64')).digest('hex').slice(0, 32)
    .replace(/[0-9a-f]/g, (digit) => String.fromCharCode(97 + parseInt(digit, 16)));
  const directory = path.join(profile, 'Extensions', id, '1.2.0_0');
  await mkdir(directory, { recursive: true });
  await writeFile(path.join(directory, 'manifest.json'), JSON.stringify({ key, name, version: '1.2.0', manifest_version: manifestVersion }));
  await writeFile(path.join(directory, 'content.js'), 'console.log("import test")');
  return { id, directory };
}

const folder = (id: string, name: string, children: unknown[]) => ({ id, name, type: 'folder', children });
const bookmark = (id: string, url: string) => ({ id, type: 'url', name: id, url, date_added: '13344473600000000' });
const bookmarks = (children: unknown[]) => ({ version: 1, roots: {
  bookmark_bar: folder('0', '', children), other: folder('1', '', []), synced: folder('2', '', []),
} });

describe('browser profile import', () => {
  it('discovers named profiles only under known macOS and Windows browser roots', async () => {
    const { root, roots } = await fixture();
    await mkdir(path.join(root, 'Profile 2'));
    await mkdir(path.join(root, 'Guest Profile'));
    await mkdir(path.join(root, 'System Profile'));
    await writeFile(path.join(root, 'Local State'), JSON.stringify({ profile: { info_cache: { Default: { name: 'Personal' }, 'Profile 2': { name: 'Work' } } } }));
    const profiles = await discoverBrowserProfiles(roots);
    expect(profiles.map(({ id, name }) => ({ id, name }))).toEqual([{ id: 'chrome:Default', name: 'Personal' }, { id: 'chrome:Profile 2', name: 'Work' }]);
    expect(browserProfileRoots('darwin', '/home/test').map((entry) => entry.directory)).toEqual([
      path.join('/home/test', 'Library', 'Application Support', 'Google', 'Chrome'), path.join('/home/test', 'Library', 'Application Support', 'Microsoft Edge'),
    ]);
    expect(browserProfileRoots('win32', '/home/test', '/local').map((entry) => entry.directory)).toEqual([
      path.join('/local', 'Google', 'Chrome', 'User Data'), path.join('/local', 'Microsoft', 'Edge', 'User Data'),
    ]);
  });

  it('preserves nested, local and account favorites, their order and Chromium timestamps', async () => {
    const { profile } = await fixture();
    await writeFile(path.join(profile, 'Bookmarks'), JSON.stringify(bookmarks([
      folder('work', 'Work', [bookmark('first', 'https://example.test'), bookmark('second', 'https://example.test/two')]),
      bookmark('unsafe', 'javascript:alert(1)'),
    ])));
    await writeFile(path.join(profile, 'AccountBookmarks'), JSON.stringify(bookmarks([bookmark('first', 'https://account.test')])));
    const tree = await readProfileBookmarks(profile, 'chrome:Default');
    expect(tree.nodes.filter((node) => node.type === 'bookmark').map((node) => [node.id, node.dateAdded])).toEqual([
      ['import:chrome:Default:Bookmarks:first', 1_700_000_000_000],
      ['import:chrome:Default:Bookmarks:second', 1_700_000_000_000],
      ['import:chrome:Default:AccountBookmarks:first', 1_700_000_000_000],
    ]);
    expect(tree.nodes.find((node) => node.id.endsWith(':second'))?.parentId).toBe('import:chrome:Default:Bookmarks:work');
    await writeFile(path.join(profile, 'Bookmarks'), '{broken');
    await expect(readProfileBookmarks(profile, 'chrome:Default')).rejects.toThrow();
  });

  it('exposes no source paths, reads disabled state, rejects arbitrary IDs and reports partial extension failure', async () => {
    const { roots, profile } = await fixture();
    const enabled = await extension(profile, 'Enabled');
    const disabled = await extension(profile, 'Disabled');
    const old = await extension(profile, 'Old', 2);
    await writeFile(path.join(profile, 'Secure Preferences'), JSON.stringify({ extensions: { settings: { [disabled.id]: { state: 0 } } } }));
    const installed = vi.fn(async (item: { id: string }) => { if (item.id === enabled.id) throw new Error('load failed'); return true; });
    const service = new BrowserImportService(roots, { list: () => [], importInstallation: installed }, () => 'en');
    expect(await service.listProfiles()).toEqual([{ id: 'chrome:Default', browser: 'chrome', name: 'Default' }]);
    const preview = await service.preview('chrome:Default');
    expect(preview.extensions.find((item) => item.id === disabled.id)).toMatchObject({ name: 'Disabled', enabled: false, compatible: true });
    expect(preview.extensions.find((item) => item.id === old.id)?.compatible).toBe(false);
    await expect(service.preview('../outside')).rejects.toThrow();
    await expect(service.importExtensions('chrome:Default', [enabled.id, '../outside'], new AbortController().signal)).rejects.toThrow();
    await expect(service.importExtensions('chrome:Default', [old.id], new AbortController().signal)).rejects.toThrow();
    expect(installed).not.toHaveBeenCalled();
    expect(await service.importExtensions('chrome:Default', [enabled.id, disabled.id], new AbortController().signal)).toEqual({ imported: [disabled.id], failed: [enabled.id], skipped: [] });
    expect(installed).toHaveBeenLastCalledWith(expect.objectContaining({ id: disabled.id }), false, expect.any(AbortSignal));
  });

  it.skipIf(process.platform === 'win32')('rejects source bookmark and extension directories that escape the selected profile', async () => {
    const { directory, roots, profile } = await fixture();
    const outside = path.join(directory, 'private');
    await mkdir(outside);
    await writeFile(path.join(outside, 'Bookmarks'), JSON.stringify(bookmarks([])));
    await symlink(path.join(outside, 'Bookmarks'), path.join(profile, 'Bookmarks'));
    await expect(readProfileBookmarks(profile, 'chrome:Default')).rejects.toThrow('Invalid browser import path');
    await rm(path.join(profile, 'Bookmarks'));
    await symlink(outside, path.join(profile, 'Extensions'));
    const service = new BrowserImportService(roots, { list: () => [], importInstallation: async () => true }, () => 'en');
    await service.listProfiles();
    await expect(service.preview('chrome:Default')).rejects.toThrow('Invalid browser extension directory');
  });
});

describe('extension installation copy', () => {
  it('copies a verified snapshot once, without modifying the source or an existing installation', async () => {
    const { directory, profile } = await fixture();
    const source = await extension(profile, 'Test');
    const [item] = await readInstalledExtensions(path.join(profile, 'Extensions'));
    const target = path.join(directory, 'destination');
    const installed = await copyImportedExtension(item, target, new AbortController().signal);
    expect(await readFile(path.join(installed!, 'content.js'), 'utf8')).toBe('console.log("import test")');
    await writeFile(path.join(installed!, 'content.js'), 'existing content');
    expect(await copyImportedExtension(item, target, new AbortController().signal)).toBeNull();
    expect(await readFile(path.join(installed!, 'content.js'), 'utf8')).toBe('existing content');
    expect(await readFile(path.join(source.directory, 'content.js'), 'utf8')).toBe('console.log("import test")');
    expect(await readdir(target)).toEqual([source.id]);
  });

  it.skipIf(process.platform === 'win32')('cleans incomplete copies and refuses symlink resources and cancelled imports', async () => {
    const { directory, profile } = await fixture();
    const source = await extension(profile, 'Test');
    await writeFile(path.join(directory, 'private'), 'secret');
    await symlink(path.join(directory, 'private'), path.join(source.directory, 'linked.js'));
    const [item] = await readInstalledExtensions(path.join(profile, 'Extensions'));
    const target = path.join(directory, 'destination');
    await expect(copyImportedExtension(item, target, new AbortController().signal)).rejects.toThrow('Invalid extension files');
    expect(await readdir(target)).toEqual([]);
    await rm(path.join(source.directory, 'linked.js'));
    const controller = new AbortController(); controller.abort();
    await expect(copyImportedExtension(item, target, controller.signal)).rejects.toThrow();
    expect(await readdir(target)).toEqual([]);
  });
});
