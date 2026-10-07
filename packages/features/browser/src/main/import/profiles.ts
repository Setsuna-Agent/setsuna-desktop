import { readdir, realpath } from 'node:fs/promises';
import path from 'node:path';
import type { BrowserImportProfile } from '../../contracts/import.js';
import { isRecord, readProfileJson, withinDirectory } from './files.js';

export type BrowserProfileRoot = Readonly<{ browser: BrowserImportProfile['browser']; directory: string }>;
export type NativeBrowserProfile = BrowserImportProfile & Readonly<{ directory: string; root: string }>;

export function browserProfileRoots(platform: NodeJS.Platform, home: string, localAppData?: string): BrowserProfileRoot[] {
  if (platform === 'darwin') return [
    { browser: 'chrome', directory: path.join(home, 'Library', 'Application Support', 'Google', 'Chrome') },
    { browser: 'edge', directory: path.join(home, 'Library', 'Application Support', 'Microsoft Edge') },
  ];
  if (platform === 'win32') {
    const local = localAppData || path.join(home, 'AppData', 'Local');
    return [
      { browser: 'chrome', directory: path.join(local, 'Google', 'Chrome', 'User Data') },
      { browser: 'edge', directory: path.join(local, 'Microsoft', 'Edge', 'User Data') },
    ];
  }
  return [];
}

export async function discoverBrowserProfiles(roots: readonly BrowserProfileRoot[]): Promise<NativeBrowserProfile[]> {
  const result: NativeBrowserProfile[] = [];
  for (const source of roots) {
    let entries;
    try { entries = await readdir(source.directory, { withFileTypes: true }); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue; throw error; }
    const root = await realpath(source.directory);
    const state = await readProfileJson(root, 'Local State');
    const profile = state && isRecord(state.profile) ? state.profile : {};
    const cache = isRecord(profile.info_cache) ? profile.info_cache : {};
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name, 'en', { numeric: true }))) {
      if (!entry.isDirectory() || !/^(Default|Profile \d+)$/.test(entry.name)) continue;
      const directory = await realpath(path.join(root, entry.name));
      if (!withinDirectory(root, directory)) continue;
      const info = cache[entry.name];
      const name = isRecord(info) && typeof info.name === 'string' ? info.name.trim().slice(0, 160) : '';
      result.push({ id: `${source.browser}:${entry.name}`, browser: source.browser, name: name || entry.name, directory, root });
    }
  }
  return result;
}

export async function validateBrowserProfile(profile: NativeBrowserProfile): Promise<void> {
  // A profile moved or replaced after discovery must not turn an ID into arbitrary file access.
  const directory = await realpath(profile.directory);
  if (directory !== profile.directory || !withinDirectory(await realpath(profile.root), directory)) {
    throw new Error('Browser profile is no longer available.');
  }
}
