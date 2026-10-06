import { createHash } from 'node:crypto';
import { readdir, readFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import type { Extension } from 'electron';
import { validExtensionId } from './metadata.js';

/** Installed files also describe disabled extensions, which Electron no longer lists. */
export async function readInstalledExtensions(directory: string): Promise<Extension[]> {
  const entries = await readDirectories(directory);
  if (!entries.length) return [];
  const canonicalDirectory = await realpath(directory);
  const installed = await Promise.all(entries.filter(({ name }) => validExtensionId(name)).map(async ({ name: id }) => {
    const root = path.join(directory, id);
    const versions = (await readDirectories(root)).filter(({ name }) => /^\d+(?:\.\d+){0,3}_0$/.test(name))
      .sort((a, b) => b.name.localeCompare(a.name, 'en', { numeric: true }));
    for (const version of versions) {
      try {
        const location = await realpath(path.join(root, version.name));
        const manifestFile = await realpath(path.join(location, 'manifest.json'));
        if (!within(canonicalDirectory, location) || !within(location, manifestFile)) continue;
        const manifest = JSON.parse(await readFile(manifestFile, 'utf8'));
        if (typeof manifest.key !== 'string' || typeof manifest.name !== 'string'
          || manifest.version !== version.name.slice(0, -2) || manifest.manifest_version !== 3) continue;
        const keyId = createHash('sha256').update(Buffer.from(manifest.key, 'base64')).digest('hex').slice(0, 32)
          .replace(/[0-9a-f]/g, (digit) => String.fromCharCode(97 + parseInt(digit, 16)));
        if (keyId !== id) continue;
        return { id, path: path.join(root, version.name), manifest, name: manifest.name, version: manifest.version, url: `chrome-extension://${id}/` };
      } catch { /* An incomplete or invalid installation must never be loaded. */ }
    }
    return null;
  }));
  return installed.filter((extension): extension is Extension => extension !== null);
}

async function readDirectories(directory: string) {
  try { return (await readdir(directory, { withFileTypes: true })).filter((entry) => entry.isDirectory()); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []; throw error; }
}

function within(root: string, file: string): boolean {
  const relative = path.relative(root, file);
  return Boolean(relative && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}
