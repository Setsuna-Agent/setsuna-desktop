import { execFile } from 'node:child_process';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { app } from 'electron';

export type NativeHost = { executable: string; origin: string };

/** Only OS/browser registrations can select executables; extensions supply a host name. */
export async function resolveNativeHost(name: string, extensionId: string): Promise<NativeHost> {
  if (!/^[a-z0-9_]+(?:\.[a-z0-9_]+)*$/.test(name) || name.length > 256) throw new Error('Invalid native messaging host name specified.');
  const origin = `chrome-extension://${extensionId}/`;
  for await (const location of manifestLocations(name)) {
    let file;
    try { file = await stat(location); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue; throw error; }
    if (!file.isFile() || file.size > 64 * 1024) throw new Error('Invalid native messaging host manifest.');
    let manifest;
    try { manifest = JSON.parse(await readFile(location, 'utf8')) as Record<string, unknown>; }
    catch { throw new Error('Invalid native messaging host manifest.'); }
    if (!manifest || manifest.name !== name || manifest.type !== 'stdio' || typeof manifest.path !== 'string' || !manifest.path
      || !Array.isArray(manifest.allowed_origins)) throw new Error('Invalid native messaging host manifest.');
    if (!manifest.allowed_origins.includes(origin)) throw new Error('Access to the specified native messaging host is forbidden.');
    if (process.platform !== 'win32' && !path.isAbsolute(manifest.path)) throw new Error('Invalid native messaging host path.');
    const executable = path.resolve(path.dirname(location), manifest.path);
    if (!(await stat(executable).catch(() => null))?.isFile()) throw new Error('Native messaging host executable not found.');
    return { executable, origin };
  }
  throw new Error('Specified native messaging host not found.');
}

async function* manifestLocations(name: string): AsyncGenerator<string> {
  yield path.join(app.getPath('userData'), 'NativeMessagingHosts', `${name}.json`);
  if (process.platform === 'darwin') {
    const support = path.join(app.getPath('home'), 'Library', 'Application Support');
    yield* [...['Google/Chrome', 'Microsoft Edge', 'Chromium'].map((browser) => path.join(support, browser, 'NativeMessagingHosts', `${name}.json`)),
      path.join('/Library/Google/Chrome/NativeMessagingHosts', `${name}.json`),
      path.join('/Library/Microsoft/Edge/NativeMessagingHosts', `${name}.json`),
      path.join('/Library/Application Support/Chromium/NativeMessagingHosts', `${name}.json`)];
    return;
  }
  if (process.platform !== 'win32') throw new Error('Native messaging is unavailable on this platform.');
  const registry = path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'reg.exe');
  for (const hive of ['HKCU', 'HKLM']) for (const browser of ['Google\\Chrome', 'Microsoft\\Edge', 'Chromium']) {
    for (const view of ['32', '64']) {
      const key = `${hive}\\Software\\${browser}\\NativeMessagingHosts\\${name}`;
      const result = await promisify(execFile)(registry, ['query', key, '/ve', `/reg:${view}`], { windowsHide: true, timeout: 3000, maxBuffer: 64 * 1024 }).catch(() => null);
      const location = result?.stdout.match(/REG_SZ\s+([^\r\n]+)/)?.[1]?.trim();
      if (location && path.isAbsolute(location)) yield location;
    }
  }
}
