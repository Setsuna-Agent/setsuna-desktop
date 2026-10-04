import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { expect, it } from 'vitest';
import { DEFAULT_BROWSER_PREFERENCES } from '../../../src/contracts/settings.js';
import { BrowserPreferencesStore, patchBrowserPreferences } from '../../../src/main/settings/preferences.js';

it('serializes concurrent partial updates, restores them and rejects invalid writes without losing existing settings', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'setsuna-browser-settings-'));
  const file = path.join(directory, 'settings.json');
  try {
    const store = new BrowserPreferencesStore(file);
    await store.load();
    await Promise.all([store.update({ searchEngine: 'baidu' }), store.update({ permissions: { camera: 'ask' } }), store.update({ rememberHistory: false })]);
    await expect(store.update({ defaultZoom: 999 })).rejects.toThrow();
    const restored = new BrowserPreferencesStore(file);
    await restored.load();
    expect(restored.get()).toMatchObject({ searchEngine: 'baidu', rememberHistory: false, permissions: { camera: 'ask', microphone: 'block' } });
    expect(JSON.parse(await readFile(file, 'utf8')).preferences).toEqual(restored.get());
    const snapshot = restored.get();
    (snapshot.permissions as { camera: string }).camera = 'allow';
    expect(restored.get().permissions.camera).toBe('ask');
    await writeFile(file, '{broken');
    await expect(new BrowserPreferencesStore(file).load()).rejects.toThrow();
    expect(await readFile(file, 'utf8')).toBe('{broken');
  } finally { await rm(directory, { recursive: true, force: true }); }
});

it('rejects unsupported schemes, arbitrary paths and malformed permission grants at the settings boundary', () => {
  for (const patch of [
    { homeUrl: 'javascript:alert(1)' }, { homeUrl: 'https://user:password@example.com/' },
    { downloadDirectory: '/tmp' }, { searchEngine: 'unknown' }, { savePasswords: 'yes' },
    { permissions: { usb: 'allow' } }, { permissions: { camera: true } },
    { sitePermissions: { 'https://example.com/path': { camera: 'allow' } } },
    { sitePermissions: { 'chrome-extension://id': { microphone: 'allow' } } },
  ]) expect(() => patchBrowserPreferences(DEFAULT_BROWSER_PREFERENCES, patch)).toThrow();
  expect(patchBrowserPreferences(DEFAULT_BROWSER_PREFERENCES, {
    homeUrl: 'https://example.com', sitePermissions: { 'https://example.com': { camera: 'ask' } },
  })).toMatchObject({ homeUrl: 'https://example.com/', sitePermissions: { 'https://example.com': { camera: 'ask' } } });
});
